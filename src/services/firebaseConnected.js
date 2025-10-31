// src/services/firebaseConnected.js
import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { initializeAuth, getReactNativePersistence } from "firebase/auth";
import AsyncStorage from "@react-native-async-storage/async-storage";

const firebaseConfig = {
  apiKey: "AIzaSyAzoFSuK06_XW7FtlYwhnQkyTSLSGv5V9s",
  authDomain: "khong-luea.firebaseapp.com",
  projectId: "khong-luea",
  // ✅ storageBucket ของโปรเจ็กต์ Firebase ปกติลงท้าย .appspot.com
  storageBucket: "khong-luea.appspot.com",
  messagingSenderId: "908624210263",
  appId: "1:908624210263:web:51fa6b83c8c76746e67612",
  // measurementId ไม่จำเป็นบน RN/Expo
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// ✅ ใช้ initializeAuth สำหรับ React Native
export const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(AsyncStorage),
});

export const db = getFirestore(app);
export const storage = getStorage(app);

export default app;
