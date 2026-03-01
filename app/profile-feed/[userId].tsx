import React, { useState, useEffect, useRef, useCallback, createContext, useContext } from 'react';
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
import { useVideoPlayer, VideoView } from 'expo-video';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { postsApi, likesApi, userApi } from '@/lib/api';
import { API_BASE_URL } from '@/lib/config';
import { Post } from '@/types';
import { useAuth } from '@/lib/auth-context';
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
import { useRealtimePost } from '@/lib/hooks/use-realtime-post';
import { useLikesManager } from '@/lib/hooks/use-likes-manager';
import { useVideoPreload } from '@/lib/hooks/use-video-preload';
import ReportModal from '@/components/ReportModal';
import CommentsModal from '@/components/CommentsModal';
import { filterHlsReady } from '@/lib/utils/post-filter';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

// Global mute context
const MuteContext = createContext({ isMuted: false, setIsMuted: (v: boolean) => { } });
const useMute = () => useContext(MuteContext);

// Utility functions
const formatNumber = (num: number): string => {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  }
  return num.toString();
};


import { getPostMediaUrl, getThumbnailUrl, getProfilePictureUrl, getPlaybackUrl, isVideoProcessing } from '@/lib/utils/file-url';
import { Avatar } from '@/components/Avatar';
import { timeAgo } from '@/lib/utils/time-ago';

const getMediaUrl = (post: Post): string | null => {
  return getPostMediaUrl(post);
};

interface PostItemProps {
  item: Post;
  index: number;
  onLike: (postId: string) => void;
  onComment: (postId: string) => void;
  onShare: (postId: string) => void;
  onReport: (postId: string) => void;
  isLiked: boolean;
  isActive: boolean;
  shouldPreload: boolean;
  availableHeight: number;
}

// Expandable caption component
const ExpandableCaption = ({ text, maxLines = 3 }: { text: string; maxLines?: number }) => {
  const [expanded, setExpanded] = useState(false);

  if (!text) return null;

  const estimatedLines = text.length / 50;
  const shouldTruncate = estimatedLines > maxLines || text.split('\n').length > maxLines;

  return (
    <View>
      <Text
        style={styles.caption}
        numberOfLines={expanded ? undefined : maxLines}
      >
        {text}
      </Text>
      {shouldTruncate && (
        <TouchableOpacity onPress={() => setExpanded(!expanded)} activeOpacity={0.7}>
          <Text style={styles.showMoreText}>
            {expanded ? 'Show less' : 'Show more'}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const PostItem = React.memo(({
  item,
  index,
  onLike,
  onComment,
  onShare,
  onReport,
  isLiked,
  isActive,
  shouldPreload,
  availableHeight
}: PostItemProps) => {
  const { user } = useAuth();
  const { sendLikeAction } = useRealtime();
  const dispatch = useAppDispatch();
  const likedPosts = useAppSelector(state => state.likes.likedPosts);
  const postLikeCounts = useAppSelector(state => state.likes.postLikeCounts);

  const isPostLiked = likedPosts.includes(item.id);
  const cachedLikeCount = postLikeCounts[item.id];
  const initialLikeCount = cachedLikeCount !== undefined ? cachedLikeCount : (item.likes || 0);

  const { likes, comments, isLiked: realtimeIsLiked, updateLikesLocally } = useRealtimePost({
    postId: item.id,
    initialLikes: initialLikeCount,
    initialComments: item.comments_count || 0,
    initialIsLiked: isPostLiked || isLiked,
  });

  const [isLiking, setIsLiking] = useState(false);
  const [imageError, setImageError] = useState(false);
  const { isMuted, setIsMuted } = useMute();
  const [videoError, setVideoError] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const insets = useSafeAreaInsets();

  const likeScale = useRef(new Animated.Value(1)).current;
  const likeOpacity = useRef(new Animated.Value(0)).current;
  const muteOpacity = useRef(new Animated.Value(0)).current;
  const muteIconRef = useRef<'volume-2' | 'volume-x'>('volume-2');
  const [isPausedByPress, setIsPausedByPress] = useState(false);
  const isPausedByPressRef = useRef(false);
  const [videoProgress, setVideoProgress] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);

  const mediaUrl = getMediaUrl(item);

  // Log post item structure for debugging (only first 3 items to avoid spam)
  if (__DEV__ && index < 3) {
    console.log(`📄 [ProfileFeed PostItem ${index}] Post data:`, {
      id: item.id,
      type: item.type,
      video_url: item.video_url,
      image: item.image,
      imageUrl: item.imageUrl,
      fullUrl: (item as any).fullUrl,
      mediaUrl: mediaUrl,
      allKeys: Object.keys(item),
    });
  }
  const isVideo =
    item.type === 'video' ||
    (mediaUrl !== null &&
      (mediaUrl.includes('.mp4') ||
        mediaUrl.includes('.mov') ||
        mediaUrl.includes('.webm') ||
        mediaUrl.includes('.m3u8')));

  // HLS-ONLY: Get playback URL — returns .m3u8 only when processing is complete
  const playbackUrl = getPlaybackUrl(item);
  const hlsReady = !!playbackUrl;
  const shouldLoadVideo = isVideo && hlsReady && (isActive || shouldPreload);

  // expo-video player — handles HLS natively
  const videoPlayer = useVideoPlayer(
    shouldLoadVideo && playbackUrl ? playbackUrl : null,
    (player) => {
      if (player) {
        player.loop = true;
        player.muted = isMuted;
      }
    }
  );

  // Track playback state for thumbnail layer
  useEffect(() => {
    if (!videoPlayer) return;
    try {
      const sub = videoPlayer.addListener('playingChange', (event: { isPlaying: boolean }) => {
        setIsPlaying(event.isPlaying);
        if (event.isPlaying) setVideoReady(true);
      });
      return () => { try { sub.remove(); } catch { } };
    } catch { return () => { }; }
  }, [videoPlayer]);

  // Sync mute state
  useEffect(() => {
    if (!videoPlayer) return;
    try { videoPlayer.muted = isMuted; } catch { }
  }, [isMuted, videoPlayer]);

  // Auto-play when active
  useEffect(() => {
    if (!videoPlayer) return;
    if (isActive) {
      try { videoPlayer.play(); } catch { }
    } else {
      try { videoPlayer.pause(); } catch { }
      setVideoReady(false);
      setIsPlaying(false);
    }
  }, [isActive, videoPlayer]);

  const handleVideoTap = () => {
    const newMuted = !isMuted;
    setIsMuted(newMuted);
    muteIconRef.current = newMuted ? 'volume-x' : 'volume-2';
    muteOpacity.setValue(1);
    Animated.timing(muteOpacity, {
      toValue: 0,
      duration: 800,
      delay: 300,
      useNativeDriver: true,
    }).start();
  };

  // Instagram-style long-press to pause, release to resume
  const handleLongPress = () => {
    if (videoPlayer) {
      try {
        videoPlayer.pause();
        isPausedByPressRef.current = true;
      } catch (e) { /* player released */ }
    }
  };

  const handlePressOut = () => {
    if (isPausedByPressRef.current && videoPlayer && isActive) {
      try {
        videoPlayer.play();
      } catch (e) { /* player released */ }
      isPausedByPressRef.current = false;
    }
  };

  // Progress tracking: poll currentTime/duration every 250ms
  useEffect(() => {
    if (!videoPlayer || !isActive) return;
    const interval = setInterval(() => {
      try {
        const ct = videoPlayer.currentTime || 0;
        const dur = videoPlayer.duration || 0;
        if (dur > 0) {
          setVideoProgress(ct / dur);
          setVideoDuration(dur);
        }
      } catch (_) { /* player released */ }
    }, 250);
    return () => clearInterval(interval);
  }, [videoPlayer, isActive]);

  const handleLike = async () => {
    if (!user) {
      Alert.alert(
        'Login Required',
        'Please log in to like posts and interact with the community.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Log In', onPress: () => router.push('/auth/login') }
        ]
      );
      return;
    }

    if (isLiking) return;
    setIsLiking(true);

    const currentIsLiked = isPostLiked;
    const newIsLiked = !currentIsLiked;

    Animated.sequence([
      Animated.timing(likeScale, {
        toValue: 1.3,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(likeScale, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start();

    if (newIsLiked) {
      Animated.sequence([
        Animated.timing(likeOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(likeOpacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
    }

    sendLikeAction(item.id, newIsLiked);
    await onLike(item.id);

    setIsLiking(false);
  };

  const handleComment = useCallback(() => {
    if (onComment && item.id) {
      onComment(item.id);
    }
  }, [onComment, item.id]);

  const handleUserPress = () => {
    if (item.user?.id) {
      router.push({
        pathname: '/user/[id]',
        params: { id: item.user.id }
      });
    }
  };

  const handleCategoryPress = () => {
    const categoryName = typeof item.category === 'string' ? item.category : item.category?.name;
    if (categoryName) {
      router.push({
        pathname: '/category/[name]',
        params: { name: categoryName }
      });
    }
  };

  return (
    <View style={[styles.postContainer, { height: availableHeight }]}>
      {/* Media */}
      <View style={[styles.mediaContainer, { height: availableHeight }]}>
        {isVideo ? (
          <Pressable
            style={styles.mediaWrapper}
            onPress={handleVideoTap}
            onLongPress={handleLongPress}
            onPressOut={handlePressOut}
            delayLongPress={300}
          >
            {/* LAYER 1: Thumbnail — ALWAYS visible until video is PLAYING (zero black screens) */}
            {mediaUrl && (
              <Image
                source={{ uri: getThumbnailUrl(item) || mediaUrl }}
                style={[
                  styles.media,
                  {
                    position: 'absolute',
                    zIndex: 1,
                    opacity: (isActive && isPlaying && videoReady) ? 0 : 1,
                  }
                ]}
                resizeMode="cover"
              />
            )}

            {/* LAYER 2: VideoView (expo-video) — WRAPPED IN pointerEvents=none */}
            {videoPlayer && isActive && !videoError && (
              <View pointerEvents="none" style={{ position: 'absolute', zIndex: 2, width: '100%', height: '100%' }}>
                <VideoView
                  player={videoPlayer}
                  style={styles.media}
                  contentFit="cover"
                  nativeControls={false}
                />
              </View>
            )}

            {/* Error state */}
            {videoError && (
              <View style={[styles.media, styles.placeholderContainer, { zIndex: 10 }]}>
                <Feather name="video-off" size={48} color="#666" />
                <Text style={styles.placeholderText}>Video unavailable</Text>
              </View>
            )}

            {/* No media URL */}
            {!mediaUrl && (
              <View style={[styles.media, styles.placeholderContainer, { zIndex: 10 }]}>
                <Feather name="video-off" size={48} color="#666" />
                <Text style={styles.placeholderText}>Video unavailable</Text>
              </View>
            )}
          </Pressable>
        ) : (
          <View style={styles.mediaWrapper}>
            {mediaUrl && !imageError ? (
              <Image
                source={{ uri: mediaUrl }}
                style={styles.media}
                resizeMode="cover"
                onError={() => setImageError(true)}
              />
            ) : (
              <View style={[styles.media, styles.placeholderContainer]}>
                <Feather name="image" size={48} color="#666" />
                <Text style={styles.placeholderText}>Image unavailable</Text>
              </View>
            )}
          </View>
        )}

        {/* Instagram-style mute indicator — shows on toggle and fades away */}
        {isVideo && isActive && (
          <Animated.View style={[styles.muteIndicatorOverlay, { opacity: muteOpacity }]} pointerEvents="none">
            <View style={styles.muteIndicatorBadge}>
              <Feather name={muteIconRef.current} size={32} color="rgba(255,255,255,0.9)" />
            </View>
          </Animated.View>
        )}

        {/* Progress bar moved to render LAST - after bottomInfo */}


        {/* Heart animation overlay */}
        <Animated.View
          style={[
            styles.heartOverlay,
            { opacity: likeOpacity }
          ]}
          pointerEvents="none"
        >
          <MaterialIcons name="favorite" size={100} color="#fff" />
        </Animated.View>

        {/* Right side actions */}
        <View style={styles.actionsContainer}>
          {/* User avatar */}
          <TouchableOpacity style={styles.avatarContainer} onPress={handleUserPress}>
            <Avatar
              user={item.user ? { ...item.user, profile_picture: item.user.profile_picture ?? undefined } : undefined}
              size={40}
              style={styles.avatar}
            />
          </TouchableOpacity>

          {/* Like */}
          <TouchableOpacity style={styles.actionButton} onPress={handleLike}>
            <Animated.View style={{ transform: [{ scale: likeScale }] }}>
              <MaterialIcons
                name={isPostLiked ? 'favorite' : 'favorite-border'}
                size={28}
                color={isPostLiked ? '#ef4444' : '#fff'}
              />
            </Animated.View>
            <Text style={styles.actionText}>{formatNumber(cachedLikeCount ?? likes)}</Text>
          </TouchableOpacity>

          {/* Comment */}
          <TouchableOpacity style={styles.actionButton} onPress={handleComment}>
            <Feather name="message-circle" size={26} color="#fff" />
            <Text style={styles.actionText}>{formatNumber(comments)}</Text>
          </TouchableOpacity>

          {/* Share */}
          <TouchableOpacity style={styles.actionButton} onPress={() => onShare(item.id)}>
            <Feather name="share-2" size={24} color="#fff" />
          </TouchableOpacity>

          {/* More Actions */}
          <TouchableOpacity style={styles.actionButton} onPress={() => onReport(item.id)}>
            <Feather name="more-horizontal" size={24} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Bottom Info - positioned above progress bar */}
        <View style={[styles.bottomInfo, { bottom: Math.max(insets.bottom + 5, 21) }]}>
          <View style={styles.bottomInfoContent}>
            <TouchableOpacity onPress={handleUserPress}>
              <Text style={styles.username}>@{item.user?.username || 'unknown'}</Text>
            </TouchableOpacity>

            {/* Show caption/description only once - prefer caption, then description, then title */}
            {(item.caption || item.description || item.title) && (
              <ExpandableCaption
                text={item.caption || item.description || item.title || ''}
                maxLines={2}
              />
            )}
            {/* Timestamp */}
            {(item.createdAt || item.uploadDate || (item as any).created_at) && (
              <Text style={styles.timestamp}>
                {timeAgo(item.createdAt || item.uploadDate || (item as any).created_at)}
              </Text>
            )}
          </View>

          {/* Category Badge */}
          {item.category && (
            <TouchableOpacity style={styles.categoryBadge} onPress={handleCategoryPress}>
              <Text style={styles.categoryText}>
                #{typeof item.category === 'string' ? item.category : item.category.name}
              </Text>
            </TouchableOpacity>
          )}

          {/* Publish button for draft posts - accessible from playback screen */}
          {(item.status === 'draft' || item.status === 'Draft') && user && user.id === item.user?.id && (
            <TouchableOpacity
              style={styles.publishDraftButton}
              onPress={() => onReport(item.id)}
              activeOpacity={0.8}
            >
              <Feather name="send" size={16} color="#fff" />
              <Text style={styles.publishDraftButtonText}>Publish</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* PROGRESS BAR — renders LAST, pushed UP above bottom edge */}
        {isVideo && isActive && (
          <View style={[styles.videoProgressBarContainer, { bottom: insets.bottom + 20 }]} pointerEvents="none">
            <View style={[styles.videoProgressBarFill, { width: `${Math.min(videoProgress * 100, 100)}%` }]} />
          </View>
        )}

        {/* Video progress handled by custom progress bar above */}
      </View>
    </View>
  );
});

export default function ProfileFeedScreen() {
  const { userId, initialPostId, status } = useLocalSearchParams();

  return (
    <RealtimeProvider>
      <ProfileFeedContent
        userId={userId as string}
        initialPostId={initialPostId as string}
        status={status as string}
        initialPostData={useLocalSearchParams().initialPostData as string}
      />
    </RealtimeProvider>
  );
}

interface ProfileFeedContentProps {
  userId: string;
  initialPostId?: string;
  status?: string;
  initialPostData?: string;
}

function ProfileFeedContent({ userId, initialPostId, status, initialPostData }: ProfileFeedContentProps) {
  // Parse initial post data if available for instant loading
  const initialPost = initialPostData ? (() => {
    try { return JSON.parse(initialPostData); } catch (e) { return null; }
  })() : null;

  const [posts, setPosts] = useState<Post[]>(initialPost ? [initialPost] : []);
  const [loading, setLoading] = useState(!initialPost);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isScreenFocused, setIsScreenFocused] = useState(true);
  const [initialScrollDone, setInitialScrollDone] = useState(false);
  const lastActiveIndexRef = useRef(0);
  const [reportModalVisible, setReportModalVisible] = useState(false);
  const [reportPostId, setReportPostId] = useState<string | null>(null);
  const [commentsModalVisible, setCommentsModalVisible] = useState(false);
  const [commentsPostId, setCommentsPostId] = useState<string | null>(null);
  const [commentsPostTitle, setCommentsPostTitle] = useState<string>('');
  const [commentsPostAuthor, setCommentsPostAuthor] = useState<string>('');
  const [isMuted, setIsMuted] = useState(false); // Videos unmuted by default
  const [username, setUsername] = useState<string>('');
  const flatListRef = useRef<FlatList>(null);
  const { user } = useAuth();
  const { syncLikedPostsFromServer } = useCache();
  const dispatch = useAppDispatch();
  const likedPosts = useAppSelector(state => state.likes.likedPosts);
  const insets = useSafeAreaInsets();

  const likesManager = useLikesManager();

  // Calculate available height for posts
  const headerHeight = insets.top + 50;
  const bottomNavHeight = 0; // No bottom nav in this screen
  const availableHeight = screenHeight - headerHeight - bottomNavHeight;

  // CRITICAL FIX: Increased limit to fetch all posts from database
  const LIMIT = 100; // Fetch all posts, not just 20

  const loadPosts = useCallback(async (page = 1, refresh = false) => {
    try {
      if (refresh) {
        setRefreshing(true);
        setCurrentPage(1);
        setHasMore(true);
      } else if (page === 1) {
        // Only set loading if we don't have posts (prevent hiding initial post)
        if (posts.length === 0) setLoading(true);
      } else {
        setLoadingMore(true);
      }

      const postStatus = status || 'active';
      const isOwnProfile = user && user.id === userId;

      let response;
      let postsArray: Post[] = [];

      if (isOwnProfile) {
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
        const videoUrl = p.video_url || p.videoUrl || '';
        const hlsUrl = p.hlsUrl || p.hls_url || '';
        const mediaUrl = p.mediaUrl || videoUrl || '';
        return {
          ...p,
          video_url: videoUrl,
          videoUrl: p.videoUrl || videoUrl,
          fullUrl: p.fullUrl || hlsUrl || videoUrl || mediaUrl,
          type: p.type || p.mediaType || (videoUrl ? 'video' : 'image'),
          processing_status: p.processing_status || p.processingStatus,
          processingStatus: p.processingStatus || p.processing_status,
          hlsReady: p.hlsReady || false,
          thumbnail_url: p.thumbnail_url || p.thumbnailUrl || '',
          thumbnailUrl: p.thumbnailUrl || p.thumbnail_url || '',
          thumbnail: p.thumbnail || p.thumbnail_url || p.thumbnailUrl || '',
          likes: p.likes ?? p.likesCount ?? 0,
          comments_count: p.comments_count ?? p.commentsCount ?? p.comment_count ?? 0,
          createdAt: p.createdAt || p.created_at,
          user: p.user || {
            id: p.user_id || p.userId || userId,
            username: p.authorName || p.username || '',
            profile_picture: p.authorProfilePicture || p.profile_picture || '',
          },
        };
      });

      // CRITICAL ENRICHMENT: The user-post endpoints return hlsReady:true but
      // OMIT hls_url and thumbnail_url. Enrich from individual post endpoint.
      const postsNeedingEnrichment = postsArray.filter(
        (p: any) => p.hlsReady && !p.hls_url && !p.fullUrl?.includes('.m3u8')
      );

      if (postsNeedingEnrichment.length > 0) {
        if (__DEV__) {
          console.log(`🔄 [ProfileFeed] Enriching ${postsNeedingEnrichment.length} posts with full data...`);
        }

        const enrichResults = await Promise.allSettled(
          postsNeedingEnrichment.map((p: any) => postsApi.getById(p.id))
        );

        const enrichMap = new Map<string, any>();
        enrichResults.forEach((result, idx) => {
          if (result.status === 'fulfilled' && result.value?.status === 'success' && result.value?.data) {
            const fullPost = result.value.data;
            enrichMap.set(postsNeedingEnrichment[idx].id, fullPost);
          }
        });

        // Merge enriched data back
        postsArray = postsArray.map((p: any) => {
          const enriched = enrichMap.get(p.id);
          if (!enriched) return p;
          return {
            ...p,
            hls_url: enriched.hls_url || enriched.hlsUrl || p.hls_url,
            hlsUrl: enriched.hlsUrl || enriched.hls_url || p.hlsUrl,
            fullUrl: enriched.fullUrl || enriched.hls_url || enriched.hlsUrl || p.fullUrl,
            thumbnail_url: enriched.thumbnail_url || enriched.thumbnailUrl || p.thumbnail_url,
            thumbnailUrl: enriched.thumbnailUrl || enriched.thumbnail_url || p.thumbnailUrl,
            thumbnail: enriched.thumbnail || enriched.thumbnail_url || enriched.thumbnailUrl || p.thumbnail,
            processing_status: enriched.processing_status || enriched.processingStatus || p.processing_status,
            video_url: enriched.video_url || enriched.videoUrl || p.video_url,
            user: enriched.user || p.user,
          };
        });

        if (__DEV__) {
          console.log(`✅ [ProfileFeed] Enriched ${enrichMap.size} posts with HLS data`);
        }
      }

      // Apply HLS filter — only show HLS-transcoded video posts
      postsArray = filterHlsReady(postsArray);

      if (__DEV__) {
        console.log('📥 [ProfileFeed fetchPosts] API Response:', {
          status: response?.status,
          isOwnProfile,
          postStatus,
          postsCount: postsArray.length,
          firstPost: postsArray[0] ? {
            id: postsArray[0].id,
            type: postsArray[0].type,
            video_url: postsArray[0].video_url,
            image: postsArray[0].image,
            imageUrl: postsArray[0].imageUrl,
            fullUrl: (postsArray[0] as any).fullUrl,
            allKeys: Object.keys(postsArray[0]),
          } : null,
          samplePost: postsArray[0],
        });
      }

      if (response?.status === 'success' && postsArray.length >= 0) {
        const pagination = response.data?.pagination || {};
        const hasMoreData = pagination.hasNextPage !== false && postsArray.length === LIMIT;
        setHasMore(hasMoreData);

        // Update like counts in Redux
        const likeCountsMap: Record<string, number> = {};
        postsArray.forEach((post: Post) => {
          if (post.likes !== undefined) {
            likeCountsMap[post.id] = post.likes;
          }
        });
        if (Object.keys(likeCountsMap).length > 0) {
          dispatch(setPostLikeCounts(likeCountsMap));
        }

        // Sync liked posts from server if user is logged in
        if (user && postsArray.length > 0) {
          const postIds = postsArray.map((p: Post) => p.id);
          syncLikedPostsFromServer(postIds).catch(console.error);
        }

        // Prefetch video URLs for instant playback (Expo AV handles caching automatically)
        if (postsArray.length > 0 && (page === 1 || refresh)) {
          const videoPosts = postsArray
            .filter(p => (p.type === 'video' || p.video_url) && getMediaUrl(p))
            .slice(0, 3); // Prefetch first 3 videos

          // Videos will be cached automatically when loaded by Expo AV
          // The cache headers in source will ensure proper caching
        }

        if (page === 1 || refresh) {
          // Ensure posts are in correct order (newest first typically)
          const sortedPosts = [...postsArray].sort((a, b) => {
            const dateA = new Date(a.createdAt || a.uploadDate || 0).getTime();
            const dateB = new Date(b.createdAt || b.uploadDate || 0).getTime();
            return dateB - dateA; // Newest first
          });

          // OPTIMIZATION: Preserve the initial post object reference if it exists
          // This prevents the playing video from re-rendering/flickering when API returns
          if (initialPost && page === 1) {
            const mergedPosts = sortedPosts.map(p =>
              p.id === initialPost.id ? initialPost : p
            );
            setPosts(mergedPosts);
          } else {
            setPosts(sortedPosts);
          }

          // Get username from first post
          if (sortedPosts.length > 0 && sortedPosts[0].user?.username) {
            setUsername(sortedPosts[0].user.username);
          }

          // Scroll to initial post if provided
          if (initialPostId && !initialScrollDone) {
            const initialIndex = sortedPosts.findIndex((p: Post) => p.id === initialPostId);
            if (initialIndex >= 0) {
              setTimeout(() => {
                flatListRef.current?.scrollToIndex({ index: initialIndex, animated: false });
                setCurrentIndex(initialIndex);
                setInitialScrollDone(true);
              }, 100);
            } else {
              setInitialScrollDone(true);
            }
          } else {
            setInitialScrollDone(true);
          }
        } else {
          // Deduplicate when appending
          setPosts(prev => {
            const existingIds = new Set(prev.map(p => p.id));
            const newPosts = postsArray.filter(p => p.id && !existingIds.has(p.id));
            return [...prev, ...newPosts];
          });
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
  }, [userId, status, user, dispatch, syncLikedPostsFromServer, initialPostId, initialScrollDone]);

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

  // CRITICAL FIX: Optimized preloading for profile feed
  useVideoPreload(posts, currentIndex >= 0 ? currentIndex : -1, {
    preloadCount: 5, // Preload 5 videos ahead for instant playback
    backwardCount: 2, // Keep 2 behind for instant back-scroll
    enabled: isScreenFocused,
  });

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
        const mediaUrl = getMediaUrl(post);
        await Share.share({
          message: mediaUrl || post.caption || 'Check out this post on Talynk!',
          title: 'Check out this post on Talynk!',
          url: mediaUrl || undefined,
        });
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

      setCurrentIndex(newIndex);
      lastActiveIndexRef.current = newIndex;
    } else {
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
          onPress={() => router.back()}
          accessibilityLabel="Go back"
          accessibilityRole="button"
        >
          <Feather name="arrow-left" size={24} color="#fff" />
        </TouchableOpacity>

        <Text style={styles.headerTitle}>
          {username ? `@${username}'s Posts` : 'Posts'}
        </Text>

        <View style={styles.headerSpacer} />
      </View>

      <MuteContext.Provider value={{ isMuted, setIsMuted }}>
        <FlatList
          ref={flatListRef}
          data={posts}
          renderItem={({ item, index }) => {
            const isActive = isScreenFocused && currentIndex === index;
            const distanceFromActive = index - currentIndex;
            // Keep players alive: 5 behind + 3 ahead for caching
            const shouldPreload = !isActive &&
              distanceFromActive >= -5 && distanceFromActive <= 3;

            return (
              <PostItem
                item={item}
                index={index}
                onLike={handleLike}
                onComment={handleComment}
                onShare={handleShare}
                onReport={handleReport}
                isLiked={likedPosts.includes(item.id)}
                isActive={isActive}
                shouldPreload={shouldPreload}
                availableHeight={availableHeight}
              />
            );
          }}
          keyExtractor={(item, index) => {
            // Ensure unique keys - use id if available, fallback to index
            return item.id ? `post-${item.id}` : `post-${index}`;
          }}
          pagingEnabled={false}
          showsVerticalScrollIndicator={false}
          snapToInterval={availableHeight}
          snapToAlignment="start"
          decelerationRate="fast"
          disableIntervalMomentum={true}
          contentContainerStyle={{ paddingBottom: 0 }}
          windowSize={2}
          initialNumToRender={1}
          maxToRenderPerBatch={1}
          updateCellsBatchingPeriod={100}
          removeClippedSubviews={true}
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
      </MuteContext.Provider>

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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
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
    backgroundColor: '#000',
  },
  mediaContainer: {
    width: screenWidth,
    position: 'relative',
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  mediaWrapper: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
    overflow: 'visible',
  },
  media: {
    width: '100%',
    height: '100%',
    backgroundColor: '#000',
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

