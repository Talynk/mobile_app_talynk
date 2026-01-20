import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
  Modal,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { challengesApi } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { MaterialIcons, Feather } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Avatar } from '@/components/Avatar';
import CreateChallengeModal from '@/components/CreateChallengeModal';

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

const TABS: Array<{ key: 'my' | 'joined' | 'not_joined'; label: string }> = [
  { key: 'my', label: 'Created by Me' },
  { key: 'joined', label: 'Joined' },
  { key: 'not_joined', label: 'Not Joined' },
];

export default function ChallengesScreen() {
  const { user, isAuthenticated } = useAuth();
  const colorScheme = useColorScheme() || 'dark';
  const C = COLORS[colorScheme];
  
  const [activeTab, setActiveTab] = useState<'my' | 'joined' | 'not_joined'>('not_joined');
  const [allChallenges, setAllChallenges] = useState<any[]>([]);
  const [joinedChallenges, setJoinedChallenges] = useState<any[]>([]);
  const [myChallenges, setMyChallenges] = useState<any[]>([]);
  const [notJoinedChallenges, setNotJoinedChallenges] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [participantsModalVisible, setParticipantsModalVisible] = useState(false);
  const [selectedChallengeId, setSelectedChallengeId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<any[]>([]);
  const [loadingParticipants, setLoadingParticipants] = useState(false);

  const normalizeChallenges = (response: any) => {
    if (!response) return [];
    if (Array.isArray(response.data)) return response.data;
    if (response.data?.challenges) return response.data.challenges;
    if (Array.isArray(response)) return response;
    if (response.data) return response.data;
    return [];
  };

  const fetchChallenges = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const [allRes, joinedRes, myRes] = await Promise.all([
        challengesApi.getAll('active'),
        isAuthenticated ? challengesApi.getJoinedChallenges() : Promise.resolve(null),
        isAuthenticated ? challengesApi.getMyChallenges() : Promise.resolve(null),
      ]);

      if (allRes?.status !== 'success') {
        setError(allRes?.message || 'Failed to fetch challenges');
        setLoading(false);
        return;
      }

      const allListRaw = normalizeChallenges(allRes);
      const allList = allListRaw.filter((ch: any) => ch.status === 'active' || ch.status === 'approved');

      const joinedListRaw = joinedRes?.status === 'success' ? normalizeChallenges(joinedRes) : [];
      const joinedList = joinedListRaw.map((item: any) => item.challenge || item);

      const myListRaw = myRes?.status === 'success' ? normalizeChallenges(myRes) : [];
      const myList = myListRaw.map((item: any) => item.challenge || item);

      const joinedIds = new Set(joinedList.map((c: any) => c.id));
      const myIds = new Set([
        ...myList.map((c: any) => c.id),
        ...allList
          .filter((c: any) => c.organizer_id === user?.id || c.organizer?.id === user?.id)
          .map((c: any) => c.id),
      ]);

      const notJoined = allList.filter(
        (c: any) => !joinedIds.has(c.id) && !myIds.has(c.id)
      );

      setAllChallenges(allList);
      setJoinedChallenges(joinedList);
      setMyChallenges(myList);
      setNotJoinedChallenges(notJoined);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch challenges');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchChallenges();
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchChallenges();
    }, [])
  );

  const visibleChallenges = useMemo(() => {
    if (activeTab === 'joined') return joinedChallenges;
    if (activeTab === 'my') return myChallenges;
    return notJoinedChallenges;
  }, [activeTab, joinedChallenges, myChallenges, notJoinedChallenges]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchChallenges();
    setRefreshing(false);
  };

  const loadParticipants = async (challengeId: string) => {
    setLoadingParticipants(true);
    try {
      const response = await challengesApi.getParticipants(challengeId);
      if (response.status === 'success') {
        const participantsList = Array.isArray(response.data) ? response.data : [];
        setParticipants(participantsList.map((p: any) => p.user || p));
      } else {
        setParticipants([]);
      }
    } catch (err) {
      console.error('Error loading participants:', err);
      setParticipants([]);
    } finally {
      setLoadingParticipants(false);
    }
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
          colors={item.has_rewards ? ['#8b5cf6', '#7c3aed'] : ['#3b82f6', '#2563eb']}
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
                  <Text style={styles.rewardBadgeText} numberOfLines={1}>
                    {item.rewards || 'Rewards'}
                  </Text>
                </View>
              )}
              <View style={[styles.statusBadge, { backgroundColor: status.color }]}>
                <Text style={styles.statusText} numberOfLines={1}>{status.label}</Text>
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
            <TouchableOpacity 
              style={styles.metaItem}
              onPress={() => {
                setSelectedChallengeId(item.id);
                setParticipantsModalVisible(true);
                loadParticipants(item.id);
              }}
              activeOpacity={0.7}
            >
              <MaterialIcons name="people" size={16} color={C.textSecondary} />
              <Text style={[styles.metaText, { color: C.textSecondary }]}>
                {participantCount} {participantCount === 1 ? 'participant' : 'participants'}
              </Text>
            </TouchableOpacity>
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

      {/* Create + Tabs */}
      <View style={[styles.actionRow, { borderBottomColor: C.border, backgroundColor: C.card }]}>
        <TouchableOpacity
          style={[styles.createButton, { backgroundColor: C.primary }]}
          onPress={() => setCreateModalVisible(true)}
          activeOpacity={0.85}
        >
          <MaterialIcons name="add-circle-outline" size={20} color="#fff" />
          <Text style={styles.createButtonText}>Create Challenge</Text>
        </TouchableOpacity>
      </View>
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
          data={visibleChallenges}
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
                    : "No challenges available to join"}
              </Text>
            </View>
          }
        />
      )}

      {/* Participants Modal */}
      <Modal
        visible={participantsModalVisible}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setParticipantsModalVisible(false)}
      >
        <SafeAreaView style={[styles.modalContainer, { backgroundColor: C.background }]} edges={['top']}>
          <View style={[styles.modalHeader, { borderBottomColor: C.border }]}>
            <Text style={[styles.modalTitle, { color: C.text }]}>Participants</Text>
            <TouchableOpacity
              onPress={() => setParticipantsModalVisible(false)}
              style={styles.modalCloseButton}
            >
              <MaterialIcons name="close" size={24} color={C.text} />
            </TouchableOpacity>
          </View>

          {loadingParticipants ? (
            <View style={styles.modalLoadingContainer}>
              <ActivityIndicator size="large" color={C.primary} />
            </View>
          ) : participants.length === 0 ? (
            <View style={styles.modalEmptyContainer}>
              <MaterialIcons name="people-outline" size={64} color={C.textSecondary} />
              <Text style={[styles.modalEmptyText, { color: C.textSecondary }]}>
                No participants yet
              </Text>
            </View>
          ) : (
            <FlatList
              data={participants}
              keyExtractor={(item) => item.id || item.user_id}
              renderItem={({ item }) => {
                const participant = item.user || item;
                return (
                  <TouchableOpacity
                    style={[styles.participantItem, { borderBottomColor: C.border }]}
                    onPress={() => {
                      setParticipantsModalVisible(false);
                      router.push({
                        pathname: '/user/[id]',
                        params: { id: participant.id }
                      });
                    }}
                    activeOpacity={0.7}
                  >
                    <Avatar user={participant} size={48} style={styles.participantAvatar} />
                    <View style={styles.participantInfo}>
                      <Text style={[styles.participantName, { color: C.text }]} numberOfLines={1}>
                        {participant.display_name || participant.username || 'Unknown'}
                      </Text>
                      {participant.username && (
                        <Text style={[styles.participantUsername, { color: C.textSecondary }]} numberOfLines={1}>
                          @{participant.username}
                        </Text>
                      )}
                    </View>
                    {item.post_count !== undefined && (
                      <View style={styles.participantStats}>
                        <Text style={[styles.participantPostCount, { color: C.textSecondary }]}>
                          {item.post_count} {item.post_count === 1 ? 'post' : 'posts'}
                        </Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              }}
              contentContainerStyle={styles.modalListContainer}
            />
          )}
        </SafeAreaView>
      </Modal>

      <CreateChallengeModal
        visible={createModalVisible}
        onClose={() => setCreateModalVisible(false)}
        onCreated={() => {
          setCreateModalVisible(false);
          fetchChallenges();
        }}
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
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    gap: 12,
  },
  createButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    gap: 8,
  },
  createButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
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
    flexShrink: 1,
    maxWidth: '100%',
  },
  rewardBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
    marginLeft: 4,
    maxWidth: 100,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    flexShrink: 0,
    alignSelf: 'flex-start',
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
  dateLabel: {
    fontSize: 13,
    marginLeft: 6,
  },
  dateInfo: {
    marginLeft: 6,
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
    width: 28,
    height: 28,
    borderRadius: 14,
    marginRight: 8,
  },
  organizerInfo: {
    flex: 1,
  },
  organizerName: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 2,
  },
  organizerUsername: {
    fontSize: 12,
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
  modalContainer: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  modalCloseButton: {
    padding: 8,
  },
  modalLoadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalEmptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  modalEmptyText: {
    fontSize: 16,
    marginTop: 16,
  },
  modalListContainer: {
    padding: 16,
  },
  participantItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  participantAvatar: {
    marginRight: 12,
  },
  participantInfo: {
    flex: 1,
  },
  participantName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  participantUsername: {
    fontSize: 14,
  },
  participantStats: {
    marginLeft: 12,
  },
  participantPostCount: {
    fontSize: 14,
  },
});
