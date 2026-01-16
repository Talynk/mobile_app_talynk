import React, { useState, useEffect, useCallback } from 'react';
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
import { postsApi, userApi, followsApi, categoriesApi, countriesApi, searchApi } from '@/lib/api';
import { Post, User, Country } from '@/types';
import { useAuth } from '@/lib/auth-context';
import { useCache } from '@/lib/cache-context';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const { width: screenWidth } = Dimensions.get('window');

const SEARCH_TABS = [
  { key: 'top', label: 'Top' },
  { key: 'people', label: 'People' },
  { key: 'videos', label: 'Videos' },
];

// Preferred category order
const CATEGORY_ORDER = ['Music', 'Sport', 'Performance', 'Beauty', 'Arts', 'Communication'];

export default function ExploreScreen() {
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [activeSearchTab, setActiveSearchTab] = useState('top');

  const [categories, setCategories] = useState<any[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [selectedSubcategory, setSelectedSubcategory] = useState<string>('');
  const [selectedSubcategoryId, setSelectedSubcategoryId] = useState<number | null>(null);
  const [subcategories, setSubcategories] = useState<any[]>([]);

  // Country filter
  const [countries, setCountries] = useState<Country[]>([]);
  const [selectedCountry, setSelectedCountry] = useState<string>('All Countries');
  const [selectedCountryId, setSelectedCountryId] = useState<number | null>(null);
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [countrySearchQuery, setCountrySearchQuery] = useState('');

  const [posts, setPosts] = useState<Post[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [suggestions, setSuggestions] = useState<User[]>([]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingPosts, setLoadingPosts] = useState(false);

  const { user } = useAuth();
  const { followedUsers, updateFollowedUsers } = useCache();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    loadInitialContent();
    loadCountries();
  }, []);

  // Load posts when filters change
  useEffect(() => {
    if (!isSearching) {
      loadFilteredPosts();
    }
  }, [selectedCategoryId, selectedSubcategoryId, selectedCountryId]);

  useEffect(() => {
    if (searchQuery.trim().length > 0) {
      setIsSearching(true);
      performSearch();
    } else {
      setIsSearching(false);
    }
  }, [searchQuery, activeSearchTab]);

  // Update subcategories when category changes
  useEffect(() => {
    if (selectedCategory !== 'All') {
      const category = categories.find(c => c.name === selectedCategory);
      if (category?.children && category.children.length > 0) {
        setSubcategories(category.children);
      } else {
        setSubcategories([]);
      }
    } else {
      setSubcategories([]);
      setSelectedSubcategory('');
      setSelectedSubcategoryId(null);
    }
  }, [selectedCategory, categories]);

  const loadCountries = async () => {
    try {
      const res = await countriesApi.getAll();
      if (res.status === 'success' && res.data?.countries) {
        setCountries(res.data.countries);
      }
    } catch (error) {
      console.error('Error loading countries:', error);
    }
  };

  const loadInitialContent = async () => {
    setLoading(true);
    try {
      const [categoriesRes, postsRes, suggestionsRes] = await Promise.all([
        categoriesApi.getAll(),
        postsApi.getAll(1, 30),
        userApi.getSuggestions()
      ]);

      if (categoriesRes.status === 'success') {
        // Sort categories according to preferred order
        const sortedCategories = sortCategories(categoriesRes.data.categories || []);
        setCategories([{ name: 'All', id: null }, ...sortedCategories]);
      }

      if (postsRes.status === 'success') {
        const data = postsRes.data.posts || postsRes.data || [];
        setPosts(Array.isArray(data) ? data : []);
      }

      if (suggestionsRes.status === 'success') {
        const list = suggestionsRes.data?.suggestions || [];
        setSuggestions(Array.isArray(list) ? list : []);
      }
    } catch (error) {
      console.error('Error loading explore content:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Sort categories according to preferred order
  const sortCategories = (cats: any[]) => {
    return cats.sort((a, b) => {
      const indexA = CATEGORY_ORDER.indexOf(a.name);
      const indexB = CATEGORY_ORDER.indexOf(b.name);
      
      // If both are in the preferred order, sort by that order
      if (indexA !== -1 && indexB !== -1) {
        return indexA - indexB;
      }
      // If only one is in the preferred order, it comes first
      if (indexA !== -1) return -1;
      if (indexB !== -1) return 1;
      // Otherwise, sort alphabetically
      return a.name.localeCompare(b.name);
    });
  };

  const loadFilteredPosts = async () => {
    setLoadingPosts(true);
    try {
      // Build query params for filtering
      let url = `/api/posts/all?page=1&limit=30`;
      
      // Use subcategory ID if selected, otherwise use main category ID
      const categoryIdToUse = selectedSubcategoryId || selectedCategoryId;
      if (categoryIdToUse) {
        url += `&category_id=${categoryIdToUse}`;
      }
      
      if (selectedCountryId) {
        url += `&country_id=${selectedCountryId}`;
      }

      const response = await postsApi.getAll(1, 30, categoryIdToUse ? `&category_id=${categoryIdToUse}` : '');
      
      if (response.status === 'success') {
        const data = response.data.posts || response.data || [];
        setPosts(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      console.error('Error loading filtered posts:', error);
    } finally {
      setLoadingPosts(false);
    }
  };

  const performSearch = async () => {
    setLoading(true);
    try {
      const searchOptions: any = {
        type: activeSearchTab === 'people' ? 'users' : activeSearchTab === 'videos' ? 'posts' : 'all',
        page: 1,
        limit: 20,
      };

      // Add filters
      if (selectedCountryId) {
        searchOptions.country_id = selectedCountryId;
      }
      if (selectedCategoryId) {
        searchOptions.category_id = selectedCategoryId;
      }

      const res = await searchApi.search(searchQuery, searchOptions);
      
      if (res.status === 'success') {
        if (activeSearchTab === 'people') {
          setUsers(res.data.users || []);
          setPosts([]);
        } else if (activeSearchTab === 'videos') {
          setPosts(res.data.posts || []);
          setUsers([]);
        } else {
          // Top shows both
          setUsers(res.data.users || []);
          setPosts(res.data.posts || []);
        }
      } else {
        setUsers([]);
        setPosts([]);
      }
    } catch (error) {
      console.error('Search error:', error);
      setUsers([]);
      setPosts([]);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    if (isSearching) {
      performSearch();
    } else {
      loadInitialContent();
    }
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

  const handleCategorySelect = (cat: any) => {
    setSelectedCategory(cat.name);
    setSelectedCategoryId(cat.id || null);
    setSelectedSubcategory('');
    setSelectedSubcategoryId(null);
  };

  const handleSubcategorySelect = (subcat: any) => {
    setSelectedSubcategory(subcat.name);
    setSelectedSubcategoryId(subcat.id);
  };

  const handleCountrySelect = (country: Country | null) => {
    if (country) {
      setSelectedCountry(country.name);
      setSelectedCountryId(country.id);
    } else {
      setSelectedCountry('All Countries');
      setSelectedCountryId(null);
    }
    setShowCountryPicker(false);
    setCountrySearchQuery('');
  };

  const filteredCountries = countries.filter(c => 
    c.name.toLowerCase().includes(countrySearchQuery.toLowerCase())
  );

  const renderPost = ({ item }: { item: Post }) => {
    const thumbnailUrl = item.image || (item as any).thumbnail || '';
    const videoUrl = item.video_url || '';
    const isVideo = !!videoUrl;
    const previewUrl = isVideo ? (thumbnailUrl || videoUrl) : (item.image || '');

    return (
      <TouchableOpacity
        style={styles.postCard}
        onPress={() => router.push({
          pathname: '/post/[id]',
          params: { id: item.id }
        })}
      >
        {previewUrl ? (
          <Image
            source={{ uri: previewUrl }}
            style={styles.postMedia}
            resizeMode="cover"
          />
        ) : (
          <View style={[styles.postMedia, { backgroundColor: '#1a1a1a', justifyContent: 'center', alignItems: 'center' }]}>
            <MaterialIcons name="broken-image" size={32} color="#666" />
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

  const renderUser = ({ item }: { item: User }) => (
    <TouchableOpacity
      style={styles.userRow}
      onPress={() => router.push({
        pathname: '/user/[id]',
        params: { id: item.id }
      })}
    >
      <Image
        source={{ uri: item.profile_picture || 'https://via.placeholder.com/50' }}
        style={styles.userAvatar}
      />
      <View style={styles.userInfo}>
        <Text style={styles.userName}>{item.name || item.username}</Text>
        <Text style={styles.userHandle}>@{item.username}</Text>
      </View>
      {user && user.id !== item.id && (
        <TouchableOpacity
          style={[
            styles.followButton,
            followedUsers.has(item.id) && styles.followingButton
          ]}
          onPress={() => handleFollow(item.id)}
        >
          <Text style={[
            styles.followButtonText,
            followedUsers.has(item.id) && styles.followingButtonText
          ]}>
            {followedUsers.has(item.id) ? 'Following' : 'Follow'}
          </Text>
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );

  // Get active filter count for badge
  const getActiveFilterCount = () => {
    let count = 0;
    if (selectedCategory !== 'All') count++;
    if (selectedSubcategory) count++;
    if (selectedCountryId) count++;
    return count;
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <View style={styles.searchBar}>
          <Feather name="search" size={20} color="#666" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search users, videos, trends..."
            placeholderTextColor="#666"
            value={searchQuery}
            onChangeText={setSearchQuery}
            returnKeyType="search"
            onSubmitEditing={() => {
              setIsSearching(true);
              performSearch();
            }}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => {
              setSearchQuery('');
              setIsSearching(false);
              Keyboard.dismiss();
            }}>
              <Feather name="x" size={18} color="#666" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {isSearching && (
        <View style={styles.tabsContainer}>
          {SEARCH_TABS.map((tab) => (
            <TouchableOpacity
              key={tab.key}
              style={[styles.tab, activeSearchTab === tab.key && styles.tabActive]}
              onPress={() => setActiveSearchTab(tab.key)}
            >
              <Text style={[styles.tabText, activeSearchTab === tab.key && styles.tabTextActive]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {loading && !refreshing ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#60a5fa" />
        </View>
      ) : (
        <ScrollView
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#60a5fa" />
          }
        >
          {!isSearching && (
            <>
              {/* Filter Section Header */}
              <View style={styles.filterHeader}>
                <Text style={styles.filterTitle}>Explore Talents</Text>
                {getActiveFilterCount() > 0 && (
                  <TouchableOpacity 
                    style={styles.clearFiltersButton}
                    onPress={() => {
                      setSelectedCategory('All');
                      setSelectedCategoryId(null);
                      setSelectedSubcategory('');
                      setSelectedSubcategoryId(null);
                      setSelectedCountry('All Countries');
                      setSelectedCountryId(null);
                    }}
                  >
                    <Text style={styles.clearFiltersText}>Clear filters ({getActiveFilterCount()})</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Country Filter */}
              <TouchableOpacity 
                style={styles.countrySelector}
                onPress={() => setShowCountryPicker(true)}
              >
                <MaterialIcons name="public" size={20} color="#60a5fa" />
                <Text style={styles.countrySelectorText}>{selectedCountry}</Text>
                <Feather name="chevron-down" size={20} color="#666" />
              </TouchableOpacity>

              {/* Categories */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.categoriesContainer}
                contentContainerStyle={styles.categoriesContent}
              >
                {categories.map((cat) => {
                  const isSelected = selectedCategory === cat.name;
                  return (
                    <TouchableOpacity
                      key={cat.id || cat.name}
                      style={[styles.categoryPill, isSelected && styles.categoryPillActive]}
                      onPress={() => handleCategorySelect(cat)}
                    >
                      <Text style={[styles.categoryPillText, isSelected && styles.categoryPillTextActive]}>
                        {cat.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {/* Subcategories */}
              {subcategories.length > 0 && (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.subcategoriesContainer}
                  contentContainerStyle={styles.categoriesContent}
                >
                  <TouchableOpacity
                    style={[styles.subcategoryPill, !selectedSubcategory && styles.subcategoryPillActive]}
                    onPress={() => {
                      setSelectedSubcategory('');
                      setSelectedSubcategoryId(null);
                    }}
                  >
                    <Text style={[styles.subcategoryPillText, !selectedSubcategory && styles.subcategoryPillTextActive]}>
                      All {selectedCategory}
                    </Text>
                  </TouchableOpacity>
                  {subcategories.map((subcat) => {
                    const isSelected = selectedSubcategory === subcat.name;
                    return (
                      <TouchableOpacity
                        key={subcat.id}
                        style={[styles.subcategoryPill, isSelected && styles.subcategoryPillActive]}
                        onPress={() => handleSubcategorySelect(subcat)}
                      >
                        <Text style={[styles.subcategoryPillText, isSelected && styles.subcategoryPillTextActive]}>
                          {subcat.name}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              )}

              {/* Active Filters Display */}
              {getActiveFilterCount() > 0 && (
                <View style={styles.activeFiltersContainer}>
                  <Text style={styles.activeFiltersLabel}>Showing:</Text>
                  <View style={styles.activeFilterTags}>
                    {selectedCategory !== 'All' && (
                      <View style={styles.activeFilterTag}>
                        <Text style={styles.activeFilterTagText}>{selectedCategory}</Text>
                      </View>
                    )}
                    {selectedSubcategory && (
                      <View style={styles.activeFilterTag}>
                        <Text style={styles.activeFilterTagText}>{selectedSubcategory}</Text>
                      </View>
                    )}
                    {selectedCountryId && (
                      <View style={styles.activeFilterTag}>
                        <MaterialIcons name="public" size={12} color="#60a5fa" />
                        <Text style={styles.activeFilterTagText}>{selectedCountry}</Text>
                      </View>
                    )}
                  </View>
                </View>
              )}

              {/* Suggestions */}
              {suggestions.length > 0 && !selectedCategoryId && !selectedCountryId && (
                <View style={styles.suggestionsSection}>
                  <Text style={styles.sectionTitle}>Suggested for you</Text>
                  <FlatList
                    data={suggestions}
                    renderItem={({ item }) => (
                      <View style={styles.suggestionCard}>
                        <TouchableOpacity onPress={() => router.push({ pathname: '/user/[id]', params: { id: item.id } })}>
                          <Image source={{ uri: item.profile_picture || 'https://via.placeholder.com/80' }} style={styles.suggestionAvatar} />
                          <Text style={styles.suggestionName} numberOfLines={1}>{item.username}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.suggestionFollowButton, followedUsers.has(item.id) && styles.suggestionFollowingButton]}
                          onPress={() => handleFollow(item.id)}
                        >
                          <Text style={[styles.suggestionFollowText, followedUsers.has(item.id) && styles.suggestionFollowingText]}>
                            {followedUsers.has(item.id) ? 'Following' : 'Follow'}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    )}
                    keyExtractor={(item) => item.id}
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.suggestionsList}
                  />
                </View>
              )}
            </>
          )}

          {/* Results Grid / List */}
          <View style={styles.resultsContainer}>
            {loadingPosts && (
              <View style={styles.loadingOverlay}>
                <ActivityIndicator size="small" color="#60a5fa" />
              </View>
            )}
            {isSearching ? (
              <>
                {activeSearchTab === 'top' && (
                  <>
                    {users.length > 0 && (
                      <View style={styles.searchSection}>
                        <Text style={styles.sectionTitle}>People</Text>
                        <FlatList
                          data={users}
                          renderItem={renderUser}
                          keyExtractor={(item) => item.id}
                          scrollEnabled={false}
                        />
                      </View>
                    )}
                    {posts.length > 0 && (
                      <View style={styles.searchSection}>
                        <Text style={styles.sectionTitle}>Videos</Text>
                        <FlatList
                          data={posts}
                          renderItem={renderPost}
                          keyExtractor={(item) => item.id}
                          numColumns={3}
                          scrollEnabled={false}
                          contentContainerStyle={styles.postsGrid}
                        />
                      </View>
                    )}
                    {users.length === 0 && posts.length === 0 && searchQuery.length > 0 && (
                      <View style={styles.emptyContainer}>
                        <Feather name="search" size={48} color="#666" />
                        <Text style={styles.emptyText}>No results found</Text>
                        <Text style={styles.emptySubtext}>Try searching for something else</Text>
                      </View>
                    )}
                  </>
                )}
                {activeSearchTab === 'people' && (
                  <FlatList
                    data={users}
                    renderItem={renderUser}
                    keyExtractor={(item) => item.id}
                    scrollEnabled={false}
                    ListEmptyComponent={
                      <View style={styles.emptyContainer}>
                        <Text style={styles.emptyText}>No users found</Text>
                      </View>
                    }
                  />
                )}
                {activeSearchTab === 'videos' && (
                  <FlatList
                    data={posts}
                    renderItem={renderPost}
                    keyExtractor={(item) => item.id}
                    numColumns={3}
                    scrollEnabled={false}
                    contentContainerStyle={styles.postsGrid}
                    ListEmptyComponent={
                      <View style={styles.emptyContainer}>
                        <Feather name="video" size={48} color="#666" />
                        <Text style={styles.emptyText}>No videos found</Text>
                      </View>
                    }
                  />
                )}
              </>
            ) : (
              <FlatList
                data={posts}
                renderItem={renderPost}
                keyExtractor={(item) => item.id}
                numColumns={3}
                scrollEnabled={false}
                contentContainerStyle={styles.postsGrid}
                ListEmptyComponent={
                  <View style={styles.emptyContainer}>
                    <Feather name="video" size={48} color="#666" />
                    <Text style={styles.emptyText}>
                      {getActiveFilterCount() > 0 ? 'No talents found with these filters' : 'No posts found'}
                    </Text>
                    {getActiveFilterCount() > 0 && (
                      <TouchableOpacity 
                        style={styles.clearFiltersButtonEmpty}
                        onPress={() => {
                          setSelectedCategory('All');
                          setSelectedCategoryId(null);
                          setSelectedSubcategory('');
                          setSelectedSubcategoryId(null);
                          setSelectedCountry('All Countries');
                          setSelectedCountryId(null);
                        }}
                      >
                        <Text style={styles.clearFiltersTextEmpty}>Clear all filters</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                }
              />
            )}
          </View>
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
                style={[styles.countryItem, !selectedCountryId && styles.countryItemActive]}
                onPress={() => handleCountrySelect(null)}
              >
                <MaterialIcons name="public" size={24} color={!selectedCountryId ? "#60a5fa" : "#666"} />
                <Text style={[styles.countryItemText, !selectedCountryId && styles.countryItemTextActive]}>
                  All Countries
                </Text>
                {!selectedCountryId && <Feather name="check" size={20} color="#60a5fa" />}
              </TouchableOpacity>
              
              {filteredCountries.map((country) => (
                <TouchableOpacity
                  key={country.id}
                  style={[styles.countryItem, selectedCountryId === country.id && styles.countryItemActive]}
                  onPress={() => handleCountrySelect(country)}
                >
                  <Text style={styles.countryFlag}>{country.flag_emoji || '🏳️'}</Text>
                  <Text style={[styles.countryItemText, selectedCountryId === country.id && styles.countryItemTextActive]}>
                    {country.name}
                  </Text>
                  {selectedCountryId === country.id && <Feather name="check" size={20} color="#60a5fa" />}
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
    backgroundColor: '#000000',
  },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: '#000',
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
  tabsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  tab: {
    paddingVertical: 12,
    marginRight: 24,
  },
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: '#60a5fa',
  },
  tabText: {
    color: '#666',
    fontSize: 15,
    fontWeight: '500',
  },
  tabTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  filterHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  filterTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  clearFiltersButton: {
    padding: 8,
  },
  clearFiltersText: {
    color: '#60a5fa',
    fontSize: 13,
    fontWeight: '500',
  },
  countrySelector: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    marginHorizontal: 16,
    marginBottom: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    gap: 10,
  },
  countrySelectorText: {
    flex: 1,
    color: '#fff',
    fontSize: 15,
    fontWeight: '500',
  },
  categoriesContainer: {
    marginBottom: 8,
  },
  categoriesContent: {
    paddingHorizontal: 16,
  },
  categoryPill: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: '#1a1a1a',
    marginRight: 8,
  },
  categoryPillActive: {
    backgroundColor: '#60a5fa',
  },
  categoryPillText: {
    color: '#999',
    fontSize: 14,
    fontWeight: '500',
  },
  categoryPillTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  subcategoriesContainer: {
    marginBottom: 12,
  },
  subcategoryPill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: '#252525',
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#333',
  },
  subcategoryPillActive: {
    backgroundColor: 'rgba(96, 165, 250, 0.2)',
    borderColor: '#60a5fa',
  },
  subcategoryPillText: {
    color: '#888',
    fontSize: 13,
    fontWeight: '500',
  },
  subcategoryPillTextActive: {
    color: '#60a5fa',
    fontWeight: '600',
  },
  activeFiltersContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 16,
    gap: 8,
  },
  activeFiltersLabel: {
    color: '#666',
    fontSize: 13,
  },
  activeFilterTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  activeFilterTag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(96, 165, 250, 0.15)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  activeFilterTagText: {
    color: '#60a5fa',
    fontSize: 12,
    fontWeight: '500',
  },
  suggestionsSection: {
    marginBottom: 24,
  },
  sectionTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  searchSection: {
    marginBottom: 24,
  },
  suggestionsList: {
    paddingHorizontal: 16,
  },
  suggestionCard: {
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 12,
    marginRight: 12,
    width: 110,
  },
  suggestionAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    marginBottom: 8,
  },
  suggestionName: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
    textAlign: 'center',
  },
  suggestionFollowButton: {
    backgroundColor: '#60a5fa',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
  },
  suggestionFollowingButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#666',
  },
  suggestionFollowText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '600',
  },
  suggestionFollowingText: {
    color: '#666',
  },
  resultsContainer: {
    flex: 1,
    position: 'relative',
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  postsGrid: {
    padding: 1,
  },
  postCard: {
    width: (screenWidth - 5) / 3,
    height: (screenWidth - 5) / 3 * 1.5,
    margin: 1,
    backgroundColor: '#1a1a1a',
  },
  postMedia: {
    width: '100%',
    height: '100%',
  },
  postOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  postStats: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  postStatText: {
    color: '#fff',
    fontSize: 11,
    marginLeft: 4,
  },
  playIcon: {
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 8,
    padding: 2,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  userAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginRight: 12,
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  userHandle: {
    color: '#666',
    fontSize: 13,
  },
  followButton: {
    backgroundColor: '#60a5fa',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 16,
  },
  followingButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#666',
  },
  followButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  followingButtonText: {
    color: '#666',
  },
  loadingContainer: {
    flex: 1,
    paddingVertical: 40,
    alignItems: 'center',
    justifyContent: 'center',
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
  clearFiltersButtonEmpty: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#60a5fa',
    borderRadius: 20,
  },
  clearFiltersTextEmpty: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  // Modal styles
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
