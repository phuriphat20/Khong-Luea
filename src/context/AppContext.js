// src/context/AppContext.js
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { onAuthStateChanged, signOut as firebaseSignOut } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { auth, db } from "../services/firebaseConnected";

const AppContext = createContext({
  user: null,
  profile: null,
  fridges: [],
  currentFridge: null,
  initializing: true,
  updateProfile: async () => {},
  joinFridge: async () => {},
  leaveFridge: async () => {},
  setCurrentFridge: async () => {},
  signOut: async () => {},
});

const defaultDisplayName = (email, fallback = "New member") => {
  if (typeof email === "string" && email.includes("@")) {
    return email.split("@")[0] || fallback;
  }
  return fallback;
};

export function AppProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [fridges, setFridges] = useState([]);
  const [currentFridge, setCurrentFridgeState] = useState(null);
  const [profileReady, setProfileReady] = useState(false);
  const [membershipsReady, setMembershipsReady] = useState(false);

  const profileUnsubRef = useRef(null);
  const membershipsUnsubRef = useRef(null);
  const fridgeListenersRef = useRef(new Map());
  const membershipMetaRef = useRef({});

  const initializing = user ? !(profileReady && membershipsReady) : false;

  const clearFridgeListeners = () => {
    fridgeListenersRef.current.forEach((unsubscribe) => {
      try {
        unsubscribe();
      } catch (err) {
        console.warn("fridge listener cleanup failed", err);
      }
    });
    fridgeListenersRef.current.clear();
    membershipMetaRef.current = {};
    setFridges([]);
  };

  const stopProfileListener = () => {
    if (profileUnsubRef.current) {
      profileUnsubRef.current();
      profileUnsubRef.current = null;
    }
  };

  const stopMembershipListener = () => {
    if (membershipsUnsubRef.current) {
      membershipsUnsubRef.current();
      membershipsUnsubRef.current = null;
    }
  };

  useEffect(() => {
    const cleanupAll = () => {
      stopProfileListener();
      stopMembershipListener();
      clearFridgeListeners();
      setProfile(null);
      setCurrentFridgeState(null);
      setProfileReady(false);
      setMembershipsReady(false);
    };

    const unsubscribeAuth = onAuthStateChanged(auth, async (firebaseUser) => {
      cleanupAll();
      setUser(firebaseUser);

      if (!firebaseUser) {
        return;
      }

      try {
        const userRef = doc(db, "users", firebaseUser.uid);
        const existing = await getDoc(userRef);
        if (!existing.exists()) {
          await setDoc(userRef, {
            displayName:
              firebaseUser.displayName ||
              defaultDisplayName(firebaseUser.email),
            email: firebaseUser.email || "",
            currentFridgeId: null,
            createdAt: serverTimestamp(),
          });
        }
      } catch (err) {
        console.warn("ensure user profile failed", err);
      }

      subscribeToProfile(firebaseUser.uid);
      subscribeToMemberships(firebaseUser.uid);
    });

    return () => {
      unsubscribeAuth();
      cleanupAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!profile?.currentFridgeId) {
      setCurrentFridgeState(null);
      return;
    }
    const next = fridges.find((f) => f.id === profile.currentFridgeId);
    setCurrentFridgeState(next || null);
  }, [profile?.currentFridgeId, fridges]);

  const updateFridgeInState = (fridgeId, data) => {
    setFridges((prev) => {
      const others = prev.filter((f) => f.id !== fridgeId);
      if (!data) return others;
      return [...others, data].sort((a, b) => {
        const nameA = a.name?.toString().toLowerCase() || "";
        const nameB = b.name?.toString().toLowerCase() || "";
        if (nameA === nameB) return 0;
        return nameA < nameB ? -1 : 1;
      });
    });
  };

  const subscribeToProfile = (uid) => {
    stopProfileListener();
    setProfileReady(false);

    const userRef = doc(db, "users", uid);
    let firstLoad = true;

    profileUnsubRef.current = onSnapshot(
      userRef,
      (snap) => {
        if (snap.exists()) {
          setProfile(snap.data());
        } else {
          setProfile(null);
        }
        if (firstLoad) {
          setProfileReady(true);
          firstLoad = false;
        }
      },
      (err) => {
        console.warn("profile listener error", err);
        setProfile(null);
        setProfileReady(true);
      }
    );
  };

  const subscribeToMemberships = (uid) => {
    stopMembershipListener();
    clearFridgeListeners();
    setMembershipsReady(false);

    const membershipsRef = collection(db, "users", uid, "memberships");
    let firstLoad = true;

    membershipsUnsubRef.current = onSnapshot(
      membershipsRef,
      (snapshot) => {
        const nextMeta = {};
        const nextIds = [];

        snapshot.forEach((docSnap) => {
          const data = docSnap.data() || {};
          nextMeta[docSnap.id] = {
            role: data.role || "member",
            addedAt: data.addedAt || null,
          };
          nextIds.push(docSnap.id);
        });

        membershipMetaRef.current = nextMeta;

        const listeners = fridgeListenersRef.current;
        const nextIdSet = new Set(nextIds);

        listeners.forEach((unsubscribe, fridgeId) => {
          if (!nextIdSet.has(fridgeId)) {
            try {
              unsubscribe();
            } catch (err) {
              console.warn("fridge listener cleanup failed", err);
            }
            listeners.delete(fridgeId);
            updateFridgeInState(fridgeId, null);
          }
        });

        nextIds.forEach((fridgeId) => {
          if (listeners.has(fridgeId)) {
            setFridges((prev) =>
              prev.map((f) =>
                f.id === fridgeId
                  ? { ...f, role: nextMeta[fridgeId]?.role || f.role || "member" }
                  : f
              )
            );
            return;
          }

          const fridgeRef = doc(db, "fridges", fridgeId);
          const unsubscribe = onSnapshot(
            fridgeRef,
            (fridgeSnap) => {
              if (fridgeSnap.exists()) {
                const role = membershipMetaRef.current[fridgeId]?.role || "member";
                updateFridgeInState(fridgeId, {
                  id: fridgeSnap.id,
                  ...fridgeSnap.data(),
                  role,
                });
              } else {
                updateFridgeInState(fridgeId, null);
              }
            },
            (err) => {
              console.warn("fridge listener error", err);
              updateFridgeInState(fridgeId, null);
            }
          );

          listeners.set(fridgeId, unsubscribe);
        });

        if (firstLoad) {
          setMembershipsReady(true);
          firstLoad = false;
        }
      },
      (err) => {
        console.warn("memberships listener error", err);
        setMembershipsReady(true);
      }
    );
  };

  const updateProfile = async (partial) => {
    if (!user?.uid) {
      throw new Error("You need to be signed in to update your profile.");
    }
    await updateDoc(doc(db, "users", user.uid), partial);
  };

  const joinFridge = async (rawCode) => {
    if (!user?.uid) {
      throw new Error("You need to be signed in to join a fridge.");
    }

    const inviteCode = rawCode?.trim().toUpperCase();
    if (!inviteCode) {
      throw new Error("Invite code is required.");
    }

    const fridgeQuery = query(
      collection(db, "fridges"),
      where("inviteCode", "==", inviteCode),
      limit(1)
    );
    const snap = await getDocs(fridgeQuery);

    if (snap.empty) {
      throw new Error("We couldn't find a fridge with that invite code.");
    }

    const fridgeDoc = snap.docs[0];
    const fridgeId = fridgeDoc.id;

    if (membershipMetaRef.current[fridgeId]) {
      throw new Error("You're already a member of this fridge.");
    }

    const batch = writeBatch(db);

    batch.set(
      doc(db, "fridges", fridgeId, "members", user.uid),
      {
        role: "member",
        joinedAt: serverTimestamp(),
      },
      { merge: true }
    );

    batch.set(
      doc(db, "users", user.uid, "memberships", fridgeId),
      {
        role: "member",
        addedAt: serverTimestamp(),
      },
      { merge: true }
    );

    if (!profile?.currentFridgeId) {
      batch.set(
        doc(db, "users", user.uid),
        { currentFridgeId: fridgeId },
        { merge: true }
      );
    }

    await batch.commit();
    return fridgeId;
  };

  const leaveFridge = async (fridgeId) => {
    if (!user?.uid) {
      throw new Error("You need to be signed in to leave a fridge.");
    }
    if (!fridgeId) {
      throw new Error("A fridge ID is required.");
    }

    const membershipRef = doc(db, "users", user.uid, "memberships", fridgeId);
    const membershipSnap = await getDoc(membershipRef);

    if (!membershipSnap.exists()) {
      throw new Error("You are not a member of this fridge.");
    }

    const fridgeRef = doc(db, "fridges", fridgeId);
    const fridgeSnap = await getDoc(fridgeRef);

    if (!fridgeSnap.exists()) {
      const batch = writeBatch(db);
      batch.delete(membershipRef);
      if (profile?.currentFridgeId === fridgeId) {
        batch.set(
          doc(db, "users", user.uid),
          { currentFridgeId: null },
          { merge: true }
        );
      }
      await batch.commit();
      return;
    }

    const fridgeData = fridgeSnap.data();
    const isOwner = fridgeData.ownerUid === user.uid;

    const membersSnap = await getDocs(collection(db, "fridges", fridgeId, "members"));
    const memberCount = membersSnap.size;

    if (isOwner && memberCount > 1) {
      throw new Error(
        "Transfer ownership to another member before leaving this fridge."
      );
    }

    if (isOwner) {
      const batch = writeBatch(db);

      const stockSnap = await getDocs(collection(db, "fridges", fridgeId, "stock"));
      stockSnap.forEach((docSnap) => {
        batch.delete(docSnap.ref);
      });

      batch.delete(doc(db, "fridges", fridgeId, "members", user.uid));
      batch.delete(membershipRef);
      batch.delete(fridgeRef);
      batch.set(
        doc(db, "users", user.uid),
        { currentFridgeId: null },
        { merge: true }
      );

      await batch.commit();
      return;
    }

    const batch = writeBatch(db);
    batch.delete(doc(db, "fridges", fridgeId, "members", user.uid));
    batch.delete(membershipRef);

    if (profile?.currentFridgeId === fridgeId) {
      batch.set(
        doc(db, "users", user.uid),
        { currentFridgeId: null },
        { merge: true }
      );
    }

    await batch.commit();
  };

  const setCurrentFridge = async (fridgeId) => {
    if (!user?.uid) {
      throw new Error("You need to be signed in to set your current fridge.");
    }
    if (!fridgeId) {
      await updateDoc(doc(db, "users", user.uid), {
        currentFridgeId: null,
      });
      return;
    }
    if (!membershipMetaRef.current[fridgeId]) {
      throw new Error("Join this fridge before setting it as current.");
    }
    await updateDoc(doc(db, "users", user.uid), {
      currentFridgeId: fridgeId,
    });
  };

  const handleSignOut = async () => {
    await firebaseSignOut(auth);
  };

  const value = useMemo(
    () => ({
      user,
      profile,
      fridges,
      currentFridge,
      initializing,
      updateProfile,
      joinFridge,
      leaveFridge,
      setCurrentFridge,
      signOut: handleSignOut,
    }),
    [
      user,
      profile,
      fridges,
      currentFridge,
      initializing,
      updateProfile,
      joinFridge,
      leaveFridge,
      setCurrentFridge,
      handleSignOut,
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export const useAppContext = () => useContext(AppContext);

export default AppContext;
