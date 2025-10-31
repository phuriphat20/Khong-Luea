// src/services/firebaseConnected.js
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
// 🚫 อย่า import getAuth ที่อื่น ๆ ในโปรเจกต์ เพื่อกันการสร้าง instance อัตโนมัติ
import { initializeAuth, getReactNativePersistence } from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';

const firebaseConfig = {
  apiKey: 'AIzaSyAzoFSuK06_XW7FtlYwhnQkyTSLSGv5V9s',
  authDomain: 'khong-luea.firebaseapp.com',
  projectId: 'khong-luea',
  storageBucket: 'khong-luea.appspot.com',
  messagingSenderId: '908624210263',
  appId: '1:908624210263:web:51fa6b83c8c76746e67612',
};

// ✅ สร้าง/ดึง Firebase App เดิม
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// ✅ กัน Fast Refresh: ใช้ globalThis เก็บ instance เดิมไว้
if (!globalThis.__khongluea_auth__) {
  globalThis.__khongluea_auth__ = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage),
  });
}

export const auth = globalThis.__khongluea_auth__;
export const db = getFirestore(app);
export const storage = getStorage(app);

export default app;
