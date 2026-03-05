import type { VideoSource } from 'expo-video';

/**
 * Fallback when no platform-specific file is used (e.g. web).
 * Android/iOS use video-source.android.ts and video-source.ios.ts so the Android bundle never references expo-video-cache.
 */
export function getVideoSource(url: string): VideoSource {
  return { uri: url, useCaching: true };
}
