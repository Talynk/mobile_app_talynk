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
} from 'react-native';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { challengesApi, followsApi } from '@/lib/api';
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
import { useAppSelector } from '@/lib/store/hooks';
import { useLikesManager } from '@/lib/hooks/use-likes-manager';
import { Share } from 'react-native';
import { useRealtime } from '@/lib/realtime-context';
import {
  formatChallengeDateTime,
  getChallengeDateInfo,
  getChallengeDisplayStatus,
  getCurrentTimeZoneLabel,
  isChallengeOver,
  isChallengeRunning,
} from '@/lib/utils/challenge';
import {
  loadFallbackChallengePosts,
  sortChallengePostsByLikes,
} from '@/lib/utils/challenge-post-fallback';
import {
  shouldPreloadFeedVideo,
  VIDEO_FEED_INITIAL_NUM_TO_RENDER,
  VIDEO_FEED_MAX_TO_RENDER_PER_BATCH,
  VIDEO_FEED_REMOVE_CLIPPED_SUBVIEWS,
  VIDEO_FEED_WINDOW_SIZE,
} from '@/lib/utils/video-feed';
import { primePostDetailsCache } from '@/lib/post-details-cache';

const { width: screenWidth } = Dimensions.get('window');
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

const WINNER_MEDALS = {
  1: {
    colors: ['#fef3c7', '#f59e0b'],
    badge: '#f59e0b',
    text: '#78350f',
    title: 'Gold',
  },
  2: {
    colors: ['#e5e7eb', '#94a3b8'],
    badge: '#94a3b8',
    text: '#1f2937',
    title: 'Silver',
  },
  3: {
    colors: ['#fed7aa', '#c2410c'],
    badge: '#c2410c',
    text: '#431407',
    title: 'Bronze',
  },
} as const;

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
  const challengeDetailListRef = useRef<FlatList>(null);
  const [reportModalVisible, setReportModalVisible] = useState(false);
  const [reportPostId, setReportPostId] = useState<string | null>(null);
  const [commentsModalVisible, setCommentsModalVisible] = useState(false);
  const [commentsPostId, setCommentsPostId] = useState<string | null>(null);
  const [userFollowStatus, setUserFollowStatus] = useState<Record<string, boolean>>({});
  const { followedUsers, updateFollowedUsers } = useCache();
  const likesManager = useLikesManager();
  const likedPosts = useAppSelector(state => state.likes.likedPosts);
  const { onChallengeLikesUpdated } = useRealtime();
  const localTimeZoneLabel = useMemo(() => getCurrentTimeZoneLabel(), []);
  const challengeEnded = useMemo(() => isChallengeOver(challenge), [challenge]);
  const [activeTab, setActiveTab] = useState<'posts' | 'participants' | 'winners'>('posts');
  const [allParticipants, setAllParticipants] = useState<any[]>([]);
  const [loadingAllParticipants, setLoadingAllParticipants] = useState(false);
  const [editChallengeModalVisible, setEditChallengeModalVisible] = useState(false);
  const [rawChallengePosts, setRawChallengePosts] = useState<any[]>([]);
  const [challengeLikesMap, setChallengeLikesMap] = useState<Record<string, number>>({});
  const [useChallengeSnapshotLikes, setUseChallengeSnapshotLikes] = useState(false);
  const [winnersVisible, setWinnersVisible] = useState(false);
  const [winnersConfirmedAt, setWinnersConfirmedAt] = useState<string | null>(null);
  const [winners, setWinners] = useState<any[]>([]);
  const [loadingWinners, setLoadingWinners] = useState(false);
  const [winnersFetched, setWinnersFetched] = useState(false);
  const [postsWindowMessage, setPostsWindowMessage] = useState<string | null>(null);
  const [postsFetched, setPostsFetched] = useState(false);
  const [participantsFetched, setParticipantsFetched] = useState(false);
  const fallbackChallengeDataRef = useRef<any>(null);
  const hasHandledInitialFocusRef = useRef(false);

  useRefetchOnReconnect(() => {
    fetchChallenge({ showLoader: false });
    if (activeTab === 'participants') {
      fetchParticipants();
    } else if (activeTab === 'winners') {
      fetchWinners({ forceRefresh: true });
    } else {
      fetchPosts({ forceRefresh: true });
    }
  });

  const fetchChallenge = async (options?: { showLoader?: boolean }) => {
    if (!id) return;

    const showLoader = options?.showLoader ?? true;
    if (showLoader) {
      setLoading(true);
    }
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
      if (showLoader) {
        setLoading(false);
      }
    }
  };

  const buildLikesMapFromRawItems = useCallback((rawItems: any[]) => {
    const map: Record<string, number> = {};

    rawItems.forEach((challengePost: any) => {
      const postId = challengePost?.post?.id ?? challengePost?.post_id;
      const hasSnapshotLikes =
        challengePost?.likes_during_challenge != null || challengePost?.likes_at_challenge_end != null;

      if (postId && hasSnapshotLikes) {
        map[postId] = Number(
          challengePost?.likes_during_challenge ?? challengePost?.likes_at_challenge_end ?? 0,
        );
      }
    });

    return map;
  }, []);

  const getFallbackChallengeData = useCallback(async (options?: { forceRefresh?: boolean }) => {
    if (!id) {
      return {
        posts: [],
        likesMap: {},
        participants: [],
      };
    }

    if (
      !options?.forceRefresh &&
      fallbackChallengeDataRef.current?.challengeId === String(id)
    ) {
      return fallbackChallengeDataRef.current;
    }

    const participantSeed =
      challenge?._count?.participants &&
      allParticipants.length >= Number(challenge._count.participants)
        ? allParticipants
        : undefined;

    const fallbackData = await loadFallbackChallengePosts(String(id), participantSeed);

    const payload = {
      challengeId: String(id),
      ...fallbackData,
    };

    fallbackChallengeDataRef.current = payload;

    if (fallbackData.participants.length > 0) {
      setAllParticipants(fallbackData.participants);
      setParticipants(fallbackData.participants);
      setParticipantsFetched(true);
    }

    return payload;
  }, [allParticipants, challenge?._count?.participants, id]);

  useEffect(() => {
    fallbackChallengeDataRef.current = null;
    hasHandledInitialFocusRef.current = false;
  }, [id]);

  useEffect(() => {
    setPosts([]);
    setRawChallengePosts([]);
    setChallengeLikesMap({});
    setUseChallengeSnapshotLikes(false);
    setParticipants([]);
    setAllParticipants([]);
    setWinners([]);
    setWinnersVisible(false);
    setWinnersConfirmedAt(null);
    setPostsWindowMessage(null);
    setPostsFetched(false);
    setParticipantsFetched(false);
    setWinnersFetched(false);
    setActiveTab('posts');
    setShowFullscreen(false);
    setFullscreenIndex(0);
  }, [id]);

  const fetchPosts = async (options?: { forceRefresh?: boolean }) => {
    if (!id) return;

    setPostsLoading(true);
    setPostsWindowMessage(null);

    try {
      const response = await challengesApi.getPosts(id as string, 1, 100);

      if (response?.status === 'success') {
        const rawItems = response.data?.rawItems || [];
        const postsList = response.data?.posts || [];
        const normalizedPosts = filterHlsReady(Array.isArray(postsList) ? postsList : []);
        const likesMapFromResponse = buildLikesMapFromRawItems(Array.isArray(rawItems) ? rawItems : []);
        const challengeStatus = response.data?.challenge_status;
        const shouldUseFallback =
          normalizedPosts.length === 0 &&
          Array.isArray(rawItems) &&
          rawItems.length === 0 &&
          response.data?.winners_visible === false &&
          (challengeStatus === 'ended' || challengeStatus === 'stopped');

        if (shouldUseFallback) {
          const fallbackData = await getFallbackChallengeData(options);

          primePostDetailsCache(fallbackData.posts);
          setPosts(fallbackData.posts);
          setRawChallengePosts([]);
          setChallengeLikesMap(fallbackData.likesMap);
          setUseChallengeSnapshotLikes(fallbackData.posts.length > 0);
          setPostsWindowMessage(fallbackData.posts.length > 0 ? null : 'No posts yet');
          setPostsFetched(true);
          return;
        }

        const hasSnapshotLikes = Object.keys(likesMapFromResponse).length > 0;

        primePostDetailsCache(normalizedPosts);
        setPosts(normalizedPosts);
        setRawChallengePosts(Array.isArray(rawItems) ? rawItems : []);
        setChallengeLikesMap(likesMapFromResponse);
        setUseChallengeSnapshotLikes(hasSnapshotLikes);
        setWinnersVisible(response.data?.winners_visible === true);
        setWinnersConfirmedAt(response.data?.winners_confirmed_at ?? null);
        setPostsWindowMessage(normalizedPosts.length > 0 ? null : 'No posts yet');
        setPostsFetched(true);
      } else {
        const fallbackData =
          challengeEnded || challenge?.status === 'ended' || challenge?.status === 'stopped'
            ? await getFallbackChallengeData(options)
            : null;

        if (fallbackData && fallbackData.posts.length > 0) {
          primePostDetailsCache(fallbackData.posts);
          setPosts(fallbackData.posts);
          setRawChallengePosts([]);
          setChallengeLikesMap(fallbackData.likesMap);
          setUseChallengeSnapshotLikes(true);
          setPostsWindowMessage(null);
          setPostsFetched(true);
        } else {
          setPosts([]);
          setRawChallengePosts([]);
          setChallengeLikesMap({});
          setUseChallengeSnapshotLikes(false);
          setPostsWindowMessage(response?.message || 'Failed to fetch challenge posts');
        }
      }
    } catch (err: any) {
      console.warn('Error fetching challenge posts:', err?.message);
      const fallbackData =
        challengeEnded || challenge?.status === 'ended' || challenge?.status === 'stopped'
          ? await getFallbackChallengeData(options)
          : null;

      if (fallbackData && fallbackData.posts.length > 0) {
        primePostDetailsCache(fallbackData.posts);
        setPosts(fallbackData.posts);
        setRawChallengePosts([]);
        setChallengeLikesMap(fallbackData.likesMap);
        setUseChallengeSnapshotLikes(true);
        setPostsWindowMessage(null);
        setPostsFetched(true);
      } else {
        setPosts([]);
        setRawChallengePosts([]);
        setChallengeLikesMap({});
        setUseChallengeSnapshotLikes(false);
        setPostsWindowMessage(err?.message || 'Failed to fetch challenge posts');
      }
    } finally {
      setPostsLoading(false);
    }
  };

  const fetchParticipants = async () => {
    if (!id) return;

    setLoadingAllParticipants(true);
    setLoadingParticipants(true);

    try {
      const response = await challengesApi.getParticipantsRanking(id as string, 1, 100);

      if (response?.status === 'success') {
        const participantsList = response.data?.participants || [];
        const normalizedParticipants = Array.isArray(participantsList) ? participantsList : [];
        setAllParticipants(normalizedParticipants);
        setParticipants(normalizedParticipants);
        setParticipantsFetched(true);
      } else {
        setAllParticipants([]);
        setParticipants([]);
      }
    } catch (err: any) {
      console.warn('Error fetching challenge participants:', err?.message);
      setAllParticipants([]);
      setParticipants([]);
    } finally {
      setLoadingAllParticipants(false);
      setLoadingParticipants(false);
    }
  };

  const fetchWinners = useCallback(async (options?: { forceRefresh?: boolean }) => {
    if (!id) return;

    setLoadingWinners(true);

    try {
      const response = await challengesApi.getWinners(id as string, 1, 100);

      if (response?.status === 'success') {
        const winnersList = Array.isArray(response.data?.winners) ? response.data.winners : [];
        const normalizedWinners = winnersList.map((winner: any) => ({
          ...winner,
          winner_rank: winner?.winner_rank != null ? Number(winner.winner_rank) : null,
          total_winner_posts: Number(winner?.total_winner_posts ?? winner?.posts?.length ?? 0),
          total_likes_during_challenge: Number(winner?.total_likes_during_challenge ?? 0),
          latest_submission_at: winner?.latest_submission_at ?? null,
          posts: Array.isArray(winner?.posts) ? winner.posts : [],
        }));

        setWinners(normalizedWinners);
        setWinnersVisible(response.data?.winners_visible === true);
        setWinnersConfirmedAt(response.data?.winners_confirmed_at ?? null);
        setWinnersFetched(true);
      } else {
        setWinners([]);
        setWinnersVisible(false);
        setWinnersConfirmedAt(null);
        setWinnersFetched(false);
      }
    } catch (err: any) {
      console.warn('Error fetching challenge winners:', err?.message);
      setWinners([]);
      setWinnersVisible(false);
      setWinnersConfirmedAt(null);
      setWinnersFetched(false);
    } finally {
      setLoadingWinners(false);
    }
  }, [id]);

  const handleTabChange = useCallback((
    tab: 'posts' | 'participants' | 'winners',
    options?: { forceRefresh?: boolean }
  ) => {
    if (tab !== activeTab) {
      setActiveTab(tab);
    }

    if (tab === 'participants') {
      if (!participantsFetched || options?.forceRefresh) {
        fetchParticipants();
      }
      return;
    }

    if (tab === 'winners') {
      if (!winnersFetched || options?.forceRefresh) {
        fetchWinners(options);
      }
      return;
    }

    if (!postsFetched || options?.forceRefresh) {
      fetchPosts(options);
    }
  }, [activeTab, participantsFetched, postsFetched, winnersFetched]);

  // Initial load when screen mounts or challenge id changes.
  useEffect(() => {
    fetchChallenge();
    fetchPosts();
    fetchParticipants();
  }, [id]);

  useEffect(() => {
    if (!challenge || challenge.status === 'pending' || !challengeEnded || winnersFetched) {
      return;
    }

    fetchWinners();
  }, [challenge?.id, challengeEnded, winnersFetched]);

  // Refresh challenge + posts when screen regains focus (not on every tab change).
  useFocusEffect(
    useCallback(() => {
      if (!hasHandledInitialFocusRef.current) {
        hasHandledInitialFocusRef.current = true;
        return;
      }

      fetchChallenge({ showLoader: false });
      if (activeTab === 'participants') {
        fetchParticipants();
      } else if (activeTab === 'winners') {
        fetchWinners();
      } else {
        fetchPosts();
      }
    }, [id, activeTab])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    if (activeTab === 'participants') {
      await Promise.all([fetchChallenge({ showLoader: false }), fetchParticipants()]);
    } else if (activeTab === 'winners') {
      await Promise.all([fetchChallenge({ showLoader: false }), fetchWinners({ forceRefresh: true })]);
    } else {
      await Promise.all([fetchChallenge({ showLoader: false }), fetchPosts({ forceRefresh: true })]);
    }
    setRefreshing(false);
  };

  useEffect(() => {
    return onChallengeLikesUpdated((update) => {
      if (!id || update.challengeId !== id) {
        return;
      }

      setPosts((prev) =>
        prev.map((post: any) =>
          post.id === update.postId
            ? { ...post, likes: update.likeCount, like_count: update.likeCount, total_likes: update.likeCount }
            : post
        ),
      );

      if (!challengeEnded && participantsFetched) {
        fetchParticipants();
      }
    });
  }, [challengeEnded, id, onChallengeLikesUpdated, participantsFetched]);

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

    if (challenge?.organizer_id === user?.id || challenge?.organizer?.id === user?.id) {
      Alert.alert('Cannot Join', 'You cannot join a competition that you organized.');
      return;
    }

    if (challengeEnded) {
      Alert.alert('Competition Ended', 'This competition has already ended. You cannot join it anymore.');
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
    if (challenge?.organizer_id === user?.id || challenge?.organizer?.id === user?.id) {
      Alert.alert('Not Allowed', 'You cannot create a post in a competition that you organized.');
      return;
    }

    if (challengeEnded) {
      Alert.alert('Competition Ended', 'This competition has ended, so new posts are no longer allowed.');
      return;
    }

    if (!challenge?.is_participant) {
      Alert.alert('Join Required', 'You must join the competition before posting');
      return;
    }

    router.push({
      pathname: '/(tabs)/create',
      params: { challengeId: id as string, challengeName: challenge.name, fromChallenge: '1' }
    });
  };

  const formatDate = (dateString: string) => {
    return formatChallengeDateTime(dateString, { month: 'short' });
  };

  const getChallengeStatus = () => {
    const status = getChallengeDisplayStatus(challenge);

    switch (status.key) {
      case 'pending':
        return { label: status.label, color: C.warning };
      case 'rejected':
        return { label: status.label, color: C.error };
      case 'ongoing':
        return { label: status.label, color: C.success };
      case 'upcoming':
        return { label: status.label, color: C.warning };
      case 'ended_early':
        return { label: status.label, color: C.textSecondary };
      case 'ended':
      case 'inactive':
      default:
        return { label: status.label, color: C.textSecondary };
    }
  };

  const isActive = () => {
    return isChallengeRunning(challenge);
  };

  const hasStarted = () => {
    if (!challenge) return false;
    return new Date() >= new Date(challenge.start_date);
  };

  const canJoin = () => {
    if (!challenge) return false;
    if (challenge.organizer_id === user?.id || challenge.organizer?.id === user?.id) return false;
    return isChallengeRunning(challenge) && !challenge.is_participant;
  };

  const getDateInfo = () => {
    return getChallengeDateInfo(challenge);
  };

  const isChallengeEnded = challengeEnded;
  const likesDuringChallengeMap = useMemo(() => {
    if (Object.keys(challengeLikesMap).length > 0) {
      return challengeLikesMap;
    }

    const map: Record<string, number> = {};
    rawChallengePosts.forEach((cp: any) => {
      const postId = cp.post?.id ?? cp.post_id;
      const hasSnapshotLikes = cp?.likes_during_challenge != null || cp?.likes_at_challenge_end != null;
      if (postId && hasSnapshotLikes) {
        map[postId] = Number(cp?.likes_during_challenge ?? cp?.likes_at_challenge_end ?? 0);
      }
    });
    return map;
  }, [challengeLikesMap, rawChallengePosts]);

  const hasChallengeSnapshotLikes = useMemo(
    () =>
      useChallengeSnapshotLikes ||
      rawChallengePosts.some(
        (challengePost: any) =>
          challengePost?.likes_during_challenge != null || challengePost?.likes_at_challenge_end != null,
      ),
    [rawChallengePosts, useChallengeSnapshotLikes],
  );

  const sortedPosts = useMemo(() => {
    if (!posts.length) return posts;
    return sortChallengePostsByLikes(posts, likesDuringChallengeMap, hasChallengeSnapshotLikes);
  }, [posts, hasChallengeSnapshotLikes, likesDuringChallengeMap]);

  const sortedParticipants = useMemo(() => {
    if (!allParticipants.length) return allParticipants;
    return [...allParticipants].sort((a, b) => {
      const likesA = Number(a.total_likes ?? 0);
      const likesB = Number(b.total_likes ?? 0);
      if (likesB !== likesA) return likesB - likesA;
      return new Date(b.latest_submission_at || 0).getTime() - new Date(a.latest_submission_at || 0).getTime();
    });
  }, [allParticipants]);

  const sortedWinners = useMemo(() => {
    if (!winners.length) return winners;
    return [...winners].sort((a, b) => {
      const rankA = Number(a.winner_rank ?? 999);
      const rankB = Number(b.winner_rank ?? 999);
      if (rankA !== rankB) return rankA - rankB;

      const likesA = Number(a.total_likes_during_challenge ?? 0);
      const likesB = Number(b.total_likes_during_challenge ?? 0);
      if (likesB !== likesA) return likesB - likesA;

      return (
        new Date(b.latest_submission_at || 0).getTime() -
        new Date(a.latest_submission_at || 0).getTime()
      );
    });
  }, [winners]);

  const winnersAnnounced = winnersVisible && sortedWinners.length > 0;

  const isOrganizer = challenge?.organizer_id === user?.id || challenge?.organizer?.id === user?.id;

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

  const openCompetitionUserPosts = useCallback((
    targetUserId: string | null | undefined,
    targetUsername: string | null | undefined,
    mode: 'participant' | 'winner',
  ) => {
    if (!targetUserId || !challenge?.id) {
      return;
    }

    router.push({
      pathname: '/challenges/[id]/posts',
      params:
        mode === 'winner'
          ? {
              id: String(challenge.id),
              winnerUserId: String(targetUserId),
              winnerUsername: String(targetUsername || ''),
            }
          : {
              id: String(challenge.id),
              participantUserId: String(targetUserId),
              participantUsername: String(targetUsername || ''),
            },
    });
  }, [challenge?.id]);

  const postRows = useMemo(() => {
    const rows: Array<{ id: string; items: any[]; startIndex: number }> = [];
    for (let index = 0; index < sortedPosts.length; index += 3) {
      const items = sortedPosts.slice(index, index + 3);
      rows.push({
        id: items.map((post: any) => post.id).join('-') || `row-${index}`,
        items,
        startIndex: index,
      });
    }
    return rows;
  }, [sortedPosts]);

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
    const visibleLikes = hasChallengeSnapshotLikes
      ? likesDuringChallengeMap[item.id] ?? 0
      : Number(item.likes ?? item.like_count ?? 0);

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

        <View style={styles.gridCardMeta}>
          <View style={styles.gridLikesBadge}>
            <Feather name="heart" size={12} color="#fff" />
            <Text style={styles.gridLikesText}>{visibleLikes}</Text>
          </View>
          {isVideo && (
            <View style={styles.gridPlayBadge}>
              <Feather name="play" size={14} color="#fff" />
            </View>
          )}
        </View>
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
      <View style={{ flex: 0 }}>
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
                  <View style={styles.organizerActionsRow}>
                    <TouchableOpacity
                      style={[styles.organizerActionButton, { backgroundColor: C.primary }]}
                      onPress={() => handleTabChange('participants')}
                    >
                      <MaterialIcons name="people" size={20} color="#fff" />
                      <Text style={styles.organizerActionText}>View Participants</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.organizerActionButton, { backgroundColor: C.success }]}
                      onPress={() => handleTabChange('posts')}
                    >
                      <MaterialIcons name="video-library" size={20} color="#fff" />
                      <Text style={styles.organizerActionText}>View Posts</Text>
                    </TouchableOpacity>
                  </View>
                  {challengeEnded && (
                    <TouchableOpacity
                      style={[styles.organizerActionButton, styles.organizerActionButtonFull, { backgroundColor: '#f59e0b' }]}
                      onPress={() => handleTabChange('winners')}
                    >
                      <MaterialIcons name="emoji-events" size={20} color="#fff" />
                      <Text style={styles.organizerActionText}>View Winners</Text>
                    </TouchableOpacity>
                  )}
                </>
              )}
            </View>
          </View>
        ) : (
          <View style={[styles.actionsSection, { backgroundColor: C.card, borderTopColor: C.border }]}>
            {!challenge.is_participant ? (
              <>
                {!challengeEnded ? (
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

                {!hasStarted() && !challengeEnded && (
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
                {challengeEnded ? (
                  <View style={styles.challengeEndedBadge}>
                    <MaterialIcons name="event-busy" size={18} color={C.textSecondary} />
                    <Text style={[styles.challengeEndedBadgeText, { color: C.textSecondary }]}>Competition Ended</Text>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={[styles.createPostButton, { backgroundColor: C.primary }]}
                    onPress={handleCreatePost}
                  >
                    <MaterialIcons name="add-circle-outline" size={20} color="#fff" />
                    <Text style={styles.createPostText}>Create Post</Text>
                  </TouchableOpacity>
                )}
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
            <View style={styles.durationBlock}>
              {(() => {
                const dateInfo = getDateInfo();
                if (!dateInfo) return null;
                return (
                  <>
                    <Text style={[styles.detailText, { color: C.text }]}>
                      {dateInfo.label} {formatDate(dateInfo.date.toISOString())}
                    </Text>
                    {dateInfo.showEndDate && dateInfo.endDate && (
                      <Text style={[styles.detailText, { color: C.text }]}>
                        Ends {formatDate(dateInfo.endDate.toISOString())}
                      </Text>
                    )}
                    <Text style={[styles.detailMetaText, { color: C.textSecondary }]}>
                      Times shown in your local time zone ({localTimeZoneLabel})
                    </Text>
                  </>
                );
              })()}
            </View>
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
                onPress={() => handleTabChange('posts')}
              >
                <MaterialIcons
                  name="video-library"
                  size={18}
                  color={activeTab === 'posts' ? C.primary : C.textSecondary}
                />
                <Text style={[
                  styles.tabText,
                  { color: activeTab === 'posts' ? C.primary : C.textSecondary }
                ]} numberOfLines={1}>Posts</Text>
                <View style={[styles.tabCountBadge, activeTab === 'posts' && styles.tabCountBadgeActive]}>
                  <Text style={[styles.tabCountText, activeTab === 'posts' && styles.tabCountTextActive]}>{postCount}</Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.tab,
                  activeTab === 'participants' && styles.tabActive
                ]}
                onPress={() => handleTabChange('participants')}
              >
                <MaterialIcons
                  name="people"
                  size={18}
                  color={activeTab === 'participants' ? C.primary : C.textSecondary}
                />
                <Text style={[
                  styles.tabText,
                  { color: activeTab === 'participants' ? C.primary : C.textSecondary }
                ]} numberOfLines={1}>Participants</Text>
                <View style={[styles.tabCountBadge, activeTab === 'participants' && styles.tabCountBadgeActive]}>
                  <Text style={[styles.tabCountText, activeTab === 'participants' && styles.tabCountTextActive]}>{participantCount}</Text>
                </View>
              </TouchableOpacity>
              {challengeEnded && (
                <TouchableOpacity
                  style={[styles.tab, activeTab === 'winners' && styles.tabActive]}
                  onPress={() => handleTabChange('winners')}
                >
                  <MaterialIcons
                    name="emoji-events"
                    size={18}
                    color={activeTab === 'winners' ? C.primary : C.textSecondary}
                  />
                  <Text style={[
                    styles.tabText,
                    { color: activeTab === 'winners' ? C.primary : C.textSecondary }
                  ]}>
                    Winners
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        {activeTab === 'winners' && challengeEnded && (
          loadingWinners ? (
            <View style={[styles.winnersAnnouncement, { backgroundColor: C.card, borderColor: C.border }]}>
              <ActivityIndicator size="small" color={C.primary} />
              <Text style={[styles.winnersAnnouncementText, { color: C.text }]}>
                Loading winners...
              </Text>
            </View>
          ) : winnersAnnounced ? (
            <View style={[styles.winnersSection, { backgroundColor: C.card, borderColor: C.border }]}>
              <Text style={[styles.winnersTitle, { color: C.text }]}>Official Winners</Text>
              <Text style={[styles.winnersSubtitle, { color: C.textSecondary }]}>
                {`Organizer-confirmed winner order.${winnersConfirmedAt ? ` Announced ${formatDate(winnersConfirmedAt)}.` : ''} Tap a winner to view that user's competition posts.`}
              </Text>
            </View>
          ) : (
            <View style={[styles.winnersAnnouncement, { backgroundColor: C.card, borderColor: C.border }]}>
              <MaterialIcons name="emoji-events" size={44} color={C.textSecondary} />
              <Text style={[styles.winnersAnnouncementText, { color: C.text }]}>
                The winners are not yet announced
              </Text>
            </View>
          )
        )}
      </View>
    );
  };

  // Render item for the main FlatList
  const renderItem = ({ item, index }: { item: any; index: number }) => {
    const row = item as { items: any[]; startIndex: number };
    if (activeTab === 'posts') {
      return (
        <View style={styles.postsRow}>
          {row.items.map((post: any, columnIndex: number) => (
            <GridPostCard
              key={post.id || `post-${row.startIndex + columnIndex}`}
              item={post}
              index={row.startIndex + columnIndex}
            />
          ))}
          {Array.from({ length: Math.max(0, 3 - row.items.length) }).map((_, spacerIndex) => (
            <View key={`spacer-${row.startIndex}-${spacerIndex}`} style={styles.gridPostSpacer} />
          ))}
        </View>
      );
    }

    if (activeTab === 'winners') {
      const winnerUser = item.user || {};
      const winnerRank = index + 1;
      const winnerLikes = Number(item.total_likes_during_challenge ?? 0);
      const winnerPostsCount = Number(item.total_winner_posts ?? item.posts?.length ?? 0);
      const medal = WINNER_MEDALS[winnerRank as 1 | 2 | 3];

      return (
        <TouchableOpacity
          style={[
            styles.winnerUserRow,
            { backgroundColor: C.card, borderColor: C.border },
            medal && styles.winnerUserRowTopThree,
          ]}
          onPress={() =>
            openCompetitionUserPosts(
              winnerUser.id || item.user_id,
              winnerUser.username,
              'winner',
            )
          }
        >
          {/* Left Column: Rank Badge + Avatar */}
          <View style={styles.winnerUserLeftCol}>
            <View style={styles.winnerUserRankWrap}>
              {medal ? (
                <LinearGradient colors={medal.colors} style={styles.winnerUserRankBadge}>
                  <MaterialIcons name="workspace-premium" size={14} color={medal.text} />
                  <Text style={[styles.winnerUserRankText, { color: medal.text }]}>{winnerRank}</Text>
                </LinearGradient>
              ) : (
                <View style={styles.winnerUserRankPlain}>
                  <Text style={styles.winnerUserRankPlainText}>#{winnerRank}</Text>
                </View>
              )}
            </View>

            <Avatar
              user={winnerUser}
              size={54}
              style={styles.winnerUserAvatar}
            />
          </View>

          {/* Right Column: User Info */}
          <View style={styles.winnerUserInfo}>
            <Text style={[styles.winnerUserName, { color: C.text }]}>
              {winnerUser.display_name || winnerUser.username || 'Unknown'}
            </Text>
            <Text style={[styles.winnerUserUsername, { color: C.textSecondary }]}>
              @{winnerUser.username || 'unknown'}
            </Text>
            
            <View style={styles.winnerUserStatsRow}>
              <View style={styles.winnerUserStatChip}>
                <MaterialIcons name="video-library" size={12} color="#cbd5e1" style={{ marginRight: 4 }} />
                <Text style={styles.winnerUserStatChipText}>{winnerPostsCount} posts</Text>
              </View>
              <View style={styles.winnerUserStatChip}>
                <MaterialIcons name="favorite" size={12} color="#cbd5e1" style={{ marginRight: 4 }} />
                <Text style={styles.winnerUserStatChipText}>{Number(winnerLikes).toLocaleString()} likes</Text>
              </View>
            </View>
            
            {item.latest_submission_at && (
              <Text style={[styles.winnerUserMeta, { color: C.textSecondary }]}>
                Latest sub: {formatDate(item.latest_submission_at)}
              </Text>
            )}
          </View>

          <Feather name="chevron-right" size={20} color={C.textSecondary} style={{ marginLeft: 8 }} />
        </TouchableOpacity>
      );
    }

    const participantUser = item.user || item;
    const postCount = Number(item.total_posts ?? item.post_count ?? 0);
    const totalLikesInChallenge = Number(item.total_likes ?? 0);
    const latestSubmissionAt = item.latest_submission_at;

    return (
      <TouchableOpacity
        style={[styles.participantItem, { backgroundColor: C.card, borderColor: C.border }]}
        onPress={() =>
          openCompetitionUserPosts(
            participantUser.id || item.user_id,
            participantUser.username,
            'participant',
          )
        }
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
          {latestSubmissionAt && (
            <Text style={[styles.participantJoined, { color: C.textSecondary }]}>
              Latest submission {formatDate(latestSubmissionAt)}
            </Text>
          )}
        </View>
        <View style={styles.participantStats}>
          <View style={styles.participantStatColumn}>
            <Text style={[styles.participantStatLabel, { color: C.textSecondary }]}>
              Posts
            </Text>
            <View style={styles.participantStatRow}>
              <MaterialIcons name="video-library" size={16} color={C.textSecondary} />
              <Text style={[styles.participantStatText, { color: C.textSecondary }]}>
                {postCount}
              </Text>
            </View>
          </View>
          <View style={styles.participantStatColumn}>
            <Text style={[styles.participantStatLabel, { color: C.textSecondary }]}>
              Likes
            </Text>
            <View style={styles.participantStatRow}>
              <MaterialIcons name="favorite" size={16} color={C.textSecondary} />
              <Text style={[styles.participantStatText, { color: C.textSecondary }]}>
                {totalLikesInChallenge}
              </Text>
            </View>
          </View>
        </View>
      </TouchableOpacity>
    );
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

  // Determine data source based on active tab without remounting the list.
  const data =
    activeTab === 'posts'
      ? postRows
      : activeTab === 'participants'
        ? sortedParticipants
        : winnersAnnounced
          ? sortedWinners
          : [];
  const isLoading = activeTab === 'winners' ? loadingWinners : (activeTab === 'posts' ? postsLoading : loadingAllParticipants);

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
        ref={challengeDetailListRef}
        style={styles.challengeDetailList}
        data={data}
        renderItem={renderItem}
        keyExtractor={(item, index) => {
          if (activeTab === 'posts') {
            return item.id || `post-row-${index}`;
          }

          if (activeTab === 'participants') {
            return item.user?.id || item.user_id || item.id || `participant-${index}`;
          }

          return item.user?.id || item.user_id || item.id || `winner-${index}`;
        }}
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.postsLoading}>
              <ActivityIndicator size="small" color={C.primary} />
            </View>
          ) : activeTab === 'winners' ? null : (
            <View style={activeTab === 'posts' ? styles.emptyPosts : styles.emptyParticipants}>
              <MaterialIcons
                name={activeTab === 'posts' ? "video-library" : "people-outline"}
                size={48}
                color={C.textSecondary}
              />
              <Text style={[styles.emptyText, { color: C.textSecondary }]}>
                {activeTab === 'posts'
                  ? (postsWindowMessage || 'No posts yet')
                  : 'No participant rankings yet'}
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
              const shouldPreload = shouldPreloadFeedVideo(index, fullscreenIndex, { disabled: isActive });
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
            windowSize={VIDEO_FEED_WINDOW_SIZE}
            initialNumToRender={VIDEO_FEED_INITIAL_NUM_TO_RENDER}
            maxToRenderPerBatch={VIDEO_FEED_MAX_TO_RENDER_PER_BATCH}
            removeClippedSubviews={VIDEO_FEED_REMOVE_CLIPPED_SUBVIEWS}
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
                        if (participantUser.id && challenge?.id) {
                          openCompetitionUserPosts(
                            participantUser.id,
                            participantUser.username,
                            'participant',
                          );
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
  detailMetaText: {
    fontSize: 12,
    lineHeight: 18,
  },
  durationBlock: {
    gap: 6,
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
    gap: 12,
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
  challengeEndedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  challengeEndedBadgeText: {
    fontSize: 13,
    fontWeight: '700',
    marginLeft: 8,
  },
  organizerActions: {
    gap: 12,
  },
  organizerActionsRow: {
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
    minHeight: 52,
    paddingHorizontal: 12,
  },
  organizerActionButtonFull: {
    width: '100%',
  },
  organizerActionText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
    marginLeft: 8,
    flexShrink: 1,
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
    gap: 8,
  },
  tab: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    minHeight: 68,
    borderRadius: 10,
    gap: 3,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    backgroundColor: 'rgba(96, 165, 250, 0.10)',
    borderColor: '#60a5fa',
    borderBottomColor: '#60a5fa',
  },
  tabText: {
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'center',
  },
  tabCountBadge: {
    minWidth: 28,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: '#1f2937',
  },
  tabCountBadgeActive: {
    backgroundColor: '#60a5fa',
  },
  tabCountText: {
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  tabCountTextActive: {
    color: '#ffffff',
  },
  winnersSection: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    borderTopWidth: 1,
  },
  winnersTitle: {
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 6,
  },
  winnersSubtitle: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 16,
  },
  winnerPodiumRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 16,
  },
  podiumCard: {
    flex: 1,
    minHeight: 188,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 14,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#1f2937',
    alignItems: 'center',
  },
  podiumCardFirst: {
    backgroundColor: '#111827',
    borderColor: '#374151',
  },
  podiumBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    marginBottom: 8,
  },
  podiumBadgeRank: {
    fontSize: 16,
    fontWeight: '900',
  },
  podiumMedalLabel: {
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 10,
  },
  podiumThumb: {
    width: '100%',
    aspectRatio: 0.92,
    borderRadius: 14,
    backgroundColor: '#222',
    marginBottom: 10,
  },
  podiumAvatarFallback: {
    marginBottom: 10,
  },
  podiumWinnerName: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 4,
  },
  podiumWinnerLikes: {
    fontSize: 12,
    fontWeight: '600',
  },
  winnerList: {
    gap: 10,
  },
  winnerUserRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 20,
    borderWidth: 1,
    gap: 16,
  },
  winnerUserRowTopThree: {
    backgroundColor: '#111827',
    borderColor: '#1f2937',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  winnerUserLeftCol: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    width: 64, // Fixed width to align avatars consistently
  },
  winnerUserRankWrap: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  winnerUserRankBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  winnerUserRankText: {
    fontSize: 14,
    fontWeight: '900',
  },
  winnerUserRankPlain: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1e293b',
  },
  winnerUserRankPlainText: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '800',
  },
  winnerUserAvatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  winnerUserInfo: {
    flex: 1,
    gap: 3,
    justifyContent: 'center',
  },
  winnerUserName: {
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  winnerUserUsername: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 4,
  },
  winnerUserStatsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  winnerUserStatChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#1e293b',
  },
  winnerUserStatChipText: {
    color: '#cbd5e1',
    fontSize: 13,
    fontWeight: '700',
  },
  winnerUserMeta: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 6,
  },
  winnerListItem: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 14,
    padding: 10,
    backgroundColor: '#111827',
    gap: 10,
  },
  winnerListRank: {
    minWidth: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0f172a',
  },
  winnerListRankText: {
    color: '#f8fafc',
    fontSize: 12,
    fontWeight: '800',
  },
  winnerListThumb: {
    width: 54,
    height: 54,
    borderRadius: 12,
    backgroundColor: '#222',
  },
  winnerListInfo: {
    flex: 1,
    gap: 4,
  },
  winnerListName: {
    fontSize: 14,
    fontWeight: '700',
  },
  winnerListLikes: {
    fontSize: 12,
    fontWeight: '600',
  },
  winnerListMeta: {
    fontSize: 11,
    lineHeight: 16,
  },
  winnersAnnouncement: {
    marginHorizontal: 16,
    marginTop: 8,
    paddingVertical: 28,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  winnerThumbPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  winnersAnnouncementText: {
    marginTop: 14,
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
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
    paddingHorizontal: 1,
    paddingTop: 1,
  },
  postsRow: {
    flexDirection: 'row',
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
  gridCardMeta: {
    position: 'absolute',
    left: 6,
    right: 6,
    bottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  gridLikesBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.68)',
  },
  gridLikesText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  gridPlayBadge: {
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  gridPostSpacer: {
    width: POST_ITEM_SIZE,
    height: POST_ITEM_SIZE,
    margin: 1,
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
    flexDirection: 'row',
    gap: 16,
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
  participantStatColumn: {
    alignItems: 'flex-end',
  },
  participantStatLabel: {
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 2,
  },
  participantStatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
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
