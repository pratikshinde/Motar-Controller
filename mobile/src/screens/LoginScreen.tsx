import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  SafeAreaView,
  StatusBar,
} from 'react-native';
import { Activity, Phone, User as UserIcon, ShieldCheck, KeyRound, ArrowRight, LogIn } from 'lucide-react-native';
import { apiClient } from '../config/api';
import { storage } from '../services/storage';

interface LoginScreenProps {
  onLoginSuccess: () => void;
}

type AuthMode = 'LOGIN' | 'REGISTER';

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLoginSuccess }) => {
  const [authMode, setAuthMode] = useState<AuthMode>('LOGIN');

  // Form state (Empty by default for clean user input)
  const [phone, setPhone] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');

  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // Mobile Number + Password Login
  const handlePasswordLogin = async () => {
    if (!phone.trim()) {
      Alert.alert('Validation Error', 'Please enter your registered mobile phone number');
      return;
    }
    if (!password.trim()) {
      Alert.alert('Validation Error', 'Please enter your password');
      return;
    }
    setLoading(true);
    setStatusMsg(null);
    try {
      const res = await apiClient.post('/auth/login-password', {
        phone_number: phone.trim(),
        password: password.trim(),
      });
      const { access_token, refresh_token, user } = res.data;
      if (access_token) {
        await storage.setItem('agripump_token', access_token);
        await storage.setItem('agripump_refresh', refresh_token || '');
        await storage.setItem('agripump_user', JSON.stringify(user || {}));
        onLoginSuccess();
      }
    } catch (err: any) {
      const errorMsg = err.response?.data?.detail || err.message || 'Login failed';
      setStatusMsg(`Notice: ${errorMsg}`);
      if (err.response?.status === 404) {
        Alert.alert(
          'Account Not Found',
          'This mobile number is not registered in our database yet. Would you like to create a new account now?',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Register Account', onPress: () => setAuthMode('REGISTER') },
          ]
        );
      } else {
        Alert.alert('Login Failed', errorMsg);
      }
    } finally {
      setLoading(false);
    }
  };

  // New Account Registration
  const handleRegister = async () => {
    if (!fullName.trim()) {
      Alert.alert('Validation Error', 'Please enter your Full Name');
      return;
    }
    if (!phone.trim()) {
      Alert.alert('Validation Error', 'Please enter your Mobile Phone Number');
      return;
    }
    if (!password.trim() || password.length < 6) {
      Alert.alert('Validation Error', 'Please enter a password (minimum 6 characters)');
      return;
    }
    setLoading(true);
    setStatusMsg(null);
    try {
      const res = await apiClient.post('/auth/register', {
        full_name: fullName.trim(),
        phone: phone.trim(),
        password: password.trim(),
      });

      // Clear password, navigate to LOGIN tab with professional success notification
      setPassword('');
      setAuthMode('LOGIN');
      setStatusMsg('Account created successfully. Please sign in with your mobile number and password.');
      
      Alert.alert(
        'Account Created',
        `Welcome ${fullName.trim()}. Your account has been registered successfully. Please sign in to continue.`
      );
    } catch (err: any) {
      const errorMsg = err.response?.data?.detail || err.message || 'Registration failed';
      setStatusMsg(`Registration Error: ${errorMsg}`);
      Alert.alert('Registration Failed', errorMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.container}
      >
        <ScrollView contentContainerStyle={styles.scrollContainer} showsVerticalScrollIndicator={false}>
          {/* Header Branding */}
          <View style={styles.headerCard}>
            <View style={styles.logoBox}>
              <Activity size={32} color="#00e5ff" />
            </View>
            <Text style={styles.titleLine1}>AJANTA PUMP</Text>
            <Text style={styles.titleLine2}>CONTROLLER</Text>
            <Text style={styles.subtitle}>Smart 3-Phase IoT Pump Portal</Text>
          </View>

          {/* Mode Switch Tabs */}
          <View style={styles.tabContainer}>
            <TouchableOpacity
              style={[styles.tab, authMode === 'LOGIN' && styles.activeTab]}
              onPress={() => {
                setAuthMode('LOGIN');
                setStatusMsg(null);
              }}
              activeOpacity={0.8}
            >
              <LogIn size={16} color={authMode === 'LOGIN' ? '#00e5ff' : '#7a8baa'} />
              <Text style={[styles.tabText, authMode === 'LOGIN' && styles.activeTabText]}>
                Account Login
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.tab, authMode === 'REGISTER' && styles.activeTab]}
              onPress={() => {
                setAuthMode('REGISTER');
                setStatusMsg(null);
              }}
              activeOpacity={0.8}
            >
              <UserIcon size={16} color={authMode === 'REGISTER' ? '#00e676' : '#7a8baa'} />
              <Text style={[styles.tabText, authMode === 'REGISTER' && styles.activeTabText]}>
                New Registration
              </Text>
            </TouchableOpacity>
          </View>

          {/* Status Message Notification */}
          {statusMsg && (
            <View style={styles.statusBox}>
              <Text style={styles.statusText}>{statusMsg}</Text>
            </View>
          )}

          {/* Main Auth Form Card */}
          <View style={styles.formCard}>
            {authMode === 'REGISTER' ? (
              /* REGISTRATION FORM */
              <View style={styles.formGroup}>
                <Text style={styles.formSectionHeader}>CREATE NEW FARMER ACCOUNT</Text>

                <Text style={styles.label}>Full Name</Text>
                <View style={styles.inputWrap}>
                  <UserIcon size={18} color="#7a8baa" style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    value={fullName}
                    onChangeText={setFullName}
                    placeholder="Enter your full name"
                    placeholderTextColor="#4a5a78"
                  />
                </View>

                <Text style={styles.label}>Mobile Phone Number</Text>
                <View style={styles.inputWrap}>
                  <Phone size={18} color="#7a8baa" style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    value={phone}
                    onChangeText={setPhone}
                    placeholder="Enter mobile phone number"
                    placeholderTextColor="#4a5a78"
                    keyboardType="phone-pad"
                    autoCapitalize="none"
                  />
                </View>

                <Text style={styles.label}>Set Password</Text>
                <View style={styles.inputWrap}>
                  <KeyRound size={18} color="#7a8baa" style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    value={password}
                    onChangeText={setPassword}
                    placeholder="Enter password"
                    placeholderTextColor="#4a5a78"
                    secureTextEntry
                  />
                </View>

                <TouchableOpacity
                  style={styles.submitBtn}
                  onPress={handleRegister}
                  disabled={loading}
                  activeOpacity={0.85}
                >
                  {loading ? (
                    <ActivityIndicator color="#060b14" />
                  ) : (
                    <>
                      <Text style={styles.submitBtnText}>REGISTER & SAVE TO DATABASE</Text>
                      <ArrowRight size={18} color="#060b14" />
                    </>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.switchModeLink}
                  onPress={() => setAuthMode('LOGIN')}
                >
                  <Text style={styles.switchModeText}>Already registered? Login here</Text>
                </TouchableOpacity>
              </View>
            ) : (
              /* PASSWORD LOGIN FORM */
              <View style={styles.formGroup}>
                <Text style={styles.formSectionHeader}>LOGIN TO YOUR ACCOUNT</Text>

                <Text style={styles.label}>Registered Mobile Number</Text>
                <View style={styles.inputWrap}>
                  <Phone size={18} color="#7a8baa" style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    value={phone}
                    onChangeText={setPhone}
                    placeholder="Enter mobile phone number"
                    placeholderTextColor="#4a5a78"
                    keyboardType="phone-pad"
                    autoCapitalize="none"
                  />
                </View>

                <Text style={styles.label}>Password</Text>
                <View style={styles.inputWrap}>
                  <KeyRound size={18} color="#7a8baa" style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    value={password}
                    onChangeText={setPassword}
                    placeholder="Enter password"
                    placeholderTextColor="#4a5a78"
                    secureTextEntry
                  />
                </View>

                <TouchableOpacity
                  style={styles.submitBtn}
                  onPress={handlePasswordLogin}
                  disabled={loading}
                  activeOpacity={0.85}
                >
                  {loading ? (
                    <ActivityIndicator color="#060b14" />
                  ) : (
                    <>
                      <Text style={styles.submitBtnText}>LOGIN TO DASHBOARD</Text>
                      <ArrowRight size={18} color="#060b14" />
                    </>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.switchModeLink}
                  onPress={() => setAuthMode('REGISTER')}
                >
                  <Text style={styles.switchModeText}>New user? Create New Account</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* Footer Security Badge */}
          <View style={styles.footerSecureRow}>
            <ShieldCheck size={14} color="#00e5ff" />
            <Text style={styles.footerSecureText}>ENCRYPTED POSTGRESQL AUTHENTICATION ACTIVE</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#060b14',
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + 6 : 0,
  },
  container: {
    flex: 1,
    backgroundColor: '#060b14',
  },
  scrollContainer: {
    padding: 20,
    alignItems: 'center',
    paddingBottom: 40,
  },
  headerCard: {
    alignItems: 'center',
    marginBottom: 20,
    marginTop: 10,
  },
  logoBox: {
    width: 60,
    height: 60,
    borderRadius: 14,
    backgroundColor: '#00e5ff15',
    borderWidth: 1.5,
    borderColor: '#00e5ff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  titleLine1: {
    color: '#e8edf5',
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 2,
  },
  titleLine2: {
    color: '#00e5ff',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginTop: 1,
  },
  subtitle: {
    color: '#7a8baa',
    fontSize: 11,
    letterSpacing: 1,
    marginTop: 4,
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: '#0c1220',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1c2a45',
    padding: 4,
    width: '100%',
    marginBottom: 16,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    borderRadius: 8,
  },
  activeTab: {
    backgroundColor: '#111a2e',
    borderWidth: 1,
    borderColor: '#1c2a45',
  },
  tabText: {
    color: '#7a8baa',
    fontSize: 12,
    fontWeight: '700',
  },
  activeTabText: {
    color: '#e8edf5',
  },
  statusBox: {
    backgroundColor: '#00e67615',
    borderWidth: 1,
    borderColor: '#00e67650',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    width: '100%',
    marginBottom: 16,
  },
  statusText: {
    color: '#00e676',
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
  },
  formCard: {
    backgroundColor: '#111a2e',
    borderWidth: 1,
    borderColor: '#1c2a45',
    borderRadius: 14,
    padding: 20,
    width: '100%',
    marginBottom: 20,
  },
  formGroup: {
    gap: 12,
  },
  formSectionHeader: {
    color: '#7a8baa',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  label: {
    color: '#e8edf5',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginTop: 4,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#060b14',
    borderWidth: 1,
    borderColor: '#1c2a45',
    borderRadius: 10,
    paddingHorizontal: 12,
  },
  inputIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    color: '#e8edf5',
    fontSize: 14,
    height: 46,
  },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#00e676',
    borderRadius: 10,
    height: 48,
    marginTop: 12,
  },
  submitBtnText: {
    color: '#060b14',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 1,
  },
  switchModeLink: {
    alignItems: 'center',
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#1c2a45',
  },
  switchModeText: {
    color: '#7a8baa',
    fontSize: 11,
    fontWeight: '700',
  },
  footerSecureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  footerSecureText: {
    color: '#4a5a78',
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
});
