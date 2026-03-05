/**
 * iOS only: starts the expo-video-cache proxy for HLS segment caching.
 * This file is only bundled for iOS; the Android bundle uses startVideoCacheServer.android.ts (no-op).
 */
export function start(): void {
  import('expo-video-cache')
    .then((m) => m.startServer(9000, 1024 * 1024 * 1024, true).catch(() => {}))
    .catch(() => {});
}
