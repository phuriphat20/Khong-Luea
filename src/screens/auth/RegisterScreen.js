// src/screens/RegisterScreen.js
import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../../services/firebaseConnected';

export default function RegisterScreen({ navigation }) {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [name, setName] = useState('');

  const onRegister = async () => {
    try {
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), pw);
      if (name) {
        await updateProfile(cred.user, { displayName: name });
      }
      await setDoc(doc(db, 'users', cred.user.uid), {
        displayName: name || email.split('@')[0],
        email: email.trim(),
        currentFridgeId: null,
        createdAt: serverTimestamp()
      });
      // กลับไปหน้าหลักเองหลัง auth เปลี่ยน
    } catch (e) {
      Alert.alert('สมัครสมาชิกไม่สำเร็จ', e.message);
    }
  };

  return (
    <View style={s.container}>
      <Text style={s.title}>สมัครสมาชิก</Text>

      <TextInput
        style={s.input}
        placeholder="ชื่อที่แสดง"
        value={name}
        onChangeText={setName}
      />
      <TextInput
        style={s.input}
        placeholder="อีเมล"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={s.input}
        placeholder="รหัสผ่าน (อย่างน้อย 6 ตัว)"
        secureTextEntry
        value={pw}
        onChangeText={setPw}
      />

      <TouchableOpacity style={s.btn} onPress={onRegister}>
        <Text style={s.btnText}>สร้างบัญชี</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={() => navigation.goBack()}>
        <Text style={s.link}>มีบัญชีอยู่แล้ว? เข้าสู่ระบบ</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  container:{ flex:1, padding:24, justifyContent:'center' },
  title:{ fontSize:24, fontWeight:'700', textAlign:'center', marginBottom:16 },
  input:{ borderWidth:1, borderColor:'#ddd', borderRadius:10, padding:12, marginBottom:12 },
  btn:{ backgroundColor:'#27ae60', padding:14, borderRadius:10, marginTop:4 },
  btnText:{ color:'#fff', textAlign:'center', fontWeight:'700' },
  link:{ marginTop:16, textAlign:'center', color:'#2f80ed' }
});
