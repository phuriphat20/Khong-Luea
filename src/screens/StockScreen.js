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
} from "react-native";
import { useRoute } from "@react-navigation/native";
import { CameraView, useCameraPermissions } from "expo-camera";
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  where,
  writeBatch,
} from "firebase/firestore";
import AppCtx from "../context/AppContext";
import { db } from "../services/firebaseConnected";

const THREE_DAYS = 3 * 24 * 3600 * 1000;
const DEFAULT_UNIT = "pcs";

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

export default function StockScreen() {
  const { user } = useContext(AppCtx);
  const route = useRoute();
  const fridgeIdFromHome = route?.params?.fridgeId ?? null;
  const initialFilter = fridgeIdFromHome ? "all" : "none";

  const [memberFridgeIds, setMemberFridgeIds] = useState([]);
  const [fridgeMeta, setFridgeMeta] = useState({});
  const [stock, setStock] = useState([]);
  const [history, setHistory] = useState([]);
  const [activeFilter, setActiveFilter] = useState(initialFilter); // none | all | exp | low
  const [loadingStock, setLoadingStock] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(true);

  const [removalDraft, setRemovalDraft] = useState({});
  const [processingId, setProcessingId] = useState(null);

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({
    name: "",
    qty: "1",
    unit: DEFAULT_UNIT,
    expireDate: "",
    barcode: "",
  });

  const [scanOpen, setScanOpen] = useState(false);
  const [hasPermission, setHasPermission] = useState(null);
  const [permission, requestPermission] = useCameraPermissions();
  const scanningLockRef = useRef(false);

  const modeFridgeId = fridgeIdFromHome || null;
  const isSingleFridge = !!modeFridgeId;

  useEffect(() => {
    if (!user?.uid) return;
    let mounted = true;
    (async () => {
      const mSnap = await getDocs(
        query(collectionGroup(db, "members"), where("uid", "==", user.uid))
      );
      if (!mounted) return;
      const ids = [
        ...new Set(mSnap.docs.map((d) => d.ref.parent.parent.id)),
      ];
      setMemberFridgeIds(ids);
    })();
    return () => {
      mounted = false;
    };
  }, [user?.uid]);

  const memberKey = useMemo(
    () => memberFridgeIds.slice().sort().join("|"),
    [memberFridgeIds]
  );

  const targetFridges = useMemo(() => {
    const set = new Set(memberFridgeIds);
    if (modeFridgeId) set.add(modeFridgeId);
    return Array.from(set);
  }, [memberKey, modeFridgeId]);

  useEffect(() => {
    setActiveFilter(fridgeIdFromHome ? "all" : "none");
  }, [fridgeIdFromHome]);

  const stockFridges = useMemo(
    () => (modeFridgeId ? [modeFridgeId] : targetFridges),
    [modeFridgeId, targetFridges]
  );
  const stockFridgeKey = useMemo(
    () => stockFridges.slice().sort().join("|"),
    [stockFridges]
  );
  const targetFridgeKey = useMemo(
    () => targetFridges.slice().sort().join("|"),
    [targetFridges]
  );

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

    const sortStock = (list) =>
      list.slice().sort((a, b) => {
        const aName = (a.name || "").toString();
        const bName = (b.name || "").toString();
        const cmp = aName.localeCompare(bName, "th");
        if (cmp !== 0) return cmp;
        return (b.qty || 0) - (a.qty || 0);
      });

    stockFridges.forEach((fid) => {
      const unsub = onSnapshot(
        collection(db, "fridges", fid, "stock"),
        (snap) => {
          const items = [];
          snap.forEach((docSnap) => items.push(parseDoc(fid, docSnap)));
          cache.set(fid, items);
          const merged = Array.from(cache.values()).flat();
          setStock(sortStock(merged));
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
    if (!isSingleFridge) {
      if (Object.keys(removalDraft).length) setRemovalDraft({});
      return;
    }
    setRemovalDraft((prev) => {
      const next = {};
      let changed = false;
      stock.forEach((item) => {
        const current = prev[item.id] || 0;
        if (!current) return;
        const max = Number(item.qty) || 0;
        if (max <= 0) {
          changed = true;
          return;
        }
        const clamped = Math.min(current, max);
        if (clamped !== current) changed = true;
        if (clamped > 0) next[item.id] = clamped;
      });
      if (
        !changed &&
        Object.keys(next).length === Object.keys(prev).length &&
        Object.keys(next).every((k) => next[k] === prev[k])
      ) {
        return prev;
      }
      return next;
    });
  }, [isSingleFridge, stock]);

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
    const totalItems = stock.length;
    let expCount = 0;
    let lowCount = 0;
    stock.forEach((item) => {
      if (item._isExpiring) expCount += 1;
      if (item._isLow) lowCount += 1;
    });
    return { totalItems, expCount, lowCount };
  }, [stock]);

  const adjustRemoval = (itemId, delta, maxQty) => {
    setRemovalDraft((prev) => {
      const current = prev[itemId] || 0;
      const next = Math.max(0, Math.min(maxQty, current + delta));
      if (next <= 0) {
        if (!prev[itemId]) return prev;
        const { [itemId]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [itemId]: next };
    });
  };

  const handleRemove = async (item) => {
    const amount = removalDraft[item.id] || 0;
    if (amount <= 0) {
      Alert.alert(
        "Choose quantity",
        "Set how many items to remove before confirming."
      );
      return;
    }
    setProcessingId(item.id);
    try {
      const stockRef = doc(db, "fridges", item.fridgeId, "stock", item.id);
      const snap = await getDoc(stockRef);
      if (!snap.exists()) {
        Alert.alert("Item not found", "This entry was removed already.");
        return;
      }
      const data = snap.data() || {};
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
      const historyRef = doc(
        collection(db, "fridges", item.fridgeId, "stockHistory")
      );
      batch.set(historyRef, {
        type: "remove",
        name: data.name || item.name,
        qty: actualAmount,
        unit: data.unit || item.unit || DEFAULT_UNIT,
        stockId: stockRef.id,
        byUid: user?.uid || null,
        ts: serverTimestamp(),
      });
      await batch.commit();
      setRemovalDraft((prev) => {
        const { [item.id]: _, ...rest } = prev;
        return rest;
      });
    } catch (err) {
      Alert.alert("Could not remove items", err.message || "Something went wrong");
    } finally {
      setProcessingId(null);
    }
  };

  const addItem = async () => {
    if (!modeFridgeId) {
      Alert.alert(
        "Select a fridge",
        "Open this screen from a specific fridge in Home before adding items."
      );
      return;
    }
    if (!form.name.trim()) {
      Alert.alert("Name required", "Please fill in the item name before saving.");
      return;
    }
    try {
      const expTimestamp = form.expireDate
        ? Timestamp.fromDate(new Date(form.expireDate))
        : null;
      const batch = writeBatch(db);
      const stockRef = doc(collection(db, "fridges", modeFridgeId, "stock"));
      batch.set(stockRef, {
        name: form.name.trim(),
        qty: Number(form.qty) || 1,
        unit: form.unit || DEFAULT_UNIT,
        expireDate: expTimestamp,
        barcode: form.barcode || "",
        lowThreshold: 1,
        updatedAt: serverTimestamp(),
      });
      const historyRef = doc(
        collection(db, "fridges", modeFridgeId, "stockHistory")
      );
      batch.set(historyRef, {
        type: "add",
        name: form.name.trim(),
        qty: Number(form.qty) || 1,
        unit: form.unit || DEFAULT_UNIT,
        stockId: stockRef.id,
        byUid: user?.uid || null,
        ts: serverTimestamp(),
      });
      if (form.barcode.trim()) {
        batch.set(
          doc(db, "barcodes", form.barcode.trim()),
          {
            name: form.name.trim(),
            unitDefault: form.unit || DEFAULT_UNIT,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }
      await batch.commit();
      setForm({
        name: "",
        qty: "1",
        unit: DEFAULT_UNIT,
        expireDate: "",
        barcode: "",
      });
      setShowAdd(false);
    } catch (err) {
      Alert.alert("Could not save item", err.message || "Something went wrong");
    }
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
    { key: "all", label: "All items", value: stats.totalItems, note: "records" },
    { key: "exp", label: "Expiring soon", value: stats.expCount, note: "records" },
    { key: "low", label: "Low stock", value: stats.lowCount, note: "records" },
  ];

  const headerTitle = isSingleFridge
    ? `Items in ${fridgeMeta[modeFridgeId]?.name || "this fridge"}`
    : "All fridges overview";
  const headerSubtitle = isSingleFridge
    ? "Adjust the quantity and tap remove to sync instantly."
    : `Tracking ${targetFridges.length} fridges - tap a category to filter items.`;

  const renderItem = ({ item }) => {
    const fridgeLabel =
      fridgeMeta[item.fridgeId]?.name ||
      `Fridge ${item.fridgeId.slice(-4).toUpperCase()}`;
    const badges = [];
    if (item._isExpiring) badges.push({ text: "Expiring soon", tone: "warn" });
    if (item._isLow) badges.push({ text: "Low stock", tone: "danger" });
    const available = Number(item.qty) || 0;
    const pending = removalDraft[item.id] || 0;
    const disableMinus = processingId === item.id || pending <= 0;
    const disablePlus =
      processingId === item.id || pending >= available || available <= 0;
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
          {!isSingleFridge && (
            <View style={styles.fridgeBadge}>
              <Text style={styles.fridgeBadgeText}>{fridgeLabel}</Text>
            </View>
          )}
        </View>

        {badges.length > 0 && (
          <View style={styles.badgeRow}>
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

        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>Expires on</Text>
          <Text style={styles.metaValue}>{expiresOn}</Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>Barcode</Text>
          <Text style={styles.metaValue}>{item.barcode || "-"}</Text>
        </View>

        {isSingleFridge && (
          <>
            <View style={styles.selectorRow}>
              <TouchableOpacity
                style={[
                  styles.selectorBtn,
                  disableMinus && styles.selectorBtnDisabled,
                ]}
                onPress={() => adjustRemoval(item.id, -1, available)}
                disabled={disableMinus}
              >
                <Text style={styles.selectorText}>-</Text>
              </TouchableOpacity>
              <Text style={styles.selectorValue}>{pending}</Text>
              <TouchableOpacity
                style={[
                  styles.selectorBtn,
                  disablePlus && styles.selectorBtnDisabled,
                ]}
                onPress={() => adjustRemoval(item.id, 1, available)}
                disabled={disablePlus}
              >
                <Text style={styles.selectorText}>+</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={[
                styles.removeButton,
                (pending <= 0 || processingId === item.id) &&
                  styles.removeButtonDisabled,
              ]}
              disabled={pending <= 0 || processingId === item.id}
              onPress={() => handleRemove(item)}
            >
              {processingId === item.id ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.removeButtonText}>
                  Remove {pending || 0} {item.unit}
                </Text>
              )}
            </TouchableOpacity>
          </>
        )}
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
                {!isSingleFridge && (
                  <Text style={styles.historyMeta}>{fridgeLabel}</Text>
                )}
              </View>
              <Text style={styles.historyTime}>{formatDateTime(log.ts)}</Text>
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
            <Text style={styles.dashboardNote}>{card.note}</Text>
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
        ListFooterComponent={activeFilter === "none" ? HistorySection : null}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          loadingStock ? (
            <ActivityIndicator style={{ marginTop: 32, alignSelf: "center" }} />
          ) : (
            <Text style={[styles.emptyText, { marginTop: 32 }]}>
              {activeFilter === "none"
                ? "Select a category above to view matching items."
                : "No items in this filter"}
            </Text>
          )
        }
      />

      {isSingleFridge && (
        <TouchableOpacity
          style={styles.fab}
          onPress={() => setShowAdd(true)}
          activeOpacity={0.8}
        >
          <Text style={styles.fabText}>+</Text>
        </TouchableOpacity>
      )}

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
            <TextInput
              style={[styles.input, styles.halfInput]}
              placeholder="Unit (e.g. pcs, bottle)"
              value={form.unit}
              onChangeText={(text) =>
                setForm((prev) => ({ ...prev, unit: text }))
              }
            />
          </View>

          <TextInput
            style={styles.input}
            placeholder="Expiry date (YYYY-MM-DD)"
            value={form.expireDate}
            onChangeText={(text) =>
              setForm((prev) => ({ ...prev, expireDate: text }))
            }
          />

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
            <CameraView
              style={{ flex: 1 }}
              facing="back"
              barcodeScannerSettings={{
                barcodeTypes: ["qr", "ean13", "ean8", "code128"],
              }}
              onBarcodeScanned={(event) => {
                if (!event?.data) return;
                onScan({ data: event.data });
              }}
            />
          )}
        </View>
      </Modal>
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
  dashboardNote: {
    color: "#6B7280",
    fontSize: 12,
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
    alignItems: "center",
    marginBottom: 8,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1F2A5C",
  },
  cardQty: {
    marginTop: 4,
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
    marginBottom: 8,
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
  selectorRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 16,
  },
  selectorBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#EEF4FF",
  },
  selectorBtnDisabled: {
    opacity: 0.35,
  },
  selectorText: {
    fontSize: 22,
    fontWeight: "800",
    color: "#2D5BFF",
  },
  selectorValue: {
    marginHorizontal: 20,
    fontSize: 18,
    fontWeight: "700",
    color: "#1F2A5C",
  },
  removeButton: {
    marginTop: 16,
    backgroundColor: "#EB5757",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  removeButtonDisabled: {
    backgroundColor: "#F6B7B7",
  },
  removeButtonText: {
    color: "#FFFFFF",
    fontWeight: "700",
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
  barcodeInput: {
    flex: 1,
    marginRight: 12,
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
});

