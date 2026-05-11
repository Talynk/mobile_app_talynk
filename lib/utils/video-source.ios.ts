import type { VideoSource } from 'expo-video';

let cachedConvertUrl: ((url: string) => string) | null | undefined = undefined;

function isHlsUrl(url: string): boolean {
  return url.toLowerCase().includes('.m3u8');
}

function getConvertUrlOnce(): ((url: string) => string) | null {
  if (cachedConvertUrl !== undefined) return cachedConvertUrl;
  try {
    const convertUrl = require('expo-video-cache').convertUrl as ((url: string) => string) | undefined;
    cachedConvertUrl = typeof convertUrl === 'function' ? convertUrl : null;
  } catch {
    cachedConvertUrl = null;
  }
  return cachedConvertUrl ?? null;
}

export function getVideoSource(url: string): VideoSource {
  const convertUrl = getConvertUrlOnce();
  const contentType = isHlsUrl(url) ? 'hls' as const : undefined;

  if (convertUrl) {
    try {
      const proxied = convertUrl(url, true);
      if (proxied) {
        return {
          uri: proxied,
          useCaching: true,
          ...(contentType ? { contentType } : {}),
        };
      }
    } catch (_) {
      // Fall through to direct URL when proxy conversion fails.
    }
  }

  return {
    uri: url,
    useCaching: true,
    ...(contentType ? { contentType } : {}),
  };
}
