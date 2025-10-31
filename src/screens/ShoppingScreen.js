import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, FlatList } from 'react-native';
import { auth, db } from '../services/firebaseConnected';
import {
  collection, onSnapshot, query, addDoc, serverTimestamp, doc, updateDoc
} from 'firebase/firestore';
import { isExpired } from '../utils/date';

export default function ShoppingScreen() {
  const [fridgeId, setFridgeId] = useState(null);
  const [stock, setStock] = useState([]);
  const [shopping, setShopping] = useState([]);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    // ดึง currentFridgeId
    import('firebase/firestore').then(({ getDoc, doc }) => {
      getDoc(doc(db, 'users', uid)).then((snap) => {
        setFridgeId(snap.data()?.currentFridgeId || 'demo-fridge');
      });
    });
  }, []);

  useEffect(() => {
    if (!fridgeId) return;
    const sCol = collection(db, 'fridges', fridgeId, 'stock');
    const unsub1 = onSnapshot(sCol, (snap) => {
      const rows = [];
      snap.forEach((d) => rows.push({ id: d.id, ...d.data() }));
      setStock(rows);
    });

    const shCol = collection(db, 'fridges', fridgeId, 'shopping');
    const unsub2 = onSnapshot(shCol, (snap) => {
      const rows = [];
      snap.forEach((d) => rows.push({ id: d.id, ...d.data() }));
      setShopping(rows);
    });

    return () => { unsub1(); unsub2(); };
  }, [fridgeId]);

  // ของที่ควรเข้าลิสต์: qty <= lowThreshold หรือหมดอายุ
  const shouldBuy = stock.filter((i) => (i.qty ?? 0) <= (i.lowThreshold ?? 1) || isExpired(i.expireDate));

  async function addToShopping(item) {
    const col = collection(db, 'fridges', fridgeId, 'shopping');
    await addDoc(col, {
      name: item.name,
      qty: Math.max(1, (item.lowThreshold ?? 1) - (item.qty ?? 0) + 1),
      status: 'pending',
      sourceStockId: item.id,
      createdAt: serverTimestamp(),
    });
  }

  async function markBought(row) {
    await updateDoc(doc(db, 'fridges', fridgeId, 'shopping', row.id), {
      status: row.status === 'bought' ? 'pending' : 'bought',
      boughtAt: serverTimestamp(),
    });
  }

  return (
    <View className="flex-1 p-4 bg-white">
      <Text className="text-xl font-bold mb-3">ลิสต์ของต้องซื้อ</Text>

      <Text className="font-semibold mb-2">แนะนำให้เพิ่ม ({shouldBuy.length})</Text>
      <FlatList
        data={shouldBuy}
        keyExtractor={(it) => 'sug-' + it.id}
        ItemSeparatorComponent={() => <View style={{ height: 6 }} />}
        renderItem={({ item }) => (
          <View className="border rounded-xl p-3 flex-row justify-between items-center">
            <View>
              <Text className="font-semibold">{item.name}</Text>
              <Text className="text-gray-600">คงเหลือ {item.qty} / เกณฑ์ {item.lowThreshold ?? 1}</Text>
            </View>
            <TouchableOpacity onPress={() => addToShopping(item)}>
              <Text className="text-blue-600 font-semibold">เพิ่ม</Text>
            </TouchableOpacity>
          </View>
        )}
      />

      <Text className="font-semibold mt-6 mb-2">รายการของที่จะซื้อจริง ({shopping.length})</Text>
      <FlatList
        data={shopping}
        keyExtractor={(it) => it.id}
        ItemSeparatorComponent={() => <View style={{ height: 6 }} />}
        renderItem={({ item }) => (
          <View className="border rounded-xl p-3 flex-row justify-between items-center">
            <View>
              <Text className="font-semibold">{item.name}</Text>
              <Text className="text-gray-600">จำนวน {item.qty}</Text>
            </View>
            <TouchableOpacity onPress={() => markBought(item)}>
              <Text className={item.status === 'bought' ? 'text-green-700 font-semibold' : 'text-gray-800 font-semibold'}>
                {item.status === 'bought' ? '✓ ซื้อแล้ว' : 'ยังไม่ซื้อ'}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      />
    </View>
  );
}
