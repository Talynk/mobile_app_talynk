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
  FlatList,
  Share,
  Alert,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { MaterialIcons, Feather } from '@expo/vector-icons';
import { challengesApi, followsApi, likesApi } from '@/lib/api';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Post } from '@/types';
import { getThumbnailUrl, getFileUrl, getPostMediaUrl } from '@/lib/utils/file-url';
import { filterHlsReady } from '@/lib/utils/post-filter';
import FullscreenFeedPostItem from '@/components/FullscreenFeedPostItem';
import ReportModal from '@/components/ReportModal';
import CommentsModal from '@/components/CommentsModal';
import { useAuth } from '@/lib/auth-context';
import { useCache } from '@/lib/cache-context';
import { useAppDispatch, useAppSelector } from '@/lib/store/hooks';
import { setPostLikeCounts } from '@/lib/store/slices/likesSlice';
import { useLikesManager } from '@/lib/hooks/use-likes-manager';

const INITIAL_LIMIT = 20;
const LOAD_MORE_LIMIT = 10;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const FULLSCREEN_HEADER = 80;
const FULLSCREEN_AVAILABLE_HEIGHT = SCREEN_HEIGHT - FULLSCREEN_HEADER;

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

  const [fullscreenIndex, setFullscreenIndex] = useState(0);
  const [showFullscreen, setShowFullscreen] = useState(false);
  const fullscreenListRef = useRef<FlatList>(null);
  const [reportModalVisible, setReportModalVisible] = useState(false);
  const [reportPostId, setReportPostId] = useState<string | null>(null);
  const [commentsModalVisible, setCommentsModalVisible] = useState(false);
  const [commentsPostId, setCommentsPostId] = useState<string | null>(null);
  const [userFollowStatus, setUserFollowStatus] = useState<Record<string, boolean>>({});
  const { user } = useAuth();
  const { followedUsers, updateFollowedUsers } = useCache();
  const dispatch = useAppDispatch();
  const likesManager = useLikesManager();

  const fullscreenViewableHandler = useRef(({ viewableItems }: any) => {
    if (!viewableItems || viewableItems.length === 0) return;
    const mostVisible = viewableItems.reduce((best: any, item: any) =>
      item.isViewable && (!best || (item.percentVisible ?? 0) > (best.percentVisible ?? 0)) ? item : best
    , null as any);
    const idx = mostVisible?.index ?? viewableItems[0]?.index;
    if (idx !== undefined && idx !== null) setFullscreenIndex(idx);
  }).current;

  const fullscreenViewabilityConfig = useRef({
    itemVisiblePercentThreshold: 60,
    minimumViewTime: 100,
  }).current;

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

  const handleLike = async (postId: string) => {
    if (!user) {
      Alert.alert('Login Required', 'Please log in to like posts.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Log In', onPress: () => router.push('/auth/login' as any) },
      ]);
      return;
    }
    await likesManager.toggleLike(postId);
    const newCount = likesManager.getLikeCount(postId);
    setPosts(prev => prev.map(p => (p.id === postId ? { ...p, likes: newCount } : p)));
  };

  const handleComment = (postId: string) => {
    const post = posts.find(p => p.id === postId);
    setCommentsPostId(postId);
    setCommentsModalVisible(true);
  };

  const handleShare = async (postId: string) => {
    const post = posts.find(p => p.id === postId);
    if (post) {
      try {
        const url = getPostMediaUrl(post) || (post as any).fullUrl || '';
        await Share.share({ message: url || post.caption || 'Check this out!', title: 'Talentix', url: url || undefined });
      } catch (_) {}
    }
  };

  const handleReport = (postId: string) => {
    if (!user) {
      router.push('/auth/login' as any);
      return;
    }
    setReportPostId(postId);
    setReportModalVisible(true);
  };

  const handleFollow = async (targetUserId: string) => {
    if (!user) return;
    updateFollowedUsers(targetUserId, true);
    setUserFollowStatus(prev => ({ ...prev, [targetUserId]: true }));
    try {
      const res = await followsApi.follow(targetUserId);
      if (res.status !== 'success') {
        updateFollowedUsers(targetUserId, false);
        setUserFollowStatus(prev => ({ ...prev, [targetUserId]: false }));
      }
    } catch {
      updateFollowedUsers(targetUserId, false);
      setUserFollowStatus(prev => ({ ...prev, [targetUserId]: false }));
    }
  };

  const handleUnfollow = async (targetUserId: string) => {
    if (!user) return;
    updateFollowedUsers(targetUserId, false);
    setUserFollowStatus(prev => ({ ...prev, [targetUserId]: false }));
    try {
      const res = await followsApi.unfollow(targetUserId);
      if (res.status !== 'success') {
        updateFollowedUsers(targetUserId, true);
        setUserFollowStatus(prev => ({ ...prev, [targetUserId]: true }));
      }
    } catch {
      updateFollowedUsers(targetUserId, true);
      setUserFollowStatus(prev => ({ ...prev, [targetUserId]: true }));
    }
  };

  const likedPosts = useAppSelector(state => state.likes.likedPosts);

  // PostCard component for grid display — STATIC ONLY, no video playback
  const PostCard = ({ item, index }: { item: Post; index: number }) => {
    const isVideo = item.type === 'video' || !!(item.video_url);

    // THUMBNAIL PRIORITY: server thumbnail_url > fallback image > placeholder
    const serverThumbnail = getThumbnailUrl(item);
    const fallbackImageUrl = getFileUrl((item as any).image || (item as any).thumbnail || '');
    const thumbnailUrl = serverThumbnail || fallbackImageUrl;

    return (
      <TouchableOpacity
        style={styles.postCard}
        activeOpacity={0.9}
        onPress={() => handlePostPress(index)}
      >
        {thumbnailUrl ? (
          <Image
            source={{ uri: thumbnailUrl }}
            style={styles.postMedia}
            resizeMode="cover"
          />
        ) : (
          <View style={[styles.postMedia, styles.noMediaPlaceholder]}>
            <MaterialIcons name={isVideo ? "video-library" : "image"} size={28} color="#444" />
          </View>
        )}

        <View style={styles.postOverlay}>
          <View style={styles.postStats}>
            <Feather name="heart" size={14} color="#fff" />
            <Text style={styles.postStatText}>{item.likes || 0}</Text>
          </View>
          {isVideo && (
            <View style={styles.playIcon}>
              <Feather name="play" size={16} color="#fff" />
            </View>
          )}
        </View>
      </TouchableOpacity>
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
              const isActive = fullscreenIndex === index;
              const shouldPreload = !isActive && Math.abs(index - fullscreenIndex) === 1;
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
                  isLiked={item.is_liked ?? likedPosts.includes(item.id)}
                  isFollowing={item.is_following_author ?? userFollowStatus[item.user?.id || ''] ?? followedUsers.has(item.user?.id || '')}
                  isActive={isActive}
                  shouldPreload={shouldPreload}
                  availableHeight={FULLSCREEN_AVAILABLE_HEIGHT}
                />
              );
            }}
            keyExtractor={(item) => item.id}
            pagingEnabled
            snapToInterval={FULLSCREEN_AVAILABLE_HEIGHT}
            snapToAlignment="start"
            decelerationRate="fast"
            scrollEventThrottle={16}
            showsVerticalScrollIndicator={false}
            onViewableItemsChanged={fullscreenViewableHandler}
            viewabilityConfig={fullscreenViewabilityConfig}
            getItemLayout={(_, index) => ({
              length: FULLSCREEN_AVAILABLE_HEIGHT,
              offset: FULLSCREEN_AVAILABLE_HEIGHT * index,
              index,
            })}
          />
        </SafeAreaView>
      </Modal>

      <ReportModal
        isVisible={reportModalVisible}
        postId={reportPostId}
        onClose={() => { setReportModalVisible(false); setReportPostId(null); }}
        onReported={() => { setReportModalVisible(false); setReportPostId(null); }}
      />
      <CommentsModal
        visible={commentsModalVisible}
        postId={commentsPostId}
        onClose={() => { setCommentsModalVisible(false); setCommentsPostId(null); }}
      />
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
    backgroundColor: '#1a1a1a',
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
    backgroundColor: '#1a1a1a',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
  },
  mediaContainer: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: '#1a1a1a',
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
  postInfoScroll: {
    flex: 1,
    backgroundColor: '#1a1a1a',
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
