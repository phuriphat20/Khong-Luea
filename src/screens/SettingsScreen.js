import { useEffect, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, Alert } from "react-native";
import { auth, db } from "../services/firebaseConnected";
import {
  doc,
  getDoc,
  updateDoc,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";

function randomCode(len = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(
    { length: len },
    () => chars[Math.floor(Math.random() * chars.length)]
  ).join("");
}

export default function SettingsScreen() {
  const [fridgeId, setFridgeId] = useState("");
  const [inviteCode, setInviteCode] = useState("");

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    getDoc(doc(db, "users", uid)).then((snap) => {
      const fId = snap.data()?.currentFridgeId || "";
      setFridgeId(fId);
    });
  }, []);

  async function createFridge() {
    const uid = auth.currentUser?.uid;
    const newId = `fridge_${uid.slice(0, 6)}_${Date.now()}`;
    const code = randomCode();
    await setDoc(doc(db, "fridges", newId), {
      name: "ตู้เย็นบ้าน",
      ownerUid: uid,
      inviteCode: code,
      createdAt: serverTimestamp(),
    });
    await setDoc(doc(db, "fridges", newId, "members", uid), {
      role: "owner",
      joinedAt: serverTimestamp(),
    });
    await updateDoc(doc(db, "users", uid), { currentFridgeId: newId });
    setFridgeId(newId);
    setInviteCode(code);
    Alert.alert("สร้างตู้เย็นสำเร็จ", `Invite Code: ${code}`);
  }

  async function setCurrentFridge() {
    const uid = auth.currentUser?.uid;
    if (!uid || !fridgeId) return;
    await updateDoc(doc(db, "users", uid), { currentFridgeId: fridgeId });
    Alert.alert("อัปเดตแล้ว", `ตู้เย็นปัจจุบัน: ${fridgeId}`);
  }

  return (
    <View className="flex-1 p-4 bg-white">
      <Text className="text-xl font-bold mb-3">การตั้งค่า</Text>

      <Text className="font-semibold mb-2">ตู้เย็นปัจจุบัน</Text>
      <TextInput
        placeholder="fridgeId"
        value={fridgeId}
        onChangeText={setFridgeId}
        className="border rounded-lg px-3 py-2 mb-2"
      />
      <View className="flex-row gap-2">
        <TouchableOpacity
          onPress={setCurrentFridge}
          className="flex-1 bg-black rounded-xl p-3 items-center"
        >
          <Text className="text-white font-semibold">บันทึก fridgeId</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={createFridge}
          className="flex-1 bg-gray-800 rounded-xl p-3 items-center"
        >
          <Text className="text-white font-semibold">สร้างตู้เย็นใหม่</Text>
        </TouchableOpacity>
      </View>
      <TouchableOpacity
        onPress={() => signOut(auth)}
        className="mt-6 bg-red-600 rounded-xl p-3 items-center"
      >
        <Text className="text-white font-semibold">ออกจากระบบ</Text>
      </TouchableOpacity>

      {!!inviteCode && (
        <View className="mt-4">
          <Text className="font-semibold">Invite Code</Text>
          <Text className="text-xl">{inviteCode}</Text>
        </View>
      )}
    </View>
  );
}
