import { useEffect } from "react";
import { View, Text } from "react-native";
import { db, auth } from "./src/services/firebaseConnected";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { onAuthStateChanged, signInAnonymously } from "firebase/auth";

export default function App() {
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) { await signInAnonymously(auth); return; }
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
    <View style={{ flex:1, alignItems:"center", justifyContent:"center" }}>
      <Text>✅ Firebase connected successfully!</Text>
    </View>
  );
}
