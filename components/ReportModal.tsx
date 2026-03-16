import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ScrollView,
  ActivityIndicator,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { reportsApi } from '../lib/api';
import { useAuth } from '../lib/auth-context';

// Report reasons matching backend enum
const REPORT_REASONS = [
  { id: 'SPAM', label: 'Spam', description: 'Repetitive or unwanted content' },
  { id: 'HARASSMENT', label: 'Harassment', description: 'Bullying or harassment' },
  { id: 'INAPPROPRIATE_CONTENT', label: 'Inappropriate Content', description: 'Content that violates community guidelines' },
  { id: 'COPYRIGHT_VIOLATION', label: 'Copyright Violation', description: 'Unauthorized use of copyrighted material' },
  { id: 'FALSE_INFORMATION', label: 'False Information', description: 'Misleading or false information' },
  { id: 'VIOLENCE', label: 'Violence', description: 'Violent or graphic content' },
  { id: 'HATE_SPEECH', label: 'Hate Speech', description: 'Hateful or discriminatory content' },
  { id: 'OTHER', label: 'Other', description: 'Something else (please describe)' },
];

interface ReportModalProps {
  isVisible: boolean;
  onClose: () => void;
  postId: string | null;
  onReported: () => void;
}

export default function ReportModal({ isVisible, onClose, postId, onReported }: ReportModalProps) {
  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const [description, setDescription] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [alreadyReported, setAlreadyReported] = useState(false);
  const [checkingReport, setCheckingReport] = useState(false);
  const { user } = useAuth();

  // Check if user has already reported this post when modal opens
  useEffect(() => {
    const checkIfAlreadyReported = async () => {
      if (!isVisible || !postId || !user) {
        setAlreadyReported(false);
        return;
      }
      
      setCheckingReport(true);
      try {
        const response = await reportsApi.getPostReports(postId);
        if (response.status === 'success' && response.data?.reports) {
          // Check if current user has reported this post
          const userReports = response.data.reports.filter(
            (report: any) => report.reporter?.id === user?.id || report.user_id === user?.id
          );
          setAlreadyReported(userReports.length > 0);
        }
      } catch (error) {
        console.error('Error checking reports:', error);
        // Don't set alreadyReported on error, let them try to report
      } finally {
        setCheckingReport(false);
      }
    };

    checkIfAlreadyReported();
  }, [isVisible, postId, user]);

  const handleSubmit = async () => {
    if (!selectedReason || !postId) return;
    
    // For "OTHER" reason, require description
    if (selectedReason === 'OTHER' && !description.trim()) {
      Alert.alert('Description Required', 'Please provide a description for your report.');
      return;
    }
    
    setSubmitting(true);
    try {
      // Use the selected reason directly (all enum values are valid)
      const apiReason = selectedReason;
      
      // Build description: use user's description or default message
      const reportDescription = description.trim() || 
        (selectedReason === 'OTHER' ? 'User reported as "other"' : `Reported for: ${selectedReason}`);
      
      const response = await reportsApi.reportPost(
        postId,
        apiReason,
        reportDescription
      );
      
      if (response.status === 'success') {
        onReported();
        setSelectedReason(null);
        setDescription('');
      } else {
        // Handle specific error cases
        const errorMessage = response.message || 'Failed to submit report. Please try again.';
        const isAlreadyReported = response.data?.alreadyReported || 
          errorMessage.toLowerCase().includes('already reported');
        
        if (isAlreadyReported) {
          Alert.alert(
            'Already Reported',
            'You have already reported this post. Our team will review it shortly.',
            [
              {
                text: 'OK',
                onPress: () => {
                  setSelectedReason(null);
                  setDescription('');
                  onClose();
                }
              }
            ]
          );
        } else {
          Alert.alert('Error', errorMessage);
        }
      }
    } catch (error: any) {
      console.error('Error reporting post:', error);
      Alert.alert('Error', 'Failed to submit report. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    if (submitting) return;
    setSelectedReason(null);
    setDescription('');
    setAlreadyReported(false);
    onClose();
  };

  return (
    <Modal
      visible={isVisible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={handleClose} disabled={submitting}>
              <MaterialIcons name="close" size={24} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.title}>Report Post</Text>
            <View style={{ width: 24 }} />
          </View>

          {/* Content */}
          <ScrollView style={styles.content}>
            {checkingReport ? (
              <View style={styles.checkingContainer}>
                <ActivityIndicator size="small" color="#60a5fa" />
                <Text style={styles.checkingText}>Checking...</Text>
              </View>
            ) : alreadyReported ? (
              <View style={styles.alreadyReportedContainer}>
                <MaterialIcons name="info" size={48} color="#60a5fa" style={styles.infoIcon} />
                <Text style={styles.alreadyReportedTitle}>Already Reported</Text>
                <Text style={styles.alreadyReportedText}>
                  You have already reported this post. Our team will review it shortly.
                </Text>
                <TouchableOpacity
                  style={styles.closeButton}
                  onPress={handleClose}
                >
                  <Text style={styles.closeButtonText}>Close</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <Text style={styles.subtitle}>
                  Why are you reporting this post?
                </Text>

            {REPORT_REASONS.map((reason) => (
              <TouchableOpacity
                key={reason.id}
                style={[
                  styles.reasonItem,
                  selectedReason === reason.id && styles.reasonItemSelected
                ]}
                onPress={() => setSelectedReason(reason.id)}
              >
                <View style={styles.reasonContent}>
                  <Text style={styles.reasonLabel}>{reason.label}</Text>
                  <Text style={styles.reasonDescription}>{reason.description}</Text>
                </View>
                <View style={[
                  styles.radioButton,
                  selectedReason === reason.id && styles.radioButtonSelected
                ]}>
                  {selectedReason === reason.id && (
                    <View style={styles.radioButtonInner} />
                  )}
                </View>
              </TouchableOpacity>
            ))}

            {/* Description input for "OTHER" reason or optional additional details */}
            {selectedReason && (
              <View style={styles.descriptionContainer}>
                <Text style={styles.descriptionLabel}>
                  {selectedReason === 'OTHER' ? 'Please describe the issue (required)' : 'Additional details (optional)'}
                </Text>
                <TextInput
                  style={styles.descriptionInput}
                  placeholder="Provide more information about your report..."
                  placeholderTextColor="#71717a"
                  value={description}
                  onChangeText={setDescription}
                  multiline
                  numberOfLines={4}
                  textAlignVertical="top"
                  editable={!submitting}
                />
              </View>
            )}
              </>
            )}
          </ScrollView>

          {/* Footer */}
          {!alreadyReported && !checkingReport && (
            <View style={styles.footer}>
              <TouchableOpacity
                style={[
                  styles.submitButton,
                  (!selectedReason || submitting || (selectedReason === 'OTHER' && !description.trim())) && styles.submitButtonDisabled
                ]}
                onPress={handleSubmit}
                disabled={!selectedReason || submitting || (selectedReason === 'OTHER' && !description.trim())}
              >
                {submitting ? (
                  <ActivityIndicator color="#000" />
                ) : (
                  <Text style={styles.submitButtonText}>Submit Report</Text>
                )}
              </TouchableOpacity>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'flex-end',
  },
  container: {
    backgroundColor: '#18181b',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#27272a',
  },
  title: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  content: {
    padding: 16,
  },
  subtitle: {
    color: '#a1a1aa',
    fontSize: 16,
    marginBottom: 20,
    textAlign: 'center',
  },
  reasonItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    marginBottom: 8,
    backgroundColor: '#232326',
    borderWidth: 1,
    borderColor: '#27272a',
  },
  reasonItemSelected: {
    borderColor: '#60a5fa',
    backgroundColor: 'rgba(96, 165, 250, 0.1)',
  },
  reasonContent: {
    flex: 1,
  },
  reasonLabel: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  reasonDescription: {
    color: '#a1a1aa',
    fontSize: 14,
  },
  radioButton: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#60a5fa',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioButtonSelected: {
    backgroundColor: '#60a5fa',
  },
  radioButtonInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#000',
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#27272a',
  },
  submitButton: {
    backgroundColor: '#60a5fa',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  submitButtonDisabled: {
    backgroundColor: '#374151',
  },
  submitButtonText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '600',
  },
  descriptionContainer: {
    marginTop: 16,
  },
  descriptionLabel: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  descriptionInput: {
    backgroundColor: '#232326',
    borderWidth: 1,
    borderColor: '#27272a',
    borderRadius: 12,
    padding: 12,
    color: '#fff',
    fontSize: 14,
    minHeight: 100,
    maxHeight: 150,
  },
  checkingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  checkingText: {
    color: '#a1a1aa',
    fontSize: 16,
    marginLeft: 12,
  },
  alreadyReportedContainer: {
    alignItems: 'center',
    padding: 40,
  },
  infoIcon: {
    marginBottom: 16,
  },
  alreadyReportedTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 12,
    textAlign: 'center',
  },
  alreadyReportedText: {
    color: '#a1a1aa',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 24,
  },
  closeButton: {
    backgroundColor: '#60a5fa',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 32,
    minWidth: 120,
  },
  closeButtonText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
});