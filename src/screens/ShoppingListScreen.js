import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  updateDoc,
} from "firebase/firestore";
import { useAppContext } from "../context/AppContext";
import { db } from "../services/firebaseConnected";


const THREE_DAYS = 3 * 24 * 60 * 60 * 1000;

const formatDate = (ts) => {
  if (!ts?.toDate) return "No expiry set";
  const date = ts.toDate();
  const day = date.getDate().toString().padStart(2, "0");
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
};

export default function ShoppingListScreen() {
  // Pull the signed-in user profile and fridge memberships.
  const { fridges, initializing } = useAppContext();

  // Track aggregated items and derived summary data.
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  const [markingId, setMarkingId] = useState(null);
  const [removingId, setRemovingId] = useState(null);

  // Keep a reference to active Firestore listeners and cached fridge data.
  const listenersRef = useRef(new Map());
  const fridgeItemsRef = useRef({});
  const pendingFridgesRef = useRef(new Set());

  const recomputeAggregated = useCallback(() => {
    const aggregated = [];
    Object.values(fridgeItemsRef.current).forEach((arr) => {
      aggregated.push(...arr);
    });

    aggregated.sort((a, b) => {
      const fridgeA = (a.fridgeName || "").toLowerCase();
      const fridgeB = (b.fridgeName || "").toLowerCase();
      if (fridgeA !== fridgeB) return fridgeA < fridgeB ? -1 : 1;
      const expireA = Number.isFinite(a.expireMillis)
        ? a.expireMillis
        : Number.MAX_SAFE_INTEGER;
      const expireB = Number.isFinite(b.expireMillis)
        ? b.expireMillis
        : Number.MAX_SAFE_INTEGER;
      if (expireA !== expireB) return expireA - expireB;
      const nameA = (a.name || "").toLowerCase();
      const nameB = (b.name || "").toLowerCase();
      if (nameA === nameB) return 0;
      return nameA < nameB ? -1 : 1;
    });

    setItems(aggregated);
  }, []);

  useEffect(() => {
    const listeners = listenersRef.current;
    const fridgeIds = (fridges || []).map((f) => f.id).filter(Boolean);
    const fridgeIdSet = new Set(fridgeIds);

    // Remove listeners for fridges the user no longer belongs to.
    listeners.forEach((unsubscribe, fridgeId) => {
      if (!fridgeIdSet.has(fridgeId)) {
        try {
          unsubscribe();
        } catch (err) {
          console.warn("failed to unsubscribe fridge listener", err);
        }
        listeners.delete(fridgeId);
        delete fridgeItemsRef.current[fridgeId];
      }
    });
    recomputeAggregated();

    if (!fridgeIds.length) {
      pendingFridgesRef.current = new Set();
      setItems([]);
      setLoading(false);
      return;
    }

    const pending = new Set();

    fridges.forEach((fridge) => {
      if (!fridge?.id) return;
      const fridgeId = fridge.id;

      if (!listeners.has(fridgeId)) {
        pending.add(fridgeId);
        const stockRef = collection(db, "fridges", fridgeId, "stock");
        const unsubscribe = onSnapshot(
          stockRef,
          (snapshot) => {
            const now = Date.now();
            const upcomingWindow = now + THREE_DAYS;
            const nextItems = [];

            snapshot.forEach((docSnap) => {
              const data = docSnap.data() || {};
              const qty =
                typeof data.qty === "number" ? data.qty : Number(data.qty) || 0;
              const lowThreshold =
                typeof data.lowThreshold === "number"
                  ? data.lowThreshold
                  : Number(data.lowThreshold) || 0;
              const expireTs = data.expireDate?.toMillis ? data.expireDate : null;
              const expireMillis = expireTs?.toMillis
                ? expireTs.toMillis()
                : null;

              const needsRestock = qty <= lowThreshold;
              const expiringSoon =
                Number.isFinite(expireMillis) && expireMillis <= upcomingWindow;

              if (!needsRestock && !expiringSoon) {
                return;
              }

              nextItems.push({
                id: docSnap.id,
                fridgeId,
                fridgeName: fridge.name || "Fridge",
                name: data.name || "Unnamed item",
                qty,
                lowThreshold,
                expireDate: expireTs,
                expireMillis,
                needsRestock,
                expiringSoon,
              });
            });

            fridgeItemsRef.current = {
              ...fridgeItemsRef.current,
              [fridgeId]: nextItems,
            };
            recomputeAggregated();
            pendingFridgesRef.current.delete(fridgeId);
            if (pendingFridgesRef.current.size === 0) {
              setLoading(false);
            }
          },
          (err) => {
            console.warn("stock listener error", err);
            Alert.alert(
              "Unable to load fridge items",
              err?.message || "Try again shortly."
            );
            delete fridgeItemsRef.current[fridgeId];
            listeners.delete(fridgeId);
            recomputeAggregated();
            pendingFridgesRef.current.delete(fridgeId);
            setLoading(false);
          }
        );

        listeners.set(fridgeId, unsubscribe);
      } else if (!fridgeItemsRef.current[fridgeId]) {
        pending.add(fridgeId);
      }
    });

    pendingFridgesRef.current = pending;
    setLoading(pending.size > 0);

    return () => {
      // In-flight listeners handled by separate unmount cleanup.
    };
  }, [fridges, recomputeAggregated]);

  useEffect(() => {
    return () => {
      listenersRef.current.forEach((unsubscribe) => {
        try {
          unsubscribe();
        } catch (err) {
          console.warn("listener cleanup failed", err);
        }
      });
      listenersRef.current.clear();
      fridgeItemsRef.current = {};
      pendingFridgesRef.current = new Set();
    };
  }, []);

  const summary = items.reduce(
    (acc, item) => {
      acc.total += 1;
      if (item.needsRestock) acc.lowStock += 1;
      if (item.expiringSoon) acc.expiringSoon += 1;

      if (!acc.perFridge[item.fridgeId]) {
        acc.perFridge[item.fridgeId] = {
          name: item.fridgeName,
          total: 0,
          lowStock: 0,
          expiringSoon: 0,
        };
      }
      const meta = acc.perFridge[item.fridgeId];
      meta.total += 1;
      if (item.needsRestock) meta.lowStock += 1;
      if (item.expiringSoon) meta.expiringSoon += 1;

      return acc;
    },
    { total: 0, lowStock: 0, expiringSoon: 0, perFridge: {} }
  );

  const handleMarkAsBought = async (item) => {
    if (!item?.id || !item?.fridgeId) return;
    const key = `${item.fridgeId}:${item.id}`;
    try {
      setMarkingId(key);
      await updateDoc(
        doc(db, "fridges", item.fridgeId, "stock", item.id),
        {
          qty: item.qty + 1,
        }
      );
    } catch (err) {
      Alert.alert(
        "Unable to update item",
        err?.message || "Please try again later."
      );
    } finally {
      setMarkingId(null);
    }
  };

  const confirmRemoveItem = (item) => {
    if (!item?.id || !item?.fridgeId) return;
    Alert.alert(
      "Remove this item?",
      `Remove ${item.name} from ${item.fridgeName}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => handleRemoveItem(item),
        },
      ]
    );
  };

  const handleRemoveItem = async (item) => {
    const key = `${item.fridgeId}:${item.id}`;
    try {
      setRemovingId(key);
      await deleteDoc(doc(db, "fridges", item.fridgeId, "stock", item.id));
    } catch (err) {
      Alert.alert(
        "Unable to remove item",
        err?.message || "Please try again later."
      );
    } finally {
      setRemovingId(null);
    }
  };

  const renderHeader = () => (
    <View style={styles.headerCard}>
      <Text style={styles.headerTitle}>Shopping List (All Fridges)</Text>
      <Text style={styles.headerSubtitle}>
        Items are shown here when they are low on stock or expiring soon across
        every fridge you belong to.
      </Text>
      <View style={styles.summaryBox}>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Total items to buy</Text>
          <Text style={styles.summaryValue}>{summary.total}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Low stock</Text>
          <Text style={styles.summaryValue}>{summary.lowStock}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Expiring soon</Text>
          <Text style={styles.summaryValue}>{summary.expiringSoon}</Text>
        </View>
        {Object.values(summary.perFridge).length ? (
          <View style={styles.perFridgeBox}>
            <Text style={styles.perFridgeTitle}>Per fridge</Text>
            {Object.values(summary.perFridge).map((info) => (
              <View key={info.name} style={styles.perFridgeRow}>
                <Text style={styles.perFridgeName}>{info.name}</Text>
                <Text style={styles.perFridgeMeta}>
                  Total: {info.total} · Low: {info.lowStock} · Expiring:{" "}
                  {info.expiringSoon}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );

  const renderItem = ({ item }) => {
    const key = `${item.fridgeId}:${item.id}`;
    const marking = markingId === key;
    const removing = removingId === key;
    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.itemTitle}>{item.name}</Text>
          <Text style={styles.fridgeTag}>{item.fridgeName}</Text>
        </View>
        <Text style={styles.metaText}>Quantity: {item.qty}</Text>
        <Text style={styles.metaText}>
          Low threshold: {item.lowThreshold}
        </Text>
        <Text style={styles.metaText}>
          Expires: {formatDate(item.expireDate)}
        </Text>
        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={[
              styles.secondaryButton,
              marking && styles.secondaryButtonDisabled,
            ]}
            disabled={marking}
            onPress={() => handleMarkAsBought(item)}
          >
            {marking ? (
              <ActivityIndicator size="small" color="#2563EB" />
            ) : (
              <Text style={styles.secondaryText}>Mark as bought</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.destructiveButton,
              removing && styles.destructiveButtonDisabled,
            ]}
            disabled={removing}
            onPress={() => confirmRemoveItem(item)}
          >
            {removing ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.destructiveText}>Remove item</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  if (initializing) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#2563EB" />
      </View>
    );
  }

  return (
    <FlatList
      data={items}
      keyExtractor={(item) => `${item.fridgeId}:${item.id}`}
      renderItem={renderItem}
      ListHeaderComponent={renderHeader}
      ListEmptyComponent={
        loading ? (
          <View style={styles.emptyState}>
            <ActivityIndicator size="small" color="#2563EB" />
            <Text style={styles.emptyText}>Loading shopping items…</Text>
          </View>
        ) : (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>
              Looks like every fridge is in good shape. Nothing to buy right now!
            </Text>
          </View>
        )
      }
      contentContainerStyle={styles.listContent}
    />
  );
}

const styles = StyleSheet.create({
  listContent: {
    padding: 20,
    paddingBottom: 32,
    backgroundColor: "#F3F4F6",
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F3F4F6",
  },
  headerCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#E5E7EB",
    shadowColor: "#111827",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#111827",
  },
  headerSubtitle: {
    marginTop: 8,
    color: "#6B7280",
    fontSize: 14,
  },
  summaryBox: {
    marginTop: 16,
    backgroundColor: "#F9FAFB",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#E5E7EB",
    padding: 12,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  summaryLabel: {
    color: "#6B7280",
    fontWeight: "600",
  },
  summaryValue: {
    fontWeight: "700",
    color: "#111827",
  },
  perFridgeBox: {
    marginTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#E5E7EB",
    paddingTop: 12,
  },
  perFridgeTitle: {
    fontWeight: "700",
    color: "#111827",
    marginBottom: 8,
  },
  perFridgeRow: {
    marginBottom: 6,
  },
  perFridgeName: {
    fontWeight: "600",
    color: "#111827",
  },
  perFridgeMeta: {
    color: "#6B7280",
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#E5E7EB",
    shadowColor: "#111827",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  itemTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#111827",
    flex: 1,
    marginRight: 12,
  },
  fridgeTag: {
    backgroundColor: "#2563EB",
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  metaText: {
    color: "#6B7280",
    marginTop: 6,
  },
  actionsRow: {
    flexDirection: "row",
    marginTop: 16,
  },
  secondaryButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#2563EB",
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    marginRight: 10,
  },
  secondaryButtonDisabled: {
    borderColor: "#93C5FD",
    backgroundColor: "#E0E7FF",
  },
  secondaryText: {
    color: "#2563EB",
    fontWeight: "700",
  },
  destructiveButton: {
    flex: 1,
    backgroundColor: "#DC2626",
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  destructiveButtonDisabled: {
    backgroundColor: "#FCA5A5",
  },
  destructiveText: {
    color: "#FFFFFF",
    fontWeight: "700",
  },
  emptyState: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 24,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#E5E7EB",
    alignItems: "center",
  },
  emptyText: {
    marginTop: 12,
    color: "#6B7280",
    textAlign: "center",
  },
});
