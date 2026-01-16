import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '@/lib/auth-context';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const THEME = {
  background: '#000000',
  card: '#232326',
  border: '#27272a',
  text: '#f3f4f6',
  textSecondary: '#a1a1aa',
  input: '#232326',
  inputBorder: '#27272a',
  primary: '#60a5fa',
  errorBg: '#7f1d1d',
  errorBorder: '#b91c1c',
  successBg: '#14532d',
  successBorder: '#22c55e',
  warningBg: '#78350f',
  warningBorder: '#f59e42',
  placeholder: '#71717a',
  buttonDisabled: '#444',
};

export default function LoginScreen() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const { login, loading, error: authError, clearError } = useAuth();
  const C = THEME;
  const insets = useSafeAreaInsets();
  
  // Use auth context error, fallback to local error
  const displayError = authError || localError;

  // Clear errors when user starts typing
  const handleUsernameChange = (text: string) => {
    setUsername(text);
    if (displayError) {
      setLocalError(null);
      clearError();
    }
  };

  const handlePasswordChange = (text: string) => {
    setPassword(text);
    if (displayError) {
      setLocalError(null);
      clearError();
    }
  };

  const handleLogin = async () => {
    setLocalError(null);
    setSuccess(null);
    setWarning(null);
    clearError();
    
    if (!username.trim() || !password.trim()) {
      setLocalError('Please fill in all fields');
      return;
    }
    
    const success = await login(username.trim(), password);
    if (success) {
      setSuccess('Login successful!');
      // Small delay to show success message
      setTimeout(() => {
        router.replace('/');
      }, 500);
    } else {
      // Error is already set in auth context, but we can enhance the message
      const errorMessage = authError || 'Invalid username/email or password';
      setLocalError(errorMessage);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: C.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <StatusBar style="light" backgroundColor="#000000" />
      <ScrollView style={[styles.scrollView, { backgroundColor: C.background }]} contentContainerStyle={styles.scrollContainer} keyboardShouldPersistTaps="handled">
        {/* Back button */}
        <View style={[styles.navRow, { marginTop: insets.top + 4 }]}>
          <TouchableOpacity
            onPress={() => {
              if (router.canGoBack()) {
                router.back();
              } else {
                router.replace('/');
              }
            }}
            style={[styles.backButton, { borderColor: C.border }]}
          >
            <Ionicons name="chevron-back" size={26} color={C.text} />
          </TouchableOpacity>
        </View>
        <View style={styles.header}>
          <Text style={[styles.title, { color: C.text }]}>Welcome back!</Text>
          <Text style={[styles.subtitle, { color: C.textSecondary }]}>Login to continue</Text>
        </View>

        {/* Alerts */}
        {displayError && (
          <View style={[styles.alert, { backgroundColor: C.errorBg, borderColor: C.errorBorder }]}> 
            <Ionicons name="alert-circle" size={20} color={'#fecaca'} style={{ marginRight: 8 }} />
            <Text style={[styles.alertText, { color: '#fecaca' }]}>
              {displayError.includes('Invalid credentials') 
                ? 'Invalid username/email or password. Please check your credentials and try again.'
                : displayError.includes('401') || displayError.includes('Unauthorized')
                ? 'Invalid username/email or password. Please check your credentials and try again.'
                : displayError}
            </Text>
            <TouchableOpacity
              onPress={() => {
                setLocalError(null);
                clearError();
              }}
              hitSlop={10}
              style={styles.dismissButton}
            >
              <Ionicons name="close" size={18} color={'#fecaca'} />
            </TouchableOpacity>
          </View>
        )}
        {success && (
          <View style={[styles.alert, { backgroundColor: C.successBg, borderColor: C.successBorder }]}> 
            <Ionicons name="checkmark-circle" size={20} color={'#22c55e'} style={{ marginRight: 8 }} />
            <Text style={[styles.alertText, { color: C.text }]}>{success}</Text>
          </View>
        )}
        {warning && (
          <View style={[styles.alert, { backgroundColor: C.warningBg, borderColor: C.warningBorder }]}> 
            <Ionicons name="warning" size={20} color={'#fde68a'} style={{ marginRight: 8 }} />
            <Text style={[styles.alertText, { color: C.text }]}>{warning}</Text>
          </View>
        )}

        <View style={[styles.form, { backgroundColor: C.card, borderColor: C.border }]}>
          {/* Username / Email */}
          <Text style={[styles.label, { color: C.text }]}>Enter your email</Text>
          <View style={[styles.inputWrapper, { backgroundColor: C.input, borderColor: C.inputBorder }]}>
            <Ionicons name="mail-outline" size={20} color={C.textSecondary} style={styles.inputIconLeft} />
            <TextInput
              style={[styles.inputField, { color: C.text }]}
              placeholder="user@example.com"
              value={username}
              onChangeText={handleUsernameChange}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="default"
              placeholderTextColor={C.placeholder}
              editable={!loading}
            />
          </View>

          {/* Password */}
          <View style={{ marginTop: 16 }}>
            <View style={styles.labelRow}>
              <Text style={[styles.label, { color: C.text }]}>Enter Your password</Text>
              <TouchableOpacity onPress={() => router.push('/auth/forgot-password')}>
                <Text style={[styles.forgotText, { color: C.primary }]}>Forgot password?</Text>
              </TouchableOpacity>
            </View>
            <View style={[styles.inputWrapper, { backgroundColor: C.input, borderColor: C.inputBorder }]}>
              <Ionicons name="lock-closed-outline" size={20} color={C.textSecondary} style={styles.inputIconLeft} />
              <TextInput
                style={[styles.inputField, { color: C.text }]}
                placeholder="••••••••"
                value={password}
                onChangeText={handlePasswordChange}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!loading}
                placeholderTextColor={C.placeholder}
              />
              <Pressable
                style={styles.inputIconRight}
                onPress={() => setShowPassword((v) => !v)}
                hitSlop={10}
              >
                <Ionicons
                  name={showPassword ? 'eye-off' : 'eye'}
                  size={22}
                  color={C.placeholder}
                />
              </Pressable>
            </View>
          </View>

          <View style={styles.rememberRow}>
            <TouchableOpacity
              style={styles.checkbox}
              onPress={() => setRememberMe((v) => !v)}
              activeOpacity={0.7}
            >
              {rememberMe ? (
                <Ionicons name="checkbox" size={20} color={C.primary} />
              ) : (
                <Ionicons name="square-outline" size={20} color={C.placeholder} />
              )}
            </TouchableOpacity>
            <Text style={[styles.rememberText, { color: C.text }]}>Remember me</Text>
          </View>

          <TouchableOpacity
            style={[styles.button, { backgroundColor: loading ? C.buttonDisabled : C.primary }]}
            onPress={handleLogin}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color={C.text} />
            ) : (
              <Text style={[styles.buttonText, { color: '#000000' }]}>Login</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.linkButton}
            onPress={() => router.push('/auth/register')}
          >
            <Text style={[styles.linkText, { color: C.textSecondary }]}>
              Don't have an account? <Text style={{ color: C.primary, fontWeight: 'bold' }}>Sign up</Text>
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 20,
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  navRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    marginBottom: 8,
  },
  backButton: {
    padding: 6,
    alignSelf: 'flex-start',
    backgroundColor: 'transparent',
    borderColor: '#333',
    borderWidth: 1,
    borderRadius: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
  },
  alert: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
  },
  alertText: {
    fontSize: 15,
    flex: 1,
    lineHeight: 20,
  },
  dismissButton: {
    padding: 4,
    marginLeft: 8,
  },
  form: {
    width: '100%',
    marginTop: 8,
    borderRadius: 12,
    borderWidth: 1,
    padding: 18,
    marginBottom: 18,
  },
  label: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 6,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  forgotText: {
    fontSize: 14,
    fontWeight: '500',
  },
  input: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 15,
    fontSize: 16,
    marginBottom: 12,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 24,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginBottom: 12,
  },
  inputField: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 6,
  },
  inputIconLeft: {
    marginRight: 12,
  },
  inputIconRight: {
    paddingLeft: 12,
  },
  rememberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 18,
  },
  checkbox: {
    marginRight: 8,
  },
  rememberText: {
    fontSize: 15,
  },
  button: {
    borderRadius: 24,
    padding: 15,
    alignItems: 'center',
    marginBottom: 18,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  linkButton: {
    alignItems: 'center',
    marginTop: 4,
  },
  linkText: {
    fontSize: 15,
  },
}); 