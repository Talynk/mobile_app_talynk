import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Animated,
} from 'react-native';
import { MaterialIcons, Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { reportsApi } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface PostAppealModalProps {
  visible: boolean;
  postId: string;
  onClose: () => void;
  onAppealed?: () => void;
}

export const PostAppealModal: React.FC<PostAppealModalProps> = ({
  visible,
  postId,
  onClose,
  onAppealed,
}) => {
  const [appealReason, setAppealReason] = useState('');
  const [additionalInfo, setAdditionalInfo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const slideAnim = useRef(new Animated.Value(0)).current;
  const toastOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setSubmitStatus('idle');
      setErrorMessage('');
      Animated.spring(slideAnim, {
        toValue: 1,
        useNativeDriver: true,
        tension: 65,
        friction: 11,
      }).start();
    } else {
      // Reset state when closing
      setTimeout(() => {
        setAppealReason('');
        setAdditionalInfo('');
        setSubmitStatus('idle');
        setIsSuccess(false);
        slideAnim.setValue(0);
      }, 300);
    }
  }, [visible, slideAnim]);

  const showToast = (status: 'success' | 'error', message: string) => {
    setSubmitStatus(status);
    setErrorMessage(message);
    Animated.sequence([
      Animated.timing(toastOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.delay(2500),
      Animated.timing(toastOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start(() => {
      // Only reset submitStatus if it was an error toast, success is handled by isSuccess state
      if (status === 'error') {
        setSubmitStatus('idle');
      }
    });
  };

  const handleSubmit = async () => {
    if (!appealReason.trim()) {
      showToast('error', 'Please provide a reason for your appeal.');
      return;
    }

    if (!user) {
      router.push('/auth/login' as any);
      return;
    }

    setSubmitting(true);
    try {
      const response = await reportsApi.appealPost(
        postId,
        appealReason.trim(),
        additionalInfo.trim() || undefined
      );

      if (response.status === 'success') {
        setIsSuccess(true);
        if (onAppealed) {
          onAppealed();
        }
      } else {
        showToast('error', response.message || 'Failed to submit appeal. Please try again.');
      }
    } catch (error: any) {
      showToast('error', 'An error occurred. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const containerTranslateY = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [300, 0],
  });

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent={true}
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <Animated.View
          style={[
            styles.container,
            { paddingBottom: insets.bottom + 20, transform: [{ translateY: containerTranslateY }] },
          ]}
        >
          {/* Drag Handle */}
          <View style={styles.dragHandle} />

          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View style={[styles.headerIconBg, isSuccess && { backgroundColor: 'rgba(16, 185, 129, 0.15)' }]}>
                <MaterialIcons name={isSuccess ? "check-circle" : "gavel"} size={20} color={isSuccess ? "#10b981" : "#f59e0b"} />
              </View>
              <Text style={styles.headerTitle}>{isSuccess ? "Appeal Submitted" : "Appeal Post"}</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeButton} activeOpacity={0.7}>
              <MaterialIcons name="close" size={22} color="#999" />
            </TouchableOpacity>
          </View>

          {isSuccess ? (
            <View style={styles.successContainer}>
              <View style={styles.successIconWrapper}>
                <Feather name="check" size={40} color="#10b981" />
              </View>
              <Text style={styles.successTitle}>Appeal Sent for Review</Text>
              <Text style={styles.successDescription}>
                Your appeal has been successfully submitted to our moderation team. You can track its status in your Settings.
              </Text>
              
              <TouchableOpacity
                style={styles.goToSettingsButton}
                onPress={() => {
                  onClose();
                  setTimeout(() => {
                    return router.push('/settings/appeals' as any);
                  }, 300);
                }}
                activeOpacity={0.8}
              >
                <Feather name="settings" size={18} color="#fff" style={{ marginRight: 8 }} />
                <Text style={styles.goToSettingsButtonText}>Track Appeal in Settings</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={styles.successCloseButton}
                onPress={onClose}
                activeOpacity={0.8}
              >
                <Text style={styles.successCloseButtonText}>Done</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <ScrollView style={styles.content} contentContainerStyle={{ paddingBottom: 20 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {/* Info Banner */}
            <View style={styles.infoBanner}>
              <View style={styles.infoBannerIcon}>
                <MaterialIcons name="info-outline" size={18} color="#60a5fa" />
              </View>
              <Text style={styles.infoBannerText}>
                Your post was suspended due to reports. Submit one appeal per post — an admin will review and notify you.
              </Text>
            </View>

            {/* Appeal Reason */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>
                Why should this post be restored? <Text style={styles.required}>*</Text>
              </Text>
              <View style={styles.inputWrapper}>
                <TextInput
                  style={styles.reasonInput}
                  placeholder="Explain why you believe this post was incorrectly flagged..."
                  placeholderTextColor="#555"
                  value={appealReason}
                  onChangeText={setAppealReason}
                  multiline
                  numberOfLines={5}
                  textAlignVertical="top"
                  maxLength={1000}
                />
              </View>
              <Text style={styles.charCount}>
                {appealReason.length}<Text style={styles.charCountMax}>/1000</Text>
              </Text>
            </View>

            {/* Additional Info */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Additional Context</Text>
              <View style={styles.inputWrapper}>
                <TextInput
                  style={styles.additionalInput}
                  placeholder="Any other relevant details…"
                  placeholderTextColor="#555"
                  value={additionalInfo}
                  onChangeText={setAdditionalInfo}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                  maxLength={500}
                />
              </View>
              <Text style={styles.charCount}>
                {additionalInfo.length}<Text style={styles.charCountMax}>/500</Text>
              </Text>
            </View>
              </ScrollView>

              {/* Submit Button */}
              <View style={styles.footer}>
                <TouchableOpacity
                  style={[
                    styles.submitButton,
                    (!appealReason.trim() || submitting) && styles.submitButtonDisabled,
                  ]}
                  onPress={handleSubmit}
                  disabled={!appealReason.trim() || submitting}
                  activeOpacity={0.8}
                >
                  {submitting ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <>
                      <MaterialIcons name="send" size={18} color="#fff" style={{ marginRight: 8 }} />
                      <Text style={styles.submitButtonText}>Submit Appeal</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </>
          )}

          {/* Inline Toast */}
          {submitStatus !== 'idle' && (
            <Animated.View
              style={[
                styles.toast,
                submitStatus === 'success' ? styles.toastSuccess : styles.toastError,
                { opacity: toastOpacity },
              ]}
            >
              <MaterialIcons
                name={submitStatus === 'success' ? 'check-circle' : 'error'}
                size={18}
                color={submitStatus === 'success' ? '#10b981' : '#ef4444'}
              />
              <Text style={[
                styles.toastText,
                submitStatus === 'success' ? styles.toastTextSuccess : styles.toastTextError,
              ]}>
                {submitStatus === 'success' ? 'Appeal submitted!' : errorMessage}
              </Text>
            </Animated.View>
          )}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'flex-end',
  },
  container: {
    backgroundColor: '#111114',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: '92%',
    minHeight: '55%',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderBottomWidth: 0,
  },
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerIconBg: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 19,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
  },
  infoBanner: {
    flexDirection: 'row',
    backgroundColor: 'rgba(96, 165, 250, 0.08)',
    borderRadius: 14,
    padding: 14,
    marginTop: 16,
    marginBottom: 24,
    gap: 10,
    borderWidth: 1,
    borderColor: 'rgba(96, 165, 250, 0.15)',
    alignItems: 'flex-start',
  },
  infoBannerIcon: {
    marginTop: 1,
  },
  infoBannerText: {
    flex: 1,
    color: 'rgba(96, 165, 250, 0.9)',
    fontSize: 13,
    lineHeight: 19,
  },
  section: {
    marginBottom: 20,
  },
  sectionLabel: {
    color: '#ccc',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 10,
  },
  required: {
    color: '#ef4444',
  },
  inputWrapper: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  reasonInput: {
    backgroundColor: '#1a1a1e',
    padding: 16,
    color: '#fff',
    fontSize: 15,
    minHeight: 120,
    lineHeight: 22,
  },
  additionalInput: {
    backgroundColor: '#1a1a1e',
    padding: 16,
    color: '#fff',
    fontSize: 15,
    minHeight: 80,
    lineHeight: 22,
  },
  charCount: {
    color: '#60a5fa',
    fontSize: 12,
    marginTop: 6,
    textAlign: 'right',
    fontWeight: '500',
  },
  charCountMax: {
    color: '#555',
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
  },
  submitButton: {
    flexDirection: 'row',
    backgroundColor: '#f59e0b',
    paddingVertical: 15,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitButtonDisabled: {
    opacity: 0.4,
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  toast: {
    position: 'absolute',
    top: 70,
    left: 20,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    gap: 10,
  },
  toastSuccess: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  toastError: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  toastText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
  },
  toastTextSuccess: {
    color: '#10b981',
  },
  toastTextError: {
    color: '#ef4444',
  },
  successContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 40,
  },
  successIconWrapper: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.2)',
  },
  successTitle: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 12,
    textAlign: 'center',
  },
  successDescription: {
    color: '#aaa',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 32,
    paddingHorizontal: 10,
  },
  goToSettingsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#3b82f6',
    width: '100%',
    paddingVertical: 16,
    borderRadius: 14,
    marginBottom: 16,
  },
  goToSettingsButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  successCloseButton: {
    width: '100%',
    paddingVertical: 16,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
  },
  successCloseButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
