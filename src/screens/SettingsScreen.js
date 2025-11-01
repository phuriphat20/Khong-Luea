// src/screens/SettingsScreen.js
import { useContext, useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from "react-native";
import AppCtx from "../context/AppContext";
import { db } from "../services/firebaseConnected";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  collection,
  addDoc,
} from "firebase/firestore";

const DEFAULT_FRIDGE_NAME = "My Fridge";

export default function SettingsScreen() {
  const { user, profile, setProfile, signOut } = useContext(AppCtx);
  const [fridgeName, setFridgeName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [joinCode, setJoinCode] = useState("");

  useEffect(() => {
    (async () => {
      if (!profile?.currentFridgeId) {
        setFridgeName("");
        setInviteCode("");
        return;
      }
      const fRef = doc(db, "fridges", profile.currentFridgeId);
      const fSnap = await getDoc(fRef);
      if (fSnap.exists()) {
        const data = fSnap.data();
        setFridgeName((prev) => prev || data.name || "");
        setInviteCode(data.inviteCode || "");
      }
    })();
  }, [profile?.currentFridgeId]);

  const createFridge = async () => {
    try {
      const code = Math.random().toString(36).slice(2, 8).toUpperCase();
      const fRef = await addDoc(collection(db, "fridges"), {
        name: fridgeName || DEFAULT_FRIDGE_NAME,
        ownerUid: user.uid,
        inviteCode: code,
        createdAt: serverTimestamp(),
      });

      await setDoc(doc(db, "fridges", fRef.id, "members", user.uid), {
        role: "owner",
        joinedAt: serverTimestamp(),
      });

      const uRef = doc(db, "users", user.uid);
      await updateDoc(uRef, { currentFridgeId: fRef.id });
      const newProfile = (await getDoc(uRef)).data();
      setProfile(newProfile);
      setInviteCode(code);
      Alert.alert("Fridge created", `Invite code: ${code}`);
    } catch (e) {
      Alert.alert("Could not create fridge", e.message);
    }
  };

  const joinFridge = async () => {
    try {
      Alert.alert(
        "Implement me",
        "Update this flow to look up fridges by invite code and add the current user."
      );
    } catch (e) {
      Alert.alert("Could not join fridge", e.message);
    }
  };

  return (
    <View style={s.container}>
      <Text style={s.title}>Settings</Text>
      <Text style={s.label}>
        User: {profile?.displayName || user?.email || "Unknown"}
      </Text>

      <View style={s.box}>
        <Text style={s.boxTitle}>Current fridge</Text>
        <Text style={s.muted}>
          {profile?.currentFridgeId
            ? `ID: ${profile.currentFridgeId}`
            : "No fridge linked yet"}
        </Text>

        <TextInput
          style={s.input}
          placeholder="Fridge name (when creating)"
          value={fridgeName}
          onChangeText={setFridgeName}
        />
        <TouchableOpacity style={s.btn} onPress={createFridge}>
          <Text style={s.btnText}>Create and link a fridge</Text>
        </TouchableOpacity>

        {inviteCode ? (
          <Text style={s.muted}>
            Invite code for this fridge:{" "}
            <Text style={s.code}>{inviteCode}</Text>
          </Text>
        ) : null}
      </View>

      <View style={s.box}>
        <Text style={s.boxTitle}>Join by invite code</Text>
        <TextInput
          style={s.input}
          placeholder="Invite code, e.g. ABX4F7"
          value={joinCode}
          onChangeText={setJoinCode}
          autoCapitalize="characters"
        />
        <TouchableOpacity
          style={[s.btn, { backgroundColor: "#9b59b6" }]}
          onPress={joinFridge}
        >
          <Text style={s.btnText}>Join fridge</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={[s.btn, { backgroundColor: "#eb5757", marginTop: 12 }]}
        onPress={signOut}
      >
        <Text style={s.btnText}>Sign out</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  title: { fontSize: 20, fontWeight: "700" },
  label: { marginTop: 6, color: "#666" },
  box: {
    borderWidth: 1,
    borderColor: "#eee",
    borderRadius: 12,
    padding: 12,
    marginTop: 16,
  },
  boxTitle: { fontWeight: "700", marginBottom: 8 },
  muted: { color: "#666", marginBottom: 8 },
  code: { fontWeight: "700" },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
  },
  btn: { backgroundColor: "#2d9cdb", padding: 12, borderRadius: 10 },
  btnText: { color: "#fff", textAlign: "center", fontWeight: "700" },
});

