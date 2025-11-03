import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useFocusEffect, useNavigation, useRoute } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { Swipeable } from "react-native-gesture-handler";
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
  if (!ts?.toDate) return "-";
  const date = ts.toDate();
  const day = date.getDate().toString().padStart(2, "0");
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
};

const THREE_DAYS = 3 * 24 * 3600 * 1000;
const DEFAULT_UNIT = "pcs";
const MAX_SELECTION_QTY = 9999;

const aggregateFridgeItems = (docs) => {
  const map = new Map();
  docs.forEach((docItem) => {
    const normName = (docItem.name || "-").trim();
    const unit = docItem.unit || DEFAULT_UNIT;
    const expireMs = docItem.expireDate?.toMillis?.() ?? null;
    const expireKey = expireMs ?? "none";
    const key = `${normName.toLowerCase()}|${unit.toLowerCase()}|${expireKey}`;
    const lowThreshold = Number(docItem.lowThreshold) || 0;
    const docEntry = {
      id: docItem.id,
      qty: docItem.qty,
      unit,
      lowThreshold,
      expireMs,
      expireDate: docItem.expireDate || null,
      createdAt: docItem.createdAt || null,
    };
    if (map.has(key)) {
      const group = map.get(key);
      group.qty += docItem.qty;
      group.lowThreshold += lowThreshold;
      group._isExpiring = group._isExpiring || docItem._isExpiring;
      const currentExpire =
        group.expireDate?.toMillis?.() ?? Number.POSITIVE_INFINITY;
      if (
        typeof expireMs === "number" &&
        expireMs < currentExpire
      ) {
        group.expireDate = docItem.expireDate || null;
      }
      group.documents.push(docEntry);
    } else {
      map.set(key, {
        id: key,
        name: normName,
        unit,
        expireDate: docItem.expireDate || null,
        barcode: docItem.barcode || "",
        qty: docItem.qty,
        lowThreshold,
        _isExpiring: docItem._isExpiring,
        documents: [docEntry],
      });
    }
  });

  return Array.from(map.values())
    .map((group) => ({
      ...group,
      _isLow:
        group.lowThreshold > 0 ? group.qty <= group.lowThreshold : false,
    }))
    .sort((a, b) => {
      const nameCmp = a.name.localeCompare(b.name, "th");
      if (nameCmp !== 0) return nameCmp;
      const expireA = a.expireDate?.toMillis?.() || 0;
      const expireB = b.expireDate?.toMillis?.() || 0;
      return expireA - expireB;
    });
};

export default function FridgeDetailScreen() {
  const { params } = useRoute();
  const navigation = useNavigation();
  const { user, profile, setCurrentFridge } = useContext(AppCtx);
  const currentUserName =
    profile?.displayName?.trim() ||
    user?.displayName?.trim() ||
    user?.email ||
    (user?.uid ? `Member ${user.uid.slice(-4).toUpperCase()}` : "Unknown member");

  const fridgeId = params?.fridgeId;

  const [fridge, setFridge] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [removals, setRemovals] = useState({});
  const [activeFilter, setActiveFilter] = useState("all"); // all | exp | low
  const [bulkLoading, setBulkLoading] = useState(null); // null | "remove" | "shopping"

  useEffect(() => {
    if (
      fridgeId &&
      setCurrentFridge &&
      profile?.currentFridgeId !== fridgeId
    ) {
      setCurrentFridge(fridgeId).catch((err) =>
        console.warn("sync current fridge failed", err)
      );
    }
  }, [fridgeId, profile?.currentFridgeId, setCurrentFridge]);

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
    setActiveFilter("all");
  }, [fridgeId]);

  useEffect(() => {
    if (!fridgeId) return;
    setLoading(true);
    const stockRef = collection(db, "fridges", fridgeId, "stock");
    const unsubscribe = onSnapshot(
      stockRef,
      (snap) => {
        const now = Date.now();
        const next = [];
        snap.forEach((docSnap) => {
          const data = docSnap.data() || {};
          const qty =
            typeof data.qty === "number" ? data.qty : Number(data.qty) || 0;
          const lowThreshold =
            typeof data.lowThreshold === "number"
              ? data.lowThreshold
              : Number(data.lowThreshold) || 0;
          const expireMs = data?.expireDate?.toMillis?.();
          const isExpiring = !!(expireMs && expireMs - now <= THREE_DAYS);
          const isLow = lowThreshold > 0 && qty <= lowThreshold;
          next.push({
            id: docSnap.id,
            name: data.name || "-",
            qty,
            unit: data.unit || DEFAULT_UNIT,
            expireDate: data.expireDate || null,
            barcode: data.barcode || "",
            lowThreshold,
            _isExpiring: isExpiring,
            createdAt: data.createdAt || null,
            _isLow: isLow,
          });
        });
        const grouped = aggregateFridgeItems(next);
        setItems(grouped);
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
    const validIds = new Set(items.map((item) => item.id));
    setRemovals((prev) => {
      let changed = false;
      const next = {};
      Object.entries(prev).forEach(([id, value]) => {
        if (!validIds.has(id)) {
          changed = true;
          return;
        }
        const clamped = Math.max(0, Math.min(MAX_SELECTION_QTY, Number(value) || 0));
        if (clamped > 0) next[id] = clamped;
        if (clamped !== value) changed = true;
      });
      if (!changed) return prev;
      return next;
    });
  }, [items]);

  useFocusEffect(
    useCallback(() => {
      return () => setRemovals({});
    }, [])
  );

  const adjustRemoval = (itemId, delta) => {
    setRemovals((prev) => {
      const current = Number(prev[itemId]) || 0;
      let next = current + delta;
      if (next < 0) next = 0;
      if (next > MAX_SELECTION_QTY) next = MAX_SELECTION_QTY;
      if (next === current) return prev;
      if (next === 0) {
        if (prev[itemId]) {
          const { [itemId]: _omit, ...rest } = prev;
          return rest;
        }
        return prev;
      }
      return { ...prev, [itemId]: next };
    });
  };

  const itemMap = useMemo(() => {
    const map = new Map();
    items.forEach((item) => map.set(item.id, item));
    return map;
  }, [items]);

  const stats = useMemo(() => {
    let exp = 0;
    let low = 0;
    let totalQty = 0;
    let itemCount = 0;
    items.forEach((item) => {
      const qty = Number.isFinite(item.qty) ? item.qty : 0;
      totalQty += qty;
      if (item._isExpiring) exp += 1;
      if (item._isLow) {
        low += 1;
      } else if (qty > 0) {
        itemCount += 1;
      }
    });
    return {
      totalQty,
      itemCount,
      expiring: exp,
      low,
    };
  }, [items]);

  const statCards = useMemo(
    () => [
      { key: "all", label: "Items", value: stats.itemCount, tone: "default" },
      { key: "exp", label: "Expiring soon", value: stats.expiring, tone: "warn" },
      { key: "low", label: "Low stock", value: stats.low, tone: "danger" },
    ],
    [stats.itemCount, stats.expiring, stats.low]
  );

  const filteredItems = useMemo(() => {
    if (activeFilter === "exp") return items.filter((item) => item._isExpiring);
    if (activeFilter === "low") return items.filter((item) => item._isLow);
    return items;
  }, [items, activeFilter]);

  const selectionEntries = useMemo(
    () =>
      Object.entries(removals).filter(
        ([id, qty]) => qty > 0 && itemMap.has(id)
      ),
    [removals, itemMap]
  );

  const totalSelected = useMemo(
    () => selectionEntries.reduce((sum, [, qty]) => sum + qty, 0),
    [selectionEntries]
  );

  const handleBulkRemove = async () => {
    if (!selectionEntries.length || !fridgeId) {
      Alert.alert("Nothing selected", "Choose items before removing them.");
      return;
    }
    setBulkLoading("remove");
    try {
      const invalid = [];
      selectionEntries.forEach(([groupId, amount]) => {
        const group = itemMap.get(groupId);
        if (!group) return;
        const available = Number.isFinite(group.qty) ? group.qty : 0;
        if (amount > available) {
          invalid.push(`${group.name} (available ${available}, requested ${amount})`);
        }
      });
      if (invalid.length) {
        setBulkLoading(null);
        Alert.alert(
          "Not enough stock",
          `Reduce the quantity for:\n\n${invalid.join("\n")}`
        );
        return;
      }
      for (const [groupId, amount] of selectionEntries) {
        const group = itemMap.get(groupId);
        if (!group) continue;
        let remaining = Math.min(amount, group.qty);
        const orderedDocs = [...group.documents].sort((a, b) => {
          const aMs = typeof a.expireMs === "number" ? a.expireMs : Number.MAX_SAFE_INTEGER;
          const bMs = typeof b.expireMs === "number" ? b.expireMs : Number.MAX_SAFE_INTEGER;
          if (aMs !== bMs) return aMs - bMs;
          const aCreated =
            typeof a.createdAt?.toMillis === "function"
              ? a.createdAt.toMillis()
              : Number.MAX_SAFE_INTEGER;
          const bCreated =
            typeof b.createdAt?.toMillis === "function"
              ? b.createdAt.toMillis()
              : Number.MAX_SAFE_INTEGER;
          return aCreated - bCreated;
        });
        for (const docEntry of orderedDocs) {
          if (remaining <= 0) break;
          const stockRef = doc(db, "fridges", fridgeId, "stock", docEntry.id);
          const snap = await getDoc(stockRef);
          if (!snap.exists()) continue;
          const data = snap.data() || {};
          const currentQty = Number(data.qty) || 0;
          if (currentQty <= 0) continue;
          const removeQty = Math.min(remaining, currentQty);
          if (removeQty <= 0) continue;
          const remainingQty = Math.max(0, currentQty - removeQty);
          const batch = writeBatch(db);
          const lowThreshold = Number(data.lowThreshold) || 0;
          if (remainingQty <= 0) {
            batch.delete(stockRef);
          } else {
            batch.update(stockRef, {
              qty: remainingQty,
              updatedAt: serverTimestamp(),
              updatedBy: user?.uid || null,
              status: remainingQty <= lowThreshold ? "low" : data.status || "in_stock",
            });
          }
          const historyRef = doc(
            collection(db, "fridges", fridgeId, "stockHistory")
          );
          batch.set(historyRef, {
            type: "remove",
            name: data.name || group.name,
            qty: removeQty,
            unit: data.unit || group.unit || DEFAULT_UNIT,
            stockId: stockRef.id,
            byUid: user?.uid || null,
            byName: currentUserName,
            ts: serverTimestamp(),
          });
          await batch.commit();
          remaining -= removeQty;
        }
      }
      setRemovals({});
      Alert.alert("Inventory updated", "Selected items were removed from the fridge.");
    } catch (err) {
      console.warn("bulk remove failed", err);
      Alert.alert("Could not remove items", err.message || "Something went wrong");
    } finally {
      setBulkLoading(null);
    }
  };

  const handleAddToShopping = async () => {
    if (!selectionEntries.length || !fridgeId) {
      Alert.alert("Nothing selected", "Choose items before adding to the shopping list.");
      return;
    }
    setBulkLoading("shopping");
    try {
      const batch = writeBatch(db);
      let hasWrite = false;
      const fridgeName =
        (typeof fridge?.name === "string" && fridge.name.trim()) ||
        `Fridge ${fridgeId.slice(-4).toUpperCase()}`;
      selectionEntries.forEach(([itemId, qty]) => {
        const item = itemMap.get(itemId);
        if (!item || qty <= 0) return;
        const ref = doc(collection(db, "fridges", fridgeId, "shopping"));
        const stockDocId = item.documents?.[0]?.id || itemId;
        const normalizedName = (item.name || "").trim();
        batch.set(ref, {
          name: normalizedName,
          nameLower: normalizedName.toLowerCase(),
          qty,
          unit: item.unit || DEFAULT_UNIT,
          status: "pending",
          createdAt: serverTimestamp(),
          source: "fridge",
          fromStockId: stockDocId,
          expireDate: item.expireDate || null,
          byUid: user?.uid || null,
          fridgeId,
          fridgeName,
        });
        hasWrite = true;
      });
      if (!hasWrite) {
        setBulkLoading(null);
        Alert.alert("Nothing selected", "Choose items before adding to the shopping list.");
        return;
      }
      await batch.commit();
      if (
        typeof setCurrentFridge === "function" &&
        profile?.currentFridgeId !== fridgeId
      ) {
        setCurrentFridge(fridgeId).catch((err) =>
          console.warn("sync current fridge after add failed", err)
        );
      }
      setRemovals({});
      Alert.alert(
        "Added to shopping list",
        "Selected items were added. Quantities in the fridge were not changed."
      );
    } catch (err) {
      console.warn("add to shopping failed", err);
      Alert.alert("Could not add items", err.message || "Something went wrong");
    } finally {
      setBulkLoading(null);
    }
  };

  const handleDeleteGroup = async (group) => {
    if (!fridgeId) return;
    setBulkLoading("remove");
    try {
      let removedAny = false;
      for (const docEntry of group.documents) {
        const stockRef = doc(db, "fridges", fridgeId, "stock", docEntry.id);
        const snap = await getDoc(stockRef);
        if (!snap.exists()) continue;
        const data = snap.data() || {};
        const currentQty = Number(data.qty) || 0;
        const batch = writeBatch(db);
        batch.delete(stockRef);
        const historyRef = doc(
          collection(db, "fridges", fridgeId, "stockHistory")
        );
        batch.set(historyRef, {
          type: "remove",
          name: data.name || group.name,
          qty: currentQty,
          unit: data.unit || group.unit || DEFAULT_UNIT,
          stockId: stockRef.id,
          byUid: user?.uid || null,
          byName: currentUserName,
          ts: serverTimestamp(),
        });
        await batch.commit();
        removedAny = true;
      }
      setRemovals((prev) => {
        const { [group.id]: _omit, ...rest } = prev;
        return rest;
      });
      if (removedAny) {
        Alert.alert("Removed", `"${group.name}" has been removed from this fridge.`);
      }
    } catch (err) {
      console.warn("delete group failed", err);
      Alert.alert("Could not remove item", err.message || "Something went wrong");
    } finally {
      setBulkLoading(null);
    }
  };

  const confirmDeleteGroup = (group) => {
    Alert.alert(
      "Remove from fridge",
      `Remove all "${group.name}" entries from this fridge?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => handleDeleteGroup(group),
        },
      ]
    );
  };

  const listHeader = useMemo(() => {
    if (!fridge) return null;
    return (
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View style={styles.headerIcon}>
            <Ionicons name="cube-outline" size={24} color="#2D5BFF" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>{fridge.name || "My fridge"}</Text>
            <Text style={styles.headerSub}>
              {stats.totalQty} item{stats.totalQty === 1 ? "" : "s"} in this fridge
            </Text>
          </View>
        </View>
        <View style={styles.statRow}>
          {statCards.map((card) => {
            const isActive = activeFilter === card.key;
            const valueStyle =
              card.tone === "warn"
                ? styles.statValueWarn
                : card.tone === "danger"
                ? styles.statValueDanger
                : styles.statValue;
            return (
              <TouchableOpacity
                key={card.key}
                style={[
                  styles.statCard,
                  isActive && styles.statCardActive,
                ]}
                onPress={() =>
                  setActiveFilter((prev) =>
                    prev === card.key ? "all" : card.key
                  )
                }
                activeOpacity={0.85}
              >
                <Text style={valueStyle}>{card.value}</Text>
                <Text style={styles.statLabel}>{card.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    );
  }, [fridge, stats.totalQty, statCards, activeFilter]);

  const renderItem = ({ item }) => {
    const available = Number.isFinite(item.qty) ? item.qty : 0;
    const selected = removals[item.id] || 0;
    const disableMinus = bulkLoading !== null || selected <= 0;
    const disablePlus =
      bulkLoading !== null || selected >= MAX_SELECTION_QTY;
    const expiresOn = item.expireDate ? formatDate(item.expireDate) : null;
    const showBadges = item._isExpiring || item._isLow;
    const renderRightActions = () => (
      <TouchableOpacity
        style={styles.deleteAction}
        activeOpacity={0.85}
        onPress={() => confirmDeleteGroup(item)}
      >
        <Ionicons name="trash-outline" size={22} color="#fff" />
        <Text style={styles.deleteActionText}>Remove</Text>
      </TouchableOpacity>
    );

    return (
      <Swipeable
        renderRightActions={renderRightActions}
        overshootRight={false}
        friction={2}
      >
        <View style={styles.card}>
        <View style={styles.cardContent}>
          <Text style={styles.itemName}>{item.name}</Text>
          <Text style={styles.itemQty}>
            {available} {item.unit}
          </Text>
          {expiresOn && (
            <Text style={styles.itemMeta}>Expires on: {expiresOn}</Text>
          )}
        </View>
        <View style={styles.counterRow}>
          <TouchableOpacity
            style={[styles.counterBtn, disableMinus && styles.counterDisabled]}
            disabled={disableMinus}
            onPress={() => adjustRemoval(item.id, -1)}
          >
            <Text style={styles.counterText}>-</Text>
          </TouchableOpacity>
          <Text style={styles.counterValue}>{selected}</Text>
          <TouchableOpacity
            style={[styles.counterBtn, disablePlus && styles.counterDisabled]}
            disabled={disablePlus}
            onPress={() => adjustRemoval(item.id, 1)}
          >
            <Text style={styles.counterText}>+</Text>
          </TouchableOpacity>
        </View>
        {showBadges && (
          <View style={styles.badgeRow}>
            {item._isExpiring && (
              <View style={[styles.badge, styles.badgeWarn]}>
                <Text style={[styles.badgeText, styles.badgeTextWarn]}>
                  Expiring soon
                </Text>
              </View>
            )}
            {item._isLow && (
              <View style={[styles.badge, styles.badgeDanger]}>
                <Text style={[styles.badgeText, styles.badgeTextDanger]}>
                  Low stock
                </Text>
              </View>
            )}
          </View>
        )}
        </View>
      </Swipeable>
    );
  };

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

  const bottomPadding = totalSelected > 0 ? 200 : 120;
  const emptyMessage =
    items.length === 0 ? "No items in this fridge yet" : "Nothing in this filter";
  const emptyHint =
    items.length === 0
      ? "Add products from the Stock tab to start tracking inventory."
      : "Switch filters or adjust your selection to keep browsing.";

  return (
    <View style={styles.container}>
      <FlatList
        data={filteredItems}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListHeaderComponent={listHeader}
        contentContainerStyle={
          filteredItems.length === 0
            ? [styles.emptyContent, { paddingBottom: bottomPadding }]
            : { paddingBottom: bottomPadding }
        }
        ListEmptyComponent={
          <View style={styles.emptyBox}>
            <Text style={styles.emptyTitle}>{emptyMessage}</Text>
            <Text style={styles.emptySub}>{emptyHint}</Text>
          </View>
        }
      />

      {totalSelected > 0 && (
        <View style={styles.summaryBar}>
          <View style={styles.summaryInfo}>
            <Text style={styles.summaryTitle}>
              {totalSelected} item{totalSelected === 1 ? "" : "s"} selected
            </Text>
            <Text style={styles.summaryMeta}>
              Across {selectionEntries.length} product
              {selectionEntries.length === 1 ? "" : "s"}
            </Text>
          </View>
          <View style={styles.summaryActions}>
            <TouchableOpacity
              style={[
                styles.summaryButton,
                styles.summaryButtonGhost,
                bulkLoading && styles.summaryButtonDisabled,
              ]}
              onPress={handleAddToShopping}
              disabled={bulkLoading !== null}
              activeOpacity={0.85}
            >
              {bulkLoading === "shopping" ? (
                <ActivityIndicator color="#2D5BFF" />
              ) : (
                <Text style={styles.summaryGhostText}>Add to shopping list</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.summaryButton,
                styles.summaryButtonPrimary,
                bulkLoading && styles.summaryButtonDisabled,
              ]}
              onPress={handleBulkRemove}
              disabled={bulkLoading !== null}
              activeOpacity={0.85}
            >
              {bulkLoading === "remove" ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.summaryPrimaryText}>Remove from fridge</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}
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
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 12,
    backgroundColor: "#FFFFFF",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E3E8F5",
  },
  headerTop: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
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
    fontSize: 20,
    fontWeight: "800",
    color: "#1F2A5C",
  },
  headerSub: {
    color: "#6B7280",
    marginTop: 6,
  },
  statRow: {
    flexDirection: "row",
    gap: 12,
  },
  statCard: {
    flex: 1,
    paddingVertical: 14,
    backgroundColor: "#F4F6FB",
    borderRadius: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "transparent",
  },
  statCardActive: {
    backgroundColor: "#EEF4FF",
    borderColor: "#2D5BFF",
  },
  statValue: {
    fontSize: 22,
    fontWeight: "800",
    color: "#1F2A5C",
  },
  statValueWarn: {
    fontSize: 22,
    fontWeight: "800",
    color: "#D97706",
  },
  statValueDanger: {
    fontSize: 22,
    fontWeight: "800",
    color: "#DC2626",
  },
  statLabel: {
    marginTop: 4,
    color: "#6B7280",
  },
  card: {
    marginHorizontal: 16,
    marginTop: 16,
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 2,
  },
  cardContent: {
    marginBottom: 12,
  },
  itemName: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1F2A5C",
  },
  itemQty: {
    marginTop: 4,
    fontWeight: "600",
    color: "#3563E9",
  },
  itemMeta: {
    color: "#6B7280",
    marginTop: 4,
    fontSize: 13,
  },
  counterRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 12,
  },
  counterBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#EEF3FF",
    alignItems: "center",
    justifyContent: "center",
  },
  counterDisabled: {
    opacity: 0.3,
  },
  counterText: {
    fontSize: 22,
    fontWeight: "700",
    color: "#2D5BFF",
  },
  counterValue: {
    minWidth: 32,
    fontSize: 18,
    fontWeight: "700",
    color: "#1F2A5C",
    textAlign: "center",
  },
  badgeRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
    flexWrap: "wrap",
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  badgeWarn: {
    backgroundColor: "#FFF7E6",
  },
  badgeDanger: {
    backgroundColor: "#FFEAEA",
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "600",
  },
  badgeTextWarn: {
    color: "#B45309",
  },
  badgeTextDanger: {
    color: "#B91C1C",
  },
  deleteAction: {
    backgroundColor: "#DC2626",
    justifyContent: "center",
    alignItems: "center",
    width: 96,
    borderTopRightRadius: 18,
    borderBottomRightRadius: 18,
    marginTop: 16,
    marginBottom: 0,
  },
  deleteActionText: {
    color: "#FFFFFF",
    fontWeight: "700",
    marginTop: 4,
  },
  emptyContent: {
    paddingTop: 24,
    paddingHorizontal: 24,
  },
  emptyBox: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    paddingHorizontal: 20,
    paddingVertical: 24,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    marginHorizontal: 16,
    marginTop: 12,
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
  summaryBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingVertical: 20,
    backgroundColor: "#FFFFFF",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#E5E7EB",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 12,
  },
  summaryInfo: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginBottom: 16,
  },
  summaryTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1F2A5C",
  },
  summaryMeta: {
    color: "#6B7280",
  },
  summaryActions: {
    flexDirection: "row",
    gap: 12,
  },
  summaryButton: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  summaryButtonPrimary: {
    backgroundColor: "#2D5BFF",
  },
  summaryButtonGhost: {
    backgroundColor: "#EEF4FF",
  },
  summaryButtonDisabled: {
    opacity: 0.7,
  },
  summaryPrimaryText: {
    color: "#FFFFFF",
    fontWeight: "700",
  },
  summaryGhostText: {
    color: "#2D5BFF",
    fontWeight: "700",
  },
});
