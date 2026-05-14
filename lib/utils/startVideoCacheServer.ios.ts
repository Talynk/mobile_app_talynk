import { IOS_STARTUP_FLAGS } from '@/lib/utils/ios-startup-flags';
import {
  markVideoProxyFailed,
  markVideoProxyReady,
  markVideoProxyStartup,
} from '@/lib/utils/video-proxy-state';

/**
 * iOS only: starts the expo-video-cache proxy for HLS segment caching.
 * This file is only bundled for iOS; the Android bundle uses startVideoCacheServer.android.ts (no-op).
 */
let startPromise: Promise<boolean> | null = null;

export function start(): Promise<boolean> {
  const ENABLE_IOS_VIDEO_CACHE_PROXY = false && IOS_STARTUP_FLAGS.enableVideoCacheProxy;
  if (!ENABLE_IOS_VIDEO_CACHE_PROXY) {
    markVideoProxyFailed();
    return Promise.resolve(false);
  }

  if (startPromise) {
    return startPromise;
  }

  const MAX_CACHE_BYTES = 512 * 1024 * 1024; // 512 MiB
  startPromise = import('expo-video-cache')
    .then((module) => module.startServer(9000, MAX_CACHE_BYTES, false))
    .then(() => {
      markVideoProxyReady();
      return true;
    })
    .catch(() => {
      markVideoProxyFailed();
      return false;
    });

  markVideoProxyStartup(startPromise);
  return startPromise;
}
