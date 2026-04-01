import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
  useWindowDimensions,
  StatusBar,
  Share,
  Animated,
  Alert,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { likesApi, followsApi } from '@/lib/api';
import { Post } from '@/types';
import { useAuth } from '@/lib/auth-context';
import { useCache } from '@/lib/cache-context';
import { useAppDispatch, useAppSelector } from '@/lib/store/hooks';
import { setPostLikeCounts, addLikedPost, removeLikedPost, setPostLikeCount } from '@/lib/store/slices/likesSlice';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFeedQuery } from '@/lib/hooks/use-feed-query';
import { queryClient } from '@/lib/query-client';
import ReportModal from '@/components/ReportModal';
import CommentsModal from '@/components/CommentsModal';
import ChallengesList from '@/components/ChallengesList';
import CreateChallengeModal from '@/components/CreateChallengeModal';

import { getPostMediaUrl } from '@/lib/utils/file-url';
import { sharePost } from '@/lib/post-share';
import FullscreenFeedPostItem from '@/components/FullscreenFeedPostItem';
import { useCreateFocus } from '@/lib/create-focus-context';
import { useNetworkStatus } from '@/lib/hooks/use-network-status';
import {
  shouldPreloadFeedVideo,
  VIDEO_FEED_INITIAL_NUM_TO_RENDER,
  VIDEO_FEED_MAX_TO_RENDER_PER_BATCH,
  VIDEO_FEED_REMOVE_CLIPPED_SUBVIEWS,
  VIDEO_FEED_WINDOW_SIZE,
} from '@/lib/utils/video-feed';

const FEED_TABS = [
  { key: 'foryou', label: 'For You' },
  { key: 'following', label: 'Following' },
  { key: 'challenges', label: 'Competitions' },
];

type FeedTab = 'foryou' | 'following' | 'challenges';

export default function FeedScreen() {
  const [activeTab, setActiveTab] = useState<FeedTab>('foryou');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isScreenFocused, setIsScreenFocused] = useState(true);
  const lastActiveIndexRef = useRef(0);
  const currentIndexRef = useRef(0);
  const [reportModalVisible, setReportModalVisible] = useState(false);
  const [reportPostId, setReportPostId] = useState<string | null>(null);
  const [commentsModalVisible, setCommentsModalVisible] = useState(false);
  const [commentsPostId, setCommentsPostId] = useState<string | null>(null);
  const [commentsPostTitle, setCommentsPostTitle] = useState('');
  const [commentsPostAuthor, setCommentsPostAuthor] = useState('');
  const [commentsPostOwnerId, setCommentsPostOwnerId] = useState<string | undefined>(undefined);
  const [createChallengeVisible, setCreateChallengeVisible] = useState(false);
  const [challengesRefreshTrigger, setChallengesRefreshTrigger] = useState(0);
  const [challengeDefaultTab, setChallengeDefaultTab] = useState<'active' | 'upcoming' | 'ended' | 'created' | undefined>(undefined);
  const flatListRef = useRef<FlatList<Post>>(null);
  const { user } = useAuth();
  const { isCreateFocused } = useCreateFocus();
  const { isOffline } = useNetworkStatus();
  const { followedUsers, updateFollowedUsers } = useCache();
  const dispatch = useAppDispatch();
  const likedPosts = useAppSelector(state => state.likes.likedPosts);
  const postLikeCounts = useAppSelector(state => state.likes.postLikeCounts);
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();

  const feedTab = activeTab === 'challenges' ? 'foryou' : activeTab as 'foryou' | 'following';
  const {
    posts,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    refetch,
    isRefetching,
  } = useFeedQuery(feedTab);

  const headerTabsHeight = 44;
  const headerPaddingVertical = 12;
  const headerHeight = insets.top + headerTabsHeight + headerPaddingVertical;
  const availableHeight = screenHeight - headerHeight;

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
      };
    }, [])
  );

  // Keep currentIndexRef in sync
  currentIndexRef.current = currentIndex;

  const updateLikeInCache = useCallback((postId: string, isLiked: boolean, likeCount: number) => {
    queryClient.setQueriesData({ queryKey: ['feed'] }, (old: any) => {
      if (!old?.pages) return old;
      return {
        ...old,
        pages: old.pages.map((page: any) => ({
          ...page,
          posts: page.posts.map((p: any) =>
            p.id === postId ? { ...p, is_liked: isLiked, like_count: likeCount, likes: likeCount } : p
          ),
        })),
      };
    });
  }, [queryClient]);

  const handleLike = useCallback(async (postId: string) => {
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

    const currentIsLiked = likedPosts.includes(postId);
    const post = posts.find(p => p.id === postId);
    const currentCount = postLikeCounts[postId] ?? post?.like_count ?? post?.likes ?? 0;
    const newIsLiked = !currentIsLiked;
    const newCount = newIsLiked ? currentCount + 1 : Math.max(0, currentCount - 1);

    // Optimistic: Redux + React Query cache
    if (newIsLiked) dispatch(addLikedPost(postId));
    else dispatch(removeLikedPost(postId));
    dispatch(setPostLikeCount({ postId, count: newCount }));
    updateLikeInCache(postId, newIsLiked, newCount);

    try {
      const response = await likesApi.toggle(postId);
      if (response.status === 'success' && response.data) {
        const serverLiked = response.data.isLiked;
        const serverCount = response.data.likeCount;
        if (serverLiked) dispatch(addLikedPost(postId));
        else dispatch(removeLikedPost(postId));
        dispatch(setPostLikeCount({ postId, count: serverCount }));
        updateLikeInCache(postId, serverLiked, serverCount);
      }
    } catch {
      // Revert on failure
      if (currentIsLiked) dispatch(addLikedPost(postId));
      else dispatch(removeLikedPost(postId));
      dispatch(setPostLikeCount({ postId, count: currentCount }));
      updateLikeInCache(postId, currentIsLiked, currentCount);
    }
  }, [user, likedPosts, posts, postLikeCounts, dispatch, updateLikeInCache]);

  const updateFollowInCache = useCallback((userId: string, isFollowing: boolean) => {
    queryClient.setQueriesData({ queryKey: ['feed'] }, (old: any) => {
      if (!old?.pages) return old;
      return {
        ...old,
        pages: old.pages.map((page: any) => ({
          ...page,
          posts: page.posts.map((p: any) =>
            p.user?.id === userId ? { ...p, is_following_author: isFollowing } : p
          ),
        })),
      };
    });
  }, [queryClient]);

  const handleFollow = useCallback(async (userId: string) => {
    if (!user) return;
    updateFollowInCache(userId, true);
    updateFollowedUsers(userId, true);
    try {
      const res = await followsApi.follow(userId);
      if (res.status !== 'success') {
        updateFollowInCache(userId, false);
        updateFollowedUsers(userId, false);
      }
    } catch {
      updateFollowInCache(userId, false);
      updateFollowedUsers(userId, false);
    }
  }, [user, updateFollowInCache, updateFollowedUsers]);

  const handleUnfollow = useCallback(async (userId: string) => {
    if (!user) return;
    updateFollowInCache(userId, false);
    updateFollowedUsers(userId, false);
    try {
      const res = await followsApi.unfollow(userId);
      if (res.status !== 'success') {
        updateFollowInCache(userId, true);
        updateFollowedUsers(userId, true);
      }
    } catch {
      updateFollowInCache(userId, true);
      updateFollowedUsers(userId, true);
    }
  }, [user, updateFollowInCache, updateFollowedUsers]);

  const handleComment = useCallback((postId: string) => {
    if (!postId) return;
    const post = posts.find(p => p.id === postId);
    setCommentsPostId(postId);
    setCommentsPostTitle(post?.title || post?.description || '');
    setCommentsPostAuthor(post?.user?.username || '');
    setCommentsPostOwnerId(post?.user?.id);
    setCommentsModalVisible(true);
  }, [posts]);

  const handleCommentAdded = useCallback(() => {}, []);
  const handleCommentDeleted = useCallback(() => {}, []);

  const handleShare = useCallback(async (postId: string) => {
    const post = posts.find(p => p.id === postId);
    if (post) {
      try {
        await sharePost(post);
      } catch {}
    }
  }, [posts]);

  const handleReport = useCallback((postId: string) => {
    if (!user) {
      router.push({ pathname: '/auth/login' as any });
      return;
    }
    setReportPostId(postId);
    setReportModalVisible(true);
  }, [user]);

  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    if (viewableItems.length > 0) {
      const mostVisible = viewableItems.reduce((best: any, item: any) =>
        item.isViewable && (!best || (item.percentVisible ?? 0) > (best.percentVisible ?? 0)) ? item : best
      , null as any);

      const idx = mostVisible?.index ?? viewableItems[0]?.index ?? 0;
      setCurrentIndex(idx);
      lastActiveIndexRef.current = idx;
    } else {
      setCurrentIndex(-1);
    }
  }).current;

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 60,
    minimumViewTime: 200,
    waitForInteraction: false,
  }).current;

  const onEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const shimmerAnim = useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(shimmerAnim, { toValue: 0, duration: 800, useNativeDriver: true }),
      ])
    ).start();
  }, [shimmerAnim]);
  const shimmerOpacity = shimmerAnim.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.7] });

  const renderItem = useCallback(({ item, index }: { item: Post; index: number }) => {
    const isActive = isScreenFocused && currentIndex === index;
    const shouldPreload = shouldPreloadFeedVideo(index, currentIndex, { disabled: isCreateFocused || isActive });

    const isLiked = item.is_liked ?? likedPosts.includes(item.id);
    const isFollowing = item.is_following_author ?? followedUsers.has(item.user?.id || '');

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
        isLiked={isLiked}
        isFollowing={isFollowing}
        isActive={isActive}
        shouldPreload={shouldPreload}
        availableHeight={availableHeight}
      />
    );
  }, [isScreenFocused, currentIndex, isCreateFocused, likedPosts, followedUsers, handleLike, handleComment, handleShare, handleReport, handleFollow, handleUnfollow, availableHeight]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      <View style={styles.header}>
        <View style={styles.tabsContainer}>
          {FEED_TABS.map((tab) => (
            <TouchableOpacity
              key={tab.key}
              style={[styles.tab, activeTab === tab.key && styles.tabActive]}
              onPress={() => setActiveTab(tab.key as FeedTab)}
            >
              <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>
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
            defaultTab={challengeDefaultTab}
          />
          <CreateChallengeModal
            visible={createChallengeVisible}
            onClose={() => setCreateChallengeVisible(false)}
            onCreated={() => {
              setChallengeDefaultTab('created');
              setChallengesRefreshTrigger(prev => prev + 1);
            }}
          />
        </>
      ) : (
        <>
          {isLoading && posts.length === 0 ? (
            <View style={styles.loadingContainer}>
              {[1, 2, 3].map((i) => (
                <View key={i} style={[styles.skeletonItem, { height: availableHeight }]}>
                  <Animated.View style={[styles.skeletonMedia, { opacity: shimmerOpacity }]} />
                  <View style={styles.skeletonActions}>
                    <Animated.View style={[styles.skeletonAvatar, { opacity: shimmerOpacity }]} />
                    <Animated.View style={[styles.skeletonActionButton, { opacity: shimmerOpacity }]} />
                    <Animated.View style={[styles.skeletonActionButton, { opacity: shimmerOpacity }]} />
                    <Animated.View style={[styles.skeletonActionButton, { opacity: shimmerOpacity }]} />
                  </View>
                  <View style={styles.skeletonBottomInfo}>
                    <Animated.View style={[styles.skeletonUsername, { opacity: shimmerOpacity }]} />
                    <Animated.View style={[styles.skeletonCaption, { opacity: shimmerOpacity }]} />
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <FlatList
              ref={flatListRef}
              data={posts}
             
              renderItem={renderItem}
              keyExtractor={(item) => item.id}
              getItemLayout={(_data, index) => ({
                length: availableHeight,
                offset: availableHeight * index,
                index,
              })}
              pagingEnabled={true}
              snapToAlignment="start"
              decelerationRate="fast"
              showsVerticalScrollIndicator={false}
              windowSize={VIDEO_FEED_WINDOW_SIZE}
              maxToRenderPerBatch={VIDEO_FEED_MAX_TO_RENDER_PER_BATCH}
              initialNumToRender={VIDEO_FEED_INITIAL_NUM_TO_RENDER}
              removeClippedSubviews={VIDEO_FEED_REMOVE_CLIPPED_SUBVIEWS}
              scrollEventThrottle={16}
              scrollEnabled={true}
              bounces={false}
              refreshControl={
                <RefreshControl
                  refreshing={isRefetching}
                  onRefresh={() => refetch()}
                  tintColor="#60a5fa"
                />
              }
              onEndReached={onEndReached}
              onEndReachedThreshold={0.5}
              ListFooterComponent={
                isFetchingNextPage ? (
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
                  <Feather name={activeTab === 'following' ? "user-plus" : "video"} size={64} color="#666" />
                  <Text style={styles.emptyText}>
                    {isOffline
                      ? 'No internet connection'
                      : activeTab === 'following' && !user
                        ? 'Sign in to see posts from people you follow'
                        : activeTab === 'following'
                          ? 'No posts here yet'
                          : 'No posts available'}
                  </Text>
                  <Text style={styles.emptySubtext}>
                    {isOffline
                      ? 'Please reconnect to load posts.'
                      : activeTab === 'following' && !user
                        ? 'Sign in to see posts from people you follow'
                        : activeTab === 'following'
                          ? 'Follow people to see their posts here'
                          : 'Pull down to refresh or check back later'}
                  </Text>
                  {activeTab === 'following' && !user && !isOffline && (
                    <TouchableOpacity
                      style={styles.emptyLoginButton}
                      onPress={() => router.push('/auth/login' as any)}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.emptyLoginButtonText}>Log in / Sign up</Text>
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
          setTimeout(() => setCommentsPostId(null), 300);
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

const FEED_BG = '#1a1a1a';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: FEED_BG,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: FEED_BG,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 6,
    backgroundColor: 'rgba(0,0,0,0.95)',
    zIndex: 100,
    height: 56,
  },
  tabsContainer: {
    flexDirection: 'row',
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
  emptyLoginButton: {
    marginTop: 24,
    backgroundColor: '#60a5fa',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
  },
  emptyLoginButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
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
