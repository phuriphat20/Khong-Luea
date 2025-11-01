// src/screens/StockScreen.js
import { useContext, useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, Alert } from 'react-native';
import AppCtx from '../context/AppContext';
import { db } from '../services/firebaseConnected';
import { addDoc, collection, onSnapshot, orderBy, query, serverTimestamp, Timestamp } from 'firebase/firestore';

export default function StockScreen() {
  const { profile } = useContext(AppCtx);
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ name:'', qty:'1', unit:'ชิ้น', expireDate:'' });

  useEffect(() => {
    if (!profile?.currentFridgeId) return;
    const col = collection(db, 'fridges', profile.currentFridgeId, 'stock');
    const q = query(col, orderBy('updatedAt','desc'));
    const unsub = onSnapshot(q, (snap) => {
      const arr = [];
      snap.forEach(d => arr.push({ id:d.id, ...d.data() }));
      setItems(arr);
    });
    return () => unsub();
  }, [profile?.currentFridgeId]);

  const addItem = async () => {
    if (!profile?.currentFridgeId) return Alert.alert('ยังไม่ผูกตู้เย็น');
    if (!form.name.trim()) return Alert.alert('กรอกชื่อสินค้า');

    const exp = form.expireDate ? Timestamp.fromDate(new Date(form.expireDate)) : null;
    try {
      await addDoc(collection(db, 'fridges', profile.currentFridgeId, 'stock'), {
        name: form.name.trim(),
        qty: Number(form.qty) || 1,
        unit: form.unit || 'ชิ้น',
        expireDate: exp,
        barcode: '',
        lowThreshold: 1,
        updatedAt: serverTimestamp()
      });
      setForm({ name:'', qty:'1', unit:'ชิ้น', expireDate:'' });
    } catch (e) {
      Alert.alert('บันทึกไม่สำเร็จ', e.message);
    }
  };

  const renderItem = ({ item }) => {
    const expTxt = item.expireDate?.toDate ? item.expireDate.toDate().toLocaleDateString() : '-';
    return (
      <View style={s.card}>
        <Text style={s.cardTitle}>{item.name}</Text>
        <Text style={s.cardSub}>จำนวน: {item.qty} {item.unit}</Text>
        <Text style={s.cardSub}>หมดอายุ: {expTxt}</Text>
      </View>
    );
  };

  return (
    <View style={s.container}>
      <Text style={s.title}>ของในตู้เย็น</Text>

      <View style={s.formRow}>
        <TextInput
          style={[s.input,{flex:1}]}
          placeholder="ชื่อสินค้า"
          value={form.name}
          onChangeText={(t)=>setForm(v=>({ ...v, name:t }))}
        />
      </View>
      <View style={s.formRow}>
        <TextInput
          style={[s.input,{flex:1}]}
          placeholder="จำนวน"
          keyboardType="numeric"
          value={form.qty}
          onChangeText={(t)=>setForm(v=>({ ...v, qty:t }))}
        />
        <TextInput
          style={[s.input,{flex:1, marginLeft:8}]}
          placeholder="หน่วย (เช่น ขวด, ชิ้น)"
          value={form.unit}
          onChangeText={(t)=>setForm(v=>({ ...v, unit:t }))}
        />
      </View>
      <TextInput
        style={s.input}
        placeholder="วันหมดอายุ (YYYY-MM-DD) เช่น 2025-12-31"
        value={form.expireDate}
        onChangeText={(t)=>setForm(v=>({ ...v, expireDate:t }))}
      />

      <TouchableOpacity style={s.btn} onPress={addItem}>
        <Text style={s.btnText}>เพิ่มสินค้า</Text>
      </TouchableOpacity>

      <FlatList
        data={items}
        keyExtractor={(it)=>it.id}
        renderItem={renderItem}
        contentContainerStyle={{ paddingVertical:12 }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container:{ flex:1, padding:16 },
  title:{ fontSize:20, fontWeight:'700', marginBottom:8 },
  formRow:{ flexDirection:'row', marginBottom:8 },
  input:{ borderWidth:1, borderColor:'#ddd', borderRadius:10, padding:10, marginBottom:8 },
  btn:{ backgroundColor:'#2d9cdb', padding:12, borderRadius:10, marginTop:4, marginBottom:8 },
  btnText:{ color:'#fff', textAlign:'center', fontWeight:'700' },
  card:{ borderWidth:1, borderColor:'#eee', borderRadius:10, padding:12, marginBottom:10 },
  cardTitle:{ fontWeight:'700', marginBottom:4 },
  cardSub:{ color:'#666' }
});
