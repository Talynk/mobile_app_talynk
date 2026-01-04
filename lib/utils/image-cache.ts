import { Image } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const CACHE_KEY_PREFIX = '@image_cache_';
const CACHE_METADATA_KEY = '@image_cache_metadata';
const MAX_CACHE_SIZE = 50; // Maximum number of images to cache
const CACHE_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CacheMetadata {
  [uri: string]: {
    timestamp: number;
    size?: number;
    accessCount: number;
  };
}

/**
 * Image cache manager for memory optimization
 * Handles prefetching, caching, and cleanup of images
 */
class ImageCacheManager {
  private metadata: CacheMetadata = {};
  private prefetchQueue: string[] = [];
  private isPrefetching = false;
  private initialized = false;

  /**
   * Initialize cache manager (load metadata)
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const storedMetadata = await AsyncStorage.getItem(CACHE_METADATA_KEY);
      if (storedMetadata) {
        this.metadata = JSON.parse(storedMetadata);
        // Clean up expired entries
        await this.cleanupExpired();
      }
      this.initialized = true;
    } catch (error) {
      console.warn('[ImageCache] Failed to initialize:', error);
      this.metadata = {};
      this.initialized = true;
    }
  }

  /**
   * Prefetch an image for later use
   */
  async prefetch(uri: string): Promise<boolean> {
    if (!uri || !uri.startsWith('http')) return false;

    try {
      await this.initialize();
      
      // Skip if already cached and not expired
      if (this.isCached(uri)) {
        this.updateAccessTime(uri);
        return true;
      }

      // Prefetch the image
      await Image.prefetch(uri);
      
      // Update metadata
      this.metadata[uri] = {
        timestamp: Date.now(),
        accessCount: 1,
      };
      
      await this.saveMetadata();
      return true;
    } catch (error) {
      // Silently fail - image will load on demand
      return false;
    }
  }

  /**
   * Prefetch multiple images with queue management
   */
  async prefetchBatch(uris: string[], concurrency = 3): Promise<void> {
    if (!uris.length) return;

    await this.initialize();

    // Filter out already cached images
    const uncachedUris = uris.filter(uri => uri && !this.isCached(uri));
    
    if (!uncachedUris.length) return;

    // Add to queue
    this.prefetchQueue.push(...uncachedUris);

    // Start processing if not already
    if (!this.isPrefetching) {
      await this.processPrefetchQueue(concurrency);
    }
  }

  /**
   * Process prefetch queue with concurrency limit
   */
  private async processPrefetchQueue(concurrency: number): Promise<void> {
    this.isPrefetching = true;

    while (this.prefetchQueue.length > 0) {
      const batch = this.prefetchQueue.splice(0, concurrency);
      await Promise.allSettled(batch.map(uri => this.prefetch(uri)));
    }

    this.isPrefetching = false;
  }

  /**
   * Check if image is cached
   */
  isCached(uri: string): boolean {
    const entry = this.metadata[uri];
    if (!entry) return false;

    // Check if expired
    const isExpired = Date.now() - entry.timestamp > CACHE_EXPIRY_MS;
    return !isExpired;
  }

  /**
   * Update access time for LRU eviction
   */
  private updateAccessTime(uri: string): void {
    if (this.metadata[uri]) {
      this.metadata[uri].accessCount++;
      this.metadata[uri].timestamp = Date.now();
    }
  }

  /**
   * Clear expired cache entries
   */
  async cleanupExpired(): Promise<void> {
    const now = Date.now();
    const expiredKeys: string[] = [];

    for (const [uri, entry] of Object.entries(this.metadata)) {
      if (now - entry.timestamp > CACHE_EXPIRY_MS) {
        expiredKeys.push(uri);
      }
    }

    for (const key of expiredKeys) {
      delete this.metadata[key];
    }

    if (expiredKeys.length > 0) {
      await this.saveMetadata();
    }
  }

  /**
   * Clear least recently used entries when cache is full
   */
  async enforceCacheLimit(): Promise<void> {
    const entries = Object.entries(this.metadata);
    
    if (entries.length <= MAX_CACHE_SIZE) return;

    // Sort by access count (ascending) and timestamp (ascending)
    entries.sort(([, a], [, b]) => {
      if (a.accessCount !== b.accessCount) {
        return a.accessCount - b.accessCount;
      }
      return a.timestamp - b.timestamp;
    });

    // Remove oldest/least used entries
    const toRemove = entries.slice(0, entries.length - MAX_CACHE_SIZE);
    for (const [uri] of toRemove) {
      delete this.metadata[uri];
    }

    await this.saveMetadata();
  }

  /**
   * Save metadata to storage
   */
  private async saveMetadata(): Promise<void> {
    try {
      await this.enforceCacheLimit();
      await AsyncStorage.setItem(CACHE_METADATA_KEY, JSON.stringify(this.metadata));
    } catch (error) {
      console.warn('[ImageCache] Failed to save metadata:', error);
    }
  }

  /**
   * Clear all cached images
   */
  async clearAll(): Promise<void> {
    this.metadata = {};
    this.prefetchQueue = [];
    
    try {
      await AsyncStorage.removeItem(CACHE_METADATA_KEY);
    } catch (error) {
      console.warn('[ImageCache] Failed to clear cache:', error);
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): { count: number; oldestTimestamp: number | null } {
    const entries = Object.values(this.metadata);
    return {
      count: entries.length,
      oldestTimestamp: entries.length > 0 
        ? Math.min(...entries.map(e => e.timestamp))
        : null,
    };
  }
}

// Singleton instance
export const imageCache = new ImageCacheManager();

/**
 * Hook for prefetching images when they come into view
 */
export const usePrefetchImages = () => {
  const prefetch = async (uris: (string | undefined | null)[]) => {
    const validUris = uris.filter((uri): uri is string => 
      typeof uri === 'string' && uri.startsWith('http')
    );
    await imageCache.prefetchBatch(validUris);
  };

  return { prefetch };
};

export default imageCache;



















