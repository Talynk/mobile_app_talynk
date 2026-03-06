import React from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';

const C = {
  overlay: 'rgba(0,0,0,0.7)',
  card: '#1f2937',
  cardBorder: '#374151',
  text: '#f3f4f6',
  textSecondary: '#9ca3af',
  unfollowRed: '#ef4444',
  cancelBg: 'rgba(255,255,255,0.1)',
};

interface UnfollowConfirmModalProps {
  visible: boolean;
  username: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function UnfollowConfirmModal({ visible, username, onConfirm, onCancel }: UnfollowConfirmModalProps) {
  return (
    <Modal visible={visible} transparent animationType="fade">
      <TouchableOpacity activeOpacity={1} style={styles.overlay} onPress={onCancel}>
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <Feather name="user-minus" size={32} color={C.textSecondary} />
          </View>
          <Text style={styles.title}>Unfollow @{username || 'user'}?</Text>
          <Text style={styles.subtitle}>Their posts will no longer show up in your Following feed.</Text>
          <TouchableOpacity style={styles.unfollowButton} onPress={onConfirm} activeOpacity={0.8}>
            <Text style={styles.unfollowButtonText}>Unfollow</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelButton} onPress={onCancel} activeOpacity={0.8}>
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: C.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: C.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.cardBorder,
    paddingVertical: 24,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.06)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: C.text,
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: C.textSecondary,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  unfollowButton: {
    width: '100%',
    backgroundColor: C.unfollowRed,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 10,
  },
  unfollowButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  cancelButton: {
    width: '100%',
    backgroundColor: C.cancelBg,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: C.text,
  },
});
