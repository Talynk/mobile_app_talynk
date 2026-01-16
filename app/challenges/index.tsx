import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Image,
  useColorScheme,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { challengesApi } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { MaterialIcons, Feather } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Avatar } from '@/components/Avatar';

const COLORS = {
  light: {
    background: '#f5f5f5',
    card: '#fff',
    border: '#e5e7eb',
    text: '#222',
    textSecondary: '#666',
    primary: '#007AFF',
    success: '#10b981',
    warning: '#f59e0b',
  },
  dark: {
    background: '#0a0a0a',
    card: '#1a1a1a',
    border: '#2a2a2a',
    text: '#f3f4f6',
    textSecondary: '#9ca3af',
    primary: '#60a5fa',
    success: '#34d399',
    warning: '#fbbf24',
  },
};

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'joined', label: 'Joined' },
  { key: 'my', label: 'My Challenges' },
];

export default function ChallengesScreen() {
  const { user, isAuthenticated } = useAuth();
  const colorScheme = useColorScheme() || 'dark';
  const C = COLORS[colorScheme];
  
  const [activeTab, setActiveTab] = useState('all');
  const [challenges, setChallenges] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchChallenges = async () => {
    setLoading(true);
    setError(null);
    
    try {
      let response;
      
      if (activeTab === 'all') {
        response = await challengesApi.getAll('active');
      } else if (activeTab === 'joined') {
        response = await challengesApi.getJoinedChallenges();
      } else if (activeTab === 'my') {
        response = await challengesApi.getMyChallenges();
      }
      
      if (response?.status === 'success') {
        let challengesList = [];
        
        if (Array.isArray(response.data)) {
          challengesList = response.data;
        } else if (response.data?.challenges) {
          challengesList = response.data.challenges;
        } else if (Array.isArray(response.data)) {
          // For joined challenges, extract challenge from participation
          challengesList = response.data.map((item: any) => item.challenge || item);
        }
        
        // When showing 'all' tab, ensure we include both 'active' and 'approved' statuses
        if (activeTab === 'all') {
          challengesList = challengesList.filter((ch: any) => 
            ch.status === 'active' || ch.status === 'approved'
          );
        }
        
        setChallenges(challengesList);
      } else {
        setError(response?.message || 'Failed to fetch challenges');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch challenges');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchChallenges();
  }, [activeTab]);

  useFocusEffect(
    useCallback(() => {
      fetchChallenges();
    }, [activeTab])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchChallenges();
    setRefreshing(false);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: 'numeric'
    });
  };

  const getChallengeStatus = (challenge: any) => {
    // Use is_currently_active field from API if available
    if (challenge.is_currently_active !== undefined) {
      if (challenge.is_currently_active) {
        return { label: 'Active', color: C.success };
      } else {
        const now = new Date();
        const startDate = new Date(challenge.start_date);
        const endDate = new Date(challenge.end_date);
        
        if (now < startDate) return { label: 'Upcoming', color: C.warning };
        if (now > endDate) return { label: 'Ended', color: C.textSecondary };
        return { label: 'Inactive', color: C.textSecondary };
      }
    }
    
    // Fallback to date-based logic if is_currently_active not available
    const now = new Date();
    const startDate = new Date(challenge.start_date);
    const endDate = new Date(challenge.end_date);
    
    if (now < startDate) return { label: 'Upcoming', color: C.warning };
    if (now > endDate) return { label: 'Ended', color: C.textSecondary };
    return { label: 'Active', color: C.success };
  };

  const getDateInfo = (challenge: any) => {
    const now = new Date();
    const startDate = new Date(challenge.start_date);
    const endDate = new Date(challenge.end_date);
    
    if (now >= startDate && now <= endDate) {
      // Challenge has started
      return {
        label: 'Started on',
        date: startDate,
        showEndDate: true,
        endDate: endDate,
      };
    } else if (now < startDate) {
      // Challenge hasn't started yet
      return {
        label: 'Starts on',
        date: startDate,
        showEndDate: true,
        endDate: endDate,
      };
    } else {
      // Challenge has ended
      return {
        label: 'Ended on',
        date: endDate,
        showEndDate: false,
        endDate: endDate,
      };
    }
  };

  const renderChallenge = ({ item }: { item: any }) => {
    const status = getChallengeStatus(item);
    const dateInfo = getDateInfo(item);
    const participantCount = item._count?.participants || item.participant_count || 0;
    const postCount = item._count?.posts || item.post_count || 0;
    const organizer = item.organizer || {};
    const organizerName = organizer.display_name || organizer.username || item.organizer_name || 'Unknown';
    const organizerUsername = organizer.username || '';
    
    return (
      <TouchableOpacity
        style={[styles.challengeCard, { backgroundColor: C.card, borderColor: C.border }]}
        onPress={() => router.push({
          pathname: '/challenges/[id]',
          params: { id: item.id }
        })}
        activeOpacity={0.8}
      >
        <LinearGradient
          colors={item.has_rewards ? ['#f59e0b', '#d97706'] : ['#3b82f6', '#2563eb']}
          style={styles.cardHeader}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
        >
          <View style={styles.headerContentWrapper}>
            <Text style={[styles.challengeName, { color: '#fff' }]} numberOfLines={2}>
              {item.name}
            </Text>
            <View style={styles.badgesContainer}>
              {item.has_rewards && (
                <View style={styles.rewardBadge}>
                  <MaterialIcons name="emoji-events" size={14} color="#fff" />
                  <Text style={styles.rewardBadgeText}>Rewards: {item.rewards || 'Available'}</Text>
                </View>
              )}
              <View style={[styles.statusBadge, { backgroundColor: status.color }]}>
                <Text style={styles.statusText}>{status.label}</Text>
              </View>
            </View>
          </View>
        </LinearGradient>
        
        <View style={styles.cardContent}>
          
          {item.description && (
            <Text style={[styles.challengeDescription, { color: C.textSecondary }]} numberOfLines={3}>
              {item.description}
            </Text>
          )}
          
          <View style={styles.challengeMeta}>
            <View style={styles.metaItem}>
              <MaterialIcons name="people" size={16} color={C.textSecondary} />
              <Text style={[styles.metaText, { color: C.textSecondary }]}>
                {participantCount} {participantCount === 1 ? 'participant' : 'participants'}
              </Text>
            </View>
            <View style={styles.metaItem}>
              <MaterialIcons name="video-library" size={16} color={C.textSecondary} />
              <Text style={[styles.metaText, { color: C.textSecondary }]}>
                {postCount} {postCount === 1 ? 'post' : 'posts'}
              </Text>
            </View>
          </View>
          
          {/* Date Information */}
          <View style={styles.dateRow}>
            <MaterialIcons name="event" size={14} color={C.textSecondary} />
            <View style={styles.dateInfo}>
              <Text style={[styles.dateLabel, { color: C.textSecondary }]}>
                {dateInfo.label} {formatDate(dateInfo.date.toISOString())}
              </Text>
              {dateInfo.showEndDate && (
                <Text style={[styles.dateText, { color: C.textSecondary }]}>
                  Ends {formatDate(dateInfo.endDate.toISOString())}
                </Text>
              )}
            </View>
          </View>
          
          {/* Organizer Information */}
          {(item.organizer || item.organizer_name) && (
            <TouchableOpacity
              style={styles.organizerRow}
              onPress={() => {
                if (organizer.id) {
                  router.push({
                    pathname: '/user/[id]',
                    params: { id: organizer.id }
                  });
                }
              }}
              activeOpacity={0.7}
            >
              <Avatar
                user={item.organizer || { profile_picture: null, username: item.organizer_name }}
                size={28}
                style={styles.organizerAvatar}
              />
              <View style={styles.organizerInfo}>
                <Text style={[styles.organizerName, { color: C.text }]} numberOfLines={1}>
                  {organizerName}
                </Text>
                {organizerUsername && (
                  <Text style={[styles.organizerUsername, { color: C.textSecondary }]} numberOfLines={1}>
                    @{organizerUsername}
                  </Text>
                )}
              </View>
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: C.background }]} edges={['top']}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: C.border }]}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <MaterialIcons name="arrow-back" size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: C.text }]}>Challenges</Text>
        <View style={styles.headerSpacer} />
      </View>

      {/* Tabs */}
      <View style={[styles.tabBar, { backgroundColor: C.card, borderBottomColor: C.border }]}>
        {TABS.map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[
              styles.tabButton,
              activeTab === tab.key && { borderBottomColor: C.primary, borderBottomWidth: 2 }
            ]}
            onPress={() => setActiveTab(tab.key)}
          >
            <Text style={[
              styles.tabLabel,
              { color: activeTab === tab.key ? C.primary : C.textSecondary }
            ]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Content */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={C.primary} />
          <Text style={[styles.loadingText, { color: C.textSecondary }]}>Loading challenges...</Text>
        </View>
      ) : error ? (
        <View style={styles.errorContainer}>
          <MaterialIcons name="error-outline" size={48} color={C.textSecondary} />
          <Text style={[styles.errorText, { color: C.textSecondary }]}>{error}</Text>
          <TouchableOpacity
            style={[styles.retryButton, { backgroundColor: C.primary }]}
            onPress={fetchChallenges}
          >
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={challenges}
          renderItem={renderChallenge}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContainer}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={C.primary}
              colors={[C.primary]}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <MaterialIcons name="emoji-events" size={64} color={C.textSecondary} />
              <Text style={[styles.emptyText, { color: C.textSecondary }]}>
                {activeTab === 'joined' 
                  ? "You haven't joined any challenges yet"
                  : activeTab === 'my'
                    ? "You haven't created any challenges"
                    : "No challenges available"}
              </Text>
              {activeTab === 'all' && (
                <Text style={[styles.emptySubtext, { color: C.textSecondary }]}>
                  Check back later for new challenges!
                </Text>
              )}
            </View>
          }
        />
      )}
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
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    flex: 1,
    textAlign: 'center',
  },
  headerSpacer: {
    width: 40,
  },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
  },
  tabLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  listContainer: {
    padding: 16,
  },
  challengeCard: {
    borderRadius: 16,
    marginBottom: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  cardHeader: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    minHeight: 80,
  },
  headerContentWrapper: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
    gap: 8,
  },
  badgesContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: 4,
    flexShrink: 0,
    width: 180,
  },
  rewardBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    flexShrink: 0,
    width: 87,
    maxWidth: 87,
  },
  rewardBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 4,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    flexShrink: 0,
    width: 87,
    maxWidth: 87,
  },
  statusText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  cardContent: {
    padding: 16,
  },
  challengeName: {
    fontSize: 18,
    fontWeight: '700',
    flex: 1,
    marginRight: 8,
    minWidth: 0,
  },
  challengeDescription: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 12,
  },
  challengeMeta: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 20,
  },
  metaText: {
    fontSize: 13,
    marginLeft: 6,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  dateText: {
    fontSize: 13,
    marginLeft: 6,
  },
  organizerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  organizerAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    marginRight: 8,
  },
  organizerText: {
    fontSize: 13,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  errorText: {
    marginTop: 12,
    fontSize: 16,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 16,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    marginTop: 16,
    fontSize: 16,
    textAlign: 'center',
  },
  emptySubtext: {
    marginTop: 8,
    fontSize: 14,
    textAlign: 'center',
  },
});
