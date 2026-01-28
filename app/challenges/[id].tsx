import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  StatusBar,
} from 'react-native';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { challengesApi, postsApi } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { MaterialIcons, Feather } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Video, ResizeMode, AVPlaybackStatus } from 'expo-av';
import { Avatar } from '@/components/Avatar';
import { getPostMediaUrl, getThumbnailUrl, getFileUrl } from '@/lib/utils/file-url';
import { useVideoThumbnail } from '@/lib/hooks/use-video-thumbnail';
import { timeAgo } from '@/lib/utils/time-ago';

const { width: screenWidth } = Dimensions.get('window');
const POST_ITEM_SIZE = (screenWidth - 4) / 3;

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
  const [fullscreenIndex, setFullscreenIndex] = useState(0);
  const [showFullscreen, setShowFullscreen] = useState(false);
  const fullscreenListRef = useRef<FlatList>(null);
  const [activeTab, setActiveTab] = useState<'posts' | 'participants'>('posts');
  const [allParticipants, setAllParticipants] = useState<any[]>([]);
  const [loadingAllParticipants, setLoadingAllParticipants] = useState(false);

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
        const normalizedPosts = postsList.map((item: any) => item.post || item);
        setPosts(normalizedPosts);
      }
    } catch (err: any) {
      console.error('Error fetching challenge posts:', err);
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
      console.error('Error fetching challenge participants:', err);
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

  const GridPostCard = ({ item, index }: { item: any; index: number }) => {
    const mediaUrl = getPostMediaUrl(item) || '';
    const isVideo =
      item.type === 'video' ||
      (mediaUrl !== null &&
        mediaUrl !== '' &&
        (mediaUrl.toLowerCase().includes('.mp4') ||
          mediaUrl.toLowerCase().includes('.mov') ||
          mediaUrl.toLowerCase().includes('.webm')));

    const fallbackImageUrl = getThumbnailUrl(item) || getFileUrl((item as any).image || (item as any).thumbnail || '');
    const videoUrl = isVideo && mediaUrl ? (mediaUrl.startsWith('http') ? mediaUrl : getFileUrl(mediaUrl)) : null;
    const generatedThumbnail = useVideoThumbnail(
      isVideo && videoUrl ? videoUrl : null,
      fallbackImageUrl || '',
      1000
    );
    const staticThumbnailUrl = isVideo
      ? (generatedThumbnail || fallbackImageUrl || mediaUrl || getFileUrl(mediaUrl))
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

  const FullscreenPostViewer = ({ item, index, insets, C }: { item: any; index: number; insets: any; C: any }) => {
    const videoRef = useRef<Video>(null);
    const [isLoaded, setIsLoaded] = useState(false);
    const [isMuted, setIsMuted] = useState(false); // Default: sound ON
    const [videoProgress, setVideoProgress] = useState(0);
    const [videoDuration, setVideoDuration] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const { height: screenHeight, width: screenWidth } = Dimensions.get('window');

    const mediaUrl = getPostMediaUrl(item) || '';
    const isVideo =
      item.type === 'video' ||
      (mediaUrl !== null &&
        mediaUrl !== '' &&
        (mediaUrl.toLowerCase().includes('.mp4') ||
          mediaUrl.toLowerCase().includes('.mov') ||
          mediaUrl.toLowerCase().includes('.webm')));

    const videoUrl = isVideo ? mediaUrl : null;
    const imageUrl = !isVideo ? mediaUrl : null;
    const fallbackImageUrl =
      getThumbnailUrl(item) || getFileUrl((item as any).image || (item as any).thumbnail || '');
    const generatedThumbnail = useVideoThumbnail(
      isVideo && videoUrl ? videoUrl : null,
      fallbackImageUrl || '',
      1000
    );
    const staticThumbnailUrl = isVideo
      ? (generatedThumbnail || fallbackImageUrl || mediaUrl)
      : (imageUrl || mediaUrl || fallbackImageUrl);

    useEffect(() => {
      if (isVideo && videoUrl && videoRef.current) {
        videoRef.current.playAsync().catch(() => { });
      }
      return () => {
        if (videoRef.current) {
          videoRef.current.pauseAsync().catch(() => { });
        }
      };
    }, [isVideo, videoUrl]);

    const handlePlaybackStatusUpdate = (status: AVPlaybackStatus) => {
      if (status.isLoaded) {
        setIsLoaded(true);
        setIsPlaying(status.isPlaying);
        if (status.durationMillis && status.positionMillis !== undefined) {
          const progress = status.durationMillis > 0
            ? status.positionMillis / status.durationMillis
            : 0;
          setVideoProgress(progress);
          setVideoDuration(status.durationMillis);
        }
      }
    };

    const handleVideoPress = () => {
      if (isVideo) {
        setIsMuted(prev => !prev);
      }
    };

    const availableHeight = screenHeight - 80;

    return (
      <View style={[styles.fullscreenPostViewer, { height: availableHeight, width: screenWidth }]}>
        <View style={styles.fullscreenMediaWrapper}>
          {!isVideo && imageUrl ? (
            <Image
              source={{ uri: imageUrl }}
              style={styles.fullscreenMediaImage}
              resizeMode="contain"
            />
          ) : isVideo && staticThumbnailUrl && !isLoaded ? (
            <Image
              source={{ uri: staticThumbnailUrl }}
              style={styles.fullscreenMediaImage}
              resizeMode="cover"
            />
          ) : !isVideo ? (
            <View style={[styles.fullscreenMediaImage, styles.noMediaPlaceholder]}>
              <MaterialIcons name="image" size={48} color="#444" />
            </View>
          ) : null}

          {isVideo && videoUrl && (
            <TouchableOpacity
              activeOpacity={1}
              onPress={handleVideoPress}
              style={styles.fullscreenVideoWrapper}
            >
              <Video
                ref={videoRef}
                source={{
                  uri: videoUrl,
                  headers: {
                    'Cache-Control': 'public, max-age=31536000, immutable'
                  }
                }}
                style={styles.fullscreenMediaVideo}
                resizeMode={ResizeMode.CONTAIN}
                shouldPlay={true}
                isLooping={true}
                isMuted={isMuted}
                usePoster={false}
                shouldCorrectPitch={true}
                volume={isMuted ? 0 : 1}
                useNativeControls={false}
                progressUpdateIntervalMillis={100}
                onLoadStart={() => {
                  setIsLoaded(false);
                }}
                onLoad={() => {
                  setIsLoaded(true);
                  videoRef.current?.playAsync().catch(() => { });
                }}
                onPlaybackStatusUpdate={handlePlaybackStatusUpdate}
                onError={(error) => {
                  console.error('❌ [Video] Playback error:', error);
                }}
              />

              {isMuted && (
                <View style={styles.muteIndicatorOverlay}>
                  <View style={styles.muteIndicatorBadge}>
                    <Feather name="volume-x" size={32} color="rgba(255,255,255,0.8)" />
                  </View>
                </View>
              )}
            </TouchableOpacity>
          )}

          {isVideo && isLoaded && videoDuration > 0 && (
            <View
              style={[
                styles.progressBarContainerFullscreen,
                {
                  position: 'absolute',
                  bottom: 60 + insets.bottom - 48,
                  left: 0,
                  right: 0,
                },
              ]}
            >
              <View style={styles.progressBarTrack}>
                <View
                  style={[
                    styles.progressBarFill,
                    {
                      width: `${videoProgress * 100}%`,
                      backgroundColor: '#60a5fa',
                    }
                  ]}
                />
              </View>
            </View>
          )}
        </View>

        <View style={[styles.fullscreenPostInfo, { bottom: insets.bottom + 20 }]}>
          <View style={styles.fullscreenPostInfoContent}>
            {item.user && (
              <TouchableOpacity onPress={() => {
                if (item.user?.id) {
                  router.push({
                    pathname: '/user/[id]',
                    params: { id: item.user.id }
                  });
                }
              }}>
                <Text style={styles.fullscreenUsername}>@{item.user?.username || 'unknown'}</Text>
              </TouchableOpacity>
            )}

            {(item.caption || item.description || item.title) && (
              <Text style={styles.fullscreenCaption} numberOfLines={2}>
                {item.caption || item.description || item.title || ''}
              </Text>
            )}

            {(item.createdAt || item.uploadDate || (item as any).created_at) && (
              <Text style={styles.fullscreenTimestamp}>
                {timeAgo(item.createdAt || item.uploadDate || (item as any).created_at)}
              </Text>
            )}
          </View>
        </View>
      </View>
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
                  Alert.alert('Competition Posts', `There are ${posts.length} posts in this competition`, [
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
          <View style={[styles.actionsSection, { backgroundColor: C.card, borderTopColor: C.border }]}>
            {!challenge.is_participant ? (
              <>
                {/* Only show Join button if not ended */}
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
                          {!hasStarted()
                            ? 'Challenge Not Started'
                            : 'Join Challenge'}
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

        {/* Tabs */}
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

            {/* Only show Participants tab for authenticated users */}
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

  // Determine data source based on active tab
  const data = activeTab === 'posts' ? posts : allParticipants;
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

      {/* Main Content - Single FlatList */}
      <FlatList
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
        contentContainerStyle={
          data.length === 0
            ? { flex: 1 }
            : activeTab === 'posts'
              ? styles.postsGrid
              : styles.participantsList
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={C.primary}
            colors={[C.primary]}
          />
        }
        ListFooterComponent={<View style={{ height: 100 }} />}
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
              {fullscreenIndex + 1} / {posts.length}
            </Text>
          </View>

          <FlatList
            ref={fullscreenListRef}
            data={posts}
            renderItem={({ item, index }) => (
              <FullscreenPostViewer item={item} index={index} insets={insets} C={C} />
            )}
            keyExtractor={(item) => item.id}
            pagingEnabled
            scrollEventThrottle={16}
            showsVerticalScrollIndicator={false}
            onMomentumScrollEnd={(event) => {
              const index = Math.round(
                event.nativeEvent.contentOffset.y /
                event.nativeEvent.layoutMeasurement.height
              );
              setFullscreenIndex(index);
            }}
            initialScrollIndex={fullscreenIndex}
            getItemLayout={(data, index) => ({
              length: Dimensions.get('window').height - 80,
              offset: (Dimensions.get('window').height - 80) * index,
              index,
            })}
          />
        </SafeAreaView>
      </Modal>

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
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    backgroundColor: '#000',
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
    backgroundColor: '#000',
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
    backgroundColor: '#000',
  },
  fullscreenMediaWrapper: {
    flex: 1,
    width: '100%',
    backgroundColor: '#000',
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