import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import CommentsModal from '@/components/CommentsModal';
import FullscreenFeedPostItem from '@/components/FullscreenFeedPostItem';
import ReportModal from '@/components/ReportModal';
import { useAuth } from '@/lib/auth-context';
import { useCache } from '@/lib/cache-context';
import { setFeedPlaybackBlocked } from '@/lib/feed-playback-block';
import {
  prefetchFollowingFeed,
  removeUserFromFollowingFeedCache,
  seedFollowingFeedCache,
} from '@/lib/following-feed-cache';
import { useAppActive } from '@/lib/hooks/use-app-active';
import { useSharedVideoPlaybackIsolation } from '@/lib/hooks/use-shared-video-playback-isolation';
import { pauseAllVideos } from '@/lib/hooks/use-video-pause-on-blur';
import { followsApi, likesApi } from '@/lib/api';
import { getPostDetailCached, primePostDetailsCache } from '@/lib/post-details-cache';
import { sharePost } from '@/lib/post-share';
import { useAppDispatch, useAppSelector } from '@/lib/store/hooks';
import { addLikedPost, removeLikedPost, setPostLikeCount } from '@/lib/store/slices/likesSlice';
import { Post } from '@/types';

export default function SharedPostScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const postId = typeof id === 'string' ? id : '';
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const isAppActive = useAppActive();
  const { user } = useAuth();
  const dispatch = useAppDispatch();
  const likedPosts = useAppSelector((state) => state.likes.likedPosts);
  const postLikeCounts = useAppSelector((state) => state.likes.postLikeCounts);
  const { followedUsers, followedUsersReady, updateFollowedUsers, syncFollowedUsersFromServer } = useCache();

  useSharedVideoPlaybackIsolation();

  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isScreenFocused, setIsScreenFocused] = useState(false);
  const [userFollowStatus, setUserFollowStatus] = useState<Record<string, boolean>>({});
  const [reportModalVisible, setReportModalVisible] = useState(false);
  const [commentsModalVisible, setCommentsModalVisible] = useState(false);
  const [commentsPostId, setCommentsPostId] = useState<string | null>(null);
  const [commentsPostTitle, setCommentsPostTitle] = useState('');
  const [commentsPostAuthor, setCommentsPostAuthor] = useState('');
  const [commentsPostOwnerId, setCommentsPostOwnerId] = useState<string | undefined>(undefined);

  useFocusEffect(
    useCallback(() => {
      setIsScreenFocused(true);
      return () => {
        setIsScreenFocused(false);
      };
    }, []),
  );

  useEffect(() => {
    let cancelled = false;

    const loadPost = async () => {
      if (!postId) {
        setError('Invalid shared link.');
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);
        const cachedPost = await getPostDetailCached(postId, { requireNetwork: true });
        if (cancelled) return;

        if (!cachedPost) {
          setError('This video is no longer available.');
          setPost(null);
        } else {
          primePostDetailsCache([cachedPost]);
          setPost(cachedPost as Post);
        }
      } catch (_) {
        if (!cancelled) {
          setError('Unable to load this shared video right now.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadPost();
    return () => {
      cancelled = true;
    };
  }, [postId]);

  const handleClose = useCallback(() => {
    pauseAllVideos();
    setFeedPlaybackBlocked(false);
    router.replace('/(tabs)' as any);
  }, []);

  const handleLike = useCallback(async (targetPostId: string) => {
    if (!post || targetPostId !== post.id) {
      return;
    }

    if (!user) {
      Alert.alert(
        'Login Required',
        'Please log in or sign up to like posts.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Sign Up', onPress: () => router.push({ pathname: '/auth/register' as any }) },
          { text: 'Login', onPress: () => router.push({ pathname: '/auth/login' as any }) },
        ],
      );
      return;
    }

    const currentIsLiked = likedPosts.includes(targetPostId) || post.is_liked === true;
    const currentCount = postLikeCounts[targetPostId] ?? post.like_count ?? post.likes ?? 0;
    const newIsLiked = !currentIsLiked;
    const newCount = newIsLiked ? currentCount + 1 : Math.max(0, currentCount - 1);

    if (newIsLiked) dispatch(addLikedPost(targetPostId));
    else dispatch(removeLikedPost(targetPostId));
    dispatch(setPostLikeCount({ postId: targetPostId, count: newCount }));

    setPost((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        is_liked: newIsLiked,
        like_count: newCount,
        likes: newCount,
      };
    });

    try {
      const response = await likesApi.toggle(targetPostId);
      if (response.status !== 'success') {
        if (currentIsLiked) dispatch(addLikedPost(targetPostId));
        else dispatch(removeLikedPost(targetPostId));
        dispatch(setPostLikeCount({ postId: targetPostId, count: currentCount }));
        setPost((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            is_liked: currentIsLiked,
            like_count: currentCount,
            likes: currentCount,
          };
        });
      }
    } catch (_) {
      if (currentIsLiked) dispatch(addLikedPost(targetPostId));
      else dispatch(removeLikedPost(targetPostId));
      dispatch(setPostLikeCount({ postId: targetPostId, count: currentCount }));
      setPost((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          is_liked: currentIsLiked,
          like_count: currentCount,
          likes: currentCount,
        };
      });
    }
  }, [dispatch, likedPosts, post, postLikeCounts, user]);

  const handleComment = useCallback((targetPostId: string) => {
    if (!post || targetPostId !== post.id) {
      return;
    }

    setCommentsPostId(targetPostId);
    setCommentsPostTitle(post.title || post.description || '');
    setCommentsPostAuthor(post.user?.username || '');
    setCommentsPostOwnerId(post.user?.id);
    setCommentsModalVisible(true);
  }, [post]);

  const handleShare = useCallback(async (targetPostId: string) => {
    if (!post || targetPostId !== post.id) {
      return;
    }

    try {
      await sharePost(post);
    } catch (_) {}
  }, [post]);

  const handleReport = useCallback((targetPostId: string) => {
    if (!post || targetPostId !== post.id) {
      return;
    }

    if (!user) {
      router.push({ pathname: '/auth/login' as any });
      return;
    }

    setReportModalVisible(true);
  }, [post, user]);

  const handleFollow = useCallback(async (targetUserId: string) => {
    if (!user || !post) {
      return;
    }

    setUserFollowStatus((prev) => ({ ...prev, [targetUserId]: true }));
    seedFollowingFeedCache(user.id, targetUserId, [post]);
    updateFollowedUsers(targetUserId, true);

    try {
      const response = await followsApi.follow(targetUserId);
      if (response.status !== 'success') {
        updateFollowedUsers(targetUserId, false);
        setUserFollowStatus((prev) => ({ ...prev, [targetUserId]: false }));
        removeUserFromFollowingFeedCache(user.id, targetUserId);
      } else {
        void syncFollowedUsersFromServer();
        void prefetchFollowingFeed(user.id);
      }
    } catch (_) {
      updateFollowedUsers(targetUserId, false);
      setUserFollowStatus((prev) => ({ ...prev, [targetUserId]: false }));
      removeUserFromFollowingFeedCache(user.id, targetUserId);
    }
  }, [post, syncFollowedUsersFromServer, updateFollowedUsers, user]);

  const handleUnfollow = useCallback(async (targetUserId: string) => {
    if (!user) {
      return;
    }

    setUserFollowStatus((prev) => ({ ...prev, [targetUserId]: false }));
    removeUserFromFollowingFeedCache(user.id, targetUserId);
    updateFollowedUsers(targetUserId, false);

    try {
      const response = await followsApi.unfollow(targetUserId);
      if (response.status !== 'success') {
        updateFollowedUsers(targetUserId, true);
        setUserFollowStatus((prev) => ({ ...prev, [targetUserId]: true }));
      } else {
        void syncFollowedUsersFromServer();
      }
    } catch (_) {
      updateFollowedUsers(targetUserId, true);
      setUserFollowStatus((prev) => ({ ...prev, [targetUserId]: true }));
    }
  }, [syncFollowedUsersFromServer, updateFollowedUsers, user]);

  const handleCommentAdded = useCallback(() => {
    if (!post) return;
    setPost((prev) => {
      if (!prev) return prev;
      const nextCount = (prev.comments_count || prev.comment_count || 0) + 1;
      return {
        ...prev,
        comments_count: nextCount,
        comment_count: nextCount,
      };
    });
  }, [post]);

  const handleCommentDeleted = useCallback(() => {
    if (!post) return;
    setPost((prev) => {
      if (!prev) return prev;
      const nextCount = Math.max(0, (prev.comments_count || prev.comment_count || 0) - 1);
      return {
        ...prev,
        comments_count: nextCount,
        comment_count: nextCount,
      };
    });
  }, [post]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#60a5fa" />
      </View>
    );
  }

  if (error || !post) {
    return (
      <SafeAreaView style={styles.centered}>
        <Text style={styles.errorTitle}>Video unavailable</Text>
        <Text style={styles.errorMessage}>{error || 'This shared video could not be opened.'}</Text>
        <TouchableOpacity style={styles.primaryButton} onPress={handleClose}>
          <Text style={styles.primaryButtonText}>Go to For You</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const targetUserId = post.user?.id || (post as any).user_id || (post as any).userId || '';
  const optimisticFollowStatus = targetUserId ? userFollowStatus[targetUserId] : undefined;
  const cachedFollowStatus = targetUserId ? followedUsers.has(targetUserId) : false;
  const isFollowing = optimisticFollowStatus !== undefined
    ? optimisticFollowStatus
    : (cachedFollowStatus || post.is_following_author === true);
  const isLiked = likedPosts.includes(post.id) || post.is_liked === true;
  const isActive = isScreenFocused && isAppActive && !commentsModalVisible && !reportModalVisible;
  const availableHeight = Math.max(0, screenHeight);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      <FullscreenFeedPostItem
        item={post}
        index={0}
        onLike={handleLike}
        onComment={handleComment}
        onShare={handleShare}
        onReport={handleReport}
        onFollow={handleFollow}
        onUnfollow={handleUnfollow}
        isLiked={isLiked}
        isFollowing={isFollowing}
        isFollowStateReady={!user || followedUsersReady || post.is_following_author === true}
        isActive={isActive}
        suspendPlayback={commentsModalVisible || reportModalVisible}
        shouldPreload
        availableHeight={availableHeight}
      />

      <SafeAreaView style={styles.closeOverlay} pointerEvents="box-none">
        <TouchableOpacity
          style={[styles.closeButton, { marginTop: Math.max(insets.top, 8) }]}
          onPress={handleClose}
          hitSlop={12}
          accessibilityLabel="Close shared video"
          accessibilityRole="button"
        >
          <Feather name="x" size={28} color="#fff" />
        </TouchableOpacity>
      </SafeAreaView>

      <ReportModal
        isVisible={reportModalVisible}
        onClose={() => setReportModalVisible(false)}
        postId={post.id}
        onReported={() => {
          setReportModalVisible(false);
          Alert.alert('Reported', 'Thank you for reporting this content. We will review it shortly.');
        }}
      />

      <CommentsModal
        visible={commentsModalVisible && !!commentsPostId}
        onClose={() => {
          setCommentsModalVisible(false);
          setTimeout(() => setCommentsPostId(null), 300);
        }}
        postId={commentsPostId || post.id}
        postTitle={commentsPostTitle}
        postAuthor={commentsPostAuthor}
        postOwnerId={commentsPostOwnerId}
        onCommentAdded={handleCommentAdded}
        onCommentDeleted={handleCommentDeleted}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  centered: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  closeOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'flex-start',
    paddingHorizontal: 16,
  },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  errorTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  errorMessage: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 20,
  },
  primaryButton: {
    backgroundColor: '#60a5fa',
    borderRadius: 999,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  primaryButtonText: {
    color: '#000',
    fontWeight: '700',
    fontSize: 15,
  },
});
