import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
  useWindowDimensions,
  StatusBar,
  Animated,
  Alert,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { likesApi, followsApi, feedApi } from '@/lib/api';
import { Post } from '@/types';
import { useAuth } from '@/lib/auth-context';
import { useCache } from '@/lib/cache-context';
import { useAppDispatch, useAppSelector } from '@/lib/store/hooks';
import { addLikedPost, removeLikedPost, setPostLikeCount } from '@/lib/store/slices/likesSlice';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaFrame, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFeedQuery } from '@/lib/hooks/use-feed-query';
import { queryClient } from '@/lib/query-client';
import ReportModal from '@/components/ReportModal';
import CommentsModal from '@/components/CommentsModal';
import ChallengesList from '@/components/ChallengesList';
import CreateChallengeModal from '@/components/CreateChallengeModal';
import { sharePost } from '@/lib/post-share';
import FullscreenFeedPostItem from '@/components/FullscreenFeedPostItem';
import { useCreateFocus } from '@/lib/create-focus-context';
import { useNetworkStatus } from '@/lib/hooks/use-network-status';
import { useAppActive } from '@/lib/hooks/use-app-active';
import { useResumeRefresh } from '@/lib/hooks/use-resume-refresh';
import { useVerticalSnapPager } from '@/lib/hooks/use-vertical-snap-pager';
import { prefetchFollowingFeed, removeUserFromFollowingFeedCache, seedFollowingFeedCache } from '@/lib/following-feed-cache';
import { warmFeedWindow } from '@/lib/feed-window-warmup';
import { runQuerySafely } from '@/lib/utils/query-cancellation';
import {
  shouldPreloadFeedVideo,
  VIDEO_FEED_INITIAL_NUM_TO_RENDER,
  VIDEO_FEED_MAX_TO_RENDER_PER_BATCH,
  VIDEO_FEED_REMOVE_CLIPPED_SUBVIEWS,
  VIDEO_FEED_WINDOW_SIZE,
} from '@/lib/utils/video-feed';
import { pauseAllVideos } from '@/lib/hooks/use-video-pause-on-blur';
import {
  createFeedRefreshSeed,
  createNextFeedRefreshSeed,
  FEED_DEFAULT_PAGE_SIZE,
  FEED_INTEGRATION_CONFIG,
} from '@/lib/feed-config';
import { feedTelemetry } from '@/lib/feed-telemetry';
import { captureFabricError } from '@/lib/utils/fabric-diagnostics';

const FEED_TABS = [
  { key: 'foryou', label: 'For You' },
  { key: 'following', label: 'Following' },
  { key: 'challenges', label: 'Competitions' },
];

type FeedTab = 'foryou' | 'following' | 'challenges';

function hashOrderKey(input: string) {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) | 0;
  }
  return hash;
}

function reorderFollowingPosts(posts: Post[], seed: number) {
  if (posts.length < 2) {
    return posts;
  }

  return [...posts].sort((left, right) => {
    const leftKey = hashOrderKey(`${seed}:${left.id}`);
    const rightKey = hashOrderKey(`${seed}:${right.id}`);

    if (leftKey !== rightKey) {
      return leftKey - rightKey;
    }

    return left.id.localeCompare(right.id);
  });
}

export default function FeedScreen() {
  const [activeTab, setActiveTab] = useState<FeedTab>('foryou');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isScreenFocused, setIsScreenFocused] = useState(true);
  const [userFollowStatus, setUserFollowStatus] = useState<Record<string, boolean>>({});
  const [isFeedTransitioning, setIsFeedTransitioning] = useState(false);
  const lastActiveIndexRef = useRef(0);
  const currentIndexRef = useRef(0);
  const [reportModalVisible, setReportModalVisible] = useState(false);
  const [reportPostId, setReportPostId] = useState<string | null>(null);
  const [commentsModalVisible, setCommentsModalVisible] = useState(false);
  const [commentsPostId, setCommentsPostId] = useState<string | null>(null);
  const [commentsPostTitle, setCommentsPostTitle] = useState('');
  const [commentsPostAuthor, setCommentsPostAuthor] = useState('');
  const [commentsPostOwnerId, setCommentsPostOwnerId] = useState<string | undefined>(undefined);
  const [createChallengeVisible, setCreateChallengeVisible] = useState(false);
  const [challengesRefreshTrigger, setChallengesRefreshTrigger] = useState(0);
  const [challengeDefaultTab, setChallengeDefaultTab] = useState<'active' | 'upcoming' | 'ended' | 'created' | undefined>(undefined);
  const [feedViewportHeight, setFeedViewportHeight] = useState(0);
  const [forYouRefreshSeed, setForYouRefreshSeed] = useState(() => createFeedRefreshSeed());
  const [followingOrderSeed, setFollowingOrderSeed] = useState(() => createFeedRefreshSeed());
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const [forYouRecoveryAttempts, setForYouRecoveryAttempts] = useState(0);
  const flatListRef = useRef<FlatList<Post>>(null);
  const followingAutoloadAttemptedRef = useRef(false);
  const lastFollowSyncUserIdRef = useRef<string | null>(null);
  const pendingLikeRequestsRef = useRef<Set<string>>(new Set());
  const lastTabRef = useRef<FeedTab>('foryou');
  const didAdvanceForYouSessionRef = useRef(false);
  const seenResetRecoveryAttemptedRef = useRef(false);
  const { user } = useAuth();
  const { isCreateFocused } = useCreateFocus();
  const { isOffline } = useNetworkStatus();
  const isAppActive = useAppActive();
  const {
    followedUsers,
    followedUsersReady,
    updateFollowedUsers,
    syncFollowedUsersFromServer,
  } = useCache();
  const dispatch = useAppDispatch();
  const likedPosts = useAppSelector(state => state.likes.likedPosts);
  const postLikeCounts = useAppSelector(state => state.likes.postLikeCounts);
  const insets = useSafeAreaInsets();
  const safeAreaFrame = useSafeAreaFrame();
  const { height: screenHeight } = useWindowDimensions();

  const feedTab = activeTab === 'challenges' ? 'foryou' : activeTab as 'foryou' | 'following';
  const {
    posts,
    userPreferences,
    effectiveRefresh,
    feedEndpoint,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    refetch,
    isRefetching,
    loadOutcome,
    errorMessage,
  } = useFeedQuery(feedTab, activeTab === 'challenges'
    ? {}
    : feedTab === 'foryou'
      ? { refreshSeed: forYouRefreshSeed, limit: FEED_DEFAULT_PAGE_SIZE }
      : {});
  const visiblePosts = React.useMemo(
    () => activeTab === 'following' ? reorderFollowingPosts(posts, followingOrderSeed) : posts,
    [activeTab, followingOrderSeed, posts],
  );
  const currentFeedSessionId = React.useMemo(
    () => `foryou:${user?.id ?? 'guest'}:${effectiveRefresh ?? forYouRefreshSeed}`,
    [effectiveRefresh, forYouRefreshSeed, user?.id],
  );
  const feedQueryOwnerId = user?.id ?? 'guest';

  const resetFeedViewportToTop = useCallback(() => {
    flatListRef.current?.scrollToOffset({ offset: 0, animated: false });
    currentIndexRef.current = 0;
    lastActiveIndexRef.current = 0;
    setCurrentIndex(0);
  }, []);

  const hardRefreshForYou = useCallback((reason: 'resume' | 'manual' | 'recovery', backgroundDurationMs = 0) => {
    const nextRefreshSeed = createNextFeedRefreshSeed(forYouRefreshSeed);
    if (reason !== 'recovery') {
      setForYouRecoveryAttempts(0);
    }
    resetFeedViewportToTop();
    queryClient.removeQueries({
      queryKey: ['feed', 'foryou', feedQueryOwnerId],
    });
    setForYouRefreshSeed(nextRefreshSeed);

    if (reason === 'manual') {
      feedTelemetry.trackManualReload({
        screenName: 'feed:foryou',
        endpoint: feedEndpoint ?? 'public',
      });
    } else {
      feedTelemetry.trackResumeHardReset({
        screenName: 'feed:foryou',
        endpoint: feedEndpoint ?? 'public',
        backgroundDurationMs,
      });
    }
  }, [feedEndpoint, feedQueryOwnerId, forYouRefreshSeed, resetFeedViewportToTop]);

  const resetSeenAndRefreshForYou = useCallback(async (
    reason: 'manual' | 'recovery',
    backgroundDurationMs = 0,
  ) => {
    const nextRefreshSeed = createNextFeedRefreshSeed(forYouRefreshSeed);
    const resetResponse = user
      ? await feedApi.resetSeen()
      : await feedApi.resetSeenGuest();

    if (resetResponse.status === 'success') {
      feedTelemetry.trackSeenResetCalled({
        endpoint: user ? 'auth' : 'guest',
        refresh: nextRefreshSeed,
      });
    } else {
      captureFabricError(
        new Error(resetResponse.message || 'Failed to reset feed seen history'),
        'feed_seen_reset_failed',
        {
          endpoint: user ? 'personalized' : 'public',
          reason,
        },
        'warning',
      );
    }

    hardRefreshForYou(reason, backgroundDurationMs);
  }, [forYouRefreshSeed, hardRefreshForYou, user]);

  const hardRefreshFollowing = useCallback((reason: 'resume' | 'manual', backgroundDurationMs = 0) => {
    const nextSeed = createNextFeedRefreshSeed(followingOrderSeed);
    setFollowingOrderSeed(nextSeed);
    resetFeedViewportToTop();
    queryClient.removeQueries({
      queryKey: ['feed', 'following', feedQueryOwnerId],
    });
    void refetch();

    if (reason === 'manual') {
      feedTelemetry.trackManualReload({
        screenName: 'feed:following',
        endpoint: 'following',
      });
    } else {
      feedTelemetry.trackResumeHardReset({
        screenName: 'feed:following',
        endpoint: 'following',
        backgroundDurationMs,
      });
    }
  }, [feedQueryOwnerId, followingOrderSeed, refetch, resetFeedViewportToTop]);

  const softRefreshCurrentTab = useCallback((backgroundDurationMs: number) => {
    if (activeTab === 'following') {
      feedTelemetry.trackResumeRefetch({
        screenName: 'feed:following',
        endpoint: 'following',
        backgroundDurationMs,
      });
      void refetch();
      return;
    }

    if (activeTab === 'foryou') {
      feedTelemetry.trackResumeRefetch({
        screenName: 'feed:foryou',
        endpoint: feedEndpoint ?? 'public',
        backgroundDurationMs,
      });
      void refetch();
    }
  }, [activeTab, feedEndpoint, refetch]);

  React.useEffect(() => {
    if (__DEV__ && activeTab === 'foryou' && userPreferences.length > 0) {
      console.log('[FeedPreferences]', {
        refresh: effectiveRefresh ?? forYouRefreshSeed,
        userPreferences,
      });
    } else if (__DEV__ && activeTab === 'foryou' && userPreferences.length === 0) {
      console.log('[FeedPreferences]', {
        refresh: effectiveRefresh ?? forYouRefreshSeed,
        userPreferences: [],
      });
    } else {
      return;
    }
  }, [activeTab, effectiveRefresh, forYouRefreshSeed, userPreferences]);

  const trackFeedEngagement = useCallback((postId: string, action: 'like' | 'comment' | 'share') => {
    if (!postId) {
      return;
    }

    feedTelemetry.trackEngagementAfterFeedImpression({
      sessionId: currentFeedSessionId,
      postId,
      action,
      timestamp: new Date().toISOString(),
      refresh: effectiveRefresh ?? forYouRefreshSeed,
    });
  }, [currentFeedSessionId, effectiveRefresh, forYouRefreshSeed]);

  React.useEffect(() => {
    if (pullRefreshing && !isLoading && !isRefetching) {
      setPullRefreshing(false);
    }
  }, [isLoading, isRefetching, pullRefreshing]);

  React.useEffect(() => {
    if (!user?.id) {
      lastFollowSyncUserIdRef.current = null;
      return;
    }

    if (lastFollowSyncUserIdRef.current === user.id) {
      return;
    }

    lastFollowSyncUserIdRef.current = user.id;
    void syncFollowedUsersFromServer();
  }, [user?.id, syncFollowedUsersFromServer]);

  React.useEffect(() => {
    if (didAdvanceForYouSessionRef.current) {
      return;
    }

    didAdvanceForYouSessionRef.current = true;
    setForYouRefreshSeed((currentSeed) => createNextFeedRefreshSeed(currentSeed));
  }, []);

  React.useEffect(() => {
    const previousTab = lastTabRef.current;
    lastTabRef.current = activeTab;

    if (activeTab !== 'following' || previousTab === 'following') {
      return;
    }

    const nextSeed = createNextFeedRefreshSeed(followingOrderSeed);
    setFollowingOrderSeed(nextSeed);
    resetFeedViewportToTop();
    void refetch();
  }, [activeTab, followingOrderSeed, refetch, resetFeedViewportToTop]);

  React.useEffect(() => {
    if (activeTab === 'foryou') {
      return;
    }

    seenResetRecoveryAttemptedRef.current = false;
    setForYouRecoveryAttempts(0);
  }, [activeTab]);

  React.useEffect(() => {
    if (activeTab !== 'foryou' || !isAppActive) {
      return;
    }

    if (isLoading || isRefetching || visiblePosts.length > 0 || isOffline) {
      return;
    }

    if (loadOutcome === 'empty' && !seenResetRecoveryAttemptedRef.current) {
      seenResetRecoveryAttemptedRef.current = true;
      setForYouRecoveryAttempts(1);

      const timeout = setTimeout(() => {
        void resetSeenAndRefreshForYou('recovery');
      }, 200);

      return () => clearTimeout(timeout);
    }

    if (forYouRecoveryAttempts >= 2) {
      return;
    }

    const timeout = setTimeout(() => {
      setForYouRecoveryAttempts((attempts) => attempts + 1);
      hardRefreshForYou('recovery');
    }, 350);

    return () => clearTimeout(timeout);
  }, [
    activeTab,
    forYouRecoveryAttempts,
    hardRefreshForYou,
    isAppActive,
    isLoading,
    isOffline,
    isRefetching,
    loadOutcome,
    resetSeenAndRefreshForYou,
    visiblePosts.length,
  ]);

  const headerTabsHeight = 44;
  const headerPaddingVertical = 12;
  const headerHeight = insets.top + headerTabsHeight + headerPaddingVertical;
  const fallbackAvailableHeight = Math.max(0, (safeAreaFrame.height || screenHeight) - headerHeight);
  const availableHeight = feedViewportHeight > 0 ? feedViewportHeight : fallbackAvailableHeight;
  const isFeedViewportReady = activeTab === 'challenges' || availableHeight > 0;
  const {
    pageHeight: verticalPageHeight,
    snapToOffsets,
    getItemLayout,
    handleScroll: handlePagerScroll,
    handleMomentumScrollEnd: handlePagerMomentumScrollEnd,
  } = useVerticalSnapPager<Post>({
    itemCount: visiblePosts.length,
    pageHeight: availableHeight,
    listRef: flatListRef,
    screenName: `feed:${activeTab}`,
    onIndexChanged: (index) => {
      if (index !== currentIndexRef.current) {
        pauseAllVideos();
        currentIndexRef.current = index;
      }
    },
    onIndexSettled: (nextIndex) => {
      setCurrentIndex(nextIndex);
      lastActiveIndexRef.current = nextIndex;
    },
    onTransitionEnd: () => {
      setIsFeedTransitioning(false);
    },
  });

  useResumeRefresh({
    enabled: isScreenFocused && activeTab !== 'challenges',
    onSoftResume: (backgroundDurationMs) => {
      softRefreshCurrentTab(backgroundDurationMs);
    },
    onHardResume: (backgroundDurationMs) => {
      if (activeTab === 'following') {
        hardRefreshFollowing('resume', backgroundDurationMs);
        return;
      }

      if (activeTab === 'foryou') {
        hardRefreshForYou('resume', backgroundDurationMs);
      }
    },
  });

  useFocusEffect(
    useCallback(() => {
      setIsScreenFocused(true);
      if (lastActiveIndexRef.current >= 0) {
        setCurrentIndex(lastActiveIndexRef.current);
      }
      return () => {
        const savedIndex = currentIndexRef.current;
        setIsScreenFocused(false);
        lastActiveIndexRef.current = savedIndex;
        pauseAllVideos();
      };
    }, [])
  );

  // Keep currentIndexRef in sync
  currentIndexRef.current = currentIndex;

  const updateLikeInCache = useCallback((postId: string, isLiked: boolean, likeCount: number) => {
    queryClient.setQueriesData({ queryKey: ['feed'] }, (old: any) => {
      if (!old?.pages) return old;
      return {
        ...old,
        pages: old.pages.map((page: any) => ({
          ...page,
          posts: page.posts.map((p: any) =>
            p.id === postId ? { ...p, is_liked: isLiked, like_count: likeCount, likes: likeCount } : p
          ),
        })),
      };
    });
  }, [queryClient]);

  const updateCommentCountInCache = useCallback((postId: string, delta: number) => {
    if (!postId || delta === 0) {
      return;
    }

    queryClient.setQueriesData({ queryKey: ['feed'] }, (old: any) => {
      if (!old?.pages) return old;
      return {
        ...old,
        pages: old.pages.map((page: any) => ({
          ...page,
          posts: page.posts.map((p: any) => {
            if (p.id !== postId) {
              return p;
            }

            const currentCount = Number(p.comments_count ?? p.comment_count ?? p.commentsCount ?? 0);
            const nextCount = Math.max(0, currentCount + delta);
            return {
              ...p,
              comments_count: nextCount,
              comment_count: nextCount,
              commentsCount: nextCount,
            };
          }),
        })),
      };
    });
  }, [queryClient]);

  const handleLike = useCallback(async (postId: string) => {
    if (!user) {
      Alert.alert(
        'Login Required',
        'Please log in or sign up to like posts.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Sign Up', onPress: () => router.push({ pathname: '/auth/register' as any }) },
          { text: 'Login', onPress: () => router.push({ pathname: '/auth/login' as any }) }
        ]
      );
      return;
    }

    if (pendingLikeRequestsRef.current.has(postId)) {
      return;
    }

    pendingLikeRequestsRef.current.add(postId);

    const post = visiblePosts.find(p => p.id === postId);
    const currentIsLiked = likedPosts.includes(postId) || post?.is_liked === true;
    const currentCount = postLikeCounts[postId] ?? post?.like_count ?? post?.likes ?? 0;
    const newIsLiked = !currentIsLiked;
    const newCount = newIsLiked ? currentCount + 1 : Math.max(0, currentCount - 1);

    // Optimistic: Redux + React Query cache
    if (newIsLiked) dispatch(addLikedPost(postId));
    else dispatch(removeLikedPost(postId));
    dispatch(setPostLikeCount({ postId, count: newCount }));
    updateLikeInCache(postId, newIsLiked, newCount);

    try {
      const response = await likesApi.toggle(postId);
      if (response.status === 'success' && response.data) {
        const serverLiked = response.data.isLiked;
        const serverCount = response.data.likeCount;
        if (serverLiked) dispatch(addLikedPost(postId));
        else dispatch(removeLikedPost(postId));
        dispatch(setPostLikeCount({ postId, count: serverCount }));
        updateLikeInCache(postId, serverLiked, serverCount);
        if (serverLiked) {
          trackFeedEngagement(postId, 'like');
        }
      } else {
        if (currentIsLiked) dispatch(addLikedPost(postId));
        else dispatch(removeLikedPost(postId));
        dispatch(setPostLikeCount({ postId, count: currentCount }));
        updateLikeInCache(postId, currentIsLiked, currentCount);
      }
    } catch {
      // Revert on failure
      if (currentIsLiked) dispatch(addLikedPost(postId));
      else dispatch(removeLikedPost(postId));
      dispatch(setPostLikeCount({ postId, count: currentCount }));
      updateLikeInCache(postId, currentIsLiked, currentCount);
    } finally {
      pendingLikeRequestsRef.current.delete(postId);
    }
  }, [user, likedPosts, visiblePosts, postLikeCounts, dispatch, trackFeedEngagement, updateLikeInCache]);

  const updateFollowInCache = useCallback((userId: string, isFollowing: boolean) => {
    queryClient.setQueriesData({ queryKey: ['feed'] }, (old: any) => {
      if (!old?.pages) return old;
      return {
        ...old,
        pages: old.pages.map((page: any) => ({
          ...page,
          posts: page.posts.map((p: any) =>
            (p.user?.id === userId || p.user_id === userId || p.userId === userId)
              ? {
                  ...p,
                  user: p.user ? { ...p.user, id: p.user.id || userId } : p.user,
                  user_id: p.user_id || userId,
                  userId: p.userId || userId,
                  is_following_author: isFollowing,
                }
              : p
          ),
        })),
      };
    });
  }, [queryClient]);

  const handleFollow = useCallback(async (userId: string) => {
    if (!user) return;
    setUserFollowStatus((prev) => ({ ...prev, [userId]: true }));
    seedFollowingFeedCache(user.id, userId, posts);
    updateFollowInCache(userId, true);
    updateFollowedUsers(userId, true);
    try {
      const res = await followsApi.follow(userId);
      if (res.status !== 'success') {
        setUserFollowStatus((prev) => ({ ...prev, [userId]: false }));
        updateFollowInCache(userId, false);
        updateFollowedUsers(userId, false);
        removeUserFromFollowingFeedCache(user.id, userId);
      } else {
        void syncFollowedUsersFromServer();
        void prefetchFollowingFeed(user.id);
      }
    } catch {
      setUserFollowStatus((prev) => ({ ...prev, [userId]: false }));
      updateFollowInCache(userId, false);
      updateFollowedUsers(userId, false);
      removeUserFromFollowingFeedCache(user.id, userId);
    }
  }, [user, posts, syncFollowedUsersFromServer, updateFollowInCache, updateFollowedUsers]);

  const handleUnfollow = useCallback(async (userId: string) => {
    if (!user) return;
    setUserFollowStatus((prev) => ({ ...prev, [userId]: false }));
    removeUserFromFollowingFeedCache(user.id, userId);
    updateFollowInCache(userId, false);
    updateFollowedUsers(userId, false);
    try {
      const res = await followsApi.unfollow(userId);
      if (res.status !== 'success') {
        setUserFollowStatus((prev) => ({ ...prev, [userId]: true }));
        updateFollowInCache(userId, true);
        updateFollowedUsers(userId, true);
        seedFollowingFeedCache(user.id, userId, posts);
      } else {
        void syncFollowedUsersFromServer();
      }
    } catch {
      setUserFollowStatus((prev) => ({ ...prev, [userId]: true }));
      updateFollowInCache(userId, true);
      updateFollowedUsers(userId, true);
      seedFollowingFeedCache(user.id, userId, posts);
    }
  }, [user, updateFollowInCache, updateFollowedUsers, syncFollowedUsersFromServer, posts]);

  const handleComment = useCallback((postId: string) => {
    if (!postId) return;
    const post = visiblePosts.find(p => p.id === postId);
    setCommentsPostId(postId);
    setCommentsPostTitle(post?.title || post?.description || '');
    setCommentsPostAuthor(post?.user?.username || '');
    setCommentsPostOwnerId(post?.user?.id);
    setCommentsModalVisible(true);
  }, [visiblePosts]);

  const handleCommentAdded = useCallback(() => {
    if (!commentsPostId) {
      return;
    }

    updateCommentCountInCache(commentsPostId, 1);
    trackFeedEngagement(commentsPostId, 'comment');
  }, [commentsPostId, trackFeedEngagement, updateCommentCountInCache]);

  const handleCommentDeleted = useCallback(() => {
    if (!commentsPostId) {
      return;
    }

    updateCommentCountInCache(commentsPostId, -1);
  }, [commentsPostId, updateCommentCountInCache]);

  const handleShare = useCallback(async (postId: string) => {
    const post = visiblePosts.find(p => p.id === postId);
    if (post) {
      try {
        const result = await sharePost(post);
        if ((result as any)?.feedShareRecorded) {
          trackFeedEngagement(postId, 'share');
        }
      } catch {}
    }
  }, [trackFeedEngagement, visiblePosts]);

  const handleRefresh = useCallback(async () => {
    if (activeTab === 'following') {
      setPullRefreshing(true);
      setFollowingOrderSeed(createNextFeedRefreshSeed(followingOrderSeed));
      resetFeedViewportToTop();
      await refetch();
      return;
    }

    if (activeTab !== 'foryou') {
      setPullRefreshing(true);
      await refetch();
      return;
    }

    const nextRefreshSeed = createNextFeedRefreshSeed(forYouRefreshSeed);
    setPullRefreshing(true);
    setForYouRecoveryAttempts(0);
    seenResetRecoveryAttemptedRef.current = false;
    feedTelemetry.trackPullToRefresh({
      endpoint: feedEndpoint === 'public' ? 'public' : 'personalized',
      refresh: nextRefreshSeed,
    });

    if (FEED_INTEGRATION_CONFIG.enableSeenResetOnPullToRefresh) {
      const resetResponse = user
        ? await feedApi.resetSeen()
        : await feedApi.resetSeenGuest();

      if (resetResponse.status === 'success') {
        feedTelemetry.trackSeenResetCalled({
          endpoint: user ? 'auth' : 'guest',
          refresh: nextRefreshSeed,
        });
      }
    }

    resetFeedViewportToTop();
    setForYouRefreshSeed(nextRefreshSeed);
  }, [activeTab, feedEndpoint, followingOrderSeed, forYouRefreshSeed, refetch, resetFeedViewportToTop, user]);

  const handleReport = useCallback((postId: string) => {
    if (!user) {
      router.push({ pathname: '/auth/login' as any });
      return;
    }
    setReportPostId(postId);
    setReportModalVisible(true);
  }, [user]);

  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    if (viewableItems.length > 0) {
      const mostVisible = viewableItems.reduce((best: any, item: any) =>
        item.isViewable && (!best || (item.percentVisible ?? 0) > (best.percentVisible ?? 0)) ? item : best
      , null as any);

      const idx = mostVisible?.index ?? viewableItems[0]?.index ?? 0;
      setIsFeedTransitioning(false);
      setCurrentIndex(idx);
      lastActiveIndexRef.current = idx;
    } else {
      setIsFeedTransitioning(false);
      setCurrentIndex(-1);
    }
  }).current;

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 60,
    minimumViewTime: 50,
    waitForInteraction: false,
  }).current;

  const onEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      void runQuerySafely(() => fetchNextPage(), 'feed pagination');
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const shimmerAnim = useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(shimmerAnim, { toValue: 0, duration: 800, useNativeDriver: true }),
      ])
    ).start();
  }, [shimmerAnim]);
  const shimmerOpacity = shimmerAnim.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.7] });

  const renderSkeletonItem = useCallback((key: string | number) => (
    <View key={key} style={[styles.skeletonItem, { height: availableHeight }]}>
      <Animated.View style={[styles.skeletonMedia, { opacity: shimmerOpacity }]} />
      <View style={styles.skeletonActions}>
        <Animated.View style={[styles.skeletonAvatar, { opacity: shimmerOpacity }]} />
        <Animated.View style={[styles.skeletonActionButton, { opacity: shimmerOpacity }]} />
        <Animated.View style={[styles.skeletonActionButton, { opacity: shimmerOpacity }]} />
        <Animated.View style={[styles.skeletonActionButton, { opacity: shimmerOpacity }]} />
      </View>
      <View style={styles.skeletonBottomInfo}>
        <Animated.View style={[styles.skeletonUsername, { opacity: shimmerOpacity }]} />
        <Animated.View style={[styles.skeletonCaption, { opacity: shimmerOpacity }]} />
      </View>
    </View>
  ), [availableHeight, shimmerOpacity]);

  const renderScrollableSkeletonFeed = useCallback((count = 12) => (
    <FlatList
      data={Array.from({ length: count }, (_, index) => index)}
      keyExtractor={(item) => `skeleton-${item}`}
      renderItem={({ item }) => renderSkeletonItem(item)}
      snapToOffsets={Array.from({ length: count }, (_, index) => index * verticalPageHeight)}
      snapToAlignment="start"
      disableIntervalMomentum
      decelerationRate="fast"
      showsVerticalScrollIndicator={false}
      bounces={false}
      alwaysBounceVertical={false}
      scrollEnabled
    />
  ), [renderSkeletonItem, verticalPageHeight]);

  const renderItem = useCallback(({ item, index }: { item: Post; index: number }) => {
    const isActive = isScreenFocused && currentIndex === index;
    const shouldPreload = shouldPreloadFeedVideo(index, currentIndex, { disabled: isCreateFocused || isActive });

    const isLiked = likedPosts.includes(item.id) || item.is_liked === true;
    const targetUserId = item.user?.id || (item as any).user_id || (item as any).userId || '';
    const optimisticFollowStatus = targetUserId ? userFollowStatus[targetUserId] : undefined;
    const cachedFollowStatus = targetUserId ? followedUsers.has(targetUserId) : false;
    // Prioritize explicit user action (optimistic) first,
    // then check the followedUsers cache (synced from server) before falling
    // back to the per-post is_following_author flag. This ensures the status
    // stays consistent when switching between the For You and Following tabs.
    const isFollowing = optimisticFollowStatus !== undefined
      ? optimisticFollowStatus
      : (cachedFollowStatus || item.is_following_author === true || activeTab === 'following');

    return (
      <FullscreenFeedPostItem
        item={item}
        index={index}
        onLike={handleLike}
        onComment={handleComment}
        onShare={handleShare}
        onReport={handleReport}
        onFollow={handleFollow}
        onUnfollow={handleUnfollow}
        isLiked={isLiked}
        isFollowing={isFollowing}
        isFollowStateReady={!user || followedUsersReady || activeTab === 'following' || item.is_following_author === true}
        isActive={isActive}
        suspendPlayback={isFeedTransitioning || commentsModalVisible || reportModalVisible}
        shouldPreload={shouldPreload}
        availableHeight={verticalPageHeight}
      />
    );
  }, [activeTab, isScreenFocused, currentIndex, isCreateFocused, likedPosts, followedUsers, userFollowStatus, isFeedTransitioning, commentsModalVisible, reportModalVisible, handleLike, handleComment, handleShare, handleReport, handleFollow, handleUnfollow, verticalPageHeight]);

  React.useEffect(() => {
    if (activeTab !== 'following' || !user) {
      followingAutoloadAttemptedRef.current = false;
      return;
    }

    void prefetchFollowingFeed(user.id);
  }, [activeTab, user?.id]);

  React.useEffect(() => {
    followingAutoloadAttemptedRef.current = false;
  }, [followedUsers.size]);

  React.useEffect(() => {
    if (visiblePosts.length > 0) {
      seenResetRecoveryAttemptedRef.current = false;
      setForYouRecoveryAttempts(0);
    }
  }, [visiblePosts.length]);

  React.useEffect(() => {
    if (activeTab !== 'following') {
      followingAutoloadAttemptedRef.current = false;
      return;
    }

    if (visiblePosts.length > 0) {
      followingAutoloadAttemptedRef.current = false;
      return;
    }

    if (
      !user ||
      followedUsers.size === 0 ||
      isLoading ||
      isRefetching ||
      followingAutoloadAttemptedRef.current
    ) {
      return;
    }

    followingAutoloadAttemptedRef.current = true;
    void refetch();
  }, [activeTab, followedUsers.size, isLoading, isRefetching, refetch, user, visiblePosts.length]);

  React.useEffect(() => {
    if (activeTab === 'challenges' || visiblePosts.length === 0) {
      return;
    }

    warmFeedWindow(visiblePosts, Math.max(0, currentIndex));
  }, [activeTab, currentIndex, visiblePosts]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      <View style={styles.header}>
        <View style={styles.tabsContainer}>
          {FEED_TABS.map((tab) => (
            <TouchableOpacity
              key={tab.key}
              style={[styles.tab, activeTab === tab.key && styles.tabActive]}
              onPress={() => setActiveTab(tab.key as FeedTab)}
            >
              <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {activeTab === 'challenges' ? (
        <>
          <ChallengesList
            onCreateChallenge={() => setCreateChallengeVisible(true)}
            refreshTrigger={challengesRefreshTrigger}
            defaultTab={challengeDefaultTab}
          />
          <CreateChallengeModal
            visible={createChallengeVisible}
            onClose={() => setCreateChallengeVisible(false)}
            onCreated={() => {
              setChallengeDefaultTab('created');
              setChallengesRefreshTrigger(prev => prev + 1);
            }}
          />
        </>
      ) : (
        <View
          style={styles.feedViewport}
          onLayout={(event) => {
            const nextHeight = Math.round(event.nativeEvent.layout.height);
            if (nextHeight > 0 && nextHeight !== feedViewportHeight) {
              setFeedViewportHeight(nextHeight);
            }
          }}
        >
          {!isFeedViewportReady || (isLoading && visiblePosts.length === 0) ? (
            <View style={styles.loadingContainer}>
              {[1, 2, 3].map((i) => renderSkeletonItem(i))}
            </View>
          ) : (
            <FlatList
              ref={flatListRef}
              data={visiblePosts}
              renderItem={renderItem}
              keyExtractor={(item) => item.id}
              getItemLayout={getItemLayout}
              snapToOffsets={snapToOffsets}
              snapToAlignment="start"
              disableIntervalMomentum
              decelerationRate="fast"
              showsVerticalScrollIndicator={false}
              windowSize={VIDEO_FEED_WINDOW_SIZE}
              maxToRenderPerBatch={VIDEO_FEED_MAX_TO_RENDER_PER_BATCH}
              initialNumToRender={VIDEO_FEED_INITIAL_NUM_TO_RENDER}
              removeClippedSubviews={VIDEO_FEED_REMOVE_CLIPPED_SUBVIEWS}
              scrollEventThrottle={16}
              scrollEnabled={true}
              bounces={false}
              alwaysBounceVertical={false}
              refreshControl={
                <RefreshControl
                  refreshing={pullRefreshing || isRefetching}
                  onRefresh={() => {
                    void handleRefresh();
                  }}
                  tintColor="#60a5fa"
                />
              }
              onScrollBeginDrag={() => { pauseAllVideos(); setIsFeedTransitioning(true); }}
              onMomentumScrollBegin={() => { pauseAllVideos(); setIsFeedTransitioning(true); }}
              onScroll={handlePagerScroll}
              onMomentumScrollEnd={handlePagerMomentumScrollEnd}
              onEndReached={onEndReached}
              onEndReachedThreshold={0.5}
              ListFooterComponent={
                isFetchingNextPage ? (
                  <View style={styles.loadMoreContainer}>
                    <ActivityIndicator size="small" color="#60a5fa" />
                    <Text style={styles.loadMoreText}>Loading more posts...</Text>
                  </View>
                ) : null
              }
              onViewableItemsChanged={onViewableItemsChanged}
              viewabilityConfig={viewabilityConfig}
              ListEmptyComponent={
                isOffline ? (
                  renderScrollableSkeletonFeed()
                ) : isRefetching || isLoading || (activeTab === 'foryou' && forYouRecoveryAttempts > 0 && forYouRecoveryAttempts < 2) ? (
                  <View style={[styles.loadingContainer, { height: verticalPageHeight }]}>
                    {[1, 2].map((i) => renderSkeletonItem(i))}
                  </View>
                ) : activeTab === 'foryou' ? (
                  <View style={[styles.emptyContainer, { height: verticalPageHeight - 100 }]}>
                    <Feather name="refresh-cw" size={54} color="#60a5fa" />
                    <Text style={styles.emptyText}>
                      {loadOutcome === 'error' ? 'Feed failed to recover' : 'No posts available right now'}
                    </Text>
                    <Text style={styles.emptySubtext}>
                      {loadOutcome === 'error'
                        ? errorMessage || 'Tap below to reload posts again.'
                        : 'Reload the feed to fetch posts again.'}
                    </Text>
                    <TouchableOpacity
                      style={styles.emptyLoginButton}
                      onPress={() => {
                        seenResetRecoveryAttemptedRef.current = false;
                        setForYouRecoveryAttempts(1);
                        void resetSeenAndRefreshForYou('manual');
                      }}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.emptyLoginButtonText}>Reload feed</Text>
                    </TouchableOpacity>
                  </View>
                ) : activeTab === 'following' && !user ? (
                <View style={[styles.emptyContainer, { height: verticalPageHeight - 100 }]}>
                  <Feather name="user-plus" size={64} color="#666" />
                  <Text style={styles.emptyText}>
                    Sign in to see posts from people you follow
                  </Text>
                  <Text style={styles.emptySubtext}>
                    Sign in to see posts from people you follow
                  </Text>
                  <TouchableOpacity
                    style={styles.emptyLoginButton}
                    onPress={() => router.push('/auth/login' as any)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.emptyLoginButtonText}>Log in / Sign up</Text>
                  </TouchableOpacity>
                </View>
                ) : (
                  renderScrollableSkeletonFeed(8)
                )
              }
            />
          )}
        </View>
      )}



      <ReportModal
        isVisible={reportModalVisible}
        onClose={() => setReportModalVisible(false)}
        postId={reportPostId}
        onReported={() => {
          setReportModalVisible(false);
          Alert.alert('Reported', 'Thank you for reporting this content. We will review it shortly.');
        }}
      />

      <CommentsModal
        visible={commentsModalVisible && !!commentsPostId}
        onClose={() => {
          setCommentsModalVisible(false);
          setTimeout(() => setCommentsPostId(null), 300);
        }}
        postId={commentsPostId || ''}
        postTitle={commentsPostTitle}
        postAuthor={commentsPostAuthor}
        postOwnerId={commentsPostOwnerId}
        onCommentAdded={handleCommentAdded}
        onCommentDeleted={handleCommentDeleted}
      />
    </SafeAreaView>
  );
}

const FEED_BG = '#1a1a1a';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: FEED_BG,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: FEED_BG,
  },
  feedViewport: {
    flex: 1,
  },
  header: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 10,
    backgroundColor: 'rgba(0,0,0,0.95)',
    zIndex: 100,
  },
  tabsContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
  },
  tab: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginHorizontal: 6,
  },
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: '#60a5fa',
  },
  tabText: {
    color: '#999',
    fontSize: 15,
    fontWeight: '500',
  },
  tabTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000000',
  },
  emptyText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtext: {
    color: '#999',
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: 40,
    lineHeight: 20,
  },
  emptyLoginButton: {
    marginTop: 24,
    backgroundColor: '#60a5fa',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
  },
  emptyLoginButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  loadMoreContainer: {
    paddingVertical: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadMoreText: {
    color: '#999',
    fontSize: 14,
    marginTop: 8,
    marginBottom: 12,
  },
  skeletonItem: {
    width: '100%',
    backgroundColor: '#000',
    position: 'relative',
  },
  skeletonMedia: {
    width: '100%',
    height: '100%',
    backgroundColor: '#1a1a1a',
  },
  skeletonActions: {
    position: 'absolute',
    right: 12,
    bottom: 100,
    alignItems: 'center',
    gap: 20,
  },
  skeletonAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#2a2a2a',
    marginBottom: 8,
  },
  skeletonActionButton: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#2a2a2a',
    marginBottom: 4,
  },
  skeletonBottomInfo: {
    position: 'absolute',
    left: 12,
    bottom: 60,
    right: 80,
  },
  skeletonUsername: {
    width: 100,
    height: 16,
    borderRadius: 4,
    backgroundColor: '#2a2a2a',
    marginBottom: 8,
  },
  skeletonCaption: {
    width: '80%',
    height: 12,
    borderRadius: 4,
    backgroundColor: '#2a2a2a',
    marginBottom: 4,
  },
});
