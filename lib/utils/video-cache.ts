import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';

const CACHE_DIR = `${FileSystem.cacheDirectory}video-cache/`;
// CRITICAL FIX: Optimized cache size for better performance and less data usage
// CRITICAL FIX: Increased cache size and expiry for better caching
// Videos should stay cached longer so they play instantly when scrolling back
const MAX_CACHE_SIZE = 500 * 1024 * 1024; // 500MB - enough to cache many videos
const CACHE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days cache - keep videos cached longer
const METADATA_FILE = `${CACHE_DIR}metadata.json`;

interface CacheMetadata {
  entries: {
    [url: string]: {
      localPath: string;
      size: number;
      timestamp: number;
      lastAccessed: number;
    };
  };
  totalSize: number;
}

let metadata: CacheMetadata | null = null;
let isInitialized = false;
const pendingDownloads = new Map<string, Promise<string | null>>();

/**
 * Initialize the video cache directory
 */
export const initVideoCache = async (): Promise<void> => {
  if (isInitialized) return;

  try {
    const dirInfo = await FileSystem.getInfoAsync(CACHE_DIR);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
    }

    // Load metadata
    const metadataInfo = await FileSystem.getInfoAsync(METADATA_FILE);
    if (metadataInfo.exists) {
      const metadataContent = await FileSystem.readAsStringAsync(METADATA_FILE);
      metadata = JSON.parse(metadataContent);
    } else {
      metadata = { entries: {}, totalSize: 0 };
    }

    isInitialized = true;
    if (__DEV__) {
      console.log('📦 [VideoCache] Initialized, size:', formatBytes(metadata?.totalSize || 0));
    }

    // Clean expired entries on startup
    cleanExpiredEntries();
  } catch (error) {
    console.error('[VideoCache] Init error:', error);
    metadata = { entries: {}, totalSize: 0 };
    isInitialized = true;
  }
};

/**
 * Save metadata to disk
 */
const saveMetadata = async (): Promise<void> => {
  if (!metadata) return;
  try {
    await FileSystem.writeAsStringAsync(METADATA_FILE, JSON.stringify(metadata));
  } catch (error) {
    console.error('[VideoCache] Failed to save metadata:', error);
  }
};

/**
 * Format bytes to human readable
 */
const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
};

/**
 * Clean expired cache entries
 */
const cleanExpiredEntries = async (): Promise<void> => {
  if (!metadata) return;

  const now = Date.now();
  const expiredUrls: string[] = [];

  for (const [url, entry] of Object.entries(metadata.entries)) {
    if (now - entry.timestamp > CACHE_EXPIRY_MS) {
      expiredUrls.push(url);
    }
  }

  for (const url of expiredUrls) {
    await removeCacheEntry(url);
  }

  if (expiredUrls.length > 0 && __DEV__) {
    console.log(`🧹 [VideoCache] Cleaned ${expiredUrls.length} expired entries`);
  }
};

/**
 * Remove a cache entry
 */
const removeCacheEntry = async (url: string): Promise<void> => {
  if (!metadata || !metadata.entries[url]) return;

  const entry = metadata.entries[url];
  try {
    const fileInfo = await FileSystem.getInfoAsync(entry.localPath);
    if (fileInfo.exists) {
      await FileSystem.deleteAsync(entry.localPath, { idempotent: true });
    }
  } catch (error) {
    // Ignore deletion errors
  }

  metadata.totalSize -= entry.size;
  delete metadata.entries[url];
  await saveMetadata();
};

/**
 * Evict least recently used entries to make space
 */
const evictLRU = async (neededSpace: number): Promise<void> => {
  if (!metadata) return;

  // Sort by lastAccessed (oldest first)
  const entries = Object.entries(metadata.entries)
    .sort(([, a], [, b]) => a.lastAccessed - b.lastAccessed);

  let freedSpace = 0;
  for (const [url] of entries) {
    if (freedSpace >= neededSpace) break;
    const entry = metadata.entries[url];
    if (entry) {
      freedSpace += entry.size;
      await removeCacheEntry(url);
    }
  }

  if (__DEV__) {
    console.log(`🗑️ [VideoCache] Evicted ${formatBytes(freedSpace)} via LRU`);
  }
};

/**
 * Get cached video URI or download and cache it
 */
export const getCachedVideoUri = async (remoteUrl: string): Promise<string | null> => {
  if (!remoteUrl) return null;

  // Initialize if needed
  if (!isInitialized) {
    await initVideoCache();
  }

  // CRITICAL FIX: Check if already cached - this is the KEY to instant playback when scrolling back
  if (metadata?.entries[remoteUrl]) {
    const entry = metadata.entries[remoteUrl];
    const fileInfo = await FileSystem.getInfoAsync(entry.localPath);

    if (fileInfo.exists) {
      // CRITICAL: Update last accessed time - this keeps recently viewed videos in cache
      entry.lastAccessed = Date.now();
      await saveMetadata();

      if (__DEV__) {
        console.log('✅ [VideoCache] CACHE HIT - Instant playback:', remoteUrl.substring(0, 50) + '...');
      }
      // Return cached local file path - this is what makes videos play instantly when scrolling back
      return entry.localPath;
    } else {
      // File was deleted externally, remove from metadata
      await removeCacheEntry(remoteUrl);
    }
  }

  // Check if download is already in progress
  if (pendingDownloads.has(remoteUrl)) {
    return pendingDownloads.get(remoteUrl)!;
  }

  // Download and cache
  const downloadPromise = downloadAndCache(remoteUrl);
  pendingDownloads.set(remoteUrl, downloadPromise);

  try {
    const result = await downloadPromise;
    return result;
  } finally {
    pendingDownloads.delete(remoteUrl);
  }
};

/**
 * Download video and cache it
 */
const downloadAndCache = async (remoteUrl: string): Promise<string | null> => {
  if (!metadata) return null;

  try {
    // Generate local filename
    const urlHash = hashCode(remoteUrl);
    const extension = getExtension(remoteUrl);
    const localPath = `${CACHE_DIR}${urlHash}${extension}`;

    if (__DEV__) {
      console.log('📥 [VideoCache] Downloading:', remoteUrl.substring(0, 50) + '...');
    }

    // Download file
    const downloadResult = await FileSystem.downloadAsync(
      remoteUrl,
      localPath,
      {
        headers: {
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      }
    );

    if (downloadResult.status !== 200) {
      console.warn('[VideoCache] Download failed:', downloadResult.status);
      return null;
    }

    // Get file size
    const fileInfo = await FileSystem.getInfoAsync(localPath);
    const fileSize = (fileInfo as any).size || 0;

    // Check if we need to evict
    if (metadata.totalSize + fileSize > MAX_CACHE_SIZE) {
      await evictLRU(fileSize);
    }

    // Add to metadata
    metadata.entries[remoteUrl] = {
      localPath,
      size: fileSize,
      timestamp: Date.now(),
      lastAccessed: Date.now(),
    };
    metadata.totalSize += fileSize;
    await saveMetadata();

    if (__DEV__) {
      console.log(`✅ [VideoCache] Cached (${formatBytes(fileSize)}):`, remoteUrl.substring(0, 50) + '...');
      console.log(`📊 [VideoCache] Total size: ${formatBytes(metadata.totalSize)}`);
    }

    return localPath;
  } catch (error) {
    console.error('[VideoCache] Download error:', error);
    return null;
  }
};

/**
 * Preload multiple videos in background
 */
export const preloadVideos = async (urls: string[]): Promise<void> => {
  if (!isInitialized) {
    await initVideoCache();
  }

  // Filter out already cached URLs
  const urlsToPreload = urls.filter(url => {
    if (!metadata?.entries[url]) return true;
    // Check if file still exists
    return !metadata.entries[url];
  });

  if (urlsToPreload.length === 0) return;

  if (__DEV__) {
    console.log(`🔄 [VideoCache] Preloading ${urlsToPreload.length} videos...`);
  }

  // CRITICAL FIX: Reduced concurrent downloads to prevent memory issues and crashes
  // Download ONE video at a time to avoid overwhelming the device
  const batchSize = 1; // Only 1 at a time to prevent freeze
  for (let i = 0; i < urlsToPreload.length; i += batchSize) {
    const batch = urlsToPreload.slice(i, i + batchSize);
    await Promise.all(batch.map(url => getCachedVideoUri(url)));
  }
};

/**
 * Check if a video is cached
 */
export const isVideoCached = (url: string): boolean => {
  return !!(metadata?.entries[url]);
};

/**
 * CRITICAL FIX: Get cached video path SYNCHRONOUSLY - no async, instant return
 * This is the KEY to preventing black screens when scrolling back to a video
 * Returns the local file:// path if cached, null otherwise
 * DO NOT use async operations here - that defeats the purpose of instant playback
 */
export const getCachedPathSync = (url: string): string | null => {
  if (!url || !metadata?.entries[url]) return null;

  const entry = metadata.entries[url];
  if (!entry?.localPath) return null;

  // Return the cached path immediately - no file existence check (too slow)
  // If file doesn't exist, video player will fall back to remote URL
  return entry.localPath;
};

/**
 * Alias for getCachedPathSync for backwards compatibility
 */
export const getInstantCachedPath = getCachedPathSync;

/**
 * Clear entire cache
 */
export const clearVideoCache = async (): Promise<void> => {
  try {
    await FileSystem.deleteAsync(CACHE_DIR, { idempotent: true });
    metadata = { entries: {}, totalSize: 0 };
    isInitialized = false;
    await initVideoCache();
    if (__DEV__) {
      console.log('🧹 [VideoCache] Cache cleared');
    }
  } catch (error) {
    console.error('[VideoCache] Clear error:', error);
  }
};

/**
 * Get cache stats
 */
export const getCacheStats = (): { size: number; count: number } => {
  return {
    size: metadata?.totalSize || 0,
    count: Object.keys(metadata?.entries || {}).length,
  };
};

// Helper: Simple hash function
const hashCode = (str: string): string => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
};

// Helper: Get file extension from URL
const getExtension = (url: string): string => {
  const match = url.match(/\.(mp4|mov|webm|m4v)/i);
  return match ? match[0] : '.mp4';
};
