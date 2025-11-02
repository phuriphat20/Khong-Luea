// SettingsScreen.js
import { useContext, useEffect, useState } from "react";
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
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  updateDoc,
  where,
} from "firebase/firestore";
import AppCtx from "../context/AppContext";
import { db } from "../services/firebaseConnected";

export default function SettingsScreen() {
  // Pull the signed-in user and their profile from global context.
  const { user, profile, setProfile, signOut } = useContext(AppCtx);

  // Store loading state while we fetch the connected fridge document.
  const [fridgeLoading, setFridgeLoading] = useState(false);
  const [fridgeError, setFridgeError] = useState(null);
  const [fridge, setFridge] = useState(null);

  // Track the invite code the user wants to join with.
  const [inviteCode, setInviteCode] = useState("");
  const [joining, setJoining] = useState(false);

  // Whenever the currentFridgeId changes, load the latest fridge info.
  useEffect(() => {
    let active = true;

    const loadFridge = async () => {
      if (!profile?.currentFridgeId) {
        if (!active) return;
        setFridge(null);
        setFridgeError(null);
        setFridgeLoading(false);
        return;
      }

      setFridgeLoading(true);
      setFridgeError(null);

      try {
        const fridgeRef = doc(db, "fridges", profile.currentFridgeId);
        const snap = await getDoc(fridgeRef);

        if (!active) return;

        if (snap.exists()) {
          setFridge({ id: snap.id, ...snap.data() });
        } else {
          setFridge(null);
          setFridgeError("We could not find this fridge. Ask the owner to re-invite you.");
        }
      } catch (err) {
        if (!active) return;
        console.warn("load fridge failed", err);
        setFridge(null);
        setFridgeError(err?.message || "Something went wrong while loading the fridge.");
      } finally {
        if (active) {
          setFridgeLoading(false);
        }
      }
    };

    loadFridge();

    return () => {
      active = false;
    };
  }, [profile?.currentFridgeId]);

  // Let members join a fridge by invite code and update their profile.
  const handleJoinFridge = async () => {
    const cleanedCode = inviteCode.trim().toUpperCase();
    if (!cleanedCode) {
      Alert.alert("Invite Code Needed", "Enter the invite code you received to continue.");
      return;
    }
    if (!user?.uid) {
      Alert.alert("Not Signed In", "Please sign in again before joining a fridge.");
      return;
    }

    try {
      setJoining(true);
      const fridgeQuery = query(
        collection(db, "fridges"),
        where("inviteCode", "==", cleanedCode)
      );
      const snap = await getDocs(fridgeQuery);

      if (snap.empty) {
        Alert.alert("Code Not Found", "Double-check the invite code and try again.");
        return;
      }

      const fridgeDoc = snap.docs[0];
      const fridgeId = fridgeDoc.id;

      await updateDoc(doc(db, "users", user.uid), {
        currentFridgeId: fridgeId,
      });

      if (typeof setProfile === "function") {
        setProfile((prev) =>
          prev ? { ...prev, currentFridgeId: fridgeId } : prev
        );
      }

      setInviteCode("");

      Alert.alert(
        "Fridge Linked",
        `You're now connected to “${fridgeDoc.data()?.name || "your fridge"}”.`
      );
    } catch (err) {
      console.warn("join fridge failed", err);
      Alert.alert(
        "Unable to Join",
        err?.message || "We ran into a problem linking this fridge. Try again."
      );
    } finally {
      setJoining(false);
    }
  };

  const displayName =
    profile?.displayName || user?.email?.split("@")[0] || "Member";
  const emailAddress = profile?.email || user?.email || "No email available";
  const inviteDisabled = joining || !inviteCode.trim();

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {/* Header */}
      <Text style={styles.header}>Settings</Text>

      {/* Account details */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Your Account</Text>
        <View style={styles.row}>
          <Text style={styles.label}>Name</Text>
          <Text style={styles.value}>{displayName}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Email</Text>
          <Text style={styles.value}>{emailAddress}</Text>
        </View>
      </View>

      {/* Fridge status */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Current Fridge</Text>
        {fridgeLoading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color="#2563EB" />
            <Text style={styles.loadingText}>Loading fridge details…</Text>
          </View>
        ) : !profile?.currentFridgeId ? (
          <Text style={styles.emptyText}>No fridge linked yet.</Text>
        ) : fridge ? (
          <>
            <View style={styles.row}>
              <Text style={styles.label}>Name</Text>
              <Text style={styles.value}>{fridge.name || "Unnamed fridge"}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Invite Code</Text>
              <Text style={styles.codeBadge}>
                {(fridge.inviteCode || "").toUpperCase() || "N/A"}
              </Text>
            </View>
          </>
        ) : (
          <>
            <Text style={styles.emptyText}>We could not load this fridge.</Text>
            {fridgeError ? (
              <Text style={styles.errorText}>{fridgeError}</Text>
            ) : null}
          </>
        )}
      </View>

      {/* Join fridge form */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Join a Fridge</Text>
        <Text style={styles.helpText}>
          Enter the invite code shared by the fridge owner to link it to your
          account.
        </Text>
        <TextInput
          value={inviteCode}
          onChangeText={setInviteCode}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder="INVITE"
          style={styles.input}
          editable={!joining}
        />
        <TouchableOpacity
          style={[styles.button, inviteDisabled && styles.buttonDisabled]}
          onPress={handleJoinFridge}
          disabled={inviteDisabled}
        >
          {joining ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Join Fridge</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Sign-out */}
      <TouchableOpacity style={styles.signOutButton} onPress={signOut}>
        <Text style={styles.signOutText}>Sign Out</Text>
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
  header: {
    fontSize: 24,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 20,
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
    fontSize: 16,
    fontWeight: "700",
    color: "#1F2937",
    marginBottom: 12,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  label: {
    color: "#6B7280",
    fontWeight: "600",
  },
  value: {
    color: "#111827",
    fontWeight: "600",
  },
  codeBadge: {
    backgroundColor: "#EEF2FF",
    color: "#3730A3",
    fontWeight: "700",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    letterSpacing: 1,
  },
  emptyText: {
    color: "#6B7280",
    fontStyle: "italic",
  },
  errorText: {
    marginTop: 8,
    color: "#DC2626",
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  loadingText: {
    marginLeft: 8,
    color: "#6B7280",
  },
  helpText: {
    color: "#6B7280",
    marginBottom: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
    letterSpacing: 1,
    color: "#111827",
  },
  button: {
    marginTop: 14,
    backgroundColor: "#2563EB",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  buttonDisabled: {
    backgroundColor: "#93C5FD",
  },
  buttonText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 16,
  },
  signOutButton: {
    backgroundColor: "#EF4444",
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
