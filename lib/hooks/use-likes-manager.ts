import { useEffect, useRef, useCallback } from 'react';
import { useAppDispatch, useAppSelector } from '@/lib/store/hooks';
import { 
  setLikedPosts, 
  setPostLikeCounts, 
  addLikedPost, 
  removeLikedPost, 
  setPostLikeCount 
} from '@/lib/store/slices/likesSlice';
import { likesApi } from '@/lib/api';

/**
 * Efficient Like Manager Hook - TikTok-style batch checking
 * 
 * Features:
 * - Batch like-status fetching every 400ms
 * - Optimistic UI updates
 * - Minimal API traffic
 * - Smooth scrolling like detection,
 */
export const useLikesManager = () => {
  const dispatch = useAppDispatch();
  const likedPosts = useAppSelector(state => state.likes.likedPosts);
  const postLikeCounts = useAppSelector(state => state.likes.postLikeCounts);
  
  // Queue of post IDs that need like status checking
  const pendingPostIds = useRef<string[]>([]);
  const checkedPostIds = useRef<Set<string>>(new Set());
  // Track posts with pending optimistic updates to prevent batch check overwrites
  const pendingTogglePostIds = useRef<Set<string>>(new Set());

  /**
   * Add post to batch fetch queue when it becomes visible
   */
  const onPostVisible = useCallback((postId: string) => {
    // Skip if already checked
    if (checkedPostIds.current.has(postId)) {
      return;
    }

    // Skip if there's a pending toggle (optimistic update in progress)
    if (pendingTogglePostIds.current.has(postId)) {
      return;
    }

    // Skip if already in queue
    if (pendingPostIds.current.includes(postId)) {
      return;
    }

    // Add to queue
    pendingPostIds.current.push(postId);
  }, []);

  /**
   * Batch fetch like status every 400ms
   */
  useEffect(() => {
    const interval = setInterval(async () => {
      if (pendingPostIds.current.length === 0) return;

      // Get batch and clear queue
      const batch = [...pendingPostIds.current];
      pendingPostIds.current = [];

      try {
        // Fetch batch status from server
        const response = await likesApi.batchCheckStatus(batch);

        if (response.status === 'success' && response.data) {
          const liked: string[] = [];
          const counts: Record<string, number> = {};
          const returnedPostIds = new Set<string>();

          // Process response - backend omits non-existent posts
          Object.entries(response.data).forEach(([postId, info]: [string, any]) => {
            // Skip posts with pending optimistic updates
            if (pendingTogglePostIds.current.has(postId)) {
              return;
            }

            if (info && typeof info === 'object' && 'isLiked' in info && 'likeCount' in info) {
              returnedPostIds.add(postId);
              if (info.isLiked) {
                liked.push(postId);
              }
              counts[postId] = info.likeCount || 0;
              checkedPostIds.current.add(postId);
            }
          });

          // Mark posts not in response as checked (they don't exist or were omitted)
          // Skip posts with pending optimistic updates
          batch.forEach(postId => {
            if (pendingTogglePostIds.current.has(postId)) {
              return;
            }
            if (!returnedPostIds.has(postId)) {
              checkedPostIds.current.add(postId);
              // Set default values for non-existent posts
              counts[postId] = 0;
            }
          });

          // Update Redux store - merge with existing liked posts
          // Add new liked posts that aren't already in the list
          if (liked.length > 0) {
            liked.forEach(postId => {
              if (!likedPosts.includes(postId)) {
                dispatch(addLikedPost(postId));
              }
            });
          }

          // Update like counts
          if (Object.keys(counts).length > 0) {
            Object.entries(counts).forEach(([postId, count]) => {
              dispatch(setPostLikeCount({ postId, count }));
            });
          }
        }
      } catch (error: any) {
        const { isNetworkError } = require('@/lib/utils/network-error-handler');
        
        const isNetwork = isNetworkError(error);
        if (isNetwork) {
          console.warn('⚠️ Network error checking like status - will retry later');
          // Don't mark as checked for network errors - allow retry
          // Put posts back in queue for next attempt
          pendingPostIds.current.push(...batch);
        } else {
          console.error('❌ Batch like status fetch error:', error);
          // Mark all posts in batch as checked to avoid infinite retry loops
          // They'll be re-checked on refresh anyway
          batch.forEach(postId => {
            checkedPostIds.current.add(postId);
          });
        }
      }
    }, 400); // Check every 400ms

    return () => clearInterval(interval);
  }, [dispatch, likedPosts]);

  /**
   * Optimistic toggle like - Simple and straightforward (KISS)
   */
  const toggleLike = useCallback(async (postId: string) => {
    // Mark as pending to prevent batch check overwrites
    pendingTogglePostIds.current.add(postId);
    
    // Get current state from Redux selectors (fresh on each call)
    const currentIsLiked = likedPosts.includes(postId);
    const currentCount = postLikeCounts[postId] || 0;

    const newIsLiked = !currentIsLiked;
    const newCount = newIsLiked 
      ? currentCount + 1
      : Math.max(0, currentCount - 1);

    // Optimistic update - update immediately using Redux actions
    if (newIsLiked) {
      dispatch(addLikedPost(postId));
    } else {
      dispatch(removeLikedPost(postId));
    }
    dispatch(setPostLikeCount({ postId, count: newCount }));

    // Background API call
    try {
      const response = await likesApi.toggle(postId);
      
      if (response.status === 'success' && response.data) {
        // Update with server response
        const serverIsLiked = response.data.isLiked;
        const serverLikeCount = response.data.likeCount;

        // Sync with server response
        if (serverIsLiked && !likedPosts.includes(postId)) {
          dispatch(addLikedPost(postId));
        } else if (!serverIsLiked && likedPosts.includes(postId)) {
          dispatch(removeLikedPost(postId));
        }
        dispatch(setPostLikeCount({ postId, count: serverLikeCount }));
      } else {
        // Revert on error
        if (currentIsLiked) {
          dispatch(addLikedPost(postId));
        } else {
          dispatch(removeLikedPost(postId));
        }
        dispatch(setPostLikeCount({ postId, count: currentCount }));
      }
    } catch (error) {
      console.error('Toggle like error:', error);
      // Revert on error
      if (currentIsLiked) {
        dispatch(addLikedPost(postId));
      } else {
        dispatch(removeLikedPost(postId));
      }
      dispatch(setPostLikeCount({ postId, count: currentCount }));
    } finally {
      // Remove from pending after a delay to allow server response to process
      setTimeout(() => {
        pendingTogglePostIds.current.delete(postId);
      }, 2000);
    }
  }, [likedPosts, postLikeCounts, dispatch]);

  /**
   * Check if post is liked
   */
  const isLiked = useCallback((postId: string): boolean => {
    return likedPosts.includes(postId);
  }, [likedPosts]);

  /**
   * Get like count for post
   */
  const getLikeCount = useCallback((postId: string): number => {
    return postLikeCounts[postId] || 0;
  }, [postLikeCounts]);

  /**
   * Clear checked cache (useful for refresh)
   */
  const clearCheckedCache = useCallback(() => {
    checkedPostIds.current.clear();
  }, []);

  return {
    onPostVisible,
    toggleLike,
    isLiked,
    getLikeCount,
    clearCheckedCache,
    likedPosts,
    postLikeCounts,
  };
};

