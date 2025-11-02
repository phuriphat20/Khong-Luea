// src/screens/ShoppingScreen.js
import { useContext, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Platform,
  Modal,
} from "react-native";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  writeBatch,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import DateTimePicker, {
  DateTimePickerAndroid,
} from "@react-native-community/datetimepicker";
import AppCtx from "../context/AppContext";
import { db } from "../services/firebaseConnected";

const DEFAULT_UNIT = "pcs";
const MAX_SHOPPING_QTY = 9999;

const formatInputDate = (date) => {
  if (!date || !(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "";
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const parseInputDate = (value) => {
  if (!value) return null;
  const [y, m, d] = value.split("-").map((part) => Number(part));
  if (!y || !m || !d) return null;
  const parsed = new Date(y, m - 1, d);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

export default function ShoppingScreen() {
  const { user, profile } = useContext(AppCtx);
  const [items, setItems] = useState([]);
  const [busyMap, setBusyMap] = useState({});
  const [expiryDrafts, setExpiryDrafts] = useState({});
  const [activeExpiryItem, setActiveExpiryItem] = useState(null);
  const [iosDatePickerVisible, setIosDatePickerVisible] = useState(false);
  const [iosDateValue, setIosDateValue] = useState(new Date());

  const fridgeId = profile?.currentFridgeId || null;
  const actorName = useMemo(() => {
    if (!user && !profile) return "Unknown member";
    return (
      profile?.displayName?.trim() ||
      user?.displayName?.trim() ||
      user?.email ||
      (user?.uid ? `Member ${user.uid.slice(-4).toUpperCase()}` : "Unknown member")
    );
  }, [profile?.displayName, user?.displayName, user?.email, user?.uid]);

  useEffect(() => {
    if (!fridgeId) {
      setItems([]);
      return;
    }
    const col = collection(db, "fridges", fridgeId, "shopping");
    const q = query(col, orderBy("createdAt", "desc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const arr = [];
        snap.forEach((d) => {
          const data = d.data() || {};
          if (data.status && data.status !== "pending") return;
          arr.push({
            id: d.id,
            name: data.name || "-",
            qty: Number(data.qty) || 0,
            unit: data.unit || DEFAULT_UNIT,
            barcode: data.barcode || "",
            lowThreshold:
              typeof data.lowThreshold === "number"
                ? data.lowThreshold
                : Number(data.lowThreshold) || 0,
            targetExpireDate: data.targetExpireDate || data.expireDate || null,
            updatedAt: data.updatedAt || null,
          });
        });
        setItems(arr);
      },
      (err) => {
        console.warn("shopping list error", err);
        Alert.alert("Could not load shopping list", err?.message || String(err));
        setItems([]);
      }
    );
    return () => unsub();
  }, [fridgeId]);

  useEffect(() => {
    setBusyMap((prev) => {
      const activeIds = new Set(items.map((it) => it.id));
      let changed = false;
      const next = {};
      activeIds.forEach((id) => {
        if (prev[id]) {
          next[id] = prev[id];
          if (!changed) changed = prev[id] !== next[id];
        }
      });
      if (!changed && Object.keys(prev).length === Object.keys(next).length) {
        return prev;
      }
      return next;
    });
  }, [items]);

  useEffect(() => {
    setExpiryDrafts((prev) => {
      const next = { ...prev };
      let changed = false;
      const activeIds = new Set();
      items.forEach((item) => {
        activeIds.add(item.id);
        const preset =
          typeof item.targetExpireDate?.toDate === "function"
            ? formatInputDate(item.targetExpireDate.toDate())
            : prev[item.id] || "";
        if (next[item.id] !== preset) {
          next[item.id] = preset;
          changed = true;
        }
      });
      Object.keys(next).forEach((key) => {
        if (!activeIds.has(key)) {
          delete next[key];
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [items]);

  const setBusyForItem = (itemId, value) => {
    setBusyMap((prev) => {
      if (value) return { ...prev, [itemId]: true };
      if (prev[itemId]) {
        const next = { ...prev };
        delete next[itemId];
        return next;
      }
      return prev;
    });
  };

  const persistExpiryDate = async (item, dateObj) => {
    if (!fridgeId || !item?.id) return;
    const formatted = formatInputDate(dateObj);
    if (expiryDrafts[item.id] === formatted) return;
    const previous = expiryDrafts[item.id] || "";
    setExpiryDrafts((prev) => ({ ...prev, [item.id]: formatted }));
    try {
      setBusyForItem(item.id, true);
      await updateDoc(doc(db, "fridges", fridgeId, "shopping", item.id), {
        targetExpireDate: Timestamp.fromDate(dateObj),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      console.warn("shopping set expiry", err);
      Alert.alert("Could not save expiry date", err?.message || String(err));
      setExpiryDrafts((prev) => ({ ...prev, [item.id]: previous }));
    } finally {
      setBusyForItem(item.id, false);
    }
  };

  const openExpiryPicker = (item) => {
    const currentDraft = expiryDrafts[item.id];
    const baseDate = parseInputDate(currentDraft) || new Date();
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({
        mode: "date",
        value: baseDate,
        onChange: (_event, selectedDate) => {
          if (!selectedDate) return;
          persistExpiryDate(item, selectedDate);
        },
      });
    } else {
      setActiveExpiryItem(item);
      setIosDateValue(baseDate);
      setIosDatePickerVisible(true);
    }
  };

  const dismissIosDatePicker = () => {
    setIosDatePickerVisible(false);
    setActiveExpiryItem(null);
  };

  const handleIosDateConfirm = async () => {
    if (!activeExpiryItem) {
      dismissIosDatePicker();
      return;
    }
    await persistExpiryDate(activeExpiryItem, iosDateValue);
    dismissIosDatePicker();
  };

  const handleAdjustQty = async (item, delta) => {
    if (!fridgeId || !item?.id) return;
    const current = Number(item.qty) || 0;
    let next = current + delta;
    if (delta < 0 && current <= 1) {
      Alert.alert("Minimum quantity", "Quantity cannot be lower than 1.");
      return;
    }
    if (next < 1) next = 1;
    if (next > MAX_SHOPPING_QTY) {
      next = MAX_SHOPPING_QTY;
      Alert.alert(
        "Large quantity",
        `For very large orders please split into batches under ${MAX_SHOPPING_QTY}.`
      );
    }
    if (next === current) return;
    try {
      setBusyForItem(item.id, true);
      await updateDoc(
        doc(db, "fridges", fridgeId, "shopping", item.id),
        {
          qty: next,
          updatedAt: serverTimestamp(),
        }
      );
    } catch (err) {
      console.warn("shopping adjust qty", err);
      Alert.alert("Could not update quantity", err?.message || String(err));
    } finally {
      setBusyForItem(item.id, false);
    }
  };

  const handleMarkPurchased = async (item) => {
    if (!fridgeId || !item?.id) return;
    const qty = Number(item.qty) || 0;
    if (qty <= 0) {
      Alert.alert("Quantity required", "Set a quantity before marking as bought.");
      return;
    }
    const draftDate = expiryDrafts[item.id];
    const parsedDate = parseInputDate(draftDate);
    if (!parsedDate) {
      Alert.alert(
        "Expiry date required",
        "Please set an expiry date before marking this item as bought."
      );
      return;
    }
    try {
      setBusyForItem(item.id, true);
      const batch = writeBatch(db);
      const unit = item.unit || DEFAULT_UNIT;
      const name = (item.name || "").trim() || "Unnamed item";
      const safeLowThreshold = Math.max(
        1,
        Math.round(Number(item.lowThreshold) || 1)
      );
      const stockRef = doc(collection(db, "fridges", fridgeId, "stock"));
      const nowTs = serverTimestamp();
      batch.set(stockRef, {
        name,
        qty,
        unit,
        expireDate: Timestamp.fromDate(parsedDate),
        barcode: item.barcode || "",
        lowThreshold: safeLowThreshold,
        status: "in_stock",
        createdAt: nowTs,
        updatedAt: nowTs,
        addedBy: user?.uid || null,
        updatedBy: user?.uid || null,
      });
      const historyRef = doc(
        collection(db, "fridges", fridgeId, "stockHistory")
      );
      batch.set(historyRef, {
        type: "add",
        name,
        qty,
        unit,
        stockId: stockRef.id,
        byUid: user?.uid || null,
        byName: actorName,
        ts: nowTs,
        source: "shopping",
        expireDate: Timestamp.fromDate(parsedDate),
      });
      const shoppingRef = doc(db, "fridges", fridgeId, "shopping", item.id);
      batch.delete(shoppingRef);
      await batch.commit();
      Alert.alert("Restocked", `${name} (${qty} ${unit}) added to the fridge.`);
    } catch (err) {
      console.warn("shopping mark purchased", err);
      Alert.alert("Could not restock item", err?.message || String(err));
      setBusyForItem(item.id, false);
      return;
    }
    setBusyForItem(item.id, false);
  };

  const renderItem = ({ item }) => {
    const qty = Number(item.qty) || 0;
    const unit = item.unit || DEFAULT_UNIT;
    const busy = !!busyMap[item.id];
    const expiryDraft = expiryDrafts[item.id] || "";
    const parsedDraft = parseInputDate(expiryDraft);
    const expiryDisplay = parsedDraft
      ? parsedDraft.toLocaleDateString()
      : "Select date";
    return (
      <View style={styles.item}>
        <View style={styles.itemHeader}>
          <Text style={styles.name}>{item.name}</Text>
          <Text style={styles.metaText}>
            {qty} {unit}
          </Text>
        </View>
        <View style={styles.expiryRow}>
          <Text style={styles.expiryLabel}>Expiry date</Text>
          <TouchableOpacity
            style={[styles.expiryButton, busy && styles.expiryButtonDisabled]}
            onPress={() => openExpiryPicker(item)}
            disabled={busy}
          >
            <Text
              style={[
                styles.expiryButtonText,
                !parsedDraft && styles.expiryPlaceholderText,
              ]}
            >
              {expiryDisplay}
            </Text>
          </TouchableOpacity>
        </View>
        <View style={styles.itemFooter}>
          <View style={styles.stepperRow}>
            <TouchableOpacity
              style={[
                styles.stepperButton,
                (busy || qty <= 1) && styles.stepperButtonDisabled,
              ]}
              disabled={busy || qty <= 1}
              onPress={() => handleAdjustQty(item, -1)}
            >
              <Text style={styles.stepperButtonText}>-</Text>
            </TouchableOpacity>
            <Text style={styles.stepperValue}>{qty}</Text>
            <TouchableOpacity
              style={[
                styles.stepperButton,
                busy && styles.stepperButtonDisabled,
              ]}
              disabled={busy}
              onPress={() => handleAdjustQty(item, 1)}
            >
              <Text style={styles.stepperButtonText}>+</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={[styles.completeBtn, (busy || qty <= 0) && styles.completeBtnDisabled]}
            disabled={busy || qty <= 0}
            onPress={() => handleMarkPurchased(item)}
          >
            <Text style={styles.completeBtnText}>Mark as bought</Text>
          </TouchableOpacity>
        </View>
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
          <Text style={styles.empty}>
            {fridgeId
              ? "Nothing to buy yet"
              : "Select a fridge to view its shopping list."}
          </Text>
        }
      />
      {Platform.OS === "ios" && (
        <Modal
          visible={iosDatePickerVisible}
          transparent
          animationType="fade"
          onRequestClose={dismissIosDatePicker}
        >
          <View style={styles.iosModalOverlay}>
            <TouchableOpacity
              style={styles.iosModalBackdrop}
              activeOpacity={1}
              onPress={dismissIosDatePicker}
            />
            <View style={styles.iosModalSheet}>
              <Text style={styles.iosModalTitle}>Select expiry date</Text>
              <DateTimePicker
                value={iosDateValue}
                mode="date"
                display="spinner"
                onChange={(_, selected) => {
                  if (selected) setIosDateValue(selected);
                }}
              />
              <View style={styles.iosModalActions}>
                <TouchableOpacity
                  style={[styles.iosModalButton, styles.iosModalButtonSecondary]}
                  onPress={dismissIosDatePicker}
                >
                  <Text style={styles.iosModalButtonSecondaryText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.iosModalButton, styles.iosModalButtonPrimary]}
                  onPress={handleIosDateConfirm}
                >
                  <Text style={styles.iosModalButtonPrimaryText}>Save</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: "#F5F7FB" },
  title: { fontSize: 20, fontWeight: "700", color: "#1F2A5C" },
  item: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderWidth: 1,
    borderRadius: 10,
    backgroundColor: "#FFFFFF",
    padding: 16,
    marginTop: 10,
  },
  itemHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  name: { fontWeight: "700", fontSize: 16, color: "#1F2A5C", flex: 1, marginRight: 12 },
  metaText: { color: "#3563E9", fontWeight: "700" },
  expiryRow: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  expiryLabel: {
    color: "#6B7280",
    fontWeight: "600",
  },
  expiryButton: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    backgroundColor: "#FFFFFF",
  },
  expiryButtonDisabled: {
    opacity: 0.6,
  },
  expiryButtonText: {
    color: "#1F2A5C",
    fontWeight: "700",
  },
  expiryPlaceholderText: {
    color: "#9CA3AF",
    fontWeight: "600",
  },
  itemFooter: {
    marginTop: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
  },
  stepperRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  stepperButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  stepperButtonDisabled: {
    opacity: 0.4,
  },
  stepperButtonText: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1F2A5C",
  },
  stepperValue: {
    minWidth: 36,
    textAlign: "center",
    fontSize: 16,
    fontWeight: "700",
    color: "#1F2A5C",
  },
  completeBtn: {
    backgroundColor: "#2D5BFF",
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  completeBtnDisabled: {
    opacity: 0.5,
  },
  completeBtnText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 14,
  },
  empty: { color: "#6B7280", marginTop: 32, textAlign: "center" },
  iosModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(17, 24, 39, 0.45)",
    justifyContent: "center",
    padding: 24,
  },
  iosModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  iosModalSheet: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 20,
  },
  iosModalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1F2A5C",
    marginBottom: 12,
    textAlign: "center",
  },
  iosModalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
    marginTop: 12,
  },
  iosModalButton: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 10,
    minWidth: 90,
    alignItems: "center",
  },
  iosModalButtonSecondary: {
    backgroundColor: "#EEF2FF",
  },
  iosModalButtonPrimary: {
    backgroundColor: "#2D5BFF",
  },
  iosModalButtonSecondaryText: {
    color: "#1F2A5C",
    fontWeight: "700",
  },
  iosModalButtonPrimaryText: {
    color: "#FFFFFF",
    fontWeight: "700",
  },
});
