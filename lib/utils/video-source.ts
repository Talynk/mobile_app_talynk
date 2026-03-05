import { Platform } from 'react-native';
import type { VideoSource } from 'expo-video';

// Lazy-loaded only when getVideoSource is called on iOS; never loaded on Android.
let cachedConvertUrl: ((url: string) => string) | null | undefined = undefined;

function getConvertUrlOnce(): ((url: string) => string) | null {
  if (cachedConvertUrl !== undefined) return cachedConvertUrl;
  try {
    cachedConvertUrl = require('expo-video-cache').convertUrl;
  } catch {
    cachedConvertUrl = null;
  }
  return cachedConvertUrl;
}

/**
 * Returns a platform-aware VideoSource that routes through the cache layer when available.
 *
 * iOS     – proxied through expo-video-cache's local server for HLS segment caching when native module is present; otherwise direct URL.
 * Android – uses ExoPlayer's native LRU disk cache via useCaching: true. Never loads expo-video-cache.
 */
export function getVideoSource(url: string): VideoSource {
  if (Platform.OS === 'android') {
    return { uri: url, useCaching: true };
  }
  if (Platform.OS === 'ios') {
    const convertUrl = getConvertUrlOnce();
    if (convertUrl) return { uri: convertUrl(url) };
  }
  return { uri: url };
}
