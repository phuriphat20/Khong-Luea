import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from './src/services/firebaseConnected';

import LoginScreen from './src/screens/auth/LoginScreen';
import RegisterScreen from './src/screens/auth/RegisterScreen';
import HomeScreen from './src/screens/HomeScreen';
import StockScreen from './src/screens/StockScreen';
import ShoppingScreen from './src/screens/ShoppingScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import FridgeDetailScreen from './src/screens/FridgeDetailScreen';

import AppCtx from './src/context/AppContext';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

const TAB_ICONS = {
  Home: { active: 'home', inactive: 'home-outline' },
  Stock: { active: 'cube', inactive: 'cube-outline' },
  Shopping: { active: 'cart', inactive: 'cart-outline' },
  Settings: { active: 'settings', inactive: 'settings-outline' },
};

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => {
        const iconSet = TAB_ICONS[route.name] || {
          active: 'ellipse',
          inactive: 'ellipse-outline',
        };
        return {
          headerTitleAlign: 'center',
          tabBarActiveTintColor: '#2D5BFF',
          tabBarInactiveTintColor: '#9CA3AF',
          tabBarStyle: { paddingVertical: 4, height: 60 },
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons
              name={focused ? iconSet.active : iconSet.inactive}
              size={size}
              color={color}
            />
          ),
        };
      }}
    >
      <Tab.Screen name="Home" component={HomeScreen} options={{ title: 'Home' }} />
      <Tab.Screen name="Stock" component={StockScreen} options={{ title: 'Stock' }} />
      <Tab.Screen name="Shopping" component={ShoppingScreen} options={{ title: 'Shopping List' }} />
      <Tab.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
    </Tab.Navigator>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u ?? null);
      if (u) {
        const pRef = doc(db, 'users', u.uid);
        const snap = await getDoc(pRef);
        if (!snap.exists()) {
          await setDoc(pRef, {
            displayName: u.email?.split('@')[0] || 'New member',
            email: u.email || '',
            currentFridgeId: null,
            createdAt: serverTimestamp(),
          });
          const fresh = await getDoc(pRef);
          setProfile(fresh.data());
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

  const ctxValue = useMemo(
    () => ({
      user,
      profile,
      setProfile,
      signOut: () => signOut(auth),
    }),
    [user, profile]
  );

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <AppCtx.Provider value={ctxValue}>
      <SafeAreaProvider>
        <NavigationContainer theme={{ ...DefaultTheme }}>
          <Stack.Navigator screenOptions={{ headerTitleAlign: 'center' }}>
            {user ? (
              <>
                <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
                <Stack.Screen
                  name="FridgeDetail"
                  component={FridgeDetailScreen}
                  options={{ title: 'Fridge Details' }}
                />
              </>
            ) : (
              <>
                <Stack.Screen
                  name="Login"
                  component={LoginScreen}
                  options={{ title: 'Sign In' }}
                />
                <Stack.Screen
                  name="Register"
                  component={RegisterScreen}
                  options={{ title: 'Create Account' }}
                />
              </>
            )}
          </Stack.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>
    </AppCtx.Provider>
  );
}
