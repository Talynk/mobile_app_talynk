import { IOS_STARTUP_FLAGS } from '@/lib/utils/ios-startup-flags';

/**
 * iOS only: starts the expo-video-cache proxy for HLS segment caching.
 * This file is only bundled for iOS; the Android bundle uses startVideoCacheServer.android.ts (no-op).
 */
export function start(): void {
  // Safety-first on iOS release builds:
  // Crash logs show NSFileHandle aborts on NSURLSession delegate threads on iPhone X.
  // Until we complete a full native stress pass, keep the custom iOS proxy disabled.
  // Playback continues through expo-video's native buffering.
  const ENABLE_IOS_VIDEO_CACHE_PROXY = IOS_STARTUP_FLAGS.enableVideoCacheProxy && !IOS_STARTUP_FLAGS.launchSafeMode;
  if (!ENABLE_IOS_VIDEO_CACHE_PROXY) {
    return;
  }

  try {
    // Use a conservative cache (150 MiB) to prevent NSFileHandleOperationException
    // crashes on low-memory devices like iPhone X (2.8 GiB RAM). iOS aggressively
    // cleans temp files under memory pressure which causes fatal SIGABRT if the
    // proxy still holds open file handles.
    const MAX_CACHE_BYTES = 150 * 1024 * 1024; // 150 MiB
    import('expo-video-cache')
      .then((m) => m.startServer(9000, MAX_CACHE_BYTES, true).catch(() => {}))
      .catch(() => {});
  } catch (_) {}
}
