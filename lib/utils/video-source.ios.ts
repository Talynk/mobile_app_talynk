import type { VideoSource } from 'expo-video';

function isHlsUrl(url: string): boolean {
  return url.toLowerCase().includes('.m3u8');
}

export function getVideoSource(url: string): VideoSource {
  const contentType = isHlsUrl(url) ? 'hls' as const : undefined;

  return {
    uri: url,
    useCaching: false,
    ...(contentType ? { contentType } : {}),
  };
}
