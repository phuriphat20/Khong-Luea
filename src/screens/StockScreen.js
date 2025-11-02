import { useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Alert,
  Modal,
  ActivityIndicator,
  Platform,
  ScrollView,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import DateTimePicker, {
  DateTimePickerAndroid,
} from "@react-native-community/datetimepicker";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  writeBatch,
} from "firebase/firestore";
import AppCtx from "../context/AppContext";
import { db } from "../services/firebaseConnected";

const THREE_DAYS = 3 * 24 * 3600 * 1000;
const DEFAULT_UNIT = "pcs";
const OTHER_UNIT_VALUE = "__other__";
const UNIT_OPTIONS = [
  "pcs",
  "pack",
  "bottle",
  "bag",
  "box",
  "can",
  "kg",
  "g",
  "l",
  "ml",
  OTHER_UNIT_VALUE,
];

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

const formatDate = (ts) => {
  if (!ts?.toDate) return "-";
  return ts.toDate().toLocaleDateString("en-US", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
};

const formatDateTime = (ts) => {
  if (!ts?.toDate) return "-";
  return ts.toDate().toLocaleString("en-US", {
    dateStyle: "short",
    timeStyle: "short",
  });
};

const aggregateStockItems = (items) => {
  const map = new Map();
  items.forEach((item) => {
    const normName = (item.name || "").trim();
    const unit = item.unit || DEFAULT_UNIT;
    const expireKey = item.expireDate?.toMillis?.() || "none";
    const key = `${item.fridgeId}|${normName.toLowerCase()}|${unit.toLowerCase()}|${expireKey}`;
    const lowThreshold = Number(item.lowThreshold) || 0;
    if (map.has(key)) {
      const entry = map.get(key);
      entry.qty += item.qty;
      entry.lowThreshold += lowThreshold;
      entry._isExpiring = entry._isExpiring || item._isExpiring;
      entry._isLow =
        entry.lowThreshold > 0 ? entry.qty <= entry.lowThreshold : false;
      entry.ids.push(item.id);
    } else {
      const expireDate = item.expireDate || null;
      const isLow =
        lowThreshold > 0 ? item.qty <= lowThreshold : item._isLow || false;
      map.set(key, {
        ...item,
        id: key,
        name: normName,
        unit,
        expireDate,
        qty: item.qty,
        lowThreshold,
        _isExpiring: item._isExpiring,
        _isLow: isLow,
        ids: [item.id],
      });
    }
  });
  return Array.from(map.values()).sort((a, b) => {
    const nameCmp = a.name.localeCompare(b.name, "th");
    if (nameCmp !== 0) return nameCmp;
    const expireA = a.expireDate?.toMillis?.() || 0;
    const expireB = b.expireDate?.toMillis?.() || 0;
    return expireA - expireB;
  });
};

export default function StockScreen() {
  const { user, profile } = useContext(AppCtx);
  const currentUserName =
    profile?.displayName?.trim() ||
    user?.displayName?.trim() ||
    user?.email ||
    (user?.uid ? `Member ${user.uid.slice(-4).toUpperCase()}` : "Unknown member");
  const initialFilter = "none";
  const [memberFridgeIds, setMemberFridgeIds] = useState([]);
  const [fridgeMeta, setFridgeMeta] = useState({});
  const [stock, setStock] = useState([]);
  const [history, setHistory] = useState([]);
  const [activeFilter, setActiveFilter] = useState(initialFilter); // none | all | exp | low
  const [loadingStock, setLoadingStock] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({
    name: "",
    qty: "1",
    unit: DEFAULT_UNIT,
    expireDate: "",
    barcode: "",
    fridgeId: "",
  });
  const [unitModalOpen, setUnitModalOpen] = useState(false);
  const [fridgeModalOpen, setFridgeModalOpen] = useState(false);
  const [iosDatePickerVisible, setIosDatePickerVisible] = useState(false);
  const [iosDateValue, setIosDateValue] = useState(new Date());
  const [customUnitModalOpen, setCustomUnitModalOpen] = useState(false);
  const [customUnitDraft, setCustomUnitDraft] = useState("");
  const [userNameCache, setUserNameCache] = useState({});

  useEffect(() => {
    if (user?.uid && currentUserName) {
      setUserNameCache((prev) => {
        if (prev[user.uid]) return prev;
        return { ...prev, [user.uid]: currentUserName };
      });
    }
  }, [user?.uid, currentUserName]);

  const [scanOpen, setScanOpen] = useState(false);
  const [hasPermission, setHasPermission] = useState(null);
  const [permission, requestPermission] = useCameraPermissions();
  const scanningLockRef = useRef(false);

  useEffect(() => {
    if (!showAdd) return;
    setForm((prev) => {
      if (
        prev.fridgeId &&
        memberFridgeIds.includes(prev.fridgeId)
      ) {
        return prev;
      }
      if (!memberFridgeIds.length) return prev;
      return { ...prev, fridgeId: memberFridgeIds[0] };
    });
  }, [showAdd, memberFridgeIds]);

  useEffect(() => {
    if (showAdd) return;
    setUnitModalOpen(false);
    setFridgeModalOpen(false);
    setCustomUnitModalOpen(false);
    if (Platform.OS === "ios") setIosDatePickerVisible(false);
    setCustomUnitDraft("");
  }, [showAdd]);

  useEffect(() => {
    if (!user?.uid) {
      setMemberFridgeIds([]);
      return;
    }
    const membershipsRef = collection(db, "users", user.uid, "memberships");
    const unsubscribe = onSnapshot(
      membershipsRef,
      (snap) => {
        const ids = [];
        snap.forEach((docSnap) => {
          const data = docSnap.data() || {};
          const fid = data.fridgeId || docSnap.id;
          if (fid) ids.push(fid);
        });
        setMemberFridgeIds(Array.from(new Set(ids)));
      },
      (err) => {
        console.warn("Stock memberships error:", err);
        setMemberFridgeIds([]);
      }
    );
    return () => unsubscribe();
  }, [user?.uid]);

  const memberKey = useMemo(
    () => memberFridgeIds.slice().sort().join("|"),
    [memberFridgeIds]
  );

  const targetFridges = useMemo(
    () => Array.from(new Set(memberFridgeIds)),
    [memberKey]
  );

  const stockFridges = useMemo(() => targetFridges, [targetFridges]);
  const stockFridgeKey = useMemo(
    () => stockFridges.slice().sort().join("|"),
    [stockFridges]
  );
  const targetFridgeKey = useMemo(
    () => targetFridges.slice().sort().join("|"),
    [targetFridges]
  );
  const fridgeOptions = useMemo(
    () =>
      targetFridges.map((fid) => ({
        id: fid,
        name:
          fridgeMeta[fid]?.name ||
          `Fridge ${fid.slice(-4).toUpperCase()}`,
      })),
    [targetFridges, fridgeMeta]
  );
  const fridgeCount = fridgeOptions.length;
  const selectedFridgeId = form.fridgeId || "";
  const selectedFridgeMeta = selectedFridgeId
    ? fridgeMeta[selectedFridgeId] || null
    : null;
  const selectedFridgeLabel = selectedFridgeMeta?.name
    ? selectedFridgeMeta.name
    : selectedFridgeId
    ? `Fridge ${selectedFridgeId.slice(-4).toUpperCase()}`
    : "Select fridge";

  useEffect(() => {
    if (!targetFridges.length) {
      setFridgeMeta({});
      return;
    }
    let cancelled = false;
    (async () => {
      const missing = targetFridges.filter((fid) => !fridgeMeta[fid]);
      if (!missing.length) return;
      const results = await Promise.all(
        missing.map(async (fid) => {
          const snap = await getDoc(doc(db, "fridges", fid));
          const name = snap.exists()
            ? snap.data()?.name || `Fridge ${fid.slice(-4).toUpperCase()}`
            : `Fridge ${fid.slice(-4).toUpperCase()}`;
          return [fid, { name }];
        })
      );
      if (cancelled) return;
      setFridgeMeta((prev) => {
        const next = { ...prev };
        results.forEach(([fid, meta]) => {
          next[fid] = meta;
        });
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetFridgeKey]);

  useEffect(() => {
    if (!stockFridges.length) {
      setStock([]);
      setLoadingStock(false);
      return;
    }
    setLoadingStock(true);
    const unsubscribes = [];
    const cache = new Map();

    const parseDoc = (fid, snap) => {
      const data = snap.data() || {};
      const qty = Number(data.qty) || 0;
      const lowThreshold =
        typeof data.lowThreshold === "number"
          ? data.lowThreshold
          : Number(data.lowThreshold) || 0;
      const expireMs = data?.expireDate?.toMillis?.();
      const now = Date.now();
      const item = {
        id: snap.id,
        fridgeId: fid,
        name: data.name || "Untitled item",
        qty,
        unit: data.unit || DEFAULT_UNIT,
        expireDate: data.expireDate || null,
        barcode: data.barcode || "",
        lowThreshold,
      };
      item._isExpiring = !!(expireMs && expireMs - now <= THREE_DAYS);
      item._isLow = lowThreshold > 0 && qty <= lowThreshold;
      return item;
    };

    stockFridges.forEach((fid) => {
      const unsub = onSnapshot(
        collection(db, "fridges", fid, "stock"),
        (snap) => {
          const items = [];
          snap.forEach((docSnap) => items.push(parseDoc(fid, docSnap)));
          cache.set(fid, items);
          const merged = Array.from(cache.values()).flat();
          const aggregated = aggregateStockItems(merged);
          setStock(aggregated);
          setLoadingStock(false);
        },
        (err) => {
          console.warn("stock snapshot error", err);
          setLoadingStock(false);
          Alert.alert("Could not load items", err.message || "Something went wrong");
        }
      );
      unsubscribes.push(unsub);
    });

    return () => unsubscribes.forEach((fn) => fn && fn());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stockFridgeKey]);

  useEffect(() => {
    const missing = history
      .map((log) => log.byUid)
      .filter((uid) => uid && !userNameCache[uid]);
    const uniqueMissing = Array.from(new Set(missing));
    if (!uniqueMissing.length) return;
    let cancelled = false;
    (async () => {
      const updates = {};
      for (const uid of uniqueMissing) {
        try {
          const snap = await getDoc(doc(db, "users", uid));
          if (snap.exists()) {
            const data = snap.data() || {};
            updates[uid] =
              data.displayName ||
              data.name ||
              data.email ||
              `Member ${uid.slice(-4).toUpperCase()}`;
          } else {
            updates[uid] = `Member ${uid.slice(-4).toUpperCase()}`;
          }
        } catch (err) {
          console.warn("user lookup failed", err);
          updates[uid] = `Member ${uid.slice(-4).toUpperCase()}`;
        }
      }
      if (!cancelled && Object.keys(updates).length) {
        setUserNameCache((prev) => ({ ...prev, ...updates }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [history, userNameCache]);

  useEffect(() => {
    if (!stockFridges.length) {
      setHistory([]);
      setLoadingHistory(false);
      return;
    }
    setLoadingHistory(true);
    const unsubscribes = [];
    const cache = new Map();

    stockFridges.forEach((fid) => {
      const q = query(
        collection(db, "fridges", fid, "stockHistory"),
        orderBy("ts", "desc")
      );
      const unsub = onSnapshot(
        q,
        (snap) => {
          const list = [];
          snap.forEach((docSnap) =>
            list.push({ fridgeId: fid, id: docSnap.id, ...docSnap.data() })
          );
          cache.set(fid, list);
          const merged = Array.from(cache.values())
            .flat()
            .sort(
              (a, b) => (b.ts?.toMillis?.() || 0) - (a.ts?.toMillis?.() || 0)
            )
            .slice(0, 100);
          setHistory(merged);
          setLoadingHistory(false);
        },
        (err) => {
        console.warn("history snapshot error", err);
        setLoadingHistory(false);
        }
      );
      unsubscribes.push(unsub);
    });

    return () => unsubscribes.forEach((fn) => fn && fn());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stockFridgeKey]);

  useEffect(() => {
    if (!scanOpen) return;
    (async () => {
      if (!permission) {
        const { granted } = await requestPermission();
        setHasPermission(!!granted);
      } else {
        setHasPermission(!!permission.granted);
        if (!permission.granted) {
          const { granted } = await requestPermission();
          setHasPermission(!!granted);
        }
      }
    })();
  }, [scanOpen, permission, requestPermission]);

  const filteredItems = useMemo(() => {
    if (activeFilter === "exp") return stock.filter((item) => item._isExpiring);
    if (activeFilter === "low") return stock.filter((item) => item._isLow);
    if (activeFilter === "all") return stock;
    if (activeFilter === "none") return [];
    return stock;
  }, [stock, activeFilter]);
  const stats = useMemo(() => {
    let totalQty = 0;
    let expCount = 0;
    let lowCount = 0;
    stock.forEach((item) => {
      totalQty += Number(item.qty) || 0;
      if (item._isExpiring) expCount += 1;
      if (item._isLow) lowCount += 1;
    });
    return { totalQty, expCount, lowCount };
  }, [stock]);

  const addItem = async () => {
    const targetFridgeId = selectedFridgeId;
    if (!targetFridgeId) {
      Alert.alert(
        "Select a fridge",
        "Choose which fridge to add this item to before saving."
      );
      return;
    }
    if (!targetFridges.includes(targetFridgeId)) {
      Alert.alert(
        "Access denied",
        "You can only add stock to fridges you are a member of."
      );
      return;
    }
    if (!form.name.trim()) {
      Alert.alert("Name required", "Please fill in the item name before saving.");
      return;
    }
    const numericQty = Number(form.qty);
    const safeQty = Number.isFinite(numericQty) && numericQty > 0 ? numericQty : 1;
    const parsedDate = form.expireDate ? parseInputDate(form.expireDate) : null;
    if (form.expireDate && !parsedDate) {
      Alert.alert(
        "Invalid date",
        "Please choose a valid expiry date (format YYYY-MM-DD)."
      );
      return;
    }
    try {
      const expTimestamp = parsedDate ? Timestamp.fromDate(parsedDate) : null;
      const batch = writeBatch(db);
      const stockRef = doc(collection(db, "fridges", targetFridgeId, "stock"));
      const trimmedBarcode = form.barcode.trim();
      const trimmedName = form.name.trim();
      const chosenUnit = form.unit || DEFAULT_UNIT;
      batch.set(stockRef, {
        name: trimmedName,
        qty: safeQty,
        unit: chosenUnit,
        expireDate: expTimestamp,
        barcode: trimmedBarcode,
        lowThreshold: 1,
        status: "in_stock",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        addedBy: user?.uid || null,
        updatedBy: user?.uid || null,
      });
      const historyRef = doc(
        collection(db, "fridges", targetFridgeId, "stockHistory")
      );
      batch.set(historyRef, {
        type: "add",
        name: trimmedName,
        qty: safeQty,
        unit: chosenUnit,
        stockId: stockRef.id,
        byUid: user?.uid || null,
        byName: currentUserName,
        ts: serverTimestamp(),
      });
      if (trimmedBarcode) {
        batch.set(
          doc(db, "barcodes", trimmedBarcode),
          {
            name: trimmedName,
            unitDefault: chosenUnit,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }
      await batch.commit();
      setForm((prev) => ({
        name: "",
        qty: "1",
        unit: prev.unit || DEFAULT_UNIT,
        expireDate: "",
        barcode: "",
        fridgeId: prev.fridgeId || targetFridgeId,
      }));
      setShowAdd(false);
    } catch (err) {
      Alert.alert("Could not save item", err.message || "Something went wrong");
    }
  };

  const handleUnitSelect = (unitValue) => {
    if (unitValue === OTHER_UNIT_VALUE) {
      setUnitModalOpen(false);
      const currentUnit = (form.unit || "").trim();
      setCustomUnitDraft(
        currentUnit &&
          !UNIT_OPTIONS.some(
            (opt) =>
              opt !== OTHER_UNIT_VALUE &&
              opt.toLowerCase() === currentUnit.toLowerCase()
          )
          ? currentUnit
          : ""
      );
      setCustomUnitModalOpen(true);
      return;
    }
    setForm((prev) => ({ ...prev, unit: unitValue || DEFAULT_UNIT }));
    setUnitModalOpen(false);
  };

  const handleFridgeSelect = (fid) => {
    setForm((prev) => ({ ...prev, fridgeId: fid }));
    setFridgeModalOpen(false);
  };

  const handleSaveCustomUnit = () => {
    const trimmed = customUnitDraft.trim();
    if (!trimmed) {
      Alert.alert("Unit required", "Please enter a unit name.");
      return;
    }
    setForm((prev) => ({ ...prev, unit: trimmed }));
    setCustomUnitModalOpen(false);
  };

  const openDatePicker = () => {
    const baseDate =
      parseInputDate(form.expireDate) || new Date();
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({
        mode: "date",
        value: baseDate,
        onChange: (_, selectedDate) => {
          if (selectedDate) {
            setForm((prev) => ({
              ...prev,
              expireDate: formatInputDate(selectedDate),
            }));
          }
        },
      });
      return;
    }
    setIosDateValue(baseDate);
    setIosDatePickerVisible(true);
  };

  const onScan = async ({ data }) => {
    if (scanningLockRef.current) return;
    scanningLockRef.current = true;
    try {
      setScanOpen(false);
      const ref = doc(db, "barcodes", data);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const payload = snap.data() || {};
        setForm((prev) => ({
          ...prev,
          barcode: data,
          name: prev.name || payload.name || "",
          unit: prev.unit || payload.unitDefault || DEFAULT_UNIT,
        }));
      } else {
        setForm((prev) => ({ ...prev, barcode: data }));
        Alert.alert(
          "Barcode not recognised",
          "Fill in the details and they will be remembered for next time."
        );
      }
    } catch (err) {
      Alert.alert("Scan failed", err.message || "Something went wrong");
    } finally {
      setTimeout(() => {
        scanningLockRef.current = false;
      }, 400);
    }
  };

  const statCards = [
    { key: "all", label: "All items", value: stats.totalQty },
    { key: "exp", label: "Expiring soon", value: stats.expCount },
    { key: "low", label: "Low stock", value: stats.lowCount },
  ];

  const headerTitle = "All fridges overview";
  const headerSubtitle = `Tracking ${fridgeCount} fridge${fridgeCount === 1 ? "" : "s"} - tap a category to filter items.`;
  const showHistoryOnly = activeFilter === "none";

  const renderItem = ({ item }) => {
    const fridgeLabel =
      fridgeMeta[item.fridgeId]?.name ||
      `Fridge ${item.fridgeId.slice(-4).toUpperCase()}`;
    const badges = [];
    if (item._isExpiring) badges.push({ text: "Expiring soon", tone: "warn" });
    if (item._isLow) badges.push({ text: "Low stock", tone: "danger" });
    const available = Number(item.qty) || 0;
    const expiresOn = formatDate(item.expireDate);

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>{item.name}</Text>
            <Text style={styles.cardQty}>
              In stock {available} {item.unit}
            </Text>
          </View>
          <View style={styles.fridgeBadge}>
            <Text style={styles.fridgeBadgeText}>{fridgeLabel}</Text>
          </View>
        </View>

        {badges.length > 0 && (
          <View style={[styles.badgeRow, { marginTop: 8 }]}>
            {badges.map((badge) => (
              <View
                key={`${item.id}_${badge.text}`}
                style={[
                  styles.badge,
                  badge.tone === "warn" && styles.badgeWarn,
                  badge.tone === "danger" && styles.badgeDanger,
                ]}
              >
                <Text
                  style={[
                    styles.badgeText,
                    badge.tone === "warn" && styles.badgeTextWarn,
                    badge.tone === "danger" && styles.badgeTextDanger,
                  ]}
                >
                  {badge.text}
                </Text>
              </View>
            ))}
          </View>
        )}

        <View style={[styles.metaRow, { marginTop: 12 }]}>
          <Text style={styles.metaLabel}>Expires on</Text>
          <Text style={styles.metaValue}>{expiresOn}</Text>
        </View>
      </View>
    );
  };

  const HistorySection = () => (
    <View style={styles.historySection}>
      <Text style={styles.sectionTitle}>History</Text>
      {loadingHistory ? (
        <ActivityIndicator />
      ) : history.length === 0 ? (
        <Text style={styles.emptyText}>No history yet</Text>
      ) : (
        history.map((log) => {
          const label = log.type === "add" ? "Added" : "Removed";
          const color = log.type === "add" ? "#2D9CDB" : "#EB5757";
          const fridgeLabel =
            fridgeMeta[log.fridgeId]?.name ||
            `Fridge ${log.fridgeId.slice(-4).toUpperCase()}`;
          const actor =
            (typeof log.byName === "string" && log.byName.trim()) ||
            (log.byUid && userNameCache[log.byUid]
              ? userNameCache[log.byUid]
              : log.byUid
              ? `Member ${log.byUid.slice(-4).toUpperCase()}`
              : "Unknown member");
          return (
            <View
              key={`${log.fridgeId}_${log.id}`}
              style={styles.historyItem}
            >
              <View style={styles.historyLeft}>
                <View style={styles.historyTopRow}>
                  <Text style={[styles.historyType, { color }]}>{label}</Text>
                  <Text style={styles.historyName}>{log.name}</Text>
                  <Text style={styles.historyMeta}>
                    x{log.qty} {log.unit || ""}
                  </Text>
                </View>
                <Text style={styles.historyMeta}>
                  {fridgeLabel}
                </Text>
                <Text style={styles.historyMetaSmall}>
                  {formatDateTime(log.ts)}
                </Text>
                <Text style={styles.historyMetaSmall}>
                  by {actor}
                </Text>
              </View>
            </View>
          );
        })
      )}
    </View>
  );
  const listHeader = (
    <View style={styles.listHeader}>
      <Text style={styles.title}>{headerTitle}</Text>
      <Text style={styles.subtitle}>{headerSubtitle}</Text>
      <View style={styles.dashboardRow}>
        {statCards.map((card) => (
          <TouchableOpacity
            key={card.key}
            style={[
              styles.dashboardCard,
              activeFilter === card.key && styles.dashboardCardActive,
            ]}
            onPress={() => setActiveFilter((prev) => (prev === card.key ? "none" : card.key))}
          >
            <Text style={styles.dashboardValue}>{card.value}</Text>
            <Text style={styles.dashboardLabel}>{card.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={filteredItems}
        keyExtractor={(item) => `${item.fridgeId}_${item.id}`}
        renderItem={renderItem}
        ListHeaderComponent={listHeader}
        ListFooterComponent={showHistoryOnly ? HistorySection : null}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          showHistoryOnly
            ? null
            : loadingStock ? (
                <ActivityIndicator
                  style={{ marginTop: 32, alignSelf: "center" }}
                />
              ) : (
                <View style={styles.emptyCard}>
                  <Text style={styles.emptyCardTitle}>
                    {activeFilter === "exp"
                      ? "Nothing expiring soon"
                      : activeFilter === "low"
                      ? "No low stock items"
                      : "No items in this filter"}
                  </Text>
                  <Text style={styles.emptyCardSubtitle}>
                    Switch filters or adjust your selection to keep browsing.
                  </Text>
                </View>
              )
        }
      />

      <TouchableOpacity
        style={styles.fab}
        onPress={() => setShowAdd(true)}
        activeOpacity={0.8}
      >
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>

      <Modal
        visible={showAdd}
        animationType="slide"
        onRequestClose={() => setShowAdd(false)}
      >
        <View style={styles.modalContainer}>
          <Text style={styles.modalTitle}>Add items to fridge</Text>
          <Text style={styles.modalHint}>
            Fill the details or scan a barcode to preload information.
          </Text>

          <>
            <TouchableOpacity
              style={[
                styles.input,
                styles.selectorInput,
                !selectedFridgeId && styles.selectorInputPlaceholder,
              ]}
              onPress={() => setFridgeModalOpen(true)}
              activeOpacity={0.85}
            >
              <Text
                style={[
                  styles.selectorInputText,
                  !selectedFridgeId && styles.selectorPlaceholderText,
                ]}
              >
                {selectedFridgeLabel}
              </Text>
            </TouchableOpacity>
            {fridgeOptions.length === 0 && (
              <Text style={styles.helperText}>
                Join or create a fridge to start tracking items.
              </Text>
            )}
          </>

          <TextInput
            style={styles.input}
            placeholder="Item name"
            value={form.name}
            onChangeText={(text) => setForm((prev) => ({ ...prev, name: text }))}
          />

          <View style={styles.row}>
            <TextInput
              style={[styles.input, styles.halfInput]}
              placeholder="Quantity"
              keyboardType="numeric"
              value={form.qty}
              onChangeText={(text) => setForm((prev) => ({ ...prev, qty: text }))}
            />
            <TouchableOpacity
              style={[styles.input, styles.halfInput, styles.selectorInput]}
              onPress={() => setUnitModalOpen(true)}
              activeOpacity={0.85}
            >
              <Text style={styles.selectorInputText}>
                {form.unit || DEFAULT_UNIT}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.row}>
            <TextInput
              style={[styles.input, styles.flexInput]}
              placeholder="Expiry date (YYYY-MM-DD)"
              value={form.expireDate}
              onChangeText={(text) =>
                setForm((prev) => ({ ...prev, expireDate: text }))
              }
            />
            <TouchableOpacity
              style={[styles.secondaryButton, styles.pickerButton]}
              onPress={() => openDatePicker()}
            >
              <Text style={styles.secondaryButtonText}>Pick date</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.row}>
            <TextInput
              style={[styles.input, styles.barcodeInput]}
              placeholder="Barcode (optional)"
              value={form.barcode}
              onChangeText={(text) =>
                setForm((prev) => ({ ...prev, barcode: text }))
              }
            />
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => setScanOpen(true)}
            >
              <Text style={styles.secondaryButtonText}>Scan</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.modalActions}>
            <TouchableOpacity
              style={[styles.secondaryButton, styles.actionButton]}
              onPress={() => setShowAdd(false)}
            >
              <Text style={styles.secondaryButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.primaryButton, styles.actionButton]}
              onPress={addItem}
            >
              <Text style={styles.primaryButtonText}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={scanOpen}
        animationType="fade"
        onRequestClose={() => setScanOpen(false)}
      >
        <View style={styles.scannerContainer}>
          {hasPermission === false ? (
            <View style={styles.scannerFallback}>
              <Text style={styles.scannerText}>
                Camera permission has not been granted.
              </Text>
              <TouchableOpacity
                style={[styles.primaryButton, { marginTop: 12 }]}
                onPress={() => setScanOpen(false)}
              >
                <Text style={styles.primaryButtonText}>Close</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.scannerPreview}>
              <CameraView
                style={styles.camera}
                facing="back"
                barcodeScannerSettings={{
                  barcodeTypes: ["qr", "ean13", "ean8", "code128"],
                }}
                onBarcodeScanned={(event) => {
                  if (!event?.data) return;
                  onScan({ data: event.data });
                }}
              />
              <View style={styles.scanOverlay} pointerEvents="box-none">
                <View style={styles.overlayHeader}>
                  <TouchableOpacity
                    style={styles.closeButton}
                    onPress={() => setScanOpen(false)}
                  >
                    <Text style={styles.closeButtonText}>Close</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.overlayBody} pointerEvents="none">
                  <View style={styles.overlayTop} />
                  <View style={styles.overlayCenterRow}>
                    <View style={styles.overlaySide} />
                    <View style={styles.overlayFrame}>
                      <View style={[styles.corner, styles.cornerTopLeft]} />
                      <View style={[styles.corner, styles.cornerTopRight]} />
                      <View style={[styles.corner, styles.cornerBottomLeft]} />
                      <View
                        style={[styles.corner, styles.cornerBottomRight]}
                      />
                    </View>
                    <View style={styles.overlaySide} />
                  </View>
                  <View style={styles.overlayBottom} />
                </View>
                <View style={styles.overlayFooter}>
                  <Text style={styles.scanInstruction}>
                    Align the barcode within the frame
                  </Text>
                </View>
              </View>
            </View>
          )}
        </View>
      </Modal>

      <Modal
        visible={unitModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setUnitModalOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={styles.modalBackdrop}
            activeOpacity={1}
            onPress={() => setUnitModalOpen(false)}
          />
          <View style={styles.modalSheet}>
            <Text style={styles.modalSheetTitle}>Select unit</Text>
            <ScrollView style={{ maxHeight: 280 }}>
              {UNIT_OPTIONS.map((option) => {
                const isOther = option === OTHER_UNIT_VALUE;
                const optionLabel = isOther ? "Other (type manually)" : option;
                const normalized = (form.unit || DEFAULT_UNIT).toLowerCase();
                const active = isOther
                  ? !UNIT_OPTIONS.some(
                      (opt) =>
                        opt !== OTHER_UNIT_VALUE &&
                        opt.toLowerCase() === normalized
                    )
                  : normalized === option.toLowerCase();
                return (
                  <TouchableOpacity
                    key={option}
                    style={[
                      styles.modalOption,
                      active && styles.modalOptionActive,
                    ]}
                    onPress={() => handleUnitSelect(option)}
                  >
                    <Text
                      style={[
                      styles.modalOptionText,
                      active && styles.modalOptionTextActive,
                    ]}
                  >
                      {optionLabel}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal
        visible={customUnitModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setCustomUnitModalOpen(false);
          setCustomUnitDraft("");
        }}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={styles.modalBackdrop}
            activeOpacity={1}
            onPress={() => setCustomUnitModalOpen(false)}
          />
          <View style={styles.modalSheet}>
            <Text style={styles.modalSheetTitle}>Custom unit</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Enter unit (e.g. bundle, tray)"
              value={customUnitDraft}
              onChangeText={setCustomUnitDraft}
              autoFocus
            />
            <View style={styles.modalSheetActions}>
              <TouchableOpacity
                style={[styles.secondaryButton, styles.modalActionButton]}
                onPress={() => {
                  setCustomUnitModalOpen(false);
                  setCustomUnitDraft("");
                }}
              >
                <Text style={styles.secondaryButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.primaryButton, styles.modalActionButton]}
                onPress={handleSaveCustomUnit}
              >
                <Text style={styles.primaryButtonText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={fridgeModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setFridgeModalOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={styles.modalBackdrop}
            activeOpacity={1}
            onPress={() => setFridgeModalOpen(false)}
          />
          <View style={styles.modalSheet}>
            <Text style={styles.modalSheetTitle}>Select fridge</Text>
            {fridgeOptions.length === 0 ? (
              <Text style={styles.helperText}>
                You do not have any fridges yet.
              </Text>
            ) : (
              <ScrollView style={{ maxHeight: 320 }}>
                {fridgeOptions.map((option) => {
                  const active = option.id === selectedFridgeId;
                  return (
                    <TouchableOpacity
                      key={option.id}
                      style={[
                        styles.modalOption,
                        active && styles.modalOptionActive,
                      ]}
                      onPress={() => handleFridgeSelect(option.id)}
                    >
                      <Text
                        style={[
                          styles.modalOptionText,
                          active && styles.modalOptionTextActive,
                        ]}
                      >
                        {option.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {Platform.OS === "ios" && (
        <Modal
          visible={iosDatePickerVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setIosDatePickerVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <TouchableOpacity
              style={styles.modalBackdrop}
              activeOpacity={1}
              onPress={() => setIosDatePickerVisible(false)}
            />
            <View style={[styles.modalSheet, styles.dateSheet]}>
              <Text style={styles.modalSheetTitle}>Select expiry date</Text>
              <DateTimePicker
                value={iosDateValue}
                mode="date"
                display="spinner"
                onChange={(_, selectedDate) => {
                  if (selectedDate) setIosDateValue(selectedDate);
                }}
              />
              <View style={styles.modalSheetActions}>
                <TouchableOpacity
                  style={[styles.secondaryButton, styles.modalActionButton]}
                  onPress={() => setIosDatePickerVisible(false)}
                >
                  <Text style={styles.secondaryButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.primaryButton, styles.modalActionButton]}
                  onPress={() => {
                    setForm((prev) => ({
                      ...prev,
                      expireDate: formatInputDate(iosDateValue),
                    }));
                    setIosDatePickerVisible(false);
                  }}
                >
                  <Text style={styles.primaryButtonText}>Save</Text>
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
  container: {
    flex: 1,
    backgroundColor: "#F5F7FB",
  },
  listContent: {
    padding: 16,
    paddingBottom: 120,
  },
  listHeader: {
    marginBottom: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: "800",
    color: "#1F2A5C",
  },
  subtitle: {
    marginTop: 4,
    color: "#6B7280",
  },
  dashboardRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 16,
  },
  dashboardCard: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E4E9F5",
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "transparent",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  dashboardCardActive: {
    backgroundColor: "#EEF4FF",
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: "#2D5BFF",
    shadowColor: "transparent",
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  dashboardValue: {
    fontSize: 24,
    fontWeight: "800",
    color: "#1F2A5C",
  },
  dashboardLabel: {
    marginTop: 4,
    color: "#1F2A5C",
    fontWeight: "600",
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 16,
    marginTop: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 1,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 8,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1F2A5C",
  },
  cardQty: {
    marginTop: 6,
    color: "#3563E9",
    fontWeight: "700",
  },
  fridgeBadge: {
    backgroundColor: "#EEF4FF",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    marginLeft: 12,
  },
  fridgeBadgeText: {
    color: "#2D5BFF",
    fontWeight: "700",
  },
  badgeRow: {
    flexDirection: "row",
    gap: 8,
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
    color: "#1F2A5C",
    fontSize: 12,
    fontWeight: "600",
  },
  badgeTextWarn: {
    color: "#B45309",
  },
  badgeTextDanger: {
    color: "#B91C1C",
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 4,
  },
  metaLabel: {
    color: "#6B7280",
  },
  metaValue: {
    color: "#1F2A5C",
    fontWeight: "600",
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1F2A5C",
  },
  historySection: {
    marginTop: 28,
  },
  historyItem: {
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    padding: 12,
    marginTop: 12,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  historyLeft: {
    flex: 1,
  },
  historyTopRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  historyType: {
    fontWeight: "800",
  },
  historyName: {
    fontWeight: "700",
    color: "#1F2A5C",
  },
  historyMeta: {
    color: "#6B7280",
  },
  historyTime: {
    color: "#9CA3AF",
    fontSize: 12,
  },
  emptyText: {
    textAlign: "center",
    color: "#9CA3AF",
  },
  emptyCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    paddingVertical: 24,
    paddingHorizontal: 20,
    marginTop: 24,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  emptyCardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1F2A5C",
  },
  emptyCardSubtitle: {
    marginTop: 6,
    color: "#6B7280",
    textAlign: "center",
  },
  fab: {
    position: "absolute",
    right: 20,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#2D5BFF",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 5,
  },
  fabText: {
    color: "#FFFFFF",
    fontSize: 28,
    fontWeight: "800",
    marginTop: -2,
  },
  modalContainer: {
    flex: 1,
    padding: 20,
    backgroundColor: "#FFFFFF",
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#1F2A5C",
  },
  modalHint: {
    marginTop: 6,
    color: "#6B7280",
  },
  input: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 16,
    backgroundColor: "#F9FAFB",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 16,
  },
  halfInput: {
    flex: 1,
  },
  flexInput: {
    flex: 1,
  },
  barcodeInput: {
    flex: 1,
    marginRight: 12,
  },
  selectorInput: {
    justifyContent: "center",
  },
  selectorInputPlaceholder: {
    borderColor: "#D1D5DB",
  },
  selectorInputText: {
    fontWeight: "600",
    color: "#1F2A5C",
  },
  selectorPlaceholderText: {
    color: "#9CA3AF",
  },
  helperText: {
    marginTop: 6,
    color: "#9CA3AF",
    fontSize: 12,
  },
  modalActions: {
    flexDirection: "row",
    gap: 12,
    marginTop: 32,
  },
  primaryButton: {
    backgroundColor: "#2D5BFF",
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 12,
    alignItems: "center",
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontWeight: "700",
  },
  secondaryButton: {
    backgroundColor: "#EEF4FF",
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 12,
    alignItems: "center",
  },
  pickerButton: {
    marginLeft: 12,
    paddingHorizontal: 16,
  },
  secondaryButtonText: {
    color: "#2D5BFF",
    fontWeight: "700",
  },
  actionButton: {
    flex: 1,
  },
  scannerContainer: {
    flex: 1,
    backgroundColor: "#000",
  },
  scannerFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: "#fff",
  },
  scannerText: {
    textAlign: "center",
    color: "#1F2A5C",
  },
  scannerPreview: {
    flex: 1,
    backgroundColor: "#000",
    position: "relative",
  },
  camera: {
    ...StyleSheet.absoluteFillObject,
  },
  scanOverlay: {
    ...StyleSheet.absoluteFillObject,
    paddingTop: 48,
    paddingBottom: 36,
    paddingHorizontal: 24,
    justifyContent: "space-between",
  },
  overlayHeader: {
    alignItems: "flex-end",
  },
  closeButton: {
    backgroundColor: "rgba(17, 24, 39, 0.65)",
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 999,
  },
  closeButtonText: {
    color: "#FFFFFF",
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  overlayBody: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    width: "100%",
  },
  overlayTop: {
    width: "100%",
    flex: 1,
    backgroundColor: "rgba(17, 24, 39, 0.55)",
  },
  overlayCenterRow: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    maxWidth: 360,
  },
  overlaySide: {
    flex: 1,
    height: 260,
    backgroundColor: "rgba(17, 24, 39, 0.55)",
  },
  overlayFrame: {
    width: 260,
    height: 260,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: "rgba(255, 255, 255, 0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  corner: {
    position: "absolute",
    width: 36,
    height: 36,
    borderColor: "#FFFFFF",
  },
  cornerTopLeft: {
    top: -1.5,
    left: -1.5,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderRadius: 10,
  },
  cornerTopRight: {
    top: -1.5,
    right: -1.5,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderRadius: 10,
  },
  cornerBottomLeft: {
    bottom: -1.5,
    left: -1.5,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderRadius: 10,
  },
  cornerBottomRight: {
    bottom: -1.5,
    right: -1.5,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderRadius: 10,
  },
  overlayBottom: {
    width: "100%",
    flex: 1,
    backgroundColor: "rgba(17, 24, 39, 0.55)",
  },
  overlayFooter: {
    paddingTop: 16,
    alignItems: "center",
  },
  scanInstruction: {
    color: "#F9FAFB",
    fontWeight: "600",
    textAlign: "center",
    fontSize: 16,
    letterSpacing: 0.2,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(17, 24, 39, 0.45)",
    justifyContent: "center",
    padding: 24,
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  modalSheet: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 20,
    elevation: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
  },
  modalSheetTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1F2A5C",
    marginBottom: 12,
  },
  modalOption: {
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 10,
    marginBottom: 4,
  },
  modalOptionActive: {
    backgroundColor: "#EEF4FF",
  },
  modalOptionText: {
    fontSize: 16,
    color: "#1F2A5C",
  },
  modalOptionTextActive: {
    fontWeight: "700",
    color: "#2D5BFF",
  },
  modalInput: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "#F9FAFB",
    marginTop: 12,
  },
  dateSheet: {
    paddingBottom: 16,
  },
  modalSheetActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
    marginTop: 12,
  },
  modalActionButton: {
    minWidth: 100,
  },
});
