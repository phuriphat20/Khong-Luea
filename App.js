import "./global.css";
import { useEffect, useRef } from "react";
import { Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { db, auth } from "./src/services/firebaseConnected";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { onAuthStateChanged, signInAnonymously } from "firebase/auth";

export default function App() {
  const wroteOnce = useRef(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      // ยังไม่ล็อกอิน → ล็อกอินแบบ anonymous ก่อน
      if (!user) {
        await signInAnonymously(auth);
        return;
      }

      // กันยิงซ้ำเมื่อ auth state เปลี่ยนหลายรอบ
      if (wroteOnce.current) return;
      wroteOnce.current = true;

      try {
        await addDoc(collection(db, "users", user.uid, "debug"), {
          message: "Hello from Khong Luea!",
          ts: serverTimestamp(),
        });
        console.log("✅ wrote to Firestore");
      } catch (e) {
        console.warn("❌ Firestore error:", e);
      }
    });

    return () => unsub();
  }, []);

  return (
    <SafeAreaProvider>
      <SafeAreaView className="flex-1 bg-white">
        <View className="flex-1 items-center justify-center">
          <Text className="text-base font-semibold text-green-700">
            ✅ Firebase connected successfully!
          </Text>
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
