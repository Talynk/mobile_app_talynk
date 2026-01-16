import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { router } from 'expo-router';
import { postsApi, userApi, followsApi } from '@/lib/api';
import { Post, User } from '@/types';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Video, ResizeMode } from 'expo-av';
import { useAuth } from '@/lib/auth-context';
import { useCache } from '@/lib/cache-context';
import { getPostMediaUrl } from '@/lib/utils/file-url';
import { Avatar } from '@/components/Avatar';

const { width: screenWidth } = Dimensions.get('window');

const SEARCH_TABS = [
  { key: 'top', label: 'Top', icon: 'trending-up' },
  { key: 'people', label: 'People', icon: 'users' },
  { key: 'videos', label: 'Videos', icon: 'video' },
];

export default function SearchScreen() {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('top');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [usersResults, setUsersResults] = useState<User[]>([]);
  const [postsResults, setPostsResults] = useState<Post[]>([]);
  const [loading, setLoading] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { followedUsers, updateFollowedUsers } = useCache();

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    
    setLoading(true);
    try {
      if (activeTab === 'top') {
        // Top shows both users and posts
        const [usersRes, postsRes] = await Promise.all([
          userApi.search(searchQuery).catch(() => ({ status: 'error', data: { users: [] } })),
          postsApi.search(searchQuery).catch(() => ({ status: 'error', data: [] }))
        ]);
        
        const users = usersRes.status === 'success' ? (usersRes.data.users || []) : [];
        const posts = postsRes.status === 'success' 
          ? (postsRes.data.posts || (Array.isArray(postsRes.data) ? postsRes.data : []))
          : [];
        
        setUsersResults(users);
        setPostsResults(posts);
        // Combine for display - users first, then posts
        setSearchResults([...users, ...posts]);
      } else if (activeTab === 'people') {
        const res = await userApi.search(searchQuery);
        if (res.status === 'success') {
          const users = res.data.users || [];
          setUsersResults(users);
          setSearchResults(users);
        } else {
          setUsersResults([]);
          setSearchResults([]);
        }
      } else if (activeTab === 'videos') {
        const res = await postsApi.search(searchQuery);
        if (res.status === 'success') {
          const posts = res.data.posts || (Array.isArray(res.data) ? res.data : []);
          setPostsResults(posts);
          setSearchResults(posts);
        } else {
          setPostsResults([]);
          setSearchResults([]);
        }
      }
      
      // Add to recent searches
      setRecentSearches(prev => [
        searchQuery,
        ...prev.filter(s => s !== searchQuery)
      ].slice(0, 10));
    } catch (error) {
      console.error('Search error:', error);
      setSearchResults([]);
      setUsersResults([]);
      setPostsResults([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (searchQuery.trim().length > 0) {
      handleSearch();
    } else {
      setSearchResults([]);
      setUsersResults([]);
      setPostsResults([]);
    }
  }, [activeTab]);

  const renderPostResult = ({ item }: { item: Post }) => {
    const mediaUrl = getPostMediaUrl(item) || '';
    const isVideo = !!(item.video_url || item.videoUrl);

    return (
      <TouchableOpacity 
        style={styles.postResult}
        onPress={() => router.push({
          pathname: '/post/[id]',
          params: { id: item.id }
        })}
      >
        {isVideo ? (
          <Video
            source={{ uri: mediaUrl }}
            style={styles.resultMedia}
            resizeMode={ResizeMode.COVER}
            shouldPlay={false}
            isMuted={true}
            useNativeControls={false}
            posterStyle={{ resizeMode: 'cover' }}
          />
        ) : (
          <Image source={{ uri: mediaUrl }} style={styles.resultMedia} />
        )}
        
        <View style={styles.resultOverlay}>
          <View style={styles.resultStats}>
            <View style={styles.resultStat}>
              <Feather name="heart" size={14} color="#fff" />
              <Text style={styles.resultStatText}>{formatNumber(item.likes || 0)}</Text>
            </View>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const handleFollow = async (userId: string) => {
    if (!user) {
      router.push('/auth/login');
      return;
    }
    updateFollowedUsers(userId, true);
    try {
      await followsApi.follow(userId);
    } catch (error) {
      updateFollowedUsers(userId, false);
    }
  };

  const handleUnfollow = async (userId: string) => {
    if (!user) return;
    updateFollowedUsers(userId, false);
    try {
      await followsApi.unfollow(userId);
    } catch (error) {
      updateFollowedUsers(userId, true);
    }
  };

  const renderUserResult = ({ item }: { item: User }) => {
    const isFollowing = followedUsers.has(item.id);
    return (
      <TouchableOpacity 
        style={styles.userResult}
        onPress={() => router.push({
          pathname: '/user/[id]',
          params: { id: item.id }
        })}
      >
        <Avatar
          user={item}
          size={48}
          style={styles.userAvatar}
        />
        <View style={styles.userInfo}>
          <Text style={styles.userName}>{item.name || item.username}</Text>
          <Text style={styles.userUsername}>@{item.username}</Text>
          <Text style={styles.userStats}>
            {formatNumber(item.followers_count || 0)} followers
          </Text>
        </View>
        {user && user.id !== item.id && (
          <TouchableOpacity 
            style={[
              styles.followButton,
              isFollowing && styles.followingButton
            ]}
            onPress={(e) => {
              e.stopPropagation();
              isFollowing ? handleUnfollow(item.id) : handleFollow(item.id);
            }}
          >
            <Text style={[
              styles.followButtonText,
              isFollowing && styles.followingButtonText
            ]}>
              {isFollowing ? 'Following' : 'Follow'}
            </Text>
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  };

  const formatNumber = (num: number): string => {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Feather name="arrow-left" size={24} color="#fff" />
        </TouchableOpacity>
        
        <View style={styles.searchContainer}>
          <Feather name="search" size={20} color="#666" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search posts, users, sounds..."
            placeholderTextColor="#666"
            value={searchQuery}
            onChangeText={setSearchQuery}
            onSubmitEditing={handleSearch}
            autoFocus
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <MaterialIcons name="clear" size={20} color="#666" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Search Tabs */}
      <View style={styles.tabsContainer}>
        {SEARCH_TABS.map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[
              styles.searchTab,
              activeTab === tab.key && styles.searchTabActive
            ]}
            onPress={() => setActiveTab(tab.key)}
          >
            <Feather 
              name={tab.icon as any} 
              size={16} 
              color={activeTab === tab.key ? '#60a5fa' : '#666'} 
            />
            <Text style={[
              styles.searchTabText,
              activeTab === tab.key && styles.searchTabTextActive
            ]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Recent Searches */}
      {searchQuery.length === 0 && recentSearches.length > 0 && (
        <View style={styles.recentContainer}>
          <Text style={styles.recentTitle}>Recent searches</Text>
          {recentSearches.map((search, index) => (
            <TouchableOpacity
              key={index}
              style={styles.recentItem}
              onPress={() => {
                setSearchQuery(search);
                handleSearch();
              }}
            >
              <Feather name="clock" size={16} color="#666" />
              <Text style={styles.recentText}>{search}</Text>
              <TouchableOpacity
                onPress={() => setRecentSearches(prev => prev.filter((_, i) => i !== index))}
              >
                <MaterialIcons name="close" size={16} color="#666" />
              </TouchableOpacity>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Search Results */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#60a5fa" />
        </View>
      ) : activeTab === 'top' ? (
        <FlatList
          data={searchResults}
          renderItem={({ item }) => {
            // Check if item is a User or Post
            if (item.username || item.profile_picture) {
              return renderUserResult({ item: item as User });
            } else {
              return renderPostResult({ item: item as Post });
            }
          }}
          keyExtractor={(item, index) => item.id || `item-${index}`}
          contentContainerStyle={styles.resultsContainer}
          ListEmptyComponent={
            searchQuery.length > 0 ? (
              <View style={styles.emptyContainer}>
                <Feather name="search" size={48} color="#666" />
                <Text style={styles.emptyText}>No results found</Text>
                <Text style={styles.emptySubtext}>Try searching for something else</Text>
              </View>
            ) : null
          }
        />
      ) : (
        <FlatList
          key={activeTab}
          data={searchResults}
          renderItem={activeTab === 'videos' ? renderPostResult : renderUserResult}
          keyExtractor={(item) => item.id}
          numColumns={activeTab === 'videos' ? 3 : 1}
          contentContainerStyle={styles.resultsContainer}
          ListEmptyComponent={
            searchQuery.length > 0 ? (
              <View style={styles.emptyContainer}>
                <Feather name="search" size={48} color="#666" />
                <Text style={styles.emptyText}>No results found</Text>
                <Text style={styles.emptySubtext}>Try searching for something else</Text>
              </View>
            ) : null
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
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  backButton: {
    padding: 8,
    marginRight: 8,
  },
  searchContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  searchInput: {
    flex: 1,
    color: '#fff',
    fontSize: 16,
    marginLeft: 8,
  },
  tabsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  searchTab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 8,
    backgroundColor: '#1a1a1a',
  },
  searchTabActive: {
    backgroundColor: 'rgba(96, 165, 250, 0.2)',
  },
  searchTabText: {
    color: '#666',
    fontSize: 14,
    fontWeight: '500',
    marginLeft: 6,
  },
  searchTabTextActive: {
    color: '#60a5fa',
  },
  recentContainer: {
    padding: 16,
  },
  recentTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  recentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  recentText: {
    color: '#fff',
    fontSize: 14,
    flex: 1,
    marginLeft: 12,
  },
  resultsContainer: {
    padding: 16,
  },
  postResult: {
    width: (screenWidth - 48) / 3,
    height: (screenWidth - 48) / 3 * 1.5,
    marginRight: 4,
    marginBottom: 4,
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative',
  },
  resultMedia: {
    width: '100%',
    height: '100%',
  },
  resultOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    padding: 8,
  },
  resultStats: {
    flexDirection: 'row',
  },
  resultStat: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  resultStatText: {
    color: '#fff',
    fontSize: 12,
    marginLeft: 4,
  },
  userResult: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    marginBottom: 8,
  },
  userAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    marginRight: 12,
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 2,
  },
  userUsername: {
    color: '#666',
    fontSize: 14,
    marginBottom: 2,
  },
  userStats: {
    color: '#666',
    fontSize: 12,
  },
  followButton: {
    backgroundColor: '#60a5fa',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  followingButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#666',
  },
  followButtonText: {
    color: '#000',
    fontSize: 14,
    fontWeight: '600',
  },
  followingButtonText: {
    color: '#666',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtext: {
    color: '#666',
    fontSize: 14,
    textAlign: 'center',
  },
});