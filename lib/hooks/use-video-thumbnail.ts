import { useState, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createThumbnail } from 'react-native-create-thumbnail';
import { Platform } from 'react-native';

const THUMBNAIL_CACHE_KEY = '@video_thumbnails_cache_v2';
const CACHE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_CACHE_SIZE = 100;

interface ThumbnailCache {
    [videoUrl: string]: {
        uri: string;
        timestamp: number;
    };
}

let thumbnailCache: ThumbnailCache = {};
let cacheLoaded = false;
const generatingSet = new Set<string>();

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
 * Hook to generate and cache video thumbnails
 * Uses react-native-create-thumbnail (REQUIRES NATIVE BUILD - NOT EXPO GO)
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
        if (videoUrl) {
            const cached = getCachedThumbnail(videoUrl);
            if (cached) return cached;
        }
        return fallbackUrl || null;
    });
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
        const cached = getCachedThumbnail(videoUrl);
        if (cached) {
            setThumbnailUri(cached);
            return;
        }

        // If already generating, wait
        if (generatingSet.has(videoUrl)) {
            return;
        }

        generatingSet.add(videoUrl);

        const generateThumbnail = async () => {
            try {
                if (__DEV__) {
                    console.log('[Thumbnail] Generating for:', videoUrl.substring(0, 60) + '...');
                }

                const result = await createThumbnail({
                    url: videoUrl,
                    timeStamp: timeStamp,
                    format: 'jpeg',
                    cacheName: `thumb_${hashCode(videoUrl)}`,
                });

                if (mounted.current && result?.path) {
                    const uri = Platform.OS === 'android' ? `file://${result.path}` : result.path;

                    thumbnailCache[videoUrl] = {
                        uri,
                        timestamp: Date.now(),
                    };
                    saveCache();

                    setThumbnailUri(uri);

                    if (__DEV__) {
                        console.log('[Thumbnail] ✅ Generated:', uri.substring(0, 60) + '...');
                    }
                }
            } catch (error: any) {
                if (__DEV__) {
                    console.warn('[Thumbnail] ❌ Failed:', error?.message || error);
                }
                if (mounted.current && !getCachedThumbnail(videoUrl)) {
                    setThumbnailUri(fallbackUrl || null);
                }
            } finally {
                generatingSet.delete(videoUrl);
            }
        };

        generateThumbnail();
    }, [videoUrl, fallbackUrl, timeStamp]);

    return thumbnailUri;
};

/**
 * Generate thumbnail for a video URL (standalone function)
 */
export const generateVideoThumbnail = async (
    videoUrl: string,
    timeStamp: number = 1000
): Promise<string | null> => {
    const cached = getCachedThumbnail(videoUrl);
    if (cached) return cached;

    try {
        const result = await createThumbnail({
            url: videoUrl,
            timeStamp: timeStamp,
            format: 'jpeg',
            cacheName: `thumb_${hashCode(videoUrl)}`,
        });

        if (result?.path) {
            const uri = Platform.OS === 'android' ? `file://${result.path}` : result.path;

            thumbnailCache[videoUrl] = {
                uri,
                timestamp: Date.now(),
            };
            saveCache();

            return uri;
        }
    } catch (error) {
        // Silently fail
    }

    return null;
};

/**
 * Pre-generate thumbnails for multiple videos
 */
export const pregenerateThumbnails = async (
    videoUrls: string[],
    timeStamp: number = 1000
): Promise<void> => {
    const uncachedUrls = videoUrls.filter(url => url && !getCachedThumbnail(url));

    if (uncachedUrls.length === 0) return;

    const batchSize = 3;
    for (let i = 0; i < uncachedUrls.length; i += batchSize) {
        const batch = uncachedUrls.slice(i, i + batchSize);
        await Promise.allSettled(
            batch.map(url => generateVideoThumbnail(url, timeStamp))
        );
    }
};

/**
 * Clear thumbnail cache
 */
export const clearThumbnailCache = async () => {
    thumbnailCache = {};
    try {
        await AsyncStorage.removeItem(THUMBNAIL_CACHE_KEY);
    } catch (error) {
        // Silently handle
    }
};

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
