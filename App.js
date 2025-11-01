import { SafeAreaView, SafeAreaProvider } from 'react-native-safe-area-context';
import { useEffect, useState, useMemo } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from './src/services/firebaseConnected';

import LoginScreen from './src/screens/auth/LoginScreen';
import RegisterScreen from './src/screens/auth/RegisterScreen';
import HomeScreen from './src/screens/HomeScreen';
import StockScreen from './src/screens/StockScreen';
import ShoppingScreen from './src/screens/ShoppingScreen';
import SettingsScreen from './src/screens/SettingsScreen';

import AppCtx from './src/context/AppContext';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function MainTabs() {
  return (
    <Tab.Navigator screenOptions={{ headerTitleAlign: 'center' }}>
      <Tab.Screen name="Home" component={HomeScreen} options={{ title: 'หน้าหลัก' }} />
      <Tab.Screen name="Stock" component={StockScreen} options={{ title: 'ของในตู้' }} />
      <Tab.Screen name="Shopping" component={ShoppingScreen} options={{ title: 'ลิสต์ซื้อ' }} />
      <Tab.Screen name="Settings" component={SettingsScreen} options={{ title: 'ตั้งค่า' }} />
    </Tab.Navigator>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);       // users/{uid}
  const [loading, setLoading] = useState(true);

  // ตรวจสอบ auth state
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u ?? null);
      if (u) {
        // ดึงโปรไฟล์ ถ้าไม่มีให้สร้างขั้นต่ำ
        const pRef = doc(db, 'users', u.uid);
        const snap = await getDoc(pRef);
        if (!snap.exists()) {
          await setDoc(pRef, {
            displayName: u.email?.split('@')[0] || 'ผู้ใช้ใหม่',
            email: u.email || '',
            currentFridgeId: null,   // ผู้ใช้ใหม่ยังไม่ผูกตู้เย็น
            createdAt: serverTimestamp()
          });
          setProfile((await getDoc(pRef)).data());
        } else {
          setProfile(snap.data());
        }
      } else {
        setProfile(null);
      }
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const ctxValue = useMemo(() => ({
    user,
    profile,
    setProfile,
    signOut: () => signOut(auth)
  }), [user, profile]);

  if (loading) {
    return (
      <View style={{ flex:1, alignItems:'center', justifyContent:'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <AppCtx.Provider value={ctxValue}>
      <SafeAreaProvider>
      <NavigationContainer theme={{...DefaultTheme}}>
        <Stack.Navigator screenOptions={{ headerTitleAlign: 'center' }}>
          {user ? (
            <Stack.Screen name="Main" component={MainTabs} options={{ headerShown:false }} />
          ) : (
            <>
              <Stack.Screen name="Login" component={LoginScreen} options={{ title: 'เข้าสู่ระบบ' }} />
              <Stack.Screen name="Register" component={RegisterScreen} options={{ title: 'สมัครสมาชิก' }} />
            </>
          )}
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
    </AppCtx.Provider>
  );
}
