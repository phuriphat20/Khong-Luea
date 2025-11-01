// src/screens/auth/LoginScreen.js
import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../../services/firebaseConnected';

export default function LoginScreen({ navigation }) {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');

  const onLogin = async () => {
    try {
      await signInWithEmailAndPassword(auth, email.trim(), pw);
    } catch (e) {
      Alert.alert('Sign in failed', e.message);
    }
  };

  return (
    <View style={s.container}>
      <Text style={s.title}>Khong Luea</Text>
      <Text style={s.subtitle}>Manage everything inside your fridges</Text>

      <TextInput
        style={s.input}
        placeholder="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={s.input}
        placeholder="Password"
        secureTextEntry
        value={pw}
        onChangeText={setPw}
      />

      <TouchableOpacity style={s.btn} onPress={onLogin}>
        <Text style={s.btnText}>Sign In</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={() => navigation.navigate('Register')}>
        <Text style={s.link}>Don't have an account? Create one</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, padding: 24, justifyContent: 'center' },
  title: { fontSize: 28, fontWeight: '700', textAlign: 'center' },
  subtitle: { fontSize: 14, color: '#666', textAlign: 'center', marginBottom: 24 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 10, padding: 12, marginBottom: 12 },
  btn: { backgroundColor: '#2f80ed', padding: 14, borderRadius: 10, marginTop: 4 },
  btnText: { color: '#fff', textAlign: 'center', fontWeight: '700' },
  link: { marginTop: 16, textAlign: 'center', color: '#2f80ed' },
});

