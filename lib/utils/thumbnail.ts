import * as FileSystem from 'expo-file-system/legacy';
import { createVideoThumbnail } from 'react-native-compressor';

/**
 * Generate thumbnail from video URI
 * For Expo Go compatibility, we return the video URI and let the backend generate the thumbnail.
 * This is the simplest approach and avoids MediaLibrary permission issues in Expo Go.
 */
export const generateThumbnail = async (videoUri: string): Promise<string | null> => {
  try {
    const fileInfo = await FileSystem.getInfoAsync(videoUri);
    if (!fileInfo.exists) {
      console.warn('Video file does not exist:', videoUri);
      return null;
    }

    const thumbnail = await createVideoThumbnail(videoUri);
    if (thumbnail?.path) {
      return thumbnail.path.startsWith('file://') ? thumbnail.path : `file://${thumbnail.path}`;
    }

    return null;
  } catch (error) {
    console.warn('Error checking video file:', error);
    return null;
  }
};
