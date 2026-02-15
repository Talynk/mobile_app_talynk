import React from 'react';
import { Image, ImageStyle, StyleSheet, ViewStyle } from 'react-native';
import { DefaultAvatar } from './DefaultAvatar';
import { getProfilePictureUrl } from '@/lib/utils/file-url';

interface AvatarProps {
  user?: {
    id?: string;
    username?: string;
    name?: string;
    profile_picture?: string;
    avatar?: string;
    authorProfilePicture?: string;
  } | null;
  size?: number;
  style?: ViewStyle | ImageStyle;
  fallbackName?: string;
}

/**
 * Avatar component - displays user profile picture or falls back to DefaultAvatar
 * 
 * @param user - User object with profile picture information
 * @param size - Size of the avatar (default: 40)
 * @param style - Additional styles to apply
 * @param fallbackName - Name to use for initials if no profile picture (defaults to user.name or user.username)
 */
export const Avatar: React.FC<AvatarProps> = ({
  user,
  size = 40,
  style,
  fallbackName,
}) => {
  const profilePictureUrl = getProfilePictureUrl(user);

  // If we have a profile picture URL, show the image
  if (profilePictureUrl) {
    return (
      <Image
        source={{ uri: profilePictureUrl }}
        style={[
          styles.avatar,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
          },
          style as ImageStyle,
        ]}
        resizeMode="cover"
      />
    );
  }

  // Otherwise, use DefaultAvatar with initials
  const name = fallbackName || user?.name || user?.username || '';
  return (
    <DefaultAvatar
      size={size}
      name={name}
      style={style}
    />
  );
};

const styles = StyleSheet.create({
  avatar: {
    backgroundColor: '#1a1a1a',
  },
});
