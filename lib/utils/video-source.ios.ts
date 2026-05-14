import type { VideoSource } from 'expo-video';
function isHlsUrl(url: string): boolean {
  return url.toLowerCase().includes('.m3u8');
}

export function getVideoSource(url: string): VideoSource {
  const contentType = isHlsUrl(url) ? 'hls' as const : undefined;

  return {
    uri: url,
    // Expo SDK 54 cannot cache HLS on iOS. Direct HLS is the stable AVPlayer path.
    useCaching: false,
    ...(contentType ? { contentType } : {}),
  };
}
