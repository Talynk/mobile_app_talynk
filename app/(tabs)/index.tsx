import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
  Image,
  useWindowDimensions,
  StatusBar,
  Share,
  Animated,
  Alert,
  Modal,
  AppState,
  PanResponder,
} from 'react-native';
import { FlashList, FlashListRef } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useVideoPlayer, VideoView } from 'expo-video';
import { router, useFocusEffect } from 'expo-router';
import { postsApi, likesApi, followsApi } from '@/lib/api';
import { Post } from '@/types';
import { useAuth } from '@/lib/auth-context';
import { useCache } from '@/lib/cache-context';
import { useAppDispatch, useAppSelector } from '@/lib/store/hooks';
import {
  addLikedPost,
  removeLikedPost,
  setPostLikeCount,
  setPostLikeCounts,
  updateLikeCount,
  clearLikes,
} from '@/lib/store/slices/likesSlice';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRealtime } from '@/lib/realtime-context';
import { useRealtimePost } from '@/lib/hooks/use-realtime-post';
import { useLikesManager } from '@/lib/hooks/use-likes-manager';
import { useNetworkStatus } from '@/lib/hooks/use-network-status';
import ReportModal from '@/components/ReportModal';
import CommentsModal from '@/components/CommentsModal';
import ChallengesList from '@/components/ChallengesList';
import CreateChallengeModal from '@/components/CreateChallengeModal';
import { useVideoPreload } from '@/lib/hooks/use-video-preload';

// expo-video handles video playback - no need for manual video ref management

const FEED_TABS = [
  { key: 'foryou', label: 'For You' },
  { key: 'following', label: 'Following' },
  { key: 'challenges', label: 'Competitions' },
];

const formatNumber = (num: number): string => {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  }
  return num.toString();
};


import { getPostMediaUrl, getThumbnailUrl, getProfilePictureUrl } from '@/lib/utils/file-url';
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
  onFollow: (userId: string) => void;
  onUnfollow: (userId: string) => void;
  isLiked: boolean;
  isFollowing: boolean;
  isActive: boolean;
  shouldPreload: boolean;
  availableHeight: number;
  // STREAMING: No cachedMediaUrl - we stream directly from network
}

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

const PostItem: React.FC<PostItemProps> = ({
  item,
  index,
  onLike,
  onComment,
  onShare,
  onReport,
  onFollow,
  onUnfollow,
  isLiked,
  isFollowing,
  isActive,
  shouldPreload,
  availableHeight,
}) => {
  const { height: screenHeight, width: screenWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();

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
    initialComments: item.comments_count || item.comment_count || 0,
    initialIsLiked: isPostLiked || isLiked,
  });

  const wasActiveRef = useRef(isActive);
  const playerValidRef = useRef(false); // Track if video player is valid (not released)
  const isMountedRef = useRef(true); // CRITICAL FIX: Track if component is mounted to prevent state updates after unmount
  const [isPlayerValid, setIsPlayerValid] = useState(false); // CRITICAL FIX: State-based validity for triggering re-renders
  const [isLiking, setIsLiking] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [videoLoaded, setVideoLoaded] = useState(false);
  const [videoReady, setVideoReady] = useState(false); // INSTAGRAM STYLE: Track when video is ready to display
  const [isPlaying, setIsPlaying] = useState(false);
  const [useNativeControls, setUseNativeControls] = useState(false);
  const [decoderErrorDetected, setDecoderErrorDetected] = useState(false);
  const [videoProgress, setVideoProgress] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [imageLoading, setImageLoading] = useState(true);
  const [videoLoading, setVideoLoading] = useState(true);
  const [isSeeking, setIsSeeking] = useState(false);
  const progressBarRef = useRef<View>(null);

  const mediaUrl = getMediaUrl(item);
  const isVideo =
    item.type === 'video' ||
    (mediaUrl !== null &&
      (mediaUrl.includes('.mp4') ||
        mediaUrl.includes('.mov') ||
        mediaUrl.includes('.webm')));

  // INSTAGRAM STYLE: Create player for current + next + previous (3 player pool)
  // This allows seamless transition when scrolling without creating too many players
  const shouldLoadVideo = isVideo && (isActive || shouldPreload);

  // Use remote URL directly - let native player handle buffering (Instagram approach)
  // Don't download to file system - just stream
  const videoSourceUrl = mediaUrl;

  // CRITICAL: Only create player for ACTIVE video
  const videoPlayerSource = shouldLoadVideo && videoSourceUrl ? videoSourceUrl : null;
  const videoPlayer = useVideoPlayer(
    videoPlayerSource,
    (player) => {
      if (player) {
        try {
          player.loop = true;
          player.muted = isMuted; // Only use muted state, always active
        } catch (error) {
          console.warn('[VideoPlayer] Error setting player properties:', error);
        }
      }
    }
  );

  // CRITICAL FIX: Track if player is valid to prevent using released players
  // This must run immediately when player changes AND trigger re-renders
  useEffect(() => {
    if (videoPlayer) {
      // Player exists - mark as valid
      playerValidRef.current = true;
      if (isMountedRef.current) {
        setIsPlayerValid(true);
      }
    } else {
      // Player is null - mark as invalid immediately
      playerValidRef.current = false;
      if (isMountedRef.current) {
        setIsPlayerValid(false);
      }
    }
  }, [videoPlayer]);

  // CRITICAL FIX: Track component mount state for safe state updates
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      playerValidRef.current = false;
      // Don't call setIsPlayerValid here as component is unmounting
    };
  }, []);

  // CRITICAL FIX: Also check player validity when source changes
  // When source changes, old player gets released, so we need to invalidate immediately
  useEffect(() => {
    if (!videoPlayerSource) {
      // No source - player will be null, mark as invalid
      playerValidRef.current = false;
      if (isMountedRef.current) {
        setIsPlayerValid(false);
      }
    }
  }, [videoPlayerSource]);

  // CRITICAL FIX: Optimized playback management with proper error handling
  // Prevents "released object" errors by checking player validity
  // CRITICAL: This ensures cached videos play instantly when scrolling back
  useEffect(() => {
    if (!videoPlayer || !playerValidRef.current) return;

    try {
      if (isActive && !decoderErrorDetected) {
        // Active: unmute and play
        videoPlayer.muted = isMuted;
        videoPlayer.play();
        setVideoLoading(false);
        setVideoLoaded(true);
      } else {
        // Not active: pause and mute (preloading silently)
        videoPlayer.muted = true;
        videoPlayer.pause();
      }

      // Reset to start when becoming active
      if (isActive && !wasActiveRef.current) {
        videoPlayer.currentTime = 0;
        setVideoReady(false); // Reset videoReady when switching videos
      }

      wasActiveRef.current = isActive;
    } catch (error) {
      // Player was released - mark as invalid
      console.warn('[VideoPlayer] Player released, marking invalid:', error);
      playerValidRef.current = false;
    }
  }, [isActive, isMuted, videoPlayer, decoderErrorDetected, index]);

  // CRITICAL FIX: Instant video playback with proper error handling
  useEffect(() => {
    if (!videoPlayer || !playerValidRef.current) return;

    try {
      const subscription = videoPlayer.addListener('playingChange', (event: { isPlaying: boolean }) => {
        if (isMountedRef.current) {
          setIsPlaying(event.isPlaying);

          if (event.isPlaying && isActive) {
            // MUX STYLE: Video is playing - NOW hide the thumbnail
            setVideoReady(true);
            setVideoLoading(false);
            setVideoLoaded(true);
          }
        }
      });

      return () => {
        try {
          subscription.remove();
        } catch (error) {
          // Silently handle cleanup errors
        }
      };
    } catch (error) {
      // Player was released - mark as invalid
      playerValidRef.current = false;
      return () => { };
    }
  }, [videoPlayer, isActive]);

  // CRITICAL FIX: Also hide loading when video is ready (even if not playing yet)
  useEffect(() => {
    if (!videoPlayer || !isActive) return;

    // If video player exists and is active, assume it's ready
    // This prevents the spinner from showing unnecessarily
    const timer = setTimeout(() => {
      setVideoLoading(false);
      setVideoLoaded(true);
    }, 100); // Very short delay to allow video to initialize

    return () => clearTimeout(timer);
  }, [videoPlayer, isActive]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        setIsSeeking(true);
      },
      onPanResponderMove: async (evt, gestureState) => {
        if (videoDuration === 0 || !videoPlayer || !playerValidRef.current) return;

        const progressFraction = Math.max(0, Math.min(1, gestureState.moveX / screenWidth));
        const newPosition = (progressFraction * videoDuration) / 1000; // Convert to seconds

        setVideoProgress(progressFraction);

        try {
          if (playerValidRef.current) {
            videoPlayer.currentTime = newPosition;
          }
        } catch (error) {
          playerValidRef.current = false;
        }
      },
      onPanResponderRelease: async (evt, gestureState) => {
        if (videoDuration === 0 || !videoPlayer || !playerValidRef.current) return;

        const progressFraction = Math.max(0, Math.min(1, gestureState.moveX / screenWidth));
        const newPosition = (progressFraction * videoDuration) / 1000; // Convert to seconds

        try {
          if (playerValidRef.current) {
            videoPlayer.currentTime = newPosition;
          }
        } catch (error) {
          playerValidRef.current = false;
        }

        setIsSeeking(false);
      },
    })
  ).current;

  const likeScale = useRef(new Animated.Value(1)).current;
  const likeOpacity = useRef(new Animated.Value(0)).current;

  if (__DEV__ && index < 3) {
    console.log(`📄 [PostItem ${index}] Post data:`, {
      id: item.id,
      type: item.type,
      video_url: item.video_url,
      image: item.image,
      imageUrl: item.imageUrl,
      fullUrl: (item as any).fullUrl,
      mediaUrl: mediaUrl,
      shouldPreload,
      isActive,
      allKeys: Object.keys(item),
    });
  }

  // CRITICAL FIX: Don't show loading state - videos preload invisibly
  // Only show loading if video actually fails to load
  useEffect(() => {
    if (!isActive) {
      setVideoLoading(false);
      setImageLoading(false);
    }
    // Don't set loading to true - preloading happens silently
  }, [isActive, isVideo]);


  const handleVideoTap = () => {
    setIsMuted(!isMuted);
  };

  const handleLike = async () => {
    if (!user) {
      Alert.alert(
        'Login Required',
        'Please log in to like posts and interact with the community.',
        [
          {
            text: 'Cancel',
            style: 'cancel'
          },
          {
            text: 'Log In',
            onPress: () => router.push({ pathname: '/auth/login' as any })
          }
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

  const handleFollow = () => {
    if (!user) {
      router.push({ pathname: '/auth/login' as any });
      return;
    }

    if (isFollowing) {
      onUnfollow(item.user?.id || '');
    } else {
      onFollow(item.user?.id || '');
    }
  };

  const handleComment = useCallback(() => {
    if (onComment && item.id) {
      onComment(item.id);
    }
  }, [onComment, item.id]);

  const handleUserPress = () => {
    if (item.user?.id) {
      router.push({
        pathname: '/user/[id]' as any,
        params: { id: item.user.id }
      });
    }
  };

  const handleCategoryPress = () => {
    const categoryName = typeof item.category === 'string' ? item.category : item.category?.name;
    if (categoryName) {
      router.push({
        pathname: '/category/[name]' as any,
        params: { name: categoryName }
      });
    }
  };

  return (
    <View
      style={[styles.postContainer, { height: availableHeight }]}
      pointerEvents="box-none"
    >
      <View style={[styles.mediaContainer, { height: availableHeight, width: screenWidth }]}>
        {isVideo ? (
          <TouchableOpacity
            style={styles.mediaWrapper}
            activeOpacity={1}
            onPress={() => setIsMuted(!isMuted)}
          >
            {/* LAYER 1: Thumbnail - ALWAYS visible until video is PLAYING (Mux style) */}
            {mediaUrl && (
              <Image
                source={{ uri: getThumbnailUrl(item) || mediaUrl }}
                style={[
                  styles.media,
                  {
                    position: 'absolute',
                    zIndex: 1,
                    // MUX STYLE: Only hide thumbnail when video is ACTUALLY PLAYING
                    // This guarantees zero black screens
                    opacity: (isActive && isPlaying && videoReady) ? 0 : 1,
                  }
                ]}
                resizeMode="contain"
              />
            )}

            {/* LAYER 2: VideoView - render for active or preloading */}
            {videoPlayer && isPlayerValid && shouldLoadVideo && !videoError && (
              <VideoView
                player={videoPlayer}
                style={[
                  styles.media,
                  {
                    position: 'absolute',
                    zIndex: 2,
                  }
                ]}
                contentFit="contain"
                nativeControls={useNativeControls}
              />
            )}

            {/* NO play icon overlay - Instagram doesn't show this */}
            {/* Thumbnail is always visible until video plays */}

            {/* CRITICAL FIX: Remove loading spinner - videos should preload silently in background */}
            {/* No loading indicator - preloading happens invisibly, video appears instantly when ready */}

            {/* Show error state */}
            {videoError && (
              <View style={[styles.media, styles.placeholderContainer, { zIndex: 10 }]}>
                <Feather name="video-off" size={48} color="#666" />
                <Text style={styles.placeholderText}>Video unavailable</Text>
              </View>
            )}

            {/* Show placeholder if no media URL */}
            {!mediaUrl && (
              <View style={[styles.media, styles.placeholderContainer, { zIndex: 10 }]}>
                <Feather name="video-off" size={48} color="#666" />
                <Text style={styles.placeholderText}>Video unavailable</Text>
              </View>
            )}
          </TouchableOpacity>
        ) : (
          <View style={styles.mediaWrapper}>
            {mediaUrl && !imageError ? (
              <Image
                source={{ uri: mediaUrl }}
                style={styles.media}
                resizeMode="contain"
              />
            ) : (
              <View style={[styles.media, styles.placeholderContainer]}>
                <Feather name="image" size={48} color="#666" />
                <Text style={styles.placeholderText}>Image unavailable</Text>
              </View>
            )}
          </View>
        )}

        {/* Mute/Unmute Indicator Overlay - Instagram-style center indicator */}
        {isVideo && !useNativeControls && isActive && (
          <View style={styles.muteIndicatorOverlay} pointerEvents="none">
            {isMuted ? (
              <View style={styles.muteIndicatorBadge}>
                <Feather name="volume-x" size={32} color="rgba(255,255,255,0.9)" />
              </View>
            ) : null}
          </View>
        )}

        <View style={[styles.rightActions, { bottom: insets.bottom + 20 }]}>
          <TouchableOpacity style={styles.avatarContainer} onPress={handleUserPress}>
            <Avatar
              user={item.user ? { ...item.user, profile_picture: item.user.profile_picture ?? undefined } : undefined}
              size={48}
              style={styles.userAvatar}
            />
            {user && user.id !== item.user?.id && (
              <TouchableOpacity
                style={styles.followIconButton}
                onPress={handleFollow}
              >
                <Feather
                  name={isFollowing ? "check" : "plus"}
                  size={16}
                  color="#000"
                />
              </TouchableOpacity>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionButton} onPress={handleLike}>
            <Animated.View style={{ transform: [{ scale: likeScale }] }}>
              <Feather
                name="heart"
                size={24}
                color={isPostLiked ? "#ff2d55" : "#fff"}
                fill={isPostLiked ? "#ff2d55" : "none"}
              />
            </Animated.View>
            <Text style={styles.actionCount}>{formatNumber(cachedLikeCount !== undefined ? cachedLikeCount : (item.likes || 0))}</Text>
          </TouchableOpacity>

          <Animated.View
            style={[
              styles.likeAnimationOverlay,
              { opacity: likeOpacity }
            ]}
          >
            <Feather name="heart" size={48} color="#ff2d55" fill="#ff2d55" />
          </Animated.View>

          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => {
              handleComment();
            }}
            activeOpacity={0.7}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Feather name="message-circle" size={24} color="#fff" />
            <Text style={styles.actionCount}>{formatNumber(comments)}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionButton} onPress={() => onShare(item.id)}>
            <Feather name="share-2" size={24} color="#fff" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionButton} onPress={() => onReport(item.id)}>
            <Feather name="more-horizontal" size={24} color="#fff" />
          </TouchableOpacity>
        </View>

        <View style={[styles.bottomInfo, { bottom: 60 + insets.bottom - 40 }]}>
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

          {item.category && (
            <TouchableOpacity style={styles.categoryBadge} onPress={handleCategoryPress}>
              <Text style={styles.categoryText}>
                #{typeof item.category === 'string' ? item.category : item.category.name}
              </Text>
            </TouchableOpacity>
          )}

          {user && user.id !== item.user?.id && (
            <TouchableOpacity
              style={[
                styles.followButton,
                { backgroundColor: isFollowing ? 'rgba(255,255,255,0.2)' : '#60a5fa' }
              ]}
              onPress={handleFollow}
            >
              <Text style={[
                styles.followButtonText,
                { color: isFollowing ? '#fff' : '#000' }
              ]}>
                {isFollowing ? 'Following' : 'Follow'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {isVideo && !useNativeControls && videoDuration > 0 && (
          <View
            ref={progressBarRef}
            style={[
              styles.progressBarContainer,
              {
                position: 'absolute',
                bottom: 60 + insets.bottom - 48,
                left: 0,
                right: 0,
              },
            ]}
            pointerEvents="box-only"
            {...panResponder.panHandlers}
          >

            <View style={styles.progressBarTrack}>
              <View
                style={[
                  styles.progressBarFill,
                  {
                    width: `${videoProgress * 100}%`,
                    backgroundColor: isSeeking ? '#ff6b9d' : '#60a5fa',
                  }
                ]}
              />
            </View>
          </View>
        )}
      </View>
    </View>
  );
};

export default function FeedScreen() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [activeTab, setActiveTab] = useState('foryou');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [scrollDirection, setScrollDirection] = useState<'down' | 'up'>('down'); // MUX STYLE: Track scroll direction
  const [isScreenFocused, setIsScreenFocused] = useState(true);
  const lastActiveIndexRef = useRef(0);
  const lastScrollOffsetRef = useRef(0); // Track scroll position for direction
  const [reportModalVisible, setReportModalVisible] = useState(false);
  const [reportPostId, setReportPostId] = useState<string | null>(null);
  const [commentsModalVisible, setCommentsModalVisible] = useState(false);
  const [commentsPostId, setCommentsPostId] = useState<string | null>(null);
  const [commentsPostTitle, setCommentsPostTitle] = useState<string>('');
  const [commentsPostAuthor, setCommentsPostAuthor] = useState<string>('');
  const [commentsPostOwnerId, setCommentsPostOwnerId] = useState<string | undefined>(undefined);
  const [createChallengeVisible, setCreateChallengeVisible] = useState(false);
  const [challengesRefreshTrigger, setChallengesRefreshTrigger] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [networkError, setNetworkError] = useState(false);
  const [userFollowStatus, setUserFollowStatus] = useState<Record<string, boolean>>({});
  const flatListRef = useRef<FlashListRef<Post>>(null);
  const scrollVelocityRef = useRef(0);
  const lastScrollYRef = useRef(0);
  const lastScrollTimeRef = useRef(Date.now());
  const { user } = useAuth();
  const { followedUsers, updateFollowedUsers, syncLikedPostsFromServer } = useCache();
  const dispatch = useAppDispatch();
  const likedPosts = useAppSelector(state => state.likes.likedPosts);
  const postLikeCounts = useAppSelector(state => state.likes.postLikeCounts);
  const insets = useSafeAreaInsets();
  const { height: screenHeight, width: screenWidth } = useWindowDimensions();

  const likesManager = useLikesManager();
  const { isOffline } = useNetworkStatus();

  // INSTAGRAM STYLE: 3-player pool (current + next + previous)
  // This allows seamless transitions when scrolling
  const { getCachedUri, isCached, preloadedCount } = useVideoPreload(posts, currentIndex, {
    preloadCount: 1, // 1 ahead
    backwardCount: 1, // 1 behind
    direction: 'both',
    enabled: activeTab !== 'challenges',
  });

  const headerTabsHeight = 44;
  const headerPaddingVertical = 12;
  const headerHeight = insets.top + headerTabsHeight + headerPaddingVertical;
  const bottomNavHeight = 60 + insets.bottom;
  const availableHeight = screenHeight - headerHeight;

  // CRITICAL FIX: REDUCED limits to prevent app freezing
  // Load small batches to keep app responsive - load more as user scrolls
  const INITIAL_LIMIT = 10; // Start with 10 posts only
  const LOAD_MORE_LIMIT = 10; // Load 10 more at a time

  // Dynamic limit based on scroll velocity - NOT USED, keeping limits low
  const getDynamicLimit = useCallback(() => {
    return LOAD_MORE_LIMIT; // Always use fixed limit
  }, []);

  const loadPosts = async (tab = 'featured', refresh = false, page = 1) => {
    if (tab === 'challenges') return; // Handled by ChallengesList

    try {
      if (refresh) {
        setRefreshing(true);
        setCurrentPage(1);
        setHasMore(true);
      } else if (page === 1) {
        setLoading(true);
      } else {
        setLoadingMore(true);
      }

      let response;
      // CRITICAL FIX: Always use high limit to fetch ALL posts from database
      // Don't use dynamic limit - we need ALL posts, not just a few
      const limit = page === 1 ? INITIAL_LIMIT : LOAD_MORE_LIMIT;

      const timestamp = refresh ? `&t=${Date.now()}` : '';

      switch (tab) {
        case 'foryou':
          response = await postsApi.getAll(page, limit, timestamp);
          break;
        case 'following':
          if (user) {
            response = await postsApi.getFollowing(page, limit, timestamp);
          } else {
            response = { status: 'success', data: { posts: [], pagination: {}, filters: {} } };
          }
          break;
        default:
          response = await postsApi.getAll(page, limit, timestamp);
      }

      // REMOVED: Aggressive parallel page fetching that was causing app freeze
      // Now we load incrementally as user scrolls - much smoother
      // Posts will load more as user reaches end of feed

      if (response.status === 'success') {
        const posts = response.data.posts || response.data;
        const postsArray = Array.isArray(posts) ? posts : [];

        if (__DEV__) {
          console.log('📥 [fetchPosts] API Response:', {
            status: response.status,
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

        const pagination = response.data.pagination || {};
        // Fix: Better hasMore logic - check totalCount, hasNextPage, AND received count
        const totalReceived = page === 1 ? postsArray.length : posts.length + postsArray.length;
        const hasMoreByCount = pagination.totalCount ? totalReceived < pagination.totalCount : true;
        const hasMoreByPage = pagination.hasNextPage !== false;
        const hasMoreByLimit = postsArray.length >= limit;
        // Only stop pagination if we have definitive evidence there's no more
        const hasMoreData = postsArray.length > 0 && (hasMoreByPage || (hasMoreByLimit && hasMoreByCount));
        setHasMore(hasMoreData);

        if (__DEV__) {
          console.log('📊 [Pagination] hasMore check:', {
            page, limit, received: postsArray.length,
            totalCount: pagination.totalCount, totalReceived,
            hasMoreByPage, hasMoreByLimit, hasMoreByCount, hasMoreData
          });
        }

        const likeCountsMap: Record<string, number> = {};
        postsArray.forEach((post: Post) => {
          if (post.likes !== undefined) {
            likeCountsMap[post.id] = post.likes;
          }
        });
        if (Object.keys(likeCountsMap).length > 0) {
          dispatch(setPostLikeCounts(likeCountsMap));
        }

        if (user && postsArray.length > 0) {
          const postIds = postsArray.map((p: Post) => p.id);
          syncLikedPostsFromServer(postIds).catch(console.error);

          // Fetch actual follow status for all unique users in posts
          const uniqueUserIds = [...new Set(postsArray.map((p: Post) => p.user?.id).filter(Boolean))] as string[];
          const followStatusPromises = uniqueUserIds.map(async (userId: string) => {
            try {
              const response = await followsApi.checkFollowing(userId);
              return { userId, isFollowing: !!response.data?.isFollowing };
            } catch {
              return { userId, isFollowing: false };
            }
          });

          const followStatuses = await Promise.all(followStatusPromises);
          const followStatusMap: Record<string, boolean> = {};
          followStatuses.forEach(({ userId, isFollowing }) => {
            followStatusMap[userId] = isFollowing;
            // Also update cache
            updateFollowedUsers(userId, isFollowing);
          });
          setUserFollowStatus(prev => ({ ...prev, ...followStatusMap }));
        }

        // Prefetch video URLs for instant playback (Expo AV handles caching automatically)
        if (postsArray.length > 0 && page === 1) {
          const videoPosts = postsArray
            .filter(p => (p.type === 'video' || p.video_url) && getMediaUrl(p))
            .slice(0, 3); // Prefetch first 3 videos

          // Videos will be cached automatically when loaded by Expo AV
          // The cache headers in source will ensure proper caching
        }

        if (page === 1 || refresh) {
          setPosts(postsArray);
          setNetworkError(false);
        } else {
          setPosts(prev => [...prev, ...postsArray]);
        }
      } else {
        if (page === 1) {
          setPosts([]);
        }
        setHasMore(false);
      }
    } catch (error: any) {
      const { isNetworkError, getErrorMessage } = require('@/lib/utils/network-error-handler');

      const isNetwork = isNetworkError(error);
      const errorMessage = getErrorMessage(error, 'Failed to load posts');

      if (isNetwork) {
        console.warn('⚠️ Network error loading posts:', errorMessage);
        // For network errors, keep existing posts if available, just show warning
        if (page === 1 && posts.length === 0) {
          setNetworkError(true);
        }
      } else {
        console.warn('⚠️ Error loading posts:', error);
        if (page === 1) {
          setPosts([]);
          setNetworkError(true); // Show network error UI for any error
        }
      }
      setHasMore(false);
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  };

  // Velocity-based fetching: adjust batch size based on scroll speed
  const getFetchLimit = useCallback((velocity: number): number => {
    // Fast scrolling (>500 px/s) → larger batches (10 videos)
    // Slow scrolling (<200 px/s) → smaller batches (3 videos)
    // Medium scrolling → default (5 videos)
    if (velocity > 500) return 10;
    if (velocity < 200) return 3;
    return 5;
  }, []);

  // CRITICAL FIX: Aggressive predictive preloading - fetch more posts earlier
  // This ensures we always have content ready when user scrolls
  const loadMorePosts = useCallback(() => {
    if (!loadingMore && hasMore && !loading && activeTab !== 'challenges') {
      const remainingItems = posts.length - currentIndex;
      // Start fetching when 10 items away from end (very aggressive preloading)
      // This ensures posts are ready before user reaches the end
      if (remainingItems <= 10) {
        const nextPage = currentPage + 1;
        setCurrentPage(nextPage);
        loadPosts(activeTab, false, nextPage);
      }
    }
  }, [loadingMore, hasMore, loading, activeTab, posts.length, currentIndex, currentPage]);

  useEffect(() => {
    if (activeTab !== 'challenges') {
      setCurrentPage(1);
      setHasMore(true);
      loadPosts(activeTab, false, 1);
    }
  }, [activeTab]);

  useEffect(() => {
    if (user && posts.length > 0) {
      const postIds = posts.map(p => p.id);
      syncLikedPostsFromServer(postIds).catch(console.error);
    } else if (!user) {
      dispatch(clearLikes());
    }
  }, [user?.id, posts.length]);

  useEffect(() => {
    const handleAppStateChange = (nextAppState: string) => {
      if (nextAppState === 'active' && activeTab !== 'challenges') {
        setCurrentPage(1);
        setHasMore(true);
        loadPosts(activeTab, true, 1);
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription?.remove();
  }, [activeTab]);

  const currentIndexRef = useRef(currentIndex);

  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  // expo-video handles preloading via useVideoPlayer with conditional source
  // Videos in preload window get URL, others get null for memory management

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
        // No cleanup needed - expo-video handles it
      };
    }, [])
  );

  const onRefresh = () => {
    setCurrentPage(1);
    setHasMore(true);
    loadPosts(activeTab, true, 1);
  };

  const handleLike = async (postId: string) => {
    if (!user) {
      Alert.alert(
        'Login Required',
        'Please log in to like posts.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Login', onPress: () => router.push({ pathname: '/auth/login' as any }) }
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

  const handleFollow = async (userId: string) => {
    if (!user) return;
    // Optimistic update
    updateFollowedUsers(userId, true);
    setUserFollowStatus(prev => ({ ...prev, [userId]: true }));
    try {
      const response = await followsApi.follow(userId);
      if (response.status !== 'success') {
        // Revert on error
        updateFollowedUsers(userId, false);
        setUserFollowStatus(prev => ({ ...prev, [userId]: false }));
      } else {
        // Confirm with backend
        const checkResponse = await followsApi.checkFollowing(userId);
        setUserFollowStatus(prev => ({ ...prev, [userId]: !!checkResponse.data?.isFollowing }));
      }
    } catch (error) {
      // Revert on error
      updateFollowedUsers(userId, false);
      setUserFollowStatus(prev => ({ ...prev, [userId]: false }));
    }
  };

  const handleUnfollow = async (userId: string) => {
    if (!user) return;
    // Optimistic update
    updateFollowedUsers(userId, false);
    setUserFollowStatus(prev => ({ ...prev, [userId]: false }));
    try {
      const response = await followsApi.unfollow(userId);
      if (response.status !== 'success') {
        // Revert on error
        updateFollowedUsers(userId, true);
        setUserFollowStatus(prev => ({ ...prev, [userId]: true }));
      } else {
        // Confirm with backend
        const checkResponse = await followsApi.checkFollowing(userId);
        setUserFollowStatus(prev => ({ ...prev, [userId]: !!checkResponse.data?.isFollowing }));
      }
    } catch (error) {
      // Revert on error
      updateFollowedUsers(userId, true);
      setUserFollowStatus(prev => ({ ...prev, [userId]: true }));
    }
  };

  const handleComment = useCallback((postId: string) => {
    if (!postId) return;

    const post = posts.find(p => p.id === postId);
    setCommentsPostId(postId);
    setCommentsPostTitle(post?.title || post?.description || '');
    setCommentsPostAuthor(post?.user?.username || '');
    setCommentsPostOwnerId(post?.user?.id);
    setCommentsModalVisible(true);
  }, [posts]);

  const handleCommentAdded = useCallback(() => {
    if (commentsPostId) {
      setPosts(currentPosts =>
        currentPosts.map(post => {
          if (post.id === commentsPostId) {
            const currentCount = post.comments_count || post.comment_count || 0;
            return {
              ...post,
              comments_count: currentCount + 1,
              comment_count: currentCount + 1
            };
          }
          return post;
        })
      );
    }
  }, [commentsPostId]);

  const handleCommentDeleted = useCallback(() => {
    if (commentsPostId) {
      setPosts(currentPosts =>
        currentPosts.map(post => {
          if (post.id === commentsPostId) {
            const currentCount = post.comments_count || post.comment_count || 0;
            const newCount = Math.max(0, currentCount - 1);
            return {
              ...post,
              comments_count: newCount,
              comment_count: newCount
            };
          }
          return post;
        })
      );
    }
  }, [commentsPostId]);

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
      }
    }
  };

  const handleReport = (postId: string) => {
    if (!user) {
      router.push({ pathname: '/auth/login' as any });
      return;
    }
    setReportPostId(postId);
    setReportModalVisible(true);
  };

  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    if (viewableItems.length > 0) {
      const visibleItem = viewableItems[0];
      const newIndex = visibleItem.index || 0;
      const postId = visibleItem.item?.id;

      if (postId) {
        likesManager.onPostVisible(postId);
      }

      // expo-video handles pause/play automatically via isActive prop
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

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      <View style={styles.header}>
        <View style={styles.tabsContainer}>
          {FEED_TABS.map((tab) => (
            <TouchableOpacity
              key={tab.key}
              style={[
                styles.tab,
                activeTab === tab.key && styles.tabActive
              ]}
              onPress={() => setActiveTab(tab.key)}
            >
              <Text style={[
                styles.tabText,
                activeTab === tab.key && styles.tabTextActive
              ]}>
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
          />
          <CreateChallengeModal
            visible={createChallengeVisible}
            onClose={() => setCreateChallengeVisible(false)}
            onCreated={() => {
              // Trigger refresh of challenges list
              setChallengesRefreshTrigger(prev => prev + 1);
            }}
          />
        </>
      ) : (
        <>
          {loading && posts.length === 0 ? (
            <View style={styles.loadingContainer}>
              {/* Skeleton loaders - TikTok-style placeholders */}
              {[1, 2, 3].map((i) => (
                <View key={i} style={[styles.skeletonItem, { height: availableHeight }]}>
                  <View style={styles.skeletonMedia} />
                  <View style={styles.skeletonActions}>
                    <View style={styles.skeletonAvatar} />
                    <View style={styles.skeletonActionButton} />
                    <View style={styles.skeletonActionButton} />
                    <View style={styles.skeletonActionButton} />
                  </View>
                  <View style={styles.skeletonBottomInfo}>
                    <View style={styles.skeletonUsername} />
                    <View style={styles.skeletonCaption} />
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <FlashList
              ref={flatListRef}
              data={posts}
              extraData={currentIndex} // CRITICAL: Force re-render when active video changes for preloading
              ListHeaderComponent={
                (networkError || isOffline) ? (
                  <View style={styles.offlineBanner}>
                    <Feather name="wifi-off" size={16} color="#fff" />
                    <Text style={styles.offlineBannerText}>
                      No or low internet connection. Some features may not load.
                    </Text>
                  </View>
                ) : null
              }
              stickyHeaderIndices={(networkError || isOffline) ? [0] : undefined}
              renderItem={({ item, index }) => {
                const isActive = isScreenFocused && currentIndex === index;

                // INSTAGRAM STYLE: ALWAYS preload 5 ahead + 1 behind
                // This ensures instant playback when scrolling in any direction
                const distanceFromActive = index - currentIndex;

                // Preload items within range: 1 behind (-1) to 5 ahead (+5)
                const shouldPreload = !isActive &&
                  distanceFromActive >= -1 && distanceFromActive <= 5;

                // STREAMING: Videos stream directly - native player handles buffering

                return (
                  <PostItem
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
                    shouldPreload={shouldPreload}
                    availableHeight={availableHeight}
                  />
                );
              }}
              keyExtractor={(item) => item.id}
              snapToInterval={availableHeight}
              snapToAlignment="start"
              decelerationRate="fast"
              disableIntervalMomentum={true}
              showsVerticalScrollIndicator={false}
              pagingEnabled={false}
              contentContainerStyle={{ paddingBottom: 0 }}
              getItemType={() => 'post'}
              drawDistance={availableHeight * 5}
              scrollEventThrottle={16}
              nestedScrollEnabled={false}
              scrollEnabled={true}
              bounces={false}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={onRefresh}
                  tintColor="#60a5fa"
                />
              }
              onScroll={(event) => {
                const currentY = event.nativeEvent.contentOffset.y;
                const currentTime = Date.now();
                const timeDelta = currentTime - lastScrollTimeRef.current;

                // MUX STYLE: Track scroll direction for directional preloading
                if (currentY > lastScrollOffsetRef.current + 10) {
                  setScrollDirection('down');
                } else if (currentY < lastScrollOffsetRef.current - 10) {
                  setScrollDirection('up');
                }
                lastScrollOffsetRef.current = currentY;

                if (timeDelta > 0) {
                  const distance = Math.abs(currentY - lastScrollYRef.current);
                  scrollVelocityRef.current = (distance / timeDelta) * 1000;
                  lastScrollYRef.current = currentY;
                  lastScrollTimeRef.current = currentTime;
                }
              }}
              onEndReached={loadMorePosts}
              onEndReachedThreshold={0.5}
              ListFooterComponent={
                loadingMore ? (
                  <View style={styles.loadMoreContainer}>
                    <ActivityIndicator size="small" color="#60a5fa" />
                    <Text style={styles.loadMoreText}>Loading more posts...</Text>
                  </View>
                ) : null
              }
              onViewableItemsChanged={onViewableItemsChanged}
              viewabilityConfig={viewabilityConfig}
              ListEmptyComponent={
                <View style={[styles.emptyContainer, { height: availableHeight - 100 }]}>
                  <Feather name={(networkError || isOffline) ? "wifi-off" : "video"} size={64} color="#666" />
                  <Text style={styles.emptyText}>
                    {(networkError || isOffline) ? 'No or Low Internet Connection' : 'No posts available'}
                  </Text>
                  <Text style={styles.emptySubtext}>
                    {(networkError || isOffline)
                      ? 'Please check your connection and try again.'
                      : activeTab === 'following' && !user
                        ? 'Sign in to see posts from people you follow'
                        : 'Pull down to refresh or check back later'
                    }
                  </Text>
                  {(networkError || isOffline) && (
                    <TouchableOpacity
                      style={styles.retryButton}
                      onPress={onRefresh}
                    >
                      <Text style={styles.retryButtonText}>Retry</Text>
                    </TouchableOpacity>
                  )}
                </View>
              }
            />
          )}
        </>
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
          setTimeout(() => {
            setCommentsPostId(null);
          }, 300);
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#000000',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'center', // Centered since search button is gone
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 6,
    backgroundColor: 'rgba(0,0,0,0.95)',
    zIndex: 100,
    height: 56,
  },
  offlineBanner: {
    backgroundColor: 'rgba(239, 68, 68, 0.92)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  offlineBannerText: {
    flex: 1,
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  tabsContainer: {
    flexDirection: 'row',
    // flex: 1, // No longer needed if we want to center strictly
    justifyContent: 'center',
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
  postContainer: {
    width: '100%',
    backgroundColor: '#000',
    overflow: 'hidden',
  },
  mediaContainer: {
    flex: 1,
  },
  mediaWrapper: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
  },
  media: {
    backgroundColor: '#000',
    width: '100%',
    height: '100%',
  },
  muteButton: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 20,
    padding: 8,
    zIndex: 20,
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
  rightActions: {
    position: 'absolute',
    right: 12,
    alignItems: 'center',
    zIndex: 999, // Increased zIndex
    elevation: 10, // Added elevation for Android
    maxHeight: '50%',
  },
  avatarContainer: {
    position: 'relative',
    marginBottom: 12,
  },
  userAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: '#fff',
  },
  followIconButton: {
    position: 'absolute',
    bottom: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#60a5fa',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButton: {
    alignItems: 'center',
    marginBottom: 12,
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
    padding: 6,
    zIndex: 1000, // Ensure individual buttons are clickable
  },
  actionCount: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '600',
    marginTop: 3,
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  likeAnimationOverlay: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: [{ translateX: -24 }, { translateY: -24 }],
    zIndex: 100,
  },
  bottomInfo: {
    position: 'absolute',
    bottom: 0,
    left: 12,
    right: 84, // leave room for right actions
    zIndex: 21,
    elevation: 5, // Added elevation
  },
  bottomInfoContent: {
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  username: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 6,
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
  },
  caption: {
    color: '#fff',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
    textShadowColor: 'rgba(0, 0, 0, 0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  showMoreText: {
    color: '#60a5fa',
    fontSize: 12,
    marginTop: 3,
    fontWeight: '500',
  },
  timestamp: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 11,
    marginTop: 4,
    textShadowColor: 'rgba(0, 0, 0, 0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
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
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
  },
  categoryBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(96, 165, 250, 0.8)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 6,
    marginTop: 4,
  },
  categoryText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  followButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  followButtonText: {
    fontSize: 12,
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
  retryButton: {
    backgroundColor: '#60a5fa',
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 24,
    marginTop: 20,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  placeholderContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
  },
  placeholderText: {
    color: '#666',
    fontSize: 14,
    marginTop: 12,
  },
  thumbnailOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
  },
  playIconOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    zIndex: 5,
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
  progressBarContainer: {
    height: 5,
    backgroundColor: 'transparent',
    zIndex: 100,
  },
  progressBarTrack: {
    width: '100%',
    height: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  progressBarFill: {
    height: '100%',
  },
  root: {
    flex: 1,
    position: 'relative',
    backgroundColor: 'black',
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