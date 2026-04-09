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
} from 'react-native';
import { router } from 'expo-router';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { safeRouterBack } from '@/lib/utils/navigation';
import { settingsApi } from '@/lib/api';

const THEME = {
  bg: '#000000',
  card: '#111114',
  cardBorder: '#1e1e24',
  accent: '#60a5fa',
  accentDim: 'rgba(96, 165, 250, 0.12)',
  text: '#f3f4f6',
  textSecondary: '#71717a',
  danger: '#ef4444',
  success: '#10b981',
  successDim: 'rgba(16, 185, 129, 0.12)',
  inputBg: '#18181b',
  inputBorder: '#27272a',
};

type Step = 'form' | 'otp' | 'success';

export default function ChangePasswordScreen() {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<Step>('form');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);

  const handleRequestOtp = async () => {
    setError(null);

    if (!currentPassword.trim()) {
      setError('Please enter your current password');
      return;
    }
    if (newPassword.length < 6) {
      setError('New password must be at least 6 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      const response = await settingsApi.changePasswordRequestOtp(currentPassword, newPassword);
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

  const handleVerifyOtp = async () => {
    setError(null);

    if (otpCode.length < 4) {
      setError('Please enter the verification code');
      return;
    }

    setLoading(true);
    try {
      const response = await settingsApi.changePasswordVerifyOtp(otpCode, newPassword);
      if (response.status === 'success') {
        setStep('success');
      } else {
        setError(response.message || 'Invalid verification code');
      }
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const renderForm = () => (
    <>
      <View style={styles.illustrationWrap}>
        <View style={styles.illustrationCircle}>
          <Feather name="lock" size={32} color={THEME.accent} />
        </View>
        <Text style={styles.illustrationTitle}>Change Your Password</Text>
        <Text style={styles.illustrationSubtitle}>
          We'll send a verification code to your email to confirm the change.
        </Text>
      </View>

      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Current Password</Text>
        <View style={styles.inputWrapper}>
          <Feather name="lock" size={18} color={THEME.textSecondary} style={styles.inputIcon} />
          <TextInput
            style={styles.input}
            placeholder="Enter current password"
            placeholderTextColor={THEME.textSecondary}
            secureTextEntry={!showCurrentPassword}
            value={currentPassword}
            onChangeText={setCurrentPassword}
            autoCapitalize="none"
          />
          <TouchableOpacity onPress={() => setShowCurrentPassword(!showCurrentPassword)}>
            <Feather name={showCurrentPassword ? 'eye' : 'eye-off'} size={18} color={THEME.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>New Password</Text>
        <View style={styles.inputWrapper}>
          <Feather name="key" size={18} color={THEME.textSecondary} style={styles.inputIcon} />
          <TextInput
            style={styles.input}
            placeholder="At least 6 characters"
            placeholderTextColor={THEME.textSecondary}
            secureTextEntry={!showNewPassword}
            value={newPassword}
            onChangeText={setNewPassword}
            autoCapitalize="none"
          />
          <TouchableOpacity onPress={() => setShowNewPassword(!showNewPassword)}>
            <Feather name={showNewPassword ? 'eye' : 'eye-off'} size={18} color={THEME.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Confirm New Password</Text>
        <View style={styles.inputWrapper}>
          <Feather name="check-circle" size={18} color={THEME.textSecondary} style={styles.inputIcon} />
          <TextInput
            style={styles.input}
            placeholder="Re-enter new password"
            placeholderTextColor={THEME.textSecondary}
            secureTextEntry={!showNewPassword}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            autoCapitalize="none"
          />
        </View>
      </View>

      <TouchableOpacity
        style={[styles.primaryButton, loading && styles.buttonDisabled]}
        onPress={handleRequestOtp}
        disabled={loading}
        activeOpacity={0.8}
      >
        {loading ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <>
            <Text style={styles.primaryButtonText}>Send Verification Code</Text>
            <Feather name="arrow-right" size={18} color="#fff" />
          </>
        )}
      </TouchableOpacity>
    </>
  );

  const renderOtp = () => (
    <>
      <View style={styles.illustrationWrap}>
        <View style={[styles.illustrationCircle, { backgroundColor: THEME.accentDim }]}>
          <MaterialIcons name="email" size={32} color={THEME.accent} />
        </View>
        <Text style={styles.illustrationTitle}>Check Your Email</Text>
        <Text style={styles.illustrationSubtitle}>
          We sent a verification code to your email address. Enter it below to confirm your password change.
        </Text>
      </View>

      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Verification Code</Text>
        <View style={styles.inputWrapper}>
          <MaterialIcons name="pin" size={18} color={THEME.textSecondary} style={styles.inputIcon} />
          <TextInput
            style={[styles.input, styles.otpInput]}
            placeholder="Enter OTP code"
            placeholderTextColor={THEME.textSecondary}
            keyboardType="number-pad"
            value={otpCode}
            onChangeText={setOtpCode}
            maxLength={6}
          />
        </View>
      </View>

      <TouchableOpacity
        style={[styles.primaryButton, loading && styles.buttonDisabled]}
        onPress={handleVerifyOtp}
        disabled={loading}
        activeOpacity={0.8}
      >
        {loading ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <>
            <Text style={styles.primaryButtonText}>Verify & Change Password</Text>
            <Feather name="check" size={18} color="#fff" />
          </>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.secondaryButton}
        onPress={() => { setStep('form'); setOtpCode(''); setError(null); }}
      >
        <Feather name="arrow-left" size={16} color={THEME.accent} />
        <Text style={styles.secondaryButtonText}>Go Back</Text>
      </TouchableOpacity>
    </>
  );

  const renderSuccess = () => (
    <View style={styles.successWrap}>
      <View style={[styles.illustrationCircle, { backgroundColor: THEME.successDim, width: 80, height: 80, borderRadius: 40 }]}>
        <Feather name="check-circle" size={40} color={THEME.success} />
      </View>
      <Text style={styles.successTitle}>Password Changed!</Text>
      <Text style={styles.successSubtitle}>
        Your password has been updated successfully. You can use your new password to log in.
      </Text>
      <TouchableOpacity
        style={styles.primaryButton}
        onPress={() => safeRouterBack(router, '/settings/index' as any)}
        activeOpacity={0.8}
      >
        <Text style={styles.primaryButtonText}>Back to Settings</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => safeRouterBack(router, '/settings/index' as any)} style={styles.backButton} hitSlop={12}>
          <Feather name="arrow-left" size={24} color={THEME.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Change Password</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
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

          {step === 'form' && renderForm()}
          {step === 'otp' && renderOtp()}
          {step === 'success' && renderSuccess()}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: THEME.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: THEME.bg,
  },
  backButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20 },
  headerTitle: { color: THEME.text, fontSize: 18, fontWeight: '700', letterSpacing: 0.3 },
  scrollView: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 60 },
  // Illustration
  illustrationWrap: { alignItems: 'center', marginBottom: 32, paddingTop: 12 },
  illustrationCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: THEME.accentDim,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  illustrationTitle: { color: THEME.text, fontSize: 22, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  illustrationSubtitle: { color: THEME.textSecondary, fontSize: 14, lineHeight: 20, textAlign: 'center', maxWidth: 300 },
  // Inputs
  inputGroup: { marginBottom: 18 },
  inputLabel: { color: THEME.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: 8, marginLeft: 4 },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: THEME.inputBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: THEME.inputBorder,
    paddingHorizontal: 14,
    height: 50,
  },
  inputIcon: { marginRight: 10 },
  input: { flex: 1, color: THEME.text, fontSize: 15 },
  otpInput: { letterSpacing: 8, fontSize: 20, fontWeight: '700', textAlign: 'center' },
  // Error
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: 10,
    padding: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.2)',
  },
  errorText: { color: THEME.danger, fontSize: 13, marginLeft: 8, flex: 1 },
  // Buttons
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: THEME.accent,
    borderRadius: 12,
    height: 50,
    marginTop: 10,
    gap: 8,
  },
  buttonDisabled: { opacity: 0.6 },
  primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
    gap: 6,
  },
  secondaryButtonText: { color: THEME.accent, fontSize: 14, fontWeight: '600' },
  // Success
  successWrap: { alignItems: 'center', paddingTop: 40 },
  successTitle: { color: THEME.text, fontSize: 24, fontWeight: '700', marginTop: 20, marginBottom: 10 },
  successSubtitle: { color: THEME.textSecondary, fontSize: 14, lineHeight: 20, textAlign: 'center', maxWidth: 280, marginBottom: 30 },
});
