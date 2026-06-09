import type { VideoSource } from 'expo-video';

function isHlsUrl(url: string): boolean {
  return url.toLowerCase().includes('.m3u8');
}

export function getVideoSource(url: string): VideoSource {
  const isHls = isHlsUrl(url);

  return {
    uri: url,
    useCaching: true,
    ...(isHls ? { contentType: 'hls' as const } : {}),
  };
}
