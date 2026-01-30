import { useEffect, useRef, useState } from 'react';
import { getPostMediaUrl } from '@/lib/utils/file-url';
import { Post } from '@/types';

interface PreloadConfig {
  preloadCount?: number;
  backwardCount?: number;
  enabled?: boolean;
  direction?: 'forward' | 'backward' | 'both';
}

/**
 * MUX SLOP SOCIAL STYLE: Pure streaming video preloader
 * 
 * NO FILE DOWNLOADS - videos stream directly from network
 * Native player (ExoPlayer/AVPlayer) handles buffering automatically
 * 
 * This approach:
 * - Uses minimal data (only buffers what's being watched)
 * - Prevents memory issues and app freezes
 * - Works exactly like Instagram/TikTok
 */
export const useVideoPreload = (
  posts: Post[],
  activeIndex: number,
  config: PreloadConfig = {}
) => {
  const {
    preloadCount = 5,    // 5 ahead in scroll direction
    backwardCount = 1,   // 1 behind for back-scroll
    enabled = true,
    direction = 'both'
  } = config;

  /**
   * STREAMING: Return remote URL directly
   * Native video player buffers from network automatically
   */
  const getCachedUri = (remoteUrl: string | null): string | null => {
    if (!remoteUrl) return null;
    return remoteUrl; // Stream directly
  };

  /**
   * Check if URL would be preloaded (for debugging)
   */
  const isCached = (url: string): boolean => {
    return !!url; // Always "cached" since we stream directly
  };

  return {
    cachedUrls: {}, // Not used in streaming mode
    getCachedUri,
    isCached,
    preloadedCount: 0, // No file caching
  };
};

/**
 * Utility to get remote URL (streaming mode)
 */
export const getCachedVideoUri = async (url: string): Promise<string | null> => {
  return url; // Return remote URL directly
};

export const isVideoCached = (url: string): boolean => {
  return false; // No file caching in streaming mode
};

