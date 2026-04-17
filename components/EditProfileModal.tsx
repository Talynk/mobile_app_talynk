import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { userApi } from '../lib/api';
import * as ImagePicker from 'expo-image-picker';

interface User {
  id: string;
  username: string;
  email: string;
  phone1?: string;
  phone2?: string;
  fullName?: string;
  bio?: string;
  date_of_birth?: string;
  profile_picture?: string;
}

interface EditProfileModalProps {
  isVisible: boolean;
  onClose: () => void;
  user: User | null;
  onProfileUpdated: (updatedUser: User) => void;
}

const BIO_MAX_LENGTH = 150;

function formatBirthday(raw?: string): string {
  if (!raw) return '';
  try {
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return raw;
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return raw;
  }
}

export const EditProfileModal: React.FC<EditProfileModalProps> = ({
  isVisible,
  onClose,
  user,
  onProfileUpdated,
}) => {
  const [bio, setBio] = useState('');
  const [phone1, setPhone1] = useState('');
  const [phone2, setPhone2] = useState('');
  const [phone1Editing, setPhone1Editing] = useState(false);
  const [phone2Editing, setPhone2Editing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [profileImage, setProfileImage] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);

  useEffect(() => {
    if (user && isVisible) {
      setBio(user.bio ?? '');
      setPhone1(user.phone1 || '');
      setPhone2(user.phone2 || '');
      setPhone1Editing(false);
      setPhone2Editing(false);
      setProfileImage(null);
    }
  }, [user, isVisible]);

  const handleSave = async () => {
    setLoading(true);
    try {
      const updateData: any = {};

      // Always send bio — even if empty, so it clears on the backend
      updateData.bio = bio.trim().slice(0, BIO_MAX_LENGTH);

      const trimmedPhone1 = phone1.trim();
      const trimmedPhone2 = phone2.trim();

      if (trimmedPhone1 !== (user?.phone1 || '')) {
        updateData.phone1 = trimmedPhone1;
      }
      if (trimmedPhone2 !== (user?.phone2 || '')) {
        updateData.phone2 = trimmedPhone2;
      }

      const response = await userApi.updateProfile(updateData, profileImage || undefined);

      if (response.status === 'success') {
        const respData = response.data as any;
        Alert.alert('Success', 'Profile updated successfully!');
        onProfileUpdated({
          ...user!,
          bio: respData?.bio ?? updateData.bio,
          phone1: respData?.phone1 ?? trimmedPhone1 ?? user?.phone1,
          phone2: respData?.phone2 ?? trimmedPhone2 ?? user?.phone2,
          ...(respData?.profile_picture && { profile_picture: respData.profile_picture }),
        });
        onClose();
      } else {
        Alert.alert('Error', response.message || 'Failed to update profile');
      }
    } catch (error: any) {
      if (error.code === 'NETWORK_ERROR' || error.message === 'Network Error') {
        Alert.alert('Network Error', 'Please check your internet connection and try again.');
      } else {
        Alert.alert('Error', error.response?.data?.message || 'Failed to update profile');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    if (loading) return;
    onClose();
  };

  const pickImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        setProfileImage(result.assets[0].uri);
      }
    } catch {
      Alert.alert('Error', 'Failed to pick image');
    }
  };

  if (!user) return null;

  const formattedDob = formatBirthday(user.date_of_birth);

  return (
    <Modal
      visible={isVisible}
      animationType="slide"
      transparent={true}
      onRequestClose={handleCancel}
    >
      <View style={styles.overlay}>
        <KeyboardAvoidingView
          style={styles.container}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.header}>
            <TouchableOpacity onPress={handleCancel} disabled={loading}>
              <Text style={styles.cancelButton}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.title}>Your Profile</Text>
            <TouchableOpacity onPress={handleSave} disabled={loading}>
              {loading ? (
                <ActivityIndicator size="small" color="#60a5fa" />
              ) : (
                <Text style={styles.saveButton}>Save</Text>
              )}
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.content}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 40 }}
          >
            {/* Profile Picture */}
            <View style={styles.profilePictureSection}>
              <View style={styles.profilePictureContainer}>
                <Image
                  source={{
                    uri: profileImage || user?.profile_picture || 'https://via.placeholder.com/100',
                  }}
                  style={styles.profilePicture}
                />
                {uploadingImage && (
                  <View style={styles.uploadingOverlay}>
                    <ActivityIndicator size="small" color="#fff" />
                  </View>
                )}
              </View>
              <TouchableOpacity style={styles.changePhotoButton} onPress={pickImage}>
                <Text style={styles.changePhotoText}>Change Photo</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.formSection}>
              {/* Email — read-only */}
              <View style={styles.inputGroup}>
                <View style={styles.labelRow}>
                  <Feather name="mail" size={15} color="#9ca3af" style={{ marginRight: 6 }} />
                  <Text style={styles.label}>Email</Text>
                  <View style={styles.readOnlyBadge}>
                    <Feather name="lock" size={10} color="#6b7280" />
                  </View>
                </View>
                <View style={styles.readOnlyField}>
                  <Text style={styles.readOnlyText} numberOfLines={1}>{user.email || 'No email set'}</Text>
                </View>
              </View>

              {/* Birthday — read-only */}
              <View style={styles.inputGroup}>
                <View style={styles.labelRow}>
                  <Feather name="gift" size={15} color="#9ca3af" style={{ marginRight: 6 }} />
                  <Text style={styles.label}>Birthday</Text>
                  <View style={styles.readOnlyBadge}>
                    <Feather name="lock" size={10} color="#6b7280" />
                  </View>
                </View>
                <View style={styles.readOnlyField}>
                  <Text style={styles.readOnlyText}>{formattedDob || 'No birthday set'}</Text>
                </View>
              </View>

              {/* Divider */}
              <View style={styles.divider} />

              {/* Primary Phone — editable */}
              <View style={styles.inputGroup}>
                <View style={styles.labelRow}>
                  <Feather name="phone" size={15} color="#9ca3af" style={{ marginRight: 6 }} />
                  <Text style={styles.label}>Primary Phone</Text>
                </View>
                {phone1 || phone1Editing ? (
                  <TextInput
                    style={styles.input}
                    value={phone1}
                    onChangeText={setPhone1}
                    onFocus={() => setPhone1Editing(true)}
                    onBlur={() => setPhone1Editing(false)}
                    placeholder="e.g. +250780000000"
                    placeholderTextColor="#4b5563"
                    keyboardType="phone-pad"
                    autoCorrect={false}
                  />
                ) : (
                  <TouchableOpacity
                    style={styles.addPhoneButton}
                    onPress={() => setPhone1Editing(true)}
                  >
                    <Feather name="plus-circle" size={18} color="#60a5fa" />
                    <Text style={styles.addPhoneText}>No primary phone set — tap to add</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Secondary Phone — editable */}
              <View style={styles.inputGroup}>
                <View style={styles.labelRow}>
                  <Feather name="phone" size={15} color="#9ca3af" style={{ marginRight: 6 }} />
                  <Text style={styles.label}>Secondary Phone</Text>
                </View>
                {phone2 || phone2Editing ? (
                  <TextInput
                    style={styles.input}
                    value={phone2}
                    onChangeText={setPhone2}
                    onFocus={() => setPhone2Editing(true)}
                    onBlur={() => setPhone2Editing(false)}
                    placeholder="e.g. +250780000000"
                    placeholderTextColor="#4b5563"
                    keyboardType="phone-pad"
                    autoCorrect={false}
                  />
                ) : (
                  <TouchableOpacity
                    style={styles.addPhoneButton}
                    onPress={() => setPhone2Editing(true)}
                  >
                    <Feather name="plus-circle" size={18} color="#60a5fa" />
                    <Text style={styles.addPhoneText}>No secondary phone set — tap to add</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Divider */}
              <View style={styles.divider} />

              {/* Bio — editable */}
              <View style={styles.inputGroup}>
                <View style={styles.bioLabelRow}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Feather name="edit-3" size={15} color="#9ca3af" style={{ marginRight: 6 }} />
                    <Text style={styles.label}>Bio</Text>
                  </View>
                  <Text style={styles.charCount}>{bio.length}/{BIO_MAX_LENGTH}</Text>
                </View>
                <TextInput
                  style={[styles.input, styles.bioInput]}
                  value={bio}
                  onChangeText={(value) => setBio(value.slice(0, BIO_MAX_LENGTH))}
                  placeholder="Tell others a bit about yourself..."
                  placeholderTextColor="#4b5563"
                  multiline
                  maxLength={BIO_MAX_LENGTH}
                />
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
  },
  container: {
    flex: 1,
    backgroundColor: '#18181b',
    marginTop: 50,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#27272a',
  },
  cancelButton: {
    color: '#a1a1aa',
    fontSize: 16,
  },
  title: {
    color: '#f3f4f6',
    fontSize: 18,
    fontWeight: '600',
  },
  saveButton: {
    color: '#60a5fa',
    fontSize: 16,
    fontWeight: '600',
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
  },
  profilePictureSection: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  profilePictureContainer: {
    position: 'relative',
    marginBottom: 12,
  },
  profilePicture: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#232326',
  },
  uploadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 50,
    justifyContent: 'center',
    alignItems: 'center',
  },
  changePhotoButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  changePhotoText: {
    color: '#60a5fa',
    fontSize: 16,
    fontWeight: '500',
  },
  formSection: {
    paddingBottom: 30,
  },
  inputGroup: {
    marginBottom: 18,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  label: {
    color: '#f3f4f6',
    fontSize: 15,
    fontWeight: '500',
  },
  readOnlyBadge: {
    marginLeft: 8,
    backgroundColor: '#27272a',
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  readOnlyField: {
    backgroundColor: '#1f1f23',
    borderWidth: 1,
    borderColor: '#27272a',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  readOnlyText: {
    color: '#9ca3af',
    fontSize: 15,
  },
  input: {
    backgroundColor: '#232326',
    borderWidth: 1,
    borderColor: '#3f3f46',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: '#f3f4f6',
    fontSize: 15,
  },
  bioInput: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  bioLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  charCount: {
    color: '#6b7280',
    fontSize: 13,
  },
  divider: {
    height: 1,
    backgroundColor: '#27272a',
    marginVertical: 10,
  },
  addPhoneButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1f1f23',
    borderWidth: 1,
    borderColor: '#27272a',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderStyle: 'dashed',
  },
  addPhoneText: {
    color: '#60a5fa',
    fontSize: 14,
    marginLeft: 10,
  },
});
