// src/screens/ShoppingScreen.js
import { useContext, useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { collection, onSnapshot, orderBy, query, updateDoc, doc } from 'firebase/firestore';
import AppCtx from '../context/AppContext';
import { db } from '../services/firebaseConnected';

export default function ShoppingScreen() {
  const { profile } = useContext(AppCtx);
  const [items, setItems] = useState([]);

  useEffect(() => {
    if (!profile?.currentFridgeId) return;
    const col = collection(db, 'fridges', profile.currentFridgeId, 'shopping');
    const q = query(col, orderBy('createdAt','desc'));
    const unsub = onSnapshot(q, (snap) => {
      const arr = [];
      snap.forEach(d => arr.push({ id:d.id, ...d.data() }));
      setItems(arr);
    });
    return () => unsub();
  }, [profile?.currentFridgeId]);

  const toggleBought = async (id, curr) => {
    await updateDoc(doc(db, 'fridges', profile.currentFridgeId, 'shopping', id), {
      status: curr === 'pending' ? 'bought' : 'pending'
    });
  };

  const renderItem = ({ item }) => (
    <View style={s.item}>
      <View style={{ flex:1 }}>
        <Text style={[s.name, item.status==='bought' && { textDecorationLine:'line-through', color:'#999' }]}>
          {item.name}  x{item.qty}
        </Text>
        <Text style={s.status}>สถานะ: {item.status}</Text>
      </View>
      <TouchableOpacity style={s.smallBtn} onPress={()=>toggleBought(item.id, item.status)}>
        <Text style={s.smallBtnText}>{item.status==='pending' ? 'ทำเครื่องหมายซื้อแล้ว' : 'ยกเลิกซื้อแล้ว'}</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={s.container}>
      <Text style={s.title}>ลิสต์ของที่ต้องซื้อ</Text>
      <FlatList
        data={items}
        keyExtractor={(it)=>it.id}
        renderItem={renderItem}
        contentContainerStyle={{ paddingVertical:12 }}
        ListEmptyComponent={<Text style={{ color:'#666' }}>ยังไม่มีรายการ</Text>}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container:{ flex:1, padding:16 },
  title:{ fontSize:20, fontWeight:'700' },
  item:{ flexDirection:'row', alignItems:'center', borderWidth:1, borderColor:'#eee', borderRadius:10, padding:12, marginTop:10 },
  name:{ fontWeight:'700' },
  status:{ color:'#666', marginTop:4 },
  smallBtn:{ backgroundColor:'#6c5ce7', paddingVertical:8, paddingHorizontal:10, borderRadius:8, marginLeft:8 },
  smallBtnText:{ color:'#fff', fontSize:12, textAlign:'center' },
});
