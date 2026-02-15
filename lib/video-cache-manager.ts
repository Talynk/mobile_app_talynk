import AsyncStorage from '@react-native-async-storage/async-storage';
import { getFileUrl } from '@/lib/utils/file-url';

// Video cache manager for efficient buffering and prefetching
const VIDEO_CACHE_KEY_PREFIX = 'video_cache_';
const MAX_CACHE_SIZE = 50; // Keep cache of up to 50 video URLs
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

interface CacheEntry {
  url: string;
  timestamp: number;
  size?: number;
}

interface VideoCacheIndex {
  entries: CacheEntry[];
  lastCleaned: number;
}

class VideoCacheManager {
  private cacheIndex: VideoCacheIndex | null = null;
  private loadingPromises: Map<string, Promise<string>> = new Map();

  /**
   * Initialize the cache from storage
   */
  async initializeCache(): Promise<void> {
    try {
      const cached = await AsyncStorage.getItem('video_cache_index');
      if (cached) {
        this.cacheIndex = JSON.parse(cached);
        // Clean expired entries
        await this.cleanExpiredCache();
      } else {
        this.cacheIndex = { entries: [], lastCleaned: Date.now() };
      }
    } catch (error) {
      console.error('Error initializing video cache:', error);
      this.cacheIndex = { entries: [], lastCleaned: Date.now() };
    }
  }

  /**
   * Convert relative URL to full URL and cache it
   */
  async cacheVideoUrl(relativeUrl: string): Promise<string> {
    try {
      // Return cached promise if already loading
      if (this.loadingPromises.has(relativeUrl)) {
        return await this.loadingPromises.get(relativeUrl)!;
      }

      // Convert to full URL
      const fullUrl = getFileUrl(relativeUrl);

      // Check if already in cache (recent and valid)
      if (this.cacheIndex) {
        const existing = this.cacheIndex.entries.find(e => e.url === fullUrl);
        if (existing && (Date.now() - existing.timestamp) < CACHE_TTL) {
          return fullUrl || '';
        }
      }

      // Create loading promise
      const loadPromise = this.addToCache(fullUrl || '');
      this.loadingPromises.set(relativeUrl, loadPromise);

      const result = await loadPromise;
      this.loadingPromises.delete(relativeUrl);
      return result;
    } catch (error) {
      console.error('Error caching video URL:', error);
      this.loadingPromises.delete(relativeUrl);
      return getFileUrl(relativeUrl) || '';
    }
  }

  /**
   * Add URL to cache index
   */
  private async addToCache(url: string): Promise<string> {
    try {
      if (!this.cacheIndex) {
        this.cacheIndex = { entries: [], lastCleaned: Date.now() };
      }

      // Remove if already exists
      this.cacheIndex.entries = this.cacheIndex.entries.filter(e => e.url !== url);

      // Add new entry at the beginning
      this.cacheIndex.entries.unshift({
        url,
        timestamp: Date.now()
      });

      // Keep only MAX_CACHE_SIZE entries
      if (this.cacheIndex.entries.length > MAX_CACHE_SIZE) {
        this.cacheIndex.entries = this.cacheIndex.entries.slice(0, MAX_CACHE_SIZE);
      }

      // Save to AsyncStorage
      await AsyncStorage.setItem('video_cache_index', JSON.stringify(this.cacheIndex));

      return url;
    } catch (error) {
      console.error('Error adding URL to cache:', error);
      return url;
    }
  }

  /**
   * Clean expired cache entries
   */
  private async cleanExpiredCache(): Promise<void> {
    try {
      if (!this.cacheIndex) return;

      const now = Date.now();
      const activeEntries = this.cacheIndex.entries.filter(
        entry => (now - entry.timestamp) < CACHE_TTL
      );

      if (activeEntries.length < this.cacheIndex.entries.length) {
        this.cacheIndex.entries = activeEntries;
        await AsyncStorage.setItem('video_cache_index', JSON.stringify(this.cacheIndex));
      }

      this.cacheIndex.lastCleaned = now;
    } catch (error) {
      console.error('Error cleaning cache:', error);
    }
  }

  /**
   * Prefetch a batch of videos for smooth scrolling
   */
  async prefetchVideos(urls: string[], batchSize = 3): Promise<void> {
    if (!urls || urls.length === 0) return;

    try {
      // Batch load videos to avoid overwhelming the network
      for (let i = 0; i < urls.length; i += batchSize) {
        const batch = urls.slice(i, i + batchSize);
        await Promise.all(
          batch.map(url => this.cacheVideoUrl(url).catch(() => null))
        );
        // Small delay between batches to avoid congestion
        if (i + batchSize < urls.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    } catch (error) {
      console.error('Error prefetching videos:', error);
    }
  }

  /**
   * Clear the entire cache
   */
  async clearCache(): Promise<void> {
    try {
      this.cacheIndex = { entries: [], lastCleaned: Date.now() };
      await AsyncStorage.setItem('video_cache_index', JSON.stringify(this.cacheIndex));
      this.loadingPromises.clear();
    } catch (error) {
      console.error('Error clearing cache:', error);
    }
  }

  /**
   * Get cache stats for debugging
   */
  getCacheStats(): { size: number; entries: number; oldestEntry?: Date } {
    if (!this.cacheIndex || this.cacheIndex.entries.length === 0) {
      return { size: 0, entries: 0 };
    }

    const oldestEntry = this.cacheIndex.entries[this.cacheIndex.entries.length - 1];
    return {
      size: this.cacheIndex.entries.length,
      entries: this.cacheIndex.entries.length,
      oldestEntry: oldestEntry ? new Date(oldestEntry.timestamp) : undefined
    };
  }
}

// Export singleton instance
export const videoCacheManager = new VideoCacheManager();
