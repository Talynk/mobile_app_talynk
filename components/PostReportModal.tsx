import React, { useState } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { reportsApi } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const REPORT_REASONS = [
  { value: 'spam', label: 'Spam', icon: 'report' },
  { value: 'inappropriate_content', label: 'Inappropriate Content', icon: 'block' },
  { value: 'harassment', label: 'Harassment', icon: 'warning' },
  { value: 'copyright_violation', label: 'Copyright Violation', icon: 'copyright' },
  { value: 'false_information', label: 'False Information', icon: 'info' },
  { value: 'other', label: 'Other', icon: 'more-horiz' },
];

interface PostReportModalProps {
  visible: boolean;
  postId: string;
  onClose: () => void;
  onReported?: (isFrozen: boolean) => void;
}

export const PostReportModal: React.FC<PostReportModalProps> = ({
  visible,
  postId,
  onClose,
  onReported,
}) => {
  const [selectedReason, setSelectedReason] = useState<string>('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { user } = useAuth();
  const insets = useSafeAreaInsets();

  const handleSubmit = async () => {
    if (!selectedReason) {
      Alert.alert('Required', 'Please select a reason for reporting this post.');
      return;
    }

    if (!user) {
      Alert.alert(
        'Authentication Required',
        'Please login or sign up to report posts.',
        [
          {
            text: 'Sign Up',
            onPress: () => router.push('/auth/register')
          },
          {
            text: 'Sign In',
            onPress: () => router.push('/auth/login')
          }
        ]
      );
      return;
    }

    setSubmitting(true);
    try {
      const response = await reportsApi.reportPost(postId, selectedReason, description || undefined);
      
      if (response.status === 'success') {
        const isFrozen = response.data?.isFrozen || false;
        
        if (isFrozen) {
          Alert.alert(
            'Post Suspended',
            'This post has been suspended due to multiple reports.',
            [{ text: 'OK', onPress: onClose }]
          );
        } else {
          Alert.alert(
            'Report Submitted',
            'Thank you for your report. We will review it shortly.',
            [{ text: 'OK', onPress: onClose }]
          );
        }
        
        // Reset form
        setSelectedReason('');
        setDescription('');
        
        if (onReported) {
          onReported(isFrozen);
        }
      } else {
        if (response.data?.alreadyReported) {
          Alert.alert('Already Reported', 'You have already reported this post.');
        } else {
          Alert.alert('Error', response.message || 'Failed to submit report. Please try again.');
        }
      }
    } catch (error: any) {
      Alert.alert('Error', 'An error occurred while submitting your report. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={[styles.container, { paddingBottom: insets.bottom + 20 }]}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Report Post</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <MaterialIcons name="close" size={24} color="#fff" />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
            <Text style={styles.subtitle}>
              Help us understand what's wrong with this post
            </Text>

            {/* Reason Selection */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Reason *</Text>
              {REPORT_REASONS.map((reason) => (
                <TouchableOpacity
                  key={reason.value}
                  style={[
                    styles.reasonOption,
                    selectedReason === reason.value && styles.reasonOptionSelected,
                  ]}
                  onPress={() => setSelectedReason(reason.value)}
                  activeOpacity={0.7}
                >
                  <MaterialIcons
                    name={reason.icon as any}
                    size={20}
                    color={selectedReason === reason.value ? '#60a5fa' : '#888'}
                  />
                  <Text
                    style={[
                      styles.reasonText,
                      selectedReason === reason.value && styles.reasonTextSelected,
                    ]}
                  >
                    {reason.label}
                  </Text>
                  {selectedReason === reason.value && (
                    <MaterialIcons name="check-circle" size={20} color="#60a5fa" />
                  )}
                </TouchableOpacity>
              ))}
            </View>

            {/* Description */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Additional Details (Optional)</Text>
              <TextInput
                style={styles.descriptionInput}
                placeholder="Provide more context about this report..."
                placeholderTextColor="#666"
                value={description}
                onChangeText={setDescription}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
                maxLength={500}
              />
              <Text style={styles.charCount}>{description.length}/500</Text>
            </View>
          </ScrollView>

          {/* Submit Button */}
          <View style={styles.footer}>
            <TouchableOpacity
              style={[
                styles.submitButton,
                (!selectedReason || submitting) && styles.submitButtonDisabled,
              ]}
              onPress={handleSubmit}
              disabled={!selectedReason || submitting}
              activeOpacity={0.8}
            >
              {submitting ? (
                <ActivityIndicator color="#000" />
              ) : (
                <Text style={styles.submitButtonText}>Submit Report</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
  },
  container: {
    backgroundColor: '#1a1a1a',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '90%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
  },
  closeButton: {
    padding: 4,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
  },
  subtitle: {
    color: '#888',
    fontSize: 14,
    marginTop: 16,
    marginBottom: 24,
    lineHeight: 20,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  reasonOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: '#232326',
    marginBottom: 8,
    gap: 12,
  },
  reasonOptionSelected: {
    backgroundColor: 'rgba(96, 165, 250, 0.15)',
    borderWidth: 1,
    borderColor: '#60a5fa',
  },
  reasonText: {
    flex: 1,
    color: '#ccc',
    fontSize: 15,
  },
  reasonTextSelected: {
    color: '#fff',
    fontWeight: '600',
  },
  descriptionInput: {
    backgroundColor: '#232326',
    borderRadius: 12,
    padding: 16,
    color: '#fff',
    fontSize: 15,
    minHeight: 100,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  charCount: {
    color: '#666',
    fontSize: 12,
    marginTop: 8,
    textAlign: 'right',
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
  },
  submitButton: {
    backgroundColor: '#60a5fa',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitButtonText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '700',
  },
});


