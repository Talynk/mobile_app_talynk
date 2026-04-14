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
      const proxied = convertUrl(url);
      if (proxied) {
        return {
          uri: proxied,
          ...(contentType ? { contentType } : {}),
        };
      }
    } catch (_) {
      // Proxy failed (e.g., server crashed from NSFileHandleOperationException).
      // Fall through to use the direct URL instead of crashing.
    }
  }

  return {
    uri: url,
    ...(contentType ? { contentType } : {}),
  };
}
