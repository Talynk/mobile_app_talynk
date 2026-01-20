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
} from 'react-native';
import { apiClient } from '../lib/api-client';
import { userApi } from '../lib/api';
import * as ImagePicker from 'expo-image-picker';

interface User {
  id: string;
  username: string;
  email: string;
  phone1: string;
  phone2?: string;
  fullName?: string;
  bio?: string;
  profile_picture?: string;
}

interface EditProfileModalProps {
  isVisible: boolean;
  onClose: () => void;
  user: User | null;
  onProfileUpdated: (updatedUser: User) => void;
}

export const EditProfileModal: React.FC<EditProfileModalProps> = ({
  isVisible,
  onClose,
  user,
  onProfileUpdated,
}) => {
  const [formData, setFormData] = useState({
    phone1: '',
    phone2: '',
    bio: '',
  });
  const [loading, setLoading] = useState(false);
  const [profileImage, setProfileImage] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);

  useEffect(() => {
    if (user && isVisible) {
      setFormData({
        phone1: user.phone1 || '',
        phone2: user.phone2 || '',
        bio: user.bio || '',
      });
    }
  }, [user, isVisible]);

  const handleSave = async () => {
    setLoading(true);
    try {
      // Prepare update data - only include fields that have values
      const updateData: any = {};
      
      if (formData.phone1.trim()) {
        updateData.phone1 = formData.phone1.trim();
      }
      
      if (formData.phone2.trim()) {
        updateData.phone2 = formData.phone2.trim();
      }

      if (formData.bio.trim()) {
        updateData.bio = formData.bio.trim();
      }

      console.log('Sending profile update with data:', updateData);

      const response = await userApi.updateProfile(updateData, profileImage || undefined);
      
      if (response.status === 'success') {
        Alert.alert('Success', 'Profile updated successfully!');
        onProfileUpdated({
          ...user!,
          ...formData,
          ...(response.data && {
            profile_picture: (response.data as any).profile_picture,
            bio: (response.data as any).bio ?? formData.bio,
          }),
        });
        onClose();
      } else {
        Alert.alert('Error', response.message || 'Failed to update profile');
      }
    } catch (error: any) {
      console.error('Profile update error:', error);
      
      // Handle network errors specifically
      if (error.code === 'NETWORK_ERROR' || error.message === 'Network Error') {
        Alert.alert('Network Error', 'Please check your internet connection and try again.');
      } else {
        const errorMessage = error.response?.data?.message || 'Failed to update profile';
        Alert.alert('Error', errorMessage);
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
    } catch (error) {
      Alert.alert('Error', 'Failed to pick image');
    }
  };



  if (!user) return null;

  return (
    <Modal
      visible={isVisible}
      animationType="slide"
      transparent={true}
      onRequestClose={handleCancel}
    >
      <View style={styles.overlay}>
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={handleCancel} disabled={loading}>
              <Text style={styles.cancelButton}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.title}>Edit Profile</Text>
            <TouchableOpacity onPress={handleSave} disabled={loading}>
              {loading ? (
                <ActivityIndicator size="small" color="#60a5fa" />
              ) : (
                <Text style={styles.saveButton}>Save</Text>
              )}
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
            {/* Profile Picture Section */}
            <View style={styles.profilePictureSection}>
              <View style={styles.profilePictureContainer}>
                <Image
                  source={{ 
                    uri: profileImage || user?.profile_picture || 'https://via.placeholder.com/100' 
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

            {/* Form Fields */}
            <View style={styles.formSection}>
              {/* Primary Phone */}
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Primary Phone (Optional)</Text>
                <TextInput
                  style={styles.input}
                  value={formData.phone1}
                  onChangeText={(value) => setFormData(prev => ({ ...prev, phone1: value }))}
                  placeholder="Enter primary phone number (optional)"
                  placeholderTextColor="#666"
                  keyboardType="phone-pad"
                />
              </View>

              {/* Secondary Phone */}
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Secondary Phone (Optional)</Text>
                <TextInput
                  style={styles.input}
                  value={formData.phone2}
                  onChangeText={(value) => setFormData(prev => ({ ...prev, phone2: value }))}
                  placeholder="Enter secondary phone number (optional)"
                  placeholderTextColor="#666"
                  keyboardType="phone-pad"
                />
              </View>

              {/* Bio */}
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Bio</Text>
                <TextInput
                  style={[styles.input, styles.bioInput]}
                  value={formData.bio}
                  onChangeText={(value) => setFormData(prev => ({ ...prev, bio: value }))}
                  placeholder="Tell others a bit about yourself..."
                  placeholderTextColor="#666"
                  multiline
                />
              </View>
            </View>
          </ScrollView>
        </View>
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
    paddingVertical: 30,
  },
  profilePictureContainer: {
    position: 'relative',
    marginBottom: 15,
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
    marginBottom: 20,
  },
  label: {
    color: '#f3f4f6',
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#232326',
    borderWidth: 1,
    borderColor: '#27272a',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: '#f3f4f6',
    fontSize: 16,
  },
  bioInput: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
}); 