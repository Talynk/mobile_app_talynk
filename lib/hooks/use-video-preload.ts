import { useEffect, useRef } from 'react';
import { getPostMediaUrl } from '@/lib/utils/file-url';
import { Post } from '@/types';

interface PreloadConfig {
  preloadCount?: number; // Number of videos to preload ahead (default: 3)
  enabled?: boolean; // Whether preloading is enabled (default: true)
  chunkSize?: number; // Size of video chunk to preload in bytes (default: 800KB)
  direction?: 'forward' | 'backward' | 'both'; // Preload direction (default: 'forward')
}

interface PreloadedVideo {
  url: string;
  blob: Blob;
  timestamp: number;
}

/**
 * Hook to aggressively preload videos ahead of the current playing video
 * Downloads the first chunk of video data (default 800KB) for instant playback
 * 
 * @param posts - Array of posts
 * @param activeIndex - Current active video index
 * @param config - Preload configuration
 */
export const useVideoPreload = (
  posts: Post[],
  activeIndex: number,
  config: PreloadConfig = {}
) => {
  const {
    preloadCount = 3,
    enabled = true,
    chunkSize = 800 * 1024, // 800KB default
    direction = 'forward'
  } = config;

  const preloadedVideosRef = useRef<Map<string, PreloadedVideo>>(new Map());
  const preloadControllersRef = useRef<Map<string, AbortController>>(new Map());
  const lastActiveIndexRef = useRef(activeIndex);

  // Cleanup old cache entries (older than 3 minutes)
  const cleanupOldCache = () => {
    const now = Date.now();
    const maxAge = 3 * 60 * 1000; // 3 minutes

    preloadedVideosRef.current.forEach((video, url) => {
      if (now - video.timestamp > maxAge) {
        preloadedVideosRef.current.delete(url);
        if (__DEV__) {
          console.log('🧹 [Preload] Cleaned up old cache:', url.substring(0, 50) + '...');
        }
      }
    });
  };

  // Cancel preload for a specific URL
  const cancelPreload = (url: string) => {
    const controller = preloadControllersRef.current.get(url);
    if (controller) {
      controller.abort();
      preloadControllersRef.current.delete(url);
      if (__DEV__) {
        console.log('❌ [Preload] Cancelled:', url.substring(0, 50) + '...');
      }
    }
  };

  // Preload a single video chunk
  const preloadVideoChunk = async (url: string, priority: number): Promise<boolean> => {
    // Skip if already preloaded
    if (preloadedVideosRef.current.has(url)) {
      if (__DEV__) {
        console.log('✅ [Preload] Already cached:', url.substring(0, 50) + '...');
      }
      return true;
    }

    // Skip if already preloading
    if (preloadControllersRef.current.has(url)) {
      return false;
    }

    try {
      const controller = new AbortController();
      preloadControllersRef.current.set(url, controller);

      if (__DEV__) {
        console.log(`📥 [Preload] Starting (priority ${priority}):`, url.substring(0, 50) + '...');
      }

      // Try Range request first (for partial content)
      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'Range': `bytes=0-${chunkSize - 1}`,
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      });

      // Accept both 206 (Partial Content) and 200 (Full Content)
      if (response.ok || response.status === 206) {
        const blob = await response.blob();

        preloadedVideosRef.current.set(url, {
          url,
          blob,
          timestamp: Date.now(),
        });

        if (__DEV__) {
          const sizeKB = Math.round(blob.size / 1024);
          console.log(`✅ [Preload] Success (${sizeKB}KB):`, url.substring(0, 50) + '...');
        }

        preloadControllersRef.current.delete(url);
        return true;
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error: any) {
      preloadControllersRef.current.delete(url);

      // Don't log aborted requests (user scrolled away)
      if (error.name !== 'AbortError') {
        if (__DEV__) {
          console.warn('⚠️ [Preload] Failed:', url.substring(0, 50) + '...', error.message);
        }
      }
      return false;
    }
  };

  useEffect(() => {
    if (!enabled || !posts.length || activeIndex < 0) return;

    const preloadVideos = async () => {
      // Determine which videos to preload based on direction
      const videosToPreload: { post: Post; url: string; priority: number }[] = [];

      // Forward preloading (next N videos)
      if (direction === 'forward' || direction === 'both') {
        for (let i = 1; i <= preloadCount && activeIndex + i < posts.length; i++) {
          const post = posts[activeIndex + i];
          const mediaUrl = getPostMediaUrl(post);

          if (!mediaUrl) continue;

          const isVideo =
            post.type === 'video' ||
            (mediaUrl !== null &&
              (mediaUrl.toLowerCase().includes('.mp4') ||
                mediaUrl.toLowerCase().includes('.mov') ||
                mediaUrl.toLowerCase().includes('.webm')));

          if (isVideo) {
            videosToPreload.push({
              post,
              url: mediaUrl,
              priority: i, // Lower number = higher priority
            });
          }
        }
      }

      // Backward preloading (previous video for back-scroll)
      if (direction === 'backward' || direction === 'both') {
        if (activeIndex > 0) {
          const post = posts[activeIndex - 1];
          const mediaUrl = getPostMediaUrl(post);

          if (mediaUrl) {
            const isVideo =
              post.type === 'video' ||
              (mediaUrl !== null &&
                (mediaUrl.toLowerCase().includes('.mp4') ||
                  mediaUrl.toLowerCase().includes('.mov') ||
                  mediaUrl.toLowerCase().includes('.webm')));

            if (isVideo) {
              videosToPreload.push({
                post,
                url: mediaUrl,
                priority: 99, // Lower priority than forward
              });
            }
          }
        }
      }

      // Cancel preloads for videos that are now too far away
      const maxDistance = preloadCount + 2;
      preloadControllersRef.current.forEach((controller, url) => {
        const videoIndex = posts.findIndex(p => getPostMediaUrl(p) === url);
        if (videoIndex !== -1) {
          const distance = Math.abs(videoIndex - activeIndex);
          if (distance > maxDistance) {
            cancelPreload(url);
          }
        }
      });

      // Sort by priority and preload
      videosToPreload.sort((a, b) => a.priority - b.priority);

      // Preload in sequence (highest priority first)
      for (const { url, priority } of videosToPreload) {
        await preloadVideoChunk(url, priority);
      }

      // Cleanup old cache entries
      cleanupOldCache();
    };

    preloadVideos();

    lastActiveIndexRef.current = activeIndex;
  }, [posts, activeIndex, preloadCount, enabled, chunkSize, direction]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Cancel all ongoing preloads
      preloadControllersRef.current.forEach((controller) => {
        controller.abort();
      });
      preloadControllersRef.current.clear();
      preloadedVideosRef.current.clear();

      if (__DEV__) {
        console.log('🧹 [Preload] Cleanup on unmount');
      }
    };
  }, []);

  // Return preload stats for debugging
  return {
    preloadedCount: preloadedVideosRef.current.size,
    activePreloads: preloadControllersRef.current.size,
  };
};

/**
 * Utility function to preload a specific video URL
 * Useful for manual preloading outside of the hook
 */
export const preloadVideoUrl = async (
  url: string,
  chunkSize: number = 800 * 1024
): Promise<boolean> => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'Range': `bytes=0-${chunkSize - 1}`,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });

    clearTimeout(timeoutId);

    if (response.ok || response.status === 206) {
      await response.blob(); // Download the chunk
      return true;
    }

    return false;
  } catch (error) {
    return false;
  }
};
