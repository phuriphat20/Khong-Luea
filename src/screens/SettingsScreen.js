// SettingsScreen.js
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useAppContext } from "../context/AppContext";

export default function SettingsScreen() {
  // Pull global fridge data and helpers from context.
  const {
    user,
    profile,
    fridges,
    currentFridge,
    initializing,
    updateProfile,
    joinFridge,
    leaveFridge,
    setCurrentFridge,
    signOut,
  } = useAppContext();

  // Local edits for profile and invite code handling.
  const [displayName, setDisplayName] = useState(profile?.displayName || "");
  const [inviteCode, setInviteCode] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [joining, setJoining] = useState(false);
  const [settingId, setSettingId] = useState(null);
  const [leavingId, setLeavingId] = useState(null);

  useEffect(() => {
    setDisplayName(profile?.displayName || "");
  }, [profile?.displayName]);

  const emailAddress = profile?.email || user?.email || "Email unavailable";
  const inviteDisabled = joining || !inviteCode.trim();

  const currentFridgeId = profile?.currentFridgeId || null;

  const handleSaveDisplayName = async () => {
    const trimmed = displayName.trim();
    if (!trimmed) {
      Alert.alert("Display name required", "Please enter a display name first.");
      return;
    }

    try {
      setSavingName(true);
      await updateProfile({ displayName: trimmed });
      Alert.alert("Profile updated", "Your display name has been saved.");
    } catch (err) {
      Alert.alert(
        "Update failed",
        err?.message || "We could not update your profile right now."
      );
    } finally {
      setSavingName(false);
    }
  };

  const handleJoinFridge = async () => {
    const trimmed = inviteCode.trim().toUpperCase();
    if (!trimmed) {
      Alert.alert("Invite code needed", "Enter an invite code to join a fridge.");
      return;
    }

    try {
      setJoining(true);
      await joinFridge(trimmed);
      setInviteCode("");
      Alert.alert("You're in!", "Fridge joined successfully.");
    } catch (err) {
      Alert.alert(
        "Join failed",
        err?.message || "We could not join that fridge right now."
      );
    } finally {
      setJoining(false);
    }
  };

  const handleSetCurrent = async (fridge) => {
    if (!fridge?.id || fridge.id === currentFridgeId) {
      return;
    }

    try {
      setSettingId(fridge.id);
      await setCurrentFridge(fridge.id);
      Alert.alert("Current fridge updated", `Tracking ${fridge.name || "fridge"}.`);
    } catch (err) {
      Alert.alert(
        "Unable to set current fridge",
        err?.message || "Please try again."
      );
    } finally {
      setSettingId(null);
    }
  };

  const confirmLeaveFridge = (fridge) => {
    if (!fridge?.id) return;

    Alert.alert(
      "Leave this fridge?",
      `This will remove your access to ${fridge.name || "this fridge"}.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Leave",
          style: "destructive",
          onPress: () => handleLeaveFridge(fridge.id),
        },
      ]
    );
  };

  const handleLeaveFridge = async (fridgeId) => {
    try {
      setLeavingId(fridgeId);
      await leaveFridge(fridgeId);
      Alert.alert("Removed", "You no longer have access to that fridge.");
    } catch (err) {
      Alert.alert(
        "Unable to leave",
        err?.message || "We could not complete that action."
      );
    } finally {
      setLeavingId(null);
    }
  };

  const fridgeList = useMemo(
    () =>
      fridges.map((fridge) => ({
        ...fridge,
        isCurrent: fridge.id === currentFridgeId,
      })),
    [fridges, currentFridgeId]
  );

  if (initializing) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#2563EB" />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {/* Profile card */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Your Account</Text>
        <View style={styles.fieldRow}>
          <Text style={styles.label}>Display name</Text>
          <TextInput
            value={displayName}
            onChangeText={setDisplayName}
            style={styles.input}
            placeholder="Enter your display name"
            editable={!savingName}
          />
        </View>
        <View style={styles.fieldRow}>
          <Text style={styles.label}>Email</Text>
          <Text style={styles.valueText}>{emailAddress}</Text>
        </View>
        <TouchableOpacity
          style={[styles.primaryButton, savingName && styles.primaryButtonDisabled]}
          onPress={handleSaveDisplayName}
          disabled={savingName}
        >
          {savingName ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.primaryButtonText}>Save</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Current fridge summary */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Current Fridge</Text>
        {currentFridge ? (
          <>
            <Text style={styles.valueText}>
              {currentFridge.name || "Unnamed fridge"}
            </Text>
            <Text style={styles.metaText}>
              Invite code: {(currentFridge.inviteCode || "").toUpperCase() || "N/A"}
            </Text>
          </>
        ) : (
          <Text style={styles.placeholderText}>
            You have not selected a current fridge yet.
          </Text>
        )}
      </View>

      {/* All fridges list */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Your Fridges</Text>
        {fridgeList.length === 0 ? (
          <Text style={styles.placeholderText}>
            Join or create a fridge to see it here.
          </Text>
        ) : (
          fridgeList.map((fridge) => {
            const isCurrent = fridge.isCurrent;
            const setting = settingId === fridge.id;
            const leaving = leavingId === fridge.id;

            return (
              <View key={fridge.id} style={styles.fridgeBox}>
                <View style={styles.fridgeHeader}>
                  <Text style={styles.fridgeName}>
                    {fridge.name || "Unnamed fridge"}
                  </Text>
                  {isCurrent ? (
                    <Text style={styles.badge}>Current</Text>
                  ) : null}
                </View>
                <Text style={styles.metaText}>
                  Invite code: {(fridge.inviteCode || "").toUpperCase() || "N/A"}
                </Text>
                <Text style={styles.metaText}>
                  Role: {(fridge.role || "member").toUpperCase()}
                </Text>
                <View style={styles.actionsRow}>
                  <TouchableOpacity
                    style={[
                      styles.secondaryButton,
                      (isCurrent || setting) && styles.secondaryButtonDisabled,
                    ]}
                    disabled={isCurrent || setting}
                    onPress={() => handleSetCurrent(fridge)}
                  >
                    {setting ? (
                      <ActivityIndicator size="small" color="#2563EB" />
                    ) : (
                      <Text style={styles.secondaryButtonText}>Set current</Text>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.destructiveButton,
                      leaving && styles.destructiveButtonDisabled,
                    ]}
                    disabled={leaving}
                    onPress={() => confirmLeaveFridge(fridge)}
                  >
                    {leaving ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.destructiveButtonText}>Leave</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            );
          })
        )}
      </View>

      {/* Join fridge card */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Join a Fridge</Text>
        <Text style={styles.metaText}>
          Enter the invite code shared by a fridge owner to link it to your account.
        </Text>
        <TextInput
          value={inviteCode}
          onChangeText={setInviteCode}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder="INVITE"
          style={styles.input}
          editable={!joining}
        />
        <TouchableOpacity
          style={[styles.primaryButton, inviteDisabled && styles.primaryButtonDisabled]}
          onPress={handleJoinFridge}
          disabled={inviteDisabled}
        >
          {joining ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.primaryButtonText}>Join</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Sign out */}
      <TouchableOpacity style={styles.signOutButton} onPress={signOut}>
        <Text style={styles.signOutText}>Sign out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F3F4F6",
  },
  content: {
    paddingHorizontal: 20,
    paddingVertical: 24,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F3F4F6",
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
  cardTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 12,
  },
  fieldRow: {
    marginBottom: 12,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: "#6B7280",
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
    color: "#111827",
    backgroundColor: "#F9FAFB",
  },
  valueText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#111827",
  },
  metaText: {
    fontSize: 14,
    color: "#6B7280",
    marginTop: 4,
  },
  placeholderText: {
    color: "#9CA3AF",
    fontStyle: "italic",
  },
  fridgeBox: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#E5E7EB",
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    backgroundColor: "#F9FAFB",
  },
  fridgeHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  fridgeName: {
    fontSize: 16,
    fontWeight: "700",
    color: "#111827",
  },
  badge: {
    backgroundColor: "#2563EB",
    color: "#fff",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    fontSize: 12,
    fontWeight: "600",
  },
  actionsRow: {
    flexDirection: "row",
    marginTop: 12,
  },
  primaryButton: {
    backgroundColor: "#2563EB",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  primaryButtonDisabled: {
    backgroundColor: "#93C5FD",
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 16,
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
  secondaryButtonText: {
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
  destructiveButtonText: {
    color: "#FFFFFF",
    fontWeight: "700",
  },
  signOutButton: {
    backgroundColor: "#111827",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  signOutText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 16,
  },
});
