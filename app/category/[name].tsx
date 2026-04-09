import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  RefreshControl,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { categoriesApi, postsApi } from '@/lib/api';
import { setExplorePostsCache } from '@/lib/explore-posts-cache';
import { primePostDetailsCache } from '@/lib/post-details-cache';
import { getCategoryDisplayName } from '@/lib/utils/category-display';
import { getFileUrl, getThumbnailUrl } from '@/lib/utils/file-url';
import { filterSecondarySurfacePosts } from '@/lib/utils/post-filter';
import { safeRouterBack } from '@/lib/utils/navigation';
import { normalizePost } from '@/lib/utils/normalize-post';
import { Post } from '@/types';

const POSTS_PER_PAGE = 24;
const { width: SCREEN_WIDTH } = Dimensions.get('window');

type CategoryTarget =
  | { id: number; mode: 'category'; name: string }
  | { id: number; mode: 'subcategory'; name: string };

function normalizeCategoryTagName(value?: string | null) {
  return String(value || '').trim().toLowerCase();
}

function dedupePostsById(items: Post[]) {
  const byId = new Map<string, Post>();

  items.forEach((post) => {
    if (!post?.id || byId.has(post.id)) {
      return;
    }

    byId.set(post.id, post);
  });

  return Array.from(byId.values());
}

const CategoryGridCard = React.memo(function CategoryGridCard({
  item,
  onPress,
}: {
  item: Post;
  onPress: (postId: string) => void;
}) {
  const isVideo = item.type === 'video' || !!item.video_url;
  const thumbnailUrl =
    getThumbnailUrl(item) ||
    getFileUrl((item as any).image || (item as any).thumbnail || '');

  return (
    <TouchableOpacity style={styles.postCard} activeOpacity={0.9} onPress={() => onPress(item.id)}>
      {thumbnailUrl ? (
        <ExpoImage
          source={{ uri: thumbnailUrl }}
          style={styles.postMedia}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={0}
        />
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
        {isVideo ? (
          <View style={styles.playIcon}>
            <Feather name="play" size={16} color="#fff" />
          </View>
        ) : null}
      </View>
    </TouchableOpacity>
  );
});

export default function CategoryScreen() {
  const { name } = useLocalSearchParams();
  const categoryName = Array.isArray(name) ? name[0] : (name as string);
  const categoryDisplayName = getCategoryDisplayName(categoryName);
  const insets = useSafeAreaInsets();
  const normalizedRequestedName = normalizeCategoryTagName(categoryName);

  const [posts, setPosts] = useState<Post[]>([]);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadVersionRef = useRef(0);

  const { data: categoriesData, isLoading: categoryLoading } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const response = await categoriesApi.getAll();
      return response.status === 'success' ? response.data?.categories || [] : [];
    },
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
  });

  const categoryTarget = useMemo(() => {
    if (!categoriesData || !categoryName) {
      return null;
    }

    for (const category of categoriesData) {
      const categoryRawName = category?.name;
      if (
        normalizeCategoryTagName(categoryRawName) === normalizedRequestedName ||
        normalizeCategoryTagName(getCategoryDisplayName(categoryRawName)) === normalizedRequestedName
      ) {
        return { id: category.id, mode: 'category', name: categoryRawName } satisfies CategoryTarget;
      }

      const children = Array.isArray(category?.children) ? category.children : [];
      const matchingChild = children.find((child: any) => {
        const childRawName = child?.name;
        return (
          normalizeCategoryTagName(childRawName) === normalizedRequestedName ||
          normalizeCategoryTagName(getCategoryDisplayName(childRawName)) === normalizedRequestedName
        );
      });

      if (matchingChild) {
        return { id: matchingChild.id, mode: 'subcategory', name: matchingChild.name } satisfies CategoryTarget;
      }
    }

    return null;
  }, [categoriesData, categoryName, normalizedRequestedName]);

  const loadCategoryPosts = useCallback(
    async (forceRefresh = false) => {
      if (!categoryTarget) {
        setPosts([]);
        setLoadingPosts(false);
        setRefreshing(false);
        return;
      }

      const loadVersion = ++loadVersionRef.current;
      const shouldShowLoader = forceRefresh || posts.length === 0;

      try {
        setError(null);
        if (shouldShowLoader) {
          setLoadingPosts(true);
        }

        const queryOptions =
          categoryTarget.mode === 'subcategory'
            ? { subcategory_id: categoryTarget.id, status: 'active' as const }
            : { category_id: categoryTarget.id, status: 'active' as const };

        const seen = new Set<string>();
        const mergedPosts: Post[] = [];
        let page = 1;
        let keepGoing = true;
        let firstBatchCommitted = false;

        while (keepGoing) {
          const response = await postsApi.getAll(page, POSTS_PER_PAGE, queryOptions);
          if (response.status !== 'success') {
            throw new Error(response.message || 'Failed to load posts');
          }

          const rawPosts = response.data?.posts || [];
          const normalizedPage = dedupePostsById(
            filterSecondarySurfacePosts(rawPosts.map((post: any) => normalizePost(post)))
          ).filter((post) => {
            if (!post?.id || seen.has(post.id)) {
              return false;
            }
            return true;
          });

          normalizedPage.forEach((post) => {
            seen.add(post.id);
            mergedPosts.push(post);
          });

          if (loadVersion !== loadVersionRef.current) {
            return;
          }

          if (normalizedPage.length > 0) {
            primePostDetailsCache(normalizedPage);
            void ExpoImage.prefetch(
              normalizedPage
                .map((post) => getThumbnailUrl(post) || getFileUrl((post as any).image || (post as any).thumbnail || ''))
                .filter((url): url is string => !!url),
              'memory-disk',
            ).catch(() => {});
            setPosts([...mergedPosts]);
          }

          if (!firstBatchCommitted) {
            firstBatchCommitted = true;
            setLoadingPosts(false);
          }

          const pagination = response.data?.pagination || {};
          const hasNextPage =
            pagination.hasNextPage === true ||
            pagination.hasNext === true ||
            rawPosts.length === POSTS_PER_PAGE;

          if (!hasNextPage) {
            keepGoing = false;
          } else {
            page += 1;
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
        }

        if (loadVersion === loadVersionRef.current && mergedPosts.length === 0) {
          setPosts([]);
        }
      } catch (err: any) {
        if (loadVersion === loadVersionRef.current) {
          setError(err?.message || 'Failed to load posts');
        }
      } finally {
        if (loadVersion === loadVersionRef.current) {
          setLoadingPosts(false);
          setRefreshing(false);
        }
      }
    },
    [categoryTarget, posts.length],
  );

  useEffect(() => {
    if (!categoryTarget) {
      return;
    }

    void loadCategoryPosts();
  }, [categoryTarget, loadCategoryPosts]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    void loadCategoryPosts(true);
  }, [loadCategoryPosts]);

  const handlePostPress = useCallback(
    (postId: string) => {
      setExplorePostsCache(posts);
      router.push({
        pathname: '/profile-feed/explore' as any,
        params: {
          initialPostId: postId,
        },
      });
    },
    [posts],
  );

  const renderGridItem = useCallback(
    ({ item }: { item: Post }) => <CategoryGridCard item={item} onPress={handlePostPress} />,
    [handlePostPress],
  );

  if (categoryLoading || (loadingPosts && posts.length === 0)) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={[styles.header, { paddingTop: insets.top > 0 ? 0 : 8 }]}>
          <TouchableOpacity onPress={() => safeRouterBack(router, '/(tabs)/explore' as any)} style={styles.backButton}>
            <Feather name="arrow-left" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>#{categoryDisplayName}</Text>
          <View style={styles.headerSpacer} />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#60a5fa" />
          <Text style={styles.loadingText}>Loading posts...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error && posts.length === 0) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={[styles.header, { paddingTop: insets.top > 0 ? 0 : 8 }]}>
          <TouchableOpacity onPress={() => safeRouterBack(router, '/(tabs)/explore' as any)} style={styles.backButton}>
            <Feather name="arrow-left" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>#{categoryDisplayName}</Text>
          <View style={styles.headerSpacer} />
        </View>
        <View style={styles.errorContainer}>
          <MaterialIcons name="error-outline" size={48} color="#9ca3af" />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => void loadCategoryPosts(true)}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" />

      <View style={[styles.header, { paddingTop: insets.top > 0 ? 0 : 8 }]}>
        <TouchableOpacity onPress={() => safeRouterBack(router, '/(tabs)/explore' as any)} style={styles.backButton}>
          <Feather name="arrow-left" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>#{categoryDisplayName}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <FlatList
        data={posts}
        renderItem={renderGridItem}
        keyExtractor={(item) => item.id}
        numColumns={3}
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={styles.gridContainer}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor="#60a5fa"
            colors={['#60a5fa']}
          />
        }
        initialNumToRender={12}
        maxToRenderPerBatch={18}
        windowSize={9}
        updateCellsBatchingPeriod={30}
        removeClippedSubviews={false}
        showsVerticalScrollIndicator={false}
        ListFooterComponent={
          loadingPosts && posts.length > 0 ? (
            <View style={styles.footerLoader}>
              <ActivityIndicator size="small" color="#60a5fa" />
            </View>
          ) : null
        }
        ListEmptyComponent={
          !loadingPosts ? (
            <View style={styles.emptyContainer}>
              <MaterialIcons name="video-library" size={64} color="#9ca3af" />
              <Text style={styles.emptyText}>No posts in this tag yet</Text>
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
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
  headerSpacer: {
    width: 40,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#f3f4f6',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  errorText: {
    marginTop: 16,
    marginBottom: 20,
    color: '#f3f4f6',
    fontSize: 16,
    textAlign: 'center',
  },
  retryButton: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#60a5fa',
  },
  retryButtonText: {
    color: '#000',
    fontSize: 15,
    fontWeight: '700',
  },
  gridContainer: {
    padding: 8,
    paddingBottom: 24,
  },
  gridRow: {
    justifyContent: 'space-between',
  },
  postCard: {
    width: (SCREEN_WIDTH - 24) / 3,
    aspectRatio: 9 / 16,
    marginBottom: 8,
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
    left: 0,
    right: 0,
    bottom: 0,
    padding: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  postStats: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
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
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  footerLoader: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 80,
  },
  emptyText: {
    color: '#9ca3af',
    fontSize: 16,
    marginTop: 16,
  },
});
