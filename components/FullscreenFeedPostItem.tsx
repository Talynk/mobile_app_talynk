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
} from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { router } from 'expo-router';
import { Post } from '@/types';
import { useAuth } from '@/lib/auth-context';
import { useAppSelector } from '@/lib/store/hooks';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRealtime } from '@/lib/realtime-context';
import { useRealtimePost } from '@/lib/hooks/use-realtime-post';
import { getPostMediaUrl, getThumbnailUrl, getPlaybackUrl } from '@/lib/utils/file-url';
import { getVideoSource } from '@/lib/utils/video-source';
import { Avatar } from '@/components/Avatar';
import { timeAgo } from '@/lib/utils/time-ago';
import { useMute } from '@/lib/mute-context';

const formatNumber = (num: number): string => {
  if (num >= 1000000) return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return num.toString();
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
  shouldPreload: boolean;
  availableHeight: number;
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
  isLiked,
  isFollowing,
  isActive,
  shouldPreload,
  availableHeight,
}) => {
  const { width: screenWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { sendLikeAction } = useRealtime();
  const likedPosts = useAppSelector((s) => s.likes.likedPosts);
  const postLikeCounts = useAppSelector((s) => s.likes.postLikeCounts);

  const isPostLiked = likedPosts.includes(item.id) || isLiked;
  const cachedLikeCount = postLikeCounts[item.id];
  const initialLikeCount = cachedLikeCount !== undefined ? cachedLikeCount : (item.like_count ?? item.likes ?? 0);

  const { comments } = useRealtimePost({
    postId: item.id,
    initialLikes: initialLikeCount,
    initialComments: item.comments_count || item.comment_count || 0,
    initialIsLiked: isPostLiked,
  });

  const wasActiveRef = useRef(isActive);
  const playerValidRef = useRef(false);
  const isMountedRef = useRef(true);
  const [isPlayerValid, setIsPlayerValid] = useState(false);
  const [isLiking, setIsLiking] = useState(false);
  const [imageError, setImageError] = useState(false);
  const { isMuted, toggleMute } = useMute();
  const [videoError, setVideoError] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [decoderErrorDetected, setDecoderErrorDetected] = useState(false);
  const [videoProgress, setVideoProgress] = useState(0);
  const [retryCount, setRetryCount] = useState(0);
  const muteOpacity = useRef(new Animated.Value(0)).current;
  const muteIconRef = useRef<'volume-2' | 'volume-x'>('volume-2');
  const [pausedByUser, setPausedByUser] = useState(false);
  const pauseIndicatorOpacity = useRef(new Animated.Value(0)).current;
  const likeScale = useRef(new Animated.Value(1)).current;
  const likeOpacity = useRef(new Animated.Value(0)).current;
  const thumbnailOpacity = useRef(new Animated.Value(1)).current;

  const mediaUrl = getPostMediaUrl(item);
  const isVideo = item.type === 'video';
  const playbackUrl = item.playback_url || getPlaybackUrl(item);
  const hlsReady = !!playbackUrl;
  const shouldLoadVideo = isVideo && hlsReady && (isActive || shouldPreload) && !videoError;
  const videoPlayerSource = shouldLoadVideo && playbackUrl ? getVideoSource(playbackUrl) : null;

  const thumbnailOrPlaceholderUrl = getThumbnailUrl(item) || (isVideo ? null : mediaUrl) || null;

  const videoPlayer = useVideoPlayer(videoPlayerSource, (player) => {
    if (player) {
      try {
        player.loop = true;
        player.muted = isMuted;
      } catch (e) {
        console.warn('[VideoPlayer] Error setting player properties:', e);
      }
    }
  });

  useEffect(() => {
    if (videoPlayer) {
      playerValidRef.current = true;
      if (isMountedRef.current) setIsPlayerValid(true);
    } else {
      playerValidRef.current = false;
      if (isMountedRef.current) setIsPlayerValid(false);
    }
  }, [videoPlayer]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      playerValidRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!videoPlayerSource) {
      playerValidRef.current = false;
      if (isMountedRef.current) setIsPlayerValid(false);
    }
  }, [videoPlayerSource]);

  // Play/pause based on active state
  useEffect(() => {
    if (!videoPlayer || !playerValidRef.current) return;
    try {
      if (isActive && !decoderErrorDetected) {
        videoPlayer.muted = isMuted;
        videoPlayer.play();
      } else {
        videoPlayer.muted = true;
        videoPlayer.pause();
      }
      if (isActive && !wasActiveRef.current) {
        videoPlayer.currentTime = 0;
      }
      wasActiveRef.current = isActive;
    } catch (e) {
      playerValidRef.current = false;
    }
  }, [isActive, isMuted, videoPlayer, decoderErrorDetected, index]);

  // Fade out thumbnail when video is playing and ready
  useEffect(() => {
    if (isActive && isPlaying && videoReady) {
      Animated.timing(thumbnailOpacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start();
    } else {
      thumbnailOpacity.setValue(1);
    }
  }, [isActive, isPlaying, videoReady, thumbnailOpacity]);

  // Track playing state
  useEffect(() => {
    if (!videoPlayer || !playerValidRef.current) return;
    try {
      const sub = videoPlayer.addListener('playingChange', (event: { isPlaying: boolean }) => {
        if (isMountedRef.current) {
          setIsPlaying(event.isPlaying);
          if (event.isPlaying && isActive) setVideoReady(true);
        }
      });
      return () => {
        try { sub.remove(); } catch (_) {}
      };
    } catch (_) {
      playerValidRef.current = false;
      return () => {};
    }
  }, [videoPlayer, isActive]);

  // Track progress
  useEffect(() => {
    if (!videoPlayer || !isActive) return;
    const interval = setInterval(() => {
      try {
        const ct = videoPlayer.currentTime || 0;
        const dur = videoPlayer.duration || 0;
        if (dur > 0) setVideoProgress(ct / dur);
      } catch (_) {}
    }, 250);
    return () => clearInterval(interval);
  }, [videoPlayer, isActive]);

  // Retry on video error with exponential backoff
  const handleRetry = useCallback(() => {
    if (retryCount < 3) {
      const delay = Math.pow(2, retryCount) * 1000;
      setTimeout(() => {
        setVideoError(false);
        setRetryCount(prev => prev + 1);
      }, delay);
    }
  }, [retryCount]);

  const handleTapToPause = () => {
    if (!videoPlayer || !isPlayerValid) return;
    try {
      if (videoPlayer.playing) {
        videoPlayer.pause();
        setPausedByUser(true);
        pauseIndicatorOpacity.setValue(1);
      } else {
        videoPlayer.play();
        setPausedByUser(false);
        pauseIndicatorOpacity.setValue(0);
      }
    } catch (_) {}
  };

  const handleMuteToggle = () => {
    const newMuted = toggleMute();
    if (videoPlayer) {
      try { videoPlayer.muted = newMuted; } catch (_) {}
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
    if (isFollowing) onUnfollow(item.user?.id || '');
    else onFollow(item.user?.id || '');
  };

  const handleComment = useCallback(() => {
    if (onComment && item.id) onComment(item.id);
  }, [onComment, item.id]);

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

  return (
    <View style={[styles.postContainer, { height: availableHeight }]} pointerEvents="box-none">
      <View style={[styles.mediaContainer, { height: availableHeight, width: screenWidth }]}>
        {isVideo ? (
          <>
            <Pressable style={styles.mediaWrapper} onPress={handleTapToPause}>
              {thumbnailOrPlaceholderUrl ? (
                <Animated.Image
                  source={{ uri: thumbnailOrPlaceholderUrl }}
                  style={[styles.media, styles.mediaThumbnailLayer, { opacity: thumbnailOpacity }]}
                  resizeMode="cover"
                />
              ) : null}

              {videoPlayer && isPlayerValid && shouldLoadVideo && !videoError && (
                <View pointerEvents="none" style={{ position: 'absolute', zIndex: 2, width: '100%', height: '100%' }}>
                  <VideoView
                    player={videoPlayer}
                    style={styles.media}
                    contentFit="cover"
                    nativeControls={false}
                    {...(Platform.OS === 'android' ? { surfaceType: 'textureView' as any } : {})}
                  />
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
          <View style={styles.mediaWrapper}>
            {mediaUrl && !imageError ? (
              <Image source={{ uri: mediaUrl }} style={styles.media} resizeMode="cover" onError={() => setImageError(true)} />
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
              <TouchableOpacity style={styles.followIconButton} onPress={handleFollow}>
                <Feather name={isFollowing ? 'check' : 'plus'} size={16} color="#000" />
              </TouchableOpacity>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionButton} onPress={handleLike}>
            <Animated.View style={{ transform: [{ scale: likeScale }] }}>
              <Feather name="heart" size={24} color={isPostLiked ? '#ff2d55' : '#fff'} fill={isPostLiked ? '#ff2d55' : 'none'} />
            </Animated.View>
            <Text style={styles.actionCount}>{formatNumber(displayLikeCount)}</Text>
          </TouchableOpacity>

          <Animated.View style={[styles.likeAnimationOverlay, { opacity: likeOpacity }]}>
            <Feather name="heart" size={48} color="#ff2d55" fill="#ff2d55" />
          </Animated.View>

          <TouchableOpacity style={styles.actionButton} onPress={handleComment} activeOpacity={0.7} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
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
            {(item.caption || item.description || item.title) && (
              <ExpandableCaption text={item.caption || item.description || item.title || ''} maxLines={2} />
            )}
            {(item.createdAt || item.uploadDate || (item as any).created_at) && (
              <Text style={styles.timestamp}>{timeAgo(item.createdAt || item.uploadDate || (item as any).created_at)}</Text>
            )}
          </View>
          {item.category && (
            <TouchableOpacity style={styles.categoryBadge} onPress={handleCategoryPress}>
              <Text style={styles.categoryText}>#{typeof item.category === 'string' ? item.category : (item.category as { name?: string })?.name}</Text>
            </TouchableOpacity>
          )}
          {user && user.id !== item.user?.id && (
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
          <View style={[styles.videoProgressBarContainer, { bottom: insets.bottom + 11 }]} pointerEvents="none">
            <View style={[styles.videoProgressBarFill, { width: `${Math.min(videoProgress * 100, 100)}%` }]} />
          </View>
        )}
      </View>
    </View>
  );
};

function arePropsEqual(prev: FullscreenFeedPostItemProps, next: FullscreenFeedPostItemProps) {
  return (
    prev.item.id === next.item.id &&
    prev.isActive === next.isActive &&
    prev.shouldPreload === next.shouldPreload &&
    prev.isLiked === next.isLiked &&
    prev.isFollowing === next.isFollowing &&
    prev.availableHeight === next.availableHeight
  );
}

export default React.memo(FullscreenFeedPostItem, arePropsEqual);

const styles = StyleSheet.create({
  postContainer: {
    width: '100%',
    backgroundColor: 'transparent',
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
    backgroundColor: 'transparent',
    overflow: 'visible',
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
    right: 84,
    zIndex: 21,
    elevation: 5,
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
    bottom: 0,
    left: 0,
    right: 0,
    height: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    zIndex: 100,
  },
  videoProgressBarFill: {
    height: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
  },
});
