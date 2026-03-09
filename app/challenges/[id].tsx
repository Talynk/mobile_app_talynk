import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Image,
  Alert,
  Dimensions,
  Modal,
  useWindowDimensions,
  StatusBar,
  Animated,
} from 'react-native';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { challengesApi, postsApi, followsApi, likesApi } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useRefetchOnReconnect } from '@/lib/hooks/use-network-status';
import { MaterialIcons, Feather } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Avatar } from '@/components/Avatar';
import { getPostMediaUrl, getThumbnailUrl, getFileUrl } from '@/lib/utils/file-url';
import { filterHlsReady } from '@/lib/utils/post-filter';
import FullscreenFeedPostItem from '@/components/FullscreenFeedPostItem';
import ReportModal from '@/components/ReportModal';
import CommentsModal from '@/components/CommentsModal';
import CreateChallengeModal from '@/components/CreateChallengeModal';
import { useCache } from '@/lib/cache-context';
import { useAppDispatch, useAppSelector } from '@/lib/store/hooks';
import { setPostLikeCounts } from '@/lib/store/slices/likesSlice';
import { useLikesManager } from '@/lib/hooks/use-likes-manager';
import { Share } from 'react-native';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
const FULLSCREEN_HEADER_PX = 64;
const POST_ITEM_SIZE = (screenWidth - 4) / 3;

const COLORS = {
  dark: {
    background: '#000000',
    card: '#1a1a1a',
    border: '#2a2a2a',
    text: '#f3f4f6',
    textSecondary: '#9ca3af',
    primary: '#60a5fa',
    detailLabel: '#7DD3FC', // light blue for section labels (Description, Duration, etc.)
    success: '#34d399',
    warning: '#fbbf24',
    error: '#f87171',
    inputBg: '#232326',
    inputBorder: '#27272a',
    buttonBg: '#60a5fa',
    buttonText: '#fff',
  },
};

const getChallengeSortTimestamp = (post: any) =>
  new Date(post?.createdAt || post?.uploadDate || post?.created_at || 0).getTime();

const sortChallengePosts = (posts: any[], likesMap: Record<string, number>, useChallengeLikes: boolean) =>
  [...posts].sort((a, b) => {
    const likesA = useChallengeLikes
      ? likesMap[a.id] ?? 0
      : Number(a.likes ?? a.like_count ?? 0);
    const likesB = useChallengeLikes
      ? likesMap[b.id] ?? 0
      : Number(b.likes ?? b.like_count ?? 0);

    if (likesB !== likesA) {
      return likesB - likesA;
    }

    return getChallengeSortTimestamp(b) - getChallengeSortTimestamp(a);
  });

export default function ChallengeDetailScreen() {
  const { id } = useLocalSearchParams();
  const { user, isAuthenticated } = useAuth();
  const C = COLORS.dark;

  const [challenge, setChallenge] = useState<any>(null);
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [postsLoading, setPostsLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [participantsModalVisible, setParticipantsModalVisible] = useState(false);
  const [participants, setParticipants] = useState<any[]>([]);
  const [loadingParticipants, setLoadingParticipants] = useState(false);
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const fullscreenAvailableHeight = windowHeight - insets.top - FULLSCREEN_HEADER_PX;
  const [fullscreenIndex, setFullscreenIndex] = useState(0);
  const [showFullscreen, setShowFullscreen] = useState(false);
  const fullscreenListRef = useRef<FlatList>(null);
  const [reportModalVisible, setReportModalVisible] = useState(false);
  const [reportPostId, setReportPostId] = useState<string | null>(null);
  const [commentsModalVisible, setCommentsModalVisible] = useState(false);
  const [commentsPostId, setCommentsPostId] = useState<string | null>(null);
  const [userFollowStatus, setUserFollowStatus] = useState<Record<string, boolean>>({});
  const { followedUsers, updateFollowedUsers } = useCache();
  const dispatch = useAppDispatch();
  const likesManager = useLikesManager();
  const likedPosts = useAppSelector(state => state.likes.likedPosts);
  const [activeTab, setActiveTab] = useState<'posts' | 'participants'>('posts');
  const [allParticipants, setAllParticipants] = useState<any[]>([]);
  const [loadingAllParticipants, setLoadingAllParticipants] = useState(false);
  const [editChallengeModalVisible, setEditChallengeModalVisible] = useState(false);
  const [rawChallengePosts, setRawChallengePosts] = useState<any[]>([]);

  useRefetchOnReconnect(() => fetchChallenge());

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
        const rawItems = response.data?.rawItems || [];
        const postsList = response.data?.posts || [];
        const normalizedPosts = filterHlsReady(Array.isArray(postsList) ? postsList : []);
        setPosts(normalizedPosts);
        setRawChallengePosts(Array.isArray(rawItems) ? rawItems : []);
      }
    } catch (err: any) {
      console.warn('Error fetching challenge posts:', err?.message);
    } finally {
      setPostsLoading(false);
    }
  };

  const fetchParticipants = async () => {
    if (!id) return;

    setLoadingAllParticipants(true);

    try {
      const response = await challengesApi.getParticipants(id as string);

      if (response?.status === 'success') {
        const participantsList = response.data || [];
        const normalizedParticipants = Array.isArray(participantsList)
          ? participantsList
          : (participantsList.participants || []);
        setAllParticipants(normalizedParticipants);
      } else {
        setAllParticipants([]);
      }
    } catch (err: any) {
      console.warn('Error fetching challenge participants:', err?.message);
      setAllParticipants([]);
    } finally {
      setLoadingAllParticipants(false);
    }
  };

  useEffect(() => {
    fetchChallenge();
    if (activeTab === 'posts') {
      fetchPosts();
    } else if (activeTab === 'participants') {
      fetchParticipants();
    }
  }, [id, activeTab]);

  useFocusEffect(
    useCallback(() => {
      fetchChallenge();
      if (activeTab === 'posts') {
        fetchPosts();
      } else if (activeTab === 'participants') {
        fetchParticipants();
      }
    }, [id, activeTab])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    if (activeTab === 'posts') {
      await Promise.all([fetchChallenge(), fetchPosts()]);
    } else {
      await Promise.all([fetchChallenge(), fetchParticipants()]);
    }
    setRefreshing(false);
  };

  const handleJoinChallenge = async () => {
    if (!isAuthenticated) {
      Alert.alert('Login Required', 'Please login to join competitions', [
        { text: 'Cancel' },
        { text: 'Login', onPress: () => router.push('/auth/login') }
      ]);
      return;
    }

    if (!id) {
      Alert.alert('Error', 'Competition ID is missing');
      return;
    }

    setJoining(true);

    try {
      const response = await challengesApi.join(id as string);

      if (response?.status === 'success') {
        Alert.alert('Success', response.message || 'You have joined the competition!', [
          { text: 'OK', onPress: () => fetchChallenge() }
        ]);
      } else {
        const errorMessage = response?.message || 'Failed to join challenge';
        let alertTitle = 'Cannot Join Competition';
        let alertMessage = errorMessage;

        if (errorMessage.toLowerCase().includes('not started')) {
          alertTitle = 'Competition Not Started';
          alertMessage = 'This competition has not started yet. Please wait until the start date to join.';
        } else if (errorMessage.toLowerCase().includes('already ended') || errorMessage.toLowerCase().includes('has ended')) {
          alertTitle = 'Competition Ended';
          alertMessage = 'This competition has already ended. You cannot join it anymore.';
        } else if (errorMessage.toLowerCase().includes('already a participant') || errorMessage.toLowerCase().includes('already joined')) {
          alertTitle = 'Already Joined';
          alertMessage = 'You have already joined this competition.';
        } else if (errorMessage.toLowerCase().includes('cannot join own challenge') || errorMessage.toLowerCase().includes('organizer')) {
          alertTitle = 'Cannot Join';
          alertMessage = 'You cannot join a competition that you organized.';
        } else if (errorMessage.toLowerCase().includes('not available')) {
          alertTitle = 'Competition Not Available';
          alertMessage = 'This competition is not available for joining at this time.';
        }

        Alert.alert(alertTitle, alertMessage);
      }
    } catch (err: any) {
      const errorMessage = err.response?.data?.message || err.message || 'Failed to join challenge';
      let alertTitle = 'Error';
      let alertText = errorMessage;

      if (errorMessage.toLowerCase().includes('not started')) {
        alertTitle = 'Competition Not Started';
        alertText = 'This competition has not started yet. Please wait until the start date to join.';
      } else if (errorMessage.toLowerCase().includes('already ended')) {
        alertTitle = 'Competition Ended';
        alertText = 'This competition has already ended. You cannot join it anymore.';
      }

      Alert.alert(alertTitle, alertText);
    } finally {
      setJoining(false);
    }
  };

  const handleCreatePost = () => {
    if (!challenge?.is_participant) {
      Alert.alert('Join Required', 'You must join the competition before posting');
      return;
    }

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

    if (challenge.status === 'pending' || challenge.status === 'draft') {
      return { label: 'Pending Review', color: C.warning };
    }
    if (challenge.status === 'rejected') {
      return { label: 'Rejected', color: C.error };
    }

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

    const now = new Date();
    const startDate = new Date(challenge.start_date);
    const endDate = new Date(challenge.end_date);

    if (now < startDate) return { label: 'Upcoming', color: C.warning };
    if (now > endDate) return { label: 'Ended', color: C.textSecondary };
    return { label: 'Active', color: C.success };
  };

  const isActive = () => {
    if (!challenge) return false;

    if (challenge.is_currently_active !== undefined) {
      return challenge.is_currently_active;
    }

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
    const status = challenge.status;
    const now = new Date();
    const endDate = new Date(challenge.end_date);

    // Cannot join if ended
    if (now > endDate) return false;

    return (status === 'approved' || status === 'active') && !challenge.is_participant;
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

  const isChallengeEnded = challenge && new Date() > new Date(challenge.end_date);
  const likesDuringChallengeMap = useMemo(() => {
    const map: Record<string, number> = {};
    rawChallengePosts.forEach((cp: any) => {
      const postId = cp.post?.id ?? cp.post_id;
      if (postId) map[postId] = cp.likes_during_challenge ?? cp.likes_at_challenge_end ?? 0;
    });
    return map;
  }, [rawChallengePosts]);

  const sortedPosts = useMemo(() => {
    if (!isChallengeEnded || !rawChallengePosts.length) return posts;
    return sortChallengePosts(posts, likesDuringChallengeMap, true);
  }, [posts, rawChallengePosts, isChallengeEnded, likesDuringChallengeMap]);

  const isOrganizer = challenge?.organizer_id === user?.id;

  const handleLike = async (postId: string) => {
    if (!user) {
      Alert.alert('Login Required', 'Please log in to like posts.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Log In', onPress: () => router.push('/auth/login' as any) },
      ]);
      return;
    }
    await likesManager.toggleLike(postId);
    const newCount = likesManager.getLikeCount(postId);
    setPosts((prev: any[]) => prev.map((p: any) => (p.id === postId ? { ...p, likes: newCount } : p)));
  };

  const handleComment = (postId: string) => {
    setCommentsPostId(postId);
    setCommentsModalVisible(true);
  };

  const handleShare = async (postId: string) => {
    const post = posts.find((p: any) => p.id === postId);
    if (post) {
      try {
        const url = getPostMediaUrl(post) || (post as any).fullUrl || '';
        await Share.share({ message: url || post.caption || 'Check this out!', title: 'Talentix', url: url || undefined });
      } catch (_) {}
    }
  };

  const handleReport = (postId: string) => {
    if (!user) {
      router.push('/auth/login' as any);
      return;
    }
    setReportPostId(postId);
    setReportModalVisible(true);
  };

  const handleFollow = async (targetUserId: string) => {
    if (!user) return;
    updateFollowedUsers(targetUserId, true);
    setUserFollowStatus(prev => ({ ...prev, [targetUserId]: true }));
    try {
      const res = await followsApi.follow(targetUserId);
      if (res.status !== 'success') {
        updateFollowedUsers(targetUserId, false);
        setUserFollowStatus(prev => ({ ...prev, [targetUserId]: false }));
      }
    } catch {
      updateFollowedUsers(targetUserId, false);
      setUserFollowStatus(prev => ({ ...prev, [targetUserId]: false }));
    }
  };

  const handleUnfollow = async (targetUserId: string) => {
    if (!user) return;
    updateFollowedUsers(targetUserId, false);
    setUserFollowStatus(prev => ({ ...prev, [targetUserId]: false }));
    try {
      const res = await followsApi.unfollow(targetUserId);
      if (res.status !== 'success') {
        updateFollowedUsers(targetUserId, true);
        setUserFollowStatus(prev => ({ ...prev, [targetUserId]: true }));
      }
    } catch {
      updateFollowedUsers(targetUserId, true);
      setUserFollowStatus(prev => ({ ...prev, [targetUserId]: true }));
    }
  };

  const GridPostCard = ({ item, index }: { item: any; index: number }) => {
    const mediaUrl = getPostMediaUrl(item) || '';
    const isHls = mediaUrl.endsWith('.m3u8');
    const isVideo =
      item.type === 'video' || isHls ||
      (mediaUrl !== null &&
        mediaUrl !== '' &&
        (mediaUrl.toLowerCase().includes('.mp4') ||
          mediaUrl.toLowerCase().includes('.mov') ||
          mediaUrl.toLowerCase().includes('.webm')));

    // HLS OPTIMIZATION: Server thumbnail_url takes priority
    const serverThumbnail = getThumbnailUrl(item);
    const fallbackImageUrl = getFileUrl((item as any).image || (item as any).thumbnail || '');

    // HLS-only: never fetch raw MP4 just to synthesize thumbnails in the challenge grid.
    const staticThumbnailUrl = isVideo
      ? (serverThumbnail || fallbackImageUrl)
      : (mediaUrl || fallbackImageUrl);

    return (
      <TouchableOpacity
        style={styles.gridPostCard}
        activeOpacity={0.9}
        onPress={() => {
          setFullscreenIndex(index);
          setShowFullscreen(true);
          setTimeout(() => {
            fullscreenListRef.current?.scrollToIndex({ index, animated: false });
          }, 100);
        }}
      >
        {staticThumbnailUrl ? (
          <Image
            source={{ uri: staticThumbnailUrl }}
            style={styles.gridPostImage}
            resizeMode="cover"
          />
        ) : (
          <View style={[styles.gridPostImage, styles.noMediaPlaceholder]}>
            <MaterialIcons
              name={isVideo ? 'video-library' : 'image'}
              size={28}
              color={C.textSecondary}
            />
          </View>
        )}

        {isVideo && (
          <View style={styles.gridPlayBadge}>
            <Feather name="play" size={14} color="#fff" />
          </View>
        )}
      </TouchableOpacity>
    );
  };


  // Render header component - all the content above posts/participants
  const renderHeader = () => {
    if (!challenge) return null;

    const status = getChallengeStatus();
    const participantCount = challenge._count?.participants || 0;
    const postCount = challenge._count?.posts || posts.length || 0;

    return (
      <>
        {/* Challenge Header */}
        <LinearGradient
          colors={challenge.has_rewards ? ['#f59e0b', '#d97706'] : ['#3b82f6', '#2563eb']}
          style={styles.challengeHeader}
        >
          <View style={styles.headerContentWrapper}>
            <Text style={styles.challengeTitle}>{challenge.name}</Text>
            <View style={styles.badgesContainer}>
              <View style={[styles.rewardBadge, { backgroundColor: challenge.has_rewards ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.25)' }]}>
                <MaterialIcons name="emoji-events" size={14} color="#fff" />
                <Text style={styles.rewardBadgeText}>Reward: {challenge.has_rewards ? 'Yes' : 'No'}</Text>
              </View>
              <View style={[styles.statusBadge, { backgroundColor: status.color }]}>
                <Text style={styles.statusText}>{status.label}</Text>
              </View>
            </View>
          </View>

          {challenge.status !== 'pending' && (
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
          )}
        </LinearGradient>

        {/* Action Buttons - above details. When pending, organizer only sees Edit (no View Participants / View Posts). */}
        {isOrganizer ? (
          <View style={[styles.actionsSection, { backgroundColor: C.card, borderTopColor: C.border }]}>
            <View style={styles.organizerActions}>
              {challenge.status === 'pending' && (
                <TouchableOpacity
                  style={[styles.organizerActionButton, { backgroundColor: C.warning }]}
                  onPress={() => setEditChallengeModalVisible(true)}
                >
                  <MaterialIcons name="edit" size={20} color="#fff" />
                  <Text style={styles.organizerActionText}>Edit Competition before approval</Text>
                </TouchableOpacity>
              )}
              {challenge.status !== 'pending' && (
                <>
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
                      Alert.alert('Competition Posts', `There are ${posts.length} posts in this competition`, [
                        { text: 'OK' }
                      ]);
                    }}
                  >
                    <MaterialIcons name="video-library" size={20} color="#fff" />
                    <Text style={styles.organizerActionText}>View Posts ({posts.length})</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>
        ) : (
          <View style={[styles.actionsSection, { backgroundColor: C.card, borderTopColor: C.border }]}>
            {!challenge.is_participant ? (
              <>
                {new Date() <= new Date(challenge.end_date) ? (
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
                          Join Competition
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>
                ) : (
                  <View style={[styles.joinButton, { backgroundColor: C.card, borderColor: C.border, borderWidth: 1 }]}>
                    <Text style={[styles.joinButtonText, { color: C.textSecondary }]}>
                      Competition Ended
                    </Text>
                  </View>
                )}

                {!hasStarted() && new Date() <= new Date(challenge.end_date) && (
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

        {/* Challenge Details */}
        <View style={[styles.detailsSection, { backgroundColor: C.card }]}>
          {challenge.description && (
            <View style={styles.detailBlock}>
              <Text style={[styles.detailLabel, { color: C.detailLabel }]}>Description</Text>
              <Text style={[styles.detailText, { color: C.text }]}>{challenge.description}</Text>
            </View>
          )}

          <View style={styles.detailBlock}>
            <Text style={[styles.detailLabel, { color: C.detailLabel }]}>Duration</Text>
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
              <Text style={[styles.detailLabel, { color: C.detailLabel }]}>Rewards</Text>
              <Text style={[styles.detailText, { color: C.text }]}>{challenge.rewards}</Text>
            </View>
          )}

          {challenge.scoring_criteria && (
            <View style={styles.detailBlock}>
              <Text style={[styles.detailLabel, { color: C.detailLabel }]}>Scoring Criteria</Text>
              <Text style={[styles.detailText, { color: C.text }]}>{challenge.scoring_criteria}</Text>
            </View>
          )}

          {(challenge.contact_email || (challenge as any).contact_email) && (
            <View style={styles.detailBlock}>
              <Text style={[styles.detailLabel, { color: C.detailLabel }]}>Contact email</Text>
              <Text style={[styles.detailText, { color: C.text }]}>{challenge.contact_email || (challenge as any).contact_email}</Text>
            </View>
          )}

          {(challenge.eligibility_criteria || (challenge as any).eligibility_criteria) && (
            <View style={styles.detailBlock}>
              <Text style={[styles.detailLabel, { color: C.detailLabel }]}>Participant eligibility</Text>
              <Text style={[styles.detailText, { color: C.text }]}>{challenge.eligibility_criteria || (challenge as any).eligibility_criteria}</Text>
            </View>
          )}

          {(challenge.what_you_do || (challenge as any).what_you_do) && (
            <View style={styles.detailBlock}>
              <Text style={[styles.detailLabel, { color: C.detailLabel }]}>About the organizer</Text>
              <Text style={[styles.detailText, { color: C.text }]}>{challenge.what_you_do || (challenge as any).what_you_do}</Text>
            </View>
          )}

          {challenge.organizer && (
            <View style={styles.organizerSection}>
              <Text style={[styles.detailLabel, { color: C.detailLabel }]}>Organizer</Text>
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

        {/* Tabs - only when challenge is approved (not pending); pending organizer sees no Posts/Participants tabs */}
        {challenge.status !== 'pending' && (
          <View style={[styles.tabsSection, { backgroundColor: C.background }]}>
            <View style={styles.tabsContainer}>
              <TouchableOpacity
                style={[
                  styles.tab,
                  activeTab === 'posts' && styles.tabActive
                ]}
                onPress={() => setActiveTab('posts')}
              >
                <MaterialIcons
                  name="video-library"
                  size={18}
                  color={activeTab === 'posts' ? C.primary : C.textSecondary}
                />
                <Text style={[
                  styles.tabText,
                  { color: activeTab === 'posts' ? C.primary : C.textSecondary }
                ]}>
                  Posts ({postCount})
                </Text>
              </TouchableOpacity>

              {isAuthenticated && (
                <TouchableOpacity
                  style={[
                    styles.tab,
                    activeTab === 'participants' && styles.tabActive
                  ]}
                  onPress={() => setActiveTab('participants')}
                >
                  <MaterialIcons
                    name="people"
                    size={18}
                    color={activeTab === 'participants' ? C.primary : C.textSecondary}
                  />
                  <Text style={[
                    styles.tabText,
                    { color: activeTab === 'participants' ? C.primary : C.textSecondary }
                  ]}>
                    Participants ({participantCount})
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        {/* Winners (Top 10) - only when ended and on posts tab, sorted by likes */}
        {activeTab === 'posts' && new Date() > new Date(challenge.end_date) && rawChallengePosts.length > 0 && (
          <View style={[styles.winnersSection, { backgroundColor: C.card, borderColor: C.border }]}>
            <Text style={[styles.winnersTitle, { color: C.text }]}>Winners (Top 10)</Text>
            <View style={styles.winnersGrid}>
              {[...rawChallengePosts]
                .sort((a, b) => {
                  const likesA = a.likes_during_challenge ?? a.likes_at_challenge_end ?? 0;
                  const likesB = b.likes_during_challenge ?? b.likes_at_challenge_end ?? 0;
                  if (likesB !== likesA) return likesB - likesA;
                  return getChallengeSortTimestamp(b.post || b) - getChallengeSortTimestamp(a.post || a);
                })
                .slice(0, 10)
                .map((cp: any, idx: number) => {
                const post = cp.post || cp;
                const likesDuring = cp.likes_during_challenge ?? cp.likes_at_challenge_end ?? 0;
                const thumbUrl = getThumbnailUrl(post) || getPostMediaUrl(post) || '';
                return (
                  <TouchableOpacity
                    key={post?.id || idx}
                    style={styles.winnerCard}
                    onPress={() => {
                      const openIndex = sortedPosts.findIndex((p: any) => p.id === post?.id);
                      router.push({
                        pathname: '/challenges/[id]/posts',
                        params: { id: challenge.id, open: '1', openIndex: String(openIndex >= 0 ? openIndex : 0) }
                      });
                    }}
                  >
                    <View style={styles.winnerRank}>
                      <Text style={styles.winnerRankText}>#{idx + 1}</Text>
                    </View>
                    {thumbUrl ? (
                      <Image source={{ uri: thumbUrl }} style={styles.winnerThumb} resizeMode="cover" />
                    ) : (
                      <View style={[styles.winnerThumb, styles.winnerThumbPlaceholder]}>
                        <MaterialIcons name="video-library" size={20} color={C.textSecondary} />
                      </View>
                    )}
                    <Text style={[styles.winnerLikes, { color: C.textSecondary }]}>{likesDuring} likes</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}
      </>
    );
  };

  // Render item for the main FlatList
  const renderItem = ({ item, index }: { item: any; index: number }) => {
    if (activeTab === 'posts') {
      // Render posts in grid - 3 columns
      return <GridPostCard item={item} index={index} />;
    } else {
      // Render participant
      const participantUser = item.user || item;
      const postCount = item.post_count || 0;
      const joinedAt = item.joined_at || item.createdAt;

      return (
        <TouchableOpacity
          style={[styles.participantItem, { backgroundColor: C.card, borderColor: C.border }]}
          onPress={() => {
            if (participantUser.id || item.user_id) {
              router.push({
                pathname: '/user/[id]',
                params: { id: participantUser.id || item.user_id }
              });
            }
          }}
        >
          <Avatar
            user={participantUser}
            size={50}
            style={styles.participantAvatar}
          />
          <View style={styles.participantInfo}>
            <Text style={[styles.participantName, { color: C.text }]}>
              {participantUser.display_name || participantUser.username || 'Unknown'}
            </Text>
            <Text style={[styles.participantUsername, { color: C.textSecondary }]}>
              @{participantUser.username || 'unknown'}
            </Text>
            {joinedAt && (
              <Text style={[styles.participantJoined, { color: C.textSecondary }]}>
                Joined {new Date(joinedAt).toLocaleDateString()}
              </Text>
            )}
          </View>
          <View style={styles.participantStats}>
            <View style={styles.participantStat}>
              <MaterialIcons name="video-library" size={16} color={C.textSecondary} />
              <Text style={[styles.participantStatText, { color: C.textSecondary }]}>
                {postCount}
              </Text>
            </View>
          </View>
        </TouchableOpacity>
      );
    }
  };

  // Loading state
  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: C.background }]} edges={['top']}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={C.primary} />
          <Text style={[styles.loadingText, { color: C.textSecondary }]}>Loading competition...</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Error state
  if (error || !challenge) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: C.background }]} edges={['top']}>
        <View style={[styles.header, { borderBottomColor: C.border }]}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <MaterialIcons name="arrow-back" size={24} color={C.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: C.text }]}>Competition</Text>
          <View style={styles.headerSpacer} />
        </View>
        <View style={styles.errorContainer}>
          <MaterialIcons name="error-outline" size={48} color={C.textSecondary} />
          <Text style={[styles.errorText, { color: C.textSecondary }]}>{error || 'Competition not found'}</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Determine data source based on active tab (posts sorted by likes when challenge ended)
  const data = activeTab === 'posts' ? sortedPosts : allParticipants;
  const isLoading = activeTab === 'posts' ? postsLoading : loadingAllParticipants;

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

      {/* Main Content - Single FlatList: flex: 1 so it fills space and scroll works; paddingBottom so all details are reachable */}
      <FlatList
        style={styles.challengeDetailList}
        data={data}
        renderItem={renderItem}
        keyExtractor={(item, index) => {
          if (activeTab === 'posts') {
            return item.id || `post-${index}`;
          } else {
            return item.user?.id || item.user_id || item.id || `participant-${index}`;
          }
        }}
        numColumns={activeTab === 'posts' ? 3 : 1}
        key={activeTab} // Force re-render when switching tabs
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.postsLoading}>
              <ActivityIndicator size="small" color={C.primary} />
            </View>
          ) : (
            <View style={activeTab === 'posts' ? styles.emptyPosts : styles.emptyParticipants}>
              <MaterialIcons
                name={activeTab === 'posts' ? "video-library" : "people-outline"}
                size={48}
                color={C.textSecondary}
              />
              <Text style={[styles.emptyText, { color: C.textSecondary }]}>
                {activeTab === 'posts' ? 'No posts yet' : 'No participants yet'}
              </Text>
              {activeTab === 'posts' && challenge.is_participant && isActive() && (
                <Text style={[styles.emptySubtext, { color: C.textSecondary }]}>
                  Be the first to post!
                </Text>
              )}
            </View>
          )
        }
        contentContainerStyle={[
          data.length === 0 ? { flexGrow: 1 } : (activeTab === 'posts' ? styles.postsGrid : styles.participantsList),
          styles.challengeDetailListContent,
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={C.primary}
            colors={[C.primary]}
          />
        }
        ListFooterComponent={<View style={styles.challengeDetailListFooter} />}
        showsVerticalScrollIndicator={true}
      />

      {/* Fullscreen Post Viewer Modal */}
      <Modal
        visible={showFullscreen}
        animationType="fade"
        transparent={false}
        onRequestClose={() => setShowFullscreen(false)}
      >
        <SafeAreaView style={[styles.fullscreenContainer, { backgroundColor: C.background }]} edges={['top']}>
          <StatusBar barStyle="light-content" />
          <View style={styles.fullscreenHeader}>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => setShowFullscreen(false)}
            >
              <Feather name="x" size={28} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.positionText}>
              {fullscreenIndex + 1} / {sortedPosts.length}
            </Text>
          </View>

          <FlatList
            ref={fullscreenListRef}
            data={sortedPosts}
            renderItem={({ item, index }) => {
              const isActive = fullscreenIndex === index;
              const distance = index - fullscreenIndex;
              const shouldPreload = !isActive && distance >= -1 && distance <= 1;
              return (
                <FullscreenFeedPostItem
                  item={item}
                  index={index}
                  onLike={handleLike}
                  onComment={handleComment}
                  onShare={handleShare}
                  onReport={handleReport}
                  onFollow={handleFollow}
                  onUnfollow={handleUnfollow}
                  isLiked={likedPosts.includes(item.id)}
                  isFollowing={userFollowStatus[item.user?.id || ''] ?? followedUsers.has(item.user?.id || '')}
                  isActive={isActive}
                  shouldPreload={shouldPreload}
                  availableHeight={fullscreenAvailableHeight}
                  likesDuringChallenge={likesDuringChallengeMap[item.id]}
                  isChallengeEnded={isChallengeEnded}
                  challengeName={challenge?.name}
                />
              );
            }}
            keyExtractor={(item) => item.id}
            pagingEnabled
            snapToInterval={fullscreenAvailableHeight}
            snapToAlignment="start"
            decelerationRate="fast"
            scrollEventThrottle={16}
            showsVerticalScrollIndicator={false}
            onMomentumScrollEnd={(event) => {
              const index = Math.round(event.nativeEvent.contentOffset.y / fullscreenAvailableHeight);
              setFullscreenIndex(Math.max(0, Math.min(index, sortedPosts.length - 1)));
            }}
            initialScrollIndex={fullscreenIndex}
            getItemLayout={(_, index) => ({
              length: fullscreenAvailableHeight,
              offset: fullscreenAvailableHeight * index,
              index,
            })}
          />
        </SafeAreaView>
      </Modal>

      <ReportModal
        isVisible={reportModalVisible}
        postId={reportPostId}
        onClose={() => { setReportModalVisible(false); setReportPostId(null); }}
        onReported={() => { setReportModalVisible(false); setReportPostId(null); }}
      />
      <CommentsModal
        visible={commentsModalVisible && !!commentsPostId}
        onClose={() => { setCommentsModalVisible(false); setCommentsPostId(null); }}
        postId={commentsPostId || ''}
      />

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

      {/* Edit Competition Modal - only for pending challenges; reuses CreateChallengeModal with PUT */}
      <CreateChallengeModal
        visible={editChallengeModalVisible}
        onClose={() => setEditChallengeModalVisible(false)}
        onCreated={() => {}}
        editChallenge={challenge?.status === 'pending' ? {
          id: challenge.id,
          name: challenge.name,
          description: challenge.description ?? undefined,
          has_rewards: challenge.has_rewards,
          rewards: challenge.rewards ?? undefined,
          organizer_name: challenge.organizer_name,
          organizer_contact: challenge.organizer_contact ?? undefined,
          contact_email: (challenge as any).contact_email ?? undefined,
          eligibility_criteria: (challenge as any).eligibility_criteria ?? undefined,
          what_you_do: (challenge as any).what_you_do ?? undefined,
          start_date: challenge.start_date,
          end_date: challenge.end_date,
          min_content_per_account: (challenge as any).min_content_per_account ?? 1,
          scoring_criteria: (challenge as any).scoring_criteria ?? undefined,
        } : null}
        onUpdated={() => {
          setEditChallengeModalVisible(false);
          fetchChallenge();
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  challengeDetailList: {
    flex: 1,
  },
  challengeDetailListContent: {
    paddingBottom: 160,
  },
  challengeDetailListFooter: {
    height: 80,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    backgroundColor: '#1a1a1a',
    zIndex: 10,
  },
  backButton: {
    padding: 10,
    marginLeft: 0,
    borderRadius: 8,
    backgroundColor: 'rgba(96, 165, 250, 0.15)',
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    flex: 1,
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  headerSpacer: {
    width: 44,
  },
  challengeHeader: {
    padding: 20,
    paddingTop: 16,
    paddingBottom: 16,
  },
  headerContentWrapper: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 12,
  },
  badgesContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'flex-start',
  },
  rewardBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    gap: 4,
  },
  rewardBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
  },
  statusText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  challengeTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
    flex: 1,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 24,
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
  },
  statLabel: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.7)',
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
  tabsSection: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderTopColor: '#2a2a2a',
  },
  tabsContainer: {
    flexDirection: 'row',
    gap: 12,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    gap: 6,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: '#60a5fa',
  },
  tabText: {
    fontSize: 15,
    fontWeight: '600',
  },
  winnersSection: {
    padding: 16,
    borderTopWidth: 1,
  },
  winnersTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
  },
  winnersGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'flex-start',
  },
  winnerCard: {
    width: (screenWidth - 32 - 24) / 5,
    alignItems: 'center',
  },
  winnerRank: {
    position: 'absolute',
    top: 2,
    left: 2,
    zIndex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 4,
  },
  winnerRankText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  winnerThumb: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 8,
    backgroundColor: '#222',
  },
  winnerThumbPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  winnerLikes: {
    fontSize: 10,
    marginTop: 4,
  },
  editModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  editModalContent: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 16,
    borderWidth: 1,
    padding: 24,
  },
  editModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 12,
  },
  editModalHint: {
    fontSize: 14,
    marginBottom: 20,
  },
  editModalButton: {
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  editModalButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  postsGrid: {
    padding: 1,
  },
  gridPostCard: {
    width: POST_ITEM_SIZE,
    height: POST_ITEM_SIZE,
    margin: 1,
    backgroundColor: '#1a1a1a',
    position: 'relative',
    borderRadius: 6,
    overflow: 'hidden',
  },
  gridPostImage: {
    width: '100%',
    height: '100%',
  },
  noMediaPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
  },
  gridPlayBadge: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  participantsList: {
    padding: 20,
    gap: 12,
  },
  participantItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
  },
  participantAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
  },
  participantInfo: {
    flex: 1,
    gap: 4,
  },
  participantName: {
    fontSize: 16,
    fontWeight: '600',
  },
  participantUsername: {
    fontSize: 14,
  },
  participantJoined: {
    fontSize: 12,
    marginTop: 2,
  },
  participantStats: {
    alignItems: 'flex-end',
  },
  participantStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  participantStatText: {
    fontSize: 13,
    fontWeight: '500',
  },
  postsLoading: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  emptyPosts: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyParticipants: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    marginTop: 12,
    fontSize: 16,
  },
  emptySubtext: {
    marginTop: 6,
    fontSize: 14,
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
  fullscreenContainer: {
    flex: 1,
    backgroundColor: '#1a1a1a',
  },
  fullscreenHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  positionText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  fullscreenPostViewer: {
    backgroundColor: '#1a1a1a',
  },
  fullscreenMediaWrapper: {
    flex: 1,
    width: '100%',
    backgroundColor: '#1a1a1a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullscreenMediaImage: {
    width: '100%',
    height: '100%',
  },
  fullscreenMediaVideo: {
    width: '100%',
    height: '100%',
  },
  hlsOnlyOverlay: {
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  hlsOnlyText: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 14,
    marginTop: 8,
  },
  fullscreenVideoWrapper: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
  },
  muteIndicatorOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    pointerEvents: 'none',
  },
  muteIndicatorBadge: {
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 40,
    padding: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  muteButtonCorner: {
    position: 'absolute',
    right: 16,
    zIndex: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  progressBarContainerFullscreen: {
    height: 4,
    paddingHorizontal: 0,
    justifyContent: 'center',
  },
  progressBarTrack: {
    height: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    width: '100%',
    borderRadius: 2,
  },
  progressBarFill: {
    height: 4,
    borderRadius: 2,
  },
  fullscreenPostInfo: {
    position: 'absolute',
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  fullscreenPostInfoContent: {
    gap: 4,
  },
  fullscreenUsername: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  fullscreenCaption: {
    color: '#fff',
    fontSize: 14,
    lineHeight: 20,
  },
  fullscreenTimestamp: {
    color: '#9ca3af',
    fontSize: 12,
    marginTop: 4,
  },
});
