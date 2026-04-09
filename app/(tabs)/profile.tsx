import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  FlatList,
  Modal,
  SafeAreaView,
  Share,
  Alert,
  RefreshControl,
  Dimensions,
  Animated,
  Platform,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@/lib/auth-context';
import { useRefetchOnReconnect } from '@/lib/hooks/use-network-status';
import { userApi, postsApi, likesApi, challengesApi } from '@/lib/api';
import { Post } from '@/types';
import { MaterialIcons, Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EditProfileModal } from '@/components/EditProfileModal';
import DotsSpinner from '@/components/DotsSpinner';
import { useLikesManager } from '@/lib/hooks/use-likes-manager';
import { useAppDispatch, useAppSelector } from '@/lib/store/hooks';
import { addLikedPost, removeLikedPost, setPostLikeCount } from '@/lib/store/slices/likesSlice';
import { LinearGradient } from 'expo-linear-gradient';
import { getFileUrl, getThumbnailUrl, getProfilePictureUrl } from '@/lib/utils/file-url';
import { sharePost } from '@/lib/post-share';
import { Avatar } from '@/components/Avatar';
import { getChallengePostMeta } from '@/lib/utils/challenge-post';
import { isChallengeParticipationOpen } from '@/lib/utils/challenge';
import { localNotificationEvents } from '@/lib/local-notification-events';
import { normalizePost } from '@/lib/utils/normalize-post';
import { getCachedPostDetail, getPostDetailsCached, primePostDetailsCache } from '@/lib/post-details-cache';
import { getPostVideoAssetsBatchCached } from '@/lib/post-video-assets-cache';
import { getPostVideoAssetsCached } from '@/lib/post-video-assets-cache';
import { setProfileFeedLaunchCache } from '@/lib/profile-feed-launch-cache';
import { PostAppealModal } from '@/components/PostAppealModal';
import {
  isRecentVideoUpload,
  needsChallengeMetaEnrichment,
  needsRenderableMediaEnrichment,
} from '@/lib/utils/post-detail-enrichment';
import { filterSecondarySurfacePosts } from '@/lib/utils/post-filter';

const { width: screenWidth } = Dimensions.get('window');
const POST_ITEM_SIZE = (screenWidth - 4) / 3; // 3 columns with 2px gaps
const PROFILE_POST_ROW_HEIGHT = POST_ITEM_SIZE / 0.75 + 2;


// Post thumbnail component — STATIC ONLY, no video playback on profile grid
// DATA SAVER: No video players are created on profile. Only thumbnail images.
interface VideoThumbnailProps {
  post: Post;
  isActive: boolean;
  onPress: () => void;
  onOptionsPress?: () => void;
  onPublishPress?: () => void;
  onSubmitToCompetitionPress?: () => void;
  onUseContentPress?: () => void;
  onViewsPress?: () => void;
}

const VideoThumbnail = ({ post, isActive, onPress, onOptionsPress, onPublishPress, onSubmitToCompetitionPress, onUseContentPress, onViewsPress }: VideoThumbnailProps) => {
  const [imageError, setImageError] = useState(false);
  const [showAppealModal, setShowAppealModal] = useState(false);
  const isSuspended = (post.status as string) === 'suspended' || (post.status as string) === 'rejected' || (post.status as string) === 'reported';

  const isVideo = post.type === 'video' || !!(post.video_url || post.videoUrl);
  const challengeMeta = getChallengePostMeta(post);
  const processingStatus = (post as any).processing_status || (post as any).processingStatus || '';
  const showProcessingBadge =
    isVideo &&
    isRecentVideoUpload(post) &&
    (
      processingStatus === 'pending' ||
      processingStatus === 'processing' ||
      processingStatus === 'uploading'
    );

  // THUMBNAIL:
  // - Video posts: ONLY use server-generated thumbnail_url (or enriched assets).
  //   Never derive from fullUrl/playback_url (HLS .m3u8) to avoid invalid image URLs.
  // - Image posts: fall back to the actual image URL when thumbnail_url is missing.
  let serverThumbnail = getThumbnailUrl(post);

  // Extra safety: if backend/enrichment still didn't give us a thumbnail for a
  // video post, but we have an HLS fullUrl, derive the standard Cloudflare
  // thumbnail path: https://media.../hls/<id>/master.m3u8 -> /thumbnails/<id>_thumbnail.jpg
  if (isVideo && !serverThumbnail) {
    const fullUrl: string | undefined = (post as any).fullUrl;
    if (fullUrl && typeof fullUrl === 'string' && fullUrl.includes('.m3u8')) {
      try {
        const normalized = fullUrl.split('?')[0];
        const match = normalized.match(/^(https?:\/\/[^/]+)\/hls\/([^/]+)\/[^/]+\.m3u8$/i);
        if (match) {
          const [, origin, videoId] = match;
          serverThumbnail = `${origin}/thumbnails/${videoId}_thumbnail.jpg`;
        }
      } catch {
        // best-effort only
      }
    }
  }
  const postImage =
    (post as any).image ||
    (post as any).thumbnail ||
    (post as any).imageUrl ||
    '';
  const imageUrl = getFileUrl(postImage || '') || null;
  const thumbnailUrl = serverThumbnail || (!isVideo ? imageUrl : null);
  const [resolvedThumbnailUrl, setResolvedThumbnailUrl] = useState<string | null>(thumbnailUrl);

  useEffect(() => {
    setImageError(false);
    setResolvedThumbnailUrl(thumbnailUrl);
  }, [thumbnailUrl]);

  useEffect(() => {
    let cancelled = false;

    if (!isVideo || resolvedThumbnailUrl || !post?.id) {
      return () => {
        cancelled = true;
      };
    }

    getPostVideoAssetsCached(post.id)
      .then((assets) => {
        if (cancelled || !assets) return;
        const repairedThumbnail =
          getFileUrl(assets.thumbnail_url || assets.thumbnailUrl || '') ||
          getFileUrl((assets as any).image || (assets as any).thumbnail || '');
        if (repairedThumbnail) {
          setResolvedThumbnailUrl(repairedThumbnail);
        }
      })
      .catch(() => {
        // Best-effort thumbnail repair only.
      });

    return () => {
      cancelled = true;
    };
  }, [isVideo, post?.id, resolvedThumbnailUrl]);

  return (
    <TouchableOpacity
      style={styles.postItem}
      onPress={onPress}
      onLongPress={onOptionsPress}
      activeOpacity={0.9}
    >
      {/* Static thumbnail image only — NO video player */}
      {resolvedThumbnailUrl && !imageError ? (
        <ExpoImage
          source={{ uri: resolvedThumbnailUrl }}
          style={styles.postMedia}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={0}
          onError={() => setImageError(true)}
          recyclingKey={post.id}
        />
      ) : (
        <View style={[styles.postMedia, styles.noMediaPlaceholder]}>
          <MaterialIcons name={isVideo ? "video-library" : "image"} size={28} color="#666" />
        </View>
      )}

      {/* Overlay with stats */}
      <View style={styles.postOverlay}>
        <View style={styles.postStats}>
          <Feather name="heart" size={12} color="#fff" />
          <Text style={styles.postStatText}>{formatNumber(post.likes || 0)}</Text>
        </View>

        {/* Status indicator */}
        <View style={[
          styles.statusIndicator,
          { backgroundColor: getStatusColor(post.status || 'active') }
        ]}>
          <MaterialIcons
            name={getStatusIcon(post.status || 'active') as any}
            size={10}
            color="#fff"
          />
        </View>
      </View>

      {/* Video play icon */}
      {isVideo && (
        <View style={styles.videoPlayIndicator}>
          <Feather name="play" size={14} color="#fff" />
        </View>
      )}

      {/* HLS Processing Badge */}
      {showProcessingBadge && (
          <View style={styles.processingBadge}>
            <ActivityIndicator size="small" color="#fff" />
            <Text style={styles.processingBadgeText}>
              {processingStatus === 'uploading' ? 'Uploading...' : 'Processing...'}
            </Text>
          </View>
        )}

      {challengeMeta.isChallengePost && (
        <LinearGradient
          colors={['rgba(14, 116, 144, 0.95)', 'rgba(37, 99, 235, 0.95)']}
          style={styles.challengePostBadge}
        >
          <Feather name="award" size={12} color="#fff" />
          <View style={styles.challengePostBadgeTextWrap}>
            <Text style={styles.challengePostBadgeLabel}>Competition</Text>
            <Text style={styles.challengePostBadgeName} numberOfLines={1}>
              {challengeMeta.challengeName || 'Challenge post'}
            </Text>
          </View>
        </LinearGradient>
      )}

      {/* Options button (3 dots) */}
      {onOptionsPress && (
        <TouchableOpacity
          style={styles.postOptionsButton}
          onPress={(e) => {
            e.stopPropagation();
            onOptionsPress();
          }}
          activeOpacity={0.7}
        >
          <Feather name="more-vertical" size={16} color="#fff" />
        </TouchableOpacity>
      )}

      {/* Publish button for draft posts */}
      {(() => {
        const isDraft = post.status === 'draft' || post.status === 'Draft';
        return isDraft && onPublishPress;
      })() && (
          <TouchableOpacity
            style={styles.publishDraftButton}
            onPress={(e) => {
              e.stopPropagation();
              onPublishPress?.();
            }}
            activeOpacity={0.8}
          >
            <Feather name="send" size={14} color="#fff" />
            <Text style={styles.publishDraftButtonText}>Publish</Text>
          </TouchableOpacity>
        )}
      {/* Use Content for draft posts: opens Publish normally / Submit to competition */}
      {(() => {
        const isDraft = post.status === 'draft' || post.status === 'Draft';
        return isDraft && onUseContentPress;
      })() && (
          <TouchableOpacity
            style={styles.submitToCompetitionDraftButton}
            onPress={(e) => {
              e.stopPropagation();
              onUseContentPress?.();
            }}
            activeOpacity={0.8}
          >
            <Feather name="inbox" size={14} color="#fff" />
            <Text style={styles.submitToCompetitionDraftButtonText}>Use Content</Text>
          </TouchableOpacity>
        )}

      {/* Suspended post appeal button */}
      {isSuspended && (
        <TouchableOpacity
          style={styles.suspendedAppealButton}
          onPress={(e) => {
            e.stopPropagation();
            setShowAppealModal(true);
          }}
          activeOpacity={0.8}
        >
          <MaterialIcons name="gavel" size={14} color="#fff" />
          <Text style={styles.suspendedAppealButtonText}>Appeal</Text>
        </TouchableOpacity>
      )}

      <PostAppealModal
        visible={showAppealModal}
        postId={post.id}
        onClose={() => setShowAppealModal(false)}
        onAppealed={() => setShowAppealModal(false)}
      />
    </TouchableOpacity>
  );
};

// Helper functions moved outside component for use in VideoThumbnail
const formatNumber = (num: number): string => {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  }
  return num.toString();
};

const getPostTimestamp = (post: Post) =>
  new Date(post.createdAt || post.uploadDate || (post as any).created_at || 0).getTime();

const normalizeProfilePost = (post: any): Post => {
  return normalizePost(post);
};

const sortPostsNewestFirst = (items: Post[]) => [...items].sort((a, b) => getPostTimestamp(b) - getPostTimestamp(a));

const hasRenderableMedia = (p: any) => {
  const isVideo = p.type === 'video' || p.mediaType === 'video';
  const hasImage =
    !!p.image ||
    !!p.imageUrl ||
    !!p.thumbnail ||
    !!p.thumbnail_url ||
    !!p.thumbnailUrl;

  if (!isVideo) return hasImage;

  const hasHls =
    typeof p.fullUrl === 'string' &&
    p.fullUrl.toLowerCase().includes('.m3u8');

  return hasHls || hasImage;
};
const persistentProfilePostsCache: Record<string, Post[]> = {
  active: [],
  draft: [],
  suspended: [],
};

const MEDIA_CACHE_KEYS = [
  'thumbnail_url',
  'thumbnailUrl',
  'thumbnail',
  'hls_url',
  'hlsUrl',
  'playback_url',
  'fullUrl',
  'video_url',
  'videoUrl',
  'image',
  'imageUrl',
  'challenge',
  'challenge_id',
  'challengeId',
  'challenge_name',
  'challengeName',
  'challengePosts',
  'challenge_posts',
  'user',
  'category',
  'type',
  'mediaType',
  'streamType',
  'stream_type',
  'hlsReady',
  'processing_status',
  'processingStatus',
];

function pickFreshOrCachedField(fresh: any, cached: any, key: string) {
  const freshValue = fresh?.[key];

  if (typeof freshValue === 'string') {
    return freshValue.trim() !== '' ? freshValue : cached?.[key];
  }

  if (Array.isArray(freshValue)) {
    return freshValue.length > 0 ? freshValue : cached?.[key];
  }

  if (freshValue && typeof freshValue === 'object') {
    return Object.keys(freshValue).length > 0 ? freshValue : cached?.[key];
  }

  return freshValue ?? cached?.[key];
}

function mergeProfilePostWithCache(freshPost: any, cachedPost?: any) {
  if (!cachedPost) {
    return freshPost;
  }

  const merged = {
    ...cachedPost,
    ...freshPost,
  };

  MEDIA_CACHE_KEYS.forEach((key) => {
    const value = pickFreshOrCachedField(freshPost, cachedPost, key);
    if (value !== undefined) {
      merged[key] = value;
    }
  });

  return merged;
}

const getStatusColor = (status: string) => {
  switch (status) {
    case 'active': return '#10b981';
    case 'draft': return '#6b7280';
    case 'suspended': return '#ef4444';
    // Legacy status support (for migration period)
    case 'approved': return '#10b981';
    case 'pending': return '#f59e0b';
    case 'rejected': return '#ef4444';
    case 'reported': return '#8b5cf6';
    default: return '#10b981'; // Default to active
  }
};

const getStatusIcon = (status: string) => {
  switch (status) {
    case 'active': return 'check-circle';
    case 'draft': return 'drafts';
    case 'suspended': return 'cancel';
    // Legacy status support (for migration period)
    case 'approved': return 'check-circle';
    case 'pending': return 'schedule';
    case 'rejected': return 'cancel';
    case 'reported': return 'report';
    default: return 'check-circle'; // Default to active
  }
};

const PROFILE_TABS = [
  { key: 'active', label: 'Active Posts', icon: 'check-circle' },
  { key: 'draft', label: 'Drafts', icon: 'drafts' },
  { key: 'suspended', label: 'Suspended', icon: 'cancel' },
];

export default function ProfileScreen() {
  const { user, logout } = useAuth();
  const dispatch = useAppDispatch();
  const likedPosts = useAppSelector(state => state.likes.likedPosts);
  const postLikeCounts = useAppSelector(state => state.likes.postLikeCounts);
  const likesManager = useLikesManager();

  const [profile, setProfile] = useState<any>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('active');
  const searchParams = useLocalSearchParams<{ tab?: string }>();
  const [firstVisibleIndex, setFirstVisibleIndex] = useState(0);

  // CRITICAL FIX: Define onViewableItemsChanged outside JSX to fix React Hooks error
  const onViewableItemsChangedRef = useRef(({ viewableItems }: any) => {
    if (viewableItems && viewableItems.length > 0) {
      // Get the first visible item index
      const firstIndex = viewableItems[0].index || 0;
      setFirstVisibleIndex(firstIndex);
    }
  });

  const [refreshing, setRefreshing] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [postOptionsModalVisible, setPostOptionsModalVisible] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [totalLikes, setTotalLikes] = useState(0);
  // Publish draft & submit to competition flow
  const [submitToChallengeModalVisible, setSubmitToChallengeModalVisible] = useState(false);
  const [draftPostIdForSubmit, setDraftPostIdForSubmit] = useState<string | null>(null);
  const [joinedChallengesForSubmit, setJoinedChallengesForSubmit] = useState<any[]>([]);
  const [loadingJoinedChallenges, setLoadingJoinedChallenges] = useState(false);
  const [submittingDraftToChallenge, setSubmittingDraftToChallenge] = useState(false);


  // Error and loading states
  const [error, setError] = useState<{ type: 'network' | 'server' | 'unknown'; message: string } | null>(null);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [likingPostId, setLikingPostId] = useState<string | null>(null);

  const [isScreenFocused, setIsScreenFocused] = useState(true);
  const [likesModalVisible, setLikesModalVisible] = useState(false);
  const [likesData, setLikesData] = useState<any[]>([]);
  const [loadingLikes, setLoadingLikes] = useState(false);

  const insets = useSafeAreaInsets();
  const hasFocusedProfileRef = useRef(false);
  const postsCacheRef = useRef<Record<string, Post[]>>({
    active: persistentProfilePostsCache.active,
    draft: persistentProfilePostsCache.draft,
    suspended: persistentProfilePostsCache.suspended,
  });
  const loadPostsRequestIdRef = useRef(0);
  const loadPostsRef = useRef<(showLoading?: boolean) => Promise<void> | void>(() => {});
  const loadProfileRef = useRef<(showLoading?: boolean) => Promise<void> | void>(() => {});
  const publishedPostsCountRef = useRef(0);

  // Handle screen focus for video playback and refresh posts
  useFocusEffect(
    useCallback(() => {
      setIsScreenFocused(true);
      if (user && hasFocusedProfileRef.current) {
        loadPostsRef.current(false);
        loadProfileRef.current(false);
      }
      hasFocusedProfileRef.current = true;
      return () => {
        setIsScreenFocused(false);
      };
    }, [user])
  );

  // Auto-switch to tab from notification deep-link (e.g. tab=suspended)
  useEffect(() => {
    if (searchParams.tab && ['active', 'draft', 'suspended'].includes(searchParams.tab)) {
      setActiveTab(searchParams.tab);
    }
  }, [searchParams.tab]);

  useEffect(() => {
    if (!user) {
      router.replace('/auth/login');
      return;
    }

    if (__DEV__) {
      console.log('🔄 [useEffect] Tab or user changed:', {
        activeTab,
        userId: user?.id,
      });
    }

    loadProfile();
    loadPosts();
  }, [user, activeTab]);

  useRefetchOnReconnect(() => { loadProfile(); loadPosts(); });

  useEffect(() => {
    if (!user?.id) return;
    return localNotificationEvents.onVideoReady((payload) => {
      if (payload.userId !== user.id) return;
      loadPosts(false);
      loadProfile(false);
    });
  }, [user?.id, activeTab]);

  const enrichPostsWithPlaybackData = useCallback(async (items: Post[]) => {
    const postsNeedingEnrichment = items.filter((post: any) => {
      const isVideo = post.type === 'video' || !!(post.video_url || post.videoUrl);
      const processingStatus = post.processing_status ?? post.processingStatus ?? '';

      const hasThumbnail =
        !!post.thumbnail_url ||
        !!post.thumbnailUrl ||
        !!post.thumbnail;

      // Any video without a real thumbnail should be enriched so the profile
      // grid can show proper thumbnails instead of grey placeholders.
      const missingThumbnailForVideo = isVideo && !hasThumbnail;

      const needsPlaybackData =
        isVideo &&
        post.hlsReady &&
        !post.hls_url &&
        !post.fullUrl?.includes('.m3u8');

      const staleProcessingState =
        isVideo &&
        !!processingStatus &&
        processingStatus !== 'completed' &&
        processingStatus !== 'failed';

      return (
        missingThumbnailForVideo ||
        needsPlaybackData ||
        staleProcessingState ||
        needsRenderableMediaEnrichment(post) ||
        needsChallengeMetaEnrichment(post)
      );
    });

    if (!postsNeedingEnrichment.length) {
      return items;
    }

    const videoAssetMap = await getPostVideoAssetsBatchCached(
      postsNeedingEnrichment
        .filter((post: any) => post.type === 'video')
        .map((post) => post.id),
    );

    const enrichMap = await getPostDetailsCached(
      postsNeedingEnrichment.map((post) => post.id),
      { requireNetwork: true },
    );

    return items.map((post: any) => {
      const videoAssets = videoAssetMap.get(post.id);
      const enriched = enrichMap.get(post.id);
      if (!enriched && !videoAssets) return post;
      return normalizeProfilePost({
        ...post,
        ...videoAssets,
        ...enriched,
        user: enriched?.user || post.user,
      });
    });
  }, []);

  const filterProfileGridPosts = useCallback((items: Post[]) => {
    return sortPostsNewestFirst(items.filter((post: any) => !!post?.id));
  }, []);

  const prepareVisiblePosts = useCallback((rawPosts: any[]) => {
    return filterProfileGridPosts(rawPosts.map(normalizeProfilePost));
  }, [filterProfileGridPosts]);

  const enrichVisiblePosts = useCallback(async (items: Post[]) => {
    const enriched = await enrichPostsWithPlaybackData(items);
    return filterProfileGridPosts(enriched);
  }, [enrichPostsWithPlaybackData, filterProfileGridPosts]);

  const prefetchProfileThumbnails = useCallback((items: Post[]) => {
    const urls = items
      .map((post: any) => getThumbnailUrl(post) || null)
      .filter((url): url is string => !!url);

    if (urls.length === 0) {
      return;
    }

    void ExpoImage.prefetch(urls, 'memory-disk').catch(() => {
      // Best-effort cache warmup only.
    });
  }, []);

  const loadProfile = async (showLoading = false) => {
    try {
      setError(null);
      if (showLoading) setLoadingProfile(true);

      // Fetch profile and statistics in parallel for better performance
      const [profileResponse, statsResponse] = await Promise.all([
        userApi.getProfile(),
        userApi.getStatistics()
      ]);

      if (profileResponse.status === 'success' && profileResponse.data) {
        const userData = (profileResponse.data as any).user || profileResponse.data;

        // Get following count from profile - backend returns followingCount directly
        let followingCount = userData.followingCount || 0;

        if (statsResponse.status === 'success' && statsResponse.data) {
          const stats = (statsResponse.data as any).statistics || statsResponse.data;
          if (followingCount === 0) {
            followingCount = stats.following_count || 0;
          }
        }

        // posts_count is set by loadPosts() to published-only count (not backend total/drafts)
        setProfile((prev: any) => ({
          ...userData,
          name: userData.username,
          followers_count: userData.follower_count || userData.followers_count || userData.followersCount || 0,
          following_count: followingCount,
          posts_count: publishedPostsCountRef.current || prev?.posts_count || userData.posts_count || userData.postsCount || 0,
          phone1: userData.phone1,
          phone2: userData.phone2,
          email: userData.email,
          profile_picture: userData.profile_picture,
          bio: userData.bio || '',
          username: userData.username,
          id: userData.id,
        }));
      } else {
        setError({ type: 'server', message: profileResponse.message || 'Failed to load profile' });
      }
    } catch (error: any) {
      console.error('Error loading profile:', error);
      const isNetworkError = error?.message?.includes('Network') || error?.code === 'NETWORK_ERROR' || !error?.response;
      setError({
        type: isNetworkError ? 'network' : 'server',
        message: isNetworkError
          ? 'No internet connection. Please check your network and try again.'
          : error?.message || 'Failed to load profile. Please try again.'
      });
    } finally {
      setLoading(false);
      setLoadingProfile(false);
    }
  };

  const loadPosts = async (showLoading = false) => {
    const requestId = ++loadPostsRequestIdRef.current;

    try {
      setError(null);
      if (showLoading) setLoadingPosts(true);

      const cachedPosts = postsCacheRef.current[activeTab];
      if (!showLoading && cachedPosts.length > 0) {
        setPosts(cachedPosts);
        const cachedLikes = cachedPosts.reduce((sum: number, post: any) => {
          const cachedCount = postLikeCounts[post.id];
          return sum + (cachedCount !== undefined ? cachedCount : (post.likes || 0));
        }, 0);
        setTotalLikes(cachedLikes);
      }

      if (__DEV__) {
        console.log('📥 [loadPosts] Loading posts for tab:', activeTab);
      }

      // Fetch drafts separately if draft tab is active
      let response;
      if (activeTab === 'draft') {
        if (__DEV__) {
          console.log('📥 [loadPosts] Fetching drafts...');
        }
        response = await postsApi.getDrafts(1, 100);
        if (__DEV__) {
          console.log('📥 [loadPosts] Drafts API Response:', {
            status: response.status,
            postsCount: response.data?.posts?.length || 0,
            firstDraft: response.data?.posts?.[0] ? {
              id: response.data.posts[0].id,
              status: response.data.posts[0].status,
              type: response.data.posts[0].type,
              video_url: response.data.posts[0].video_url,
              image: response.data.posts[0].image,
              allKeys: Object.keys(response.data.posts[0]),
            } : null,
          });
        }
        if (response.status === 'success' && response.data?.posts) {
          const draftList = prepareVisiblePosts(
            response.data.posts.filter((post: any) => post.status === 'draft' || post.status === 'Draft')
          );
          const draftById = new Map<string, any>();
          draftList.forEach((p: any) => { if (p?.id) draftById.set(p.id, p); });
          const visibleDrafts = sortPostsNewestFirst(Array.from(draftById.values()));
          postsCacheRef.current.draft = visibleDrafts;
          persistentProfilePostsCache.draft = visibleDrafts;
          setPosts(visibleDrafts);
          setTotalLikes(0);
          void enrichVisiblePosts(visibleDrafts).then((enrichedDrafts) => {
            if (loadPostsRequestIdRef.current !== requestId) return;
            postsCacheRef.current.draft = enrichedDrafts;
            persistentProfilePostsCache.draft = enrichedDrafts;
            setPosts(enrichedDrafts);
          });
          return;
        }
      }

      if (__DEV__) {
        console.log('📥 [loadPosts] Fetching own posts...');
      }

      response = await userApi.getOwnPosts();

      if (__DEV__) {
        console.log('📥 [loadPosts] Own Posts API Response:', {
          status: response.status,
          postsCount: response.data?.posts?.length || 0,
          firstPost: response.data?.posts?.[0] ? {
            id: response.data.posts[0].id,
            status: response.data.posts[0].status,
            type: response.data.posts[0].type,
            video_url: response.data.posts[0].video_url,
            image: response.data.posts[0].image,
            allKeys: Object.keys(response.data.posts[0]),
          } : null,
        });
      }

      if (response.status === 'success' && response.data?.posts) {
        const cachedPostsById = new Map<string, any>();
        postsCacheRef.current[activeTab].forEach((post: any) => {
          if (post?.id) {
            cachedPostsById.set(post.id, post);
          }
        });

        const mergedIncomingPosts = response.data.posts.map((post: any) => {
          const cachedPost = getCachedPostDetail(post.id) || cachedPostsById.get(post.id);
          return mergeProfilePostWithCache(post, cachedPost);
        });

        primePostDetailsCache(mergedIncomingPosts);
        let filteredPosts = mergedIncomingPosts;

        // Filter by tab
        switch (activeTab) {
          case 'active':
            filteredPosts = filteredPosts.filter((p: any) =>
              p.status === 'active' ||
              p.status === 'approved' ||
              !p.status
            );
            break;
          case 'draft':
            filteredPosts = filteredPosts.filter((p: any) => p.status === 'draft');
            break;
          case 'suspended':
            filteredPosts = filteredPosts.filter((p: any) =>
              p.status === 'suspended' ||
              p.status === 'rejected' ||
              p.status === 'reported'
            );
            break;
          default:
            filteredPosts = filteredPosts.filter((p: any) =>
              p.status === 'active' ||
              p.status === 'approved' ||
              !p.status
            );
        }

        filteredPosts = prepareVisiblePosts(filteredPosts);

        // Deduplicate by post id (one card per post)
        const byId = new Map<string, any>();
        filteredPosts.forEach((p: any) => {
          const id = p.id;
          if (!id) return;
          if (!byId.has(id)) byId.set(id, p);
        });
        const fresh = filterSecondarySurfacePosts(Array.from(byId.values()).filter(hasRenderableMedia));

        if (__DEV__) {
          console.log('📥 [loadPosts] Profile posts (completed, deduped, with media only):', {
            activeTab,
            raw: mergedIncomingPosts.length,
            displayed: fresh.length,
          });
        }

        setPosts(fresh);
        postsCacheRef.current[activeTab] = fresh;
        persistentProfilePostsCache[activeTab] = fresh;
        prefetchProfileThumbnails(fresh);

        const publishedCount = fresh.length;
        publishedPostsCountRef.current = publishedCount;
        setProfile((prev: any) => (prev ? { ...prev, posts_count: publishedCount } : null));

        // Calculate total likes
        const likes = fresh.reduce((sum: number, post: any) => {
          const cachedCount = postLikeCounts[post.id];
          return sum + (cachedCount !== undefined ? cachedCount : (post.likes || 0));
        }, 0);
        setTotalLikes(likes);

        void enrichVisiblePosts(fresh).then((enrichedPosts) => {
          if (loadPostsRequestIdRef.current !== requestId) return;

          const enrichedById = new Map<string, any>();
          enrichedPosts.forEach((post: any) => {
            if (post?.id) enrichedById.set(post.id, post);
          });
          const refreshedPosts = filterSecondarySurfacePosts(sortPostsNewestFirst(Array.from(enrichedById.values())));
          primePostDetailsCache(refreshedPosts);
          postsCacheRef.current[activeTab] = refreshedPosts;
          persistentProfilePostsCache[activeTab] = refreshedPosts;
          prefetchProfileThumbnails(refreshedPosts);
          setPosts(refreshedPosts);

          const refreshedLikes = refreshedPosts.reduce((sum: number, post: any) => {
            const cachedCount = postLikeCounts[post.id];
            return sum + (cachedCount !== undefined ? cachedCount : (post.likes || 0));
          }, 0);
          setTotalLikes(refreshedLikes);
        });
      } else {
        setError({ type: 'server', message: response.message || 'Failed to load posts' });
      }
    } catch (error: any) {
      console.warn('[Profile] Error loading posts:', error?.message || 'Unknown error');
      const isNetworkError = error?.message?.includes('Network') || error?.code === 'NETWORK_ERROR' || !error?.response;
      setError({
        type: isNetworkError ? 'network' : 'server',
        message: isNetworkError
          ? 'No internet connection. Please check your network and try again.'
          : error?.message || 'Failed to load posts. Please try again.'
      });
    } finally {
      setLoadingPosts(false);
    }
  };

  loadProfileRef.current = loadProfile;
  loadPostsRef.current = loadPosts;

  // Poll processing status for any posts that are being transcoded to HLS
  useEffect(() => {
    if (!isScreenFocused) return;

    const processingPosts = posts.filter(
      (p: any) => p.type === 'video' && isRecentVideoUpload(p) && (
        p.processing_status === 'pending' ||
        p.processing_status === 'processing' ||
        p.processing_status === 'uploading'
      )
    );

    if (processingPosts.length === 0) return;

    const pollInterval = setInterval(async () => {
      let needsRefresh = false;

      for (const post of processingPosts) {
        try {
          const statusRes = await postsApi.getProcessingStatus(post.id);
          if (statusRes.status === 'success') {
            const { processing, urls } = statusRes.data;

            if (processing.status === 'completed') {
              needsRefresh = true;
              // Update post in-place with new HLS data
              setPosts(prev => prev.map(p =>
                p.id === post.id
                  ? {
                    ...p,
                    processing_status: 'completed' as any,
                    hls_url: urls?.hls,
                    thumbnail_url: urls?.thumbnail,
                    video_url: urls?.preferred || p.video_url,
                  }
                  : p
              ));
            } else if (processing.status === 'failed') {
              setPosts(prev => prev.map(p =>
                p.id === post.id
                  ? { ...p, processing_status: 'failed' as any }
                  : p
              ));
            }
          }
        } catch {
          // Silently ignore polling errors
        }
      }

      if (needsRefresh) {
        // Full refresh to get updated URLs from API
        await loadPosts(false);
      }
    }, 10000); // Poll every 10 seconds

    return () => clearInterval(pollInterval);
  }, [isScreenFocused, posts]);

  const onRefresh = () => {
    setRefreshing(true);
    setError(null);
    Promise.all([loadProfile(true), loadPosts(true)]).finally(() => setRefreshing(false));
  };

  // Optimistic like handler
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

    if (likingPostId === postId) return; // Prevent double clicks
    setLikingPostId(postId);

    const isCurrentlyLiked = likedPosts.includes(postId);
    const currentCount = postLikeCounts[postId] || posts.find(p => p.id === postId)?.likes || 0;

    // Optimistic update - update UI immediately
    const newIsLiked = !isCurrentlyLiked;
    const newCount = newIsLiked ? currentCount + 1 : Math.max(0, currentCount - 1);

    if (newIsLiked) {
      dispatch(addLikedPost(postId));
    } else {
      dispatch(removeLikedPost(postId));
    }
    dispatch(setPostLikeCount({ postId, count: newCount }));

    // Update local posts array
    setPosts(prevPosts =>
      prevPosts.map(post =>
        post.id === postId
          ? { ...post, likes: newCount }
          : post
      )
    );

    // Update total likes
    setTotalLikes(prev => newIsLiked ? prev + 1 : Math.max(0, prev - 1));

    // Background API call
    try {
      const response = await likesApi.toggle(postId);

      if (response.status === 'success' && response.data) {
        // Update with server response
        const serverIsLiked = response.data.isLiked;
        const serverLikeCount = response.data.likeCount;

        if (serverIsLiked) {
          dispatch(addLikedPost(postId));
        } else {
          dispatch(removeLikedPost(postId));
        }
        dispatch(setPostLikeCount({ postId, count: serverLikeCount }));

        // Update local posts array with server response
        setPosts(prevPosts =>
          prevPosts.map(post =>
            post.id === postId
              ? { ...post, likes: serverLikeCount }
              : post
          )
        );

        // Update total likes with server response
        const diff = serverLikeCount - newCount;
        setTotalLikes(prev => Math.max(0, prev + diff));
      } else {
        // Revert on error
        if (isCurrentlyLiked) {
          dispatch(addLikedPost(postId));
        } else {
          dispatch(removeLikedPost(postId));
        }
        dispatch(setPostLikeCount({ postId, count: currentCount }));
        setPosts(prevPosts =>
          prevPosts.map(post =>
            post.id === postId
              ? { ...post, likes: currentCount }
              : post
          )
        );
        setTotalLikes(prev => {
          const diff = currentCount - newCount;
          return Math.max(0, prev + diff);
        });

        // Only show alert for non-404 errors (post not found should be silent)
        const isPostNotFound = response.message?.includes('not found') || response.message?.includes('Post not found');
        if (!isPostNotFound) {
          Alert.alert('Error', 'Failed to update like. Please try again.');
        }
      }
    } catch (error: any) {
      // Revert on error
      if (isCurrentlyLiked) {
        dispatch(addLikedPost(postId));
      } else {
        dispatch(removeLikedPost(postId));
      }
      dispatch(setPostLikeCount({ postId, count: currentCount }));
      setPosts(prevPosts =>
        prevPosts.map(post =>
          post.id === postId
            ? { ...post, likes: currentCount }
            : post
        )
      );
      setTotalLikes(prev => {
        const diff = currentCount - newCount;
        return Math.max(0, prev + diff);
      });

      const isNetworkError = error?.message?.includes('Network') || error?.code === 'NETWORK_ERROR';
      const isPostNotFound = error?.message?.includes('not found') || error?.message?.includes('Post not found');

      // Only show alerts for network errors, not for post not found
      if (isNetworkError) {
        Alert.alert(
          'Network Error',
          'Unable to update like. Your action will be synced when connection is restored.',
          [{ text: 'OK' }]
        );
      } else if (!isPostNotFound) {
        // Silent fail for post not found, show alert for other errors
        Alert.alert('Error', 'Failed to update like. Please try again.');
      }
    } finally {
      setLikingPostId(null);
    }
  };



  const openSubmitDraftToCompetition = (postId: string) => {
    setPostOptionsModalVisible(false);
    setDraftPostIdForSubmit(postId);
    setSubmitToChallengeModalVisible(true);
  };

  useEffect(() => {
    if (!submitToChallengeModalVisible || !user) return;
    let cancelled = false;
    setLoadingJoinedChallenges(true);
    challengesApi.getJoinedChallenges()
      .then((res) => {
        if (cancelled) return;
        if (res.status === 'success' && res.data) {
          const raw = res.data?.challenges ?? (Array.isArray(res.data) ? res.data : []);
          const list = raw.map((item: any) => item.challenge || item).filter((c: any) => c?.id);
          const active = list.filter((c: any) => isChallengeParticipationOpen(c));
          setJoinedChallengesForSubmit(active);
        } else {
          setJoinedChallengesForSubmit([]);
        }
      })
      .catch(() => {
        if (!cancelled) setJoinedChallengesForSubmit([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingJoinedChallenges(false);
      });
    return () => { cancelled = true; };
  }, [submitToChallengeModalVisible, user]);

  const handlePublishDraftAndSubmitToCompetition = async (postId: string, challengeId: string) => {
    setSubmittingDraftToChallenge(true);
    try {
      const publishRes = await postsApi.publishDraft(postId);
      if (publishRes.status !== 'success') {
        Alert.alert('Error', publishRes.message || 'Failed to publish draft.');
        return;
      }
      const linkRes = await challengesApi.addPostToChallenge(challengeId, postId);
      if (linkRes.status !== 'success') {
        Alert.alert(
          'Published',
          'Your post was published, but it could not be added to the competition. You can try again from the post.',
          [{ text: 'OK' }]
        );
      } else {
        Alert.alert('Success', 'Your draft has been published and submitted to the competition.', [{ text: 'OK' }]);
      }
      setSubmitToChallengeModalVisible(false);
      setDraftPostIdForSubmit(null);
      setPosts(prev => prev.filter(p => p.id !== postId));
      await loadPosts(true);
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Something went wrong. Please try again.');
    } finally {
      setSubmittingDraftToChallenge(false);
    }
  };

  const handlePublishDraft = async (postId: string) => {
    // Log the draft post being published
    const draftPost = posts.find(p => p.id === postId);
    if (__DEV__) {
      console.log('📤 [handlePublishDraft] Publishing draft post:', {
        postId,
        post: draftPost ? {
          id: draftPost.id,
          status: draftPost.status,
          type: draftPost.type,
          video_url: draftPost.video_url,
          image: draftPost.image,
          caption: draftPost.caption,
          category: draftPost.category,
          allKeys: Object.keys(draftPost),
        } : null,
      });
    }

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
              if (__DEV__) {
                console.log('📤 [handlePublishDraft] Calling API to publish post:', postId);
              }

              const response = await postsApi.publishDraft(postId);

              if (__DEV__) {
                console.log('📤 [handlePublishDraft] API Response:', {
                  status: response.status,
                  message: response.message,
                  data: response.data ? {
                    post: {
                      id: response.data.post?.id,
                      status: response.data.post?.status,
                      type: response.data.post?.type,
                      video_url: response.data.post?.video_url,
                      image: response.data.post?.image,
                    },
                  } : null,
                });
              }

              if (response.status === 'success') {
                // Remove from drafts list
                setPosts(prevPosts => {
                  const filtered = prevPosts.filter(post => post.id !== postId);
                  if (__DEV__) {
                    console.log('📤 [handlePublishDraft] Removed from drafts. Remaining drafts:', filtered.length);
                  }
                  return filtered;
                });

                // Show success message
                Alert.alert(
                  'Success',
                  'Your post has been published and is pending review.',
                  [{ text: 'OK' }]
                );

                // Refresh posts to update counts
                await loadPosts(true);
              } else {
                if (__DEV__) {
                  console.error('❌ [handlePublishDraft] Failed to publish:', response.message);
                }
                Alert.alert('Error', response.message || 'Failed to publish post. Please try again.');
              }
            } catch (error: any) {
              if (__DEV__) {
                console.error('❌ [handlePublishDraft] Error publishing draft:', {
                  error,
                  message: error?.message,
                  postId,
                });
              }
              Alert.alert(
                'Error',
                error?.message || 'Failed to publish post. Please try again.'
              );
            }
          }
        }
      ]
    );
  };

  const handleDeletePost = async (postId: string) => {
    const postToDelete = posts.find(p => p.id === postId);

    if (__DEV__) {
      console.log('🗑️ [handleDeletePost] Deleting post:', {
        postId,
        post: postToDelete ? {
          id: postToDelete.id,
          status: postToDelete.status,
          type: postToDelete.type,
        } : null,
      });
    }

    Alert.alert(
      'Delete Post',
      'Are you sure you want to delete this post?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive', onPress: async () => {
            try {
              if (__DEV__) {
                console.log('🗑️ [handleDeletePost] Calling API to delete post:', postId);
              }

              await postsApi.deletePost(postId);

              if (__DEV__) {
                console.log('🗑️ [handleDeletePost] Post deleted successfully');
              }

              setPosts(prev => {
                const filtered = prev.filter(p => p.id !== postId);
                if (__DEV__) {
                  console.log('🗑️ [handleDeletePost] Removed from list. Remaining posts:', filtered.length);
                }
                return filtered;
              });
              setPostOptionsModalVisible(false);
              setSelectedPost(null);
            } catch (error: any) {
              if (__DEV__) {
                console.error('❌ [handleDeletePost] Error deleting post:', {
                  error,
                  message: error?.message,
                  postId,
                });
              }
              Alert.alert('Error', 'Failed to delete post');
            }
          }
        }
      ]
    );
  };

  const renderPost = ({ item, index }: { item: Post; index: number }) => {
    // No teaser playback — profile grid is static thumbnails only

    // Log post being rendered (only first few to avoid spam)
    if (__DEV__ && index < 3) {
      console.log(`📄 [renderPost ${index}] Rendering post:`, {
        id: item.id,
        status: item.status,
        type: item.type,
        video_url: item.video_url,
        image: item.image,
        imageUrl: item.imageUrl,
        fullUrl: (item as any).fullUrl,
        caption: item.caption,
        category: item.category,
        activeTab,
        allKeys: Object.keys(item),
      });
    }

    return (
      <VideoThumbnail
        post={item}
        isActive={false}
        onPress={() => {
          if (__DEV__) {
            console.log('👆 [renderPost] Post pressed:', {
              postId: item.id,
              status: item.status,
              activeTab,
            });
          }
          setProfileFeedLaunchCache(user?.id || '', activeTab, posts);
          // Navigate to full-screen profile feed with current post as initial
          router.push({
            pathname: '/profile-feed/[userId]',
            params: {
              userId: user?.id || '',
              initialPostId: item.id,
              status: activeTab,
              initialPostData: JSON.stringify(item) // CRITICAL: Pass data for instant loading
            }
          });
        }}
        onViewsPress={undefined}
        // COMMENTED OUT - Will implement later
        // onViewsPress={async () => {
        //   setViewsModalPostId(item.id);
        //   setViewsModalVisible(true);
        //   setLoadingViews(true);
        //   try {
        //     const response = await viewsApi.getViewStats(item.id);
        //     if (response.status === 'success' && response.data?.recentViews) {
        //       setViewsData(response.data.recentViews);
        //     } else {
        //       setViewsData([]);
        //     }
        //   } catch (error) {
        //     console.error('Error loading views:', error);
        //     setViewsData([]);
        //     Alert.alert('Error', 'Failed to load views');
        //   } finally {
        //     setLoadingViews(false);
        //   }
        // }}
        onOptionsPress={() => {
          if (__DEV__) {
            console.log('⚙️ [renderPost] Options pressed for post:', {
              postId: item.id,
              status: item.status,
            });
          }
          // Open options modal when 3 dots is clicked
          setSelectedPost(item);
          setPostOptionsModalVisible(true);
        }}
        onPublishPress={() => handlePublishDraft(item.id)}
        onUseContentPress={() => {
          Alert.alert(
            'Use Content',
            'Choose what to do with this draft.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Publish the content to the Main Feed', onPress: () => handlePublishDraft(item.id) },
              { text: 'Submit the content to a competition', onPress: () => openSubmitDraftToCompetition(item.id) },
            ]
          );
        }}
      />
    );
  };

  const shimmerAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(shimmerAnim, { toValue: 0, duration: 800, useNativeDriver: true }),
      ])
    ).start();
  }, [shimmerAnim]);
  const shimmerOpacity = shimmerAnim.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.7] });

  if (loading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 60 }]}>
        <View style={{ alignItems: 'center', padding: 24 }}>
          <Animated.View style={{ width: 100, height: 100, borderRadius: 50, backgroundColor: '#2a2a2a', opacity: shimmerOpacity, marginBottom: 16 }} />
          <Animated.View style={{ width: 120, height: 18, borderRadius: 4, backgroundColor: '#2a2a2a', opacity: shimmerOpacity, marginBottom: 8 }} />
          <Animated.View style={{ width: 200, height: 12, borderRadius: 4, backgroundColor: '#2a2a2a', opacity: shimmerOpacity, marginBottom: 20 }} />
          <View style={{ flexDirection: 'row', gap: 40, marginBottom: 20 }}>
            {[1, 2, 3, 4].map(i => (
              <View key={i} style={{ alignItems: 'center' }}>
                <Animated.View style={{ width: 36, height: 18, borderRadius: 4, backgroundColor: '#2a2a2a', opacity: shimmerOpacity, marginBottom: 6 }} />
                <Animated.View style={{ width: 48, height: 12, borderRadius: 4, backgroundColor: '#2a2a2a', opacity: shimmerOpacity }} />
              </View>
            ))}
          </View>
          <Animated.View style={{ width: 140, height: 36, borderRadius: 18, backgroundColor: '#2a2a2a', opacity: shimmerOpacity }} />
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', padding: 2 }}>
          {[1, 2, 3, 4, 5, 6].map(i => (
            <Animated.View key={i} style={{ width: (screenWidth - 6) / 3, aspectRatio: 0.75, margin: 1, backgroundColor: '#2a2a2a', borderRadius: 2, opacity: shimmerOpacity }} />
          ))}
        </View>
      </View>
    );
  }

  if (!user || !profile) {
    return (
      <View style={styles.container}>
        <View style={styles.loginPrompt}>
          <Feather name="user" size={64} color="#666" />
          <Text style={styles.loginPromptText}>Sign in to view your profile</Text>
          <TouchableOpacity
            style={styles.loginButton}
            onPress={() => router.push('/auth/login')}
          >
            <Text style={styles.loginButtonText}>Sign In</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Text style={styles.headerTitle}>Profile</Text>
        <TouchableOpacity onPress={() => setMenuVisible(true)} style={styles.menuButton}>
          <Feather name="more-horizontal" size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      <FlatList
        data={posts}
        renderItem={renderPost}
        keyExtractor={(item) => item.id}
        numColumns={3}
        getItemLayout={(_, index) => ({
          length: PROFILE_POST_ROW_HEIGHT,
          offset: PROFILE_POST_ROW_HEIGHT * Math.floor(index / 3),
          index,
        })}
        removeClippedSubviews={true}
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={8}
        updateCellsBatchingPeriod={30}
        contentContainerStyle={styles.postsGrid}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#60a5fa" />
        }
        onViewableItemsChanged={onViewableItemsChangedRef.current}
        viewabilityConfig={{
          itemVisiblePercentThreshold: 10
        }}
        ListHeaderComponent={
          <>
            {/* Profile Info */}
            <View style={styles.profileSection}>
              <Avatar
                user={profile}
                size={100}
                style={styles.avatar}
              />
              <Text style={styles.username}>@{profile.username}</Text>
              {profile.bio && <Text style={styles.bio}>{profile.bio}</Text>}

              {/* Stats */}
              <View style={styles.statsContainer}>
                <TouchableOpacity style={styles.stat}>
                  <Text style={styles.statValue}>{profile.posts_count || 0}</Text>
                  <Text style={styles.statLabel}>Posts</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.stat}
                  onPress={() => router.push({
                    pathname: '/followers/[id]',
                    params: { id: profile.id, type: 'followers' }
                  })}
                >
                  <Text style={styles.statValue}>{profile.followers_count || 0}</Text>
                  <Text style={styles.statLabel}>Followers</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.stat}
                  onPress={() => router.push({
                    pathname: '/followers/[id]',
                    params: { id: profile.id, type: 'following' }
                  })}
                >
                  <Text style={styles.statValue}>{profile.following_count || 0}</Text>
                  <Text style={styles.statLabel}>Following</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.stat}
                  onPress={async () => {
                    setLikesModalVisible(true);
                    setLoadingLikes(true);
                    try {
                      // Fetch likes for all posts and combine
                      const allLikers = new Map<string, any>();
                      for (const post of posts) {
                        try {
                          const response = await likesApi.getLikers(post.id, 1, 50);
                          if (response.status === 'success' && response.data?.users) {
                            response.data.users.forEach((user: any) => {
                              if (!allLikers.has(user.id)) {
                                allLikers.set(user.id, {
                                  ...user,
                                  likedPosts: [post.id],
                                  totalLikesGiven: 1,
                                });
                              } else {
                                const existing = allLikers.get(user.id);
                                if (!existing.likedPosts.includes(post.id)) {
                                  existing.likedPosts.push(post.id);
                                  existing.totalLikesGiven += 1;
                                }
                              }
                            });
                          }
                        } catch (error) {
                          console.error('Error fetching likers for post:', post.id, error);
                        }
                      }
                      setLikesData(Array.from(allLikers.values()));
                    } catch (error) {
                      console.error('Error loading likes data:', error);
                      Alert.alert('Error', 'Failed to load likes data');
                    } finally {
                      setLoadingLikes(false);
                    }
                  }}
                >
                  <Text style={styles.statValue}>{totalLikes}</Text>
                  <Text style={styles.statLabel}>Likes</Text>
                </TouchableOpacity>
              </View>

              {/* Edit Profile Button */}
              <TouchableOpacity
                style={styles.editButton}
                onPress={() => setEditModalVisible(true)}
              >
                <Text style={styles.editButtonText}>Edit Profile</Text>
              </TouchableOpacity>
            </View>

            {/* Tabs */}
            <View style={styles.tabsContainer}>
              {PROFILE_TABS.map((tab) => (
                <TouchableOpacity
                  key={tab.key}
                  style={[
                    styles.tab,
                    activeTab === tab.key && styles.tabActive
                  ]}
                  onPress={() => {
                    if (__DEV__) {
                      console.log('🔄 [Tab Change] Switching to tab:', {
                        from: activeTab,
                        to: tab.key,
                      });
                    }
                    setActiveTab(tab.key);
                  }}
                >
                  <MaterialIcons
                    name={tab.icon as any}
                    size={16}
                    color={activeTab === tab.key ? '#60a5fa' : '#666'}
                  />
                  <Text style={[
                    styles.tabText,
                    activeTab === tab.key && styles.tabTextActive
                  ]}>
                    {tab.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <MaterialIcons name="video-library" size={48} color="#666" />
            <Text style={styles.emptyText}>No {activeTab} posts</Text>
            {activeTab === 'active' && (
              <TouchableOpacity
                style={styles.createButton}
                onPress={() => router.push('/(tabs)/create')}
              >
                <Text style={styles.createButtonText}>Create your first post</Text>
              </TouchableOpacity>
            )}
          </View>
        }
      />

      {/* Menu Modal */}
      <Modal visible={menuVisible} transparent animationType="fade">
        <TouchableOpacity
          style={styles.menuOverlay}
          onPress={() => setMenuVisible(false)}
          activeOpacity={1}
        >
          <View style={styles.menuContainer}>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setMenuVisible(false);
                setEditModalVisible(true);
              }}
            >
              <Feather name="edit" size={20} color="#fff" />
              <Text style={styles.menuItemText}>Edit Profile</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setMenuVisible(false);
                router.push('/settings');
              }}
            >
              <Feather name="settings" size={20} color="#fff" />
              <Text style={styles.menuItemText}>Settings</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.menuItem, styles.menuItemDanger]}
              onPress={() => {
                setMenuVisible(false);
                Alert.alert(
                  'Log Out',
                  'Are you sure you want to log out?',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Log Out', style: 'destructive', onPress: logout }
                  ]
                );
              }}
            >
              <Feather name="log-out" size={20} color="#ef4444" />
              <Text style={[styles.menuItemText, { color: '#ef4444' }]}>Log Out</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Views Modal - COMMENTED OUT - Will implement later */}
      {/* <Modal visible={viewsModalVisible} transparent animationType="slide">
        <TouchableOpacity
          style={styles.menuOverlay}
          onPress={() => setViewsModalVisible(false)}
          activeOpacity={1}
        >
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Views</Text>
              <TouchableOpacity onPress={() => setViewsModalVisible(false)}>
                <MaterialIcons name="close" size={24} color="#fff" />
              </TouchableOpacity>
            </View>
            {loadingViews ? (
              <View style={styles.modalLoading}>
                <ActivityIndicator size="large" color="#60a5fa" />
              </View>
            ) : viewsData.length > 0 ? (
              <FlatList
                data={viewsData}
                keyExtractor={(item) => item.user?.id || item.id || Math.random().toString()}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.modalUserItem}
                    onPress={() => {
                      if (item.user?.id) {
                        router.push({
                          pathname: '/user/[id]',
                          params: { id: item.user.id }
                        });
                        setViewsModalVisible(false);
                      }
                    }}
                  >
                    <Avatar
                      user={item.user}
                      size={50}
                      style={styles.modalUserAvatar}
                    />
                    <View style={styles.modalUserInfo}>
                      <Text style={styles.modalUserName}>
                        {item.user?.username || item.user?.display_name || 'Anonymous'}
                      </Text>
                      {item.viewedAt && (
                        <Text style={styles.modalUserMeta}>
                          {new Date(item.viewedAt).toLocaleDateString()}
                        </Text>
                      )}
                    </View>
                  </TouchableOpacity>
                )}
                contentContainerStyle={styles.modalListContent}
              />
            ) : (
              <View style={styles.modalEmpty}>
                <MaterialIcons name="visibility-off" size={48} color="#666" />
                <Text style={styles.modalEmptyText}>No views yet</Text>
              </View>
            )}
          </View>
        </TouchableOpacity>
      </Modal> */}

      {/* Likes Modal */}
      <Modal visible={likesModalVisible} transparent animationType="slide">
        <TouchableOpacity
          style={styles.menuOverlay}
          onPress={() => setLikesModalVisible(false)}
          activeOpacity={1}
        >
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>People Who Liked Your Posts</Text>
              <TouchableOpacity onPress={() => setLikesModalVisible(false)}>
                <MaterialIcons name="close" size={24} color="#fff" />
              </TouchableOpacity>
            </View>
            {loadingLikes ? (
              <View style={styles.modalLoading}>
                <ActivityIndicator size="large" color="#60a5fa" />
              </View>
            ) : likesData.length > 0 ? (
              <FlatList
                data={likesData}
                keyExtractor={(item) => item.id || Math.random().toString()}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.modalUserItem}
                    onPress={() => {
                      if (item.id) {
                        router.push({
                          pathname: '/user/[id]',
                          params: { id: item.id }
                        });
                        setLikesModalVisible(false);
                      }
                    }}
                  >
                    <Avatar
                      user={item}
                      size={50}
                      style={styles.modalUserAvatar}
                    />
                    <View style={styles.modalUserInfo}>
                      <Text style={styles.modalUserName}>
                        {item.username || item.display_name || 'Unknown'}
                      </Text>
                      <Text style={styles.modalUserMeta}>
                        Liked {item.totalLikesGiven || item.likedPosts?.length || 0} of your posts
                      </Text>
                    </View>
                  </TouchableOpacity>
                )}
                contentContainerStyle={styles.modalListContent}
              />
            ) : (
              <View style={styles.modalEmpty}>
                <MaterialIcons name="favorite-border" size={48} color="#666" />
                <Text style={styles.modalEmptyText}>No likes yet</Text>
              </View>
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Post Options Modal */}
      <Modal visible={postOptionsModalVisible} transparent animationType="slide">
        <TouchableOpacity
          style={styles.menuOverlay}
          onPress={() => setPostOptionsModalVisible(false)}
          activeOpacity={1}
        >
          <View style={styles.menuContainer}>
            {/* Post Preview */}
            {selectedPost && (
              <View style={styles.postOptionsPreview}>
                <View style={styles.postOptionsPreviewMedia}>
                  {getFileUrl(selectedPost.video_url) ? (
                    <View style={styles.postOptionsThumbnail}>
                      <Feather name="video" size={24} color="#60a5fa" />
                    </View>
                  ) : (getThumbnailUrl(selectedPost) || getFileUrl(selectedPost.image || '')) ? (
                    <ExpoImage
                      source={{ uri: getThumbnailUrl(selectedPost) || getFileUrl(selectedPost.image || '') || '' }}
                      style={styles.postOptionsThumbnail}
                      contentFit="cover"
                      cachePolicy="memory-disk"
                      transition={0}
                    />
                  ) : (
                    <View style={styles.postOptionsThumbnail}>
                      <MaterialIcons name="image" size={24} color="#666" />
                    </View>
                  )}
                </View>
                <View style={styles.postOptionsInfo}>
                  <Text style={styles.postOptionsCaption} numberOfLines={2}>
                    {selectedPost.caption || selectedPost.description || selectedPost.title || 'No caption'}
                  </Text>
                  <View style={styles.postOptionsStats}>
                    <Text style={styles.postOptionsStatText}>
                      {formatNumber(selectedPost.likes || 0)} likes
                    </Text>
                    <Text style={styles.postOptionsStatText}>
                      • {formatNumber(selectedPost.comments_count || 0)} comments
                    </Text>
                  </View>
                </View>
              </View>
            )}

            <View style={styles.menuDivider} />

            {/* Publish Draft Button - Only show for draft posts */}
            {selectedPost?.status === 'draft' && (
              <>
                <TouchableOpacity
                  style={[styles.menuItem, styles.menuItemPrimary]}
                  onPress={() => {
                    setPostOptionsModalVisible(false);
                    if (selectedPost) {
                      handlePublishDraft(selectedPost.id);
                    }
                  }}
                >
                  <Feather name="send" size={20} color="#10b981" />
                  <Text style={[styles.menuItemText, { color: '#10b981' }]}>Publish Post</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.menuItem, { borderBottomWidth: 0 }]}
                  onPress={() => {
                    if (selectedPost) openSubmitDraftToCompetition(selectedPost.id);
                  }}
                >
                  <Feather name="award" size={20} color="#60a5fa" />
                  <Text style={[styles.menuItemText, { color: '#60a5fa' }]}>Publish & submit to competition</Text>
                </TouchableOpacity>
              </>
            )}

            <TouchableOpacity
              style={styles.menuItem}
              onPress={async () => {
                setPostOptionsModalVisible(false);
                if (selectedPost) {
                  try {
                    await sharePost(selectedPost);
                  } catch (_) {}
                }
              }}
            >
              <Feather name="share-2" size={20} color="#60a5fa" />
              <Text style={styles.menuItemText}>Share Post</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.menuItem, styles.menuItemDanger]}
              onPress={() => {
                setPostOptionsModalVisible(false);
                if (selectedPost) {
                  handleDeletePost(selectedPost.id);
                }
              }}
            >
              <Feather name="trash-2" size={20} color="#ef4444" />
              <Text style={[styles.menuItemText, { color: '#ef4444' }]}>Delete Post</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => setPostOptionsModalVisible(false)}
            >
              <Feather name="x" size={20} color="#fff" />
              <Text style={styles.menuItemText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Publish draft & submit to competition — pick a joined challenge */}
      <Modal
        visible={submitToChallengeModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => {
          if (!submittingDraftToChallenge) {
            setSubmitToChallengeModalVisible(false);
            setDraftPostIdForSubmit(null);
          }
        }}
      >
        <TouchableOpacity
          activeOpacity={1}
          style={styles.submitToChallengeOverlay}
          onPress={() => {
            if (!submittingDraftToChallenge) {
              setSubmitToChallengeModalVisible(false);
              setDraftPostIdForSubmit(null);
            }
          }}
        >
          <SafeAreaView style={styles.submitToChallengeModalContainer}>
            <TouchableOpacity activeOpacity={1} onPress={() => {}} style={styles.submitToChallengeCard}>
              <View style={styles.submitToChallengeHeader}>
                <Text style={styles.submitToChallengeTitle}>Publish & submit to competition</Text>
                <TouchableOpacity
                  onPress={() => {
                    if (!submittingDraftToChallenge) {
                      setSubmitToChallengeModalVisible(false);
                      setDraftPostIdForSubmit(null);
                    }
                  }}
                  disabled={submittingDraftToChallenge}
                >
                  <Feather name="x" size={24} color="#9ca3af" />
                </TouchableOpacity>
              </View>
              <Text style={styles.submitToChallengeSubtitle}>
                Choose a competition you've joined. The draft will be published and then added to that competition.
              </Text>
              {loadingJoinedChallenges ? (
                <View style={styles.submitToChallengeLoading}>
                  <ActivityIndicator size="small" color="#60a5fa" />
                  <Text style={styles.submitToChallengeLoadingText}>Loading your competitions…</Text>
                </View>
              ) : joinedChallengesForSubmit.length === 0 ? (
                <View style={styles.submitToChallengeEmpty}>
                  <Feather name="award" size={40} color="#6b7280" />
                  <Text style={styles.submitToChallengeEmptyText}>You haven't joined any competitions yet.</Text>
                  <Text style={styles.submitToChallengeEmptyHint}>Join a competition from the Competitions tab, then you can submit this draft there.</Text>
                </View>
              ) : (
                <ScrollView
                  style={styles.submitToChallengeList}
                  contentContainerStyle={styles.submitToChallengeListContent}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={true}
                >
                  {joinedChallengesForSubmit.map((challenge: any) => (
                    <TouchableOpacity
                      key={challenge.id}
                      style={styles.submitToChallengeItem}
                      onPress={() => draftPostIdForSubmit && handlePublishDraftAndSubmitToCompetition(draftPostIdForSubmit, challenge.id)}
                      disabled={submittingDraftToChallenge}
                    >
                      <Feather name="zap" size={20} color="#60a5fa" />
                      <Text style={styles.submitToChallengeItemName} numberOfLines={2}>{challenge.name}</Text>
                      <Feather name="chevron-right" size={18} color="#9ca3af" />
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
              {submittingDraftToChallenge && (
                <View style={styles.submitToChallengeSubmitting}>
                  <ActivityIndicator size="small" color="#60a5fa" />
                  <Text style={styles.submitToChallengeSubmittingText}>Publishing and submitting…</Text>
                </View>
              )}
            </TouchableOpacity>
          </SafeAreaView>
        </TouchableOpacity>
      </Modal>

      {/* Edit Profile Modal */}
      <EditProfileModal
        isVisible={editModalVisible}
        onClose={() => setEditModalVisible(false)}
        user={profile}
        onProfileUpdated={(updatedUser) => {
          setProfile(updatedUser);
          setEditModalVisible(false);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loginPrompt: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  loginPromptText: {
    color: '#fff',
    fontSize: 18,
    marginTop: 16,
    marginBottom: 24,
    textAlign: 'center',
  },
  loginButton: {
    backgroundColor: '#60a5fa',
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 24,
  },
  loginButtonText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '600',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: '#000000',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  menuButton: {
    padding: 8,
  },
  profileSection: {
    alignItems: 'center',
    padding: 24,
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    marginBottom: 16,
  },
  username: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 8,
  },
  bio: {
    color: '#999',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 20,
  },
  statsContainer: {
    flexDirection: 'row',
    marginBottom: 20,
  },
  stat: {
    alignItems: 'center',
    marginHorizontal: 20,
  },
  statValue: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  statLabel: {
    color: '#999',
    fontSize: 12,
    marginTop: 2,
  },
  editButton: {
    backgroundColor: '#1a1a1a',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#333',
  },
  editButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  tabsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 20,
    marginHorizontal: 2,
    backgroundColor: '#1a1a1a',
  },
  tabActive: {
    backgroundColor: 'rgba(96, 165, 250, 0.2)',
  },
  tabText: {
    color: '#666',
    fontSize: 12,
    fontWeight: '500',
    marginLeft: 4,
  },
  tabTextActive: {
    color: '#60a5fa',
  },
  postsGrid: {
    padding: 2,
  },
  postItem: {
    width: (screenWidth - 6) / 3,
    aspectRatio: 0.75, // 3:4 aspect ratio for better previews
    margin: 1,
    position: 'relative',
    backgroundColor: '#1a1a1a',
    borderRadius: 2,
    overflow: 'hidden',
  },
  postMedia: {
    width: '100%',
    height: '100%',
    backgroundColor: '#1a1a1a',
  },
  postOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    padding: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  postStats: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  postStatText: {
    color: '#fff',
    fontSize: 10,
    marginLeft: 3,
    fontWeight: '600',
  },
  statusIndicator: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoPlayIndicator: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 12,
    padding: 4,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 24,
    minHeight: 24,
  },
  videoPlayIndicatorActive: {
    backgroundColor: '#ef4444',
  },
  playingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#fff',
  },
  postOptionsButton: {
    position: 'absolute',
    top: 4,
    left: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 12,
    padding: 6,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 28,
    minHeight: 28,
  },
  publishDraftButton: {
    position: 'absolute',
    bottom: 36,
    left: 4,
    right: 4,
    backgroundColor: 'rgba(16, 185, 129, 0.9)',
    borderRadius: 8,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#10b981',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  publishDraftButtonText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    marginLeft: 4,
  },
  submitToCompetitionDraftButton: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    right: 4,
    backgroundColor: 'rgba(96, 165, 250, 0.9)',
    borderRadius: 8,
    paddingHorizontal: 4,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  submitToCompetitionDraftButtonText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  submitToChallengeOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  submitToChallengeModalContainer: {
    maxHeight: '86%',
  },
  submitToChallengeCard: {
    backgroundColor: '#1a1a1a',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 16,
    paddingHorizontal: 20,
    paddingBottom: 16,
    minHeight: 200,
    maxHeight: '100%',
  },
  submitToChallengeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  submitToChallengeTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    flex: 1,
  },
  submitToChallengeSubtitle: {
    color: '#9ca3af',
    fontSize: 14,
    marginBottom: 16,
    lineHeight: 20,
  },
  submitToChallengeLoading: {
    alignItems: 'center',
    paddingVertical: 24,
    gap: 12,
  },
  submitToChallengeLoadingText: {
    color: '#9ca3af',
    fontSize: 14,
  },
  submitToChallengeEmpty: {
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 16,
  },
  submitToChallengeEmptyText: {
    color: '#d1d5db',
    fontSize: 15,
    fontWeight: '600',
    marginTop: 12,
    textAlign: 'center',
  },
  submitToChallengeEmptyHint: {
    color: '#9ca3af',
    fontSize: 13,
    marginTop: 8,
    textAlign: 'center',
    lineHeight: 18,
  },
  submitToChallengeList: {
    maxHeight: 420,
    paddingBottom: 8,
  },
  submitToChallengeListContent: {
    paddingBottom: 20,
  },
  submitToChallengeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#232326',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginBottom: 8,
    gap: 12,
  },
  submitToChallengeItemName: {
    flex: 1,
    color: '#f3f4f6',
    fontSize: 15,
    fontWeight: '500',
  },
  submitToChallengeSubmitting: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingTop: 16,
  },
  submitToChallengeSubmittingText: {
    color: '#60a5fa',
    fontSize: 14,
  },
  processingBadge: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 2,
  },
  processingBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '600',
    marginTop: 4,
  },
  challengePostBadge: {
    position: 'absolute',
    left: 6,
    right: 6,
    bottom: 42,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  challengePostBadgeTextWrap: {
    flex: 1,
  },
  challengePostBadgeLabel: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  challengePostBadgeName: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 1,
  },
  teaserVideo: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  noMediaPlaceholder: {
    backgroundColor: '#1a1a1a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  defaultAvatar: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  defaultAvatarText: {
    color: '#fff',
    fontWeight: '700',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 60,
    width: screenWidth,
  },
  emptyText: {
    color: '#fff',
    fontSize: 16,
    marginTop: 16,
    marginBottom: 16,
  },
  createButton: {
    backgroundColor: '#60a5fa',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
  },
  createButtonText: {
    color: '#000',
    fontSize: 14,
    fontWeight: '600',
  },
  menuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  menuContainer: {
    backgroundColor: '#18181b',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    paddingBottom: 40, // Increased bottom padding
    maxHeight: '70%', // Reduced max height to ensure content fits
    marginBottom: 40, // Increased margin at bottom for better spacing
  },
  menuDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
    marginVertical: 8,
  },
  postOptionsPreview: {
    flexDirection: 'row',
    padding: 12,
    backgroundColor: '#232326',
    borderRadius: 12,
    marginBottom: 8,
  },
  postOptionsPreviewMedia: {
    marginRight: 12,
  },
  postOptionsThumbnail: {
    width: 60,
    height: 60,
    borderRadius: 8,
    backgroundColor: '#1a1a1a',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  postOptionsInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  postOptionsCaption: {
    color: '#fff',
    fontSize: 14,
    marginBottom: 6,
    lineHeight: 18,
  },
  postOptionsStats: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  postOptionsStatText: {
    color: '#999',
    fontSize: 12,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginBottom: 8,
    backgroundColor: '#232326',
  },
  menuItemDanger: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
  },
  menuItemPrimary: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
  },
  menuItemText: {
    color: '#fff',
    fontSize: 16,
    marginLeft: 12,
  },
  postModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  postModalContainer: {
    width: '90%',
    maxHeight: '90%',
    backgroundColor: '#18181b',
    borderRadius: 20,
    padding: 16,
    position: 'relative',
  },
  postModalClose: {
    position: 'absolute',
    top: 16,
    right: 16,
    zIndex: 10,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 20,
    padding: 8,
  },
  postModalMedia: {
    width: '100%',
    height: 300,
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 16,
  },
  modalMedia: {
    width: '100%',
    height: '100%',
  },
  postModalInfo: {
    marginBottom: 16,
    paddingHorizontal: 4,
  },
  postModalCaption: {
    color: '#fff',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 12,
  },
  postModalStats: {
    flexDirection: 'row',
    gap: 16,
  },
  postModalStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  postModalStatText: {
    color: '#999',
    fontSize: 12,
  },
  postModalActions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  modalActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 20,
    backgroundColor: '#232326',
  },
  modalActionButtonDanger: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
  },
  modalActionText: {
    color: '#fff',
    fontSize: 14,
    marginLeft: 8,
  },
  videoContainer: {
    position: 'relative',
    width: '100%',
    height: '100%',
  },
  videoOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  playPauseButton: {
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderRadius: 30,
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoErrorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
  },
  videoErrorText: {
    color: '#666',
    fontSize: 16,
    marginTop: 12,
    marginBottom: 16,
  },
  retryButton: {
    backgroundColor: '#60a5fa',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },
  retryButtonText: {
    color: '#000',
    fontSize: 14,
    fontWeight: '600',
  },
  loadingText: {
    color: '#fff',
    fontSize: 14,
    marginTop: 8,
  },
  nativeControlsButton: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderRadius: 20,
    padding: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalContainer: {
    backgroundColor: '#18181b',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    paddingBottom: 40,
    maxHeight: '80%',
    marginBottom: 40,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  modalLoading: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  modalListContent: {
    paddingBottom: 20,
  },
  modalUserItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: '#232326',
    marginBottom: 8,
  },
  modalUserAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginRight: 12,
    backgroundColor: '#1a1a1a',
  },
  modalUserInfo: {
    flex: 1,
  },
  modalUserName: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  modalUserMeta: {
    color: '#999',
    fontSize: 12,
  },
  modalEmpty: {
    paddingVertical: 60,
    alignItems: 'center',
  },
  modalEmptyText: {
    color: '#999',
    fontSize: 16,
    marginTop: 16,
  },
  suspendedAppealButton: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    right: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: 'rgba(245, 158, 11, 0.92)',
    paddingVertical: 5,
    borderRadius: 8,
  },
  suspendedAppealButtonText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
});
