import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { router } from 'expo-router';
import { safeRouterBack } from '@/lib/utils/navigation';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { settingsApi } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import AsyncStorage from '@react-native-async-storage/async-storage';

const THEME = {
  bg: '#000000',
  card: '#111114',
  cardBorder: '#1e1e24',
  accent: '#60a5fa',
  accentDim: 'rgba(96, 165, 250, 0.12)',
  text: '#f3f4f6',
  textSecondary: '#71717a',
  danger: '#ef4444',
  dangerDim: 'rgba(239, 68, 68, 0.10)',
  inputBg: '#18181b',
  inputBorder: '#27272a',
};

type Step = 'warning' | 'password' | 'otp';

export default function DeleteAccountScreen() {
  const insets = useSafeAreaInsets();
  const { logout } = useAuth();
  const [step, setStep] = useState<Step>('warning');
  const [password, setPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const handleRequestOtp = async () => {
    setError(null);
    if (!password.trim()) {
      setError('Please enter your password');
      return;
    }

    setLoading(true);
    try {
      const response = await settingsApi.deleteAccountRequestOtp(password);
      if (response.status === 'success') {
        setStep('otp');
      } else {
        setError(response.message || 'Failed to send verification code');
      }
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAccount = async () => {
    setError(null);
    if (otpCode.length < 4) {
      setError('Please enter the verification code');
      return;
    }

    setLoading(true);
    try {
      const response = await settingsApi.deleteAccount(password, otpCode);
      if (response.status === 'success') {
        // Clear everything and go to onboarding
        await AsyncStorage.multiRemove([
          'talynk_token',
          'talynk_user',
          'talynk_has_seen_onboarding',
        ]);
        Alert.alert(
          'Account Deleted',
          'Your account has been permanently deleted. We\'re sorry to see you go.',
          [{ text: 'OK', onPress: () => router.replace('/onboarding') }]
        );
      } else {
        setError(response.message || 'Failed to delete account');
      }
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const renderWarning = () => (
    <>
      <View style={styles.dangerZone}>
        <View style={styles.dangerIconCircle}>
          <Feather name="alert-triangle" size={36} color={THEME.danger} />
        </View>
        <Text style={styles.dangerTitle}>Delete Your Account?</Text>
        <Text style={styles.dangerDescription}>
          This action is <Text style={{ fontWeight: '800', color: THEME.danger }}>permanent</Text> and cannot be undone. All your data will be permanently removed:
        </Text>
        <View style={styles.dangerList}>
          {[
            'Your profile and personal information',
            'All your posts, videos, and media',
            'Your followers and following lists',
            'Challenge participations and wins',
            'All comments and likes',
          ].map((item, i) => (
            <View key={i} style={styles.dangerListItem}>
              <Feather name="x-circle" size={14} color={THEME.danger} />
              <Text style={styles.dangerListText}>{item}</Text>
            </View>
          ))}
        </View>
      </View>

      <TouchableOpacity
        style={styles.dangerButton}
        onPress={() => setStep('password')}
        activeOpacity={0.8}
      >
        <Text style={styles.dangerButtonText}>I Understand, Continue</Text>
        <Feather name="arrow-right" size={18} color="#fff" />
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.safeButton}
        onPress={() => safeRouterBack(router, '/settings/index' as any)}
        activeOpacity={0.8}
      >
        <Feather name="arrow-left" size={16} color={THEME.accent} />
        <Text style={styles.safeButtonText}>Keep My Account</Text>
      </TouchableOpacity>
    </>
  );

  const renderPassword = () => (
    <>
      <View style={styles.illustrationWrap}>
        <View style={[styles.dangerIconCircle, { width: 64, height: 64, borderRadius: 32 }]}>
          <Feather name="lock" size={28} color={THEME.danger} />
        </View>
        <Text style={styles.illustrationTitle}>Verify Your Identity</Text>
        <Text style={styles.illustrationSubtitle}>
          Enter your current password to receive a verification code via email.
        </Text>
      </View>

      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Current Password</Text>
        <View style={styles.inputWrapper}>
          <Feather name="lock" size={18} color={THEME.textSecondary} style={styles.inputIcon} />
          <TextInput
            style={styles.input}
            placeholder="Enter your password"
            placeholderTextColor={THEME.textSecondary}
            secureTextEntry={!showPassword}
            value={password}
            onChangeText={setPassword}
            autoCapitalize="none"
          />
          <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
            <Feather name={showPassword ? 'eye' : 'eye-off'} size={18} color={THEME.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>

      <TouchableOpacity
        style={[styles.dangerButton, loading && styles.buttonDisabled]}
        onPress={handleRequestOtp}
        disabled={loading}
        activeOpacity={0.8}
      >
        {loading ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <>
            <Text style={styles.dangerButtonText}>Send Verification Code</Text>
            <Feather name="arrow-right" size={18} color="#fff" />
          </>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.safeButton}
        onPress={() => { setStep('warning'); setError(null); }}
      >
        <Feather name="arrow-left" size={16} color={THEME.accent} />
        <Text style={styles.safeButtonText}>Go Back</Text>
      </TouchableOpacity>
    </>
  );

  const renderOtp = () => (
    <>
      <View style={styles.illustrationWrap}>
        <View style={[styles.dangerIconCircle, { width: 64, height: 64, borderRadius: 32 }]}>
          <MaterialIcons name="email" size={28} color={THEME.danger} />
        </View>
        <Text style={styles.illustrationTitle}>Final Confirmation</Text>
        <Text style={styles.illustrationSubtitle}>
          Enter the verification code sent to your email. This will permanently delete your account.
        </Text>
      </View>

      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Verification Code</Text>
        <View style={styles.inputWrapper}>
          <MaterialIcons name="pin" size={18} color={THEME.textSecondary} style={styles.inputIcon} />
          <TextInput
            style={[styles.input, styles.otpInput]}
            placeholder="Enter OTP"
            placeholderTextColor={THEME.textSecondary}
            keyboardType="number-pad"
            value={otpCode}
            onChangeText={setOtpCode}
            maxLength={6}
          />
        </View>
      </View>

      <TouchableOpacity
        style={[styles.dangerButton, loading && styles.buttonDisabled]}
        onPress={handleDeleteAccount}
        disabled={loading}
        activeOpacity={0.8}
      >
        {loading ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <>
            <Feather name="trash-2" size={18} color="#fff" />
            <Text style={styles.dangerButtonText}>Delete My Account Forever</Text>
          </>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.safeButton}
        onPress={() => { setStep('password'); setOtpCode(''); setError(null); }}
      >
        <Feather name="arrow-left" size={16} color={THEME.accent} />
        <Text style={styles.safeButtonText}>Go Back</Text>
      </TouchableOpacity>
    </>
  );

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => safeRouterBack(router, '/settings/index' as any)} style={styles.backButton} hitSlop={12}>
          <Feather name="arrow-left" size={24} color={THEME.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Delete Account</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {error && (
            <View style={styles.errorBanner}>
              <Feather name="alert-circle" size={16} color={THEME.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {step === 'warning' && renderWarning()}
          {step === 'password' && renderPassword()}
          {step === 'otp' && renderOtp()}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: THEME.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 12, backgroundColor: THEME.bg,
  },
  backButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20 },
  headerTitle: { color: THEME.text, fontSize: 18, fontWeight: '700', letterSpacing: 0.3 },
  scrollView: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 60 },
  // Danger Zone
  dangerZone: { alignItems: 'center', marginBottom: 28 },
  dangerIconCircle: {
    width: 76, height: 76, borderRadius: 38,
    backgroundColor: THEME.dangerDim, alignItems: 'center', justifyContent: 'center',
    marginBottom: 16, marginTop: 12,
  },
  dangerTitle: { color: THEME.danger, fontSize: 24, fontWeight: '800', marginBottom: 12, textAlign: 'center' },
  dangerDescription: { color: THEME.textSecondary, fontSize: 14, lineHeight: 21, textAlign: 'center', marginBottom: 20, maxWidth: 320 },
  dangerList: { width: '100%', gap: 8 },
  dangerListItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 8 },
  dangerListText: { color: THEME.textSecondary, fontSize: 14 },
  // Illustration
  illustrationWrap: { alignItems: 'center', marginBottom: 28, paddingTop: 8 },
  illustrationTitle: { color: THEME.text, fontSize: 22, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  illustrationSubtitle: { color: THEME.textSecondary, fontSize: 14, lineHeight: 20, textAlign: 'center', maxWidth: 300 },
  // Inputs
  inputGroup: { marginBottom: 18 },
  inputLabel: { color: THEME.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: 8, marginLeft: 4 },
  inputWrapper: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: THEME.inputBg, borderRadius: 12, borderWidth: 1,
    borderColor: THEME.inputBorder, paddingHorizontal: 14, height: 50,
  },
  inputIcon: { marginRight: 10 },
  input: { flex: 1, color: THEME.text, fontSize: 15 },
  otpInput: { letterSpacing: 8, fontSize: 20, fontWeight: '700', textAlign: 'center' },
  // Error
  errorBanner: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.1)', borderRadius: 10,
    padding: 12, marginBottom: 20,
    borderWidth: 1, borderColor: 'rgba(239, 68, 68, 0.2)',
  },
  errorText: { color: THEME.danger, fontSize: 13, marginLeft: 8, flex: 1 },
  // Buttons
  dangerButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: THEME.danger, borderRadius: 12, height: 50,
    marginTop: 10, gap: 8,
  },
  buttonDisabled: { opacity: 0.6 },
  dangerButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  safeButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    marginTop: 16, gap: 6,
  },
  safeButtonText: { color: THEME.accent, fontSize: 14, fontWeight: '600' },
});
