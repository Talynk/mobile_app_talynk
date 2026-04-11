import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
  Pressable,
  Image,
  Dimensions,
  StatusBar,
  Share,
  Animated,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { postsApi, likesApi, userApi, categoriesApi, followsApi, challengesApi } from '@/lib/api';
import { API_BASE_URL } from '@/lib/config';
import { Post } from '@/types';
import { useAuth } from '@/lib/auth-context';
import { useRefetchOnReconnect } from '@/lib/hooks/use-network-status';
import { useCache } from '@/lib/cache-context';
import { useAppDispatch, useAppSelector } from '@/lib/store/hooks';
import {
  addLikedPost,
  removeLikedPost,
  setPostLikeCount,
  setPostLikeCounts,
} from '@/lib/store/slices/likesSlice';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { useRealtime } from '@/lib/realtime-context';
import RealtimeProvider from '@/lib/realtime-context';
import { useLikesManager } from '@/lib/hooks/use-likes-manager';
import ReportModal from '@/components/ReportModal';
import CommentsModal from '@/components/CommentsModal';
import { filterHlsReady, filterSecondarySurfacePosts } from '@/lib/utils/post-filter';
import FullscreenFeedPostItem from '@/components/FullscreenFeedPostItem';
import { useCreateFocus } from '@/lib/create-focus-context';
import { getPostMediaUrl, getThumbnailUrl, getProfilePictureUrl, getPlaybackUrl, isVideoProcessing } from '@/lib/utils/file-url';
import { sharePost } from '@/lib/post-share';
import { getExplorePostsCache } from '@/lib/explore-posts-cache';
import { normalizePost } from '@/lib/utils/normalize-post';
import { getPostDetailCached, getPostDetailsCached, primePostDetailsCache } from '@/lib/post-details-cache';
import { getPostVideoAssetsBatchCached } from '@/lib/post-video-assets-cache';
import { getProfileFeedLaunchCache } from '@/lib/profile-feed-launch-cache';
import { safeRouterBack } from '@/lib/utils/navigation';
import { warmFeedWindow } from '@/lib/feed-window-warmup';
import { prefetchFollowingFeed, removeUserFromFollowingFeedCache, seedFollowingFeedCache } from '@/lib/following-feed-cache';
import {
  needsChallengeMetaEnrichment,
  needsRenderableMediaEnrichment,
} from '@/lib/utils/post-detail-enrichment';
import {
  shouldPreloadFeedVideo,
  VIDEO_FEED_INITIAL_NUM_TO_RENDER,
  VIDEO_FEED_MAX_TO_RENDER_PER_BATCH,
  VIDEO_FEED_REMOVE_CLIPPED_SUBVIEWS,
  VIDEO_FEED_WINDOW_SIZE,
} from '@/lib/utils/video-feed';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

export default function ProfileFeedScreen() {
  const params = useLocalSearchParams<{
    userId?: string;
    challengeId?: string;
    initialPostId?: string;
    status?: string;
    initialPostData?: string;
    mainCategoryId?: string;
    subCategoryId?: string;
    countryId?: string;
    postsData?: string;
  }>();
  const resolvedUserId = typeof params.userId === 'string' ? params.userId : '';
  const challengeId = typeof params.challengeId === 'string' ? params.challengeId : undefined;

  return (
    <RealtimeProvider>
      <ProfileFeedContent
        userId={resolvedUserId}
        challengeId={challengeId}
        initialPostId={params.initialPostId as string}
        status={params.status as string}
        initialPostData={params.initialPostData as string}
        exploreMainCategoryId={params.mainCategoryId}
        exploreSubCategoryId={params.subCategoryId}
        exploreCountryId={params.countryId}
        explorePostsData={params.postsData}
      />
    </RealtimeProvider>
  );
}

interface ProfileFeedContentProps {
  userId: string;
  challengeId?: string;
  initialPostId?: string;
  status?: string;
  initialPostData?: string;
  exploreMainCategoryId?: string;
  exploreSubCategoryId?: string;
  exploreCountryId?: string;
  explorePostsData?: string;
}

function applyExploreFilters(
  posts: Post[],
  categories: any[],
  mainCategoryId: number | null,
  subCategoryId: number | null,
  countryId: number | null
): Post[] {
  let filtered = [...posts];
  if (countryId) {
    filtered = filtered.filter((p: any) => p.user?.country?.id === countryId);
  }
  if (subCategoryId) {
    filtered = filtered.filter(
      (p: any) => p.category_id === subCategoryId || p.category?.id === subCategoryId
    );
  } else if (mainCategoryId) {
    const main = categories.find((c: any) => c.id === mainCategoryId);
    const childIds: number[] = (main?.children || []).map((ch: any) => ch.id);
    if (childIds.length) {
      filtered = filtered.filter((p: any) => childIds.includes(p.category_id || p.category?.id));
    } else {
      filtered = filtered.filter(
        (p: any) => p.category_id === mainCategoryId || p.category?.id === mainCategoryId
      );
    }
  }
  return filtered;
}

function ProfileFeedContent({
  userId,
  challengeId,
  initialPostId,
  status,
  initialPostData,
  exploreMainCategoryId,
  exploreSubCategoryId,
  exploreCountryId,
  explorePostsData,
}: ProfileFeedContentProps) {
  // Parse initial post data if available for instant loading
  const initialPost = initialPostData ? (() => {
    try { return normalizePost(JSON.parse(initialPostData)); } catch (e) { return null; }
  })() : null;
  const cachedLaunchPosts = userId === 'explore' ? [] : getProfileFeedLaunchCache(userId, status);
  const initialPosts = useMemo(() => {
    const normalizedCachedPosts = cachedLaunchPosts.map((post) => normalizePost(post));
    if (initialPost && !normalizedCachedPosts.find((post) => post.id === initialPost.id)) {
      return [initialPost, ...normalizedCachedPosts];
    }
    return normalizedCachedPosts.length > 0 ? normalizedCachedPosts : (initialPost ? [initialPost] : []);
  }, [cachedLaunchPosts, initialPost]);

  const [posts, setPosts] = useState<Post[]>(initialPosts);
  const [loading, setLoading] = useState(initialPosts.length === 0);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isScreenFocused, setIsScreenFocused] = useState(true);
  const [isFeedTransitioning, setIsFeedTransitioning] = useState(false);
  const [initialScrollDone, setInitialScrollDone] = useState(false);
  const lastActiveIndexRef = useRef(0);
  const loadVersionRef = useRef(0);
  const [reportModalVisible, setReportModalVisible] = useState(false);
  const [reportPostId, setReportPostId] = useState<string | null>(null);
  const [commentsModalVisible, setCommentsModalVisible] = useState(false);
  const [commentsPostId, setCommentsPostId] = useState<string | null>(null);
  const [commentsPostTitle, setCommentsPostTitle] = useState<string>('');
  const [commentsPostAuthor, setCommentsPostAuthor] = useState<string>('');
  const [username, setUsername] = useState<string>('');
  const flatListRef = useRef<FlatList>(null);
  const { user } = useAuth();
  const { syncLikedPostsFromServer, followedUsers, updateFollowedUsers, syncFollowedUsersFromServer } = useCache();
  const dispatch = useAppDispatch();
  const likedPosts = useAppSelector(state => state.likes.likedPosts);
  const { isCreateFocused } = useCreateFocus();
  const insets = useSafeAreaInsets();
  const likesManager = useLikesManager();
  const [userFollowStatus, setUserFollowStatus] = useState<Record<string, boolean>>({});

  const isExplore = userId === 'explore';
  const isOwnProfile = !isExplore && !!user && user.id === userId;

  useEffect(() => {
    if (initialPosts.length > 0) {
      primePostDetailsCache(initialPosts);
    }
  }, [initialPosts]);

  // Full viewport height: one item = entire screen, only progress bar at bottom (no bottom tab here)
  const availableHeight = screenHeight - insets.top;

  // CRITICAL FIX: Increased limit to fetch all posts from database
  const LIMIT = 100;

  useRefetchOnReconnect(() => loadPosts(1, true));

  useEffect(() => {
    if (!initialPostId || initialScrollDone || posts.length === 0) {
      return;
    }

    const initialIndex = posts.findIndex((post) => post.id === initialPostId);
    if (initialIndex < 0) {
      return;
    }

    const timer = setTimeout(() => {
      flatListRef.current?.scrollToIndex({ index: initialIndex, animated: false });
      setCurrentIndex(initialIndex);
      setInitialScrollDone(true);
    }, 0);

    return () => clearTimeout(timer);
  }, [initialPostId, initialScrollDone, posts]);

  const loadPosts = useCallback(async (page = 1, refresh = false) => {
    const thisVersion = ++loadVersionRef.current;
    try {
      if (refresh) {
        setRefreshing(true);
        setCurrentPage(1);
        setHasMore(true);
      } else if (page === 1) {
        if (posts.length === 0) setLoading(true);
      } else {
        setLoadingMore(true);
      }

      const postStatus = status || 'active';
      const isExplore = userId === 'explore';
      const isOwnProfile = !isExplore && user && user.id === userId;

      let response;
      let postsArray: Post[] = [];

      if (isExplore) {
        let explorePosts: Post[] = [];

        const cachedExplorePosts = getExplorePostsCache();
        if (cachedExplorePosts.length > 0) {
          explorePosts = cachedExplorePosts;
        }

        // If Explore grid passed us the exact posts, use them directly
        if (explorePosts.length === 0 && explorePostsData) {
          try {
            const parsed = JSON.parse(explorePostsData);
            if (Array.isArray(parsed)) {
              explorePosts = parsed as Post[];
            }
          } catch {
            // Fallback to API fetch below
          }
        }

        // Fallback: if we still have no posts, fetch via API + filters
        if (explorePosts.length === 0) {
          const [categoriesRes, postsRes] = await Promise.all([
            categoriesApi.getAll(),
            postsApi.getAll(1, 100),
          ]);
          const categories = (categoriesRes.data as any)?.categories ?? [];
          const allPosts = (postsRes.data as any)?.posts ?? [];
          const mainId = exploreMainCategoryId ? parseInt(exploreMainCategoryId, 10) : null;
          const subId = exploreSubCategoryId ? parseInt(exploreSubCategoryId, 10) : null;
          const cId = exploreCountryId ? parseInt(exploreCountryId, 10) : null;

          explorePosts = filterSecondarySurfacePosts(allPosts);
          explorePosts = applyExploreFilters(
            explorePosts,
            categories,
            isNaN(mainId as number) ? null : mainId,
            isNaN(subId as number) ? null : subId,
            isNaN(cId as number) ? null : cId
          );
        }

        // SAFETY: Always include the tapped post, even if filters are weird
        if (initialPostId && !explorePosts.find(p => p.id === initialPostId)) {
          try {
            const cachedPost = await getPostDetailCached(initialPostId, { requireNetwork: true });
            if (cachedPost) {
              explorePosts.unshift(cachedPost as Post);
            }
          } catch {
            // ignore – we just skip the safety post
          }
        }

        postsArray = explorePosts;
        // Explore feed does not depend on response.status
        response = { status: 'success' } as any;
        setHasMore(false);
      } else if (isOwnProfile) {
        // Use getOwnPosts for current user's posts (has full data including media URLs)
        response = await userApi.getOwnPosts();
        if (response.status === 'success' && response.data?.posts) {
          let allPosts = response.data.posts || [];
          // Filter by status
          if (postStatus === 'active') {
            // Show active posts (or legacy approved posts, or posts with no status default to active)
            postsArray = allPosts.filter((p: any) =>
              p.status === 'active' ||
              p.status === 'approved' || // Legacy support
              !p.status // Default to active
            );
          } else if (postStatus === 'draft') {
            postsArray = allPosts.filter((p: any) => p.status === 'draft');
          } else if (postStatus === 'suspended') {
            // Show suspended posts (or legacy rejected/reported posts)
            postsArray = allPosts.filter((p: any) =>
              p.status === 'suspended' ||
              p.status === 'rejected' || // Legacy support
              p.status === 'reported' // Legacy support
            );
          } else {
            // Legacy status support
            if (postStatus === 'approved') {
              postsArray = allPosts.filter((p: any) => p.status === 'approved' || !p.status);
            } else if (postStatus === 'pending') {
              postsArray = allPosts.filter((p: any) => p.status === 'pending');
            } else if (postStatus === 'rejected') {
              postsArray = allPosts.filter((p: any) => p.status === 'rejected');
            } else if (postStatus === 'reported') {
              postsArray = allPosts.filter((p: any) => p.status === 'reported');
            } else {
              postsArray = allPosts;
            }
          }
        }
      } else if (challengeId) {
        // Show only this user's posts that were submitted to this competition
        const res = await challengesApi.getPosts(challengeId, 1, 100);
        if (res.status === 'success') {
          const raw = res.data?.posts ?? res.data ?? [];
          const list = Array.isArray(raw) ? raw : [];
          const uid = userId;
          postsArray = list
            .map((item: any) => item.post || item)
            .filter((p: any) => p && (String(p.user_id) === uid || String(p.user?.id) === uid || String(p.userId) === uid));
        }
        setHasMore(false);
        response = { status: 'success' } as any;
      } else {
        // Use getUserPosts for other users' posts
        response = await userApi.getUserPosts(userId, page, LIMIT, postStatus as string);
        if (response.status === 'success') {
          const postsData = response.data?.posts || response.data || [];
          postsArray = Array.isArray(postsData) ? postsData : [];
        }
      }

      // Log posts structure for debugging
      // CRITICAL: Normalize posts from API — backend returns camelCase fields
      // but the video player and UI expects snake_case fields
      postsArray = postsArray.map((p: any) => {
        return normalizePost({
          ...p,
          user: p.user || {
            id: p.user_id || p.userId || userId,
            username: p.authorName || p.username || '',
            profile_picture: p.authorProfilePicture || p.profile_picture || '',
          },
        });
      });
      postsArray = filterSecondarySurfacePosts(postsArray);
      primePostDetailsCache(postsArray);

      if (response?.status === 'success' && postsArray.length >= 0) {
        const pagination = response.data?.pagination || {};
        const hasMoreData = pagination.hasNextPage !== false && postsArray.length === LIMIT;
        setHasMore(hasMoreData);

        const likeCountsMap: Record<string, number> = {};
        postsArray.forEach((post: Post) => {
          if (post.likes !== undefined) {
            likeCountsMap[post.id] = post.likes;
          }
        });
        if (Object.keys(likeCountsMap).length > 0) {
          dispatch(setPostLikeCounts(likeCountsMap));
        }

        // ─── ENRICHMENT: Fetch HLS URLs BEFORE setting posts in state ───
        // This ensures the FlatList only ever receives playable posts,
        // matching how the For You feed works (posts arrive pre-enriched).
        const postsNeedingEnrichment = postsArray.filter(
          (p: any) => {
            const processingStatus = p.processing_status ?? p.processingStatus ?? '';
            const needsPlaybackData = p.hlsReady && !p.hls_url && !p.fullUrl?.includes('.m3u8');
            const staleProcessingState =
              p.type === 'video' &&
              !!processingStatus &&
              processingStatus !== 'completed' &&
              processingStatus !== 'failed';
            return (
              needsPlaybackData ||
              staleProcessingState ||
              needsRenderableMediaEnrichment(p) ||
              needsChallengeMetaEnrichment(p)
            );
          }
        );

        if (postsNeedingEnrichment.length > 0) {
          if (__DEV__) {
            console.log(`🔄 [ProfileFeed] Enriching ${postsNeedingEnrichment.length} posts with full data...`);
          }

          const videoAssetMap = await getPostVideoAssetsBatchCached(
            postsNeedingEnrichment
              .filter((p: any) => p.type === 'video')
              .map((p: any) => p.id),
          );
          const enrichMap = await getPostDetailsCached(
            postsNeedingEnrichment.map((p: any) => p.id),
            { requireNetwork: true },
          );

          // Merge enriched data back, including any challenge / competition metadata.
          postsArray = postsArray.map((p: any) => {
            const videoAssets = videoAssetMap.get(p.id);
            const enriched = enrichMap.get(p.id);
            if (!enriched && !videoAssets) return p;

            const enrichedFirstChallengePost = Array.isArray(enriched?.challenge_posts)
              ? enriched.challenge_posts[0]
              : undefined;
            const enrichedChallenge =
              enriched?.challenge ||
              enriched?.competition ||
              enrichedFirstChallengePost?.challenge;

            const enrichedChallengeId =
              enriched?.challenge_id ||
              enriched?.challengeId ||
              enrichedChallenge?.id ||
              enrichedFirstChallengePost?.challenge_id;

            const enrichedChallengeName =
              enriched?.challenge_name ||
              enriched?.challengeName ||
              enrichedChallenge?.name;

            return {
              ...normalizePost({
                ...p,
                ...videoAssets,
                ...enriched,
                user: enriched?.user || p.user,
                challenge: enrichedChallenge || p.challenge || p.competition,
                challenge_id: enrichedChallengeId || p.challenge_id || p.challengeId,
                challengeId: enrichedChallengeId || p.challengeId || p.challenge_id,
                challenge_name: enrichedChallengeName || p.challenge_name || p.challengeName,
                challengeName: enrichedChallengeName || p.challengeName || p.challenge_name,
              }),
            };
          });

          if (__DEV__) {
            console.log(`✅ [ProfileFeed] Enriched ${enrichMap.size} posts with HLS data`);
          }
        }

        // Bail out if a newer loadPosts call has started while we were enriching
        if (thisVersion !== loadVersionRef.current) {
          if (__DEV__) {
            console.log(`⏭️ [ProfileFeed] Stale load (v${thisVersion} < v${loadVersionRef.current}), skipping setPosts`);
          }
          return;
        }

        // ─── SINGLE setPosts: posts are now fully enriched with HLS URLs ───
        if (page === 1 || refresh) {
          const sortedPosts = [...postsArray].sort((a, b) => {
            const dateA = new Date(a.createdAt || a.uploadDate || 0).getTime();
            const dateB = new Date(b.createdAt || b.uploadDate || 0).getTime();
            return dateB - dateA;
          });

          setPosts(sortedPosts);
          primePostDetailsCache(sortedPosts);

          if (sortedPosts.length > 0 && sortedPosts[0].user?.username) {
            setUsername(sortedPosts[0].user.username);
          }

          if (!initialScrollDone) {
            if (initialPostId) {
              const initialIndex = sortedPosts.findIndex((p: Post) => p.id === initialPostId);
              if (initialIndex >= 0) {
                setTimeout(() => {
                  flatListRef.current?.scrollToIndex({ index: initialIndex, animated: false });
                  setCurrentIndex(initialIndex);
                  setInitialScrollDone(true);
                }, 0);
              } else {
                setInitialScrollDone(true);
              }
            } else {
              setInitialScrollDone(true);
            }
          }
        } else {
          setPosts(prev => {
            const existingIds = new Set(prev.map(p => p.id));
            const newPosts = postsArray.filter(p => p.id && !existingIds.has(p.id));
            return [...prev, ...newPosts];
          });
        }

        if (__DEV__) {
          console.log('📥 [ProfileFeed fetchPosts] API Response:', {
            status: response?.status,
            isOwnProfile,
            postStatus,
            postsCount: postsArray.length,
            firstPost: postsArray[0] ? {
              id: postsArray[0].id,
              type: postsArray[0].type,
              hls_url: (postsArray[0] as any).hls_url,
              hlsUrl: (postsArray[0] as any).hlsUrl,
              fullUrl: (postsArray[0] as any).fullUrl,
            } : null,
          });
        }

        // Sync liked posts and follow status in background (non-blocking)
        if (user && postsArray.length > 0) {
          const postIds = postsArray.map((p: Post) => p.id);
          syncLikedPostsFromServer(postIds).catch(console.error);
          const uniqueUserIds = [...new Set(postsArray.map((p: Post) => p.user?.id).filter(Boolean))] as string[];
          Promise.all(
            uniqueUserIds.map(async (uid: string) => {
              try {
                const res = await followsApi.checkFollowing(uid);
                return { userId: uid, isFollowing: !!res.data?.isFollowing };
              } catch {
                return { userId: uid, isFollowing: false };
              }
            })
          ).then((followStatuses) => {
            const followMap: Record<string, boolean> = {};
            followStatuses.forEach(({ userId: uid, isFollowing }) => {
              followMap[uid] = isFollowing;
              updateFollowedUsers(uid, isFollowing);
            });
            setUserFollowStatus(prev => ({ ...prev, ...followMap }));
          });
        }

        if (page === 1 || refresh) {
          setRefreshing(false);
          setLoading(false);
        }
      } else {
        if (page === 1) {
          setPosts([]);
        }
        setHasMore(false);
      }
    } catch (error: any) {
      console.warn('[ProfileFeed] Error loading posts:', error?.message || 'Unknown error');
      if (page === 1) {
        setPosts([]);
      }
      setHasMore(false);
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, [userId, status, user, dispatch, syncLikedPostsFromServer, updateFollowedUsers, initialPostId, initialScrollDone, exploreMainCategoryId, exploreSubCategoryId, exploreCountryId, explorePostsData]);

  const loadMorePosts = useCallback(() => {
    if (!loadingMore && hasMore && !loading) {
      const nextPage = currentPage + 1;
      setCurrentPage(nextPage);
      loadPosts(nextPage, false);
    }
  }, [loadPosts, loadingMore, hasMore, loading, currentPage]);

  useEffect(() => {
    if (userId) {
      loadPosts(1, false);
    }
  }, [userId, status]);

  // Track current index with ref to avoid infinite loops
  const currentIndexRef = useRef(0);

  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  useFocusEffect(
    useCallback(() => {
      setIsScreenFocused(true);
      if (lastActiveIndexRef.current >= 0) {
        setCurrentIndex(lastActiveIndexRef.current);
      }
      return () => {
        // Use ref to avoid dependency issues
        setIsScreenFocused(false);
        lastActiveIndexRef.current = currentIndexRef.current;
        // expo-video handles pause/play internally via useVideoPlayer source changes
      };
    }, []) // Empty dependency array - only run on focus/blur
  );

  useEffect(() => {
    if (posts.length === 0) {
      return;
    }

    warmFeedWindow(posts, Math.max(0, currentIndex));
  }, [currentIndex, posts]);

  const onRefresh = () => {
    setCurrentPage(1);
    setHasMore(true);
    setInitialScrollDone(false);
    loadPosts(1, true);
  };

  const handleLike = async (postId: string) => {
    if (!user) {
      Alert.alert(
        'Login Required',
        'Please log in to like posts.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Login', onPress: () => router.push('/auth/login') }
        ]
      );
      return;
    }

    await likesManager.toggleLike(postId);

    const newLikeCount = likesManager.getLikeCount(postId);
    setPosts(prevPosts =>
      prevPosts.map(post =>
        post.id === postId
          ? { ...post, likes: newLikeCount }
          : post
      )
    );
  };

  const handleComment = useCallback((postId: string) => {
    if (!postId) return;

    const post = posts.find(p => p.id === postId);
    setCommentsPostId(postId);
    setCommentsPostTitle(post?.title || post?.description || '');
    setCommentsPostAuthor(post?.user?.username || '');
    setCommentsModalVisible(true);
  }, [posts]);

  const handleShare = async (postId: string) => {
    const post = posts.find(p => p.id === postId);
    if (post) {
      try {
        await sharePost(post);
      } catch (error) {
        // Silently handle share errors
      }
    }
  };

  const handleReport = (postId: string) => {
    if (!user) {
      router.push('/auth/login');
      return;
    }
    setReportPostId(postId);
    setReportModalVisible(true);
  };

  const handleFollow = async (targetUserId: string) => {
    if (!user) return;
    seedFollowingFeedCache(user.id, targetUserId, posts);
    updateFollowedUsers(targetUserId, true);
    setUserFollowStatus(prev => ({ ...prev, [targetUserId]: true }));
    try {
      const response = await followsApi.follow(targetUserId);
      if (response.status !== 'success') {
        updateFollowedUsers(targetUserId, false);
        setUserFollowStatus(prev => ({ ...prev, [targetUserId]: false }));
        removeUserFromFollowingFeedCache(user.id, targetUserId);
      } else {
        void syncFollowedUsersFromServer();
        void prefetchFollowingFeed(user.id);
      }
    } catch {
      updateFollowedUsers(targetUserId, false);
      setUserFollowStatus(prev => ({ ...prev, [targetUserId]: false }));
      removeUserFromFollowingFeedCache(user.id, targetUserId);
    }
  };

  const handleUnfollow = async (targetUserId: string) => {
    if (!user) return;
    removeUserFromFollowingFeedCache(user.id, targetUserId);
    updateFollowedUsers(targetUserId, false);
    setUserFollowStatus(prev => ({ ...prev, [targetUserId]: false }));
    try {
      const response = await followsApi.unfollow(targetUserId);
      if (response.status !== 'success') {
        updateFollowedUsers(targetUserId, true);
        setUserFollowStatus(prev => ({ ...prev, [targetUserId]: true }));
        seedFollowingFeedCache(user.id, targetUserId, posts);
      } else {
        void syncFollowedUsersFromServer();
      }
    } catch {
      updateFollowedUsers(targetUserId, true);
      setUserFollowStatus(prev => ({ ...prev, [targetUserId]: true }));
      seedFollowingFeedCache(user.id, targetUserId, posts);
    }
  };

  const handlePublishDraft = async (postId: string) => {
    const draftPost = posts.find(p => p.id === postId);
    if (!draftPost) return;

    Alert.alert(
      'Publish Post',
      'Are you sure you want to publish this draft? It will be submitted for review.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Publish',
          style: 'default',
          onPress: async () => {
            try {
              const { postsApi } = await import('@/lib/api');
              const response = await postsApi.publishDraft(postId);

              if (response.status === 'success') {
                // Remove from drafts list
                setPosts(prevPosts => prevPosts.filter(post => post.id !== postId));
                Alert.alert('Success', 'Your post has been published and is pending review.', [{ text: 'OK' }]);
                // Refresh posts
                await loadPosts(1, true);
              } else {
                Alert.alert('Error', response.message || 'Failed to publish post. Please try again.');
              }
            } catch (error: any) {
              Alert.alert('Error', error?.message || 'Failed to publish post. Please try again.');
            }
          }
        }
      ]
    );
  };

  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    if (viewableItems.length > 0) {
      const visibleItem = viewableItems[0];
      const newIndex = visibleItem.index || 0;
      const postId = visibleItem.item?.id;

      if (postId) {
        likesManager.onPostVisible(postId);
      }

      setIsFeedTransitioning(false);
      setCurrentIndex(newIndex);
      lastActiveIndexRef.current = newIndex;
    } else {
      setIsFeedTransitioning(false);
      setCurrentIndex(-1);
    }
  }).current;

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 80, // Higher threshold for full-screen pagination
    minimumViewTime: 200,
    waitForInteraction: false,
  }).current;

  if (loading && posts.length === 0) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#60a5fa" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" translucent />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => safeRouterBack(router, '/(tabs)/explore' as any)}
          accessibilityLabel="Go back"
          accessibilityRole="button"
        >
          <Feather name="arrow-left" size={24} color="#fff" />
        </TouchableOpacity>

        <Text style={styles.headerTitle}>
          {userId === 'explore' ? 'Explore' : username ? `@${username}'s Posts` : 'Posts'}
        </Text>

        <View style={styles.headerSpacer} />
      </View>

      <FlatList
          ref={flatListRef}
          data={posts}
          renderItem={({ item, index }) => {
            const isActive = isScreenFocused && currentIndex === index;
            const shouldPreload = shouldPreloadFeedVideo(index, currentIndex, {
              disabled: isCreateFocused || isActive,
            });
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
                isLiked={likedPosts.includes(item.id)}
                isFollowing={userFollowStatus[item.user?.id || ''] ?? followedUsers.has(item.user?.id || '')}
                isActive={isActive}
                suspendPlayback={isFeedTransitioning}
                shouldPreload={shouldPreload}
                availableHeight={availableHeight}
                showReportButton={!isOwnProfile}
              />
            );
          }}
          keyExtractor={(item, index) => {
            // Ensure unique keys - use id if available, fallback to index
            return item.id ? `post-${item.id}` : `post-${index}`;
          }}
          pagingEnabled={Platform.OS === 'ios'}
          showsVerticalScrollIndicator={false}
          snapToInterval={Platform.OS === 'android' ? availableHeight : undefined}
          snapToAlignment="start"
          decelerationRate="fast"
          contentContainerStyle={{ paddingBottom: 0 }}
          windowSize={VIDEO_FEED_WINDOW_SIZE}
          initialNumToRender={VIDEO_FEED_INITIAL_NUM_TO_RENDER}
          maxToRenderPerBatch={VIDEO_FEED_MAX_TO_RENDER_PER_BATCH}
          removeClippedSubviews={VIDEO_FEED_REMOVE_CLIPPED_SUBVIEWS}
          getItemLayout={(data, index) => ({
            length: availableHeight,
            offset: availableHeight * index,
            index,
          })}
          extraData={posts.length}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#60a5fa"
              progressViewOffset={20}
            />
          }
          onScrollBeginDrag={() => setIsFeedTransitioning(true)}
          onMomentumScrollBegin={() => setIsFeedTransitioning(true)}
          onMomentumScrollEnd={(event) => {
            const nextIndex = Math.round(event.nativeEvent.contentOffset.y / availableHeight);
            setCurrentIndex(nextIndex);
            lastActiveIndexRef.current = nextIndex;
            setIsFeedTransitioning(false);
          }}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          onEndReached={loadMorePosts}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            loadingMore ? (
              <View style={[styles.loadingMore, { height: availableHeight * 0.2 }]}>
                <ActivityIndicator size="small" color="#60a5fa" />
              </View>
            ) : null
          }
          ListEmptyComponent={
            !loading ? (
              <View style={[styles.emptyContainer, { height: availableHeight }]}>
                <Feather name="video-off" size={64} color="#666" />
                <Text style={styles.emptyText}>No posts to show</Text>
              </View>
            ) : null
          }
          onScrollToIndexFailed={(info) => {
            setTimeout(() => {
              flatListRef.current?.scrollToIndex({
                index: Math.min(info.index, posts.length - 1),
                animated: false
              });
            }, 100);
          }}
        />

      {/* Report Modal */}
      <ReportModal
        isVisible={reportModalVisible}
        postId={reportPostId}
        onClose={() => {
          setReportModalVisible(false);
          setReportPostId(null);
        }}
        onReported={() => {
          setReportModalVisible(false);
          setReportPostId(null);
        }}
      />

      {/* Comments Modal */}
      <CommentsModal
        visible={commentsModalVisible}
        postId={commentsPostId || ''}
        postTitle={commentsPostTitle}
        postAuthor={commentsPostAuthor}
        onClose={() => {
          setCommentsModalVisible(false);
          setCommentsPostId(null);
        }}
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
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: FEED_BG,
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    zIndex: 100,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  headerSpacer: {
    width: 40,
  },
  postContainer: {
    width: screenWidth,
    backgroundColor: FEED_BG,
  },
  mediaContainer: {
    width: screenWidth,
    position: 'relative',
    backgroundColor: FEED_BG,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  mediaWrapper: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: FEED_BG,
    overflow: 'visible',
  },
  media: {
    width: '100%',
    height: '100%',
    backgroundColor: FEED_BG,
  },
  placeholderContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
  },
  placeholderText: {
    color: '#666',
    marginTop: 8,
    fontSize: 14,
  },
  playIconOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  playIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingLeft: 4,
  },
  muteIndicator: {
    position: 'absolute',
    top: 80,
    right: 16,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 20,
    padding: 8,
  },
  muteIndicatorOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 15,
    pointerEvents: 'none',
  },
  muteIndicatorBadge: {
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 40,
    padding: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  muteButtonCorner: {
    position: 'absolute',
    right: 16,
    zIndex: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  progressBarContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 3,
    zIndex: 15,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#fff',
  },
  videoProgressBarContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    zIndex: 100,
  },
  videoProgressBarFill: {
    height: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
  },
  heartOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionsContainer: {
    position: 'absolute',
    right: 12,
    bottom: 100,
    alignItems: 'center',
    gap: 20,
    zIndex: 10,
  },
  avatarContainer: {
    marginBottom: 8,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: '#fff',
  },
  actionButton: {
    alignItems: 'center',
    gap: 4,
  },
  actionText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '500',
  },
  bottomInfo: {
    position: 'absolute',
    left: 12,
    right: 80,
    bottom: 0,
    zIndex: 10,
    paddingBottom: 8,
    maxHeight: '40%', // Ensure it doesn't take too much space
  },
  bottomInfoContent: {
    marginBottom: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    borderRadius: 12,
    padding: 12,
    maxWidth: '100%',
  },
  username: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  caption: {
    color: '#fff',
    fontSize: 14,
    lineHeight: 20,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  showMoreText: {
    color: '#aaa',
    fontSize: 14,
    marginTop: 4,
  },
  timestamp: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 11,
    marginTop: 4,
    textShadowColor: 'rgba(0, 0, 0, 0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  categoryBadge: {
    backgroundColor: 'rgba(96, 165, 250, 0.8)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    alignSelf: 'flex-start',
    marginTop: 4,
    marginBottom: 8,
  },
  categoryText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '500',
  },
  loadingMore: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyText: {
    color: '#666',
    fontSize: 18,
    marginTop: 16,
    textAlign: 'center',
  },
  publishDraftButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#60a5fa',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginTop: 8,
    alignSelf: 'flex-start',
    gap: 6,
  },
  publishDraftButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});
