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
import { postsApi, userApi } from '@/lib/api';
import { Post, User } from '@/types';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Video, ResizeMode } from 'expo-av';
import { getPostMediaUrl } from '@/lib/utils/file-url';

const { width: screenWidth } = Dimensions.get('window');

const SEARCH_TABS = [
  { key: 'posts', label: 'Posts', icon: 'video' },
  { key: 'users', label: 'Users', icon: 'users' },
  { key: 'sounds', label: 'Sounds', icon: 'music' },
];

export default function SearchScreen() {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('posts');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const insets = useSafeAreaInsets();

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    
    setLoading(true);
    try {
      if (activeTab === 'posts') {
        const response = await postsApi.search(searchQuery);
        if (response.status === 'success') {
          setSearchResults(response.data);
        }
      } else if (activeTab === 'users') {
        // Implement user search
        setSearchResults([]);
      }
      
      // Add to recent searches
      setRecentSearches(prev => [
        searchQuery,
        ...prev.filter(s => s !== searchQuery)
      ].slice(0, 10));
    } catch (error) {
      console.error('Search error:', error);
    } finally {
      setLoading(false);
    }
  };

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

  const renderUserResult = ({ item }: { item: User }) => (
    <TouchableOpacity 
      style={styles.userResult}
      onPress={() => router.push({
        pathname: '/user/[id]',
        params: { id: item.id }
      })}
    >
      <Image 
        source={{ uri: item.profile_picture || 'https://via.placeholder.com/48' }}
        style={styles.userAvatar}
      />
      <View style={styles.userInfo}>
        <Text style={styles.userName}>{item.name || item.username}</Text>
        <Text style={styles.userUsername}>@{item.username}</Text>
        <Text style={styles.userStats}>
          {formatNumber(item.followers_count || 0)} followers
        </Text>
      </View>
      <TouchableOpacity style={styles.followButton}>
        <Text style={styles.followButtonText}>Follow</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );

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
      ) : activeTab === 'posts' ? (
        <FlatList<Post>
          key={activeTab}
          data={searchResults as Post[]}
          renderItem={renderPostResult}
          keyExtractor={(item) => item.id}
          numColumns={3}
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
        <FlatList<User>
          key={activeTab}
          data={searchResults as User[]}
          renderItem={renderUserResult}
          keyExtractor={(item) => item.id}
          numColumns={1}
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
  followButtonText: {
    color: '#000',
    fontSize: 14,
    fontWeight: '600',
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