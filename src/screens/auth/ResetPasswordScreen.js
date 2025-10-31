import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert } from 'react-native';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '../../services/firebaseConnected';

export default function ResetPasswordScreen() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);

  async function onReset() {
    try {
      setBusy(true);
      await sendPasswordResetEmail(auth, email.trim());
      Alert.alert('ส่งอีเมลรีเซ็ตรหัสแล้ว', 'โปรดตรวจกล่องจดหมายของคุณ');
    } catch (e) {
      Alert.alert('ส่งอีเมลไม่สำเร็จ', e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View className="flex-1 p-4 bg-white">
      <Text className="text-2xl font-bold mb-6">ลืมรหัสผ่าน</Text>
      <TextInput placeholder="อีเมลที่ใช้สมัคร" autoCapitalize="none" keyboardType="email-address"
        value={email} onChangeText={setEmail} className="border rounded-lg px-3 py-2 mb-4" />
      <TouchableOpacity disabled={busy} onPress={onReset} className="bg-black rounded-xl p-3 items-center">
        <Text className="text-white font-semibold">{busy ? 'กำลังส่ง...' : 'ส่งลิงก์รีเซ็ต'}</Text>
      </TouchableOpacity>
    </View>
  );
}
