// App.js
import 'react-native-reanimated'; // ต้องบนสุด
import { NavigationContainer } from '@react-navigation/native';
import { AuthProvider, useAuth } from './src/contexts/AuthContext';
import AppNavigator from './src/navigation/AppNavigator';
import { View, ActivityIndicator } from 'react-native';

function Gate() {
  const { loading } = useAuth();
  if (loading) {
    return (
      <View style={{ flex:1, alignItems:'center', justifyContent:'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }
  return <AppNavigator />;
}

export default function App() {
  return (
    <AuthProvider>
      <NavigationContainer>
        <Gate />
      </NavigationContainer>
    </AuthProvider>
  );
}
