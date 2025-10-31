import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert } from 'react-native';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../../services/firebaseConnected';

export default function SignInScreen({ navigation }) {
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSignIn() {
    try {
      setBusy(true);
      await signInWithEmailAndPassword(auth, email.trim(), pass);
    } catch (e) {
      Alert.alert('เข้าสู่ระบบไม่สำเร็จ', e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View className="flex-1 p-4 bg-white">
      <Text className="text-2xl font-bold mb-6">เข้าสู่ระบบ</Text>
      <TextInput
        placeholder="อีเมล"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
        className="border rounded-lg px-3 py-2 mb-3"
      />
      <TextInput
        placeholder="รหัสผ่าน"
        secureTextEntry
        value={pass}
        onChangeText={setPass}
        className="border rounded-lg px-3 py-2 mb-4"
      />
      <TouchableOpacity disabled={busy} onPress={onSignIn} className="bg-black rounded-xl p-3 items-center">
        <Text className="text-white font-semibold">{busy ? 'กำลังเข้า...' : 'เข้าสู่ระบบ'}</Text>
      </TouchableOpacity>

      <View className="flex-row justify-between mt-4">
        <TouchableOpacity onPress={() => navigation.navigate('SignUp')}>
          <Text className="text-blue-600">สมัครสมาชิก</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => navigation.navigate('ResetPassword')}>
          <Text className="text-blue-600">ลืมรหัสผ่าน?</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
