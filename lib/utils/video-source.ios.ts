import type { VideoSource } from 'expo-video';
import {
  isVideoProxyDisabledForSession,
  isVideoProxyReady,
} from '@/lib/utils/video-proxy-state';

let cachedConvertUrl: ((url: string, isCacheable?: boolean) => string) | null | undefined = undefined;

function isHlsUrl(url: string): boolean {
  return url.toLowerCase().includes('.m3u8');
}

function getConvertUrlOnce(): ((url: string, isCacheable?: boolean) => string) | null {
  if (cachedConvertUrl !== undefined) return cachedConvertUrl;
  try {
    const convertUrl = require('expo-video-cache').convertUrl as ((url: string, isCacheable?: boolean) => string) | undefined;
    cachedConvertUrl = typeof convertUrl === 'function' ? convertUrl : null;
  } catch {
    cachedConvertUrl = null;
  }
  return cachedConvertUrl ?? null;
}

export function getVideoSource(url: string): VideoSource {
  const convertUrl = getConvertUrlOnce();
  const contentType = isHlsUrl(url) ? 'hls' as const : undefined;

  if (convertUrl && isVideoProxyReady() && !isVideoProxyDisabledForSession()) {
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
    useCaching: !contentType,
    ...(contentType ? { contentType } : {}),
  };
}
