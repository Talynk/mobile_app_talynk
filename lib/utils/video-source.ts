import { Platform } from 'react-native';
import { convertUrl } from 'expo-video-cache';
import type { VideoSource } from 'expo-video';

/**
 * Returns a platform-aware VideoSource that routes through the cache layer.
 *
 * iOS     – proxied through expo-video-cache's local server for HLS segment caching.
 * Android – uses ExoPlayer's native LRU disk cache via useCaching: true.
 */
export function getVideoSource(url: string): VideoSource {
  if (Platform.OS === 'ios') {
    return { uri: convertUrl(url) };
  }
  return { uri: url, useCaching: true };
}
