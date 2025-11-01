import { useContext, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import AppCtx from "../context/AppContext";
import { db } from "../services/firebaseConnected";

const formatDate = (ts) => {
  if (!ts?.toDate) return null;
  const date = ts.toDate();
  const day = date.getDate().toString().padStart(2, "0");
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
};

export default function FridgeDetailScreen() {
  const { params } = useRoute();
  const navigation = useNavigation();
  const { user } = useContext(AppCtx);

  const fridgeId = params?.fridgeId;

  const [fridge, setFridge] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [removals, setRemovals] = useState({});
  const [processingId, setProcessingId] = useState(null);

  useEffect(() => {
    if (!fridgeId) {
      navigation.setOptions({ title: "Fridge not found" });
      setFridge(null);
      setItems([]);
      setLoading(false);
      return;
    }

    let active = true;
    (async () => {
      try {
        const ref = doc(db, "fridges", fridgeId);
        const snap = await getDoc(ref);
        if (!active) return;
        if (snap.exists()) {
          const data = { id: snap.id, ...snap.data() };
          setFridge(data);
          navigation.setOptions({ title: data.name || "Fridge details" });
        } else {
          setFridge(null);
          navigation.setOptions({ title: "Fridge not found" });
        }
      } catch (err) {
        console.warn("load fridge failed", err);
        if (active) {
          setFridge(null);
          navigation.setOptions({ title: "Fridge not found" });
          Alert.alert("Unable to load fridge", err.message || "Something went wrong");
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [fridgeId, navigation]);

  useEffect(() => {
    if (!fridgeId) return;
    setLoading(true);
    const stockRef = collection(db, "fridges", fridgeId, "stock");
    const unsubscribe = onSnapshot(
      stockRef,
      (snap) => {
        const next = [];
        snap.forEach((docSnap) => {
          const data = docSnap.data();
          next.push({
            id: docSnap.id,
            name: data.name || "-",
            qty: typeof data.qty === "number" ? data.qty : Number(data.qty) || 0,
            unit: data.unit || "",
            expireDate: data.expireDate || null,
            barcode: data.barcode || "",
          });
        });
        next.sort((a, b) => {
          const nameA = a.name?.toString().toLowerCase() || "";
          const nameB = b.name?.toString().toLowerCase() || "";
          if (nameA === nameB) return 0;
          return nameA < nameB ? -1 : 1;
        });
        setItems(next);
        setLoading(false);
      },
      (err) => {
        console.warn("stock snapshot error", err);
        setLoading(false);
        Alert.alert("Unable to load items", err.message || "Something went wrong");
      }
    );
    return () => unsubscribe();
  }, [fridgeId]);

  useEffect(() => {
    setRemovals((prev) => {
      let changed = false;
      const next = {};
      items.forEach((item) => {
        const prevValue = prev[item.id];
        if (!prevValue) return;
        const max = Number.isFinite(item.qty) ? item.qty : 0;
        if (max <= 0) {
          changed = true;
          return;
        }
        const clamped = Math.min(prevValue, max);
        if (clamped !== prevValue) changed = true;
        if (clamped > 0) next[item.id] = clamped;
      });
      if (!changed && Object.keys(prev).length === Object.keys(next).length) {
        return prev;
      }
      return next;
    });
  }, [items]);

  const adjustRemoval = (itemId, delta, maxQty) => {
    setRemovals((prev) => {
      const current = prev[itemId] || 0;
      const next = Math.max(0, Math.min(maxQty, current + delta));
      if (next <= 0) {
        if (prev[itemId]) {
          const { [itemId]: _omit, ...rest } = prev;
          return rest;
        }
        return prev;
      }
      return { ...prev, [itemId]: next };
    });
  };

  const handleRemove = async (item) => {
    const amount = removals[item.id] || 0;
    if (amount <= 0) {
      Alert.alert("Choose quantity", "Set how many items to remove before confirming.");
      return;
    }
    if (!fridgeId) return;
    setProcessingId(item.id);
    try {
      const stockRef = doc(db, "fridges", fridgeId, "stock", item.id);
      const snap = await getDoc(stockRef);
      if (!snap.exists()) {
        Alert.alert("Item not found", "This entry was removed already.");
        return;
      }
      const data = snap.data();
      const currentQty = Number(data.qty) || 0;
      if (currentQty <= 0) {
        Alert.alert("Nothing left", "The quantity is already zero.");
        return;
      }
      const actualAmount = Math.min(amount, currentQty);
      const batch = writeBatch(db);
      batch.update(stockRef, {
        qty: Math.max(0, currentQty - actualAmount),
        updatedAt: serverTimestamp(),
      });
      const historyRef = doc(collection(db, "fridges", fridgeId, "stockHistory"));
      batch.set(historyRef, {
        type: "remove",
        name: data.name || item.name,
        qty: actualAmount,
        unit: data.unit || item.unit || "",
        stockId: stockRef.id,
        byUid: user?.uid || null,
        ts: serverTimestamp(),
      });
      await batch.commit();
      setRemovals((prev) => {
        const { [item.id]: _omit, ...rest } = prev;
        return rest;
      });
    } catch (err) {
      console.warn("remove stock failed", err);
      Alert.alert("Could not remove items", err.message || "Something went wrong");
    } finally {
      setProcessingId(null);
    }
  };

  const renderItem = ({ item }) => {
    const available = Number.isFinite(item.qty) ? item.qty : 0;
    const value = removals[item.id] || 0;
    const disableMinus = processingId === item.id || value <= 0;
    const disablePlus = processingId === item.id || value >= available;
    const expiresOn = formatDate(item.expireDate);

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.itemName}>{item.name}</Text>
          <Text style={styles.itemQty}>
            {available} {item.unit}
          </Text>
        </View>

        {expiresOn && <Text style={styles.itemMeta}>Expires on: {expiresOn}</Text>}
        {item.barcode ? <Text style={styles.itemMeta}>Barcode: {item.barcode}</Text> : null}

        <View style={styles.selectorRow}>
          <TouchableOpacity
            style={[styles.counterBtn, disableMinus && styles.counterBtnDisabled]}
            disabled={disableMinus}
            onPress={() => adjustRemoval(item.id, -1, available)}
          >
            <Text style={styles.counterText}>-</Text>
          </TouchableOpacity>

          <Text style={styles.counterValue}>{value}</Text>

          <TouchableOpacity
            style={[styles.counterBtn, disablePlus && styles.counterBtnDisabled]}
            disabled={disablePlus}
            onPress={() => adjustRemoval(item.id, 1, available)}
          >
            <Text style={styles.counterText}>+</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[
            styles.removeBtn,
            (value <= 0 || processingId === item.id) && styles.removeBtnDisabled,
          ]}
          disabled={value <= 0 || processingId === item.id}
          onPress={() => handleRemove(item)}
        >
          {processingId === item.id ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.removeText}>Confirm removal</Text>
          )}
        </TouchableOpacity>
      </View>
    );
  };

  const listHeader = useMemo(() => {
    if (!fridge) return null;
    return (
      <View style={styles.header}>
        <View style={styles.headerIcon}>
          <Ionicons name="cube-outline" size={24} color="#2D5BFF" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>{fridge.name || "My fridge"}</Text>
          <Text style={styles.headerSub}>{items.length} items in this fridge</Text>
        </View>
      </View>
    );
  }, [fridge, items.length]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!fridgeId) {
    return (
      <View style={styles.centered}>
        <Text>Fridge not found</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={
          items.length === 0 ? styles.emptyContent : { paddingBottom: 16 }
        }
        ListHeaderComponent={listHeader}
        ListEmptyComponent={
          <View style={styles.emptyBox}>
            <Text style={styles.emptyTitle}>No items yet</Text>
            <Text style={styles.emptySub}>Add products from the Stock tab to see them here.</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F5F7FB",
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 20,
    backgroundColor: "#fff",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E3E8F5",
  },
  headerIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#EEF3FF",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1F2A5C",
  },
  headerSub: {
    color: "#6B7280",
    marginTop: 4,
  },
  card: {
    marginHorizontal: 16,
    marginTop: 16,
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  itemName: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1F2A5C",
    flex: 1,
    marginRight: 12,
  },
  itemQty: {
    fontWeight: "600",
    color: "#3563E9",
  },
  itemMeta: {
    color: "#6B7280",
    marginTop: 6,
    fontSize: 13,
  },
  selectorRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 14,
    gap: 16,
  },
  counterBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#EEF3FF",
    alignItems: "center",
    justifyContent: "center",
  },
  counterBtnDisabled: {
    opacity: 0.3,
  },
  counterText: {
    fontSize: 22,
    fontWeight: "700",
    color: "#2D5BFF",
  },
  counterValue: {
    minWidth: 32,
    textAlign: "center",
    fontSize: 18,
    fontWeight: "700",
    color: "#1F2A5C",
  },
  removeBtn: {
    marginTop: 16,
    backgroundColor: "#2D5BFF",
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  removeBtnDisabled: {
    backgroundColor: "#C6D4FF",
  },
  removeText: {
    color: "#fff",
    fontWeight: "700",
  },
  emptyContent: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  emptyBox: {
    alignItems: "center",
    paddingHorizontal: 16,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1F2A5C",
  },
  emptySub: {
    color: "#6B7280",
    marginTop: 6,
    textAlign: "center",
  },
});
