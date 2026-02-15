import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { authApi } from '@/lib/api';

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

const OTP_LENGTH = 6;

export default function ForgotPasswordScreen() {
  const [step, setStep] = useState(1); // 1=Email, 2=Verify, 3=New password
  const [email, setEmail] = useState('');
  const [otpDigits, setOtpDigits] = useState<string[]>(Array(OTP_LENGTH).fill(''));
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [otpRequestLoading, setOtpRequestLoading] = useState(false);
  const [otpVerifyLoading, setOtpVerifyLoading] = useState(false);
  const [otpRequested, setOtpRequested] = useState(false);
  const [otpVerified, setOtpVerified] = useState(false);
  const [otpCooldownSeconds, setOtpCooldownSeconds] = useState(0);
  const otpInputRefs = useRef<any[]>([]);
  const C = THEME;
  const insets = useSafeAreaInsets();

  const isValidEmail = (value: string) => {
    if (!value.trim()) {
      return false;
    }
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  };

  useEffect(() => {
    setOtpDigits(Array(OTP_LENGTH).fill(''));
    setOtpVerified(false);
    setResetToken(null);
  }, [email]);

  useEffect(() => {
    if (otpCooldownSeconds <= 0) {
      return;
    }
    const timer = setInterval(() => {
      setOtpCooldownSeconds((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [otpCooldownSeconds]);

  // Auto-verify OTP when all digits are entered
  useEffect(() => {
    const code = otpDigits.join('');
    if (code.length === OTP_LENGTH && !otpVerifyLoading) {
      verifyResetCode(code);
    }
  }, [otpDigits]);

  const handleRequestOtp = async (): Promise<boolean> => {
    setError(null);
    setSuccess(null);
    setWarning(null);

    if (!isValidEmail(email)) {
      setWarning('Please enter a valid email address before requesting a code');
      return false;
    }

    if (otpCooldownSeconds > 0 || otpRequestLoading) {
      return false;
    }

    setOtpRequestLoading(true);
    try {
      const response = await authApi.requestPasswordResetOtp(email.trim());
      if (response.status === 'success') {
        setOtpRequested(true);
        setWarning(null);
        setSuccess('If an account exists with this email, a password reset code has been sent.');
        const remaining = (response.data as any)?.remainingSeconds;
        if (typeof remaining === 'number' && remaining > 0) {
          setOtpCooldownSeconds(remaining);
        } else {
          setOtpCooldownSeconds(60);
        }
        return true;
      } else {
        const remaining = (response.data as any)?.remainingSeconds;
        if (typeof remaining === 'number' && remaining > 0) {
          setOtpCooldownSeconds(remaining);
        }
        setWarning(response.message || 'Could not send reset code. Please try again.');
        return false;
      }
    } catch (err: any) {
      setWarning('Failed to send reset code. Please check your connection and try again.');
      return false;
    } finally {
      setOtpRequestLoading(false);
    }
  };

  const handleOtpChange = (index: number, value: string) => {
    const cleaned = value.replace(/\D/g, '');
    const char = cleaned.slice(-1);

    setOtpDigits((prev) => {
      const next = [...prev];
      next[index] = char;
      return next;
    });

    if (char && index < OTP_LENGTH - 1) {
      const nextRef = otpInputRefs.current[index + 1];
      if (nextRef && typeof nextRef.focus === 'function') {
        nextRef.focus();
      }
    }
  };

  const handleOtpKeyPress = (index: number, key: string) => {
    if (key === 'Backspace' && !otpDigits[index] && index > 0) {
      const prevRef = otpInputRefs.current[index - 1];
      if (prevRef && typeof prevRef.focus === 'function') {
        prevRef.focus();
      }
      setOtpDigits((prev) => {
        const next = [...prev];
        next[index - 1] = '';
        return next;
      });
    }
  };

  const verifyResetCode = async (code: string) => {
    setError(null);
    setSuccess(null);
    setWarning(null);

    if (!isValidEmail(email)) {
      setWarning('Please enter a valid email address before verifying your code');
      return;
    }

    if (!code || code.length !== OTP_LENGTH) {
      setWarning('Please enter the 6-digit verification code sent to your email');
      return;
    }

    if (otpVerifyLoading) {
      return;
    }

    setOtpVerifyLoading(true);
    try {
      const response = await authApi.verifyPasswordResetOtp(email.trim(), code);
      if (response.status === 'success' && (response.data as any)?.resetToken) {
        const token = (response.data as any).resetToken as string;
        setResetToken(token);
        setOtpVerified(true);
        setWarning(null);
        setSuccess('Code verified. You can now set a new password.');
        setStep(3);
      } else {
        const codeValue = (response.data as any)?.code;
        if (codeValue === 'OTP_EXPIRED') {
          setWarning('Your code has expired. Please request a new one.');
        } else if (codeValue === 'INVALID_OTP') {
          setWarning('The code you entered is incorrect. Please try again.');
        } else if (codeValue === 'OTP_ALREADY_USED') {
          setWarning('This code was already used. Please request a new one.');
        } else {
          setWarning(response.message || 'Could not verify code. Please try again.');
        }
        setOtpVerified(false);
        setResetToken(null);
      }
    } catch (err: any) {
      setWarning('Failed to verify code. Please check your connection and try again.');
      setOtpVerified(false);
      setResetToken(null);
    } finally {
      setOtpVerifyLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    const code = otpDigits.join('');
    await verifyResetCode(code);
  };

  const handleResetPassword = async () => {
    setError(null);
    setSuccess(null);
    setWarning(null);

    if (!resetToken || !otpVerified) {
      setWarning('Please verify the code we sent to your email first.');
      return;
    }

    if (!password) {
      setWarning('Please enter a new password');
      return;
    }

    if (!confirmPassword) {
      setWarning('Please confirm your new password');
      return;
    }

    if (password.length < 8) {
      setWarning('Password must be at least 8 characters long');
      return;
    }

    if (password !== confirmPassword) {
      setWarning('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      const response = await authApi.resetPassword(resetToken, password);
      if (response.status === 'success') {
        setSuccess('Password reset successfully. You can now log in with your new password.');
        setTimeout(() => {
          router.replace('/auth/login');
        }, 800);
      } else {
        setWarning(response.message || 'Failed to reset password. Please try again.');
      }
    } catch (err: any) {
      setWarning('Failed to reset password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const validateStep = (current: number) => {
    if (current === 1) {
      if (!isValidEmail(email)) return 'Enter a valid email';
      return null;
    }
    if (current === 2) {
      if (!otpVerified) return 'Please verify your email with the code we sent';
      return null;
    }
    if (current === 3) {
      if (!password) return 'Please enter a new password';
      if (!confirmPassword) return 'Please confirm your new password';
      if (password.length < 8) return 'Password must be at least 8 characters long';
      if (password !== confirmPassword) return 'Passwords do not match';
      return null;
    }
    return null;
  };

  const handleNext = async () => {
    const err = validateStep(step);
    if (err) {
      setWarning(err);
      return;
    }
    setWarning(null);

    if (step === 1) {
      const ok = await handleRequestOtp();
      if (!ok) {
        return;
      }
      setStep(2);
      return;
    }

    setStep(Math.min(3, step + 1));
  };

  const handleBack = () => {
    setWarning(null);
    setStep(Math.max(1, step - 1));
  };

  const isFormBusy = loading || otpRequestLoading || otpVerifyLoading;

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: C.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <StatusBar style="light" backgroundColor="#000000" />
      <ScrollView
        style={{ backgroundColor: C.background }}
        contentContainerStyle={styles.scrollContainer}
        keyboardShouldPersistTaps="handled"
      >
        {/* Back button */}
        <View style={[styles.navRow, { marginTop: insets.top + 4 }]}>
          <TouchableOpacity
            onPress={() => {
              if (router.canGoBack()) {
                router.back();
              } else {
                router.replace('/auth/login');
              }
            }}
            style={[styles.backButton, { borderColor: C.border }]}
          >
            <Ionicons name="chevron-back" size={26} color={C.text} />
          </TouchableOpacity>
        </View>

        {/* Stepper */}
        <View style={styles.stepper}>
          {[1, 2, 3].map((s) => (
            <View key={s} style={styles.stepItem}>
              <View
                style={[
                  styles.stepDot,
                  { backgroundColor: step >= s ? C.primary : C.border },
                ]}
              />
              <Text style={[styles.stepLabel, { color: C.textSecondary }]}>
                {s === 1 ? 'Email' : s === 2 ? 'Verify' : 'New Password'}
              </Text>
            </View>
          ))}
        </View>

        <View style={styles.header}>
          <Text style={[styles.title, { color: C.text }]}>Reset your password</Text>
          <Text style={[styles.subtitle, { color: C.textSecondary }]}>
            Enter your email, verify with the code we send, and set a new password.
          </Text>
        </View>

        {/* Alerts */}
        {error && (
          <View style={[styles.alert, { backgroundColor: C.errorBg, borderColor: C.errorBorder }]}>
            <Ionicons name="alert-circle" size={20} color={'#fecaca'} style={{ marginRight: 8 }} />
            <Text style={[styles.alertText, { color: C.text }]}>{error}</Text>
          </View>
        )}
        {success && (
          <View
            style={[
              styles.alert,
              { backgroundColor: C.successBg, borderColor: C.successBorder },
            ]}
          >
            <Ionicons name="checkmark-circle" size={20} color={'#22c55e'} style={{ marginRight: 8 }} />
            <Text style={[styles.alertText, { color: C.text }]}>{success}</Text>
          </View>
        )}
        {warning && (
          <View
            style={[
              styles.alert,
              { backgroundColor: C.warningBg, borderColor: C.warningBorder },
            ]}
          >
            <Ionicons name="warning" size={20} color={'#fde68a'} style={{ marginRight: 8 }} />
            <Text style={[styles.alertText, { color: C.text }]}>{warning}</Text>
          </View>
        )}

        <View style={[styles.form, { backgroundColor: C.card, borderColor: C.border }]}>
          {/* Step 1: Email */}
          {step === 1 && (
            <View>
              <Text style={[styles.label, { color: C.text }]}>Email</Text>
              <View
                style={[
                  styles.inputWrapper,
                  { backgroundColor: C.input, borderColor: C.inputBorder },
                ]}
              >
                <Ionicons
                  name="mail-outline"
                  size={20}
                  color={C.textSecondary}
                  style={styles.inputIconLeft}
                />
                <TextInput
                  style={[styles.inputField, { color: C.text }]}
                  placeholder="name@example.com"
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  placeholderTextColor={C.placeholder}
                  editable={!isFormBusy}
                />
              </View>

              <TouchableOpacity
                style={[styles.button, { backgroundColor: C.primary, marginTop: 8 }]}
                onPress={handleNext}
                disabled={isFormBusy}
                activeOpacity={0.8}
              >
                {otpRequestLoading ? (
                  <ActivityIndicator color="#000" />
                ) : (
                  <Text style={[styles.buttonText, { color: '#000' }]}>Continue</Text>
                )}
              </TouchableOpacity>
            </View>
          )}

          {/* Step 2: Verify (OTP) */}
          {step === 2 && (
            <View>
              <Text style={[styles.label, { color: C.text }]}>Verify your email</Text>
              <Text style={[styles.helperText, { color: C.textSecondary }]}>
                We sent a 6-digit code to {email.trim() || 'your email address'} to verify your
                password reset request.
              </Text>

              <View
                style={{
                  marginTop: 16,
                  marginBottom: 16,
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  paddingHorizontal: 8,
                }}
              >
                {Array.from({ length: OTP_LENGTH }).map((_, index) => {
                  // Calculate responsive width to fit all 6 boxes
                  const totalMargin = 8 * 2; // Left and right padding
                  const totalGaps = (OTP_LENGTH - 1) * 8; // Gaps between boxes
                  const availableWidth = Dimensions.get('window').width - 40 - totalMargin - totalGaps; // 40 for form padding
                  const boxWidth = Math.floor(availableWidth / OTP_LENGTH);

                  return (
                    <TextInput
                      key={index}
                      ref={(el) => { otpInputRefs.current[index] = el; }}
                      style={[
                        {
                          width: boxWidth,
                          height: 56,
                          borderRadius: 14,
                          borderWidth: 1,
                          textAlign: 'center',
                          fontSize: 20,
                          marginHorizontal: 4,
                          backgroundColor: C.input,
                          borderColor: C.inputBorder,
                          color: C.text,
                        },
                        {
                          shadowColor: '#000',
                          shadowOpacity: 0.25,
                          shadowRadius: 8,
                          shadowOffset: { width: 0, height: 4 },
                          elevation: 4,
                        }
                      ]}
                      value={otpDigits[index]}
                      onChangeText={(value) => handleOtpChange(index, value)}
                      onKeyPress={({ nativeEvent }) => handleOtpKeyPress(index, nativeEvent.key)}
                      keyboardType="number-pad"
                      maxLength={1}
                      autoCapitalize="none"
                      autoCorrect={false}
                      placeholder="-"
                      placeholderTextColor={C.placeholder}
                      editable={!otpVerifyLoading}
                    />
                  );
                })}
              </View>

              {otpVerifyLoading && (
                <ActivityIndicator style={{ marginBottom: 12 }} color={C.primary} />
              )}

              {otpCooldownSeconds > 0 ? (
                <Text style={[styles.helperText, { color: C.textSecondary }]}>
                  You can request another code in {otpCooldownSeconds}s.
                </Text>
              ) : (
                <TouchableOpacity
                  style={[
                    styles.button,
                    {
                      backgroundColor: otpRequestLoading ? C.buttonDisabled : C.primary,
                    },
                  ]}
                  onPress={handleRequestOtp}
                  disabled={otpRequestLoading}
                  activeOpacity={0.8}
                >
                  {otpRequestLoading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.buttonText}>Resend code</Text>
                  )}
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={[
                  styles.button,
                  {
                    backgroundColor: otpVerifyLoading ? C.buttonDisabled : C.primary,
                    marginTop: 12,
                  },
                ]}
                onPress={handleVerifyOtp}
                disabled={otpVerifyLoading}
                activeOpacity={0.8}
              >
                {otpVerifyLoading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>Verify code</Text>
                )}
              </TouchableOpacity>
            </View>
          )}

          {/* Step 3: New password */}
          {step === 3 && (
            <View>
              <Text style={[styles.label, { color: C.text }]}>New password</Text>
              <View
                style={[
                  styles.passwordInputContainer,
                  { backgroundColor: C.input, borderColor: C.inputBorder },
                ]}
              >
                <TextInput
                  style={[
                    styles.input,
                    {
                      flex: 1,
                      marginBottom: 0,
                      backgroundColor: 'transparent',
                      borderColor: 'transparent',
                      color: C.text,
                    },
                  ]}
                  placeholder="••••••••"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!loading}
                  placeholderTextColor={C.placeholder}
                />
                <TouchableOpacity
                  style={styles.eyeButton}
                  onPress={() => setShowPassword((v) => !v)}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={showPassword ? 'eye-off' : 'eye'}
                    size={22}
                    color={C.placeholder}
                  />
                </TouchableOpacity>
              </View>
              <Text style={[styles.helperText, { color: C.textSecondary }]}>
                Password must be at least 8 characters long.
              </Text>

              <Text style={[styles.label, { color: C.text }]}>Confirm new password</Text>
              <View
                style={[
                  styles.passwordInputContainer,
                  { backgroundColor: C.input, borderColor: C.inputBorder },
                ]}
              >
                <TextInput
                  style={[
                    styles.input,
                    {
                      flex: 1,
                      marginBottom: 0,
                      backgroundColor: 'transparent',
                      borderColor: 'transparent',
                      color: C.text,
                    },
                  ]}
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  secureTextEntry={!showConfirmPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!loading}
                  placeholderTextColor={C.placeholder}
                />
                <TouchableOpacity
                  style={styles.eyeButton}
                  onPress={() => setShowConfirmPassword((v) => !v)}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={showConfirmPassword ? 'eye-off' : 'eye'}
                    size={22}
                    color={C.placeholder}
                  />
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={[
                  styles.button,
                  { backgroundColor: loading ? C.buttonDisabled : C.primary },
                ]}
                onPress={handleResetPassword}
                disabled={loading}
                activeOpacity={0.8}
              >
                {loading ? (
                  <ActivityIndicator color="#000" />
                ) : (
                  <Text style={[styles.buttonText, { color: '#000' }]}>Reset password</Text>
                )}
              </TouchableOpacity>
            </View>
          )}

          {/* Back navigation for steps 2 and 3 */}
          {step > 1 && (
            <View style={styles.wizardNav}>
              <TouchableOpacity
                style={[styles.navButton, { borderColor: C.border }]}
                onPress={handleBack}
                activeOpacity={0.8}
              >
                <Text style={{ color: C.text }}>Back</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 20,
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
  stepper: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginHorizontal: 20,
    marginTop: 8,
    marginBottom: 4,
  },
  stepItem: {
    alignItems: 'center',
    flex: 1,
  },
  stepDot: {
    width: '80%',
    height: 4,
    borderRadius: 999,
    marginBottom: 6,
  },
  stepLabel: {
    fontSize: 12,
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
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
  input: {
    borderWidth: 1,
    borderRadius: 8,
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
  helperText: {
    fontSize: 12,
    marginTop: -4,
    marginBottom: 12,
  },
  passwordInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 12,
  },
  eyeButton: {
    padding: 10,
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
  wizardNav: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  navButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
  },
  navButtonPrimary: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
});


