import { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, Alert, Platform } from 'react-native';
import { auth, db } from '../services/firebaseConnected';
import {
  addDoc, collection, deleteDoc, doc, onSnapshot, serverTimestamp, getDoc
} from 'firebase/firestore';
import { fmt } from '../utils/date';

// ✅ ใช้ API ใหม่ของ expo-camera
import { CameraView, useCameraPermissions } from 'expo-camera';

export default function StockScreen() {
  const [fridgeId, setFridgeId] = useState(null);
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ name: '', qty: '1', unit: 'ชิ้น', expireDate: '' });

  // ✅ ขอสิทธิ์กล้องด้วยฮุคที่ import แยก (ไม่ใช่ Camera.useCameraPermissions())
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const lockScan = useRef(false); // กันยิง onBarcodeScanned ซ้ำ

  // ขอสิทธิ์กล้องครั้งแรก
  useEffect(() => {
    (async () => {
      if (Platform.OS === 'web') return;
      if (!permission?.granted) {
        await requestPermission();
      }
    })();
  }, [permission?.granted]);

  // โหลด fridgeId จาก users/{uid}
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    getDoc(doc(db, 'users', uid)).then((snap) => {
      setFridgeId(snap.data()?.currentFridgeId || 'demo-fridge');
    });
  }, []);

  // subscribe stock
  useEffect(() => {
    if (!fridgeId) return;
    const colRef = collection(db, 'fridges', fridgeId, 'stock');
    const unsub = onSnapshot(colRef, (snap) => {
      const rows = [];
      snap.forEach((d) => rows.push({ id: d.id, ...d.data() }));
      rows.sort((a, b) => (a.expireDate?.seconds ?? 0) - (b.expireDate?.seconds ?? 0));
      setItems(rows);
    });
    return () => unsub();
  }, [fridgeId]);

  async function handleAdd() {
    if (!form.name.trim()) return Alert.alert('กรอกชื่อของก่อน');
    const colRef = collection(db, 'fridges', fridgeId, 'stock');
    await addDoc(colRef, {
      name: form.name.trim(),
      qty: Number(form.qty || 1),
      unit: form.unit || 'ชิ้น',
      expireDate: form.expireDate ? new Date(form.expireDate) : null,
      lowThreshold: 1,
      updatedAt: serverTimestamp(),
    });
    setForm({ name: '', qty: '1', unit: 'ชิ้น', expireDate: '' });
  }

  async function handleDelete(id) {
    await deleteDoc(doc(db, 'fridges', fridgeId, 'stock', id));
  }

  // เติมชื่อจาก /barcodes/{code}
  async function onScan(code) {
    try {
      const ref = doc(db, 'barcodes', code);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const b = snap.data();
        setForm((f) => ({ ...f, name: b.name || f.name, unit: b.unitDefault || f.unit }));
      } else {
        Alert.alert('ไม่พบบาร์โค้ดในฐานข้อมูล', 'พิมพ์ชื่อแล้วเพิ่มได้เลย');
      }
    } finally {
      // ปลดล็อกให้สแกนได้อีกครั้ง
      setTimeout(() => { lockScan.current = false; }, 300);
    }
  }

  // กันกรณี Web (ไม่รองรับสแกนบาร์โค้ดบน Expo Web)
  if (Platform.OS === 'web') {
    return (
      <View className="flex-1 p-4 bg-white">
        <Text className="text-xl font-bold mb-3">สต็อกตู้เย็น</Text>
        <Text className="mb-2">โหมดสแกนบาร์โค้ดยังไม่รองรับบนเว็บ</Text>

        {/* --- ฟอร์มเพิ่ม --- */}
        <View className="mb-3">
          <TextInput
            placeholder="ชื่อของ (เช่น นมสด)"
            value={form.name}
            onChangeText={(t) => setForm((f) => ({ ...f, name: t }))}
            className="border rounded-lg px-3 py-2 mb-2"
          />
          <View className="flex-row gap-2">
            <TextInput
              placeholder="จำนวน"
              keyboardType="numeric"
              value={form.qty}
              onChangeText={(t) => setForm((f) => ({ ...f, qty: t }))}
              className="flex-1 border rounded-lg px-3 py-2 mb-2"
            />
            <TextInput
              placeholder="หน่วย (เช่น ขวด)"
              value={form.unit}
              onChangeText={(t) => setForm((f) => ({ ...f, unit: t }))}
              className="flex-1 border rounded-lg px-3 py-2 mb-2"
            />
          </View>
          <TextInput
            placeholder="วันหมดอายุ (YYYY-MM-DD)"
            value={form.expireDate}
            onChangeText={(t) => setForm((f) => ({ ...f, expireDate: t }))}
            className="border rounded-lg px-3 py-2 mb-2"
          />
          <View className="flex-row gap-2">
            <TouchableOpacity onPress={handleAdd} className="flex-1 bg-black rounded-xl p-3 items-center">
              <Text className="text-white font-semibold">เพิ่มเข้าสต็อก</Text>
            </TouchableOpacity>
            <TouchableOpacity disabled className="flex-1 bg-gray-400 rounded-xl p-3 items-center">
              <Text className="text-white font-semibold">สแกนบาร์โค้ด (ไม่รองรับบนเว็บ)</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* --- รายการ --- */}
        <FlatList
          data={items}
          keyExtractor={(it) => it.id}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          renderItem={({ item }) => (
            <View className="border rounded-xl p-3 flex-row justify-between items-center">
              <View>
                <Text className="font-semibold">{item.name}</Text>
                <Text className="text-gray-600">
                  {item.qty} {item.unit} • หมดอายุ: {fmt(item.expireDate)}
                </Text>
              </View>
              <TouchableOpacity onPress={() => handleDelete(item.id)}>
                <Text className="text-red-600 font-semibold">ลบ</Text>
              </TouchableOpacity>
            </View>
          )}
        />
      </View>
    );
  }

  const hasPermission = permission?.granted === true;

  return (
    <View className="flex-1 p-4 bg-white">
      <Text className="text-xl font-bold mb-3">สต็อกตู้เย็น</Text>

      {/* ฟอร์มเพิ่ม */}
      <View className="mb-3">
        <TextInput
          placeholder="ชื่อของ (เช่น นมสด)"
          value={form.name}
          onChangeText={(t) => setForm((f) => ({ ...f, name: t }))}
          className="border rounded-lg px-3 py-2 mb-2"
        />
        <View className="flex-row gap-2">
          <TextInput
            placeholder="จำนวน"
            keyboardType="numeric"
            value={form.qty}
            onChangeText={(t) => setForm((f) => ({ ...f, qty: t }))}
            className="flex-1 border rounded-lg px-3 py-2 mb-2"
          />
          <TextInput
            placeholder="หน่วย (เช่น ขวด)"
            value={form.unit}
            onChangeText={(t) => setForm((f) => ({ ...f, unit: t }))}
            className="flex-1 border rounded-lg px-3 py-2 mb-2"
          />
        </View>
        <TextInput
          placeholder="วันหมดอายุ (YYYY-MM-DD)"
          value={form.expireDate}
          onChangeText={(t) => setForm((f) => ({ ...f, expireDate: t }))}
          className="border rounded-lg px-3 py-2 mb-2"
        />
        <View className="flex-row gap-2">
          <TouchableOpacity onPress={handleAdd} className="flex-1 bg-black rounded-xl p-3 items-center">
            <Text className="text-white font-semibold">เพิ่มเข้าสต็อก</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => {
              if (!hasPermission) return Alert.alert('ต้องการสิทธิ์ใช้กล้อง', 'กรุณาอนุญาตกล้องก่อน');
              lockScan.current = false;
              setScanning(true);
            }}
            className="flex-1 bg-gray-800 rounded-xl p-3 items-center"
          >
            <Text className="text-white font-semibold">สแกนบาร์โค้ด</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* รายการ */}
      <FlatList
        data={items}
        keyExtractor={(it) => it.id}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        renderItem={({ item }) => (
          <View className="border rounded-xl p-3 flex-row justify-between items-center">
            <View>
              <Text className="font-semibold">{item.name}</Text>
              <Text className="text-gray-600">
                {item.qty} {item.unit} • หมดอายุ: {fmt(item.expireDate)}
              </Text>
            </View>
            <TouchableOpacity onPress={() => handleDelete(item.id)}>
              <Text className="text-red-600 font-semibold">ลบ</Text>
            </TouchableOpacity>
          </View>
        )}
      />

      {/* โหมดสแกนเต็มจอด้วย CameraView */}
      {scanning && hasPermission && (
        <View style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.9)' }}>
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            // ✅ สแกนบาร์โค้ด (API ใหม่)
            onBarcodeScanned={({ data /*, type */ }) => {
              if (lockScan.current) return;
              lockScan.current = true;
              setScanning(false);
              onScan(data);
            }}
            barcodeScannerSettings={{
              // ประเภทบาร์โค้ดที่รองรับ
              barcodeTypes: ['ean13', 'ean8', 'upc_e', 'code128', 'qr'],
            }}
          />
          <TouchableOpacity
            onPress={() => setScanning(false)}
            style={{ position: 'absolute', bottom: 32, alignSelf: 'center', backgroundColor: 'white', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12 }}
          >
            <Text style={{ fontWeight: '600' }}>ปิดสแกน</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}
