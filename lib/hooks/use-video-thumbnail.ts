import { useState, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

// Safe import of createThumbnail - wrapped to prevent crashes
let createThumbnail: ((options: any) => Promise<{ path: string }>) | null = null;
try {
  const module = require('react-native-create-thumbnail');
  createThumbnail = module.createThumbnail;
} catch (e) {
  if (__DEV__) {
    console.warn('[Thumbnail] react-native-create-thumbnail not available');
  }
}

const THUMBNAIL_CACHE_KEY = '@video_thumbnails_cache_v6';
const CACHE_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — thumbnails persist long
const MAX_CACHE_SIZE = 500;
const GENERATION_TIMEOUT_MS = 15000; // 15 seconds — remote MP4s can be slow, must complete

// Track URLs that have failed to avoid repeated attempts
const failedUrls = new Set<string>();
const generatingUrls = new Set<string>();

interface ThumbnailCache {
  [videoUrl: string]: {
    uri: string;
    timestamp: number;
  };
}

let thumbnailCache: ThumbnailCache = {};
let cacheLoaded = false;

// Load cache from storage
const loadCache = async () => {
  if (cacheLoaded) return;
  try {
    const cached = await AsyncStorage.getItem(THUMBNAIL_CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      const now = Date.now();
      thumbnailCache = {};
      const entries = Object.entries(parsed);
      const validEntries = entries
        .filter(([_, data]) => now - (data as any).timestamp < CACHE_EXPIRY_MS)
        .slice(-MAX_CACHE_SIZE);

      for (const [url, data] of validEntries) {
        thumbnailCache[url] = data as any;
      }

      console.log(`🖼️ [Thumbnail] Cache loaded: ${Object.keys(thumbnailCache).length} cached thumbnails`);
    }
    cacheLoaded = true;
  } catch (error) {
    cacheLoaded = true;
  }
};

// Save cache to storage (debounced)
let saveTimeout: ReturnType<typeof setTimeout> | null = null;
const saveCache = async () => {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(async () => {
    try {
      await AsyncStorage.setItem(THUMBNAIL_CACHE_KEY, JSON.stringify(thumbnailCache));
    } catch (error) {
      // Silently handle
    }
  }, 1000);
};

loadCache();

/**
 * Get cached thumbnail synchronously
 */
export const getCachedThumbnail = (videoUrl: string): string | null => {
  const cached = thumbnailCache[videoUrl];
  if (cached && Date.now() - cached.timestamp < CACHE_EXPIRY_MS) {
    return cached.uri;
  }
  return null;
};

/**
 * Check if a URL is valid for thumbnail generation
 */
const isValidVideoUrl = (url: string): boolean => {
  if (!url) return false;
  if (failedUrls.has(url)) return false;

  // Must be HTTP/HTTPS or file://
  if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('file://')) {
    return false;
  }

  // For thumbnail generation, we need a direct video file — NOT .m3u8 (HLS can't be thumbnailed)
  const videoExtensions = ['.mp4', '.mov', '.webm', '.m4v', '.avi', '.3gp'];
  const urlLower = url.toLowerCase().split('?')[0]; // Remove query params
  return videoExtensions.some(ext => urlLower.endsWith(ext) || urlLower.includes(ext));
};

/**
 * Generate thumbnail with timeout and safe error handling
 */
const generateThumbnailSafe = async (
  videoUrl: string,
  timeStamp: number = 1000
): Promise<string | null> => {
  if (!createThumbnail) {
    console.log('🖼️ [Thumbnail] ⚠️ createThumbnail library not available — cannot generate');
    return null;
  }

  if (!isValidVideoUrl(videoUrl)) {
    console.log(`🖼️ [Thumbnail] ⛔ Invalid URL for generation (not a direct video file): ${videoUrl.substring(0, 80)}`);
    return null;
  }

  if (generatingUrls.has(videoUrl)) {
    // Already generating, don't start another
    return null;
  }

  generatingUrls.add(videoUrl);
  const startTime = Date.now();
  console.log(`🖼️ [Thumbnail] 🔄 GENERATING for: ${videoUrl.substring(0, 80)}...`);

  try {
    // Race between generation and timeout
    const result = await Promise.race([
      createThumbnail({
        url: videoUrl,
        timeStamp: timeStamp,
        format: 'jpeg',
        quality: 80,
        cacheName: `thumb_${hashCode(videoUrl)}`,
      }),
      new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error('TIMEOUT')), GENERATION_TIMEOUT_MS)
      ),
    ]);

    if (result?.path) {
      const uri = Platform.OS === 'android' ? `file://${result.path}` : result.path;
      const elapsed = Date.now() - startTime;

      // Cache the result
      thumbnailCache[videoUrl] = {
        uri,
        timestamp: Date.now(),
      };
      saveCache();

      console.log(`🖼️ [Thumbnail] ✅ COMPLETE in ${elapsed}ms: ${videoUrl.substring(0, 50)}...`);

      generatingUrls.delete(videoUrl);
      return uri;
    }
  } catch (error: any) {
    const elapsed = Date.now() - startTime;
    if (error?.message === 'TIMEOUT') {
      console.warn(`🖼️ [Thumbnail] ⏰ TIMEOUT after ${elapsed}ms — will retry later: ${videoUrl.substring(0, 50)}...`);
    } else {
      console.warn(`🖼️ [Thumbnail] ❌ FAILED in ${elapsed}ms: ${error?.message?.substring(0, 100)}`);
      failedUrls.add(videoUrl); // Only blacklist real failures, NOT timeouts
    }
  }

  generatingUrls.delete(videoUrl);
  return null;
};

/**
 * Hook to generate and cache video thumbnails
 * Returns { thumbnailUri, isLoading }
 * 
 * @param videoUrl - The video URL (must be direct MP4/MOV, NOT .m3u8)
 * @param fallbackUrl - Fallback image URL if thumbnail generation fails
 * @param timeStamp - Time in milliseconds to extract thumbnail (default: 1000)
 */
export const useVideoThumbnail = (
  videoUrl: string | null | undefined,
  fallbackUrl?: string | null,
  timeStamp: number = 1000
): { thumbnailUri: string | null; isLoading: boolean } => {
  const [thumbnailUri, setThumbnailUri] = useState<string | null>(() => {
    // Check cache synchronously on first render
    if (videoUrl) {
      const cached = getCachedThumbnail(videoUrl);
      if (cached) return cached;
    }
    return fallbackUrl || null;
  });

  const [isLoading, setIsLoading] = useState(() => {
    // Loading if we have a videoUrl but no cached thumbnail
    if (videoUrl && createThumbnail && isValidVideoUrl(videoUrl)) {
      return !getCachedThumbnail(videoUrl);
    }
    return false;
  });

  const mounted = useRef(true);
  const generationAttempted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    // Reset generation flag when URL changes
    generationAttempted.current = false;
  }, [videoUrl]);

  useEffect(() => {
    if (!videoUrl) {
      setThumbnailUri(fallbackUrl || null);
      setIsLoading(false);
      return;
    }

    // Check cache first
    const cached = getCachedThumbnail(videoUrl);
    if (cached) {
      setThumbnailUri(cached);
      setIsLoading(false);
      return;
    }

    // If no thumbnail library or invalid URL, use fallback immediately
    if (!createThumbnail || !isValidVideoUrl(videoUrl)) {
      if (fallbackUrl) {
        setThumbnailUri(fallbackUrl);
      }
      setIsLoading(false);
      return;
    }

    // Skip if already attempted for this URL
    if (generationAttempted.current) {
      return;
    }
    generationAttempted.current = true;
    setIsLoading(true);

    // 5 second hard cutoff — stop loading even if generation hasn't finished
    const loadingTimeout = setTimeout(() => {
      if (mounted.current) {
        setIsLoading(false);
        if (fallbackUrl && !thumbnailUri) {
          setThumbnailUri(fallbackUrl);
        }
      }
    }, GENERATION_TIMEOUT_MS);

    // Generate thumbnail immediately (no waiting for interactions)
    (async () => {
      const generated = await generateThumbnailSafe(videoUrl, timeStamp);

      if (mounted.current) {
        if (generated) {
          setThumbnailUri(generated);
        } else if (fallbackUrl) {
          setThumbnailUri(fallbackUrl);
        }
        setIsLoading(false);
        clearTimeout(loadingTimeout);
      }
    })();

    return () => {
      clearTimeout(loadingTimeout);
    };
  }, [videoUrl, fallbackUrl, timeStamp]);

  return { thumbnailUri, isLoading };
};

/**
 * Generate thumbnail for a video URL (standalone function for grid cards)
 */
export const generateVideoThumbnail = async (
  videoUrl: string,
  timeStamp: number = 1000
): Promise<string | null> => {
  // Check cache first
  const cached = getCachedThumbnail(videoUrl);
  if (cached) return cached;

  return generateThumbnailSafe(videoUrl, timeStamp);
};

/**
 * Pre-generate thumbnails for multiple videos (for grids)
 */
export const pregenerateThumbnails = async (
  videoUrls: string[],
  timeStamp: number = 1000
): Promise<void> => {
  const uncachedUrls = videoUrls.filter(url =>
    url && !getCachedThumbnail(url) && isValidVideoUrl(url) && !failedUrls.has(url)
  );

  if (uncachedUrls.length === 0) return;

  console.log(`🖼️ [Thumbnail] Pre-generating ${uncachedUrls.length} thumbnails...`);

  // Process in small batches
  const batchSize = 3;
  for (let i = 0; i < Math.min(uncachedUrls.length, 20); i += batchSize) {
    const batch = uncachedUrls.slice(i, i + batchSize);
    await Promise.allSettled(
      batch.map(url => generateThumbnailSafe(url, timeStamp))
    );
    await new Promise(resolve => setTimeout(resolve, 50));
  }
};

/**
 * Clear thumbnail cache
 */
export const clearThumbnailCache = async () => {
  thumbnailCache = {};
  failedUrls.clear();
  generatingUrls.clear();
  try {
    await AsyncStorage.removeItem(THUMBNAIL_CACHE_KEY);
  } catch (error) {
    // Silently handle
  }
};

/**
 * Simple hash function for cache names
 */
const hashCode = (str: string): string => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
};

export default useVideoThumbnail;
