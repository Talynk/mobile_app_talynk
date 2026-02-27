import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { postsApi } from '@/lib/api';
import { Post } from '@/types';
import { filterHlsReady } from '@/lib/utils/post-filter';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getPostMediaUrl, getThumbnailUrl, getFileUrl } from '@/lib/utils/file-url';
import { useVideoThumbnail } from '@/lib/hooks/use-video-thumbnail';

const { width: screenWidth } = Dimensions.get('window');

// Extracted so we can use hooks (useVideoThumbnail)
const CategoryPostCard = ({ item }: { item: Post }) => {
  const mediaUrl = getPostMediaUrl(item) || '';
  const isHls = mediaUrl.endsWith('.m3u8');
  const isVideo =
    item.type === 'video' || isHls ||
    (mediaUrl && (mediaUrl.includes('.mp4') || mediaUrl.includes('.mov') || mediaUrl.includes('.webm')));

  const serverThumbnail = getThumbnailUrl(item);
  const fallbackImageUrl = getFileUrl((item as any).image || (item as any).thumbnail || '');

  // DATA SAVER: Don't download raw MP4 for thumbnails — use server-generated thumbnail
  const { thumbnailUri: generatedThumbnail } = useVideoThumbnail(
    null, // Never download raw MP4 for thumbnails
    fallbackImageUrl || '',
    1000
  );

  const displayUrl = isVideo
    ? (serverThumbnail || generatedThumbnail || fallbackImageUrl)
    : (mediaUrl || fallbackImageUrl);

  return (
    <TouchableOpacity
      style={styles.postItem}
      onPress={() => router.push({
        pathname: '/post/[id]',
        params: { id: item.id, postData: JSON.stringify(item) }
      })}
    >
      {displayUrl ? (
        <Image source={{ uri: displayUrl }} style={styles.postMedia} resizeMode="cover" />
      ) : (
        <View style={[styles.postMedia, { backgroundColor: '#1a1a1a', justifyContent: 'center', alignItems: 'center' }]}>
          <Feather name={isVideo ? 'video' : 'image'} size={28} color="#444" />
        </View>
      )}

      {isVideo && (
        <View style={styles.playBadge}>
          <Feather name="play" size={14} color="#fff" />
        </View>
      )}

      <View style={styles.postOverlay}>
        <View style={styles.postStats}>
          <Feather name="heart" size={14} color="#fff" />
          <Text style={styles.postStatText}>{item.likes || 0}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
};

export default function CategoryScreen() {
  const { name } = useLocalSearchParams();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    loadCategoryPosts();
  }, [name]);

  const loadCategoryPosts = async () => {
    try {
      const response = await postsApi.getAll(1, 50);
      if (response.status === 'success') {
        const apiData: any = response.data;
        const allPosts: Post[] = Array.isArray(apiData) ? apiData : (Array.isArray(apiData?.posts) ? apiData.posts : []);
        const filteredPosts = filterHlsReady(allPosts).filter((post: Post) => {
          const postCategory = typeof post.category === 'string' ? post.category : post.category?.name;
          return postCategory === name;
        });
        setPosts(filteredPosts);
      }
    } catch (error) {
      console.error('Error loading category posts:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Feather name="arrow-left" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>#{name}</Text>
        <View style={{ width: 32 }} />
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#60a5fa" />
        </View>
      ) : (
        <FlatList
          data={posts}
          renderItem={({ item }) => <CategoryPostCard item={item} />}
          keyExtractor={(item) => item.id}
          numColumns={3}
          contentContainerStyle={styles.gridContainer}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Feather name="video" size={48} color="#666" />
              <Text style={styles.emptyText}>No posts in this category</Text>
            </View>
          }
        />
      )}
    </View>
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
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  gridContainer: {
    padding: 2,
  },
  postItem: {
    width: (screenWidth - 6) / 3,
    height: (screenWidth - 6) / 3 * 1.5,
    margin: 1,
    position: 'relative',
  },
  postMedia: {
    width: '100%',
    height: '100%',
  },
  playBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 12,
    padding: 4,
  },
  postOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    padding: 8,
  },
  postStats: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  postStatText: {
    color: '#fff',
    fontSize: 12,
    marginLeft: 4,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 60,
    width: screenWidth,
  },
  emptyText: {
    color: '#fff',
    fontSize: 16,
    marginTop: 16,
  },
});