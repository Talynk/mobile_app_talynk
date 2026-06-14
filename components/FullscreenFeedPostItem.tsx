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
import { VideoView, useVideoPlayer, type VideoPlayer, type VideoSource } from 'expo-video';
import { router } from 'expo-router';
import { Post } from '@/types';
import { useAuth } from '@/lib/auth-context';
import { useAppSelector } from '@/lib/store/hooks';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRealtimePost } from '@/lib/hooks/use-realtime-post';
import { getPostMediaUrl, getThumbnailUrl, getPlaybackUrl } from '@/lib/utils/file-url';
import { getVideoSource } from '@/lib/utils/video-source';
import { IS_OLDER_ANDROID } from '@/lib/utils/video-feed';
import { Avatar } from '@/components/Avatar';
import { PostAppealModal } from '@/components/PostAppealModal';
import { timeAgo } from '@/lib/utils/time-ago';
import { useMute } from '@/lib/mute-context';
import { UnfollowConfirmModal } from '@/components/UnfollowConfirmModal';
import { getChallengePostMeta } from '@/lib/utils/challenge-post';
import { useAppActive } from '@/lib/hooks/use-app-active';
import { getChallengeVideoStatusLabel } from '@/lib/utils/challenge-post-visibility';
import { getCategoryDisplayName } from '@/lib/utils/category-display';
import { registerVideoPauser } from '@/lib/hooks/use-video-pause-on-blur';
import { addFabricBreadcrumb, captureFabricError } from '@/lib/utils/fabric-diagnostics';
import { enterPlaybackMode } from '@/lib/media/audio-session';
import { feedTelemetry } from '@/lib/feed-telemetry';
const DAY_IN_MS = 24 * 60 * 60 * 1000;
let mountedFeedPlayerCount = 0;
const FEED_ANIMATION_USES_NATIVE_DRIVER = false;
const VIDEO_VISUAL_READY_SECONDS = 0.08;
const VIDEO_FIRST_FRAME_WATCHDOG_DELAYS_MS = [1800, 3500, 5500];

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

const extractFirstHashtagLabel = (...values: unknown[]): string | null => {
  for (const value of values) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      continue;
    }

    const match = value.match(/#([\p{L}\p{N}_-]+)/u);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return null;
};

const getPostSubcategoryName = (post: any): string | null => {
  const directCategoryObject =
    post?.category && typeof post.category === 'object'
      ? post.category
      : null;
  const derivedSubcategoryFromCategory =
    Number(directCategoryObject?.level) === 2
      ? directCategoryObject?.name
      : null;
  const rawSubcategory =
    post?.subcategory_name ||
    post?.sub_category_name ||
    post?.subcategoryName ||
    post?.subcategory?.name ||
    post?.sub_category?.name ||
    post?.subCategory?.name ||
    derivedSubcategoryFromCategory ||
    extractFirstHashtagLabel(post?.caption, post?.description, post?.title) ||
    null;

  if (typeof rawSubcategory !== 'string') {
    return null;
  }

  const normalized = rawSubcategory.trim();
  return normalized.length > 0 ? normalized : null;
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
  player: VideoPlayer | null;
  contentFit: 'contain' | 'cover' | 'fill';
  isMuted: boolean;
  shouldPlay: boolean;
  /**
   * When false on Android, the player stays alive and keeps filling its buffer
   * but is NOT attached to a VideoView (no surface). Per expo-video docs a player
   * buffers without a view, and with no surface ExoPlayer does not hold a video
   * decoder — so preloading the next clip never steals the active clip's decoder.
   */
  attachVideoView: boolean;
  postId: string;
  screenName: string;
  sourceMode: 'direct' | 'android_cache';
  onFirstFrameRender: () => void;
  onStatusChange: (event: { status?: string; error?: unknown }) => void;
  onPlayingChange: (isPlaying: boolean) => void;
  onTimeUpdate: (payload: { currentTime: number; duration: number }) => void;
  onPlayToEnd: () => void;
  onPlayerReady: () => void;
  onPlayerInvalid: () => void;
};

type HookFeedVideoProps = Omit<NativeFeedVideoProps, 'player'> & {
  source: VideoSource;
  playerInstanceKey: string;
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
      player,
      contentFit,
      isMuted,
      shouldPlay: _shouldPlay,
      attachVideoView,
      postId,
      screenName,
      sourceMode,
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
    React.useEffect(() => {
      if (!player) {
        onPlayerInvalid();
        return () => {};
      }

      onPlayerReady();
      mountedFeedPlayerCount += 1;
      feedTelemetry.trackActiveFeedPlayers({
        count: mountedFeedPlayerCount,
        postId,
        screenName,
      });
      if (__DEV__ && Platform.OS !== 'ios' && mountedFeedPlayerCount > 1) {
        console.warn('[FeedVideo] More than one fullscreen player mounted', {
          mountedFeedPlayerCount,
          postId,
          screenName,
        });
      }

      const unregister = registerVideoPauser(() => {
        try {
          player.muted = true;
          player.pause();
          if ((player as any).volume !== undefined) {
            (player as any).volume = 0;
          }
        } catch (_) {}
      });

      return () => {
        unregister?.();
        mountedFeedPlayerCount = Math.max(0, mountedFeedPlayerCount - 1);
        feedTelemetry.trackActiveFeedPlayers({
          count: mountedFeedPlayerCount,
          postId,
          screenName,
        });
        try {
          player.muted = true;
          player.pause();
          if ((player as any).volume !== undefined) {
            (player as any).volume = 0;
          }
        } catch (_) {}
        onPlayerInvalid();
      };
    }, [onPlayerInvalid, onPlayerReady, player, postId, screenName]);

    React.useEffect(() => {
      if (!player) {
        return;
      }

      try {
        player.loop = true;
        player.muted = true;
        player.staysActiveInBackground = false;
        player.timeUpdateEventInterval = 0.25;
        try {
          (player as any).audioMixingMode = 'doNotMix';
        } catch (_) {}
      } catch (_) {}
    }, [player]);

    React.useEffect(() => {
      if (!player) {
        return;
      }

      try {
        player.muted = isMuted;
        if ((player as any).volume !== undefined) {
          (player as any).volume = isMuted ? 0 : 1;
        }
      } catch (_) {}
    }, [isMuted, player]);

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
            // CRITICAL: Also sync volume — multiple code paths set volume=0
            // during suspend/pause. Without restoring volume here, the player
            // stays silent even when muted=false.
            if ((player as any).volume !== undefined) {
              (player as any).volume = muted ? 0 : 1;
            }
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

    // Android: only the active clip attaches a surface (one hardware decoder).
    // Preloading neighbours keep the player alive and buffering with no view, so
    // they never contend for the decoder/CPU. iOS handles multiple players fine.
    const shouldAttachView = Platform.OS === 'ios' ? true : attachVideoView;
    if (!shouldAttachView) {
      return null;
    }

    return (
      <VideoView
        player={player}
        style={styles.media}
        contentFit={contentFit}
        nativeControls={false}
        useExoShutter={Platform.OS === 'android'}
        onFirstFrameRender={onFirstFrameRender}
      />
    );
  }
);

NativeFeedVideo.displayName = 'NativeFeedVideo';

const HookFeedVideo = React.forwardRef<NativeFeedVideoHandle, HookFeedVideoProps>(
  ({ source, playerInstanceKey, ...props }, ref) => {
    const player = useVideoPlayer(source, (createdPlayer) => {
      try {
        createdPlayer.loop = true;
        createdPlayer.muted = true;
        createdPlayer.staysActiveInBackground = false;
        createdPlayer.timeUpdateEventInterval = 0.25;
        try {
          (createdPlayer as any).audioMixingMode = 'doNotMix';
        } catch (_) {}
        try {
          if (Platform.OS === 'ios') {
            createdPlayer.bufferOptions = {
              // Buffer 60 seconds ahead — covers the full duration of most short clips.
              preferredForwardBufferDuration: 60,
              // Let AVPlayer choose the right moment to start/resume; prevents micro-stalls.
              waitsToMinimizeStalling: true,
            } as any;
          } else {
            // Android expo-video BufferOptions. IMPORTANT: only these keys are
            // honored — raw ExoPlayer DefaultLoadControl names like minBufferMs /
            // maxBufferMs / bufferForPlaybackMs are silently IGNORED by expo-video.
            //
            // preferredForwardBufferDuration (seconds):
            //   How far ahead the player buffers. Because the NEXT post is
            //   preloaded (buffered while paused), a generous value fills the
            //   buffer BEFORE the video becomes active — so playback starts
            //   instantly and never runs dry mid-clip. 30 s covers most short
            //   clips end-to-end on a low-end device.
            //
            // minBufferForPlayback (seconds):
            //   Buffer required before (re)starting playback. Keeps the first
            //   decoded frames keyframe-aligned so there is no frame breaking at
            //   the start. It does NOT delay preloaded videos because their
            //   buffer is already well past this threshold by activation time.
            //
            // prioritizeTimeOverSizeThreshold:
            //   Prioritize buffering watchable duration over byte size so the
            //   player reaches a playable state as fast as possible.
            // Mara Z has ~23 MB free RAM. Two players each buffering 60 s with no
            // byte cap blew the native heap to 275 MB → GC thrash → decoder
            // starvation → the worsening stalls and 20-55 s stuck videos.
            //
            // So we cap buffer MEMORY hard instead of time:
            //  - prioritizeTimeOverSizeThreshold:false → ExoPlayer respects the
            //    byte cap (otherwise it ignores it and grows unbounded).
            //  - maxBufferBytes → the real ceiling. ~8 MB ≈ 30-60 s of a 360p clip,
            //    plenty of look-ahead so good wifi never drains it mid-play, while
            //    active + preload players together stay well within device memory.
            //  - preferredForwardBufferDuration is the time ceiling; whichever
            //    (time or bytes) is hit first stops loading until playback drains it.
            createdPlayer.bufferOptions = (IS_OLDER_ANDROID
              ? {
                  preferredForwardBufferDuration: 25,
                  minBufferForPlayback: 1.5,
                  prioritizeTimeOverSizeThreshold: false,
                  maxBufferBytes: 8 * 1024 * 1024,
                }
              : {
                  preferredForwardBufferDuration: 40,
                  minBufferForPlayback: 1.5,
                  prioritizeTimeOverSizeThreshold: false,
                  maxBufferBytes: 24 * 1024 * 1024,
                }) as any;
          }
        } catch (_) {}
        createdPlayer.pause();
      } catch (_) {}
    });

    void playerInstanceKey;

    return <NativeFeedVideo ref={ref} player={player} {...props} />;
  },
);

HookFeedVideo.displayName = 'HookFeedVideo';

type FeedVideoProps = NativeFeedVideoProps & {
  source: VideoSource;
  playerInstanceKey: string;
};

const FeedVideo = React.forwardRef<NativeFeedVideoHandle, FeedVideoProps>(
  ({ source, playerInstanceKey, player: _unusedPoolPlayer, ...props }, ref) => {
    // Always use hook-based player on both iOS and Android.
    // key={playerInstanceKey} causes React to unmount+remount HookFeedVideo
    // on every new activation, giving us a guaranteed fresh player at position 0.
    // This is the only reliable way to ensure every video starts from 0:00.
    return (
      <HookFeedVideo
        key={playerInstanceKey}
        ref={ref}
        source={source}
        playerInstanceKey={playerInstanceKey}
        {...props}
      />
    );
  },
);

FeedVideo.displayName = 'FeedVideo';

export interface FullscreenFeedPostItemProps {
  item: Post;
  index: number;
  onLike: (postId: string) => void | Promise<void>;
  onComment: (postId: string) => void;
  onShare: (postId: string) => void;
  onReport: (postId: string) => void;
  onFollow: (userId: string) => void;
  onUnfollow: (userId: string) => void;
  isLiked: boolean;
  isFollowing: boolean;
  isFollowStateReady?: boolean;
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
  bottomFooterHeight?: number;
  showBottomFooter?: boolean;
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
  isFollowStateReady = true,
  isActive,
  suspendPlayback = false,
  shouldPreload,
  availableHeight,
  showReportButton = true,
  likesDuringChallenge,
  isChallengeEnded,
  challengeName,
  bottomOverlayOffset = 0,
  bottomFooterHeight = 0,
  showBottomFooter = false,
}) => {
  const [showBestModal, setShowBestModal] = useState(false);
  const isAppActive = useAppActive();
  const showBestButton = likesDuringChallenge !== undefined && likesDuringChallenge !== null;
  const { width: screenWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
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

  const wasActiveRef = useRef(false);
  const wasAppActiveRef = useRef(isAppActive);
  const hasActivatedOnceRef = useRef(false);
  const playerValidRef = useRef(false);
  const isMountedRef = useRef(true);
  const videoControllerRef = useRef<NativeFeedVideoHandle | null>(null);
  const [playbackGeneration, setPlaybackGeneration] = useState(0);
  const lastStartedPlaybackGenerationRef = useRef(-1);
  const pendingPlayRef = useRef(false);
  const videoMountRetryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoplayRetryTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
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
  const [firstFrameRendered, setFirstFrameRendered] = useState(false);
  const [videoVisualReady, setVideoVisualReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [decoderErrorDetected, setDecoderErrorDetected] = useState(false);
  const [preferDirectVideoSource, setPreferDirectVideoSource] = useState(false);
  const [videoProgress, setVideoProgress] = useState(0);
  const [retryCount, setRetryCount] = useState(0);
  const [showUnfollowModal, setShowUnfollowModal] = useState(false);
  const [showFollowLoginModal, setShowFollowLoginModal] = useState(false);
  const [showAppealModal, setShowAppealModal] = useState(false);
  const isSuspendedPost = (item as any).status === 'suspended' || (item as any).is_suspended;
  const isDraftPost = (item as any).status === 'draft' || (item as any).status === 'Draft';
  const isOwnPost = Boolean(user?.id && (user.id === item.user?.id || user.id === (item as any).user_id || user.id === (item as any).userId));
  const muteOpacity = useRef(new Animated.Value(0)).current;
  const muteIconRef = useRef<'volume-2' | 'volume-x'>('volume-2');
  const [pausedByUser, setPausedByUser] = useState(false);
  const [iosVisualRecoveryKey, setIosVisualRecoveryKey] = useState(0);
  const pauseIndicatorOpacity = useRef(new Animated.Value(0)).current;
  const likeScale = useRef(new Animated.Value(1)).current;
  const likeOpacity = useRef(new Animated.Value(0)).current;
  const thumbnailOpacity = useRef(new Animated.Value(1)).current;
  const playbackStatusRef = useRef<'idle' | 'loading' | 'readyToPlay' | 'error'>('idle');
  const lastPlaybackTimeRef = useRef(0);
  const lastSyncedProgressTimeRef = useRef(0);
  const lastDurationRef = useRef(0);
  const firstPlaybackRequestedAtRef = useRef<number | null>(null);
  const firstPlaybackMotionRequestedAtRef = useRef<number | null>(null);
  const firstPlaybackMotionReportedRef = useRef(false);
  const stallCountRef = useRef(0);
  const playbackStallCountRef = useRef(0);
  const playbackStallProbeRef = useRef({ time: 0, checkedAt: 0 });
  const visualRecoveryAttemptedRef = useRef(false);
  // Animated value that drives the progress bar fill + thumb visually.
  // During drag we update this directly (no setState → no re-render lag).
  // When not dragging it mirrors the videoProgress state.
  const scrubProgress = useRef(new Animated.Value(0)).current;
  const isDraggingRef = useRef(false);
  const dragSeekRatioRef = useRef(0);
  const progressBarWidthRef = useRef(screenWidth);
  const screenWidthRef = useRef(screenWidth);
  screenWidthRef.current = screenWidth;

  const clearAutoplayRetryTimeouts = useCallback(() => {
    autoplayRetryTimeoutsRef.current.forEach((timeoutId) => clearTimeout(timeoutId));
    autoplayRetryTimeoutsRef.current = [];
  }, []);

  // Resume playback after any modal/popup dismisses.
  // Native players can auto-pause when a Modal/Alert overlays them, but React
  // state doesn't change so no effect re-runs to call play() again.
  const resumePlayback = useCallback(() => {
    if (!isActive || suspendPlayback || !isAppActive || decoderErrorDetected || pausedByUser) return;
    const controller = videoControllerRef.current;
    if (!controller || !playerValidRef.current) return;
    // Small delay lets modal animation finish and the native player settle.
    setTimeout(() => {
      if (!isMountedRef.current) return;
      const ctrl = videoControllerRef.current;
      if (!ctrl || !playerValidRef.current) return;
      try {
        ctrl.setMuted(isMuted);
        ctrl.play();
      } catch (_) {}
    }, 150);
  }, [decoderErrorDetected, isActive, isAppActive, isMuted, pausedByUser, suspendPlayback]);

  // Watch all internal modal states — resume playback when they ALL close.
  const anyInternalModalOpen =
    showUnfollowModal || showFollowLoginModal || showBestModal || showAppealModal;
  const prevModalOpenRef = useRef(false);
  useEffect(() => {
    if (anyInternalModalOpen) {
      prevModalOpenRef.current = true;
    } else if (prevModalOpenRef.current) {
      // A modal just closed
      prevModalOpenRef.current = false;
      resumePlayback();
    }
  }, [anyInternalModalOpen, resumePlayback]);

  const mediaUrl = getPostMediaUrl(item);
  const isVideo = item.type === 'video';
  const metadataDuration = Number(
    (item as any).video_duration ??
    (item as any).videoDuration ??
    (item as any).duration ??
    (item as any).metadata?.duration ??
    0
  );
  const fallbackVideoDuration = Number.isFinite(metadataDuration) && metadataDuration > 0
    ? metadataDuration
    : 0;

  const resolvePlaybackTimes = useCallback(() => {
    const controller = videoControllerRef.current;
    let currentTime = controller?.getCurrentTime?.() ?? 0;
    let duration = controller?.getDuration?.() ?? 0;

    if (duration <= 0 && lastDurationRef.current > 0) {
      duration = lastDurationRef.current;
    }
    if (duration <= 0 && fallbackVideoDuration > 0) {
      duration = fallbackVideoDuration;
    }

    return { currentTime, duration };
  }, [fallbackVideoDuration]);

  const syncProgressFromPlayer = useCallback((currentTime?: number, duration?: number) => {
    if (isDraggingRef.current || !isMountedRef.current) {
      return;
    }

    const resolved = resolvePlaybackTimes();
    let time = currentTime ?? resolved.currentTime;
    let dur = duration ?? resolved.duration;
    if (dur <= 0 && fallbackVideoDuration > 0) {
      dur = fallbackVideoDuration;
    }
    if (dur <= 0) {
      return;
    }

    // ExoPlayer HLS reports jittery currentTime on Android — ignore backward jumps
    // so the progress bar never "dances". Allow loop-to-start resets only.
    const last = lastSyncedProgressTimeRef.current;
    if (time < last - 0.25) {
      if (time <= 0.5) {
        lastSyncedProgressTimeRef.current = 0;
      } else {
        return;
      }
    } else if (time < last && time > 0.05) {
      time = last;
    } else {
      lastSyncedProgressTimeRef.current = time;
    }

    lastPlaybackTimeRef.current = time;
    lastDurationRef.current = dur;
    const ratio = Math.max(0, Math.min(1, time / dur));
    scrubProgress.setValue(ratio);
    setVideoProgress((prev) => (Math.abs(prev - ratio) < 0.001 ? prev : ratio));
  }, [fallbackVideoDuration, resolvePlaybackTimes, scrubProgress]);

  const challengeMeta = getChallengePostMeta(item);
  const activeChallengeName = challengeName || challengeMeta.challengeName;
  const isCompetitionPost = Boolean(activeChallengeName || challengeMeta.isChallengePost);
  const playbackUrl = getPlaybackUrl(item);
  const hlsReady = !!playbackUrl;
  // Mount the player when this post is active OR scheduled for preload. On API <= 28
  // shouldPreloadFeedVideo limits preload to the single next post, so at most two
  // decoders (active + next) stay alive. The preloaded player buffers while paused,
  // giving an instant, stall-free start when the user scrolls onto it.
  const shouldLoadVideo =
    isVideo &&
    hlsReady &&
    isAppActive &&
    (isActive || shouldPreload) &&
    !videoError;
  const shouldMountVideoPlayer = shouldLoadVideo;
  const shouldMuteVideo = isMuted;
  const directVideoPlayerSource = React.useMemo(
    () => playbackUrl
      ? {
          uri: playbackUrl,
          useCaching: false,
          ...(playbackUrl.toLowerCase().includes('.m3u8') ? { contentType: 'hls' as const } : {}),
        }
      : null,
    [playbackUrl],
  );
  const resolvedVideoSource = React.useMemo(
    () => playbackUrl
      ? (Platform.OS === 'ios' && directVideoPlayerSource
          ? directVideoPlayerSource
          : getVideoSource(playbackUrl))
      : null,
    [directVideoPlayerSource, playbackUrl],
  );
  const videoSourceMode = Platform.OS === 'android' ? 'android_cache' : 'direct';
  const screenName = 'fullscreen-feed-post';
  const startActivePlayback = useCallback(() => {
    if (
      !isVideo ||
      !isActive ||
      !isMountedRef.current ||
      suspendPlayback ||
      !isAppActive ||
      decoderErrorDetected ||
      pausedByUser
    ) {
      return false;
    }

    // Reset progress — thumbnail stays until native first frame fires.
    scrubProgress.setValue(0);
    setVideoProgress(0);
    lastPlaybackTimeRef.current = 0;
    lastSyncedProgressTimeRef.current = 0;

    void enterPlaybackMode();

    const controller = videoControllerRef.current;

    const seekToStartIfNeeded = () => {
      if (!controller) return;
      try {
        const position = controller.getCurrentTime();
        if (position > 0.15) {
          controller.seekTo(0);
          lastSyncedProgressTimeRef.current = 0;
        }
      } catch (_) {}
    };

    // TikTok/Instagram pattern: call play() immediately — never wait for readyToPlay.
    // ExoPlayer buffers while the thumbnail is visible; waiting caused 5s delays.
    if (controller && playerValidRef.current) {
      pendingPlayRef.current = false;
      try {
        seekToStartIfNeeded();
        controller.setMuted(isMuted);
        controller.play();
      } catch (_) {
        pendingPlayRef.current = true;
      }
      return true;
    }

    pendingPlayRef.current = true;
    return true;
  }, [
    decoderErrorDetected,
    isActive,
    isAppActive,
    isMuted,
    isVideo,
    pausedByUser,
    scrubProgress,
    suspendPlayback,
  ]);

  const thumbnailOrPlaceholderUrl = getThumbnailUrl(item) || (isVideo ? null : mediaUrl) || null;
  const fallbackImageUrl =
    !isVideo && thumbnailOrPlaceholderUrl && thumbnailOrPlaceholderUrl !== mediaUrl
      ? thumbnailOrPlaceholderUrl
      : null;
  const imageDisplayUrl = usingImageFallback && fallbackImageUrl ? fallbackImageUrl : (mediaUrl || thumbnailOrPlaceholderUrl);
  const competitionVideoStatusLabel =
    isCompetitionPost && isVideo && !hlsReady ? getChallengeVideoStatusLabel(item) || 'Video' : null;
  const subcategoryName = getPostSubcategoryName(item);

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
      muteOpacity.stopAnimation();
      pauseIndicatorOpacity.stopAnimation();
      likeScale.stopAnimation();
      likeOpacity.stopAnimation();
      thumbnailOpacity.stopAnimation();
      scrubProgress.stopAnimation();
      pendingPlayRef.current = false;
      clearAutoplayRetryTimeouts();
    };
  }, [clearAutoplayRetryTimeouts, likeOpacity, likeScale, muteOpacity, pauseIndicatorOpacity, scrubProgress, thumbnailOpacity]);

  // Mute/pause when leaving foreground, suspending, or when off-screen and not prewarming.
  useEffect(() => {
    const controller = videoControllerRef.current;
    if (!controller) {
      return;
    }

    if (!isAppActive || suspendPlayback) {
      clearAutoplayRetryTimeouts();
      try {
        controller.setMuted(true);
        controller.pause();
      } catch (_) {}
      return;
    }

    if (isActive) {
      return;
    }

    clearAutoplayRetryTimeouts();
    try {
      controller.setMuted(true);
      controller.pause();
    } catch (_) {}
  }, [clearAutoplayRetryTimeouts, isActive, isAppActive, suspendPlayback]);

  // SAFETY NET: Poll every 500ms to catch players that escaped cleanup.
  useEffect(() => {
    const shouldAllowPlayback =
      isAppActive &&
      !suspendPlayback &&
      !decoderErrorDetected &&
      isActive &&
      !pausedByUser;
    if (shouldAllowPlayback) {
      return;
    }

    const interval = setInterval(() => {
      const controller = videoControllerRef.current;
      if (!controller) return;
      try {
        if (controller.isPlaying()) {
          controller.setMuted(true);
          controller.pause();
        }
      } catch (_) {}
    }, 500);

    return () => clearInterval(interval);
  }, [decoderErrorDetected, isActive, isAppActive, pausedByUser, suspendPlayback]);

  useEffect(() => {
    setImageError(false);
    setUsingImageFallback(false);
  }, [item.id, mediaUrl, thumbnailOrPlaceholderUrl]);

  useEffect(() => {
    setVideoError(false);
    setVideoReady(false);
    setFirstFrameRendered(false);
    setVideoVisualReady(false);
    setIsPlaying(false);
    setDecoderErrorDetected(false);
    setPreferDirectVideoSource(false);
    setVideoProgress(0);
    setRetryCount(0);
    setPausedByUser(false);
    playbackStatusRef.current = 'idle';
    lastPlaybackTimeRef.current = 0;
    lastSyncedProgressTimeRef.current = 0;
    lastDurationRef.current = 0;
    videoMountRetryCountRef.current = 0;
    setCanMountVideoPlayer(false);
    setVideoMountBoundaryKey(0);
    setIosVisualRecoveryKey(0);
    clearAutoplayRetryTimeouts();
    firstPlaybackRequestedAtRef.current = null;
    firstPlaybackMotionRequestedAtRef.current = null;
    firstPlaybackMotionReportedRef.current = false;
    stallCountRef.current = 0;
    playbackStallCountRef.current = 0;
    playbackStallProbeRef.current = { time: 0, checkedAt: 0 };
    visualRecoveryAttemptedRef.current = false;
    wasActiveRef.current = false;
    wasAppActiveRef.current = isAppActive;
    hasActivatedOnceRef.current = false;
    lastStartedPlaybackGenerationRef.current = -1;
    pendingPlayRef.current = false;
    setPlaybackGeneration(0);
  }, [clearAutoplayRetryTimeouts, isAppActive, item.id]);

  useEffect(() => {
    if (!isVideo) {
      wasActiveRef.current = isActive;
      return;
    }

    const becameActive = isActive && !wasActiveRef.current;
    const becameInactive = !isActive && wasActiveRef.current;
    const resumedWhileActive = isActive && isAppActive && !wasAppActiveRef.current;

    if (becameActive) {
      visualRecoveryAttemptedRef.current = false;
      stallCountRef.current = 0;
      playbackStallCountRef.current = 0;
      playbackStallProbeRef.current = { time: 0, checkedAt: Date.now() };
      firstPlaybackRequestedAtRef.current = Date.now();
      firstPlaybackMotionRequestedAtRef.current = Date.now();
      firstPlaybackMotionReportedRef.current = false;
      lastPlaybackTimeRef.current = 0;
      lastSyncedProgressTimeRef.current = 0;
      lastStartedPlaybackGenerationRef.current = -1;
      pendingPlayRef.current = false;
      clearAutoplayRetryTimeouts();
      scrubProgress.setValue(0);
      setVideoProgress(0);
      setIsPlaying(false);

      const controller = videoControllerRef.current;
      const isWarmPlayer =
        controller &&
        playerValidRef.current &&
        playbackStatusRef.current === 'readyToPlay';

      setPlaybackGeneration((prev) => {
        const nextGen = prev + 1;
        if (isWarmPlayer) {
          lastStartedPlaybackGenerationRef.current = nextGen;
        }
        return nextGen;
      });

      thumbnailOpacity.stopAnimation();
      if (isWarmPlayer) {
        // Preloaded player already buffered while it had no surface. The VideoView
        // attaches now (attachVideoView flips true), so play immediately from the
        // buffered data but KEEP the thumbnail (same clip's poster) visible until
        // onFirstFrameRender confirms the first real frame is drawn — this avoids a
        // black flash during the surface attach.
        thumbnailOpacity.setValue(1);
        setVideoReady(true);
        try {
          const position = controller.getCurrentTime();
          if (position > 0.15) {
            controller.seekTo(0);
            lastSyncedProgressTimeRef.current = 0;
          }
          controller.setMuted(isMuted);
          controller.play();
          pendingPlayRef.current = false;
        } catch (_) {
          playerValidRef.current = false;
        }
      } else {
        thumbnailOpacity.setValue(1);
        setVideoReady(false);
        setFirstFrameRendered(false);
        setVideoVisualReady(false);
        if (controller && playerValidRef.current) {
          try {
            controller.setMuted(true);
            controller.pause();
          } catch (_) {
            playerValidRef.current = false;
          }
        }
      }
    } else if (resumedWhileActive) {
      // App returned to foreground (e.g. control center dismissed) — resume in place.
      // Do NOT reset position or remount; that causes a multi-second cold restart.
      const controller = videoControllerRef.current;
      if (
        controller &&
        playerValidRef.current &&
        !pausedByUser &&
        !suspendPlayback &&
        !decoderErrorDetected
      ) {
        try {
          controller.setMuted(isMuted);
          controller.play();
        } catch (_) {
          lastStartedPlaybackGenerationRef.current = -1;
          setPlaybackGeneration((prev) => prev + 1);
        }
      } else {
        lastStartedPlaybackGenerationRef.current = -1;
        setPlaybackGeneration((prev) => prev + 1);
      }
    } else if (becameInactive) {
      pendingPlayRef.current = false;
      clearAutoplayRetryTimeouts();
      thumbnailOpacity.stopAnimation();
      thumbnailOpacity.setValue(1);
      setVideoReady(false);
      setFirstFrameRendered(false);
      setVideoVisualReady(false);
      setIsPlaying(false);
      scrubProgress.setValue(0);
      setVideoProgress(0);

      const controller = videoControllerRef.current;
      if (controller) {
        try {
          controller.setMuted(true);
          controller.pause();
        } catch (_) {}
      }
    }

    wasActiveRef.current = isActive;
    wasAppActiveRef.current = isAppActive;
    if (becameActive) {
      hasActivatedOnceRef.current = true;
    }
  }, [
    clearAutoplayRetryTimeouts,
    decoderErrorDetected,
    isActive,
    isAppActive,
    isMuted,
    isVideo,
    pausedByUser,
    playbackGeneration,
    scrubProgress,
    suspendPlayback,
    thumbnailOpacity,
  ]);

  // ONE playback start per scroll-to-post: seek(0) then play. No declarative shouldPlay.
  useEffect(() => {
    if (!isVideo || !isActive) {
      return;
    }

    if (
      pausedByUser ||
      suspendPlayback ||
      !isAppActive ||
      decoderErrorDetected ||
      !canMountVideoPlayer ||
      !isPlayerValid
    ) {
      return;
    }

    if (lastStartedPlaybackGenerationRef.current === playbackGeneration) {
      return;
    }

    lastStartedPlaybackGenerationRef.current = playbackGeneration;
    void enterPlaybackMode();
    startActivePlayback();
  }, [
    canMountVideoPlayer,
    decoderErrorDetected,
    isActive,
    isAppActive,
    isPlayerValid,
    isVideo,
    pausedByUser,
    playbackGeneration,
    startActivePlayback,
    suspendPlayback,
  ]);

  useEffect(() => {
    if (shouldMountVideoPlayer && resolvedVideoSource) {
      setCanMountVideoPlayer(true);
    } else {
      setCanMountVideoPlayer(false);
      setVideoReady(false);
      setFirstFrameRendered(false);
      setVideoVisualReady(false);
      setIsPlaying(false);
      playerValidRef.current = false;
      videoControllerRef.current = null;
      if (isMountedRef.current) {
        setIsPlayerValid(false);
      }
    }
  }, [shouldMountVideoPlayer, resolvedVideoSource]);

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
    addFabricBreadcrumb('feed_video_mount_error', {
      postId: item.id,
      index,
      shouldLoadVideo,
      retryCount: videoMountRetryCountRef.current,
      isActive,
      appActive: isAppActive,
      sourceMode: videoSourceMode,
    });
    handleNativePlayerInvalid();
    if (isMountedRef.current) {
      setCanMountVideoPlayer(false);
      setVideoReady(false);
      setFirstFrameRendered(false);
      setVideoVisualReady(false);
      setIsPlaying(false);
    }

    if (videoMountRetryTimeoutRef.current) {
      clearTimeout(videoMountRetryTimeoutRef.current);
      videoMountRetryTimeoutRef.current = null;
    }

    if (Platform.OS === 'ios' && shouldLoadVideo && !preferDirectVideoSource) {
      setPreferDirectVideoSource(true);
      setVideoMountBoundaryKey((prev) => prev + 1);
      setCanMountVideoPlayer(true);
      return;
    }

    if (!shouldLoadVideo || videoMountRetryCountRef.current >= 2) {
      captureFabricError(
        new Error('Feed video mount retries exhausted'),
        'feed_video_mount_error',
        {
          postId: item.id,
          index,
          shouldLoadVideo,
          retryCount: videoMountRetryCountRef.current,
          isActive,
          appActive: isAppActive,
          sourceMode: videoSourceMode,
        },
        'warning',
      );
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
  }, [handleNativePlayerInvalid, shouldLoadVideo, item.id, index, isActive, isAppActive, preferDirectVideoSource, videoSourceMode]);

  const handleNativePlayingChange = useCallback((nextPlaying: boolean) => {
    if (isMountedRef.current) {
      setIsPlaying(nextPlaying);
      if (nextPlaying) {
        clearAutoplayRetryTimeouts();
        setVideoReady(true);
        pauseIndicatorOpacity.setValue(0);
        if (firstFrameRendered && lastPlaybackTimeRef.current > VIDEO_VISUAL_READY_SECONDS) {
          setVideoVisualReady(true);
        }
      }
    }
  }, [clearAutoplayRetryTimeouts, firstFrameRendered, pauseIndicatorOpacity]);

  const handleNativeStatusChange = useCallback((event: { status?: string; error?: unknown }) => {
    if (!isMountedRef.current) {
      return;
    }

    if (event?.status) {
      playbackStatusRef.current = event.status as 'idle' | 'loading' | 'readyToPlay' | 'error';
    }

    if (event?.error) {
      captureFabricError(event.error, 'feed_video_status_error', {
        postId: item.id,
        index,
        status: event?.status || 'unknown',
        shouldLoadVideo,
        isActive,
        appActive: isAppActive,
        sourceMode: videoSourceMode,
        currentTime: lastPlaybackTimeRef.current,
      });
      setIsPlaying(false);
      setVideoReady(false);
      if (Platform.OS === 'ios' && shouldLoadVideo && !preferDirectVideoSource) {
        setPreferDirectVideoSource(true);
        setVideoMountBoundaryKey((prev) => prev + 1);
        setCanMountVideoPlayer(true);
      }
      return;
    }

    if (event?.status === 'readyToPlay') {
      setVideoError(false);
      setDecoderErrorDetected(false);
      setVideoReady(true);

      // Android: this is the ONLY reliable moment to start playback from position 0.
      // The source is loaded and buffered — seekTo(0) + play() here is guaranteed correct.
      if (
        pendingPlayRef.current &&
        isActive &&
        !pausedByUser &&
        !suspendPlayback &&
        isAppActive &&
        !decoderErrorDetected &&
        isMountedRef.current
      ) {
        pendingPlayRef.current = false;
        const controller = videoControllerRef.current;
        if (controller && playerValidRef.current) {
          try {
            const position = controller.getCurrentTime();
            if (position > 0.15) {
              controller.seekTo(0);
              lastSyncedProgressTimeRef.current = 0;
            }
            controller.setMuted(isMuted);
            controller.play();
          } catch (_) {}
        }
      }
    }
  }, [decoderErrorDetected, index, isActive, isAppActive, isMuted, isVideo, item.id, pausedByUser, preferDirectVideoSource, shouldLoadVideo, suspendPlayback, videoSourceMode]);

  const handleNativeTimeUpdate = useCallback((payload: { currentTime: number; duration: number }) => {
    if (!isMountedRef.current) {
      return;
    }

    if (!isActive) {
      return;
    }

    const currentTime = payload.currentTime || 0;
    const duration = payload.duration || lastDurationRef.current || 0;

    if (!isDraggingRef.current) {
      syncProgressFromPlayer(
        currentTime,
        duration > 0 ? duration : undefined,
      );
    }
  }, [isActive, syncProgressFromPlayer]);

  const handleNativePlayToEnd = useCallback(() => {
    if (!isMountedRef.current) {
      return;
    }
    if (!isDraggingRef.current) {
      setVideoProgress(0);
      scrubProgress.setValue(0);
      lastSyncedProgressTimeRef.current = 0;
    }
    setVideoReady(true);
  }, [scrubProgress]);

  useEffect(() => {
    if (shouldLoadVideo) {
      feedTelemetry.trackVideoSourceMode({
        mode: videoSourceMode,
        postId: item.id,
        screenName,
      });
    }
  }, [item.id, screenName, shouldLoadVideo, videoSourceMode]);

  // Expo Video's native timeUpdate can be sparse on Android HLS. Poll only the
  // active item so progress keeps moving without mounting extra decoders.
  useEffect(() => {
    if (!isVideo || !isActive || pausedByUser || suspendPlayback || !isAppActive) {
      return;
    }

    const interval = setInterval(() => {
      if (isDraggingRef.current) {
        return;
      }

      const controller = videoControllerRef.current;
      if (!controller || !playerValidRef.current) {
        return;
      }

      try {
        const { currentTime, duration } = resolvePlaybackTimes();
        const controllerPlaying = controller.isPlaying();
        if (controllerPlaying && currentTime > VIDEO_VISUAL_READY_SECONDS) {
          if (!firstFrameRendered) {
            setFirstFrameRendered(true);
          }
          setVideoVisualReady(true);
          const firstMotionRequestedAt = firstPlaybackMotionRequestedAtRef.current;
          if (!firstPlaybackMotionReportedRef.current && firstMotionRequestedAt) {
            firstPlaybackMotionReportedRef.current = true;
            feedTelemetry.trackVideoTimeToFirstMotion({
              postId: item.id,
              screenName,
              sourceMode: videoSourceMode,
              durationMs: Math.max(0, Date.now() - firstMotionRequestedAt),
            });
          }
        }

        if (controllerPlaying || currentTime > 0) {
          syncProgressFromPlayer(currentTime, duration > 0 ? duration : undefined);
        }
      } catch (_) {}
    }, 250);

    return () => clearInterval(interval);
  }, [
    firstFrameRendered,
    isActive,
    isAppActive,
    isVideo,
    item.id,
    pausedByUser,
    resolvePlaybackTimes,
    screenName,
    suspendPlayback,
    syncProgressFromPlayer,
    videoSourceMode,
  ]);

  // Fade out the thumbnail once playback is visually ready.
  useEffect(() => {
    if (isActive && isPlaying && videoVisualReady) {
      const timerId = setTimeout(() => {
        if (!isMountedRef.current) return;
        Animated.timing(thumbnailOpacity, {
          toValue: 0,
          duration: 45,
          useNativeDriver: FEED_ANIMATION_USES_NATIVE_DRIVER,
        }).start();
      }, 0);
      return () => clearTimeout(timerId);
    }

    if (!isActive) {
      thumbnailOpacity.setValue(1);
    }
  }, [isActive, isPlaying, thumbnailOpacity, videoVisualReady]);

  // Retry on video error with exponential backoff
  const handleRetry = useCallback(() => {
    if (retryCount < 3) {
      const delay = Math.pow(2, retryCount) * 1000;
      setTimeout(() => {
        setVideoError(false);
        setVideoReady(false);
        setFirstFrameRendered(false);
        setVideoVisualReady(false);
        setCanMountVideoPlayer(true);
        setVideoMountBoundaryKey((prev) => prev + 1);
        setRetryCount(prev => prev + 1);
      }, delay);
    }
  }, [retryCount]);

  // iOS-only: recover when audio advances but no frame renders. Android skips this
  // because remount/seek retries were causing stop/play loops on low-end devices.
  useEffect(() => {
    if (Platform.OS !== 'ios') {
      return;
    }

    if (!isVideo || !isActive || !shouldLoadVideo || firstFrameRendered || videoError || retryCount >= 2) {
      return;
    }

    const delay = VIDEO_FIRST_FRAME_WATCHDOG_DELAYS_MS[retryCount] ?? VIDEO_FIRST_FRAME_WATCHDOG_DELAYS_MS[0];

    const timeoutId = setTimeout(() => {
      if (!isMountedRef.current || firstFrameRendered || videoError) {
        return;
      }

      const audioOrProgressWithoutFrame = isPlaying || lastPlaybackTimeRef.current > 0.2;
      if (!audioOrProgressWithoutFrame && playbackStatusRef.current !== 'readyToPlay') {
        return;
      }

      setRetryCount((prev) => prev + 1);
      setVideoMountBoundaryKey((prev) => prev + 1);
      lastStartedPlaybackGenerationRef.current = -1;
      setPlaybackGeneration((prev) => prev + 1);
    }, delay);

    return () => clearTimeout(timeoutId);
  }, [
    firstFrameRendered,
    isActive,
    isPlaying,
    isVideo,
    retryCount,
    shouldLoadVideo,
    videoError,
    item.id,
    screenName,
    videoSourceMode,
  ]);

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
    Animated.timing(muteOpacity, {
      toValue: 0,
      duration: 800,
      delay: 300,
      useNativeDriver: FEED_ANIMATION_USES_NATIVE_DRIVER,
    }).start();
  };

  const handleLike = async () => {
    if (!user) {
      Alert.alert('Login Required', 'Please log in or sign up to like posts.', [
        { text: 'Cancel', style: 'cancel', onPress: () => resumePlayback() },
        { text: 'Sign Up', onPress: () => router.push({ pathname: '/auth/register' as any }) },
        { text: 'Log In', onPress: () => router.push({ pathname: '/auth/login' as any }) },
      ]);
      return;
    }
    if (isLiking) return;
    setIsLiking(true);
    const currentIsLiked = isPostLiked;
    const newIsLiked = !currentIsLiked;
    Animated.sequence([
      Animated.timing(likeScale, { toValue: 1.3, duration: 150, useNativeDriver: FEED_ANIMATION_USES_NATIVE_DRIVER }),
      Animated.timing(likeScale, { toValue: 1, duration: 150, useNativeDriver: FEED_ANIMATION_USES_NATIVE_DRIVER }),
    ]).start();
    if (newIsLiked) {
      Animated.sequence([
        Animated.timing(likeOpacity, { toValue: 1, duration: 200, useNativeDriver: FEED_ANIMATION_USES_NATIVE_DRIVER }),
        Animated.timing(likeOpacity, { toValue: 0, duration: 300, useNativeDriver: FEED_ANIMATION_USES_NATIVE_DRIVER }),
      ]).start();
    }
    try {
      await onLike(item.id);
    } finally {
      if (isMountedRef.current) {
        setIsLiking(false);
      }
    }
  };

  const handleFollow = () => {
    if (!user) {
      setShowFollowLoginModal(true);
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

  const seekToProgressRatio = useCallback((ratio: number) => {
    const controller = videoControllerRef.current;
    if (!controller || !playerValidRef.current) return;
    const { duration } = resolvePlaybackTimes();
    if (duration <= 0) return;
    const clamped = Math.max(0, Math.min(1, ratio));
    try {
      controller.seekTo(clamped * duration);
      lastPlaybackTimeRef.current = clamped * duration;
      scrubProgress.setValue(clamped);
      setVideoProgress(clamped);
    } catch (_) {}
  }, [resolvePlaybackTimes, scrubProgress]);

  const seekToProgressRatioRef = useRef((_ratio: number) => {});
  seekToProgressRatioRef.current = seekToProgressRatio;

  // PanResponder for smooth scrubbing.
  // During drag we update scrubProgress directly; seek on release.
  const progressBarPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onShouldBlockNativeResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        isDraggingRef.current = true;
        const ratio = Math.max(0, Math.min(1, e.nativeEvent.locationX / Math.max(1, progressBarWidthRef.current || screenWidthRef.current)));
        dragSeekRatioRef.current = ratio;
        scrubProgress.setValue(ratio);
      },
      onPanResponderMove: (e) => {
        const ratio = Math.max(0, Math.min(1, e.nativeEvent.locationX / Math.max(1, progressBarWidthRef.current || screenWidthRef.current)));
        dragSeekRatioRef.current = ratio;
        scrubProgress.setValue(ratio);
      },
      onPanResponderRelease: () => {
        isDraggingRef.current = false;
        seekToProgressRatioRef.current(dragSeekRatioRef.current);
      },
      onPanResponderTerminate: () => {
        isDraggingRef.current = false;
        seekToProgressRatioRef.current(dragSeekRatioRef.current);
      },
    }),
  ).current;

  const handleUserPress = () => {
    if (item.user?.id) {
      router.push({ pathname: '/user/[id]' as any, params: { id: item.user.id } });
    }
  };

  const handleCategoryPress = () => {
    if (subcategoryName) {
      router.push({ pathname: '/category/[name]' as any, params: { name: subcategoryName } });
    }
  };

  const displayLikeCount = cachedLikeCount !== undefined ? cachedLikeCount : (item.like_count ?? item.likes ?? 0);
  const isAd = (item as any).isAd === true;
  const adTitle = (item as any).title || (item as any).ad_title || '';
  const adFeaturedDurationText = isAd ? getAdFeaturedDurationText(item) : null;
  const mediaContentFit = isAd ? 'contain' : 'cover';
  const footerHeight = showBottomFooter
    ? Math.max(bottomFooterHeight, insets.bottom + 44, 56)
    : Math.max(bottomFooterHeight, 0);
  const reservedBottomSpace = Math.max(bottomOverlayOffset, 0);
  const progressBarGap = 2;
  const stackGapAboveProgress = 12;
  const rightActionsGap = 22;
  const feedProgressBottomInset = footerHeight + progressBarGap;
  const feedOverlayBottomInset = feedProgressBottomInset + stackGapAboveProgress + reservedBottomSpace;
  const feedRightActionsBottomInset = feedProgressBottomInset + rightActionsGap + reservedBottomSpace;

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

              {canMountVideoPlayer && shouldMountVideoPlayer && !videoError && resolvedVideoSource && (
                <View
                  pointerEvents="none"
                  style={styles.videoLayer}
                >
                  <VideoMountBoundary
                    key={`${item.id}:${videoMountBoundaryKey}:${iosVisualRecoveryKey}`}
                    boundaryKey={`${item.id}:${videoMountBoundaryKey}:${iosVisualRecoveryKey}`}
                    onError={handleNativePlayerMountError}
                  >
                    <FeedVideo
                      ref={videoControllerRef}
                      player={null}
                      source={resolvedVideoSource}
                      playerInstanceKey={`${item.id}:${iosVisualRecoveryKey}`}
                      contentFit={mediaContentFit}
                      isMuted={shouldMuteVideo}
                      shouldPlay={false}
                      attachVideoView={isActive}
                      postId={item.id}
                      screenName={screenName}
                      sourceMode={videoSourceMode}
                      onFirstFrameRender={() => {
                        setVideoReady(true);
                        setFirstFrameRendered(true);
                        setVideoVisualReady(true);
                        thumbnailOpacity.stopAnimation();
                        thumbnailOpacity.setValue(0);
                        const firstMotionRequestedAt = firstPlaybackMotionRequestedAtRef.current;
                        if (!firstPlaybackMotionReportedRef.current && firstMotionRequestedAt) {
                          firstPlaybackMotionReportedRef.current = true;
                          feedTelemetry.trackVideoTimeToFirstMotion({
                            postId: item.id,
                            screenName,
                            sourceMode: videoSourceMode,
                            durationMs: Math.max(0, Date.now() - firstMotionRequestedAt),
                          });
                        }
                        const firstRequestedAt = firstPlaybackRequestedAtRef.current;
                        if (firstRequestedAt) {
                          feedTelemetry.trackVideoTimeToFirstFrame({
                            postId: item.id,
                            screenName,
                            sourceMode: videoSourceMode,
                            durationMs: Math.max(0, Date.now() - firstRequestedAt),
                          });
                          firstPlaybackRequestedAtRef.current = null;
                        }
                      }}
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

        {showBottomFooter && footerHeight > 0 ? (
          <View
            pointerEvents="none"
            style={[styles.fixedBottomFooter, { height: footerHeight }]}
          />
        ) : null}

        <View style={[styles.rightActions, { bottom: feedRightActionsBottomInset }]}>
          {!isAd && (
            <View style={styles.avatarContainer}>
              <TouchableOpacity onPress={handleUserPress}>
              <Avatar
                user={item.user ? { ...item.user, profile_picture: item.user.profile_picture ?? undefined } : undefined}
                size={48}
                style={styles.userAvatar}
              />
              </TouchableOpacity>
              {user && !isOwnPost ? (
                <TouchableOpacity style={styles.followIconButton} onPress={handleFollow}>
                  <Feather name={isFollowing ? 'check' : 'plus'} size={16} color="#000" />
                </TouchableOpacity>
              ) : null}
            </View>
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

          <TouchableOpacity
            style={styles.actionButton}
            onPress={handleLike}
            activeOpacity={0.7}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
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

          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => onShare(item.id)}
            activeOpacity={0.7}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
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
          {!isAd && subcategoryName && (
            <TouchableOpacity style={styles.categoryBadge} onPress={handleCategoryPress}>
              <Text style={styles.categoryText}>#{getCategoryDisplayName(subcategoryName)}</Text>
            </TouchableOpacity>
          )}
          {!isAd && !isOwnPost && (
            <TouchableOpacity
              style={[styles.followButton, { backgroundColor: !isFollowStateReady ? 'rgba(255,255,255,0.12)' : isFollowing ? 'rgba(255,255,255,0.2)' : '#60a5fa' }]}
              onPress={handleFollow}
              disabled={!isFollowStateReady}
            >
              <Text style={[styles.followButtonText, { color: isFollowing ? '#fff' : '#000' }]}>
                {!isFollowStateReady ? '...' : isFollowing ? 'Following' : 'Follow'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {isVideo && isActive && (
          <View
            style={[styles.videoProgressBarContainer, { bottom: feedProgressBottomInset }]}
            onLayout={(event) => {
              const width = event.nativeEvent.layout.width;
              if (width > 0) {
                progressBarWidthRef.current = width;
              }
            }}
            {...progressBarPanResponder.panHandlers}
          >
            {/* Inner row: track (3px) + thumb (10px) share the same height. */}
            <View style={styles.progressBarInner}>
              <View style={styles.videoProgressBarTrack}>
                <Animated.View
                  style={[
                    styles.videoProgressBarFill,
                    {
                      width: scrubProgress.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0, screenWidth],
                        extrapolate: 'clamp',
                      }),
                    },
                  ]}
                />
              </View>
              <Animated.View
                style={[
                  styles.videoProgressBarThumb,
                  {
                    transform: [
                      {
                        translateX: scrubProgress.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0, Math.max(0, screenWidth - 10)],
                          extrapolate: 'clamp',
                        }),
                      },
                    ],
                  },
                ]}
              />
            </View>
          </View>
        )}
      </View>
      <UnfollowConfirmModal
        visible={showUnfollowModal}
        username={item.user?.username || 'user'}
        onConfirm={() => { handleUnfollowConfirm(); resumePlayback(); }}
        onCancel={() => setShowUnfollowModal(false)}
      />

      {/* Login/Sign Up prompt when non-logged user taps Follow */}
      <Modal visible={showFollowLoginModal} transparent animationType="fade" onRequestClose={() => setShowFollowLoginModal(false)}>
        <Pressable style={styles.bestModalOverlay} onPress={() => setShowFollowLoginModal(false)}>
          <View style={styles.followLoginModal}>
            <View style={styles.followLoginIconWrap}>
              <Feather name="user-plus" size={32} color="#60a5fa" />
            </View>
            <Text style={styles.followLoginTitle}>Follow {item.user?.username || 'this creator'}?</Text>
            <Text style={styles.followLoginSubtitle}>
              Create a free account or log in to follow creators and never miss their posts.
            </Text>
            <TouchableOpacity
              style={styles.followLoginPrimaryBtn}
              onPress={() => {
                setShowFollowLoginModal(false);
                router.push({ pathname: '/auth/register' as any });
              }}
            >
              <Text style={styles.followLoginPrimaryBtnText}>Sign Up — It's Free</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.followLoginSecondaryBtn}
              onPress={() => {
                setShowFollowLoginModal(false);
                router.push({ pathname: '/auth/login' as any });
              }}
            >
              <Text style={styles.followLoginSecondaryBtnText}>Log In</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowFollowLoginModal(false)}>
              <Text style={styles.followLoginDismissText}>Not now</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

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
    (prev.isFollowStateReady ?? true) === (next.isFollowStateReady ?? true) &&
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
    backgroundColor: '#000',
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
    backgroundColor: '#000',
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
    zIndex: 2,
    elevation: 2,
    width: '100%',
    height: '100%',
  },
  videoLayer: {
    position: 'absolute',
    zIndex: 1,
    elevation: 1,
    width: '100%',
    height: '100%',
    backgroundColor: 'transparent',
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
    elevation: 15,
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
    elevation: 20,
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
  shareComingSoonModal: {
    width: '100%',
    maxWidth: 330,
    backgroundColor: '#0f172a',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(96, 165, 250, 0.35)',
    padding: 28,
    alignItems: 'center',
    shadowColor: '#60a5fa',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.22,
    shadowRadius: 24,
    elevation: 12,
  },
  shareComingSoonIconWrap: {
    width: 66,
    height: 66,
    borderRadius: 33,
    backgroundColor: 'rgba(96, 165, 250, 0.16)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  shareComingSoonTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 8,
    textAlign: 'center',
  },
  shareComingSoonMessage: {
    color: '#cbd5e1',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 24,
  },
  shareComingSoonButton: {
    width: '100%',
    backgroundColor: '#60a5fa',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  shareComingSoonButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  followLoginModal: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: '#111827',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#1f2937',
    padding: 28,
    alignItems: 'center',
  },
  followLoginIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(96, 165, 250, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  followLoginTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  followLoginSubtitle: {
    color: '#9ca3af',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  followLoginPrimaryBtn: {
    width: '100%',
    backgroundColor: '#60a5fa',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  followLoginPrimaryBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  followLoginSecondaryBtn: {
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  followLoginSecondaryBtnText: {
    color: '#e5e7eb',
    fontSize: 16,
    fontWeight: '600',
  },
  followLoginDismissText: {
    color: '#6b7280',
    fontSize: 14,
    fontWeight: '400',
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
    marginBottom: 6,
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
    paddingVertical: 7,
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
    // 28px touch zone — large enough to grab easily, small enough to never
    // overlap the flag/report button whose touch area starts at 42px from bottom.
    height: 28,
    justifyContent: 'flex-end',
    paddingBottom: 0,
    zIndex: 30,
    elevation: 30,
  },
  fixedBottomFooter: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000',
    zIndex: 19,
  },
  progressBarInner: {
    // 10px = thumb diameter. 3px track is centred inside (3.5px from top/bottom).
    // Flush at the very bottom of the container → thumb occupies 0-10px from screen bottom.
    height: 10,
    justifyContent: 'center',
  },
  videoProgressBarTrack: {
    height: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    borderRadius: 2,
  },
  videoProgressBarFill: {
    height: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    borderRadius: 2,
  },
  videoProgressBarThumb: {
    // top:0 + height:10 → centre at 5px from inner top, aligns with 3px track centre (3.5px ≈ 4px).
    position: 'absolute',
    top: 0,
    left: 0,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.4,
    shadowRadius: 2,
    elevation: 3,
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
