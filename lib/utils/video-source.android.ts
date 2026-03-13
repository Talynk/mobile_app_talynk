import type { VideoSource } from 'expo-video';

function isHlsUrl(url: string): boolean {
  return url.toLowerCase().includes('.m3u8');
}

/**
 * Android: ExoPlayer native LRU disk cache. No expo-video-cache in this bundle.
 */
export function getVideoSource(url: string): VideoSource {
  return {
    uri: url,
    useCaching: true,
    ...(isHlsUrl(url) ? { contentType: 'hls' as const } : {}),
  };
}
