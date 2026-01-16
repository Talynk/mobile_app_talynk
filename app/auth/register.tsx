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
  Pressable,
  Linking,
} from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '@/lib/auth-context';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Modal, FlatList, Dimensions } from 'react-native';
import { authApi, countriesApi } from '@/lib/api';
import { Country } from '@/types';

const { width: screenWidth } = Dimensions.get('window');

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

// Minimal country data. Extend as needed.
const COUNTRIES = [
  { id: 1, name: 'Rwanda', code: 'RW', dialCode: '+250' },
  { id: 2, name: 'Kenya', code: 'KE', dialCode: '+254' },
  { id: 3, name: 'Uganda', code: 'UG', dialCode: '+256' },
  { id: 4, name: 'Tanzania', code: 'TZ', dialCode: '+255' },
  { id: 5, name: 'Nigeria', code: 'NG', dialCode: '+234' },
  { id: 6, name: 'Ghana', code: 'GH', dialCode: '+233' },
  { id: 7, name: 'South Africa', code: 'ZA', dialCode: '+27' },
  { id: 8, name: 'United States', code: 'US', dialCode: '+1' },
  { id: 9, name: 'United Kingdom', code: 'GB', dialCode: '+44' },
];

const OTP_LENGTH = 6;

export default function RegisterScreen() {
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [phone1, setPhone1] = useState('');
  const [phone2, setPhone2] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [showSuccessOverlay, setShowSuccessOverlay] = useState(false);
  const { loading, error, clearError } = useAuth();
  const C = THEME;
  const insets = useSafeAreaInsets();
  // Steps:
  // 1 = Email
  // 2 = Verify (OTP)
  // 3 = Security (password)
  // 4 = Profile / Onboarding (name, username, country, phones)
  const [step, setStep] = useState(1);
  const [countryModalOpen, setCountryModalOpen] = useState(false);
  const [selectedCountry, setSelectedCountry] = useState(COUNTRIES[0]); // Default Rwanda
  const [countries, setCountries] = useState<Country[]>(COUNTRIES);
  const [loadingCountries, setLoadingCountries] = useState(false);
  const [otpRequested, setOtpRequested] = useState(false);
  const [otpVerified, setOtpVerified] = useState(false);
  const [verificationToken, setVerificationToken] = useState<string | null>(null);
  const [otpRequestLoading, setOtpRequestLoading] = useState(false);
  const [otpVerifyLoading, setOtpVerifyLoading] = useState(false);
  const [otpCooldownSeconds, setOtpCooldownSeconds] = useState(0);
  const [registerLoading, setRegisterLoading] = useState(false);
  const [otpDigits, setOtpDigits] = useState<string[]>(Array(OTP_LENGTH).fill(''));
  const otpInputRefs = useRef<any[]>([]);

  // Fetch countries from backend on mount (with fallback to static list)
  useEffect(() => {
    const loadCountries = async () => {
      try {
        setLoadingCountries(true);
        const res = await countriesApi.getAll();
        if (res.status === 'success' && (res.data as any)?.countries?.length) {
          // Map missing dial codes if needed; keep existing static dial codes for known ones
          const fetched = (res.data as any).countries as Country[];
          // Merge by code to preserve dial codes from static list when available
          const byCode: Record<string, any> = {};
          COUNTRIES.forEach(c => byCode[c.code] = c);
          const merged = fetched.map(fc => ({
            ...fc,
            dialCode: (byCode[fc.code] && (byCode[fc.code] as any).dialCode) || '+000',
          })) as any[];
          setCountries(merged as any);
          // If current selected not in list, default to Rwanda if present else first
          const foundRw = merged.find((c: any) => c.code === 'RW');
          setSelectedCountry(foundRw || merged[0]);
        }
      } catch {}
      finally {
        setLoadingCountries(false);
      }
    };
    loadCountries();
  }, []);

  // Reset verification when email changes
  useEffect(() => {
    setOtpVerified(false);
    setVerificationToken(null);
    setOtpDigits(Array(OTP_LENGTH).fill(''));
  }, [email]);

  // Simple countdown for OTP cooldown
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
      // Fire and forget; button still available as fallback
      verifyRegistrationCode(code);
    }
  }, [otpDigits]);

  const isFormBusy = loading || registerLoading || otpRequestLoading || otpVerifyLoading;

  const isValidEmail = (value: string) => {
    if (!value.trim()) {
      return false;
    }
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  };

  const handleRequestOtp = async (): Promise<boolean> => {
    clearError();
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
      const response = await authApi.requestRegistrationOtp(email.trim());
      if (response.status === 'success') {
        setOtpRequested(true);
        setWarning(null);
        setSuccess('We sent a verification code to your email. Enter it below to verify.');
        const remaining = (response.data as any)?.remainingSeconds;
        if (typeof remaining === 'number' && remaining > 0) {
          setOtpCooldownSeconds(remaining);
        } else {
          setOtpCooldownSeconds(60);
        }
        return true;
      } else {
        setOtpRequested(false);
        const remaining = (response.data as any)?.remainingSeconds;
        if (typeof remaining === 'number' && remaining > 0) {
          setOtpCooldownSeconds(remaining);
        }
        setWarning(response.message || 'Could not send verification code. Please try again.');
        return false;
      }
    } catch (err: any) {
      setWarning('Failed to send verification code. Please check your connection and try again.');
      return false;
    } finally {
      setOtpRequestLoading(false);
    }

    return false;
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

  const verifyRegistrationCode = async (code: string) => {
    clearError();
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
      const response = await authApi.verifyRegistrationOtp(email.trim(), code);
      if (response.status === 'success' && (response.data as any)?.verificationToken) {
        const token = (response.data as any).verificationToken as string;
        setVerificationToken(token);
        setOtpVerified(true);
        setWarning(null);
        setSuccess('Email verified successfully. You can now set your password.');
        setStep(3);
      } else {
        const code = (response.data as any)?.code;
        if (code === 'OTP_EXPIRED') {
          setWarning('Your code has expired. Please request a new one.');
        } else if (code === 'INVALID_OTP') {
          setWarning('The code you entered is incorrect. Please try again.');
        } else if (code === 'OTP_ALREADY_USED') {
          setWarning('This code was already used. Please request a new one.');
        } else {
          setWarning(response.message || 'Could not verify code. Please try again.');
        }
        setOtpVerified(false);
        setVerificationToken(null);
      }
    } catch (err: any) {
      setWarning('Failed to verify code. Please check your connection and try again.');
      setOtpVerified(false);
      setVerificationToken(null);
    } finally {
      setOtpVerifyLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    const code = otpDigits.join('');
    await verifyRegistrationCode(code);
  };

  const buildCompleteRegistrationPayload = () => {
    if (!verificationToken) {
      return null;
    }

    const trimmedName = name.trim();
    const trimmedUsername = username.trim();
    const trimmedEmail = email.trim();

    const digitsOnly = (v: string) => v.replace(/\D/g, '');

    const payload = {
      verificationToken,
      username: trimmedUsername,
      display_name: trimmedName || trimmedUsername,
      password,
      country_id: selectedCountry.id,
      // For now, use a static date of birth placeholder; can be replaced with actual field later
      date_of_birth: '1990-01-01',
      email: trimmedEmail || undefined,
      phone1: phone1.trim()
        ? `${selectedCountry.dialCode}${digitsOnly(phone1)}`
        : undefined,
      phone2: phone2.trim()
        ? `${selectedCountry.dialCode}${digitsOnly(phone2)}`
        : undefined,
    };

    return payload;
  };

  const handleRegister = async () => {
    clearError();
    setSuccess(null);
    setWarning(null);

    const trimmedName = name.trim();
    const trimmedUsername = username.trim();

    if (!isValidEmail(email)) {
      setWarning('Please enter a valid email address');
      return;
    }

    if (!otpVerified || !verificationToken) {
      setWarning('Please verify your email with the code we sent before signing up.');
      return;
    }

    if (!password) {
      setWarning('Please enter a password');
      return;
    }

    if (!confirmPassword) {
      setWarning('Please confirm your password');
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

    if (!agreed) {
      setWarning('You must agree to the Terms and Conditions');
      return;
    }

    if (!trimmedName) {
      setWarning('Please enter your full name');
      return;
    }

    if (!trimmedUsername) {
      setWarning('Please enter a username');
      return;
    }

    if (!/^[a-zA-Z0-9_]+$/.test(trimmedUsername)) {
      setWarning('Username can only contain letters, numbers, and underscores');
      return;
    }

    const payload = buildCompleteRegistrationPayload();
    if (!payload) {
      setWarning('Something went wrong while preparing your registration. Please try again.');
      return;
    }

    setRegisterLoading(true);
    try {
      const response = await authApi.completeRegistration(payload as any);
      if (response.status === 'success') {
        setShowSuccessOverlay(true);
      } else {
        setWarning(response.message || 'Registration failed. Please try again.');
      }
    } catch (err: any) {
      setWarning('Registration failed. Please try again.');
    } finally {
      setRegisterLoading(false);
    }
  };

  const openTerms = () => {
    router.push({ pathname: '/auth/terms' as any });
  };

  const validateStep = (s: number) => {
    if (s === 1) {
      if (!isValidEmail(email)) return 'Enter a valid email';
      return null;
    }
    if (s === 2) {
      if (!otpVerified) return 'Please verify your email with the code we sent';
      return null;
    }
    if (s === 3) {
      if (!password) return 'Please enter a password';
      if (!confirmPassword) return 'Please confirm your password';
      if (password.length < 8) return 'Password must be at least 8 characters long';
      if (password !== confirmPassword) return 'Passwords do not match';
      if (!agreed) return 'You must agree to the Terms and Conditions';
      return null;
    }
    if (s === 4) {
      if (!name.trim()) return 'Please enter your full name';
      if (!username.trim()) return 'Please enter a username';
      if (!/^[a-zA-Z0-9_]+$/.test(username.trim())) {
        return 'Username can only contain letters, numbers, and underscores';
      }
      const digitsOnly = (v: string) => v.replace(/\D/g, '');
      if (phone1.trim() && digitsOnly(phone1).length < 7) return 'Enter a valid primary phone number';
      if (phone2.trim() && digitsOnly(phone2).length < 7) return 'Enter a valid secondary phone number';
      return null;
    }
    return null;
  };

  const handleNext = async () => {
    const err = validateStep(step);
    if (err) { setWarning(err); return; }
    setWarning(null);

    if (step === 1) {
      const ok = await handleRequestOtp();
      if (!ok) {
        return;
      }
      setStep(2);
      return;
    }

    setStep(Math.min(4, step + 1));
  };

  const handleBack = () => {
    setWarning(null);
    setStep(Math.max(1, step - 1));
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: C.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <StatusBar style="light" backgroundColor="#000000" />
      <ScrollView style={{ backgroundColor: C.background }} contentContainerStyle={styles.scrollContainer} keyboardShouldPersistTaps="handled">
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
          {[1, 2, 3, 4].map((s) => (
            <View key={s} style={styles.stepItem}>
              <View style={[styles.stepDot, { backgroundColor: step >= s ? C.primary : C.border }]} />
              <Text style={[styles.stepLabel, { color: C.textSecondary }]}>
                {s === 1 ? 'Email' : s === 2 ? 'Verify' : s === 3 ? 'Security' : 'Profile'}
              </Text>
            </View>
          ))}
        </View>

        <View style={styles.header}>
          <Text style={[styles.title, { color: C.text }]}>Create your account</Text>
          <Text style={[styles.subtitle, { color: C.textSecondary }]}>Sign up to join Talynk.</Text>
        </View>

        {/* Alerts */}
        {error && (
          <View style={[styles.alert, { backgroundColor: C.errorBg, borderColor: C.errorBorder }]}> 
            <Ionicons name="alert-circle" size={20} color={'#fecaca'} style={{ marginRight: 8 }} />
            <Text style={[styles.alertText, { color: C.text }]}>{error}</Text>
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
          {/* Step 1: Email */}
          {step === 1 && (
            <View>
              <Text style={[styles.label, { color: C.text }]}>Email</Text>
              <TextInput
                style={[styles.input, { backgroundColor: C.input, borderColor: C.inputBorder, color: C.text }]}
                placeholder="name@example.com"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                placeholderTextColor={C.placeholder}
                editable={!isFormBusy}
              />
              <Text style={[styles.helperText, { color: C.textSecondary }]}>
                We&apos;ll send a verification code to this email.
              </Text>
            </View>
          )}

          {/* Step 2: Verify (OTP) */}
          {step === 2 && (
            <View>
              <Text style={[styles.label, { color: C.text }]}>Verify your email</Text>
              <Text style={[styles.helperText, { color: C.textSecondary }]}>
                We sent a 6-digit code to {email.trim() || 'your email address'} to verify your account.
              </Text>

              <View style={{ marginTop: 16, marginBottom: 16, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 8 }}>
                {Array.from({ length: OTP_LENGTH }).map((_, index) => {
                  // Calculate responsive width to fit all 6 boxes
                  const totalMargin = 8 * 2; // Left and right padding
                  const totalGaps = (OTP_LENGTH - 1) * 8; // Gaps between boxes
                  const availableWidth = screenWidth - 40 - totalMargin - totalGaps; // 40 for form padding
                  const boxWidth = Math.floor(availableWidth / OTP_LENGTH);
                  
                  return (
                    <TextInput
                      key={index}
                      ref={(el) => (otpInputRefs.current[index] = el)}
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
                        },
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
                  },
                ]}
                onPress={handleVerifyOtp}
                disabled={otpVerifyLoading}
                activeOpacity={0.8}
              >
                {otpVerifyLoading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>Verify email</Text>
                )}
              </TouchableOpacity>

              {otpVerified && (
                <Text style={[styles.helperText, { color: '#22c55e' }]}>
                  Email verified. You can now set your password.
                </Text>
              )}
            </View>
          )}

          {/* Step 3: Security (password) */}
          {step === 3 && (
            <View>
              <Text style={[styles.label, { color: C.text }]}>Password</Text>
              <View style={[styles.passwordInputContainer, { backgroundColor: C.input, borderColor: C.inputBorder }]}> 
                <TextInput
                  style={[styles.input, { flex: 1, marginBottom: 0, backgroundColor: 'transparent', borderColor: 'transparent', color: C.text }]}
                  placeholder="••••••••"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!isFormBusy}
                  placeholderTextColor={C.placeholder}
                />
                <Pressable
                  style={styles.eyeButton}
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
              <Text style={[styles.helperText, { color: C.textSecondary }]}> 
                Password must be at least 8 characters long
              </Text>

              <Text style={[styles.label, { color: C.text }]}>Confirm Password</Text>
              <View style={[styles.passwordInputContainer, { backgroundColor: C.input, borderColor: C.inputBorder }]}> 
                <TextInput
                  style={[styles.input, { flex: 1, marginBottom: 0, backgroundColor: 'transparent', borderColor: 'transparent', color: C.text }]}
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  secureTextEntry={!showConfirmPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!isFormBusy}
                  placeholderTextColor={C.placeholder}
                />
                <Pressable
                  style={styles.eyeButton}
                  onPress={() => setShowConfirmPassword((v) => !v)}
                  hitSlop={10}
                >
                  <Ionicons
                    name={showConfirmPassword ? 'eye-off' : 'eye'}
                    size={22}
                    color={C.placeholder}
                  />
                </Pressable>
              </View>

              <View style={styles.termsContainer}>
                <Pressable
                  onPress={() => setAgreed((v) => !v)}
                  style={[
                    styles.checkbox,
                    {
                      borderColor: agreed ? '#ffffff' : '#ffffff',
                      backgroundColor: agreed ? '#ffffff' : 'transparent',
                    }
                  ]}
                  hitSlop={10}
                >
                  {agreed && <Ionicons name="checkmark" size={16} color="#000000" />}
                </Pressable>
                <Text style={[styles.termsText, { color: C.text }]}> 
                  I agree to the{' '}
                  <Text style={[styles.termsLink, { color: C.primary }]} onPress={openTerms}>
                    Terms and Conditions
                  </Text>
                </Text>
              </View>
            </View>
          )}

          {/* Step 4: Profile / Onboarding */}
          {step === 4 && (
            <View>
              <Text style={[styles.label, { color: C.text }]}>Display name</Text>
              <TextInput
                style={[styles.input, { backgroundColor: C.input, borderColor: C.inputBorder, color: C.text }]}
                placeholder="John Doe"
                value={name}
                onChangeText={setName}
                autoCapitalize="words"
                autoCorrect={false}
                placeholderTextColor={C.placeholder}
                editable={!isFormBusy}
              />

              <Text style={[styles.label, { color: C.text }]}>Username</Text>
              <TextInput
                style={[styles.input, { backgroundColor: C.input, borderColor: C.inputBorder, color: C.text }]}
                placeholder="johndoe"
                value={username}
                onChangeText={setUsername}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="default"
                placeholderTextColor={C.placeholder}
                editable={!isFormBusy}
              />
              <Text style={[styles.helperText, { color: C.textSecondary }]}>
                Username can only contain letters, numbers, and underscores
              </Text>

              <Text style={[styles.label, { color: C.text }]}>Country</Text>
              <TouchableOpacity
                onPress={() => setCountryModalOpen(true)}
                activeOpacity={0.7}
                style={[styles.input, { backgroundColor: C.input, borderColor: C.inputBorder, flexDirection: 'row', alignItems: 'center' }]}
              >
                <Text style={{ color: C.text, flex: 1 }}>{selectedCountry.name}</Text>
                <Text style={{ color: C.textSecondary }}>{selectedCountry.dialCode}</Text>
              </TouchableOpacity>

              <View style={[styles.phoneRow, { marginTop: 16, marginBottom: 12 }]}>
                <Text style={[styles.label, { color: C.text }]}>Primary Phone (Optional)</Text>
              </View>
              <View style={styles.phoneInputRow}>
                <View style={[styles.dialBox, { backgroundColor: C.input, borderColor: C.inputBorder }]}>
                  <Text style={{ color: C.text }}>{selectedCountry.dialCode}</Text>
                </View>
                <TextInput
                  style={[styles.phoneInputFlex, { backgroundColor: C.input, borderColor: C.inputBorder, color: C.text }]}
                  placeholder="7XX XXX XXX"
                  value={phone1}
                  onChangeText={setPhone1}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="phone-pad"
                  placeholderTextColor={C.placeholder}
                  editable={!isFormBusy}
                />
              </View>

              <View style={[styles.phoneRow, { marginTop: 16, marginBottom: 12 }]}>
                <Text style={[styles.label, { color: C.text }]}>Secondary Phone (Optional)</Text>
              </View>
              <View style={styles.phoneInputRow}>
                <View style={[styles.dialBox, { backgroundColor: C.input, borderColor: C.inputBorder }]}>
                  <Text style={{ color: C.text }}>{selectedCountry.dialCode}</Text>
                </View>
                <TextInput
                  style={[styles.phoneInputFlex, { backgroundColor: C.input, borderColor: C.inputBorder, color: C.text }]}
                  placeholder="7XX XXX XXX"
                  value={phone2}
                  onChangeText={setPhone2}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="phone-pad"
                  placeholderTextColor={C.placeholder}
                  editable={!isFormBusy}
                />
              </View>
              <Text style={[styles.helperText, { color: C.textSecondary }]}>
                Your country code is pre-selected. Enter numbers without leading zero.
              </Text>

              <TouchableOpacity
                style={[styles.button, { backgroundColor: isFormBusy ? C.buttonDisabled : C.primary }]}
                onPress={handleRegister}
                disabled={isFormBusy}
                activeOpacity={0.8}
              >
                {isFormBusy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>Complete Sign Up</Text>
                )}
              </TouchableOpacity>
            </View>
          )}

          {/* Navigation Buttons */}
          <View style={styles.wizardNav}>
            {step > 1 && (
              <TouchableOpacity style={[styles.navButton, { borderColor: C.border }]} onPress={handleBack} activeOpacity={0.8}>
                <Text style={{ color: C.text }}>Back</Text>
              </TouchableOpacity>
            )}
            {step < 4 && (
              <TouchableOpacity
                style={[
                  styles.navButtonPrimary,
                  {
                    backgroundColor:
                      step === 1 && otpRequestLoading ? C.buttonDisabled : C.primary,
                  },
                ]}
                onPress={handleNext}
                disabled={step === 1 && otpRequestLoading}
                activeOpacity={0.8}
              >
                {step === 1 && otpRequestLoading ? (
                  <ActivityIndicator color="#000" />
                ) : (
                  <Text style={{ color: '#000', fontWeight: '600' }}>
                    {step === 1 ? 'Continue' : 'Next'}
                  </Text>
                )}
              </TouchableOpacity>
            )}
          </View>

          <TouchableOpacity
            style={styles.linkButton}
            onPress={() => router.push('/auth/login')}
          >
            <Text style={[styles.linkText, { color: C.textSecondary }]}> 
              Already have an account? <Text style={{ color: C.primary, fontWeight: 'bold' }}>Sign in</Text>
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Success Overlay */}
      {showSuccessOverlay && (
        <View style={[styles.overlayContainer, { backgroundColor: 'rgba(0,0,0,0.96)' }]}> 
          <View style={[styles.successOverlay, { backgroundColor: C.card }]}> 
            <View style={styles.successIconContainer}>
              <Ionicons name="checkmark-circle" size={80} color="#22c55e" />
            </View>
            <Text style={[styles.successTitle, { color: '#22c55e' }]}>Registration Successful!</Text>
            <Text style={[styles.successMessage, { color: C.textSecondary }]}>Your account has been created successfully. You can now sign in to start using Talynk.</Text>
            <TouchableOpacity
              style={styles.goToLoginButton}
              onPress={() => {
                setShowSuccessOverlay(false);
                router.push('/auth/login');
              }}
              activeOpacity={0.8}
            >
              <Text style={styles.goToLoginButtonText}>Go to Login</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Country Picker Modal */}
      <Modal
        transparent
        visible={countryModalOpen}
        animationType="fade"
        onRequestClose={() => setCountryModalOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: C.card, borderColor: C.border }]}>
            <Text style={[styles.modalTitle, { color: C.text }]}>Select Country</Text>
            <FlatList
              data={countries as any}
              keyExtractor={(item) => String(item.id)}
              ItemSeparatorComponent={() => <View style={[styles.separator, { backgroundColor: C.border }]} />}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.countryRow}
                  onPress={() => { setSelectedCountry(item as any); setCountryModalOpen(false); }}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.countryName, { color: C.text }]}>{item.name}</Text>
                  <Text style={[styles.countryDial, { color: C.textSecondary }]}>{(item as any).dialCode || ''}</Text>
                </TouchableOpacity>
              )}
            />
            <TouchableOpacity onPress={() => setCountryModalOpen(false)} style={[styles.navButton, { borderColor: C.border, marginTop: 12 }]}>
              <Text style={{ color: C.text }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
  scrollContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 20,
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
  helperText: {
    fontSize: 12,
    marginTop: -8,
    marginBottom: 12,
  },
  phoneContainer: {
    marginBottom: 12,
  },
  phoneRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  phoneInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dialBox: {
    paddingHorizontal: 12,
    height: 50,
    borderWidth: 1,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  phoneInputFlex: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    padding: 15,
    fontSize: 16,
  },
  phoneInputs: {
    flexDirection: 'row',
    gap: 8,
  },
  phoneInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    padding: 15,
    fontSize: 16,
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
  termsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  termsText: {
    fontSize: 14,
    flex: 1,
  },
  termsLink: {
    textDecorationLine: 'underline',
  },
  button: {
    borderRadius: 8,
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
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    maxHeight: '70%',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
  },
  countryRow: {
    paddingVertical: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  countryName: {
    fontSize: 16,
  },
  countryDial: {
    fontSize: 14,
  },
  separator: {
    height: 1,
    opacity: 0.6,
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
  overlayContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  successOverlay: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 32,
    margin: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 10,
    },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 10,
  },
  successIconContainer: {
    marginBottom: 20,
  },
  successTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#22c55e',
    marginBottom: 12,
    textAlign: 'center',
  },
  successMessage: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  goToLoginButton: {
    backgroundColor: '#22c55e',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 32,
    minWidth: 200,
    alignItems: 'center',
  },
  goToLoginButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
}); 