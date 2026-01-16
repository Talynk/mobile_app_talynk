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
  Alert,
  ScrollView,
  Dimensions,
  Modal,
} from 'react-native';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { challengesApi, postsApi } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { MaterialIcons, Feather } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Video, ResizeMode } from 'expo-av';
import { Avatar } from '@/components/Avatar';

const { width: screenWidth } = Dimensions.get('window');

const COLORS = {
  dark: {
    background: '#000000',
    card: '#1a1a1a',
    border: '#2a2a2a',
    text: '#f3f4f6',
    textSecondary: '#9ca3af',
    primary: '#60a5fa',
    success: '#34d399',
    warning: '#fbbf24',
    error: '#f87171',
    inputBg: '#232326',
    inputBorder: '#27272a',
    buttonBg: '#60a5fa',
    buttonText: '#fff',
  },
};

export default function ChallengeDetailScreen() {
  const { id } = useLocalSearchParams();
  const { user, isAuthenticated } = useAuth();
  const C = COLORS.dark; // Always use dark mode
  
  const [challenge, setChallenge] = useState<any>(null);
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [postsLoading, setPostsLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [activePostIndex, setActivePostIndex] = useState(0);
  const [participantsModalVisible, setParticipantsModalVisible] = useState(false);
  const [participants, setParticipants] = useState<any[]>([]);
  const [loadingParticipants, setLoadingParticipants] = useState(false);

  const fetchChallenge = async () => {
    if (!id) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const response = await challengesApi.getById(id as string);
      
      if (response?.status === 'success' && response.data) {
        setChallenge(response.data);
      } else {
        setError(response?.message || 'Failed to fetch challenge');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch challenge');
    } finally {
      setLoading(false);
    }
  };

  const fetchPosts = async () => {
    if (!id) return;
    
    setPostsLoading(true);
    
    try {
      const response = await challengesApi.getPosts(id as string, 1, 20);
      
      if (response?.status === 'success') {
        const postsList = response.data?.posts || [];
        // Extract post from challengePost wrapper if needed
        const normalizedPosts = postsList.map((item: any) => item.post || item);
        setPosts(normalizedPosts);
      }
    } catch (err: any) {
      console.error('Error fetching challenge posts:', err);
    } finally {
      setPostsLoading(false);
    }
  };

  useEffect(() => {
    fetchChallenge();
    fetchPosts();
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      fetchChallenge();
      fetchPosts();
    }, [id])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchChallenge(), fetchPosts()]);
    setRefreshing(false);
  };

  const handleJoinChallenge = async () => {
    if (!isAuthenticated) {
      Alert.alert('Login Required', 'Please login to join challenges', [
        { text: 'Cancel' },
        { text: 'Login', onPress: () => router.push('/auth/login') }
      ]);
      return;
    }
    
    if (!id) {
      Alert.alert('Error', 'Challenge ID is missing');
      return;
    }
    
    setJoining(true);
    
    try {
      console.log('[Challenge] Joining challenge:', id);
      const response = await challengesApi.join(id as string);
      console.log('[Challenge] Join response:', response);
      
      if (response?.status === 'success') {
        Alert.alert('Success', response.message || 'You have joined the challenge!', [
          { text: 'OK', onPress: () => {
            // Refresh challenge data to update is_participant status
            fetchChallenge();
            // Also refresh joined challenges in create screen if needed
          }}
        ]);
      } else {
        const errorMessage = response?.message || 'Failed to join challenge';
        console.error('[Challenge] Join failed:', errorMessage);
        
        // Handle specific error messages with user-friendly text
        let alertTitle = 'Cannot Join Challenge';
        let alertMessage = errorMessage;
        
        if (errorMessage.toLowerCase().includes('not started')) {
          alertTitle = 'Challenge Not Started';
          alertMessage = 'This challenge has not started yet. Please wait until the start date to join.';
        } else if (errorMessage.toLowerCase().includes('already ended') || errorMessage.toLowerCase().includes('has ended')) {
          alertTitle = 'Challenge Ended';
          alertMessage = 'This challenge has already ended. You cannot join it anymore.';
        } else if (errorMessage.toLowerCase().includes('already a participant') || errorMessage.toLowerCase().includes('already joined')) {
          alertTitle = 'Already Joined';
          alertMessage = 'You have already joined this challenge.';
        } else if (errorMessage.toLowerCase().includes('cannot join own challenge') || errorMessage.toLowerCase().includes('organizer')) {
          alertTitle = 'Cannot Join';
          alertMessage = 'You cannot join a challenge that you organized.';
        } else if (errorMessage.toLowerCase().includes('not available')) {
          alertTitle = 'Challenge Not Available';
          alertMessage = 'This challenge is not available for joining at this time.';
        }
        
        Alert.alert(alertTitle, alertMessage);
      }
    } catch (err: any) {
      console.error('[Challenge] Join error:', err);
      const errorMessage = err.response?.data?.message || err.message || 'Failed to join challenge';
      
      // Handle specific error messages
      let alertTitle = 'Error';
      let alertText = errorMessage;
      
      if (errorMessage.toLowerCase().includes('not started')) {
        alertTitle = 'Challenge Not Started';
        alertText = 'This challenge has not started yet. Please wait until the start date to join.';
      } else if (errorMessage.toLowerCase().includes('already ended')) {
        alertTitle = 'Challenge Ended';
        alertText = 'This challenge has already ended. You cannot join it anymore.';
      }
      
      Alert.alert(alertTitle, alertText);
    } finally {
      setJoining(false);
    }
  };

  const handleCreatePost = () => {
    if (!challenge?.is_participant) {
      Alert.alert('Join Required', 'You must join the challenge before posting');
      return;
    }
    
    // Navigate to create post with challenge context
    router.push({
      pathname: '/(tabs)/create',
      params: { challengeId: id as string, challengeName: challenge.name }
    });
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      month: 'long', 
      day: 'numeric',
      year: 'numeric'
    });
  };

  const getChallengeStatus = () => {
    if (!challenge) return { label: 'Unknown', color: C.textSecondary };
    
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
    
    // Fallback to date-based logic
    const now = new Date();
    const startDate = new Date(challenge.start_date);
    const endDate = new Date(challenge.end_date);
    
    if (now < startDate) return { label: 'Upcoming', color: C.warning };
    if (now > endDate) return { label: 'Ended', color: C.textSecondary };
    return { label: 'Active', color: C.success };
  };

  const isActive = () => {
    if (!challenge) return false;
    
    // Use is_currently_active field from API if available
    if (challenge.is_currently_active !== undefined) {
      return challenge.is_currently_active;
    }
    
    // Fallback to date-based logic
    const now = new Date();
    const startDate = new Date(challenge.start_date);
    const endDate = new Date(challenge.end_date);
    return now >= startDate && now <= endDate;
  };

  const hasStarted = () => {
    if (!challenge) return false;
    const now = new Date();
    const startDate = new Date(challenge.start_date);
    return now >= startDate;
  };

  const canJoin = () => {
    if (!challenge) return false;
    // Can join if challenge is approved or active, and has started
    const status = challenge.status;
    return (status === 'approved' || status === 'active') && hasStarted() && !challenge.is_participant;
  };

  const getDateInfo = () => {
    if (!challenge) return null;
    
    const now = new Date();
    const startDate = new Date(challenge.start_date);
    const endDate = new Date(challenge.end_date);
    
    if (now >= startDate && now <= endDate) {
      return {
        label: 'Started on',
        date: startDate,
        showEndDate: true,
        endDate: endDate,
      };
    } else if (now < startDate) {
      return {
        label: 'Starts on',
        date: startDate,
        showEndDate: true,
        endDate: endDate,
      };
    } else {
      return {
        label: 'Ended on',
        date: endDate,
        showEndDate: false,
        endDate: endDate,
      };
    }
  };

  const isOrganizer = challenge?.organizer_id === user?.id;

  const renderPost = ({ item, index }: { item: any; index: number }) => {
    const videoUrl = item.video_url || item.videoUrl || '';
    const imageUrl = item.image || item.imageUrl || item.thumbnail_url || '';
    const isVideo = !!videoUrl;
    
    return (
      <TouchableOpacity
        style={[styles.postCard, { backgroundColor: C.card, borderColor: C.border }]}
        onPress={() => router.push({
          pathname: '/challenges/[id]/posts',
          params: { 
            id: id as string,
            initialPostId: item.id,
            initialIndex: index.toString()
          }
        })}
        activeOpacity={0.8}
      >
        <View style={styles.postMedia}>
          {isVideo ? (
            <>
              <Image
                source={{ uri: imageUrl || 'https://via.placeholder.com/200' }}
                style={styles.postImage}
                resizeMode="cover"
              />
              <View style={styles.playOverlay}>
                <MaterialIcons name="play-circle-outline" size={40} color="#fff" />
              </View>
            </>
          ) : (
            <Image
              source={{ uri: imageUrl || 'https://via.placeholder.com/200' }}
              style={styles.postImage}
              resizeMode="cover"
            />
          )}
        </View>
        
        <View style={styles.postInfo}>
          <Text style={[styles.postTitle, { color: C.text }]} numberOfLines={2}>
            {item.title || item.description || 'Untitled'}
          </Text>
          
          {item.user && (
            <View style={styles.postUser}>
              <Avatar
                user={item.user}
                size={20}
                style={styles.postUserAvatar}
              />
              <Text style={[styles.postUsername, { color: C.textSecondary }]}>
                {item.user.username}
              </Text>
            </View>
          )}
          
          <View style={styles.postStats}>
            <View style={styles.postStat}>
              <Feather name="heart" size={12} color={C.textSecondary} />
              <Text style={[styles.postStatText, { color: C.textSecondary }]}>
                {item.likes || item._count?.postLikes || 0}
              </Text>
            </View>
            <View style={styles.postStat}>
              <Feather name="message-circle" size={12} color={C.textSecondary} />
              <Text style={[styles.postStatText, { color: C.textSecondary }]}>
                {item.comments_count || item._count?.comments || 0}
              </Text>
            </View>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: C.background }]} edges={['top']}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={C.primary} />
          <Text style={[styles.loadingText, { color: C.textSecondary }]}>Loading challenge...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error || !challenge) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: C.background }]} edges={['top']}>
        <View style={[styles.header, { borderBottomColor: C.border }]}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <MaterialIcons name="arrow-back" size={24} color={C.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: C.text }]}>Challenge</Text>
          <View style={styles.headerSpacer} />
        </View>
        <View style={styles.errorContainer}>
          <MaterialIcons name="error-outline" size={48} color={C.textSecondary} />
          <Text style={[styles.errorText, { color: C.textSecondary }]}>{error || 'Challenge not found'}</Text>
          <TouchableOpacity
            style={[styles.retryButton, { backgroundColor: C.primary }]}
            onPress={fetchChallenge}
          >
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const status = getChallengeStatus();
  const participantCount = challenge._count?.participants || 0;
  const postCount = challenge._count?.posts || posts.length || 0;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: C.background }]} edges={['top']}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: C.border }]}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <MaterialIcons name="arrow-back" size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: C.text }]} numberOfLines={1}>
          {challenge.name}
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.scrollView}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={C.primary}
            colors={[C.primary]}
          />
        }
      >
        {/* Challenge Header */}
        <LinearGradient
          colors={challenge.has_rewards ? ['#f59e0b', '#d97706'] : ['#3b82f6', '#2563eb']}
          style={styles.challengeHeader}
        >
          <View style={styles.headerContentWrapper}>
            <Text style={styles.challengeTitle}>{challenge.name}</Text>
            <View style={styles.badgesContainer}>
              {challenge.has_rewards && (
                <View style={styles.rewardBadge}>
                  <MaterialIcons name="emoji-events" size={16} color="#fff" />
                  <Text style={styles.rewardBadgeText}>Has Rewards</Text>
                </View>
              )}
              <View style={[styles.statusBadge, { backgroundColor: status.color }]}>
                <Text style={styles.statusText}>{status.label}</Text>
              </View>
            </View>
          </View>
          
          <View style={[styles.statsRow, { marginTop: 20 }]}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{participantCount}</Text>
              <Text style={styles.statLabel}>Participants</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{postCount}</Text>
              <Text style={styles.statLabel}>Posts</Text>
            </View>
          </View>
        </LinearGradient>

        {/* Challenge Details */}
        <View style={[styles.detailsSection, { backgroundColor: C.card }]}>
          {challenge.description && (
            <View style={styles.detailBlock}>
              <Text style={[styles.detailLabel, { color: C.textSecondary }]}>Description</Text>
              <Text style={[styles.detailText, { color: C.text }]}>{challenge.description}</Text>
            </View>
          )}
          
          <View style={styles.detailBlock}>
            <Text style={[styles.detailLabel, { color: C.textSecondary }]}>Duration</Text>
            <Text style={[styles.detailText, { color: C.text }]}>
              {(() => {
                const dateInfo = getDateInfo();
                if (!dateInfo) return null;
                return (
                  <>
                    <Text>{dateInfo.label} {formatDate(dateInfo.date.toISOString())}</Text>
                    {dateInfo.showEndDate && (
                      <Text> • Ends {formatDate(dateInfo.endDate.toISOString())}</Text>
                    )}
                  </>
                );
              })()}
            </Text>
          </View>
          
          {challenge.has_rewards && challenge.rewards && (
            <View style={styles.detailBlock}>
              <Text style={[styles.detailLabel, { color: C.textSecondary }]}>Rewards</Text>
              <Text style={[styles.detailText, { color: C.text }]}>{challenge.rewards}</Text>
            </View>
          )}
          
          {challenge.scoring_criteria && (
            <View style={styles.detailBlock}>
              <Text style={[styles.detailLabel, { color: C.textSecondary }]}>Scoring Criteria</Text>
              <Text style={[styles.detailText, { color: C.text }]}>{challenge.scoring_criteria}</Text>
            </View>
          )}
          
          {challenge.organizer && (
            <View style={styles.organizerSection}>
              <Text style={[styles.detailLabel, { color: C.textSecondary }]}>Organizer</Text>
              <TouchableOpacity 
                style={styles.organizerInfo}
                onPress={() => router.push({
                  pathname: '/user/[id]',
                  params: { id: challenge.organizer.id }
                })}
              >
                <Avatar
                  user={challenge.organizer}
                  size={40}
                  style={styles.organizerAvatar}
                />
                <View>
                  <Text style={[styles.organizerName, { color: C.text }]}>
                    {challenge.organizer.display_name || challenge.organizer.username}
                  </Text>
                  <Text style={[styles.organizerUsername, { color: C.textSecondary }]}>
                    @{challenge.organizer.username}
                  </Text>
                </View>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Action Buttons */}
        {isOrganizer ? (
          // Organizer view - show organizer-specific actions
          <View style={[styles.actionsSection, { backgroundColor: C.card, borderTopColor: C.border }]}>
            <View style={styles.organizerActions}>
              <TouchableOpacity
                style={[styles.organizerActionButton, { backgroundColor: C.primary }]}
                onPress={async () => {
                  setParticipantsModalVisible(true);
                  setLoadingParticipants(true);
                  try {
                    const response = await challengesApi.getParticipants(id as string);
                    if (response?.status === 'success') {
                      const participantsList = response.data?.participants || response.data || [];
                      setParticipants(Array.isArray(participantsList) ? participantsList : []);
                    } else {
                      setParticipants([]);
                    }
                  } catch (error) {
                    console.error('Error fetching participants:', error);
                    setParticipants([]);
                    Alert.alert('Error', 'Failed to load participants');
                  } finally {
                    setLoadingParticipants(false);
                  }
                }}
              >
                <MaterialIcons name="people" size={20} color="#fff" />
                <Text style={styles.organizerActionText}>View Participants</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.organizerActionButton, { backgroundColor: C.success }]}
                onPress={() => {
                  // Posts are already shown below, but we can scroll to them or highlight
                  Alert.alert('Challenge Posts', `There are ${posts.length} posts in this challenge`, [
                    { text: 'OK' }
                  ]);
                }}
              >
                <MaterialIcons name="video-library" size={20} color="#fff" />
                <Text style={styles.organizerActionText}>View Posts ({posts.length})</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          // Non-organizer view - show join/create post buttons
          <View style={[styles.actionsSection, { backgroundColor: C.card, borderTopColor: C.border }]}>
            {!challenge.is_participant ? (
              <>
                <TouchableOpacity
                  style={[
                    styles.joinButton, 
                    { backgroundColor: C.primary },
                    (!canJoin() || joining) && { opacity: 0.5 }
                  ]}
                  onPress={handleJoinChallenge}
                  disabled={!canJoin() || joining}
                >
                  {joining ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <MaterialIcons name="person-add" size={20} color="#fff" />
                      <Text style={styles.joinButtonText}>
                        {!hasStarted() 
                          ? 'Challenge Not Started' 
                          : 'Join Challenge'}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
                {!hasStarted() && (
                  <View style={styles.infoMessage}>
                    <MaterialIcons name="info-outline" size={16} color={C.textSecondary} />
                    <Text style={[styles.infoText, { color: C.textSecondary }]}>
                      This challenge starts on {formatDate(challenge.start_date)}
                    </Text>
                  </View>
                )}
              </>
            ) : (
              <View style={styles.participantActions}>
                <View style={[styles.joinedBadge, { borderColor: C.success }]}>
                  <MaterialIcons name="check-circle" size={18} color={C.success} />
                  <Text style={[styles.joinedText, { color: C.success }]}>Joined</Text>
                </View>
                <TouchableOpacity
                  style={[styles.createPostButton, { backgroundColor: C.primary }]}
                  onPress={handleCreatePost}
                >
                  <MaterialIcons name="add-circle-outline" size={20} color="#fff" />
                  <Text style={styles.createPostText}>Create Post</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {/* Posts Section */}
        <View style={[styles.postsSection, { backgroundColor: C.background }]}>
          <Text style={[styles.sectionTitle, { color: C.text }]}>
            Challenge Posts ({posts.length})
          </Text>
          
          {postsLoading ? (
            <View style={styles.postsLoading}>
              <ActivityIndicator size="small" color={C.primary} />
            </View>
          ) : posts.length === 0 ? (
            <View style={styles.emptyPosts}>
              <MaterialIcons name="video-library" size={48} color={C.textSecondary} />
              <Text style={[styles.emptyText, { color: C.textSecondary }]}>
                No posts yet
              </Text>
              {challenge.is_participant && isActive() && (
                <Text style={[styles.emptySubtext, { color: C.textSecondary }]}>
                  Be the first to post!
                </Text>
              )}
            </View>
          ) : (
            <FlatList
              data={posts}
              renderItem={renderPost}
              keyExtractor={(item) => item.id}
              numColumns={2}
              columnWrapperStyle={styles.postsRow}
              scrollEnabled={false}
              contentContainerStyle={styles.postsGrid}
            />
          )}
        </View>
      </ScrollView>

      {/* Participants Modal */}
      <Modal visible={participantsModalVisible} transparent animationType="slide">
        <TouchableOpacity
          style={styles.modalOverlay}
          onPress={() => setParticipantsModalVisible(false)}
          activeOpacity={1}
        >
          <View style={[styles.modalContainer, { backgroundColor: C.card }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: C.text }]}>Participants</Text>
              <TouchableOpacity onPress={() => setParticipantsModalVisible(false)}>
                <MaterialIcons name="close" size={24} color={C.text} />
              </TouchableOpacity>
            </View>
            {loadingParticipants ? (
              <View style={styles.modalLoading}>
                <ActivityIndicator size="large" color={C.primary} />
              </View>
            ) : participants.length > 0 ? (
              <FlatList
                data={participants}
                keyExtractor={(item) => item.user?.id || item.id || Math.random().toString()}
                renderItem={({ item }) => {
                  const participantUser = item.user || item;
                  return (
                    <TouchableOpacity
                      style={styles.modalUserItem}
                      onPress={() => {
                        if (participantUser.id) {
                          router.push({
                            pathname: '/user/[id]',
                            params: { id: participantUser.id }
                          });
                          setParticipantsModalVisible(false);
                        }
                      }}
                    >
                      <Avatar
                        user={participantUser}
                        size={50}
                        style={styles.modalUserAvatar}
                      />
                      <View style={styles.modalUserInfo}>
                        <Text style={[styles.modalUserName, { color: C.text }]}>
                          {participantUser.username || participantUser.display_name || 'Unknown'}
                        </Text>
                        {item.joined_at && (
                          <Text style={[styles.modalUserMeta, { color: C.textSecondary }]}>
                            Joined {new Date(item.joined_at).toLocaleDateString()}
                          </Text>
                        )}
                      </View>
                    </TouchableOpacity>
                  );
                }}
                contentContainerStyle={styles.modalListContent}
              />
            ) : (
              <View style={styles.modalEmpty}>
                <MaterialIcons name="people-outline" size={48} color={C.textSecondary} />
                <Text style={[styles.modalEmptyText, { color: C.textSecondary }]}>No participants yet</Text>
              </View>
            )}
          </View>
        </TouchableOpacity>
      </Modal>
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
  scrollView: {
    flex: 1,
  },
  challengeHeader: {
    padding: 24,
    paddingTop: 20,
    minHeight: 100,
  },
  headerContentWrapper: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
    gap: 12,
  },
  badgesContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    alignItems: 'flex-start',
    gap: 8,
    flexShrink: 0,
    width: 200,
  },
  rewardBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    flexShrink: 0,
    width: 96,
    maxWidth: 96,
  },
  rewardBadgeText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
    marginLeft: 6,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    flexShrink: 0,
    width: 96,
    maxWidth: 96,
  },
  statusText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  challengeTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#fff',
    flex: 1,
    marginRight: 12,
    minWidth: 0,
  },
  statsRow: {
    flexDirection: 'row',
  },
  statItem: {
    marginRight: 32,
  },
  statValue: {
    fontSize: 24,
    fontWeight: '700',
    color: '#fff',
  },
  statLabel: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 2,
  },
  detailsSection: {
    padding: 20,
    marginBottom: 8,
  },
  detailBlock: {
    marginBottom: 20,
  },
  detailLabel: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  detailText: {
    fontSize: 15,
    lineHeight: 22,
  },
  organizerSection: {
    marginTop: 8,
  },
  organizerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  organizerAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    marginRight: 12,
  },
  organizerName: {
    fontSize: 15,
    fontWeight: '600',
  },
  organizerUsername: {
    fontSize: 13,
    marginTop: 2,
  },
  actionsSection: {
    padding: 20,
    marginBottom: 8,
  },
  joinButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
  },
  joinButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  participantActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  joinedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
  },
  joinedText: {
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 6,
  },
  createPostButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
  },
  createPostText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 6,
  },
  organizerActions: {
    flexDirection: 'row',
    gap: 12,
  },
  organizerActionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
  },
  organizerActionText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 8,
  },
  postsSection: {
    padding: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
  },
  postsLoading: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  postsRow: {
    justifyContent: 'space-between',
  },
  postsGrid: {
    paddingBottom: 20,
  },
  postCard: {
    width: (screenWidth - 52) / 2,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  postMedia: {
    width: '100%',
    height: 140,
    position: 'relative',
  },
  postImage: {
    width: '100%',
    height: '100%',
  },
  playOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  postInfo: {
    padding: 12,
  },
  postTitle: {
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 8,
  },
  postUser: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  postUserAvatar: {
    width: 20,
    height: 20,
    borderRadius: 10,
    marginRight: 6,
  },
  postUsername: {
    fontSize: 12,
  },
  postStats: {
    flexDirection: 'row',
  },
  postStat: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 12,
  },
  postStatText: {
    fontSize: 11,
    marginLeft: 4,
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
  emptyPosts: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    marginTop: 12,
    fontSize: 16,
  },
  emptySubtext: {
    marginTop: 6,
    fontSize: 14,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    paddingBottom: 40,
    maxHeight: '80%',
    marginBottom: 40,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  modalLoading: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  modalListContent: {
    paddingBottom: 20,
  },
  modalUserItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: '#1a1a1a',
    marginBottom: 8,
  },
  modalUserAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginRight: 12,
    backgroundColor: '#0a0a0a',
  },
  modalUserInfo: {
    flex: 1,
  },
  modalUserName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  modalUserMeta: {
    fontSize: 12,
  },
  modalEmpty: {
    paddingVertical: 60,
    alignItems: 'center',
  },
  modalEmptyText: {
    fontSize: 16,
    marginTop: 16,
  },
  infoMessage: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(96, 165, 250, 0.1)',
    borderRadius: 8,
    gap: 8,
  },
  infoText: {
    fontSize: 13,
    flex: 1,
    lineHeight: 18,
  },
});
