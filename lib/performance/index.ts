/**
 * Performance Optimization Utilities
 * 
 * This module exports all performance-related utilities for the app:
 * - Lazy loading with HOC
 * - Memory-efficient data loading
 * - Optimized components
 * - Cache management
 * 
 * @example
 * import { withSuspense, usePaginatedData, imageCache } from '@/lib/performance';
 */

// HOC for lazy loading
export { 
  withSuspense, 
  createLazyComponent, 
  LoadingIndicator 
} from '../hoc';

// Memory-aware hooks
export { usePaginatedData } from '../hooks/use-paginated-data';
export { useCleanup, useAppStateMemory } from '../hooks/use-cleanup';

// Image cache utilities
export { imageCache, usePrefetchImages } from '../utils/image-cache';

// Re-export types
export type { default as usePaginatedDataReturn } from '../hooks/use-paginated-data';

/**
 * Performance configuration for FlatList
 * Use these presets to configure virtualization based on device capability
 */
export const FLATLIST_MEMORY_PRESETS = {
  /** Low memory devices (< 3GB RAM) */
  low: {
    windowSize: 5,
    initialNumToRender: 5,
    maxToRenderPerBatch: 5,
    updateCellsBatchingPeriod: 50,
    removeClippedSubviews: true,
  },
  /** Standard devices (3-6GB RAM) */
  medium: {
    windowSize: 3,
    initialNumToRender: 3,
    maxToRenderPerBatch: 3,
    updateCellsBatchingPeriod: 100,
    removeClippedSubviews: true,
  },
  /** Memory-constrained mode (for video-heavy feeds) */
  high: {
    windowSize: 2,
    initialNumToRender: 1,
    maxToRenderPerBatch: 1,
    updateCellsBatchingPeriod: 150,
    removeClippedSubviews: true,
  },
} as const;

/**
 * Get recommended FlatList settings based on content type
 */
export const getFlatListSettings = (contentType: 'text' | 'image' | 'video' = 'image') => {
  switch (contentType) {
    case 'video':
      return FLATLIST_MEMORY_PRESETS.high;
    case 'image':
      return FLATLIST_MEMORY_PRESETS.medium;
    case 'text':
      return FLATLIST_MEMORY_PRESETS.low;
    default:
      return FLATLIST_MEMORY_PRESETS.medium;
  }
};

/**
 * Memory optimization tips for React Native:
 * 
 * 1. FlatList Virtualization:
 *    - Always use removeClippedSubviews={true}
 *    - Set appropriate windowSize (lower = less memory)
 *    - Provide getItemLayout for fixed height items
 * 
 * 2. Images:
 *    - Use appropriately sized images (not 4K for thumbnails)
 *    - Implement lazy loading for off-screen images
 *    - Use image caching (expo-image or FastImage)
 * 
 * 3. Videos:
 *    - Only load Video component when visible
 *    - Unload videos when scrolling away
 *    - Use thumbnails for inactive videos
 * 
 * 4. State Management:
 *    - Limit data retained in memory
 *    - Implement pagination with memory limits
 *    - Clean up subscriptions on unmount
 * 
 * 5. Navigation:
 *    - Use lazy loading for screens
 *    - Freeze inactive screens
 *    - Detach screens when appropriate
 */



















