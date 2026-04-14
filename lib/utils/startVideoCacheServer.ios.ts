/**
 * iOS only: starts the expo-video-cache proxy for HLS segment caching.
 * This file is only bundled for iOS; the Android bundle uses startVideoCacheServer.android.ts (no-op).
 */
export function start(): void {
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
