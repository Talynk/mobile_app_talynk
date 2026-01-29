import { useEffect, useRef, useState } from 'react';
import { getPostMediaUrl } from '@/lib/utils/file-url';
import { Post } from '@/types';
import { getCachedVideoUri, isVideoCached, preloadVideos, initVideoCache } from '@/lib/utils/video-cache';

interface PreloadConfig {
  preloadCount?: number; // Number of videos to preload ahead (default: 8)
  backwardCount?: number; // Number of videos to keep cached behind (default: 3)
  enabled?: boolean; // Whether preloading is enabled (default: true)
  direction?: 'forward' | 'backward' | 'both'; // Preload direction (default: 'both')
}

interface CachedVideoMap {
  [remoteUrl: string]: string; // remoteUrl -> localPath
}

/**
 * Hook for aggressive video preloading with FileSystem caching
 * Downloads entire videos to local storage for instant playback
 * 
 * @param posts - Array of posts
 * @param activeIndex - Current active video index
 * @param config - Preload configuration
 * @returns Object with cached URLs mapping and cache status
 */
export const useVideoPreload = (
  posts: Post[],
  activeIndex: number,
  config: PreloadConfig = {}
) => {
  const {
    preloadCount = 8, // Instagram-style: preload 8 videos ahead for instant playback
    backwardCount = 3, // Keep 3 behind for instant back-scroll
    enabled = true,
    direction = 'both' // Changed to 'both' for instant back-scroll
  } = config;

  const [cachedUrls, setCachedUrls] = useState<CachedVideoMap>({});
  const lastActiveIndexRef = useRef(activeIndex);
  const isPreloadingRef = useRef(false);

  // Initialize cache on mount
  useEffect(() => {
    initVideoCache();
  }, []);

  useEffect(() => {
    if (!enabled || !posts.length || activeIndex < 0) return;

    const preloadNearbyVideos = async () => {
      if (isPreloadingRef.current) return;
      isPreloadingRef.current = true;

      try {
        const videosToPreload: { url: string; priority: number }[] = [];

        // Forward preloading (next N videos) - PRIORITY
        if (direction === 'forward' || direction === 'both') {
          for (let i = 1; i <= preloadCount && activeIndex + i < posts.length; i++) {
            const post = posts[activeIndex + i];
            const mediaUrl = getPostMediaUrl(post);

            if (!mediaUrl) continue;

            const isVideo =
              post.type === 'video' ||
              (mediaUrl.toLowerCase().includes('.mp4') ||
                mediaUrl.toLowerCase().includes('.mov') ||
                mediaUrl.toLowerCase().includes('.webm'));

            if (isVideo && !isVideoCached(mediaUrl)) {
              videosToPreload.push({ url: mediaUrl, priority: i });
            }
          }
        }

        // Backward preloading (previous videos for back-scroll)
        if (direction === 'backward' || direction === 'both') {
          for (let i = 1; i <= backwardCount && activeIndex - i >= 0; i++) {
            const post = posts[activeIndex - i];
            const mediaUrl = getPostMediaUrl(post);

            if (!mediaUrl) continue;

            const isVideo =
              post.type === 'video' ||
              (mediaUrl.toLowerCase().includes('.mp4') ||
                mediaUrl.toLowerCase().includes('.mov') ||
                mediaUrl.toLowerCase().includes('.webm'));

            if (isVideo && !isVideoCached(mediaUrl)) {
              videosToPreload.push({ url: mediaUrl, priority: 99 + i });
            }
          }
        }

        // Sort by priority and preload
        videosToPreload.sort((a, b) => a.priority - b.priority);

        // Preload in parallel batches for faster caching (Instagram-style)
        const PARALLEL_BATCH_SIZE = 3;
        for (let i = 0; i < videosToPreload.length; i += PARALLEL_BATCH_SIZE) {
          const batch = videosToPreload.slice(i, i + PARALLEL_BATCH_SIZE);
          const results = await Promise.all(
            batch.map(async ({ url }) => {
              const cachedPath = await getCachedVideoUri(url);
              return { url, cachedPath };
            })
          );

          const newCached: CachedVideoMap = {};
          for (const { url, cachedPath } of results) {
            if (cachedPath) {
              newCached[url] = cachedPath;
            }
          }
          if (Object.keys(newCached).length > 0) {
            setCachedUrls(prev => ({ ...prev, ...newCached }));
          }
        }

        // Also cache current video if not cached
        const currentPost = posts[activeIndex];
        const currentUrl = getPostMediaUrl(currentPost);
        if (currentUrl && !cachedUrls[currentUrl]) {
          const isVideo =
            currentPost.type === 'video' ||
            (currentUrl.toLowerCase().includes('.mp4') ||
              currentUrl.toLowerCase().includes('.mov') ||
              currentUrl.toLowerCase().includes('.webm'));

          if (isVideo) {
            const cachedPath = await getCachedVideoUri(currentUrl);
            if (cachedPath) {
              setCachedUrls(prev => ({ ...prev, [currentUrl]: cachedPath }));
            }
          }
        }
      } catch (error) {
        console.error('[Preload] Error:', error);
      } finally {
        isPreloadingRef.current = false;
      }
    };

    preloadNearbyVideos();
    lastActiveIndexRef.current = activeIndex;
  }, [posts, activeIndex, preloadCount, enabled, direction]);

  /**
   * Get cached local URI for a remote URL
   * Returns the local file:// path if cached, otherwise the remote URL
   */
  const getCachedUri = (remoteUrl: string | null): string | null => {
    if (!remoteUrl) return null;
    return cachedUrls[remoteUrl] || remoteUrl;
  };

  /**
   * Check if a URL is cached
   */
  const isCached = (url: string): boolean => {
    return !!cachedUrls[url] || isVideoCached(url);
  };

  return {
    cachedUrls,
    getCachedUri,
    isCached,
    preloadedCount: Object.keys(cachedUrls).length,
  };
};

/**
 * Utility function to preload specific video URLs
 */
export const preloadVideoUrls = preloadVideos;

/**
 * Utility to get cached URI (can be used outside hook)
 */
export { getCachedVideoUri, isVideoCached };
