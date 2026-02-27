import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  StatusBar,
  RefreshControl,
  Dimensions,
  Image,
  Modal,
  ScrollView,
  FlatList,
  Animated,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { MaterialIcons, Feather } from '@expo/vector-icons';
import { challengesApi } from '@/lib/api';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/Avatar';
import { Post } from '@/types';
import { getThumbnailUrl, getFileUrl, getPostMediaUrl } from '@/lib/utils/file-url';
import { useVideoThumbnail } from '@/lib/hooks/use-video-thumbnail';
import { useVideoPreload } from '@/lib/hooks/use-video-preload';
import { useVideoPlayer, VideoView } from 'expo-video';
import { timeAgo } from '@/lib/utils/time-ago';
import { filterHlsReady } from '@/lib/utils/post-filter';
import { useVideoMute } from '@/lib/hooks/use-video-mute';
import { LinearGradient } from 'expo-linear-gradient';

const INITIAL_LIMIT = 20;
const LOAD_MORE_LIMIT = 10;
const { width: SCREEN_WIDTH } = Dimensions.get('window');

const COLORS = {
  dark: {
    background: '#000000',
    card: '#1a1a1a',
    border: '#2a2a2a',
    text: '#f3f4f6',
    textSecondary: '#9ca3af',
    primary: '#60a5fa',
    overlay: 'rgba(0,0,0,0.5)',
  },
};

export default function ChallengePostsScreen() {
  const { id, open, openIndex } = useLocalSearchParams();
  const C = COLORS.dark;
  const insets = useSafeAreaInsets();

  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

  // Fullscreen post viewing state
  const [fullscreenIndex, setFullscreenIndex] = useState(0);
  const [showFullscreen, setShowFullscreen] = useState(false);
  const fullscreenListRef = useRef<FlatList>(null);

  const loadPosts = async (page = 1, refresh = false) => {
    if (!id) return;

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

      setError(null);

      const limit = page === 1 ? INITIAL_LIMIT : LOAD_MORE_LIMIT;
      const response = await challengesApi.getPosts(id as string, page, limit);

      if (response.status === 'success') {
        // API client already normalizes posts (extracts item.post)
        const postsList = filterHlsReady(response.data?.posts || []) as Post[];

        const pagination = response.data?.pagination || {};
        const hasMoreData = pagination.hasNextPage !== false && postsList.length === limit;
        setHasMore(hasMoreData);

        if (page === 1 || refresh) {
          setPosts(postsList);
        } else {
          setPosts(prev => [...prev, ...postsList]);
        }
      } else {
        if (page === 1) {
          setPosts([]);
        }
        setHasMore(false);
        setError(response.message || 'Failed to load posts');
      }
    } catch (err: any) {
      console.error('Error loading challenge posts:', err);
      if (page === 1) {
        setPosts([]);
      }
      setHasMore(false);
      setError(err.message || 'Failed to load posts');
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    loadPosts(1);
  }, [id]);

  // If coming from challenge detail tile tap, auto-open fullscreen at index
  useEffect(() => {
    if (open !== '1') return;
    if (!posts.length) return;
    const idx = Number(openIndex || 0);
    const safeIdx = Number.isFinite(idx) ? Math.max(0, Math.min(posts.length - 1, idx)) : 0;
    setFullscreenIndex(safeIdx);
    setShowFullscreen(true);
    setTimeout(() => {
      fullscreenListRef.current?.scrollToIndex({ index: safeIdx, animated: false });
    }, 50);
  }, [open, openIndex, posts.length]);

  // Preload next 3 videos when viewing in fullscreen
  const { getCachedUri } = useVideoPreload(posts, showFullscreen && fullscreenIndex >= 0 ? fullscreenIndex : -1, {
    preloadCount: 3,
    enabled: showFullscreen,
  });

  const loadMorePosts = () => {
    if (!loadingMore && hasMore && !loading) {
      const nextPage = currentPage + 1;
      setCurrentPage(nextPage);
      loadPosts(nextPage);
    }
  };

  const onRefresh = () => {
    loadPosts(1, true);
  };

  const handlePostPress = (index: number) => {
    setFullscreenIndex(index);
    setShowFullscreen(true);
    setTimeout(() => {
      fullscreenListRef.current?.scrollToIndex({ index, animated: false });
    }, 100);
  };

  // PostCard component for grid display
  const PostCard = ({ item, index }: { item: Post; index: number }) => {
    const [isActive, setIsActive] = useState(false);
    const [showVideo, setShowVideo] = useState(false);

    // Get media URL using the utility function
    const mediaUrl = getPostMediaUrl(item) || '';
    const isVideo =
      item.type === 'video' ||
      (mediaUrl !== null &&
        mediaUrl !== '' &&
        (mediaUrl.toLowerCase().includes('.mp4') ||
          mediaUrl.toLowerCase().includes('.mov') ||
          mediaUrl.toLowerCase().includes('.webm') ||
          mediaUrl.toLowerCase().includes('.m3u8')));

    // For videos, use the mediaUrl directly; for images, also use mediaUrl
    const videoUrl = isVideo ? mediaUrl : null;

    // HLS OPTIMIZATION: Server thumbnail_url takes priority
    const serverThumbnail = getThumbnailUrl(item);
    const fallbackImageUrl = getFileUrl((item as any).image || (item as any).thumbnail || '');
    const isHls = mediaUrl.endsWith('.m3u8');

    // DATA SAVER: Don't download raw MP4 for thumbnails — use server-generated thumbnail
    const { thumbnailUri: generatedThumbnail } = useVideoThumbnail(
      null, // Never download raw MP4 for thumbnails
      fallbackImageUrl || '',
      1000
    );
    // PRIORITY: Server thumbnail > generated thumbnail > fallback
    const staticThumbnailUrl = isVideo
      ? (serverThumbnail || generatedThumbnail || fallbackImageUrl)
      : (mediaUrl || fallbackImageUrl);

    const player = useVideoPlayer(videoUrl, (player) => {
      player.loop = true;
      player.muted = true;
    });

    useEffect(() => {
      if (isActive && isVideo && videoUrl) {
        const timer = setTimeout(() => {
          setShowVideo(true);
          player.play();
        }, 200);
        return () => {
          clearTimeout(timer);
          player.pause();
        };
      } else {
        setShowVideo(false);
        player.pause();
      }
    }, [isActive, isVideo, videoUrl, player]);

    return (
      <TouchableOpacity
        style={styles.postCard}
        onPressIn={() => setIsActive(true)}
        onPressOut={() => setIsActive(false)}
        activeOpacity={0.9}
        onPress={() => handlePostPress(index)}
      >
        {staticThumbnailUrl ? (
          <Image
            source={{ uri: staticThumbnailUrl }}
            style={styles.postMedia}
            resizeMode="cover"
          />
        ) : (
          <View style={[styles.postMedia, styles.noMediaPlaceholder]}>
            <MaterialIcons name={isVideo ? "video-library" : "image"} size={28} color="#444" />
          </View>
        )}

        {showVideo && isVideo && videoUrl && isActive && (
          <VideoView
            player={player}
            style={[styles.postMedia, styles.teaserVideo]}
            contentFit="cover"
            nativeControls={false}
          />
        )}


        <View style={styles.postOverlay}>
          <View style={styles.postStats}>
            <Feather name="heart" size={14} color="#fff" />
            <Text style={styles.postStatText}>{item.likes || 0}</Text>
          </View>
          {isVideo && (
            <View style={styles.playIcon}>
              {isActive && showVideo ? (
                <View style={styles.playingDot} />
              ) : (
                <Feather name="play" size={16} color="#fff" />
              )}
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  // Fullscreen post viewer component
  const FullscreenPostViewer = ({ item, index, cachedMediaUrl }: { item: Post; index: number; cachedMediaUrl?: string | null }) => {
    const { isMuted, toggleMute } = useVideoMute();
    const muteOpacity = useRef(new Animated.Value(0)).current;

    // Get media URL using the utility function
    const mediaUrl = getPostMediaUrl(item) || '';

    const isVideo =
      item.type === 'video' ||
      (mediaUrl !== null &&
        mediaUrl !== '' &&
        (mediaUrl.toLowerCase().includes('.mp4') ||
          mediaUrl.toLowerCase().includes('.mov') ||
          mediaUrl.toLowerCase().includes('.webm') ||
          mediaUrl.toLowerCase().includes('.m3u8')));

    // For videos, use the mediaUrl directly; for images, also use mediaUrl
    const videoUrl = isVideo ? mediaUrl : null;
    const imageUrl = !isVideo ? mediaUrl : null;

    // HLS OPTIMIZATION: Server thumbnail_url takes priority
    const serverThumbnail = getThumbnailUrl(item);
    const fallbackImageUrl = getFileUrl((item as any).image || (item as any).thumbnail || '');
    const isHls = mediaUrl.endsWith('.m3u8');

    // DATA SAVER: Don't download raw MP4 for thumbnails — use server-generated thumbnail
    const { thumbnailUri: generatedThumbnail } = useVideoThumbnail(
      null, // Never download raw MP4 for thumbnails
      fallbackImageUrl || '',
      1000
    );
    // PRIORITY: Server thumbnail > generated thumbnail > fallback
    const staticThumbnailUrl = isVideo
      ? (serverThumbnail || generatedThumbnail || fallbackImageUrl)
      : (imageUrl || mediaUrl || fallbackImageUrl);

    // Initialize expo-video player
    const videoPlayerSource = cachedMediaUrl || videoUrl || '';
    const videoPlayer = useVideoPlayer(videoPlayerSource, (player) => {
      player.loop = true;
      player.muted = isMuted;
      player.play();
    });

    // Sync mute state
    useEffect(() => {
      if (videoPlayer) {
        videoPlayer.muted = isMuted;
      }
    }, [isMuted, videoPlayer]);

    const handleVideoPress = () => {
      if (isVideo) {
        toggleMute();
        // Animate the mute indicator
        Animated.sequence([
          Animated.timing(muteOpacity, {
            toValue: 1,
            duration: 200,
            useNativeDriver: true,
          }),
          Animated.delay(800),
          Animated.timing(muteOpacity, {
            toValue: 0,
            duration: 500,
            useNativeDriver: true,
          }),
        ]).start();
      }
    };

    return (
      <View style={styles.fullscreenPostContainer}>
        <View style={styles.mediaContainer}>
          {/* Render thumbnail/image - always visible initially */}
          {imageUrl ? (
            <Image
              source={{ uri: imageUrl }}
              style={styles.fullscreenMedia}
              resizeMode="contain"
            />
          ) : staticThumbnailUrl ? (
            <Image
              source={{ uri: staticThumbnailUrl }}
              style={[
                styles.fullscreenMedia,
                { position: 'absolute', zIndex: 1 } // Layer under video
              ]}
              resizeMode="cover"
            />
          ) : (
            <View style={[styles.fullscreenMedia, styles.noMediaPlaceholder]}>
              <MaterialIcons name="image" size={48} color="#444" />
            </View>
          )}

          {/* Video Player */}
          {isVideo && videoUrl && (
            <TouchableOpacity
              activeOpacity={1}
              onPress={handleVideoPress}
              style={[styles.videoTouchable, { position: 'absolute', zIndex: 2, width: '100%', height: '100%' }]}
            >
              <VideoView
                player={videoPlayer}
                style={styles.fullscreenMedia}
                contentFit="cover"
                nativeControls={false}
              />

              {/* Mute/Unmute Indicator Overlay */}
              <View style={styles.muteIndicatorOverlay} pointerEvents="none">
                <Animated.View style={[styles.muteIndicatorBadge, { opacity: muteOpacity }]}>
                  <Feather
                    name={isMuted ? "volume-x" : "volume-2"}
                    size={32}
                    color="rgba(255,255,255,0.9)"
                  />
                </Animated.View>
              </View>
            </TouchableOpacity>
          )}

          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.8)']}
            style={styles.fullscreenOverlay}
          >
            {/* Post info overlays... */}
          </LinearGradient>
        </View>

        <View style={styles.fullscreenContent}>
          <View style={styles.postHeader}>
            <Avatar
              user={item.user ? { ...item.user, profile_picture: item.user.profile_picture || undefined } : { username: 'User' }}
              size={40}
              style={styles.postAvatar}
            />
            <View style={styles.headerText}>
              <Text style={styles.username}>{item.user?.username || 'User'}</Text>
            </View>
          </View>

          <Text style={styles.caption} numberOfLines={3}>
            {item.description || item.caption}
          </Text>
          <Text style={styles.timeAgo}>{timeAgo(item.createdAt)}</Text>
        </View>
      </View>
    );
  };

  if (loading && posts.length === 0) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: C.background }]} edges={['top']}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={C.primary} />
          <Text style={[styles.loadingText, { color: C.text }]}>Loading posts...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error && posts.length === 0) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: C.background }]} edges={['top']}>
        <View style={styles.errorContainer}>
          <MaterialIcons name="error-outline" size={48} color={C.textSecondary} />
          <Text style={[styles.errorText, { color: C.text }]}>{error}</Text>
          <TouchableOpacity
            style={[styles.retryButton, { backgroundColor: C.primary }]}
            onPress={() => loadPosts(1, true)}
          >
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: C.background }]} edges={['top']}>
      <StatusBar barStyle="light-content" />

      {/* Grid View */}
      <FlatList
        data={posts}
        renderItem={({ item, index }) => (
          <TouchableOpacity
            style={styles.gridCard}
            onPress={() => handlePostPress(index)}
            activeOpacity={0.8}
          >
            <PostCard item={item} index={index} />
          </TouchableOpacity>
        )}
        keyExtractor={(item) => item.id}
        numColumns={3}
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={styles.gridContainer}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={C.primary}
            colors={[C.primary]}
          />
        }
        onEndReached={loadMorePosts}
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          loadingMore ? (
            <View style={styles.footerLoader}>
              <ActivityIndicator size="small" color={C.primary} />
            </View>
          ) : null
        }
        ListEmptyComponent={
          !loading ? (
            <View style={styles.emptyContainer}>
              <MaterialIcons name="video-library" size={64} color={C.textSecondary} />
              <Text style={[styles.emptyText, { color: C.textSecondary }]}>
                No posts in this challenge yet
              </Text>
            </View>
          ) : null
        }
      />

      {/* Fullscreen Viewer Modal */}
      <Modal
        visible={showFullscreen}
        animationType="fade"
        transparent={false}
        onRequestClose={() => setShowFullscreen(false)}
      >
        <SafeAreaView style={[styles.fullscreenContainer, { backgroundColor: C.background }]} edges={['top']}>
          <View style={styles.fullscreenHeader}>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => setShowFullscreen(false)}
            >
              <Feather name="x" size={28} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.positionText}>
              {fullscreenIndex + 1} / {posts.length}
            </Text>
          </View>

          <FlatList
            ref={fullscreenListRef}
            data={posts}
            renderItem={({ item, index }) => {
              const mediaUrl = getPostMediaUrl(item);
              const cachedUrl = getCachedUri(mediaUrl);
              return (
                <FullscreenPostViewer item={item} index={index} cachedMediaUrl={cachedUrl} />
              );
            }}
            keyExtractor={(item) => item.id}
            pagingEnabled
            scrollEventThrottle={16}
            showsVerticalScrollIndicator={true}
            onMomentumScrollEnd={(event) => {
              const index = Math.round(
                event.nativeEvent.contentOffset.y /
                event.nativeEvent.layoutMeasurement.height
              );
              setFullscreenIndex(index);
            }}
          />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorText: {
    fontSize: 16,
    marginTop: 16,
    marginBottom: 24,
    textAlign: 'center',
  },
  retryButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },

  // Grid Styles
  gridContainer: {
    padding: 8,
  },
  gridRow: {
    justifyContent: 'space-between',
  },
  gridCard: {
    width: (SCREEN_WIDTH - 24) / 3,
    marginHorizontal: 4,
    marginBottom: 8,
  },
  postCard: {
    aspectRatio: 1,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#1a1a1a',
  },
  postMedia: {
    width: '100%',
    height: '100%',
  },
  noMediaPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
  },
  teaserVideo: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  postOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    padding: 6,
    flexDirection: 'row',
  },
  postStats: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 4,
  },
  postStatText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  playIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  playingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#60a5fa',
  },
  footerLoader: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 16,
    marginTop: 16,
  },

  // Fullscreen Styles
  fullscreenContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  fullscreenHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  positionText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  fullscreenPostContainer: {
    width: SCREEN_WIDTH,
    height: Dimensions.get('window').height - 80, // Full height minus header
    backgroundColor: '#000',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
  },
  mediaContainer: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: '#000',
  },
  videoTouchable: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullscreenMedia: {
    width: '100%',
    height: '100%',
  },
  muteIndicatorOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    pointerEvents: 'none',
  },
  muteIndicatorBadge: {
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 40,
    padding: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  postInfoScroll: {
    flex: 1,
    backgroundColor: '#000',
  },
  postInfo: {
    padding: 16,
    gap: 12,
  },
  userSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  userDetails: {
    flex: 1,
  },
  username: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  displayName: {
    color: '#9ca3af',
    fontSize: 13,
  },
  postTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  postDescription: {
    color: '#e5e7eb',
    fontSize: 14,
    lineHeight: 20,
  },
  postCaption: {
    color: '#d1d5db',
    fontSize: 13,
    lineHeight: 18,
  },
  postTimestamp: {
    color: '#9ca3af',
    fontSize: 12,
    marginTop: 4,
  },
  postStatsRow: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 8,
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statText: {
    color: '#e5e7eb',
    fontSize: 12,
    fontWeight: '500',
  },

  // Added Styles for FullscreenPostViewer
  fullscreenOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 200,
  },
  fullscreenContent: {
    position: 'absolute',
    bottom: 20,
    left: 0,
    right: 0,
    padding: 16,
  },
  postHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  postAvatar: {
    marginRight: 10,
  },
  headerText: {
    justifyContent: 'center',
  },
  location: {
    color: '#ccc',
    fontSize: 12,
  },
  caption: {
    color: '#fff',
    fontSize: 14,
    marginBottom: 8,
    lineHeight: 20,
  },
  timeAgo: {
    color: '#9ca3af',
    fontSize: 12,
    marginTop: 4,
  },

  progressBarContainerFullscreen: {
    height: 4,
    paddingHorizontal: 0,
    justifyContent: 'center',
  },
  progressBarTrack: {
    height: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    width: '100%',
    borderRadius: 2,
  },
  progressBarFill: {
    height: 4,
    borderRadius: 2,
  },
});
