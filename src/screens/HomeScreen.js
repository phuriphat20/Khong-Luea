// src/screens/HomeScreen.js (เพิ่ม CTA สร้างตู้ + โมดอล)
import { useContext, useEffect, useState } from "react";
import { LinearGradient } from "expo-linear-gradient";
import * as Clipboard from "expo-clipboard";
import { Ionicons } from "@expo/vector-icons";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Modal,
  TextInput,
  Alert,
  Pressable,
} from "react-native";
import AppCtx from "../context/AppContext";
import { auth, db } from "../services/firebaseConnected";
import { writeBatch } from "firebase/firestore";
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  addDoc,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";
import { useNavigation } from "@react-navigation/native";

const THREE_DAYS = 3 * 24 * 3600 * 1000;

export default function HomeScreen() {
  const { user, profile } = useContext(AppCtx);
  const navigation = useNavigation();

  const [loading, setLoading] = useState(true);
  const [fridges, setFridges] = useState([]); // [{id, name, counts:{all, expSoon, low}, memberCount}]

  // ✨ สถานะ/ฟอร์มสำหรับสร้างตู้เย็น
  const [showCreate, setShowCreate] = useState(false);
  const [newFridgeName, setNewFridgeName] = useState("");
// เดิม: useState<"create"|"join">("create")
const [modalMode, setModalMode] = useState("create");

// เดิมถ้ามี generic: useState<string>("")
const [joinCode, setJoinCode] = useState("");

// เดิมถ้ามี generic: useState<boolean>(false)
const [saving, setSaving] = useState(false);

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // ไม่มี O, I, 0, 1
const genCode = (len = 6) => {
  let s = "";
  for (let i = 0; i < len; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
};



const copyCode = async (fid) => {
  await Clipboard.setStringAsync(fid);
  Alert.alert("Copied", "Invite code copied to clipboard.");
};

  // โหลดรายการตู้เย็นทั้งหมดที่เราเป็นสมาชิก
  useEffect(() => {
    if (!user) {
      setFridges([]);
      setLoading(false);
      return;
    }
    setLoading(true);

    // map เก็บ unsubscribe ของ stock แต่ละตู้ เพื่อจัดการตอนสมาชิกเปลี่ยน
    const stockUnsubs = new Map(); // fid -> () => void

    const sortFridgesByCreated = (list) =>
      list
        .slice()
        .sort((a, b) => {
          const aTime = typeof a.createdAt === "number" ? a.createdAt : 0;
          const bTime = typeof b.createdAt === "number" ? b.createdAt : 0;
          if (aTime !== bTime) return aTime - bTime;
          const idA = a.id || "";
          const idB = b.id || "";
          return idA.localeCompare(idB);
        });

    // helper: ดึงข้อมูลตู้ + นับสมาชิก + สมัครฟัง stock
    const attachFridge = async (fid) => {
      // ถ้ามีแล้ว ไม่ต้องซ้ำ
      if (stockUnsubs.has(fid)) return;

      // 1) ดึงข้อมูลตู้
      const fRef = doc(db, "fridges", fid);
      const fSnap = await getDoc(fRef);
      if (!fSnap.exists()) return;
      const fdata = fSnap.data();

      // 2) นับสมาชิก
      const memSnap = await getDocs(collection(db, "fridges", fid, "members"));
      const memberCount = memSnap.size;

      // 3) set state โครงเริ่มต้น
      setFridges((prev) => {
        const idx = prev.findIndex((x) => x.id === fid);
        const createdAt =
          typeof fdata?.createdAt?.toMillis === "function" ? fdata.createdAt.toMillis() : 0;
        const baseRow = {
          id: fid,
          name: fdata.name || "-",
          inviteCode: fdata.inviteCode || "",
          createdAt,
          memberCount,
        };
        if (idx === -1)
          return sortFridgesByCreated([
            ...prev,
            { ...baseRow, counts: { all: 0, expSoon: 0, low: 0 } },
          ]);
        const copy = prev.slice();
        copy[idx] = { ...copy[idx], ...baseRow };
        return sortFridgesByCreated(copy);
      });

      // 4) subscribe stock ของตู้
      const unsub = onSnapshot(
        collection(db, "fridges", fid, "stock"),
        (snap) => {
          const now = Date.now();
          let all = 0,
            expSoon = 0,
            low = 0;
          snap.forEach((d) => {
            const it = d.data();
            all++;
            const expMs = it?.expireDate?.toMillis?.();
            if (expMs && expMs - now <= 3 * 24 * 3600 * 1000) expSoon++;
            if (
              typeof it.qty === "number" &&
              typeof it.lowThreshold === "number" &&
              it.qty <= it.lowThreshold
            )
              low++;
          });
          setFridges((prev) => {
            const idx = prev.findIndex((x) => x.id === fid);
            if (idx === -1) return prev;
            const copy = prev.slice();
            copy[idx] = { ...copy[idx], counts: { all, expSoon, low } };
            return copy;
          });
        },
        (e) => console.warn("stock listener error:", e?.message || e)
      );

      stockUnsubs.set(fid, unsub);
    };

    // helper: เอาตู้ที่ไม่อยู่ในสมาชิกแล้วออก + ปิด listener
    const detachMissing = (currentFids) => {
      // ปิด listener ของตู้ที่หายไป
      for (const [fid, unsub] of stockUnsubs.entries()) {
        if (!currentFids.has(fid)) {
          try {
            unsub && unsub();
          } catch {}
          stockUnsubs.delete(fid);
        }
      }
      // ลบการ์ดที่ไม่อยู่แล้วออกจาก state
      setFridges((prev) => prev.filter((x) => currentFids.has(x.id)));
    };

    // 👇 subscribe รายการสมาชิกแบบ realtime
    const myMapsCol = collection(db, "users", user.uid, "memberships");
    const unsubMembers = onSnapshot(
      myMapsCol,
      async (snap) => {
        const fidSet = new Set();
        const attachJobs = [];
        snap.forEach((d) => {
          const fid = d.data()?.fridgeId || d.id; // เผื่อ doc ไม่มี field
          fidSet.add(fid);
          attachJobs.push(attachFridge(fid));
        });
        await Promise.allSettled(attachJobs);
        detachMissing(fidSet);
        setLoading(false);
      },
      (e) => {
        console.warn("home memberships error:", e?.message || e);
        setLoading(false);
      }
    );

    return () => {
      unsubMembers && unsubMembers();
      for (const [, unsub] of stockUnsubs) {
        try {
          unsub && unsub();
        } catch {}
      }
      stockUnsubs.clear();
    };
  }, [user?.uid]);

  const goToFridge = (fid) => {
    navigation.navigate("FridgeDetail", { fridgeId: fid });
  };

const joinFridgeByCode = async () => {
  if (!user) return Alert.alert("Please sign in first");
  const code = joinCode.trim().toUpperCase();
  if (!code) return Alert.alert("Please enter an invite code");
  if (saving) return;
  setSaving(true);

  try {
    // 1) หา fridgeId จาก code
    const inv = await getDoc(doc(db, "inviteCodes", code));
    if (!inv.exists()) throw new Error("Invite code not found");
    const fid = inv.data().fridgeId;
    if (!fid) throw new Error("Invite code is not linked to a fridge");

    // 2) เขียนสมาชิก/แมปผู้ใช้
    const batch = writeBatch(db);
    batch.set(doc(db, "fridges", fid, "members", user.uid), {
      uid: user.uid,
      role: "member",
      joinedAt: serverTimestamp(),
    });
    batch.set(doc(db, "users", user.uid, "memberships", fid), {
      fridgeId: fid,
      role: "member",
      addedAt: serverTimestamp(),
    });
    await batch.commit();

    setJoinCode("");
    setShowCreate(false);
  } catch (e) {
    Alert.alert("Could not join fridge", e?.message || String(e));
  } finally {
    setSaving(false);
  }
};



const createFridge = async () => {
  if (!user) return Alert.alert("Please sign in first");
  const name = newFridgeName.trim();
  if (!name) return Alert.alert("Please give the fridge a name");
  if (saving) return;
  setSaving(true);

  try {
    const ownerUid = auth.currentUser?.uid || user?.uid;
    if (!ownerUid) throw new Error("Unable to determine current user");
    // 1) หา code ที่ยังไม่ถูกใช้
    let code = "";
    for (let i = 0; i < 5; i++) {
      const cand = genCode(6); // หรือ 7–8 ได้ตามชอบ
      const codeDoc = await getDoc(doc(db, "inviteCodes", cand));
      if (!codeDoc.exists()) { code = cand; break; }
    }
    if (!code) throw new Error("Unable to generate invite code, please try again");

    // 2) เขียนแบบ atomic
    const batch = writeBatch(db);
    const fRef = doc(collection(db, "fridges"));

    batch.set(fRef, {
      name,
      ownerUid: ownerUid,
      inviteCode: code,              // ← เก็บลงตู้ด้วย
      createdAt: serverTimestamp(),
    });

    batch.set(doc(db, "fridges", fRef.id, "members", ownerUid), {
      uid: ownerUid,
      role: "owner",
      joinedAt: serverTimestamp(),
    });

    batch.set(doc(db, "users", ownerUid, "memberships", fRef.id), {
      fridgeId: fRef.id,
      role: "owner",
      addedAt: serverTimestamp(),
    });

    // map code → fid
batch.set(doc(db, "inviteCodes", code), {
  fridgeId: fRef.id,
  createdBy: ownerUid,     // ← ใช้ตรวจสิทธิ์ตาม rules ใหม่
  active: true,
  createdAt: serverTimestamp(),
});


    await batch.commit();
    await setDoc(
      doc(db, "fridges", fRef.id, "members", ownerUid),
      {
        uid: ownerUid,
        role: "owner",
        joinedAt: serverTimestamp(),
      },
      { merge: true }
    );
    setNewFridgeName("");
    setShowCreate(false);
  } catch (e) {
    Alert.alert("Could not create fridge", e?.message || String(e));
  } finally {
    setSaving(false);
  }
};
const renderItem = ({ item }) => {
  const codeToShow =
    item?.inviteCode
      ? item.inviteCode
      : ((item?.id || "").slice(0, 6).toUpperCase() + (item?.id?.length > 6 ? "…" : ""));

  return (
    <Pressable
      android_ripple={{ color: "#e9eefc" }}
      onPress={() => goToFridge(item.id)}
      style={{ marginBottom: 16 }}
    >
      <View style={s.cardWrap}>
        <LinearGradient colors={["#ffffff", "#f9fbff"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.card}>
          <View style={s.cardHeader}>
            <Text numberOfLines={1} style={s.cardTitle}>{item?.name ?? "-"}</Text>
            <View style={s.memberPill}>
              <Ionicons name="people-outline" size={14} color="#3563E9" />
              <Text style={s.memberText}>Members {item?.memberCount ?? 0}</Text>
            </View>
          </View>

          {/* invite code + copy */}
          <View style={{ marginTop: 8, flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={s.codePill}>
              <Text style={s.codeMono}>Invite code: {codeToShow}</Text>
            </View>
            <Pressable
              onPress={() => copyCode(item.id)}
              android_ripple={{ color: "#e1e9ff", borderless: true }}
              style={s.copyBtn}
            >
              <Ionicons name="copy-outline" size={16} color="#3563E9" />
              <Text style={s.copyTxt}>Copy</Text>
            </Pressable>
          </View>

          {/* สถิติ */}
          <View style={s.statsRow}>
            <View style={s.statBox}>
              <Text style={s.statNum}>{item?.counts?.all ?? 0}</Text>
              <Text style={s.statLabel}>Items</Text>
            </View>
            <View style={s.sep} />
            <View style={s.statBox}>
              <Text style={[s.statNum, { color: "#E98B2A" }]}>{item?.counts?.expSoon ?? 0}</Text>
              <Text style={s.statLabel}>Expiring soon</Text>
            </View>
            <View style={s.sep} />
            <View style={s.statBox}>
              <Text style={[s.statNum, { color: "#D6455D" }]}>{item?.counts?.low ?? 0}</Text>
              <Text style={s.statLabel}>Low stock</Text>
            </View>
          </View>
        </LinearGradient>
      </View>
    </Pressable>
  );
};



  // การ์ดว่าง + ปุ่มเพิ่มตู้ (เฉพาะตอนยังไม่มีตู้)
const EmptyAddCard = () => (
  <Pressable onPress={() => setShowCreate(true)} android_ripple={{ color: "#e6eefc" }}>
    <LinearGradient
      colors={["#f4f8ff", "#f8fbff"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={s.emptyAdd}
    >
      <View style={s.emptyIconWrap}>
        <Ionicons name="add" size={28} color="#2D5BFF" />
      </View>
      <Text style={s.emptyTitle}>Add your first fridge</Text>
      <Text style={s.emptySub}>Tap to create a fridge and invite others</Text>
    </LinearGradient>
  </Pressable>
);


  const hasFridge = fridges.length > 0;

  return (
    <View style={s.container}>
      <Text style={s.hi}>Hi {profile?.displayName || user?.email}</Text>
      <Text style={s.section}>Your fridges</Text>

      {loading ? (
        <View style={{ paddingVertical: 16 }}>
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          data={fridges}
          keyExtractor={(it) => it.id}
          renderItem={renderItem}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          ListEmptyComponent={<EmptyAddCard />}
          contentContainerStyle={{ paddingVertical: 12 }}
        />
      )}

      {/* ปุ่ม + มุมขวาบน: โชว์เฉพาะเมื่อมีตู้แล้วอย่างน้อย 1 */}
      {hasFridge && (
        <TouchableOpacity
          style={s.fab}
          onPress={() => setShowCreate(true)}
        >
        <Ionicons name="add" size={26} color="#fff" />
        </TouchableOpacity>
      )}

      {/* โมดอลสร้างตู้ */}
      <Modal
        visible={showCreate}
        animationType="slide"
        onRequestClose={() => setShowCreate(false)}
      >
        <View style={{ flex: 1, padding: 16 }}>
          <Text style={s.modalTitle}>Create a new fridge</Text>
          <TextInput
            style={s.input}
            placeholder="Fridge name (e.g. Kitchen, Dorm)"
            value={newFridgeName}
            onChangeText={setNewFridgeName}
          />
          <TouchableOpacity
            style={[s.btn, { marginTop: 10, opacity: saving ? 0.6 : 1 }]}
            onPress={createFridge}
            disabled={saving}
          >
            <Text style={s.btnText}>
              {saving ? "Saving..." : "Save"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.btn, { backgroundColor: "#999", marginTop: 8 }]}
            onPress={() => setShowCreate(false)}
          >
            <Text style={s.btnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: "#F7F8FA" },
  hi: { fontSize: 22, fontWeight: "800", marginBottom: 6, color: "#0B132B" },
  section: { color: "#6B7280" },

  // ===== Card =====
    cardWrap: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 5,
    borderRadius: 20,
    overflow: "hidden",
    marginBottom: 16,     // เพิ่มระยะห่างระหว่างกล่อง
  },

  // พื้นหลังการ์ด
  card: {
    borderRadius: 20,
    paddingVertical: 18,  // 🔹เพิ่มความสูงในแนวตั้ง
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    minHeight: 130,       // 🔹บังคับความสูงขั้นต่ำ
    justifyContent: "space-between",
  },

  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },

  cardTitle: { fontWeight: "800", fontSize: 18, color: "#0B132B", maxWidth: "70%" },

  memberPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#EEF4FF",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  memberText: { color: "#3563E9", fontWeight: "700", fontSize: 12 },

  // 🔹 รหัสเชิญ
  codePill: {
    backgroundColor: "#F1F5FF",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    alignSelf: "flex-start",
  },
  codeMono: { fontFamily: "monospace", color: "#1F2A5C", fontSize: 13 },

  copyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#EEF4FF",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  copyTxt: { color: "#3563E9", fontWeight: "700", fontSize: 12 },

  // 🔹 แถวสถิติ — แยกออกมาให้ไม่อัดแน่น
  statsRow: {
    marginTop: 14,
    flexDirection: "row",
    justifyContent: "space-around",
  },
  statBox: { alignItems: "center", flex: 1 },
  statNum: { fontSize: 26, fontWeight: "900", color: "#111827" },
  statLabel: { color: "#6B7280", marginTop: 2, fontSize: 12 },
  sep: { width: 1, height: 30, backgroundColor: "#EDF2FF" },

  // ===== Empty state =====
  emptyAdd: {
    height: 170,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: "#CFE0FF",
    borderRadius: 18,
    marginHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#EAF1FF",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  emptyTitle: { fontSize: 16, fontWeight: "800", color: "#2D5BFF" },
  emptySub: { color: "#6B7280", marginTop: 4 },

  // ===== FAB =====
  fab: {
    position: "absolute",
    right: 18,
    top: 10,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2D5BFF",
    elevation: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
  },

  // ===== Modal / Form เดิมคงไว้ เพิ่มระยะห่างนิดหน่อย =====
  modalTitle: { fontSize: 20, fontWeight: "800", color: "#0B132B" },
  input: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 12,
    padding: 12,
    marginTop: 12,
    backgroundColor: "#fff",
  },
  btn: {
    backgroundColor: "#2D5BFF",
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  btnText: { color: "#fff", fontWeight: "800" },
  codePill: {
  backgroundColor: "#F1F5FF",
  paddingHorizontal: 10,
  paddingVertical: 6,
  borderRadius: 10,
},
codeMono: { fontFamily: "monospace", color: "#1F2A5C", fontSize: 12 },
copyBtn: {
  flexDirection: "row",
  alignItems: "center",
  gap: 6,
  backgroundColor: "#EEF4FF",
  paddingHorizontal: 10,
  paddingVertical: 6,
  borderRadius: 10,
},
copyTxt: { color: "#3563E9", fontWeight: "700", fontSize: 12 },

});
