/**
 * Single reusable fullscreen feed post item — same UI as For You/Following feed.
 * Use everywhere: Feed, Profile feed, Explore fullscreen, Challenge posts, etc.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  Image,
  useWindowDimensions,
  Animated,
  Alert,
  Platform,
  PanResponder,
  Modal,
} from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { router } from 'expo-router';
import { Post } from '@/types';
import { useAuth } from '@/lib/auth-context';
import { useAppSelector } from '@/lib/store/hooks';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRealtime } from '@/lib/realtime-context';
import { useRealtimePost } from '@/lib/hooks/use-realtime-post';
import { getPostMediaUrl, getThumbnailUrl, getPlaybackUrl } from '@/lib/utils/file-url';
import { getVideoSource } from '@/lib/utils/video-source';
import { Avatar } from '@/components/Avatar';
import { PostAppealModal } from '@/components/PostAppealModal';
import { timeAgo } from '@/lib/utils/time-ago';
import { useMute } from '@/lib/mute-context';
import { UnfollowConfirmModal } from '@/components/UnfollowConfirmModal';
import { getChallengePostMeta } from '@/lib/utils/challenge-post';
import { useAppActive } from '@/lib/hooks/use-app-active';
import { getChallengeVideoStatusLabel } from '@/lib/utils/challenge-post-visibility';
import { getCategoryDisplayName } from '@/lib/utils/category-display';
const DAY_IN_MS = 24 * 60 * 60 * 1000;

const formatNumber = (num: number): string => {
  if (num >= 1000000) return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return num.toString();
};

const getAdFeaturedDurationText = (post: any): string | null => {
  const rawExpiry =
    post?.expiresAt ||
    post?.expires_at ||
    post?.featured_until ||
    post?.featuredUntil ||
    null;

  if (!rawExpiry) {
    return null;
  }

  const expiryTimestamp = new Date(rawExpiry).getTime();
  if (!Number.isFinite(expiryTimestamp)) {
    return null;
  }

  const remainingMs = expiryTimestamp - Date.now();
  if (remainingMs <= 0) {
    return 'Featured ends today';
  }

  const remainingDays = Math.max(1, Math.ceil(remainingMs / DAY_IN_MS));
  return remainingDays === 1
    ? 'Featured for 1 more day'
    : `Featured for ${remainingDays} more days`;
};

const ExpandableCaption = ({ text, maxLines = 3 }: { text: string; maxLines?: number }) => {
  const [expanded, setExpanded] = useState(false);
  if (!text) return null;
  const estimatedLines = text.length / 50;
  const shouldTruncate = estimatedLines > maxLines || text.split('\n').length > maxLines;
  return (
    <View>
      <Text style={styles.caption} numberOfLines={expanded ? undefined : maxLines}>{text}</Text>
      {shouldTruncate && (
        <TouchableOpacity onPress={() => setExpanded(!expanded)} activeOpacity={0.7}>
          <Text style={styles.showMoreText}>{expanded ? 'Show less' : 'Show more'}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

type NativeFeedVideoHandle = {
  play: () => void;
  pause: () => void;
  setMuted: (muted: boolean) => void;
  seekTo: (time: number) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  getBufferedPosition: () => number;
  isPlaying: () => boolean;
};

type NativeFeedVideoProps = {
  source: any;
  contentFit: 'contain' | 'cover' | 'fill';
  isMuted: boolean;
  shouldPlay: boolean;
  onFirstFrameRender: () => void;
  onStatusChange: (event: { status?: string; error?: unknown }) => void;
  onPlayingChange: (isPlaying: boolean) => void;
  onTimeUpdate: (payload: { currentTime: number; duration: number }) => void;
  onPlayToEnd: () => void;
  onPlayerReady: () => void;
  onPlayerInvalid: () => void;
};

class VideoMountBoundary extends React.Component<
  { boundaryKey: string; onError: () => void; children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch() {
    this.props.onError();
  }

  componentDidUpdate(prevProps: Readonly<{ boundaryKey: string }>) {
    if (prevProps.boundaryKey !== this.props.boundaryKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return null;
    }
    return this.props.children;
  }
}

const NativeFeedVideo = React.forwardRef<NativeFeedVideoHandle, NativeFeedVideoProps>(
  (
    {
      source,
      contentFit,
      isMuted,
      shouldPlay,
      onFirstFrameRender,
      onStatusChange,
      onPlayingChange,
      onTimeUpdate,
      onPlayToEnd,
      onPlayerReady,
      onPlayerInvalid,
    },
    ref,
  ) => {
    const player = useVideoPlayer(source, (instance) => {
      if (!instance) {
        return;
      }

      try {
        instance.loop = true;
        instance.muted = shouldPlay ? isMuted : true;
        instance.staysActiveInBackground = false;
        instance.timeUpdateEventInterval = 0.25;
      } catch (e) {
        console.warn('[FeedVideo] Error configuring player:', e);
      }
    });

    React.useEffect(() => {
      if (player) {
        onPlayerReady();
      } else {
        onPlayerInvalid();
      }

      return () => {
        onPlayerInvalid();
      };
    }, [onPlayerInvalid, onPlayerReady, player]);

    React.useEffect(() => {
      if (!player) return;

      try {
        player.muted = shouldPlay ? isMuted : true;
        if (shouldPlay) {
          player.play();
        } else {
          player.pause();
        }
      } catch (_) {}
    }, [isMuted, player, shouldPlay]);

    React.useEffect(() => {
      if (!player) return;

      try {
        const sub = player.addListener('playingChange', (event: { isPlaying: boolean }) => {
          onPlayingChange(event.isPlaying);
        });
        return () => {
          try { sub.remove(); } catch (_) {}
        };
      } catch (_) {
        return () => {};
      }
    }, [onPlayingChange, player]);

    React.useEffect(() => {
      if (!player) return;

      try {
        const sub = player.addListener('timeUpdate', (event: { currentTime?: number; duration?: number }) => {
          onTimeUpdate({
            currentTime: event.currentTime || 0,
            duration: event.duration || 0,
          });
        });
        return () => {
          try { sub.remove(); } catch (_) {}
        };
      } catch (_) {
        return () => {};
      }
    }, [onTimeUpdate, player]);

    React.useEffect(() => {
      if (!player) return;

      try {
        const sub = player.addListener('playToEnd', onPlayToEnd);
        return () => {
          try { sub.remove(); } catch (_) {}
        };
      } catch (_) {
        return () => {};
      }
    }, [onPlayToEnd, player]);

    React.useEffect(() => {
      if (!player) return;

      try {
        const sub = player.addListener('statusChange', (event: { status?: string; error?: unknown }) => {
          onStatusChange(event);
        });
        return () => {
          try { sub.remove(); } catch (_) {}
        };
      } catch (_) {
        return () => {};
      }
    }, [onStatusChange, player]);

    React.useImperativeHandle(ref, () => ({
      play: () => {
        try { player?.play(); } catch (_) {}
      },
      pause: () => {
        try { player?.pause(); } catch (_) {}
      },
      setMuted: (muted: boolean) => {
        try {
          if (player) {
            player.muted = muted;
          }
        } catch (_) {}
      },
      seekTo: (time: number) => {
        try {
          if (player) {
            player.currentTime = time;
          }
        } catch (_) {}
      },
      getCurrentTime: () => player?.currentTime || 0,
      getDuration: () => player?.duration || 0,
      getBufferedPosition: () => player?.bufferedPosition ?? -1,
      isPlaying: () => !!player?.playing,
    }), [player]);

    if (!player) {
      return null;
    }

    return (
      <VideoView
        player={player}
        style={styles.media}
        contentFit={contentFit}
        nativeControls={false}
        useExoShutter={false}
        onFirstFrameRender={onFirstFrameRender}
        {...(Platform.OS === 'android' ? { surfaceType: 'textureView' as any } : {})}
      />
    );
  }
);

NativeFeedVideo.displayName = 'NativeFeedVideo';

export interface FullscreenFeedPostItemProps {
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
  suspendPlayback?: boolean;
  shouldPreload: boolean;
  availableHeight: number;
  /** When false, Report button is hidden (e.g. on your own profile feed). Default true. */
  showReportButton?: boolean;
  /** Challenge context: show "Best" (likes during competition) button and popup. */
  likesDuringChallenge?: number;
  isChallengeEnded?: boolean;
  challengeName?: string;
  onPublishPress?: (postId: string) => void;
  bottomOverlayOffset?: number;
}

const FullscreenFeedPostItem: React.FC<FullscreenFeedPostItemProps> = ({
  item,
  index,
  onLike,
  onComment,
  onShare,
  onReport,
  onFollow,
  onUnfollow,
  onPublishPress,
  isLiked,
  isFollowing,
  isActive,
  suspendPlayback = false,
  shouldPreload,
  availableHeight,
  showReportButton = true,
  likesDuringChallenge,
  isChallengeEnded,
  challengeName,
  bottomOverlayOffset = 0,
}) => {
  const [showBestModal, setShowBestModal] = useState(false);
  const isAppActive = useAppActive();
  const showBestButton = likesDuringChallenge !== undefined && likesDuringChallenge !== null;
  const { width: screenWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { sendLikeAction } = useRealtime();
  const likedPosts = useAppSelector((s) => s.likes.likedPosts);
  const postLikeCounts = useAppSelector((s) => s.likes.postLikeCounts);

  const isPostLiked = likedPosts.includes(item.id) || isLiked;
  const cachedLikeCount = postLikeCounts[item.id];
  const serverLikeCount = item.like_count ?? item.likes ?? 0;
  const initialLikeCount = cachedLikeCount !== undefined ? cachedLikeCount : serverLikeCount;

  const { comments } = useRealtimePost({
    postId: item.id,
    initialLikes: initialLikeCount,
    initialComments: item.comments_count || item.comment_count || 0,
    initialIsLiked: isPostLiked,
  });

  const wasActiveRef = useRef(isActive);
  const playerValidRef = useRef(false);
  const isMountedRef = useRef(true);
  const videoControllerRef = useRef<NativeFeedVideoHandle | null>(null);
  const videoMountRetryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoMountRetryCountRef = useRef(0);
  const [isPlayerValid, setIsPlayerValid] = useState(false);
  const [canMountVideoPlayer, setCanMountVideoPlayer] = useState(false);
  const [videoMountBoundaryKey, setVideoMountBoundaryKey] = useState(0);
  const [isLiking, setIsLiking] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [usingImageFallback, setUsingImageFallback] = useState(false);
  const { isMuted, toggleMute } = useMute();
  const [videoError, setVideoError] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [decoderErrorDetected, setDecoderErrorDetected] = useState(false);
  const [videoProgress, setVideoProgress] = useState(0);
  const [retryCount, setRetryCount] = useState(0);
  const [showUnfollowModal, setShowUnfollowModal] = useState(false);
  const [showAppealModal, setShowAppealModal] = useState(false);
  const isSuspendedPost = (item as any).status === 'suspended' || (item as any).is_suspended;
  const isDraftPost = (item as any).status === 'draft' || (item as any).status === 'Draft';
  const isOwnPost = Boolean(user?.id && (user.id === item.user?.id || user.id === (item as any).user_id || user.id === (item as any).userId));
  const muteOpacity = useRef(new Animated.Value(0)).current;
  const muteIconRef = useRef<'volume-2' | 'volume-x'>('volume-2');
  const [pausedByUser, setPausedByUser] = useState(false);
  const pauseIndicatorOpacity = useRef(new Animated.Value(0)).current;
  const likeScale = useRef(new Animated.Value(1)).current;
  const likeOpacity = useRef(new Animated.Value(0)).current;
  const thumbnailOpacity = useRef(new Animated.Value(1)).current;
  const playbackStatusRef = useRef<'idle' | 'loading' | 'readyToPlay' | 'error'>('idle');
  const lastPlaybackTimeRef = useRef(0);

  const mediaUrl = getPostMediaUrl(item);
  const isVideo = item.type === 'video';
  const challengeMeta = getChallengePostMeta(item);
  const activeChallengeName = challengeName || challengeMeta.challengeName;
  const isCompetitionPost = Boolean(activeChallengeName || challengeMeta.isChallengePost);
  const playbackUrl = getPlaybackUrl(item);
  const hlsReady = !!playbackUrl;
  const declaredVideoDuration =
    Number((item as any).video_duration ?? (item as any).duration ?? (item as any).durationSeconds ?? 0) || 0;
  const isLongFormVideo = declaredVideoDuration >= 60;
  const shouldLoadVideo =
    isVideo &&
    hlsReady &&
    isAppActive &&
    (isActive || (shouldPreload && !isLongFormVideo)) &&
    !videoError;
  const videoPlayerSource = shouldLoadVideo && playbackUrl ? getVideoSource(playbackUrl) : null;

  const thumbnailOrPlaceholderUrl = getThumbnailUrl(item) || (isVideo ? null : mediaUrl) || null;
  const fallbackImageUrl =
    !isVideo && thumbnailOrPlaceholderUrl && thumbnailOrPlaceholderUrl !== mediaUrl
      ? thumbnailOrPlaceholderUrl
      : null;
  const imageDisplayUrl = usingImageFallback && fallbackImageUrl ? fallbackImageUrl : (mediaUrl || thumbnailOrPlaceholderUrl);
  const competitionVideoStatusLabel =
    isCompetitionPost && isVideo && !hlsReady ? getChallengeVideoStatusLabel(item) || 'Video' : null;

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      // Aggressively stop audio on unmount to prevent leaks
      const controller = videoControllerRef.current;
      if (controller) {
        try {
          controller.setMuted(true);
          controller.pause();
        } catch (_) {}
      }
      playerValidRef.current = false;
      videoControllerRef.current = null;
      if (videoMountRetryTimeoutRef.current) {
        clearTimeout(videoMountRetryTimeoutRef.current);
      }
    };
  }, []);

  // CRITICAL: Immediately mute and pause audio when scrolling away from this post.
  // Without this, audio bleeds between posts during scroll.
  useEffect(() => {
    if (!isActive || suspendPlayback) {
      const controller = videoControllerRef.current;
      if (controller) {
        try {
          controller.setMuted(true);
          controller.pause();
        } catch (_) {}
      }
    }
  }, [isActive, suspendPlayback]);

  useEffect(() => {
    if (!videoPlayerSource) {
      playerValidRef.current = false;
      videoControllerRef.current = null;
      if (isMountedRef.current) setIsPlayerValid(false);
    }
  }, [videoPlayerSource]);

  useEffect(() => {
    setImageError(false);
    setUsingImageFallback(false);
  }, [item.id, mediaUrl, thumbnailOrPlaceholderUrl]);

  useEffect(() => {
    setVideoError(false);
    setVideoReady(false);
    setIsPlaying(false);
    setDecoderErrorDetected(false);
    setVideoProgress(0);
    setRetryCount(0);
    setPausedByUser(false);
    playbackStatusRef.current = 'idle';
    lastPlaybackTimeRef.current = 0;
    videoMountRetryCountRef.current = 0;
    setCanMountVideoPlayer(false);
    setVideoMountBoundaryKey(0);
  }, [item.id]);

  useEffect(() => {
    if (!shouldLoadVideo) {
      setCanMountVideoPlayer(false);
      playerValidRef.current = false;
      videoControllerRef.current = null;
      if (isMountedRef.current) {
        setIsPlayerValid(false);
      }
      return;
    }

    let cancelled = false;
    let frameId = 0;

    // Mount video players immediately for preloaded items (no
    // InteractionManager delay) so HLS manifests start fetching
    // right away. Only use requestAnimationFrame to batch.
    frameId = requestAnimationFrame(() => {
      if (!cancelled) {
        setCanMountVideoPlayer(true);
      }
    });

    return () => {
      cancelled = true;
      if (frameId) {
        cancelAnimationFrame(frameId);
      }
    };
  }, [item.id, shouldLoadVideo]);

  const handleNativePlayerReady = useCallback(() => {
    playerValidRef.current = true;
    if (isMountedRef.current) {
      setIsPlayerValid(true);
    }
  }, []);

  const handleNativePlayerInvalid = useCallback(() => {
    playerValidRef.current = false;
    videoControllerRef.current = null;
    if (isMountedRef.current) {
      setIsPlayerValid(false);
    }
  }, []);

  const handleNativePlayerMountError = useCallback(() => {
    handleNativePlayerInvalid();
    if (isMountedRef.current) {
      setCanMountVideoPlayer(false);
      setVideoReady(false);
      setIsPlaying(false);
    }

    if (videoMountRetryTimeoutRef.current) {
      clearTimeout(videoMountRetryTimeoutRef.current);
      videoMountRetryTimeoutRef.current = null;
    }

    if (!shouldLoadVideo || videoMountRetryCountRef.current >= 1) {
      return;
    }

    videoMountRetryCountRef.current += 1;
    videoMountRetryTimeoutRef.current = setTimeout(() => {
      if (!isMountedRef.current || !shouldLoadVideo) {
        return;
      }
      setVideoMountBoundaryKey((prev) => prev + 1);
      setCanMountVideoPlayer(true);
    }, 450);
  }, [handleNativePlayerInvalid, shouldLoadVideo]);

  const handleNativePlayingChange = useCallback((nextPlaying: boolean) => {
    if (isMountedRef.current) {
      setIsPlaying(nextPlaying);
    }
  }, []);

  const handleNativeStatusChange = useCallback((event: { status?: string; error?: unknown }) => {
    if (!isMountedRef.current) {
      return;
    }

    if (event?.status) {
      playbackStatusRef.current = event.status as 'idle' | 'loading' | 'readyToPlay' | 'error';
    }

    if (event?.error) {
      setIsPlaying(false);
      return;
    }

    if (event?.status === 'readyToPlay') {
      setVideoError(false);
      setDecoderErrorDetected(false);
    }
  }, []);

  const handleNativeTimeUpdate = useCallback((payload: { currentTime: number; duration: number }) => {
    if (!isMountedRef.current) {
      return;
    }

    const currentTime = payload.currentTime || 0;
    const duration = payload.duration || 0;
    lastPlaybackTimeRef.current = currentTime;

    if (duration > 0) {
      setVideoProgress(currentTime / duration);
    }
  }, []);

  const handleNativePlayToEnd = useCallback(() => {
    if (!isMountedRef.current) {
      return;
    }
    setVideoProgress(0);
    setVideoReady(true);
  }, []);

  useEffect(() => {
    const controller = videoControllerRef.current;
    if (!controller || !playerValidRef.current) return;
    try {
      if (isActive && !suspendPlayback && isAppActive && !decoderErrorDetected && !pausedByUser) {
        controller.setMuted(isMuted);
        controller.play();
      } else {
        controller.setMuted(true);
        controller.pause();
      }
      if (isActive && !wasActiveRef.current) {
        controller.seekTo(0);
      }
      wasActiveRef.current = isActive;
    } catch (e) {
      playerValidRef.current = false;
    }
  }, [isActive, suspendPlayback, isAppActive, isMuted, decoderErrorDetected, index, pausedByUser, isPlayerValid, canMountVideoPlayer]);

  // Poll video progress every 250ms for smooth progress bar animation.
  // Expo Video's native timeUpdate event is unreliable on many devices.
  useEffect(() => {
    if (!isActive || !isPlayerValid || pausedByUser || suspendPlayback) return;

    const interval = setInterval(() => {
      const controller = videoControllerRef.current;
      if (!controller || !playerValidRef.current) return;
      try {
        const currentTime = controller.getCurrentTime?.() ?? 0;
        const duration = controller.getDuration?.() ?? 0;
        if (duration > 0 && isMountedRef.current) {
          setVideoProgress(currentTime / duration);
        }
      } catch (_) {}
    }, 250);

    return () => clearInterval(interval);
  }, [isActive, isPlayerValid, pausedByUser, suspendPlayback]);

  // Fade out thumbnail when video is playing and ready
  useEffect(() => {
    if (isActive && isPlaying && videoReady) {
      Animated.timing(thumbnailOpacity, {
        toValue: 0,
        duration: 80,
        useNativeDriver: true,
      }).start();
    } else {
      thumbnailOpacity.setValue(1);
    }
  }, [isActive, isPlaying, videoReady, thumbnailOpacity]);

  // Retry on video error with exponential backoff
  const handleRetry = useCallback(() => {
    if (retryCount < 3) {
      const delay = Math.pow(2, retryCount) * 1000;
      setTimeout(() => {
        setVideoError(false);
        setCanMountVideoPlayer(true);
        setVideoMountBoundaryKey((prev) => prev + 1);
        setRetryCount(prev => prev + 1);
      }, delay);
    }
  }, [retryCount]);

  const handleTapToPause = useCallback((e?: any) => {
    // Only pause/play when tapping the CENTER of the screen.
    // Ignore taps in the bottom 25% (progress bar + bottom overlay area).
    if (e?.nativeEvent) {
      const tapY = e.nativeEvent.locationY;
      const threshold = availableHeight * 0.75;
      if (tapY > threshold) return; // Bottom zone — don't pause
    }
    const controller = videoControllerRef.current;
    if (!controller || !isPlayerValid) return;
    try {
      if (controller.isPlaying()) {
        controller.pause();
        setPausedByUser(true);
        pauseIndicatorOpacity.setValue(1);
      } else {
        controller.play();
        setPausedByUser(false);
        pauseIndicatorOpacity.setValue(0);
      }
    } catch (_) {}
  }, [availableHeight, isPlayerValid]);

  const handleMuteToggle = () => {
    const newMuted = toggleMute();
    if (videoControllerRef.current) {
      try { videoControllerRef.current.setMuted(newMuted); } catch (_) {}
    }
    muteIconRef.current = newMuted ? 'volume-x' : 'volume-2';
    muteOpacity.setValue(1);
    Animated.timing(muteOpacity, { toValue: 0, duration: 800, delay: 300, useNativeDriver: true }).start();
  };

  const handleLike = async () => {
    if (!user) {
      Alert.alert('Login Required', 'Please log in to like posts.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Log In', onPress: () => router.push({ pathname: '/auth/login' as any }) },
      ]);
      return;
    }
    if (isLiking) return;
    setIsLiking(true);
    const currentIsLiked = isPostLiked;
    const newIsLiked = !currentIsLiked;
    Animated.sequence([
      Animated.timing(likeScale, { toValue: 1.3, duration: 150, useNativeDriver: true }),
      Animated.timing(likeScale, { toValue: 1, duration: 150, useNativeDriver: true }),
    ]).start();
    if (newIsLiked) {
      Animated.sequence([
        Animated.timing(likeOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.timing(likeOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
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
    if (isOwnPost) {
      return;
    }
    if (isFollowing) setShowUnfollowModal(true);
    else onFollow(item.user?.id || '');
  };

  const handleUnfollowConfirm = () => {
    onUnfollow(item.user?.id || '');
    setShowUnfollowModal(false);
  };

  const handleComment = useCallback(() => {
    if (onComment && item.id) onComment(item.id);
  }, [onComment, item.id]);

  const handleProgressBarSeek = useCallback((locationX: number) => {
    const controller = videoControllerRef.current;
    if (!controller || !playerValidRef.current) return;
    const ratio = Math.max(0, Math.min(1, locationX / screenWidth));
    try {
      const dur = controller.getDuration() || 0;
      if (dur > 0) {
        controller.seekTo(ratio * dur);
        setVideoProgress(ratio);
      }
    } catch (_) {}
  }, [screenWidth]);

  const seekRef = useRef((_x: number) => {});
  seekRef.current = handleProgressBarSeek;

  // Raw touch handlers — bypass React Native gesture system entirely.
  // PanResponder couldn't reliably intercept touches from the parent Pressable.
  const handleProgressTouch = useCallback((e: any) => {
    e.stopPropagation();
    const pageX = e.nativeEvent?.pageX ?? 0;
    seekRef.current(pageX);
  }, []);

  const handleUserPress = () => {
    if (item.user?.id) {
      router.push({ pathname: '/user/[id]' as any, params: { id: item.user.id } });
    }
  };

  const handleCategoryPress = () => {
    const categoryName = typeof item.category === 'string' ? item.category : item.category?.name;
    if (categoryName) {
      router.push({ pathname: '/category/[name]' as any, params: { name: categoryName } });
    }
  };

  const displayLikeCount = cachedLikeCount !== undefined ? cachedLikeCount : (item.like_count ?? item.likes ?? 0);
  const isAd = (item as any).isAd === true;
  const adTitle = (item as any).title || (item as any).ad_title || '';
  const adFeaturedDurationText = isAd ? getAdFeaturedDurationText(item) : null;
  const mediaContentFit = isAd ? 'contain' : 'cover';
  const reservedBottomSpace = Math.max(insets.bottom + bottomOverlayOffset, 8);
  const feedProgressBottomInset = reservedBottomSpace;
  const feedOverlayBottomInset = reservedBottomSpace + 14;

  return (
    <View style={[styles.postContainer, { height: availableHeight }]} pointerEvents="box-none">
      <View style={[styles.mediaContainer, { height: availableHeight, width: screenWidth }]}>
        {isVideo ? (
          <>
            <Pressable style={[styles.mediaWrapper, isAd && styles.adMediaWrapper]} onPress={(e) => handleTapToPause(e)}>
              {thumbnailOrPlaceholderUrl ? (
                <Animated.Image
                  source={{ uri: thumbnailOrPlaceholderUrl }}
                  style={[styles.media, styles.mediaThumbnailLayer, { opacity: thumbnailOpacity }]}
                  resizeMode={mediaContentFit}
                />
              ) : null}

              {canMountVideoPlayer && shouldLoadVideo && !videoError && videoPlayerSource && (
                <View pointerEvents="none" style={{ position: 'absolute', zIndex: 2, width: '100%', height: '100%' }}>
                  <VideoMountBoundary
                    boundaryKey={`${item.id}:${videoMountBoundaryKey}`}
                    onError={handleNativePlayerMountError}
                  >
                    <NativeFeedVideo
                      ref={videoControllerRef}
                      source={videoPlayerSource}
                      contentFit={mediaContentFit}
                      isMuted={isMuted}
                      shouldPlay={isActive && !suspendPlayback && isAppActive && !decoderErrorDetected && !pausedByUser}
                      onFirstFrameRender={() => setVideoReady(true)}
                      onStatusChange={handleNativeStatusChange}
                      onPlayingChange={handleNativePlayingChange}
                      onTimeUpdate={handleNativeTimeUpdate}
                      onPlayToEnd={handleNativePlayToEnd}
                      onPlayerReady={handleNativePlayerReady}
                      onPlayerInvalid={handleNativePlayerInvalid}
                    />
                  </VideoMountBoundary>
                </View>
              )}

              {videoError && (
                <View style={styles.errorOverlay}>
                  <Feather name="alert-circle" size={32} color="#fff" />
                  <Text style={styles.errorText}>Video unavailable</Text>
                  {retryCount < 3 && (
                    <TouchableOpacity style={styles.retryBtn} onPress={handleRetry}>
                      <Feather name="refresh-cw" size={16} color="#fff" />
                      <Text style={styles.retryBtnText}>Retry</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}

              {!videoError && competitionVideoStatusLabel && !thumbnailOrPlaceholderUrl && !shouldLoadVideo && (
                <View style={styles.unavailableCompetitionOverlay}>
                  <Feather name="video-off" size={34} color="#fff" />
                  <Text style={styles.unavailableCompetitionTitle}>
                    {competitionVideoStatusLabel}
                  </Text>
                  <Text style={styles.unavailableCompetitionText}>
                    Competition submission saved. Playback is not ready yet.
                  </Text>
                </View>
              )}

              <Animated.View style={[styles.muteIndicatorOverlay, { opacity: pauseIndicatorOpacity }]} pointerEvents="none">
                <View style={styles.muteIndicatorBadge}>
                  <Feather name="play" size={48} color="rgba(255,255,255,0.95)" />
                </View>
              </Animated.View>

              <TouchableOpacity
                style={[styles.muteButtonCorner, { top: insets.top + 12 }]}
                onPress={handleMuteToggle}
                activeOpacity={0.8}
              >
                <Feather name={isMuted ? 'volume-x' : 'volume-2'} size={22} color="rgba(255,255,255,0.9)" />
              </TouchableOpacity>
            </Pressable>
          </>
        ) : (
          <View style={[styles.mediaWrapper, isAd && styles.adMediaWrapper]}>
            {imageDisplayUrl && !imageError ? (
              <Image
                source={{ uri: imageDisplayUrl }}
                style={styles.media}
                resizeMode={mediaContentFit}
                onError={() => {
                  if (!usingImageFallback && fallbackImageUrl) {
                    setUsingImageFallback(true);
                    return;
                  }
                  setImageError(true);
                }}
              />
            ) : null}
          </View>
        )}

        <View style={[styles.rightActions, { bottom: feedOverlayBottomInset }]}>
          {!isAd && (
            <TouchableOpacity style={styles.avatarContainer} onPress={handleUserPress}>
              <Avatar
                user={item.user ? { ...item.user, profile_picture: item.user.profile_picture ?? undefined } : undefined}
                size={48}
                style={styles.userAvatar}
              />
              {user && !isOwnPost && (
                <TouchableOpacity style={styles.followIconButton} onPress={handleFollow}>
                  <Feather name={isFollowing ? 'check' : 'plus'} size={16} color="#000" />
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          )}

          {!isAd && showBestButton && (
            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => setShowBestModal(true)}
            >
              <Feather name="award" size={22} color="#fbbf24" />
              <Text style={styles.actionCount}>{formatNumber(likesDuringChallenge ?? 0)}</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.actionButton} onPress={handleLike}>
            <Animated.View style={{ transform: [{ scale: likeScale }] }}>
              <Feather name="heart" size={24} color={isPostLiked ? '#ff2d55' : '#fff'} fill={isPostLiked ? '#ff2d55' : 'none'} />
            </Animated.View>
            <Text style={styles.actionCount}>{formatNumber(displayLikeCount)}</Text>
          </TouchableOpacity>

          <Animated.View style={[styles.likeAnimationOverlay, { opacity: likeOpacity }]}>
            <Feather name="heart" size={48} color="#ff2d55" fill="#ff2d55" />
          </Animated.View>

          <TouchableOpacity
            style={styles.actionButton}
            onPress={handleComment}
            activeOpacity={0.7}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Feather name="message-circle" size={24} color="#fff" />
            <Text style={styles.actionCount}>{formatNumber(comments)}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionButton} onPress={() => onShare(item.id)}>
            <Feather name="share-2" size={24} color="#fff" />
          </TouchableOpacity>

          {!isAd && showReportButton && (
            <TouchableOpacity style={styles.actionButton} onPress={() => onReport(item.id)}>
              <Feather name="flag" size={22} color="#fff" />
              <Text style={styles.actionReportLabel}>Report</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={[styles.bottomInfo, { bottom: feedOverlayBottomInset }]}>
          <View style={styles.bottomInfoContent}>
            {isAd && (
              <View style={styles.sponsoredMetaRow}>
                <View style={styles.sponsoredPill}>
                  <Text style={styles.sponsoredPillText}>Sponsored</Text>
                </View>
                {adFeaturedDurationText ? (
                  <View style={styles.sponsoredDurationPill}>
                    <Text style={styles.sponsoredDurationText}>{adFeaturedDurationText}</Text>
                  </View>
                ) : null}
              </View>
            )}
            {!isAd && (
              <TouchableOpacity onPress={handleUserPress}>
                <Text style={styles.username}>@{item.user?.username || 'unknown'}</Text>
              </TouchableOpacity>
            )}
            {isAd && !!adTitle && (
              <Text style={styles.adTitle}>{adTitle}</Text>
            )}
            {isCompetitionPost && (
              <View style={styles.challengeTag}>
                <Feather name="award" size={12} color="#fbbf24" />
                <Text style={styles.challengeTagText}>
                  Competition{activeChallengeName ? `: ${activeChallengeName}` : ''}
                </Text>
              </View>
            )}
            {(item.caption || item.description || item.title) && (
              <ExpandableCaption text={item.caption || item.description || item.title || ''} maxLines={2} />
            )}
            {!isAd && (item.createdAt || item.uploadDate || (item as any).created_at) && (
              <Text style={styles.timestamp}>{timeAgo(item.createdAt || item.uploadDate || (item as any).created_at)}</Text>
            )}
          </View>
          {!isAd && item.category && (
            <TouchableOpacity style={styles.categoryBadge} onPress={handleCategoryPress}>
              <Text style={styles.categoryText}>#{getCategoryDisplayName(typeof item.category === 'string' ? item.category : (item.category as { name?: string })?.name)}</Text>
            </TouchableOpacity>
          )}
          {!isAd && user && !isOwnPost && (
            <TouchableOpacity
              style={[styles.followButton, { backgroundColor: isFollowing ? 'rgba(255,255,255,0.2)' : '#60a5fa' }]}
              onPress={handleFollow}
            >
              <Text style={[styles.followButtonText, { color: isFollowing ? '#fff' : '#000' }]}>
                {isFollowing ? 'Following' : 'Follow'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {isVideo && isActive && (
          <View
            style={[styles.videoProgressBarContainer, { bottom: feedProgressBottomInset }]}
            onStartShouldSetResponder={() => true}
            onMoveShouldSetResponder={() => true}
            onResponderGrant={handleProgressTouch}
            onResponderMove={handleProgressTouch}
            onTouchStart={handleProgressTouch}
            onTouchMove={handleProgressTouch}
          >
            <View style={styles.videoProgressBarTrack}>
              <View style={[styles.videoProgressBarFill, { width: `${Math.min(videoProgress * 100, 100)}%` }]} />
            </View>
          </View>
        )}
      </View>
      <UnfollowConfirmModal
        visible={showUnfollowModal}
        username={item.user?.username || 'user'}
        onConfirm={handleUnfollowConfirm}
        onCancel={() => setShowUnfollowModal(false)}
      />

      <Modal visible={showBestModal} transparent animationType="fade">
        <Pressable style={styles.bestModalOverlay} onPress={() => setShowBestModal(false)}>
          <View style={styles.bestModalContent}>
            <View style={styles.bestModalIconWrap}>
              <Feather name="award" size={32} color="#fbbf24" />
            </View>
            <Text style={styles.bestModalTitle}>Likes during competition</Text>
            <Text style={styles.bestModalMessage}>
              This is the number of likes this post received during the competition before it ended: {formatNumber(likesDuringChallenge ?? 0)}.
            </Text>
            {isChallengeEnded && (
              <Text style={styles.bestModalEnded}>The competition has ended; this count no longer changes.</Text>
            )}
            <TouchableOpacity style={styles.bestModalButton} onPress={() => setShowBestModal(false)}>
              <Text style={styles.bestModalButtonText}>OK</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

      {/* Draft Post Overlay — own posts only */}
      {isDraftPost && isOwnPost && (
        <View style={styles.draftOverlayContainer}>
          <View style={styles.draftBanner}>
            <MaterialIcons name="edit-document" size={16} color="#10b981" />
            <Text style={styles.draftText}>Draft Post</Text>
          </View>
          <TouchableOpacity
            style={styles.publishDraftButton}
            onPress={(e) => {
              e.stopPropagation();
              if (onPublishPress) {
                onPublishPress(item.id);
              }
            }}
            activeOpacity={0.8}
          >
            <Feather name="upload-cloud" size={18} color="#fff" />
            <Text style={styles.publishDraftButtonText}>Publish</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Suspended Post Overlay — own posts only */}
      {isSuspendedPost && isOwnPost && (
        <View style={styles.suspendedOverlay} pointerEvents="box-none">
          <View style={styles.suspendedBanner}>
            <MaterialIcons name="block" size={16} color="#ef4444" />
            <Text style={styles.suspendedText}>Suspended</Text>
            <TouchableOpacity
              style={styles.appealButton}
              onPress={() => setShowAppealModal(true)}
              activeOpacity={0.8}
            >
              <MaterialIcons name="gavel" size={14} color="#fff" />
              <Text style={styles.appealButtonText}>Appeal</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <PostAppealModal
        visible={showAppealModal}
        postId={item.id}
        onClose={() => setShowAppealModal(false)}
        onAppealed={() => setShowAppealModal(false)}
      />
    </View>
  );
};

function arePropsEqual(prev: FullscreenFeedPostItemProps, next: FullscreenFeedPostItemProps) {
  return (
    prev.item.id === next.item.id &&
    // CRITICAL: Detect when enrichment adds HLS playback data to the same item
    (prev.item as any).hls_url === (next.item as any).hls_url &&
    (prev.item as any).hlsUrl === (next.item as any).hlsUrl &&
    (prev.item as any).fullUrl === (next.item as any).fullUrl &&
    prev.isActive === next.isActive &&
    prev.shouldPreload === next.shouldPreload &&
    prev.isLiked === next.isLiked &&
    prev.isFollowing === next.isFollowing &&
    (prev.suspendPlayback ?? false) === (next.suspendPlayback ?? false) &&
    prev.availableHeight === next.availableHeight &&
    (prev.showReportButton ?? true) === (next.showReportButton ?? true) &&
    (prev.likesDuringChallenge ?? -1) === (next.likesDuringChallenge ?? -1) &&
    prev.isChallengeEnded === next.isChallengeEnded
  );
}

export default React.memo(FullscreenFeedPostItem, arePropsEqual);

const styles = StyleSheet.create({
  postContainer: {
    width: '100%',
    backgroundColor: 'transparent',
    overflow: 'hidden',
  },
  adBadge: {
    position: 'absolute',
    top: 52,
    left: 16,
    zIndex: 100,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  adBadgeText: {
    color: '#9ca3af',
    fontSize: 11,
    fontWeight: '600',
  },
  adLearnMoreButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(96,165,250,0.9)',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    marginBottom: 12,
  },
  adLearnMoreText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  mediaContainer: {
    flex: 1,
  },
  mediaWrapper: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
    overflow: 'visible',
  },
  adMediaWrapper: {
    backgroundColor: '#000',
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  media: {
    width: '100%',
    height: '100%',
  },
  mediaThumbnailLayer: {
    position: 'absolute',
    zIndex: 1,
    width: '100%',
    height: '100%',
  },
  errorOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    zIndex: 5,
  },
  errorText: {
    color: '#fff',
    fontSize: 14,
    marginTop: 8,
    marginBottom: 12,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  retryBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  unavailableCompetitionOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
    backgroundColor: 'rgba(0,0,0,0.68)',
    zIndex: 4,
  },
  unavailableCompetitionTitle: {
    marginTop: 12,
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  unavailableCompetitionText: {
    marginTop: 8,
    color: 'rgba(255,255,255,0.82)',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
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
  rightActions: {
    position: 'absolute',
    right: 12,
    alignItems: 'center',
    zIndex: 999,
    elevation: 10,
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
    bottom: 0,
    right: 0,
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
    zIndex: 1000,
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
  actionReportLabel: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '600',
    marginTop: 3,
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  bestModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  bestModalContent: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#333',
    padding: 24,
    alignItems: 'center',
  },
  bestModalIconWrap: {
    marginBottom: 12,
  },
  bestModalTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 10,
    textAlign: 'center',
  },
  bestModalMessage: {
    color: '#d1d5db',
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 8,
    lineHeight: 22,
  },
  bestModalEnded: {
    color: '#9ca3af',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 20,
  },
  bestModalButton: {
    backgroundColor: '#60a5fa',
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 10,
  },
  bestModalButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
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
    left: 12,
    right: 84,
    zIndex: 21,
    elevation: 5,
  },
  bottomInfoContent: {
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    borderRadius: 8,
    padding: 10,
    marginBottom: 0,
  },
  sponsoredMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 6,
  },
  sponsoredPill: {
    backgroundColor: 'rgba(96, 165, 250, 0.92)',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  sponsoredPillText: {
    color: '#031525',
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  sponsoredDurationPill: {
    backgroundColor: 'rgba(15, 23, 42, 0.78)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: 'rgba(96, 165, 250, 0.35)',
  },
  sponsoredDurationText: {
    color: '#dbeafe',
    fontSize: 11,
    fontWeight: '700',
  },
  sponsoredByText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 11,
    fontWeight: '600',
    flex: 1,
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
  adTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
    lineHeight: 22,
    marginBottom: 6,
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
  },
  challengeTag: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(15, 23, 42, 0.72)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: 'rgba(251, 191, 36, 0.3)',
  },
  challengeTagText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
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
  sponsoredCtaInline: {
    marginTop: 10,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(15, 23, 42, 0.78)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(96, 165, 250, 0.45)',
  },
  sponsoredCtaInlineText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
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
  videoProgressBarContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 60, // Very large touch target — finger-friendly
    justifyContent: 'flex-end',
    paddingBottom: 0,
    zIndex: 200, // Above everything including the Pressable
  },
  videoProgressBarTrack: {
    height: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    borderRadius: 2,
  },
  videoProgressBarFill: {
    height: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.85)',
    borderRadius: 2,
  },
  draftOverlayContainer: {
    position: 'absolute',
    top: '40%',
    left: 20,
    right: 20,
    alignItems: 'center',
    gap: 16,
    zIndex: 25,
  },
  draftBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 6,
  },
  draftText: {
    color: '#10b981',
    fontWeight: '700',
    fontSize: 14,
  },
  publishDraftButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.9)',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    gap: 8,
  },
  publishDraftButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
  suspendedOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'flex-start',
    alignItems: 'center',
    paddingTop: 80,
    zIndex: 200,
  },
  suspendedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(20, 20, 20, 0.92)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  suspendedText: {
    color: '#ef4444',
    fontSize: 14,
    fontWeight: '700',
  },
  appealButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#f59e0b',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    marginLeft: 4,
  },
  appealButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
});
