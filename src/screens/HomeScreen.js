import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, FlatList } from 'react-native';
import { auth, db } from '../services/firebaseConnected';
import { collection, onSnapshot, query, where, getDoc, doc } from 'firebase/firestore';
import { fmt, isExpired, isNearExpire } from '../utils/date';

export default function HomeScreen({ navigation }) {
  const [fridgeId, setFridgeId] = useState(null);
  const [items, setItems] = useState([]);

  // ดึง currentFridgeId จาก users/{uid}
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const ref = doc(db, 'users', uid);
    getDoc(ref).then((snap) => {
      const fId = snap.data()?.currentFridgeId;
      setFridgeId(fId || 'demo-fridge'); // กันพัง ถ้ายังไม่ตั้ง
    });
  }, []);

  // subscribe stock ของตู้เย็นนี้
  useEffect(() => {
    if (!fridgeId) return;
    const q = collection(db, 'fridges', fridgeId, 'stock');
    const unsub = onSnapshot(q, (snap) => {
      const rows = [];
      snap.forEach((d) => rows.push({ id: d.id, ...d.data() }));
      setItems(rows);
    });
    return () => unsub();
  }, [fridgeId]);

  const danger = items.filter((i) => isExpired(i.expireDate));
  const warning = items.filter((i) => !isExpired(i.expireDate) && isNearExpire(i.expireDate, 3));

  return (
    <View className="flex-1 p-4 bg-white">
      <Text className="text-xl font-bold mb-2">สรุปตู้เย็น</Text>

      <View className="mb-4">
        <Text className="font-semibold">หมดอายุ ({danger.length})</Text>
        <FlatList
          data={danger}
          keyExtractor={(it) => it.id}
          renderItem={({ item }) => (
            <Text className="text-red-600">• {item.name} (หมด {fmt(item.expireDate)})</Text>
          )}
        />
      </View>

      <View className="mb-6">
        <Text className="font-semibold">ใกล้หมดอายุ ({warning.length})</Text>
        <FlatList
          data={warning}
          keyExtractor={(it) => it.id}
          renderItem={({ item }) => (
            <Text className="text-orange-600">• {item.name} (จะหมด {fmt(item.expireDate)})</Text>
          )}
        />
      </View>

      <TouchableOpacity
        onPress={() => navigation.navigate('Stock')}
        className="bg-black rounded-xl p-4 items-center"
      >
        <Text className="text-white font-semibold">ไปจัดการสต็อก</Text>
      </TouchableOpacity>
    </View>
  );
}
