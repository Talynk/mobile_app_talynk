import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

interface DefaultAvatarProps {
  size?: number;
  name?: string;
  style?: any;
}

/**
 * DefaultAvatar component - displays a gradient avatar with user initials
 * Used as a fallback when users don't have profile pictures
 */
export const DefaultAvatar: React.FC<DefaultAvatarProps> = ({ 
  size = 40, 
  name = '',
  style 
}) => {
  // Extract initials from name
  const getInitials = (name: string): string => {
    if (!name || name.trim() === '') return '?';
    
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) {
      // Single word - take first 2 characters
      return parts[0].substring(0, 2).toUpperCase();
    }
    
    // Multiple words - take first letter of first 2 words
    return parts
      .slice(0, 2)
      .map(part => part[0])
      .join('')
      .toUpperCase();
  };

  const initials = getInitials(name);

  return (
    <LinearGradient
      colors={['#3b82f6', '#8b5cf6']}
      style={[
        styles.avatar,
        { 
          width: size, 
          height: size, 
          borderRadius: size / 2 
        },
        style
      ]}
    >
      <Text 
        style={[
          styles.avatarText, 
          { fontSize: size * 0.4 }
        ]}
      >
        {initials}
      </Text>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  avatar: {
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  avatarText: {
    color: '#fff',
    fontWeight: '600',
    textAlign: 'center',
  },
});
