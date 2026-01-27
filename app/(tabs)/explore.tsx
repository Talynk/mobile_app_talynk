import React, { useState, useEffect, useRef } from 'react';
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
  ScrollView,
  RefreshControl,
  Keyboard,
  Modal,
} from 'react-native';
import { router } from 'expo-router';
import { postsApi, userApi, followsApi, categoriesApi, searchApi } from '@/lib/api';
import { Post, User, Country } from '@/types';
import { useAuth } from '@/lib/auth-context';
import { useCache } from '@/lib/cache-context';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar } from '@/components/Avatar';
import { getPostMediaUrl, getFileUrl, getThumbnailUrl } from '@/lib/utils/file-url';
import { Video, ResizeMode, AVPlaybackStatus } from 'expo-av';
import { useVideoMute } from '@/lib/hooks/use-video-mute';
import { useVideoThumbnail } from '@/lib/hooks/use-video-thumbnail';
import { timeAgo } from '@/lib/utils/time-ago';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

const CONFIGURED_COUNTRIES = [
  { id: 140, name: 'Rwanda', code: 'RW', flag_emoji: '🇷🇼' },
  { id: 2, name: 'Kenya', code: 'KE', flag_emoji: '🇰🇪' },
  { id: 3, name: 'Uganda', code: 'UG', flag_emoji: '🇺🇬' },
  { id: 4, name: 'Tanzania', code: 'TZ', flag_emoji: '🇹🇿' },
  { id: 5, name: 'Nigeria', code: 'NG', flag_emoji: '🇳🇬' },
  { id: 6, name: 'Ghana', code: 'GH', flag_emoji: '🇬🇭' },
  { id: 7, name: 'South Africa', code: 'ZA', flag_emoji: '🇿🇦' },
  { id: 8, name: 'United States', code: 'US', flag_emoji: '🇺🇸' },
  { id: 9, name: 'United Kingdom', code: 'GB', flag_emoji: '🇬🇧' },
];

export default function ExploreScreen() {
  const [activeTab, setActiveTab] = useState<'grid' | 'search'>('grid');
  const [searchQuery, setSearchQuery] = useState('');

  // Grid state
  const [gridPosts, setGridPosts] = useState<Post[]>([]);
  const [gridLoading, setGridLoading] = useState(false);

  // Filters
  const [categories, setCategories] = useState<any[]>([]);
  // Hierarchical categories
  const [selectedMainCategoryId, setSelectedMainCategoryId] = useState<number | null>(null);
  const [selectedSubCategoryId, setSelectedSubCategoryId] = useState<number | null>(null);
  const [selectedCountryId, setSelectedCountryId] = useState<number | null>(null);
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [countrySearchQuery, setCountrySearchQuery] = useState('');

  // Search results
  const [searchUsers, setSearchUsers] = useState<User[]>([]);
  const [searchPosts, setSearchPosts] = useState<Post[]>([]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const { user } = useAuth();
  const { followedUsers, updateFollowedUsers } = useCache();
  const insets = useSafeAreaInsets();
  const gridScrollViewRef = useRef<ScrollView>(null);

  useEffect(() => {
    loadInitialContent();
  }, []);

  // Category display name mapping for frontend
  const getCategoryDisplayName = (name: string): string => {
    const displayMap: { [key: string]: string } = {
      'Women Beauty': 'Ladies Beauty',
      'Men': 'Gentlemen Beauty',
    };
    return displayMap[name] || name;
  };

  // Load posts when filters change (only for grid, not feed)
  useEffect(() => {
    if (activeTab === 'grid') {
      // Immediately clear posts and show loading
      setGridPosts([]);
      setGridLoading(true);

      // Load posts with current filters immediately
      loadGridPosts().then(() => {
        // Scroll to top after loading
        setTimeout(() => {
          gridScrollViewRef.current?.scrollTo({ y: 0, animated: false });
        }, 50);
      }).catch(() => {
        setGridLoading(false);
      });
    }
  }, [selectedMainCategoryId, selectedSubCategoryId, selectedCountryId, activeTab]);

  useEffect(() => {
    if (searchQuery.trim().length > 0) {
      performSearch();
    } else {
      setSearchUsers([]);
      setSearchPosts([]);
    }
  }, [searchQuery]);

  const applyClientFilters = (posts: Post[]) => {
    let filtered = [...posts];

    if (selectedCountryId) {
      filtered = filtered.filter(
        (p: any) => p.user?.country?.id === selectedCountryId
      );
    }

    if (selectedSubCategoryId) {
      filtered = filtered.filter(
        (p: any) => p.category_id === selectedSubCategoryId || p.category?.id === selectedSubCategoryId
      );
    } else if (selectedMainCategoryId) {
      const main = categories.find((c: any) => c.id === selectedMainCategoryId);
      const childIds: number[] = (main?.children || []).map((ch: any) => ch.id);
      if (childIds.length) {
        filtered = filtered.filter((p: any) => childIds.includes(p.category_id || p.category?.id));
      } else {
        // If no children exist, fall back to exact match
        filtered = filtered.filter(
          (p: any) => p.category_id === selectedMainCategoryId || p.category?.id === selectedMainCategoryId
        );
      }
    }

    return filtered;
  };

  const loadInitialContent = async () => {
    setLoading(true);
    try {
      const [categoriesRes, postsRes] = await Promise.all([
        categoriesApi.getAll(),
        postsApi.getAll(1, 50),
      ]);

      if (categoriesRes.status === 'success') {
        setCategories(categoriesRes.data.categories || []);
      }

      if (postsRes.status === 'success') {
        const data = postsRes.data.posts || postsRes.data || [];
        const postsList = Array.isArray(data) ? data : [];
        setGridPosts(applyClientFilters(postsList));
      }
    } catch (error) {
      // Silently handle errors
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const loadGridPosts = async () => {
    try {
      let posts: Post[] = [];

      // Fetch all posts using the posts API (not search API)
      // The posts API is designed to return all active posts
      const response = await postsApi.getAll(1, 100);

      if (response.status === 'success' && response.data) {
        const data = response.data.posts || response.data || [];
        const allPosts = Array.isArray(data) ? data : [];

        // Apply client-side filters using the existing applyClientFilters function
        // This handles category (main/sub) and country filtering
        posts = applyClientFilters(allPosts);
      }

      // Update state immediately with filtered posts
      setGridPosts(posts);
    } catch (error) {
      // Silently handle errors
      setGridPosts([]);
    } finally {
      setGridLoading(false);
    }
  };

  const performSearch = async () => {
    try {
      const response = await searchApi.search(searchQuery, {
        type: 'all',
        page: 1,
        limit: 20,
      });

      if (response.status === 'success') {
        setSearchUsers(response.data.users || []);
        setSearchPosts(response.data.posts || []);
      }
    } catch (error) {
      // Silently handle search errors
      setSearchUsers([]);
      setSearchPosts([]);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    loadInitialContent();
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

  const handleCountrySelect = (country: Country | null) => {
    if (country) {
      setSelectedCountryId(country.id);
    } else {
      setSelectedCountryId(null);
    }
    setShowCountryPicker(false);
    setCountrySearchQuery('');
  };

  const filteredCountries = CONFIGURED_COUNTRIES.filter(c =>
    c.name.toLowerCase().includes(countrySearchQuery.toLowerCase())
  );

  // ============ GRID COMPONENTS ============
  const GridPostCard = ({ item, index }: { item: Post; index: number }) => {
    const videoUrl = getFileUrl(item.video_url || item.videoUrl || '');
    const mediaUrl = getPostMediaUrl(item) || '';
    const fallbackImageUrl = getThumbnailUrl(item) || getFileUrl((item as any).image || (item as any).thumbnail || '');
    const isVideo =
      item.type === 'video' ||
      (mediaUrl !== null &&
        mediaUrl !== '' &&
        (mediaUrl.toLowerCase().includes('.mp4') ||
          mediaUrl.toLowerCase().includes('.mov') ||
          mediaUrl.toLowerCase().includes('.webm')));

    // Use video thumbnail hook for videos
    const generatedThumbnail = useVideoThumbnail(
      isVideo && videoUrl ? videoUrl : null,
      fallbackImageUrl || '',
      1000
    );

    // Determine the final thumbnail URL to display
    const staticThumbnailUrl = isVideo
      ? (generatedThumbnail || fallbackImageUrl)
      : (mediaUrl || fallbackImageUrl);

    // Check if we're still loading the thumbnail
    const isLoadingThumbnail = isVideo && !staticThumbnailUrl && videoUrl;

    return (
      <TouchableOpacity
        style={styles.gridCard}
        onPress={() =>
          router.push({
            pathname: '/post/[id]',
            params: { id: item.id, postData: JSON.stringify(item) },
          })
        }
      >
        {isLoadingThumbnail ? (
          // Show loading state while thumbnail is being generated
          <View style={[styles.gridMedia, styles.gridNoMedia]}>
            <ActivityIndicator size="small" color="#60a5fa" />
            <MaterialIcons
              name="video-library"
              size={28}
              color="#444"
              style={{ marginTop: 8 }}
            />
          </View>
        ) : staticThumbnailUrl ? (
          // Show the thumbnail image
          <Image
            source={{ uri: staticThumbnailUrl }}
            style={styles.gridMedia}
            resizeMode="cover"
          />
        ) : (
          // Fallback placeholder
          <View style={[styles.gridMedia, styles.gridNoMedia]}>
            <MaterialIcons
              name={isVideo ? 'video-library' : 'image'}
              size={28}
              color="#444"
            />
          </View>
        )}

        {isVideo && (
          <View style={styles.gridPlayIcon}>
            <Feather name="play" size={16} color="#fff" />
          </View>
        )}

        <View style={styles.gridOverlay}>
          <View style={styles.gridStats}>
            <Feather name="heart" size={12} color="#fff" />
            <Text style={styles.gridStatText}>{item.likes || 0}</Text>
          </View>
          {(item.createdAt || (item as any).uploadDate) && (
            <Text style={styles.gridTime}>
              {timeAgo(
                (item as any).createdAt ||
                (item as any).uploadDate ||
                (item as any).created_at
              )}
            </Text>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  // ============ SEARCH COMPONENTS ============
  const SearchUserRow = ({ item }: { item: User }) => (
    <TouchableOpacity
      style={styles.searchUserRow}
      onPress={() => router.push({ pathname: '/user/[id]', params: { id: item.id } })}
    >
      <Avatar user={item} size={50} style={styles.searchUserAvatar} />
      <View style={styles.searchUserInfo}>
        <Text style={styles.searchUserName}>{item.name || item.username}</Text>
        <Text style={styles.searchUserHandle}>@{item.username}</Text>
      </View>
      {user && user.id !== item.id && (
        <TouchableOpacity
          style={[
            styles.searchFollowButton,
            followedUsers.has(item.id) && styles.searchFollowingButton,
          ]}
          onPress={() => handleFollow(item.id)}
        >
          <Text
            style={[
              styles.searchFollowButtonText,
              followedUsers.has(item.id) && styles.searchFollowingButtonText,
            ]}
          >
            {followedUsers.has(item.id) ? 'Following' : 'Follow'}
          </Text>
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );

  const SearchPostCard = ({ item, index }: { item: Post; index: number }) => {
    const videoUrl = getFileUrl(item.video_url || item.videoUrl || '');
    const mediaUrl = getPostMediaUrl(item) || '';
    const fallbackImageUrl = getThumbnailUrl(item) || getFileUrl((item as any).image || (item as any).thumbnail || '');
    const isVideo =
      item.type === 'video' ||
      (mediaUrl !== null &&
        mediaUrl !== '' &&
        (mediaUrl.toLowerCase().includes('.mp4') ||
          mediaUrl.toLowerCase().includes('.mov') ||
          mediaUrl.toLowerCase().includes('.webm')));

    // Use video thumbnail hook for videos
    const generatedThumbnail = useVideoThumbnail(
      isVideo && videoUrl ? videoUrl : null,
      fallbackImageUrl || '',
      1000
    );

    // Determine the final thumbnail URL to display
    const staticThumbnailUrl = isVideo
      ? (generatedThumbnail || fallbackImageUrl)
      : (mediaUrl || fallbackImageUrl);

    // Check if we're still loading the thumbnail
    const isLoadingThumbnail = isVideo && !staticThumbnailUrl && videoUrl;

    return (
      <TouchableOpacity
        style={styles.gridCard}
        onPress={() =>
          router.push({
            pathname: '/post/[id]',
            params: { id: item.id, postData: JSON.stringify(item) },
          })
        }
      >
        {isLoadingThumbnail ? (
          <View style={[styles.gridMedia, styles.gridNoMedia]}>
            <ActivityIndicator size="small" color="#60a5fa" />
            <MaterialIcons
              name="video-library"
              size={28}
              color="#444"
              style={{ marginTop: 8 }}
            />
          </View>
        ) : staticThumbnailUrl ? (
          <Image
            source={{ uri: staticThumbnailUrl }}
            style={styles.gridMedia}
            resizeMode="cover"
          />
        ) : (
          <View style={[styles.gridMedia, styles.gridNoMedia]}>
            <MaterialIcons name={isVideo ? 'video-library' : 'image'} size={28} color="#444" />
          </View>
        )}
        {isVideo && (
          <View style={styles.gridPlayIcon}>
            <Feather name="play" size={16} color="#fff" />
          </View>
        )}
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#60a5fa" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        {activeTab === 'search' ? (
          <View style={styles.searchBar}>
            <Feather name="search" size={20} color="#666" style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search users, videos..."
              placeholderTextColor="#666"
              value={searchQuery}
              onChangeText={setSearchQuery}
              returnKeyType="search"
              onSubmitEditing={() => {
                setActiveTab('search');
                performSearch();
              }}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity
                onPress={() => {
                  setSearchQuery('');
                  Keyboard.dismiss();
                }}
              >
                <Feather name="x" size={18} color="#666" />
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <View style={{ height: 44 }} />
        )}
      </View>

      {/* Tab buttons */}
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'grid' && styles.tabButtonActive]}
          onPress={() => {
            setActiveTab('grid');
            setSearchQuery('');
          }}
        >
          <Text style={[styles.tabText, activeTab === 'grid' && styles.tabTextActive]}>
            Explore
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'search' && styles.tabButtonActive]}
          onPress={() => setActiveTab('search')}
        >
          <Text style={[styles.tabText, activeTab === 'search' && styles.tabTextActive]}>
            Search
          </Text>
        </TouchableOpacity>
      </View>

      {/* GRID TAB - Explore with filters */}
      {activeTab === 'grid' && (
        <ScrollView
          ref={gridScrollViewRef}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {/* Filters */}
          <View style={styles.filterSection}>
            {/* Country filter */}
            <TouchableOpacity
              style={styles.filterButton}
              onPress={() => setShowCountryPicker(true)}
            >
              <MaterialIcons name="public" size={18} color="#60a5fa" />
              <Text style={styles.filterButtonText}>
                {CONFIGURED_COUNTRIES.find(c => c.id === selectedCountryId)?.name ||
                  'All Countries'}
              </Text>
              <Feather name="chevron-down" size={16} color="#666" />
            </TouchableOpacity>

            {/* Main Category filter */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.categoryScroll}
            >
              <TouchableOpacity
                style={[
                  styles.categoryPill,
                  !selectedMainCategoryId && !selectedSubCategoryId && styles.categoryPillActive,
                ]}
                onPress={() => {
                  setSelectedMainCategoryId(null);
                  setSelectedSubCategoryId(null);
                }}
              >
                <Text
                  style={[
                    styles.categoryPillText,
                    !selectedMainCategoryId && !selectedSubCategoryId && styles.categoryPillTextActive,
                  ]}
                >
                  All
                </Text>
              </TouchableOpacity>
              {categories.map((cat) => (
                <TouchableOpacity
                  key={cat.id}
                  style={[
                    styles.categoryPill,
                    selectedMainCategoryId === cat.id && styles.categoryPillActive,
                  ]}
                  onPress={() => {
                    setSelectedMainCategoryId(cat.id);
                    setSelectedSubCategoryId(null);
                  }}
                >
                  <Text
                    style={[
                      styles.categoryPillText,
                      selectedMainCategoryId === cat.id && styles.categoryPillTextActive,
                    ]}
                  >
                    {cat.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {/* Subcategory filter (only when a main category is selected) */}
            {!!selectedMainCategoryId && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.categoryScroll}
              >
                <TouchableOpacity
                  style={[
                    styles.categoryPill,
                    !selectedSubCategoryId && styles.categoryPillActive,
                  ]}
                  onPress={() => setSelectedSubCategoryId(null)}
                >
                  <Text
                    style={[
                      styles.categoryPillText,
                      !selectedSubCategoryId && styles.categoryPillTextActive,
                    ]}
                  >
                    All in category
                  </Text>
                </TouchableOpacity>
                {(categories.find((c: any) => c.id === selectedMainCategoryId)?.children || []).map((sub: any) => (
                  <TouchableOpacity
                    key={sub.id}
                    style={[
                      styles.categoryPill,
                      selectedSubCategoryId === sub.id && styles.categoryPillActive,
                    ]}
                    onPress={() => setSelectedSubCategoryId(sub.id)}
                  >
                    <Text
                      style={[
                        styles.categoryPillText,
                        selectedSubCategoryId === sub.id && styles.categoryPillTextActive,
                      ]}
                    >
                      {getCategoryDisplayName(sub.name)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>

          {/* Grid */}
          {gridLoading ? (
            <View style={styles.gridLoadingContainer}>
              <ActivityIndicator size="large" color="#60a5fa" />
            </View>
          ) : (
            <FlatList
              data={gridPosts}
              renderItem={({ item, index }) => (
                <GridPostCard item={item} index={index} />
              )}
              keyExtractor={(item) => item.id}
              numColumns={3}
              scrollEnabled={false}
              contentContainerStyle={styles.gridContent}
            />
          )}
        </ScrollView>
      )}

      {/* SEARCH TAB */}
      {activeTab === 'search' && (
        <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
          {searchQuery.length > 0 ? (
            <>
              {/* Users */}
              {searchUsers.length > 0 && (
                <View style={styles.searchSection}>
                  <Text style={styles.searchSectionTitle}>Users</Text>
                  <FlatList
                    data={searchUsers}
                    renderItem={({ item }) => <SearchUserRow item={item} />}
                    keyExtractor={(item) => item.id}
                    scrollEnabled={false}
                  />
                </View>
              )}

              {/* Posts */}
              {searchPosts.length > 0 && (
                <View style={styles.searchSection}>
                  <Text style={styles.searchSectionTitle}>Posts</Text>
                  <FlatList
                    data={searchPosts}
                    renderItem={({ item, index }) => (
                      <SearchPostCard item={item} index={index} />
                    )}
                    keyExtractor={(item) => item.id}
                    numColumns={3}
                    scrollEnabled={false}
                    contentContainerStyle={styles.gridContent}
                  />
                </View>
              )}

              {searchUsers.length === 0 && searchPosts.length === 0 && (
                <View style={styles.emptyContainer}>
                  <Feather name="search" size={48} color="#666" />
                  <Text style={styles.emptyText}>No results found</Text>
                </View>
              )}
            </>
          ) : (
            <View style={styles.emptyContainer}>
              <Feather name="search" size={48} color="#666" />
              <Text style={styles.emptyText}>Start searching</Text>
            </View>
          )}
        </ScrollView>
      )}

      {/* Country Picker Modal */}
      <Modal
        visible={showCountryPicker}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowCountryPicker(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Country</Text>
              <TouchableOpacity onPress={() => setShowCountryPicker(false)}>
                <Feather name="x" size={24} color="#fff" />
              </TouchableOpacity>
            </View>

            <View style={styles.modalSearchBar}>
              <Feather name="search" size={18} color="#666" />
              <TextInput
                style={styles.modalSearchInput}
                placeholder="Search countries..."
                placeholderTextColor="#666"
                value={countrySearchQuery}
                onChangeText={setCountrySearchQuery}
              />
            </View>

            <ScrollView style={styles.countryList}>
              <TouchableOpacity
                style={[
                  styles.countryItem,
                  !selectedCountryId && styles.countryItemActive,
                ]}
                onPress={() => handleCountrySelect(null)}
              >
                <MaterialIcons
                  name="public"
                  size={24}
                  color={!selectedCountryId ? '#60a5fa' : '#666'}
                />
                <Text
                  style={[
                    styles.countryItemText,
                    !selectedCountryId && styles.countryItemTextActive,
                  ]}
                >
                  All Countries
                </Text>
                {!selectedCountryId && <Feather name="check" size={20} color="#60a5fa" />}
              </TouchableOpacity>

              {filteredCountries.map((country) => (
                <TouchableOpacity
                  key={country.id}
                  style={[
                    styles.countryItem,
                    selectedCountryId === country.id && styles.countryItemActive,
                  ]}
                  onPress={() => handleCountrySelect(country)}
                >
                  <Text style={styles.countryFlag}>{country.flag_emoji || '🏳️'}</Text>
                  <Text
                    style={[
                      styles.countryItemText,
                      selectedCountryId === country.id && styles.countryItemTextActive,
                    ]}
                  >
                    {country.name}
                  </Text>
                  {selectedCountryId === country.id && (
                    <Feather name="check" size={20} color="#60a5fa" />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: '#000',
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    color: '#fff',
    fontSize: 16,
    height: '100%',
  },
  tabContainer: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
    backgroundColor: '#000',
  },
  tabButton: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabButtonActive: {
    borderBottomColor: '#60a5fa',
  },
  tabText: {
    color: '#666',
    fontSize: 14,
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#fff',
  },

  // ============ FEED STYLES ============
  feedPostContainer: {
    width: screenWidth,
    height: screenHeight - 200,
    backgroundColor: '#000',
  },
  feedMediaWrapper: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  feedMedia: {
    width: '100%',
    height: '100%',
  },
  feedNoMedia: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
  },
  feedMuteOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    pointerEvents: 'none',
  },
  feedMuteBadge: {
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 36,
    padding: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  feedProgressBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  feedProgressFill: {
    height: '100%',
    backgroundColor: '#60a5fa',
  },
  feedOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    paddingBottom: 20,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  feedUserSection: {
    marginBottom: 16,
  },
  feedUserRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  feedUserAvatar: {
    marginRight: 12,
  },
  feedUserInfo: {
    flex: 1,
  },
  feedUsername: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  feedDisplayName: {
    color: '#999',
    fontSize: 13,
    marginTop: 2,
  },
  feedActions: {
    flexDirection: 'column',
  },
  feedCaption: {
    color: '#fff',
    fontSize: 14,
    marginBottom: 12,
    lineHeight: 20,
  },
  feedStats: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    gap: 20,
  },
  feedStatItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  feedStatText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },

  // ============ GRID STYLES ============
  filterSection: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    gap: 8,
  },
  filterButtonText: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  categoryScroll: {
    marginBottom: 4,
  },
  categoryPill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: '#1a1a1a',
    marginRight: 8,
    marginLeft: 16,
  },
  categoryPillActive: {
    backgroundColor: '#60a5fa',
  },
  categoryPillText: {
    color: '#666',
    fontSize: 12,
    fontWeight: '500',
  },
  categoryPillTextActive: {
    color: '#fff',
  },
  gridContent: {
    padding: 1,
  },
  gridLoadingContainer: {
    height: 300,
    justifyContent: 'center',
    alignItems: 'center',
  },
  gridCard: {
    width: (screenWidth - 5) / 3,
    height: (screenWidth - 5) / 3 * 1.3,
    margin: 1,
    backgroundColor: '#1a1a1a',
    position: 'relative',
  },
  gridMedia: {
    width: '100%',
    height: '100%',
  },
  gridNoMedia: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
  },
  gridPlayIcon: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 4,
    padding: 4,
  },
  gridOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 4,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  gridStats: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  gridStatText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '600',
  },
  gridTime: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '600',
  },

  // ============ SEARCH STYLES ============
  searchSection: {
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  searchSectionTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  searchUserRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  searchUserAvatar: {
    marginRight: 12,
  },
  searchUserInfo: {
    flex: 1,
  },
  searchUserName: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  searchUserHandle: {
    color: '#666',
    fontSize: 12,
    marginTop: 2,
  },
  searchFollowButton: {
    backgroundColor: '#60a5fa',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
  },
  searchFollowingButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#666',
  },
  searchFollowButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  searchFollowingButtonText: {
    color: '#666',
  },
  emptyContainer: {
    paddingVertical: 60,
    alignItems: 'center',
  },
  emptyText: {
    color: '#666',
    fontSize: 15,
    marginTop: 12,
    textAlign: 'center',
  },

  // ============ MODAL STYLES ============
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#1a1a1a',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  modalTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  modalSearchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#252525',
    margin: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    gap: 8,
  },
  modalSearchInput: {
    flex: 1,
    color: '#fff',
    fontSize: 15,
  },
  countryList: {
    paddingHorizontal: 16,
  },
  countryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginBottom: 4,
    gap: 12,
  },
  countryItemActive: {
    backgroundColor: 'rgba(96, 165, 250, 0.1)',
  },
  countryFlag: {
    fontSize: 24,
  },
  countryItemText: {
    flex: 1,
    color: '#fff',
    fontSize: 15,
  },
  countryItemTextActive: {
    color: '#60a5fa',
    fontWeight: '600',
  },
});
