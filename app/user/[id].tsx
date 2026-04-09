import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  useColorScheme,
  FlatList,
  Modal,
  Share,
  Alert,
  RefreshControl,
  Dimensions,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { useLocalSearchParams, router } from 'expo-router';
import { useAuth } from '@/lib/auth-context';
import { useRefetchOnReconnect } from '@/lib/hooks/use-network-status';
import { userApi, followsApi, postsApi } from '@/lib/api';
import { User, Post } from '@/types';
import { getFileUrl, getThumbnailUrl } from '@/lib/utils/file-url';
import { MaterialIcons, Feather } from '@expo/vector-icons';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useRealtime } from '@/lib/realtime-context';
import RealtimeProvider from '@/lib/realtime-context';
import { useNavigation } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import DotsSpinner from '@/components/DotsSpinner';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar } from '@/components/Avatar';
import { UnfollowConfirmModal } from '@/components/UnfollowConfirmModal';
import { timeAgo } from '@/lib/utils/time-ago';
import { filterHlsReady, filterSecondarySurfacePosts } from '@/lib/utils/post-filter';
import { useCache } from '@/lib/cache-context';
import { getChallengePostMeta } from '@/lib/utils/challenge-post';
import { useAppActive } from '@/lib/hooks/use-app-active';
import { normalizePost } from '@/lib/utils/normalize-post';
import { getPostDetailsCached, primePostDetailsCache } from '@/lib/post-details-cache';
import { getPostVideoAssetsBatchCached } from '@/lib/post-video-assets-cache';
import { getPostVideoAssetsCached } from '@/lib/post-video-assets-cache';
import { setProfileFeedLaunchCache } from '@/lib/profile-feed-launch-cache';
import { sharePost } from '@/lib/post-share';
import { downloadPostToLibrary } from '@/lib/post-download';
import { prefetchFollowingFeed, removeUserFromFollowingFeedCache, seedFollowingFeedCache } from '@/lib/following-feed-cache';
import { safeRouterBack } from '@/lib/utils/navigation';
import {
  needsChallengeMetaEnrichment,
  needsRenderableMediaEnrichment,
} from '@/lib/utils/post-detail-enrichment';

const EXTERNAL_PROFILE_PAGE_LIMIT = 24;
const { width: screenWidth } = Dimensions.get('window');
const EXTERNAL_PROFILE_POST_ITEM_SIZE = (screenWidth - 6) / 3;

const externalProfileCache: Record<string, {
  profile: User | null;
  posts: Post[];
  hasMore: boolean;
  nextPage: number;
  totalCount: number;
}> = {};


function normalizeUserProfilePost(post: any, fallbackProfile?: any): Post {
  const userFromPost = post?.user;
  const authorName = post?.authorName || post?.username || userFromPost?.username || fallbackProfile?.username;
  const authorProfilePicture =
    post?.authorProfilePicture ||
    userFromPost?.profile_picture ||
    post?.profile_picture ||
    fallbackProfile?.profile_picture;

  return normalizePost({
    ...post,
    user:
      userFromPost ||
      (fallbackProfile?.id || post?.user_id || post?.userId || authorName || authorProfilePicture
        ? {
            id: fallbackProfile?.id || post?.user_id || post?.userId || '',
            username: authorName || '',
            profile_picture: authorProfilePicture || null,
          }
        : undefined),
  });
}

const getExternalPostTimestamp = (post: Post) =>
  new Date(post.createdAt || post.uploadDate || (post as any).created_at || 0).getTime();

const sortExternalProfilePostsNewestFirst = (items: Post[]) =>
  [...items].sort((a, b) => getExternalPostTimestamp(b) - getExternalPostTimestamp(a));

const isExternalProfileVideoPost = (post: any) =>
  post.type === 'video' ||
  post.mediaType === 'video' ||
  !!(post.video_url || post.videoUrl);

const getExternalProfileThumbnailCandidate = (post: any) => {
  const directThumbnail =
    getThumbnailUrl(post) ||
    getFileUrl(post.image || post.imageUrl || (post as any).thumbnail || '');

  if (directThumbnail) {
    return directThumbnail;
  }

  const fullUrl: string | undefined = (post as any).fullUrl;
  if (!fullUrl || typeof fullUrl !== 'string' || !fullUrl.includes('.m3u8')) {
    return null;
  }

  try {
    const normalized = fullUrl.split('?')[0];
    const match = normalized.match(/^(https?:\/\/[^/]+)\/hls\/([^/]+)\/[^/]+\.m3u8$/i);
    if (!match) {
      return null;
    }

    const [, origin, videoId] = match;
    return `${origin}/thumbnails/${videoId}_thumbnail.jpg`;
  } catch {
    return null;
  }
};

const getExternalProfilePostCardMeta = (post: any) => {
  const isVideo = isExternalProfileVideoPost(post);
  const thumbnailUrl = getExternalProfileThumbnailCandidate(post);
  const hasThumbnail = !!thumbnailUrl;
  const hasHls =
    filterHlsReady([post]).length > 0 ||
    !!((post as any).fullUrl && String((post as any).fullUrl).includes('.m3u8'));
  const processingStatus = String(post.processing_status ?? post.processingStatus ?? '').toLowerCase();

  if (!isVideo) {
    return {
      isVideo: false,
      canOpen: hasThumbnail,
      statusLabel: hasThumbnail ? null : 'Unavailable',
      thumbnailUrl,
    };
  }

  if (hasHls) {
    return {
      isVideo: true,
      canOpen: true,
      statusLabel: null,
      thumbnailUrl,
    };
  }

  if (
    processingStatus.includes('pending') ||
    processingStatus.includes('processing') ||
    processingStatus.includes('upload') ||
    processingStatus.includes('transcod')
  ) {
    return {
      isVideo: true,
      canOpen: false,
      statusLabel: 'Processing',
      thumbnailUrl,
    };
  }

  return {
    isVideo: true,
    canOpen: false,
    statusLabel: 'Unavailable',
    thumbnailUrl,
  };
};


interface VideoThumbnailCardProps {
  post: Post;
  onPress: () => void;
}

const VideoThumbnailCard = React.memo(function VideoThumbnailCard({ post, onPress }: VideoThumbnailCardProps) {
  const [imageError, setImageError] = useState(false);
  const cardMeta = getExternalProfilePostCardMeta(post);
  const isVideo = cardMeta.isVideo;
  const challengeMeta = getChallengePostMeta(post);
  const thumbnailUrl = cardMeta.thumbnailUrl;
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
      onPress={onPress}
      style={styles.postCard}
      activeOpacity={0.9}
    >
      {resolvedThumbnailUrl && !imageError ? (
        <ExpoImage
          source={{ uri: resolvedThumbnailUrl }}
          style={styles.postImage}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={0}
          onError={() => setImageError(true)}
          recyclingKey={post.id}
        />
      ) : (
        <View style={[styles.postImage, styles.noMediaPlaceholder]}>
          <MaterialIcons name={isVideo ? 'video-library' : 'image'} size={28} color="#666" />
        </View>
      )}

      <View style={styles.postOverlay}>
        <View style={styles.postStats}>
          <Feather name="heart" size={12} color="#fff" />
          <Text style={styles.postStatText}>{post.likes || 0}</Text>
        </View>

        <View style={styles.postStats}>
          <Feather name="message-circle" size={12} color="#fff" />
          <Text style={styles.postStatText}>{post.comments_count || 0}</Text>
        </View>
      </View>

      {isVideo && (
        <View style={styles.videoPlayIndicator}>
          <Feather name="play" size={14} color="#fff" />
        </View>
      )}

      {cardMeta.statusLabel ? (
        <View style={styles.postStatusBadge}>
          <Text style={styles.postStatusBadgeText}>{cardMeta.statusLabel}</Text>
        </View>
      ) : null}

      {challengeMeta.isChallengePost && (
        <LinearGradient
          colors={['rgba(14, 116, 144, 0.95)', 'rgba(37, 99, 235, 0.95)']}
          style={styles.challengeBadge}
        >
          <Feather name="award" size={11} color="#fff" />
          <View style={styles.challengeBadgeTextWrap}>
            <Text style={styles.challengeBadgeLabel}>Competition</Text>
            <Text style={styles.challengeBadgeName} numberOfLines={1}>
              {challengeMeta.challengeName || 'Challenge post'}
            </Text>
          </View>
        </LinearGradient>
      )}
    </TouchableOpacity>
  );
});

const mergeApprovedPostsNewestFirst = (currentPosts: Post[], incomingPosts: Post[]) => {
  const currentById = new Map<string, Post>();

  currentPosts.forEach((post) => {
    if (post?.id) {
      currentById.set(post.id, post);
    }
  });

  incomingPosts.forEach((post) => {
    if (!post?.id) {
      return;
    }

    const existing = currentById.get(post.id);
    if (!existing) {
      currentById.set(post.id, post);
      return;
    }

    const hasMeaningfulChange =
      existing.fullUrl !== post.fullUrl ||
      existing.hls_url !== post.hls_url ||
      existing.video_url !== post.video_url ||
      existing.image !== post.image ||
      (existing as any).thumbnail !== (post as any).thumbnail ||
      (existing as any).thumbnail_url !== (post as any).thumbnail_url ||
      (existing as any).processing_status !== (post as any).processing_status ||
      existing.likes !== post.likes ||
      existing.comments_count !== post.comments_count;

    currentById.set(post.id, hasMeaningfulChange ? { ...existing, ...post } : existing);
  });

  return sortExternalProfilePostsNewestFirst(Array.from(currentById.values()));
};

const buildProfileFromApi = (userData: any, fallbackId: string, fallbackPostsCount = 0) => {
  const rawFollowers =
    (userData as any).followersCount ??
    userData.followers_count ??
    (userData as any).follower_count ??
    (userData as any).followers?.count ??
    0;
  const rawFollowing =
    (userData as any).followingCount ??
    userData.following_count ??
    (userData as any).subscribers ??
    (userData as any).following?.count ??
    0;
  const rawPostsValue =
    userData.posts_count ??
    (userData as any).postsCount ??
    (userData as any).posts?.count ??
    fallbackPostsCount;
  const rawPosts = Math.max(0, Number(rawPostsValue) || 0, fallbackPostsCount);

  return {
    ...userData,
    name: userData.name || (userData as any).fullName || userData.username || 'User',
    username: userData.username || '',
    profile_picture: userData.profile_picture || (userData as any).profilePicture || '',
    bio: userData.bio || '',
    email: (userData as any).email || '',
    phone1: (userData as any).phone1 || '',
    phone2: (userData as any).phone2 || '',
    followers_count: rawFollowers,
    following_count: rawFollowing,
    posts_count: rawPosts,
    id: userData.id || fallbackId,
  } as User;
};

const extractApprovedPostsTotal = (responseData: any): number | null => {
  const pagination = responseData?.pagination || {};
  const totalValue =
    pagination.totalPosts ??
    pagination.total_posts ??
    pagination.total ??
    pagination.count ??
    responseData?.totalPosts ??
    responseData?.total_posts ??
    responseData?.total ??
    responseData?.count;

  if (totalValue === undefined || totalValue === null || totalValue === '') {
    return null;
  }

  const numericTotal = Number(totalValue);
  return Number.isFinite(numericTotal) ? Math.max(0, numericTotal) : null;
};

const getApprovedPostsTotal = (responseData: any, fallbackCount: number) => {
  const extractedTotal = extractApprovedPostsTotal(responseData);
  if (extractedTotal !== null) {
    return extractedTotal;
  }

  return Math.max(0, fallbackCount);
};

async function resolveExactApprovedPostsTotal(userId: string): Promise<number> {
  const limit = 100;
  let page = 1;
  let total = 0;

  while (page <= 100) {
    const response = await userApi.getUserApprovedPosts(userId, page, limit);
    if (response.status !== 'success' || !response.data) {
      return total;
    }

    const paginationTotal = extractApprovedPostsTotal(response.data);
    if (paginationTotal !== null) {
      return paginationTotal;
    }

    const pagePosts = Array.isArray(response.data)
      ? response.data
      : (response.data as any)?.posts || [];

    total += pagePosts.length;

    if (pagePosts.length < limit) {
      return total;
    }

    page += 1;
  }

  return total;
}

async function enrichApprovedPostsPage(items: any[], fallbackProfile?: User | null) {
  const normalized = items.map((post: any) => normalizeUserProfilePost(post, fallbackProfile ?? undefined));
  const needsEnrichment = normalized.filter((p: any) => {
    const isVideo = p.type === 'video' || !!(p.video_url || p.videoUrl);
    const processingStatus = p.processing_status ?? p.processingStatus ?? '';
    const hasThumbnail =
      !!p.thumbnail_url || !!p.thumbnailUrl || !!p.thumbnail;

    const missingThumbnailForVideo = isVideo && !hasThumbnail;
    const needsPlaybackData =
      isVideo &&
      p.hlsReady &&
      !p.hls_url &&
      !p.fullUrl?.includes('.m3u8');
    const staleProcessingState =
      isVideo &&
      !!processingStatus &&
      processingStatus !== 'completed' &&
      processingStatus !== 'failed';

    return (
      missingThumbnailForVideo ||
      needsPlaybackData ||
      staleProcessingState ||
      needsRenderableMediaEnrichment(p) ||
      needsChallengeMetaEnrichment(p)
    );
  });

  if (needsEnrichment.length === 0) {
    return normalized;
  }

  const videoAssetMap = await getPostVideoAssetsBatchCached(
    needsEnrichment
      .filter((p: any) => p.type === 'video')
      .map((p: any) => p.id),
  );
  const enrichMap = await getPostDetailsCached(
    needsEnrichment.map((p: any) => p.id),
    { requireNetwork: true },
  );

  return normalized.map((post: any) => {
    const videoAssets = videoAssetMap.get(post.id);
    const enriched = enrichMap.get(post.id);
    if (!videoAssets && !enriched) {
      return post;
    }

    return normalizeUserProfilePost(
      {
        ...post,
        ...videoAssets,
        ...enriched,
        user: enriched?.user || post.user,
      },
      fallbackProfile ?? undefined,
    );
  });
}

const COLORS = {
  light: {
    background: '#f5f5f5',
    card: '#fff',
    border: '#e5e7eb',
    text: '#222',
    textSecondary: '#666',
    primary: '#007AFF',
    button: '#007AFF',
    buttonText: '#fff',
  },
  dark: {
    background: '#18181b',
    card: '#232326',
    border: '#27272a',
    text: '#f3f4f6',
    textSecondary: '#a1a1aa',
    primary: '#60a5fa',
    button: '#60a5fa',
    buttonText: '#18181b',
  },
};

export default function ExternalUserProfileScreen() {
  const { id } = useLocalSearchParams();
  const { user: currentUser } = useAuth();

  // Redirect if this is the logged-in user
  useEffect(() => {
    if (currentUser && currentUser.id === id) {
      router.replace('/(tabs)/profile');
    }
  }, [currentUser, id]);
  if (currentUser && currentUser.id === id) return null;

  return (
    <RealtimeProvider>
      <ProfileContent id={id} currentUser={currentUser} />
    </RealtimeProvider>
  );
}

const ModalVideoPlayer = ({ source }: { source: string }) => {
  const isAppActive = useAppActive();
  const player = useVideoPlayer(source, (player) => {
    player.play();
    player.loop = true;
  });

  useEffect(() => {
    if (!player || isAppActive) return;
    try {
      player.pause();
    } catch (_) {}
  }, [isAppActive, player]);

  return <VideoView player={player} style={styles.overlayMedia} contentFit="contain" nativeControls={true} />;
};

function ProfileContent(props: { id: string | string[] | undefined, currentUser: User | null }) {
  const { id, currentUser } = props;
  const [profile, setProfile] = useState<User | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [approvedPosts, setApprovedPosts] = useState<any[]>([]);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [postsError, setPostsError] = useState<string | null>(null);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followsMeBack, setFollowsMeBack] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);
  const [showUnfollowModal, setShowUnfollowModal] = useState(false);
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [postModalVisible, setPostModalVisible] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMorePosts, setLoadingMorePosts] = useState(false);
  const [hasMorePosts, setHasMorePosts] = useState(true);
  const [nextPostsPage, setNextPostsPage] = useState(2);
  const [initialPostCountResolved, setInitialPostCountResolved] = useState(false);
  const { sendFollowAction, isConnected } = useRealtime();
  const { updateFollowedUsers, syncFollowedUsersFromServer } = useCache();
  const C = COLORS.dark; // Force dark mode
  const navigation = useNavigation();

  const profileSnapshotRef = useRef<User | null>(null);
  const approvedPostsRef = useRef<Post[]>([]);
  const postsRequestIdRef = useRef(0);
  const postsListRef = useRef<FlatList>(null);

  useEffect(() => {
    profileSnapshotRef.current = profile;
  }, [profile]);

  useEffect(() => {
    approvedPostsRef.current = approvedPosts;
  }, [approvedPosts]);

  useEffect(() => {
    if (!id || Array.isArray(id)) {
      return;
    }

    const cached = externalProfileCache[id];
    if (!cached) {
      return;
    }

    if (cached.profile) {
      const hydratedProfile = {
        ...cached.profile,
        posts_count: Math.max(cached.profile.posts_count || 0, cached.totalCount || 0),
      };
      profileSnapshotRef.current = hydratedProfile;
      setProfile(hydratedProfile);
      setLoadingProfile(false);
      setProfileError(null);
      if ((cached.totalCount || 0) > 0) {
        setInitialPostCountResolved(true);
      }
    }

    if (cached.posts.length > 0) {
      approvedPostsRef.current = cached.posts;
      setApprovedPosts(cached.posts);
      setHasMorePosts(cached.hasMore);
      setNextPostsPage(cached.nextPage);
      setLoadingPosts(false);
      setPostsError(null);
    }
  }, [id]);

  const prefetchRenderableThumbnails = useCallback((items: Post[]) => {
    const urls = items
      .map((post: any) => getExternalProfileThumbnailCandidate(post))
      .filter((url): url is string => !!url);

    if (urls.length === 0) {
      return;
    }

    void ExpoImage.prefetch(urls, 'memory-disk').catch(() => {
      // Best-effort only.
    });
  }, []);

  const buildRenderableApprovedPosts = useCallback((items: any[], fallbackProfile?: User | null) => {
    const byId = new Map<string, Post>();

    sortExternalProfilePostsNewestFirst(
      filterSecondarySurfacePosts(
        items.map((post: any) => normalizeUserProfilePost(post, fallbackProfile ?? profileSnapshotRef.current ?? undefined))
      )
    )
      .forEach((post: Post) => {
        if (!post?.id || byId.has(post.id)) {
          return;
        }

        byId.set(post.id, post);
      });

    return Array.from(byId.values());
  }, []);

  const [error, setError] = useState<{ type: 'network' | 'server' | 'unknown'; message: string } | null>(null);

  useRefetchOnReconnect(() => onRefresh());

  useEffect(() => {
    const fetchProfile = async () => {
      if (!id) return;
      setLoadingProfile(true);
      setProfileError(null);
      setError(null);
      try {
        const cachedTotal = !Array.isArray(id) && id ? externalProfileCache[id]?.totalCount || 0 : 0;
        const [response, exactTotal] = await Promise.all([
          userApi.getUserById(id as string),
          cachedTotal > 0 ? Promise.resolve(cachedTotal) : resolveExactApprovedPostsTotal(id as string),
        ]);
        if (response.status === 'success' && response.data) {
          const nextProfile = buildProfileFromApi(
            response.data,
            id as string,
            Math.max(approvedPostsRef.current.length, cachedTotal, exactTotal, profileSnapshotRef.current?.posts_count || 0),
          );
          const stableTotalCount = Math.max(
            cachedTotal,
            exactTotal,
            nextProfile.posts_count || 0,
            approvedPostsRef.current.length,
            profileSnapshotRef.current?.posts_count || 0,
          );
          const stableProfile = {
            ...nextProfile,
            posts_count: stableTotalCount,
          };
          profileSnapshotRef.current = stableProfile;
          setProfile(stableProfile);
          externalProfileCache[id as string] = {
            profile: stableProfile,
            posts: approvedPostsRef.current,
            hasMore: hasMorePosts,
            nextPage: nextPostsPage,
            totalCount: stableTotalCount,
          };
          setInitialPostCountResolved(true);
        } else {
          const errorMsg = response.message || 'Failed to fetch user profile';
          setProfileError(errorMsg);
          setError({ type: 'server', message: errorMsg });
          setInitialPostCountResolved(true);
        }
      } catch (err: any) {
        const isNetworkError = err?.message?.includes('Network') || err?.code === 'NETWORK_ERROR' || !err?.response;
        const errorMsg = err?.message || 'Failed to fetch user profile';
        setProfileError(errorMsg);
        setError({
          type: isNetworkError ? 'network' : 'server',
          message: isNetworkError
            ? 'No internet connection. Please check your network and try again.'
            : errorMsg
        });
        setInitialPostCountResolved(true);
      } finally {
        setLoadingProfile(false);
      }
    };
    fetchProfile();
  }, [id]);

  // Fetch follow state and check if they follow me back
  useEffect(() => {
    const checkFollow = async () => {
      if (!currentUser || !id || currentUser.id === id) return;
      try {
        // Check if I'm following them
        const response = await followsApi.checkFollowing(id as string);
        setIsFollowing(!!response.data?.isFollowing);

        // Check if they follow me back by checking my followers list
        try {
          const myFollowersResponse = await followsApi.getFollowers(currentUser.id, 1, 100);
          if (myFollowersResponse.status === 'success' && myFollowersResponse.data?.followers) {
            // Check if the profile user (id) is in my followers list
            const followsMe = myFollowersResponse.data.followers.some((f: any) => f.id === id);
            setFollowsMeBack(followsMe);
          } else {
            setFollowsMeBack(false);
          }
        } catch {
          setFollowsMeBack(false);
        }
      } catch {
        setIsFollowing(false);
        setFollowsMeBack(false);
      }
    };
    checkFollow();
  }, [id, currentUser]);

  const fetchApprovedPosts = useCallback(async (options?: { background?: boolean; page?: number; reset?: boolean }) => {
    if (!id) return;

    const page = options?.page ?? 1;
    const isReset = options?.reset !== false && page === 1;
    const requestId = isReset ? postsRequestIdRef.current + 1 : postsRequestIdRef.current;
    if (isReset) {
      postsRequestIdRef.current = requestId;
    }
    const fallbackProfile = profileSnapshotRef.current;

    if (isReset && (!options?.background || approvedPostsRef.current.length === 0)) {
      setLoadingPosts(true);
    } else if (page > 1) {
      setLoadingMorePosts(true);
    }
    if (isReset) {
      setPostsError(null);
    }

    try {
      const response = await userApi.getUserApprovedPosts(id as string, page, EXTERNAL_PROFILE_PAGE_LIMIT);
      if (requestId !== postsRequestIdRef.current) {
        return;
      }

      if (response.status === 'success' && response.data) {
        const rawPosts = Array.isArray(response.data)
          ? response.data
          : (response.data as any)?.posts || [];
        const cachedTotal = !Array.isArray(id) && id ? externalProfileCache[id]?.totalCount || 0 : 0;
        const currentKnownTotal = Math.max(
          profileSnapshotRef.current?.posts_count ?? 0,
          approvedPostsRef.current.length,
          cachedTotal,
        );
        const totalApprovedPosts = getApprovedPostsTotal(response.data, currentKnownTotal);
        const normalizedPage = (rawPosts as any[]).map((post: any) =>
          normalizeUserProfilePost(post, fallbackProfile ?? undefined),
        );
        primePostDetailsCache(normalizedPage);

        const visiblePagePosts = buildRenderableApprovedPosts(normalizedPage, fallbackProfile);
        prefetchRenderableThumbnails(visiblePagePosts);

        let nextVisiblePosts: Post[] = [];
        setApprovedPosts((prev) => {
          nextVisiblePosts = isReset
            ? ((options?.background || approvedPostsRef.current.length > 0)
                ? mergeApprovedPostsNewestFirst(prev, visiblePagePosts)
                : visiblePagePosts)
            : mergeApprovedPostsNewestFirst(prev, visiblePagePosts);
          return nextVisiblePosts;
        });
        setHasMorePosts(rawPosts.length >= EXTERNAL_PROFILE_PAGE_LIMIT);
        setNextPostsPage(page + 1);
        setProfile((prev) => prev ? { ...prev, posts_count: totalApprovedPosts } : prev);
        externalProfileCache[id as string] = {
          profile: profileSnapshotRef.current
            ? { ...profileSnapshotRef.current, posts_count: totalApprovedPosts }
            : null,
          posts: nextVisiblePosts,
          hasMore: rawPosts.length >= EXTERNAL_PROFILE_PAGE_LIMIT,
          nextPage: page + 1,
          totalCount: totalApprovedPosts,
        };
        setLoadingPosts(false);

        const enrichedPage = await enrichApprovedPostsPage(rawPosts as any[], fallbackProfile);
        if (requestId !== postsRequestIdRef.current) {
          return;
        }

        const enrichedVisiblePagePosts = buildRenderableApprovedPosts(enrichedPage, fallbackProfile);
        prefetchRenderableThumbnails(enrichedVisiblePagePosts);

        let nextEnrichedPosts: Post[] = [];
        setApprovedPosts((prev) => {
          nextEnrichedPosts = isReset
            ? ((options?.background || approvedPostsRef.current.length > 0)
                ? mergeApprovedPostsNewestFirst(prev, enrichedVisiblePagePosts)
                : enrichedVisiblePagePosts)
            : mergeApprovedPostsNewestFirst(prev, enrichedVisiblePagePosts);
          return nextEnrichedPosts;
        });
        setProfile((prev) => prev ? { ...prev, posts_count: totalApprovedPosts } : prev);
        externalProfileCache[id as string] = {
          profile: profileSnapshotRef.current
            ? { ...profileSnapshotRef.current, posts_count: totalApprovedPosts }
            : null,
          posts: nextEnrichedPosts,
          hasMore: rawPosts.length >= EXTERNAL_PROFILE_PAGE_LIMIT,
          nextPage: page + 1,
          totalCount: totalApprovedPosts,
        };
      } else {
        setPostsError(response.message || 'Failed to fetch posts');
      }
    } catch (err: any) {
      const isNetworkError = err?.message?.includes('Network') || err?.code === 'NETWORK_ERROR';
      setPostsError(isNetworkError
        ? 'Network error. Please check your connection.'
        : err?.message || 'Failed to fetch posts');
    } finally {
      if (requestId === postsRequestIdRef.current && isReset) {
        setLoadingPosts(false);
      }
      setLoadingMorePosts(false);
    }
  }, [buildRenderableApprovedPosts, id, prefetchRenderableThumbnails]);

  useEffect(() => {
    void fetchApprovedPosts({ reset: true, page: 1, background: approvedPostsRef.current.length > 0 });
  }, [fetchApprovedPosts]);

  // Refresh function
  const onRefresh = () => {
    setRefreshing(true);
    // Re-fetch profile and posts
    const fetchData = async () => {
      try {
        if (id) {
          const profileResponse = await userApi.getUserById(id as string);
          if (profileResponse.status === 'success' && profileResponse.data) {
            setProfile(buildProfileFromApi(profileResponse.data, id as string, approvedPostsRef.current.length));
          }
          await fetchApprovedPosts({ reset: true, page: 1, background: approvedPostsRef.current.length > 0 });
        }
      } catch (err: any) {
        console.error('Error refreshing data:', err);
      } finally {
        setRefreshing(false);
      }
    };
    fetchData();
  };

  const handleLoadMorePosts = useCallback(() => {
    if (loadingMorePosts || loadingPosts || !hasMorePosts) {
      return;
    }

    void fetchApprovedPosts({ background: true, page: nextPostsPage, reset: false });
  }, [fetchApprovedPosts, hasMorePosts, loadingMorePosts, loadingPosts, nextPostsPage]);

  const handleFollow = async () => {
    if (!id || !currentUser) return;

    setFollowLoading(true);
    seedFollowingFeedCache(currentUser.id, id as string, approvedPosts);
    updateFollowedUsers(id as string, true);
    try {
      const response = await followsApi.follow(id as string);
      if (response.status === 'success') {
        setIsFollowing(true);
        if (profile) {
          setProfile(prev => prev ? { ...prev, followers_count: (prev.followers_count || 0) + 1 } : null);
        }
        if (isConnected) sendFollowAction(id as string, true);
        void syncFollowedUsersFromServer();
        void prefetchFollowingFeed(currentUser.id);
      } else {
        updateFollowedUsers(id as string, false);
        removeUserFromFollowingFeedCache(currentUser.id, id as string);
      }
    } catch (error) {
      updateFollowedUsers(id as string, false);
      removeUserFromFollowingFeedCache(currentUser.id, id as string);
      Alert.alert('Error', 'Failed to follow user');
    } finally {
      setFollowLoading(false);
    }
  };

  const handleUnfollow = async () => {
    if (!id || !currentUser) return;
    setShowUnfollowModal(false);

    setFollowLoading(true);
    removeUserFromFollowingFeedCache(currentUser.id, id as string);
    updateFollowedUsers(id as string, false);
    try {
      const response = await followsApi.unfollow(id as string);
      if (response.status === 'success') {
        setIsFollowing(false);
        if (profile) {
          setProfile(prev => prev ? { ...prev, followers_count: Math.max(0, (prev.followers_count || 0) - 1) } : null);
        }
        if (isConnected) sendFollowAction(id as string, false);
        void syncFollowedUsersFromServer();
      } else {
        updateFollowedUsers(id as string, true);
        seedFollowingFeedCache(currentUser.id, id as string, approvedPosts);
      }
    } catch (error) {
      updateFollowedUsers(id as string, true);
      seedFollowingFeedCache(currentUser.id, id as string, approvedPosts);
      Alert.alert('Error', 'Failed to unfollow user');
    } finally {
      setFollowLoading(false);
    }
  };

  const handlePostPress = useCallback((post: Post) => {
    const cardMeta = getExternalProfilePostCardMeta(post);
    if (!cardMeta.canOpen) {
      Alert.alert(
        cardMeta.statusLabel === 'Processing' ? 'Post processing' : 'Post unavailable',
        cardMeta.statusLabel === 'Processing'
          ? 'This post is still processing. It will open once playback is ready.'
          : 'This post is not available for playback right now.',
      );
      return;
    }

    setProfileFeedLaunchCache(id as string, 'active', approvedPosts);
    // Navigate to full-screen profile feed with current post as initial
    router.push({
      pathname: '/profile-feed/[userId]',
      params: {
        userId: id as string,
        initialPostId: post.id,
        status: 'active',
        initialPostData: JSON.stringify(post) // CRITICAL: Pass data for instant loading
      }
    });
  }, [approvedPosts, id]);

  const renderPostCard = useCallback(
    ({ item }: { item: Post }) => (
      <VideoThumbnailCard
        post={item}
        onPress={() => handlePostPress(item)}
      />
    ),
    [handlePostPress],
  );

  const handleClosePostModal = () => {
    setPostModalVisible(false);
    setSelectedPost(null);
  };

  // Cleanup effect to pause videos when modal closes
  useEffect(() => {
    if (!postModalVisible && selectedPost) {
      setSelectedPost(null);
    }
  }, [postModalVisible]);

  const handleSharePost = async () => {
    if (!selectedPost) return;

    try {
      await sharePost(selectedPost);
    } catch (error) {
      Alert.alert('Error', 'Failed to share post');
    }
  };

  const handleDownloadPost = async () => {
    if (!selectedPost) return;

    try {
      await downloadPostToLibrary(selectedPost);
      Alert.alert('Download complete', 'The post was saved to your device.');
    } catch (error) {
      Alert.alert('Error', 'Failed to download post');
    }
  };

  function getPostMedia(post: any) {
    if (Array.isArray(post.media) && post.media[0]) {
      return { url: post.media[0].url, type: post.media[0].type };
    }
    if (post.image) return { url: post.image, type: 'image' };
    if (post.imageUrl) return { url: post.imageUrl, type: 'image' };
    if (post.video_url) return { url: post.video_url, type: 'video' };
    if (post.videoUrl) return { url: post.videoUrl, type: 'video' };
    return { url: '', type: '' };
  }

  function getCategoryString(category: string | object) {
    if (typeof category === 'string') return category;
    if (typeof category === 'object' && category !== null) {
      return (category as any).name || 'Unknown';
    }
    return 'Unknown';
  }

  // Set the header title to the user's name or username
  useEffect(() => {
    if (profile) {
      navigation.setOptions({
        title: profile.name || profile.username || 'Profile',
      });
    }
  }, [profile, navigation]);

  if (loadingProfile || !initialPostCountResolved) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: C.background }]} edges={['top']}>
        <View style={styles.loadingContainer}>
          <DotsSpinner size={10} color={C.primary} />
          <Text style={[styles.loadingText, { color: C.text }]}>Loading profile...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (profileError || !profile) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: C.background }]} edges={['top']}>
        <View style={styles.loadingContainer}>
          <MaterialIcons name="error-outline" size={48} color={C.textSecondary} />
          <Text style={[styles.errorText, { color: C.text }]}>
            {profileError || 'Failed to load profile'}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: C.background }]} edges={['top']}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: C.background, borderBottomColor: C.border }]}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => safeRouterBack(router, '/(tabs)/explore' as any)}
        >
          <MaterialIcons name="arrow-back" size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: C.text }]}>
          {profile?.name || profile?.username || 'Profile'}
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      <FlatList
        ref={postsListRef}
        data={approvedPosts}
        keyExtractor={(item) => item.id}
        numColumns={3}
        removeClippedSubviews={false}
        initialNumToRender={12}
        maxToRenderPerBatch={18}
        windowSize={7}
        updateCellsBatchingPeriod={30}
        contentContainerStyle={styles.postsGrid}
        onEndReached={handleLoadMorePosts}
        onEndReachedThreshold={0.6}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={C.primary}
            colors={[C.primary]}
          />
        }
        renderItem={renderPostCard}
        ListHeaderComponent={
          <>
            <View style={styles.profileSection}>
              <Avatar
                user={profile}
                size={100}
                style={styles.avatar}
              />
              {profile?.name && profile.name !== profile.username && (
                <Text style={styles.fullName}>{profile.name}</Text>
              )}
              <Text style={styles.username}>@{profile?.username || 'unknown'}</Text>
              {!!(profile as any)?.email && (
                <Text style={styles.profileEmail}>{(profile as any).email}</Text>
              )}
              {profile?.bio ? (
                <Text style={styles.bio}>{profile.bio}</Text>
              ) : null}

              <View style={styles.statsContainer}>
                <TouchableOpacity style={styles.stat}>
                  <Text style={styles.statValue}>{Math.max(0, profile?.posts_count ?? 0)}</Text>
                  <Text style={styles.statLabel}>Posts</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.stat}
                  onPress={() => router.push({
                    pathname: '/followers/[id]',
                    params: { id: profile.id, type: 'followers' }
                  })}
                >
                  <Text style={styles.statValue}>{profile?.followers_count || 0}</Text>
                  <Text style={styles.statLabel}>Followers</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.stat}
                  onPress={() => router.push({
                    pathname: '/followers/[id]',
                    params: { id: profile.id, type: 'following' }
                  })}
                >
                  <Text style={styles.statValue}>{profile?.following_count || 0}</Text>
                  <Text style={styles.statLabel}>Following</Text>
                </TouchableOpacity>
              </View>

              {currentUser && currentUser.id !== id && (
                <TouchableOpacity
                  onPress={isFollowing ? () => setShowUnfollowModal(true) : handleFollow}
                  disabled={followLoading}
                  style={[
                    styles.editButton,
                    isFollowing && styles.followingButton,
                  ]}
                >
                  {followLoading ? (
                    <DotsSpinner size={6} color={isFollowing ? C.primary : '#fff'} />
                  ) : (
                    <Text style={[
                      styles.editButtonText,
                      isFollowing && styles.followingButtonText,
                    ]}>
                      {isFollowing ? 'Following' : (followsMeBack ? 'Follow Back' : 'Follow')}
                    </Text>
                  )}
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.tabsContainer}>
              <View style={[styles.tab, styles.tabActive]}>
                <MaterialIcons name="grid-on" size={16} color="#60a5fa" />
                <Text style={[styles.tabText, styles.tabTextActive]}>Posts</Text>
              </View>
            </View>
          </>
        }
        ListEmptyComponent={
          loadingPosts ? (
            <View style={styles.loadingContainer}>
              <DotsSpinner size={8} color={C.primary} />
              <Text style={[styles.loadingText, { color: C.textSecondary, marginTop: 12 }]}>Loading posts...</Text>
            </View>
          ) : postsError ? (
            <View style={styles.loadingContainer}>
              <MaterialIcons name="error-outline" size={32} color={C.textSecondary} />
              <Text style={[styles.errorText, { color: C.textSecondary }]}>{postsError}</Text>
            </View>
          ) : (
            <View style={styles.emptyContainer}>
              <MaterialIcons name="photo-library" size={48} color={C.textSecondary} />
              <Text style={[styles.emptyText, { color: C.textSecondary }]}>No posts yet</Text>
            </View>
          )
        }
        ListFooterComponent={
          loadingMorePosts ? (
            <View style={styles.listFooterLoader}>
              <ActivityIndicator size="small" color={C.primary} />
            </View>
          ) : null
        }
      />

      {/* Post Modal Overlay */}
      <Modal visible={postModalVisible} animationType="slide" transparent onRequestClose={handleClosePostModal}>
        <View style={[styles.overlayBackdrop, { backgroundColor: 'rgba(0,0,0,0.95)' }]}>
          <View style={styles.overlayContent}>
            <TouchableOpacity style={styles.overlayClose} onPress={handleClosePostModal}>
              <MaterialIcons name="close" size={28} color="#fff" />
            </TouchableOpacity>
            {selectedPost && (() => {
              const { url: mediaUrl, type: mediaType } = getPostMedia(selectedPost);
              const isVideo = mediaType === 'video';
              return (
                <View style={styles.overlayMediaContainer}>
                  {mediaUrl ? (
                    isVideo ? (
                      <ModalVideoPlayer source={mediaUrl} />
                    ) : (
                      <ExpoImage
                        source={{ uri: mediaUrl }}
                        style={styles.overlayMedia}
                        contentFit="contain"
                        cachePolicy="memory-disk"
                        transition={0}
                      />
                    )
                  ) : (
                    <ExpoImage
                      source={{ uri: 'https://via.placeholder.com/300' }}
                      style={styles.overlayMedia}
                      contentFit="contain"
                      cachePolicy="memory-disk"
                      transition={0}
                    />
                  )}
                  <View style={styles.overlayActions}>
                    <TouchableOpacity style={styles.overlayAction} onPress={handleSharePost}>
                      <MaterialIcons name="share" size={24} color="#fff" />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.overlayAction} onPress={handleDownloadPost}>
                      <MaterialIcons name="download" size={24} color="#fff" />
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })()}
          </View>
        </View>
      </Modal>
      <UnfollowConfirmModal
        visible={showUnfollowModal}
        username={profile?.username || 'user'}
        onConfirm={handleUnfollow}
        onCancel={() => setShowUnfollowModal(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    backgroundColor: '#000000',
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    flex: 1,
    textAlign: 'center',
  },
  headerSpacer: {
    width: 40,
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
  fullName: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 4,
  },
  username: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 6,
  },
  profileEmail: {
    color: '#a1a1aa',
    fontSize: 13,
    marginBottom: 8,
  },
  bio: {
    color: '#999',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 20,
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
    alignItems: 'center',
  },
  editButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  followingButton: {
    backgroundColor: 'transparent',
    borderColor: '#60a5fa',
  },
  followingButtonText: {
    color: '#60a5fa',
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
    paddingBottom: 24,
  },
  postCard: {
    width: EXTERNAL_PROFILE_POST_ITEM_SIZE,
    aspectRatio: 0.75,
    margin: 1,
    position: 'relative',
    backgroundColor: '#1a1a1a',
    borderRadius: 2,
    overflow: 'hidden',
  },
  postImage: {
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
  videoPlayIndicator: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 12,
    padding: 4,
    alignItems: 'center',
  },
  postStatusBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    backgroundColor: 'rgba(15, 23, 42, 0.88)',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  postStatusBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  challengeBadge: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 28,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  challengeBadgeTextWrap: {
    flex: 1,
  },
  challengeBadgeLabel: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  challengeBadgeName: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
  },
  errorText: {
    textAlign: 'center',
    fontSize: 16,
    marginTop: 12,
    marginBottom: 8,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    marginTop: 12,
    fontSize: 16,
  },
  listFooterLoader: {
    paddingVertical: 16,
  },
  overlayBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  overlayContent: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  overlayClose: {
    position: 'absolute',
    top: 50,
    right: 20,
    zIndex: 1,
    padding: 8,
  },
  overlayMediaContainer: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 20,
  },
  overlayMedia: {
    width: '100%',
    height: '90%',
    maxWidth: '95%',
    maxHeight: '90%',
  },
  overlayActions: {
    position: 'absolute',
    bottom: 50,
    flexDirection: 'row',
  },
  overlayAction: {
    marginHorizontal: 20,
    padding: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 25,
  },
  noMediaPlaceholder: {
    backgroundColor: '#1a1a1a',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
