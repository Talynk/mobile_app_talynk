import * as FileSystem from 'expo-file-system/legacy';
import * as VideoThumbnails from 'expo-video-thumbnails';

/**
 * Generate a local thumbnail for a captured or picked video without going through
 * `react-native-compressor`, which avoids Android MediaCodec contention with uploads.
 */
export const generateThumbnail = async (videoUri: string): Promise<string | null> => {
  try {
    const fileInfo = await FileSystem.getInfoAsync(videoUri);
    if (!fileInfo.exists) {
      console.warn('Video file does not exist:', videoUri);
      return null;
    }

    const thumbnail = await VideoThumbnails.getThumbnailAsync(videoUri, {
      time: 1000,
    });
    if (thumbnail?.uri) {
      return thumbnail.uri.startsWith('file://') ? thumbnail.uri : `file://${thumbnail.uri}`;
    }

    return null;
  } catch (error) {
    console.warn('Error checking video file:', error);
    return null;
  }
};
