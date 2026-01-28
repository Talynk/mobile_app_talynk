import { useState, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform, InteractionManager } from 'react-native';

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

const THUMBNAIL_CACHE_KEY = '@video_thumbnails_cache_v5';
const CACHE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_CACHE_SIZE = 200;
const GENERATION_TIMEOUT_MS = 15000; // 15 second timeout

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

      if (__DEV__) {
        console.log(`✅ [Thumbnail] Loaded ${Object.keys(thumbnailCache).length} cached thumbnails`);
      }
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
  }, 2000);
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

  // Check for common video extensions
  const videoExtensions = ['.mp4', '.mov', '.webm', '.m4v', '.avi', '.3gp'];
  const urlLower = url.toLowerCase();
  return videoExtensions.some(ext => urlLower.includes(ext));
};

/**
 * Generate thumbnail with timeout and safe error handling
 */
const generateThumbnailSafe = async (
  videoUrl: string,
  timeStamp: number = 1000
): Promise<string | null> => {
  if (!createThumbnail) {
    if (__DEV__) {
      console.log('⚠️ [Thumbnail] createThumbnail not available');
    }
    return null;
  }

  if (!isValidVideoUrl(videoUrl)) {
    return null;
  }

  if (generatingUrls.has(videoUrl)) {
    // Already generating, don't start another
    return null;
  }

  generatingUrls.add(videoUrl);

  try {
    if (__DEV__) {
      console.log('🎬 [Thumbnail] Generating:', videoUrl.substring(0, 60) + '...');
    }

    // Create a promise for generation
    const result = await createThumbnail({
      url: videoUrl,
      timeStamp: timeStamp,
      format: 'jpeg',
      quality: 80,
      cacheName: `thumb_${hashCode(videoUrl)}`,
    });

    if (result?.path) {
      const uri = Platform.OS === 'android' ? `file://${result.path}` : result.path;

      // Cache the result
      thumbnailCache[videoUrl] = {
        uri,
        timestamp: Date.now(),
      };
      saveCache();

      if (__DEV__) {
        console.log('✅ [Thumbnail] Generated successfully:', videoUrl.substring(0, 40) + '...');
      }

      generatingUrls.delete(videoUrl);
      return uri;
    }
  } catch (error: any) {
    // Log error but don't crash
    failedUrls.add(videoUrl);
    if (__DEV__) {
      console.warn('⚠️ [Thumbnail] Failed (will use fallback):', error?.message?.substring(0, 100));
    }
  }

  generatingUrls.delete(videoUrl);
  return null;
};

/**
 * Hook to generate and cache video thumbnails
 * Uses react-native-create-thumbnail with safe error handling
 * 
 * @param videoUrl - The video URL (remote or local)
 * @param fallbackUrl - Fallback image URL if thumbnail generation fails
 * @param timeStamp - Time in milliseconds to extract thumbnail (default: 1000)
 */
export const useVideoThumbnail = (
  videoUrl: string | null | undefined,
  fallbackUrl?: string | null,
  timeStamp: number = 1000
): string | null => {
  const [thumbnailUri, setThumbnailUri] = useState<string | null>(() => {
    // Check cache synchronously on first render
    if (videoUrl) {
      const cached = getCachedThumbnail(videoUrl);
      if (cached) return cached;
    }
    return fallbackUrl || null;
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
      return;
    }

    // Check cache first
    const cached = getCachedThumbnail(videoUrl);
    if (cached) {
      setThumbnailUri(cached);
      return;
    }

    // If no thumbnail library or invalid URL, use fallback
    if (!createThumbnail || !isValidVideoUrl(videoUrl)) {
      setThumbnailUri(fallbackUrl || null);
      return;
    }

    // Skip if already attempted for this URL
    if (generationAttempted.current) {
      return;
    }
    generationAttempted.current = true;

    // Use fallback while generating
    if (fallbackUrl) {
      setThumbnailUri(fallbackUrl);
    }

    // Generate thumbnail after interactions settle (prevents UI jank)
    InteractionManager.runAfterInteractions(async () => {
      if (!mounted.current) return;

      const generated = await generateThumbnailSafe(videoUrl, timeStamp);

      if (mounted.current && generated) {
        setThumbnailUri(generated);
      }
    });
  }, [videoUrl, fallbackUrl, timeStamp]);

  return thumbnailUri;
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

  if (__DEV__) {
    console.log(`📦 [Thumbnail] Pre-generating ${uncachedUrls.length} thumbnails...`);
  }

  // Process in small batches to avoid overwhelming the system
  const batchSize = 2;
  for (let i = 0; i < Math.min(uncachedUrls.length, 10); i += batchSize) {
    const batch = uncachedUrls.slice(i, i + batchSize);
    await Promise.allSettled(
      batch.map(url => generateThumbnailSafe(url, timeStamp))
    );
    // Small delay between batches
    await new Promise(resolve => setTimeout(resolve, 100));
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
