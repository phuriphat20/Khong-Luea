import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert } from 'react-native';
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../../services/firebaseConnected';

export default function SignUpScreen() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSignUp() {
    if (!name.trim()) return Alert.alert('กรุณาใส่ชื่อ');
    try {
      setBusy(true);
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), pass);
      await updateProfile(cred.user, { displayName: name.trim() });
      await setDoc(doc(db, 'users', cred.user.uid), {
        displayName: name.trim(),
        email: email.trim(),
        currentFridgeId: '',
        createdAt: serverTimestamp(),
      });
    } catch (e) {
      Alert.alert('สมัครสมาชิกไม่สำเร็จ', e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View className="flex-1 p-4 bg-white">
      <Text className="text-2xl font-bold mb-6">สมัครสมาชิก</Text>
      <TextInput placeholder="ชื่อที่แสดง" value={name} onChangeText={setName}
        className="border rounded-lg px-3 py-2 mb-3" />
      <TextInput placeholder="อีเมล" autoCapitalize="none" keyboardType="email-address"
        value={email} onChangeText={setEmail} className="border rounded-lg px-3 py-2 mb-3" />
      <TextInput placeholder="รหัสผ่าน (อย่างน้อย 6 ตัว)" secureTextEntry
        value={pass} onChangeText={setPass} className="border rounded-lg px-3 py-2 mb-4" />
      <TouchableOpacity disabled={busy} onPress={onSignUp} className="bg-black rounded-xl p-3 items-center">
        <Text className="text-white font-semibold">{busy ? 'กำลังสมัคร...' : 'สมัครสมาชิก'}</Text>
      </TouchableOpacity>
    </View>
  );
}
