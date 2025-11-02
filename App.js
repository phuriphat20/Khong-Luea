import { ActivityIndicator, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import LoginScreen from './src/screens/auth/LoginScreen';
import RegisterScreen from './src/screens/auth/RegisterScreen';
import HomeScreen from './src/screens/HomeScreen';
import StockScreen from './src/screens/StockScreen';
import ShoppingListScreen from './src/screens/ShoppingListScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import FridgeDetailScreen from './src/screens/FridgeDetailScreen';

import { AppProvider, useAppContext } from './src/context/AppContext';

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
      <Tab.Screen name="Shopping" component={ShoppingListScreen} options={{ title: 'Shopping List' }} />
      <Tab.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
    </Tab.Navigator>
  );
}

function RootNavigator() {
  const { user, initializing } = useAppContext();

  if (initializing) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
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
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AppProvider>
        <SafeAreaProvider>
          <NavigationContainer theme={{ ...DefaultTheme }}>
            <RootNavigator />
          </NavigationContainer>
        </SafeAreaProvider>
      </AppProvider>
    </GestureHandlerRootView>
  );
}
