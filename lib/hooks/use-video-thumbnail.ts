import { useState, useEffect, useRef } from 'react';
import * as VideoThumbnails from 'expo-video-thumbnails';
import AsyncStorage from '@react-native-async-storage/async-storage';

const THUMBNAIL_CACHE_KEY = '@video_thumbnails_cache';
const CACHE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface ThumbnailCache {
  [videoUrl: string]: {
    uri: string;
    timestamp: number;
  };
}

let thumbnailCache: ThumbnailCache = {};

// Load cache from storage
const loadCache = async () => {
  try {
    const cached = await AsyncStorage.getItem(THUMBNAIL_CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      // Clean expired entries
      const now = Date.now();
      thumbnailCache = {};
      for (const [url, data] of Object.entries(parsed)) {
        if (now - (data as any).timestamp < CACHE_EXPIRY_MS) {
          thumbnailCache[url] = data as any;
        }
      }
    }
  } catch (error) {
    console.warn('[Thumbnail] Failed to load cache:', error);
  }
};

// Save cache to storage
const saveCache = async () => {
  try {
    await AsyncStorage.setItem(THUMBNAIL_CACHE_KEY, JSON.stringify(thumbnailCache));
  } catch (error) {
    console.warn('[Thumbnail] Failed to save cache:', error);
  }
};

// Initialize cache on module load
loadCache();

/**
 * Hook to generate and cache video thumbnails
 * 
 * @param videoUrl - The video URL (remote or local)
 * @param fallbackUrl - Fallback image URL if thumbnail generation fails
 * @param timeStamp - Time in milliseconds to extract thumbnail (default: 1000ms = 1 second)
 * @returns The thumbnail URI or fallback URL
 * 
 * @example
 * const thumbnailUri = useVideoThumbnail(post.video_url, post.image);
 */
export const useVideoThumbnail = (
  videoUrl: string | null | undefined,
  fallbackUrl?: string | null,
  timeStamp: number = 1000
): string | null => {
  const [thumbnailUri, setThumbnailUri] = useState<string | null>(null);
  const isGenerating = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!videoUrl) {
      setThumbnailUri(fallbackUrl || null);
      return;
    }

    // Check cache first
    const cached = thumbnailCache[videoUrl];
    if (cached) {
      setThumbnailUri(cached.uri);
      return;
    }

    // If we have a fallback, show it immediately while generating
    if (fallbackUrl) {
      setThumbnailUri(fallbackUrl);
    }

    // Generate thumbnail
    if (isGenerating.current) return;
    isGenerating.current = true;

    const generateThumbnail = async () => {
      try {
        const { uri } = await VideoThumbnails.getThumbnailAsync(videoUrl, {
          time: timeStamp,
          quality: 0.7, // Balance between quality and file size
        });

        if (mounted.current) {
          // Cache the result
          thumbnailCache[videoUrl] = {
            uri,
            timestamp: Date.now(),
          };
          await saveCache();
          
          setThumbnailUri(uri);
        }
      } catch (error) {
        console.warn('[Thumbnail] Failed to generate thumbnail:', error);
        // Use fallback if generation fails
        if (mounted.current) {
          setThumbnailUri(fallbackUrl || null);
        }
      } finally {
        isGenerating.current = false;
      }
    };

    generateThumbnail();
  }, [videoUrl, fallbackUrl, timeStamp]);

  return thumbnailUri;
};

/**
 * Utility function to pre-generate thumbnails for multiple videos
 * Useful for prefetching thumbnails before they're needed
 */
export const pregenerateThumbnails = async (
  videoUrls: string[],
  timeStamp: number = 1000
): Promise<void> => {
  const uncachedUrls = videoUrls.filter(url => !thumbnailCache[url]);
  
  if (uncachedUrls.length === 0) return;

  // Generate thumbnails in parallel (limit to 5 at a time to avoid overwhelming)
  const batchSize = 5;
  for (let i = 0; i < uncachedUrls.length; i += batchSize) {
    const batch = uncachedUrls.slice(i, i + batchSize);
    await Promise.allSettled(
      batch.map(async (url) => {
        try {
          const { uri } = await VideoThumbnails.getThumbnailAsync(url, {
            time: timeStamp,
            quality: 0.7,
          });
          thumbnailCache[url] = {
            uri,
            timestamp: Date.now(),
          };
        } catch (error) {
          // Silently fail for prefetch
        }
      })
    );
  }

  await saveCache();
};

/**
 * Clear thumbnail cache
 */
export const clearThumbnailCache = async () => {
  thumbnailCache = {};
  try {
    await AsyncStorage.removeItem(THUMBNAIL_CACHE_KEY);
  } catch (error) {
    console.warn('[Thumbnail] Failed to clear cache:', error);
  }
};

export default useVideoThumbnail;


















