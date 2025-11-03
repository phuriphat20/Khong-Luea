import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { collection, doc, getDocs, onSnapshot, writeBatch } from "firebase/firestore";
import { useAppContext } from "../context/AppContext";
import { db } from "../services/firebaseConnected";

export default function SettingsScreen() {
  const {
    user,
    profile,
    fridges,
    joinFridge,
    leaveFridge,
    signOut,
    updateProfile,
    pendingJoinCode,
    setPendingJoinCode,
  } = useAppContext();

  const [displayName, setDisplayName] = useState(profile?.displayName || "");
  const [savingProfile, setSavingProfile] = useState(false);

  const [joinCode, setJoinCode] = useState("");
  const [joining, setJoining] = useState(false);

  const [leavingId, setLeavingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const memberListenersRef = useRef(new Map());
  const [memberCounts, setMemberCounts] = useState({});

  const [myFridges, setMyFridges] = useState(fridges || []);

  useEffect(() => {
    setDisplayName(profile?.displayName || "");
  }, [profile?.displayName]);

  useEffect(() => {
    if (!pendingJoinCode) return;
    setJoinCode(pendingJoinCode);
    setPendingJoinCode("");
  }, [pendingJoinCode, setPendingJoinCode]);

  useEffect(() => {
    const listeners = memberListenersRef.current;
    const activeIds = new Set((fridges || []).map((f) => f.id));

    // Unsubscribe removed fridges
    listeners.forEach((unsub, fid) => {
      if (!activeIds.has(fid)) {
        try {
          unsub();
        } catch (err) {
          console.warn("settings member listener cleanup failed", err);
        }
        listeners.delete(fid);
        setMemberCounts((prev) => {
          if (!(fid in prev)) return prev;
          const next = { ...prev };
          delete next[fid];
          return next;
        });
      }
    });

    // Subscribe new fridges
    (fridges || []).forEach((fridge) => {
      const fid = fridge?.id;
      if (!fid || listeners.has(fid)) return;
      const membersRef = collection(db, "fridges", fid, "members");
      const unsub = onSnapshot(
        membersRef,
        (snap) => {
          const size = snap.size;
          setMemberCounts((prev) => {
            if (prev[fid] === size) return prev;
            return { ...prev, [fid]: size };
          });
        },
        (err) => {
          if (err?.code !== "permission-denied") {
            console.warn("settings members listener error", err);
          }
        }
      );
      listeners.set(fid, unsub);
    });
  }, [fridges]);

  useEffect(() => () => {
    memberListenersRef.current.forEach((unsub) => {
      try {
        unsub();
      } catch {}
    });
    memberListenersRef.current.clear();
    setMemberCounts({});
  }, []);


  
  const sortedFridges = useMemo(() => {
    return (fridges || []).slice().sort((a, b) => {
      const nameA = (a.name || "").toLowerCase();
      const nameB = (b.name || "").toLowerCase();
      if (nameA === nameB) return 0;
      return nameA < nameB ? -1 : 1;
    });
  }, [fridges]);

  const handleSaveProfile = async () => {
    const trimmed = displayName.trim();
    if (!trimmed) {
      Alert.alert("Display name required", "Please enter your display name.");
      return;
    }
    try {
      setSavingProfile(true);
      await updateProfile({ displayName: trimmed });
      Alert.alert("Profile updated", "Your display name has been saved.");
    } catch (err) {
      Alert.alert(
        "Update failed",
        err?.message || "We couldn't update your profile right now."
      );
    } finally {
      setSavingProfile(false);
    }
  };

  const confirmLeaveFridge = (fridge) => {
    if (!fridge?.id) return;
    const isOwner = fridge.role === "owner";
    Alert.alert(
      isOwner ? "Delete this fridge?" : "Leave this fridge?",
      isOwner
        ? `All members will lose access to ${fridge.name || "this fridge"}.`
        : `You will lose access to ${fridge.name || "this fridge"}.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: isOwner ? "Delete" : "Leave",
          style: "destructive",
          onPress: () =>
            isOwner ? handleDeleteFridge(fridge) : handleLeaveFridge(fridge),
        },
      ]
    );
  };

  const handleLeaveFridge = async (fridge) => {
    try {
      setLeavingId(fridge.id);
      await leaveFridge(fridge.id);
      Alert.alert("Left fridge", "You are no longer a member of this fridge.");
    } catch (err) {
      Alert.alert(
        "Unable to leave",
        err?.message || "We couldn't leave that fridge."
      );
    } finally {
      setLeavingId(null);
    }
  };

  const handleDeleteFridge = async (fridge) => {
    if (!user?.uid || !fridge?.id) return;
    try {
      setDeletingId(fridge.id);
      const fridgeId = fridge.id;
      const batch = writeBatch(db);

      const membersSnap = await getDocs(
        collection(db, "fridges", fridgeId, "members")
      );
      membersSnap.forEach((member) => {
        batch.delete(member.ref);
        batch.delete(doc(db, "users", member.id, "memberships", fridgeId));
      });

      const stockSnap = await getDocs(
        collection(db, "fridges", fridgeId, "stock")
      );
      stockSnap.forEach((item) => batch.delete(item.ref));

      if (fridge.inviteCode) {
        const codeKey = fridge.inviteCode.toString().toUpperCase();
        batch.delete(doc(db, "inviteCodes", codeKey));
      }

      batch.delete(doc(db, "fridges", fridgeId));
      await batch.commit();
      Alert.alert("Fridge deleted", "The fridge has been removed for everyone.");
    } catch (err) {
      Alert.alert(
        "Delete failed",
        err?.message || "We couldn't delete that fridge."
      );
    } finally {
      setDeletingId(null);
    }
  };

  const handleJoinFridge = async () => {
    const trimmed = joinCode.trim().toUpperCase();
    if (!trimmed) {
      Alert.alert("Invite code required", "Enter an invite code to join.");
      return;
    }
    try {
      setJoining(true);
      await joinFridge(trimmed);
      setJoinCode("");
      Alert.alert("Joined successfully!", "You're now a member of that fridge.");
    } catch (err) {
      Alert.alert("Unable to join", err?.message || "Invalid invite code.");
    } finally {
      setJoining(false);
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Profile</Text>
        <Text style={styles.label}>Display name</Text>
        <TextInput
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="Your name"
          style={styles.input}
          editable={!savingProfile}
        />
        <Text style={styles.label}>Email</Text>
        <View style={styles.readOnlyField}>
          <Text style={styles.readOnlyText}>
            {profile?.email || user?.email || "No email"}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.primaryButton, savingProfile && styles.primaryDisabled]}
          disabled={savingProfile}
          onPress={handleSaveProfile}
        >
          {savingProfile ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.primaryText}>Save</Text>
          )}
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Joined Fridges</Text>
        {!fridges ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color="#2563EB" />
            <Text style={styles.loadingText}>Loading your fridges…</Text>
          </View>
        ) : sortedFridges.length === 0 ? (
          <Text style={styles.helperText}>
            You haven't joined any fridges yet.
          </Text>
        ) : (
          sortedFridges.map((fridge) => {
            const isOwner = fridge.role === "owner";
            const busy =
              (isOwner && deletingId === fridge.id) ||
              (!isOwner && leavingId === fridge.id);

            return (
              <View key={fridge.id} style={styles.fridgeBox}>
                <View style={styles.fridgeHeader}>
                  <Text style={styles.fridgeName}>
                    {fridge.name || "Unnamed fridge"}
                  </Text>
                  <Text
                    style={[
                      styles.roleBadge,
                      isOwner ? styles.ownerBadge : styles.memberBadge,
                    ]}
                  >
                    {isOwner ? "Owner" : "Member"}
                  </Text>
                </View>
                <Text style={styles.metaText}>
                  Invite code: {((fridge.inviteCode || fridge.id || "").toString().toUpperCase()) || "N/A"}
                </Text>
                <Text style={styles.metaText}>
                  Members: {memberCounts[fridge.id] ?? fridge.memberCount ?? 0}
                </Text>
                <TouchableOpacity
                  style={[
                    isOwner ? styles.destructiveButton : styles.secondaryButton,
                    busy &&
                      (isOwner
                        ? styles.destructiveDisabled
                        : styles.secondaryDisabled),
                  ]}
                  disabled={busy}
                  onPress={() => confirmLeaveFridge(fridge)}
                >
                  {busy ? (
                    <ActivityIndicator
                      size="small"
                      color={isOwner ? "#fff" : "#2563EB"}
                    />
                  ) : (
                    <Text
                      style={
                        isOwner ? styles.destructiveText : styles.secondaryText
                      }
                    >
                      {isOwner ? "Delete fridge" : "Leave fridge"}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            );
          })
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Join by Invite Code</Text>
        <Text style={styles.helperText}>
          Ask the fridge owner for the invite code and paste it below.
        </Text>
        <TextInput
          value={joinCode}
          onChangeText={setJoinCode}
          placeholder="INVITE"
          autoCapitalize="characters"
          autoCorrect={false}
          style={styles.input}
          editable={!joining}
        />
        <TouchableOpacity
          style={[styles.primaryButton, joining && styles.primaryDisabled]}
          disabled={joining}
          onPress={handleJoinFridge}
        >
          {joining ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.primaryText}>Join</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Fridge creation is handled on HomeScreen. */}

      <TouchableOpacity style={styles.signOutButton} onPress={signOut}>
        <Text style={styles.signOutText}>Sign out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F3F4F6",
  },
  content: {
    paddingHorizontal: 20,
    paddingVertical: 24,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#E5E7EB",
    shadowColor: "#111827",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 12,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: "#6B7280",
    marginBottom: 6,
    marginTop: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
    color: "#111827",
    backgroundColor: "#F9FAFB",
  },
  readOnlyField: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "#F9FAFB",
  },
  readOnlyText: {
    color: "#6B7280",
  },
  helperText: {
    color: "#6B7280",
    marginBottom: 12,
  },
  primaryButton: {
    marginTop: 16,
    backgroundColor: "#2563EB",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  primaryDisabled: {
    backgroundColor: "#93C5FD",
  },
  primaryText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 16,
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  loadingText: {
    marginLeft: 8,
    color: "#6B7280",
  },
  fridgeBox: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#E5E7EB",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    backgroundColor: "#F9FAFB",
  },
  fridgeHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  fridgeName: {
    fontSize: 16,
    fontWeight: "700",
    color: "#111827",
  },
  roleBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    fontSize: 12,
    fontWeight: "600",
    color: "#1F2937",
  },
  ownerBadge: {
    backgroundColor: "#1D4ED8",
    color: "#FFFFFF",
  },
  memberBadge: {
    backgroundColor: "#E0E7FF",
    color: "#1D4ED8",
  },
  metaText: {
    color: "#6B7280",
  },
  secondaryButton: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: "#2563EB",
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  secondaryDisabled: {
    borderColor: "#93C5FD",
    backgroundColor: "#E0E7FF",
  },
  secondaryText: {
    color: "#2563EB",
    fontWeight: "700",
  },
  destructiveButton: {
    marginTop: 12,
    backgroundColor: "#DC2626",
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  destructiveDisabled: {
    backgroundColor: "#FCA5A5",
  },
  destructiveText: {
    color: "#FFFFFF",
    fontWeight: "700",
  },
  signOutButton: {
    backgroundColor: "#111827",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  signOutText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 16,
  },
});
