import { Platform } from 'react-native';
import type { VideoSource } from 'expo-video';

let convertUrl: ((url: string) => string) | null = null;
try {
  convertUrl = require('expo-video-cache').convertUrl;
} catch {
  // Native module not available (e.g. production build without expo-video-cache)
}

/**
 * Returns a platform-aware VideoSource that routes through the cache layer when available.
 *
 * iOS     – proxied through expo-video-cache's local server for HLS segment caching when native module is present; otherwise direct URL.
 * Android – uses ExoPlayer's native LRU disk cache via useCaching: true.
 */
export function getVideoSource(url: string): VideoSource {
  if (Platform.OS === 'ios' && convertUrl) {
    return { uri: convertUrl(url) };
  }
  if (Platform.OS === 'android') {
    return { uri: url, useCaching: true };
  }
  return { uri: url };
}
