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
    const q = query(col, orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      const arr = [];
      snap.forEach((d) => arr.push({ id: d.id, ...d.data() }));
      setItems(arr);
    });
    return () => unsub();
  }, [profile?.currentFridgeId]);

  const toggleBought = async (id, curr) => {
    if (!profile?.currentFridgeId) return;
    await updateDoc(doc(db, 'fridges', profile.currentFridgeId, 'shopping', id), {
      status: curr === 'pending' ? 'bought' : 'pending',
    });
  };

  const renderItem = ({ item }) => {
    const bought = item.status === 'bought';
    return (
      <View style={styles.item}>
        <View style={{ flex: 1 }}>
          <Text
            style={[
              styles.name,
              bought && { textDecorationLine: 'line-through', color: '#999' },
            ]}
          >
            {item.name} x{item.qty}
          </Text>
          <Text style={styles.status}>Status: {item.status}</Text>
        </View>
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => toggleBought(item.id, item.status)}
        >
          <Text style={styles.actionText}>
            {bought ? 'Mark as pending' : 'Mark as bought'}
          </Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Shopping list</Text>
      <FlatList
        data={items}
        keyExtractor={(it) => it.id}
        renderItem={renderItem}
        contentContainerStyle={{ paddingVertical: 12 }}
        ListEmptyComponent={
          <Text style={styles.empty}>Nothing to buy yet</Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  title: { fontSize: 20, fontWeight: '700' },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 10,
    padding: 12,
    marginTop: 10,
  },
  name: { fontWeight: '700' },
  status: { color: '#666', marginTop: 4 },
  actionBtn: {
    backgroundColor: '#6c5ce7',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    marginLeft: 8,
  },
  actionText: { color: '#fff', fontSize: 12, textAlign: 'center' },
  empty: { color: '#666', marginTop: 24, textAlign: 'center' },
});

