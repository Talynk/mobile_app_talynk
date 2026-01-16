import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  TouchableOpacity,
  useWindowDimensions,
  StatusBar,
  RefreshControl,
  Dimensions,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Video, ResizeMode } from 'expo-av';
import { MaterialIcons, Feather } from '@expo/vector-icons';
import { challengesApi } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getPostMediaUrl } from '@/lib/utils/file-url';
import { Avatar } from '@/components/Avatar';
import { Post } from '@/types';

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
  const { id, initialPostId, initialIndex } = useLocalSearchParams();
  const { user } = useAuth();
  const { height: screenHeight, width: screenWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const C = COLORS.dark;
  
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  
  const flatListRef = useRef<FlatList>(null);
  const videoRefs = useRef<{ [key: string]: Video | null }>({});
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);

  // Scroll to initial post if provided
  useEffect(() => {
    if (initialPostId && posts.length > 0) {
      const index = parseInt(initialIndex || '0', 10);
      const foundIndex = posts.findIndex(p => p.id === initialPostId);
      const targetIndex = foundIndex >= 0 ? foundIndex : index;
      
      if (targetIndex >= 0 && targetIndex < posts.length) {
        setTimeout(() => {
          flatListRef.current?.scrollToIndex({
            index: targetIndex,
            animated: false,
            viewPosition: 0,
          });
          setCurrentIndex(targetIndex);
        }, 100);
      }
    }
  }, [posts, initialPostId, initialIndex]);

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
        const postsList = response.data?.posts || [];
        const normalizedPosts = postsList.map((item: any) => item.post || item);
        
        const pagination = response.data?.pagination || {};
        const hasMoreData = pagination.hasNextPage !== false && normalizedPosts.length === limit;
        setHasMore(hasMoreData);
        
        if (page === 1 || refresh) {
          setPosts(normalizedPosts);
        } else {
          setPosts(prev => [...prev, ...normalizedPosts]);
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

  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    if (viewableItems.length > 0) {
      const visibleItem = viewableItems[0];
      const newIndex = visibleItem.index || 0;
      const postId = visibleItem.item?.id;
      
      // Pause all videos except the active one
      Object.keys(videoRefs.current).forEach((key) => {
        if (key !== postId && videoRefs.current[key]) {
          videoRefs.current[key]?.pauseAsync();
        }
      });
      
      // Play the active video
      if (postId && videoRefs.current[postId]) {
        videoRefs.current[postId]?.playAsync();
        setActiveVideoId(postId);
      }
      
      setCurrentIndex(newIndex);
    }
  }).current;

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 50,
  }).current;

  const getMediaUrl = (post: Post) => {
    return getPostMediaUrl(post);
  };

  const handlePostPress = (postId: string) => {
    router.push({
      pathname: '/post/[id]',
      params: { id: postId }
    });
  };

  const renderPost = ({ item, index }: { item: Post; index: number }) => {
    const mediaUrl = getMediaUrl(item);
    const isVideo = !!(item.video_url || item.type === 'video');
    const isActive = index === currentIndex;
    
    return (
      <TouchableOpacity
        style={[styles.postContainer, { height: screenHeight - insets.top - insets.bottom }]}
        activeOpacity={1}
        onPress={() => handlePostPress(item.id)}
      >
        {/* Post Media */}
        <View style={styles.mediaContainer}>
          {isVideo ? (
            <Video
              ref={(ref) => {
                if (ref) {
                  videoRefs.current[item.id] = ref;
                }
              }}
              source={{ uri: mediaUrl || '' }}
              style={styles.video}
              resizeMode={ResizeMode.COVER}
              shouldPlay={isActive}
              isLooping
              isMuted={false}
              useNativeControls={false}
            />
          ) : (
            <View style={styles.imageContainer}>
              {/* Image posts can be displayed here if needed */}
              <Text style={styles.placeholderText}>Image Post</Text>
            </View>
          )}
        </View>
        
        {/* Post Info Overlay */}
        <View style={styles.overlay}>
          <View style={styles.header}>
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => router.back()}
            >
              <MaterialIcons name="arrow-back" size={24} color="#fff" />
            </TouchableOpacity>
            <View style={styles.headerInfo}>
              {item.user && (
                <>
                  <Avatar
                    user={item.user}
                    size={32}
                    style={styles.avatar}
                  />
                  <View style={styles.userInfo}>
                    <Text style={styles.username}>
                      {item.user.username || item.user.display_name}
                    </Text>
                    {item.user.display_name && item.user.display_name !== item.user.username && (
                      <Text style={styles.displayName}>
                        {item.user.display_name}
                      </Text>
                    )}
                  </View>
                </>
              )}
            </View>
          </View>
          
          <View style={styles.footer}>
            <View style={styles.postInfo}>
              <Text style={styles.postTitle} numberOfLines={2}>
                {item.title || item.description || 'Untitled'}
              </Text>
              {item.caption && (
                <Text style={styles.postCaption} numberOfLines={3}>
                  {item.caption}
                </Text>
              )}
            </View>
            
            <View style={styles.stats}>
              <View style={styles.statItem}>
                <Feather name="heart" size={18} color="#fff" />
                <Text style={styles.statText}>
                  {item.likes || item._count?.postLikes || 0}
                </Text>
              </View>
              <View style={styles.statItem}>
                <Feather name="message-circle" size={18} color="#fff" />
                <Text style={styles.statText}>
                  {item.comments_count || item._count?.comments || 0}
                </Text>
              </View>
              <View style={styles.statItem}>
                <Feather name="eye" size={18} color="#fff" />
                <Text style={styles.statText}>
                  {item.views || item._count?.postViews || 0}
                </Text>
              </View>
            </View>
          </View>
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
      <FlatList
        ref={flatListRef}
        data={posts}
        renderItem={renderPost}
        keyExtractor={(item) => item.id}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        onEndReached={loadMorePosts}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={C.primary}
            colors={[C.primary]}
          />
        }
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
              <Text style={[styles.emptyText, { color: C.textSecondary }]}>No posts in this challenge yet</Text>
            </View>
          ) : null
        }
        onScrollToIndexFailed={(info) => {
          // Handle scroll to index failure
          const wait = new Promise(resolve => setTimeout(resolve, 500));
          wait.then(() => {
            flatListRef.current?.scrollToIndex({ index: info.index, animated: false });
          });
        }}
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
  postContainer: {
    width: SCREEN_WIDTH,
  },
  mediaContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  video: {
    width: '100%',
    height: '100%',
  },
  imageContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
  },
  placeholderText: {
    fontSize: 16,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  headerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginRight: 12,
  },
  userInfo: {
    flex: 1,
  },
  username: {
    fontSize: 16,
    fontWeight: '600',
  },
  displayName: {
    fontSize: 14,
  },
  footer: {
    padding: 16,
    paddingBottom: 32,
  },
  postInfo: {
    marginBottom: 16,
  },
  postTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  postCaption: {
    fontSize: 14,
    lineHeight: 20,
  },
  stats: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 24,
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statText: {
    fontSize: 14,
    fontWeight: '600',
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
});
