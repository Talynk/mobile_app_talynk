import { IOS_STARTUP_FLAGS } from '@/lib/utils/ios-startup-flags';

/**
 * iOS only: starts the expo-video-cache proxy for HLS segment caching.
 * This file is only bundled for iOS; the Android bundle uses startVideoCacheServer.android.ts (no-op).
 */
export function start(): void {
  const ENABLE_IOS_VIDEO_CACHE_PROXY = IOS_STARTUP_FLAGS.enableVideoCacheProxy;
  if (!ENABLE_IOS_VIDEO_CACHE_PROXY) {
    return;
  }

  try {
    const MAX_CACHE_BYTES = 512 * 1024 * 1024; // 512 MiB
    import('expo-video-cache')
      .then((m) => m.startServer(9000, MAX_CACHE_BYTES, false).catch(() => {}))
      .catch(() => {});
  } catch (_) {}
}
