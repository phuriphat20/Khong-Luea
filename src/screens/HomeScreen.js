// src/screens/HomeScreen.js
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
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  getDocs,
  where,
  writeBatch,
} from "firebase/firestore";

export default function HomeScreen() {
  const { user, profile, setProfile } = useContext(AppCtx);
  const [expiringSoon, setExpiringSoon] = useState(0);
  const [lowCount, setLowCount] = useState(0);
  const [fridgeName, setFridgeName] = useState("");
  const [joinCode, setJoinCode] = useState("");

  // ดึงชื่อและสรุปสต็อกเมื่อมีตู้
  useEffect(() => {
    let unsub;
    (async () => {
      if (!profile?.currentFridgeId) return;

      const fRef = doc(db, "fridges", profile.currentFridgeId);
      const fSnap = await getDoc(fRef);
      if (fSnap.exists())
        setFridgeName((prev) => prev || fSnap.data().name || "");

      const col = collection(db, "fridges", profile.currentFridgeId, "stock");
      const q = query(col, orderBy("updatedAt", "desc"));
      unsub = onSnapshot(q, (snap) => {
        const now = Date.now();
        let exp = 0,
          low = 0;
        snap.forEach((d) => {
          const it = d.data();
          const expMs = it?.expireDate?.toMillis?.();
          if (expMs && expMs - now <= 3 * 24 * 3600 * 1000) exp++;
          if (
            typeof it.qty === "number" &&
            typeof it.lowThreshold === "number" &&
            it.qty <= it.lowThreshold
          )
            low++;
        });
        setExpiringSoon(exp);
        setLowCount(low);
      });
    })();
    return () => unsub && unsub();
  }, [profile?.currentFridgeId]);

  // สร้างตู้เย็น + ผูกผู้ใช้ (ทำแบบ atomic ด้วย batch)
  const createFridge = async () => {
    try {
      const code = Math.random().toString(36).slice(2, 8).toUpperCase();
      const batch = writeBatch(db);
      const fridgesCol = collection(db, "fridges");
      const fRef = doc(fridgesCol); // เตรียม id ใหม่
      batch.set(fRef, {
        name: fridgeName?.trim() || "ตู้เย็นบ้าน",
        ownerUid: user.uid,
        inviteCode: code,
        createdAt: serverTimestamp(),
      });
      // members/{uid}
      const mRef = doc(db, "fridges", fRef.id, "members", user.uid);
      batch.set(mRef, { role: "owner", joinedAt: serverTimestamp() });
      // users/{uid}.currentFridgeId
      const uRef = doc(db, "users", user.uid);
      batch.update(uRef, { currentFridgeId: fRef.id });

      await batch.commit();

      // อัปเดตโปรไฟล์ในแอป
      const snap = await getDoc(uRef);
      setProfile(snap.data());
      Alert.alert("สำเร็จ", `สร้างตู้เย็นแล้ว\nรหัสเชิญ: ${code}`);
    } catch (e) {
      Alert.alert("ไม่สำเร็จ", e.message);
    }
  };

  // เข้าร่วมด้วยรหัสเชิญ
  const joinFridge = async () => {
    const code = (joinCode || "").trim().toUpperCase();
    if (!code) return Alert.alert("กรอกรหัสเชิญก่อน");
    try {
      // ควรสร้าง index: fridges (inviteCode ASC)
      const q = query(
        collection(db, "fridges"),
        where("inviteCode", "==", code)
      );
      const qs = await getDocs(q);
      if (qs.empty)
        return Alert.alert("ไม่พบตู้เย็น", "ตรวจสอบรหัสเชิญอีกครั้ง");

      const fDoc = qs.docs[0];
      const fid = fDoc.id;

      const batch = writeBatch(db);
      // เพิ่มเป็นสมาชิก
      batch.set(doc(db, "fridges", fid, "members", user.uid), {
        role: "member",
        joinedAt: serverTimestamp(),
      });
      // ผูก currentFridgeId
      batch.update(doc(db, "users", user.uid), { currentFridgeId: fid });
      await batch.commit();

      const uRef = doc(db, "users", user.uid);
      const snap = await getDoc(uRef);
      setProfile(snap.data());

      Alert.alert("เข้าร่วมสำเร็จ", `เข้าร่วมตู้เย็นแล้ว`);
    } catch (e) {
      Alert.alert("ไม่สำเร็จ", e.message);
    }
  };

  // ถ้ายังไม่มีตู้เย็น ⇒ โชว์ CTA การ์ด
  if (!profile?.currentFridgeId) {
    return (
      <View style={s.container}>
        <Text style={s.hi}>สวัสดี {profile?.displayName || user?.email}</Text>
        <View style={s.emptyBox}>
          <Text style={s.boxTitle}>ยังไม่ได้ผูกตู้เย็น</Text>

          <Text style={s.label}>ชื่อตู้เย็น (ตอนสร้างใหม่)</Text>
          <TextInput
            style={s.input}
            placeholder="เช่น ตู้เย็นบ้าน, คอนโด, ออฟฟิศ"
            value={fridgeName}
            onChangeText={setFridgeName}
          />
          <TouchableOpacity style={s.btnPrimary} onPress={createFridge}>
            <Text style={s.btnText}>สร้างตู้เย็นใหม่ + ผูกให้ฉัน</Text>
          </TouchableOpacity>

          <View style={{ height: 16 }} />

          <Text style={s.label}>เข้าร่วมด้วยรหัสเชิญ</Text>
          <TextInput
            style={s.input}
            placeholder="รหัสเชิญ เช่น ABX4F7"
            value={joinCode}
            onChangeText={setJoinCode}
            autoCapitalize="characters"
          />
          <TouchableOpacity style={s.btnSecondary} onPress={joinFridge}>
            <Text style={s.btnText}>เข้าร่วม</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // มีตู้แล้ว ⇒ โชว์สรุป
  return (
    <View style={s.container}>
      <Text style={s.hi}>สวัสดี {profile?.displayName || user?.email}</Text>
      <Text style={s.fridge}>ตู้เย็น: {fridgeName || "-"}</Text>

      <View style={s.cards}>
        <View style={s.card}>
          <Text style={s.cardTitle}>ใกล้หมดอายุ (≤3วัน)</Text>
          <Text style={s.cardNum}>{expiringSoon}</Text>
        </View>
        <View style={s.card}>
          <Text style={s.cardTitle}>ใกล้หมดสต็อก</Text>
          <Text style={s.cardNum}>{lowCount}</Text>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  hi: { fontSize: 20, fontWeight: "700" },
  fridge: { marginTop: 4, color: "#666" },

  emptyBox: {
    borderWidth: 1,
    borderColor: "#eee",
    borderRadius: 12,
    padding: 16,
    marginTop: 16,
  },
  boxTitle: { fontWeight: "700", marginBottom: 10 },
  label: { marginTop: 8, marginBottom: 4, color: "#444" },
  input: { borderWidth: 1, borderColor: "#ddd", borderRadius: 10, padding: 10 },

  btnPrimary: {
    backgroundColor: "#2d9cdb",
    padding: 12,
    borderRadius: 10,
    marginTop: 10,
  },
  btnSecondary: {
    backgroundColor: "#9b59b6",
    padding: 12,
    borderRadius: 10,
    marginTop: 10,
  },
  btnText: { color: "#fff", textAlign: "center", fontWeight: "700" },

  cards: { flexDirection: "row", gap: 12, marginTop: 16 },
  card: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#eee",
    borderRadius: 12,
    padding: 16,
  },
  cardTitle: { color: "#444", marginBottom: 6 },
  cardNum: { fontSize: 28, fontWeight: "800" },
});
