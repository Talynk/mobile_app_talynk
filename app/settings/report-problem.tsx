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
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supportApi } from '@/lib/api';
import { APP_VERSION } from '@/lib/config';

const THEME = {
  bg: '#000000',
  card: '#111114',
  cardBorder: '#1e1e24',
  accent: '#60a5fa',
  accentDim: 'rgba(96, 165, 250, 0.12)',
  text: '#f3f4f6',
  textSecondary: '#71717a',
  success: '#10b981',
  successDim: 'rgba(16, 185, 129, 0.12)',
  inputBg: '#18181b',
  inputBorder: '#27272a',
  danger: '#ef4444',
};

const CATEGORIES = [
  { key: 'BUG' as const, label: 'Bug Report', icon: 'alert-circle', description: 'Something isn\'t working' },
  { key: 'PAYMENT' as const, label: 'Payment Issue', icon: 'credit-card', description: 'Billing or payment related' },
  { key: 'GENERAL' as const, label: 'General', icon: 'message-circle', description: 'Other questions or feedback' },
];

export default function ReportProblemScreen() {
  const insets = useSafeAreaInsets();
  const [category, setCategory] = useState<'BUG' | 'PAYMENT' | 'GENERAL'>('GENERAL');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);

    if (!subject.trim()) {
      setError('Please enter a subject');
      return;
    }
    if (!message.trim()) {
      setError('Please describe your problem');
      return;
    }
    if (message.trim().length < 10) {
      setError('Please provide more detail (at least 10 characters)');
      return;
    }

    setLoading(true);
    try {
      const metadata = {
        appVersion: APP_VERSION,
        platform: Platform.OS,
        osVersion: Platform.Version,
      };

      const response = await supportApi.submitIssue(
        subject.trim(),
        message.trim(),
        category,
        metadata
      );

      if (response.status === 'success') {
        setSuccess(true);
      } else {
        setError(response.message || 'Failed to submit. Please try again.');
      }
    } catch (err: any) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton} hitSlop={12}>
            <Feather name="arrow-left" size={24} color={THEME.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Report a Problem</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.successWrap}>
          <View style={styles.successIcon}>
            <Feather name="check-circle" size={48} color={THEME.success} />
          </View>
          <Text style={styles.successTitle}>Report Submitted!</Text>
          <Text style={styles.successSubtitle}>
            Thank you for reaching out. Our support team will review your report and get back to you as soon as possible.
          </Text>
          <TouchableOpacity
            style={styles.successButton}
            onPress={() => router.back()}
            activeOpacity={0.8}
          >
            <Text style={styles.successButtonText}>Back to Settings</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} hitSlop={12}>
          <Feather name="arrow-left" size={24} color={THEME.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Report a Problem</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Hero */}
          <View style={styles.hero}>
            <View style={styles.heroIcon}>
              <Feather name="alert-triangle" size={32} color={THEME.accent} />
            </View>
            <Text style={styles.heroTitle}>Report a Problem</Text>
            <Text style={styles.heroSubtitle}>
              Describe the issue you're experiencing and we'll look into it.
            </Text>
          </View>

          {error && (
            <View style={styles.errorBanner}>
              <Feather name="alert-circle" size={16} color={THEME.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {/* Category Selection */}
          <Text style={styles.fieldLabel}>Category</Text>
          <View style={styles.categoryRow}>
            {CATEGORIES.map((cat) => (
              <TouchableOpacity
                key={cat.key}
                style={[
                  styles.categoryChip,
                  category === cat.key && styles.categoryChipActive,
                ]}
                onPress={() => setCategory(cat.key)}
                activeOpacity={0.8}
              >
                <Feather
                  name={cat.icon as any}
                  size={16}
                  color={category === cat.key ? THEME.accent : THEME.textSecondary}
                />
                <Text
                  style={[
                    styles.categoryChipText,
                    category === cat.key && styles.categoryChipTextActive,
                  ]}
                >
                  {cat.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Subject */}
          <Text style={styles.fieldLabel}>Subject</Text>
          <View style={styles.inputWrapper}>
            <TextInput
              style={styles.input}
              placeholder="Brief description of the issue"
              placeholderTextColor={THEME.textSecondary}
              value={subject}
              onChangeText={setSubject}
              maxLength={100}
            />
          </View>

          {/* Message */}
          <Text style={styles.fieldLabel}>Description</Text>
          <View style={[styles.inputWrapper, styles.textAreaWrapper]}>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Please describe the problem in detail. Include steps to reproduce if possible."
              placeholderTextColor={THEME.textSecondary}
              value={message}
              onChangeText={setMessage}
              multiline
              numberOfLines={6}
              textAlignVertical="top"
              maxLength={2000}
            />
          </View>
          <Text style={styles.charCount}>{message.length}/2000</Text>

          {/* Submit */}
          <TouchableOpacity
            style={[styles.submitButton, loading && styles.buttonDisabled]}
            onPress={handleSubmit}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Feather name="send" size={18} color="#fff" />
                <Text style={styles.submitButtonText}>Submit Report</Text>
              </>
            )}
          </TouchableOpacity>
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
  // Hero
  hero: { alignItems: 'center', marginBottom: 28 },
  heroIcon: {
    width: 68, height: 68, borderRadius: 34,
    backgroundColor: THEME.accentDim, alignItems: 'center', justifyContent: 'center',
    marginBottom: 14,
  },
  heroTitle: { color: THEME.text, fontSize: 22, fontWeight: '700', marginBottom: 6 },
  heroSubtitle: { color: THEME.textSecondary, fontSize: 14, lineHeight: 20, textAlign: 'center', maxWidth: 300 },
  // Error
  errorBanner: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.1)', borderRadius: 10,
    padding: 12, marginBottom: 20,
    borderWidth: 1, borderColor: 'rgba(239, 68, 68, 0.2)',
  },
  errorText: { color: THEME.danger, fontSize: 13, marginLeft: 8, flex: 1 },
  // Fields
  fieldLabel: { color: THEME.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: 8, marginLeft: 4 },
  categoryRow: { flexDirection: 'row', gap: 8, marginBottom: 20, flexWrap: 'wrap' },
  categoryChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: THEME.card, borderRadius: 10, borderWidth: 1,
    borderColor: THEME.cardBorder, paddingHorizontal: 14, paddingVertical: 10,
  },
  categoryChipActive: { borderColor: THEME.accent, backgroundColor: THEME.accentDim },
  categoryChipText: { color: THEME.textSecondary, fontSize: 13, fontWeight: '600' },
  categoryChipTextActive: { color: THEME.accent },
  inputWrapper: {
    backgroundColor: THEME.inputBg, borderRadius: 12, borderWidth: 1,
    borderColor: THEME.inputBorder, paddingHorizontal: 14, height: 50,
    justifyContent: 'center', marginBottom: 18,
  },
  textAreaWrapper: { height: 160, paddingVertical: 14 },
  input: { color: THEME.text, fontSize: 15 },
  textArea: { flex: 1 },
  charCount: { color: THEME.textSecondary, fontSize: 11, textAlign: 'right', marginTop: -12, marginBottom: 12 },
  // Submit
  submitButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: THEME.accent, borderRadius: 12, height: 50,
    marginTop: 4, gap: 8,
  },
  buttonDisabled: { opacity: 0.6 },
  submitButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  // Success
  successWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  successIcon: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: THEME.successDim, alignItems: 'center', justifyContent: 'center',
    marginBottom: 20,
  },
  successTitle: { color: THEME.text, fontSize: 24, fontWeight: '700', marginBottom: 10 },
  successSubtitle: { color: THEME.textSecondary, fontSize: 14, lineHeight: 20, textAlign: 'center', marginBottom: 28, maxWidth: 280 },
  successButton: {
    backgroundColor: THEME.accent, borderRadius: 12, height: 50,
    paddingHorizontal: 32, alignItems: 'center', justifyContent: 'center',
  },
  successButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
