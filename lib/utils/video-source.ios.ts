import type { VideoSource } from 'expo-video';

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

export function getVideoSource(url: string): VideoSource {
  const convertUrl = getConvertUrlOnce();
  if (convertUrl) return { uri: convertUrl(url) };
  return { uri: url };
}
