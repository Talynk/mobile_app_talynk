/**
 * Android: no-op. Video caching uses ExoPlayer's native LRU cache (useCaching: true).
 * This file is only bundled for Android so the bundle never references expo-video-cache.
 */
export function start(): void {}
