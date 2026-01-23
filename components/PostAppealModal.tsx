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
  const { user } = useAuth();
  const insets = useSafeAreaInsets();

  const handleSubmit = async () => {
    if (!appealReason.trim()) {
      Alert.alert('Required', 'Please provide a reason for your appeal.');
      return;
    }

    if (!user) {
      Alert.alert(
        'Authentication Required',
        'Please login or sign up to appeal posts.',
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
      const response = await reportsApi.appealPost(
        postId,
        appealReason.trim(),
        additionalInfo.trim() || undefined
      );
      
      if (response.status === 'success') {
        Alert.alert(
          'Appeal Submitted',
          'Your appeal has been submitted. An admin will review it and you will be notified of the decision.',
          [{ text: 'OK', onPress: () => {
            setAppealReason('');
            setAdditionalInfo('');
            if (onAppealed) {
              onAppealed();
            }
            onClose();
          }}]
        );
      } else {
        Alert.alert('Error', response.message || 'Failed to submit appeal. Please try again.');
      }
    } catch (error: any) {
      Alert.alert('Error', 'An error occurred while submitting your appeal. Please try again.');
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
            <Text style={styles.headerTitle}>Appeal Suspension</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <MaterialIcons name="close" size={24} color="#fff" />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
            <View style={styles.infoBox}>
              <MaterialIcons name="info-outline" size={20} color="#60a5fa" />
              <Text style={styles.infoText}>
                Your post was suspended due to multiple reports. If you believe this was a mistake, you can appeal the decision.
              </Text>
            </View>

            {/* Appeal Reason */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Why should this post be restored? *</Text>
              <TextInput
                style={styles.reasonInput}
                placeholder="Explain why you believe this post was incorrectly flagged..."
                placeholderTextColor="#666"
                value={appealReason}
                onChangeText={setAppealReason}
                multiline
                numberOfLines={5}
                textAlignVertical="top"
                maxLength={1000}
              />
              <Text style={styles.charCount}>{appealReason.length}/1000</Text>
            </View>

            {/* Additional Info */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Additional Information (Optional)</Text>
              <TextInput
                style={styles.additionalInput}
                placeholder="Any other relevant information..."
                placeholderTextColor="#666"
                value={additionalInfo}
                onChangeText={setAdditionalInfo}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
                maxLength={500}
              />
              <Text style={styles.charCount}>{additionalInfo.length}/500</Text>
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
                <ActivityIndicator color="#000" />
              ) : (
                <Text style={styles.submitButtonText}>Submit Appeal</Text>
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
  infoBox: {
    flexDirection: 'row',
    backgroundColor: 'rgba(96, 165, 250, 0.1)',
    borderRadius: 12,
    padding: 16,
    marginTop: 16,
    marginBottom: 24,
    gap: 12,
    borderWidth: 1,
    borderColor: 'rgba(96, 165, 250, 0.2)',
  },
  infoText: {
    flex: 1,
    color: '#60a5fa',
    fontSize: 14,
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
  reasonInput: {
    backgroundColor: '#232326',
    borderRadius: 12,
    padding: 16,
    color: '#fff',
    fontSize: 15,
    minHeight: 120,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  additionalInput: {
    backgroundColor: '#232326',
    borderRadius: 12,
    padding: 16,
    color: '#fff',
    fontSize: 15,
    minHeight: 80,
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


