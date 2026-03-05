import type { VideoSource } from 'expo-video';

/**
 * Android: ExoPlayer native LRU disk cache. No expo-video-cache in this bundle.
 */
export function getVideoSource(url: string): VideoSource {
  return { uri: url, useCaching: true };
}
