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
import { auth, db } from "../services/firebaseConnected";
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  updateDoc,
  collection,
  addDoc,
} from "firebase/firestore";

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
        const d = fSnap.data();
        setFridgeName(prev => prev || d.name || '');
        setInviteCode(d.inviteCode || "");
      }
    })();
  }, [profile?.currentFridgeId]);

  const createFridge = async () => {
    try {
      const code = Math.random().toString(36).slice(2, 8).toUpperCase();
      const fRef = await addDoc(collection(db, "fridges"), {
        name: fridgeName || "ตู้เย็นบ้าน",
        ownerUid: user.uid,
        inviteCode: code,
        createdAt: serverTimestamp(),
      });
      // เพิ่ม members/{uid}
      await setDoc(doc(db, "fridges", fRef.id, "members", user.uid), {
        role: "owner",
        joinedAt: serverTimestamp(),
      });
      // set users/{uid}.currentFridgeId
      const uRef = doc(db, "users", user.uid);
      await updateDoc(uRef, { currentFridgeId: fRef.id });
      const newProfile = (await getDoc(uRef)).data();
      setProfile(newProfile);
      Alert.alert("สร้างตู้เย็นสำเร็จ", `รหัสเชิญ: ${code}`);
    } catch (e) {
      Alert.alert("ไม่สำเร็จ", e.message);
    }
  };

  const joinFridge = async () => {
    try {
      // หา fridge จาก inviteCode (ตัวอย่างแบบง่าย: ดึงทั้งหมดแล้วกรอง ควรทำด้วย query index ในโปรดักชัน)
      // เพื่อความสั้น จะสาธิตแบบใช้ getDoc ถ้ารู้ ID หรือให้ user วาง ID ตรง ๆ
      // ที่นี่เราจะลองใช้ input เป็น inviteCode -> dev จริงควร query collection ด้วย where('inviteCode','==',joinCode)
      Alert.alert(
        "แนวทาง",
        "โปรดปรับเป็น query Firestore ด้วย where(inviteCode == joinCode) ในโปรดักชัน"
      );
    } catch (e) {
      Alert.alert("ไม่สำเร็จ", e.message);
    }
  };

  return (
    <View style={s.container}>
      <Text style={s.title}>ตั้งค่า</Text>
      <Text style={s.label}>ผู้ใช้: {profile?.displayName || user?.email}</Text>

      <View style={s.box}>
        <Text style={s.boxTitle}>ตู้เย็นปัจจุบัน</Text>
        <Text style={{ color: "#666", marginBottom: 8 }}>
          {profile?.currentFridgeId
            ? `ID: ${profile.currentFridgeId}`
            : "ยังไม่ผูกตู้เย็น"}
        </Text>

        <TextInput
          style={s.input}
          placeholder="ชื่อตู้เย็น (ตอนสร้างใหม่)"
          value={fridgeName}
          onChangeText={setFridgeName}
        />
        <TouchableOpacity style={s.btn} onPress={createFridge}>
          <Text style={s.btnText}>สร้างตู้เย็นใหม่ + ผูกให้ฉัน</Text>
        </TouchableOpacity>

        {inviteCode ? (
          <Text style={{ marginTop: 8 }}>
            รหัสเชิญของตู้เย็นนี้:{" "}
            <Text style={{ fontWeight: "700" }}>{inviteCode}</Text>
          </Text>
        ) : null}
      </View>

      <View style={s.box}>
        <Text style={s.boxTitle}>เข้าร่วมตู้เย็นด้วยรหัสเชิญ</Text>
        <TextInput
          style={s.input}
          placeholder="ใส่รหัสเชิญ เช่น ABX4F7"
          value={joinCode}
          onChangeText={setJoinCode}
          autoCapitalize="characters"
        />
        <TouchableOpacity
          style={[s.btn, { backgroundColor: "#9b59b6" }]}
          onPress={joinFridge}
        >
          <Text style={s.btnText}>เข้าร่วม</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={[s.btn, { backgroundColor: "#eb5757", marginTop: 12 }]}
        onPress={signOut}
      >
        <Text style={s.btnText}>ออกจากระบบ</Text>
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
