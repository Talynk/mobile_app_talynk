import React, { useState, useRef, useCallback, useMemo } from 'react';
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
  useWindowDimensions,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { MaterialIcons, Feather } from '@expo/vector-icons';
import { postsApi, categoriesApi, followsApi, likesApi } from '@/lib/api';
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
import { useCreateFocus } from '@/lib/create-focus-context';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  shouldPreloadFeedVideo,
  VIDEO_FEED_INITIAL_NUM_TO_RENDER,
  VIDEO_FEED_MAX_TO_RENDER_PER_BATCH,
  VIDEO_FEED_REMOVE_CLIPPED_SUBVIEWS,
  VIDEO_FEED_WINDOW_SIZE,
} from '@/lib/utils/video-feed';
import { primePostDetailsCache } from '@/lib/post-details-cache';

const POSTS_PER_PAGE = 20;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const FULLSCREEN_HEADER_PX = 64;

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

export default function CategoryScreen() {
  const { name } = useLocalSearchParams();
  const categoryName = Array.isArray(name) ? name[0] : (name as string);
  const C = COLORS.dark;
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const fullscreenAvailableHeight = windowHeight - insets.top - FULLSCREEN_HEADER_PX;

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
  const likedPosts = useAppSelector(state => state.likes.likedPosts);
  const { isCreateFocused } = useCreateFocus();
  const queryClient = useQueryClient();

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

  // Cache categories globally — shared across all category screens, long TTL
  const { data: categoriesData, isLoading: categoryLoading } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const res = await categoriesApi.getAll();
      return res.status === 'success' ? (res.data?.categories || []) : [];
    },
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
  });

  const categoryId = useMemo(() => {
    if (!categoriesData || !categoryName) return null;
    const match = categoriesData.find(
      (c: any) => c.name?.toLowerCase() === categoryName.toLowerCase()
    );
    return match?.id ?? null;
  }, [categoriesData, categoryName]);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading: postsLoading,
    isRefetching,
    refetch,
    isError,
  } = useInfiniteQuery({
    queryKey: ['categoryPosts', categoryId],
    enabled: categoryId !== null,
    queryFn: async ({ pageParam = 1 }) => {
      const res = await postsApi.getByCategory(categoryId!, pageParam as number, POSTS_PER_PAGE);
      if (res.status !== 'success') throw new Error(res.message);
      const rawPosts = res.data?.posts || [];
      primePostDetailsCache(rawPosts);
      const posts = filterHlsReady(rawPosts) as Post[];
      const pagination = res.data?.pagination || {};
      const hasNext = pagination.hasNextPage !== false && rawPosts.length === POSTS_PER_PAGE;
      return { posts, nextPage: hasNext ? (pageParam as number) + 1 : undefined };
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.nextPage,
    staleTime: 30_000,
  });

  const posts = data?.pages.flatMap((p) => p.posts) ?? [];
  const loading = categoryLoading || postsLoading;

  const handlePostPress = useCallback((index: number) => {
    setFullscreenIndex(index);
    setShowFullscreen(true);
    setTimeout(() => {
      fullscreenListRef.current?.scrollToIndex({ index, animated: false });
    }, 100);
  }, []);

  const handleLike = useCallback(async (postId: string) => {
    if (!user) {
      Alert.alert('Login Required', 'Please log in to like posts.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Log In', onPress: () => router.push('/auth/login' as any) },
      ]);
      return;
    }
    await likesManager.toggleLike(postId);
  }, [user, likesManager]);

  const handleComment = useCallback((postId: string) => {
    setCommentsPostId(postId);
    setCommentsModalVisible(true);
  }, []);

  const handleShare = useCallback(async (postId: string) => {
    const post = posts.find(p => p.id === postId);
    if (post) {
      try {
        const url = getPostMediaUrl(post) || (post as any).fullUrl || '';
        await Share.share({ message: url || post.caption || 'Check this out!', title: 'Talynk', url: url || undefined });
      } catch {}
    }
  }, [posts]);

  const handleReport = useCallback((postId: string) => {
    if (!user) { router.push('/auth/login' as any); return; }
    setReportPostId(postId);
    setReportModalVisible(true);
  }, [user]);

  const handleFollow = useCallback(async (targetUserId: string) => {
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
  }, [user, updateFollowedUsers]);

  const handleUnfollow = useCallback(async (targetUserId: string) => {
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
  }, [user, updateFollowedUsers]);

  const PostCard = useCallback(({ item, index }: { item: Post; index: number }) => {
    const isVideo = item.type === 'video' || !!(item.video_url);
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
          <Image source={{ uri: thumbnailUrl }} style={styles.postMedia} resizeMode="cover" />
        ) : (
          <View style={[styles.postMedia, styles.noMediaPlaceholder]}>
            <MaterialIcons name={isVideo ? 'video-library' : 'image'} size={28} color="#444" />
          </View>
        )}
        <View style={styles.postOverlay}>
          <View style={styles.postStats}>
            <Feather name="heart" size={14} color="#fff" />
            <Text style={styles.postStatText}>{item.likes || item.like_count || 0}</Text>
          </View>
          {isVideo && (
            <View style={styles.playIcon}>
              <Feather name="play" size={16} color="#fff" />
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  }, [handlePostPress]);

  if (loading && posts.length === 0) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: C.background }]} edges={['top']}>
        <View style={[styles.header, { paddingTop: insets.top > 0 ? 0 : 8 }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Feather name="arrow-left" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>#{categoryName}</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={C.primary} />
          <Text style={[styles.loadingText, { color: C.text }]}>Loading posts...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (isError && posts.length === 0) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: C.background }]} edges={['top']}>
        <View style={[styles.header, { paddingTop: insets.top > 0 ? 0 : 8 }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Feather name="arrow-left" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>#{categoryName}</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.errorContainer}>
          <MaterialIcons name="error-outline" size={48} color={C.textSecondary} />
          <Text style={[styles.errorText, { color: C.text }]}>Failed to load posts</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: C.background }]} edges={['top']}>
      <StatusBar barStyle="light-content" />

      <View style={[styles.header, { paddingTop: insets.top > 0 ? 0 : 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Feather name="arrow-left" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>#{categoryName}</Text>
        <View style={{ width: 40 }} />
      </View>

      <FlatList
        data={posts}
        renderItem={({ item, index }) => (
          <View style={styles.gridCard}>
            <PostCard item={item} index={index} />
          </View>
        )}
        keyExtractor={(item) => item.id}
        numColumns={3}
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={styles.gridContainer}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching && !isFetchingNextPage}
            onRefresh={() => refetch()}
            tintColor={C.primary}
            colors={[C.primary]}
          />
        }
        onEndReached={() => {
          if (hasNextPage && !isFetchingNextPage) fetchNextPage();
        }}
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          isFetchingNextPage ? (
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
                No posts in this category yet
              </Text>
            </View>
          ) : null
        }
      />

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
              const shouldPreload = shouldPreloadFeedVideo(index, fullscreenIndex, {
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
                  isLiked={item.is_liked ?? likedPosts.includes(item.id)}
                  isFollowing={item.is_following_author ?? userFollowStatus[item.user?.id || ''] ?? followedUsers.has(item.user?.id || '')}
                  isActive={isActive}
                  shouldPreload={shouldPreload}
                  availableHeight={fullscreenAvailableHeight}
                />
              );
            }}
            keyExtractor={(item) => item.id}
            pagingEnabled
            snapToInterval={fullscreenAvailableHeight}
            snapToAlignment="start"
            decelerationRate="fast"
            scrollEventThrottle={16}
            showsVerticalScrollIndicator={false}
            windowSize={VIDEO_FEED_WINDOW_SIZE}
            initialNumToRender={VIDEO_FEED_INITIAL_NUM_TO_RENDER}
            maxToRenderPerBatch={VIDEO_FEED_MAX_TO_RENDER_PER_BATCH}
            removeClippedSubviews={VIDEO_FEED_REMOVE_CLIPPED_SUBVIEWS}
            onViewableItemsChanged={fullscreenViewableHandler}
            viewabilityConfig={fullscreenViewabilityConfig}
            onMomentumScrollEnd={(event) => {
              if (hasNextPage && !isFetchingNextPage) {
                const idx = Math.round(event.nativeEvent.contentOffset.y / fullscreenAvailableHeight);
                if (posts.length - idx <= 3) fetchNextPage();
              }
            }}
            getItemLayout={(_, index) => ({
              length: fullscreenAvailableHeight,
              offset: fullscreenAvailableHeight * index,
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
        postId={commentsPostId || ''}
        onClose={() => { setCommentsModalVisible(false); setCommentsPostId(null); }}
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
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: '#000000',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
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
    aspectRatio: 9 / 16,
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
});
