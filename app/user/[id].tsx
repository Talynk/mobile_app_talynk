import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ScrollView,
  ActivityIndicator,
  useColorScheme,
  FlatList,
  Modal,
  Share,
  Alert,
  RefreshControl,
  Dimensions,
} from 'react-native';
import { useLocalSearchParams, router, useFocusEffect } from 'expo-router';
import { useAuth } from '@/lib/auth-context';
import { userApi, followsApi, postsApi } from '@/lib/api';
import { User, Post } from '@/types';
import { getPostMediaUrl, getFileUrl } from '@/lib/utils/file-url';
import { MaterialIcons, Feather } from '@expo/vector-icons';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useRealtime } from '@/lib/realtime-context';
import RealtimeProvider from '@/lib/realtime-context';
import { useNavigation } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import DotsSpinner from '@/components/DotsSpinner';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useVideoThumbnail } from '@/lib/hooks/use-video-thumbnail';
import { Avatar } from '@/components/Avatar';
import { timeAgo } from '@/lib/utils/time-ago';
import { filterHlsReady } from '@/lib/utils/post-filter';


const { width: screenWidth } = Dimensions.get('window');
const POST_CARD_WIDTH = Math.floor(screenWidth / 3) - 1; // 3 columns, edge-to-edge


// Video thumbnail with teaser playback
interface VideoThumbnailCardProps {
  post: Post;
  isActive: boolean;
  onPress: () => void;
  cardColor: string;
  textColor: string;
  secondaryColor: string;
}

const VideoThumbnailCard = ({ post, isActive, onPress, cardColor, textColor, secondaryColor }: VideoThumbnailCardProps) => {
  const [showVideo, setShowVideo] = useState(false);

  const videoUrl = post.video_url || post.videoUrl || '';
  const mediaUrl = getPostMediaUrl(post) || '';
  const isHls = mediaUrl.endsWith('.m3u8') || videoUrl.endsWith('.m3u8');
  const isVideo = isHls || !!videoUrl;

  // HLS OPTIMIZATION: Server provides thumbnail_url for HLS-processed videos
  const serverThumbnail = (post as any).thumbnail_url || '';
  const fallbackImageUrl = post.image || (post as any).thumbnail || '';

  // DATA SAVER: Don't download raw MP4 for thumbnails — use server-generated thumbnail
  const { thumbnailUri: generatedThumbnail } = useVideoThumbnail(
    null, // Never download raw MP4 for thumbnails
    fallbackImageUrl,
    1000
  );

  // PRIORITY: Server thumbnail > generated thumbnail > image/fallback
  const staticThumbnailUrl = isVideo
    ? (serverThumbnail || generatedThumbnail || fallbackImageUrl)
    : (getPostMediaUrl(post) || post.fullUrl || post.image || post.imageUrl || '');

  const player = useVideoPlayer(videoUrl, (player) => {
    player.loop = true;
    player.muted = true;
  });

  useEffect(() => {
    if (isActive && isVideo && videoUrl) {
      const timer = setTimeout(() => {
        setShowVideo(true);
        try { player.play(); } catch (_) { /* player released */ }
      }, 200);
      return () => {
        clearTimeout(timer);
        try { player.pause(); } catch (_) { /* player released */ }
        try { player.currentTime = 0; } catch (_) { /* player released */ }
      };
    } else {
      setShowVideo(false);
      try { player.pause(); } catch (_) { /* player released */ }
    }
  }, [isActive, isVideo, videoUrl, player]);

  // Teaser loop logic (reset after 3s)
  useEffect(() => {
    if (isActive && showVideo) {
      const interval = setInterval(() => {
        try {
          if (player.currentTime > 3) {
            player.currentTime = 0;
            player.play();
          }
        } catch (_) { /* player released */ }
      }, 500);
      return () => clearInterval(interval);
    }
  }, [isActive, showVideo, player]);

  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.postCard, { backgroundColor: cardColor }]}
      activeOpacity={0.9}
    >
      {/* Media Preview */}
      <View style={styles.videoThumbnail}>
        {/* Static thumbnail image - always visible in background */}
        {staticThumbnailUrl ? (
          <Image
            source={{ uri: staticThumbnailUrl }}
            style={styles.postImage}
            resizeMode="cover"
            onError={() => {
              // If generated thumbnail fails, fallback to provided image
              if (isVideo && fallbackImageUrl && staticThumbnailUrl !== fallbackImageUrl) {
                // This will be handled by the hook's fallback
              }
            }}
          />
        ) : (
          <View style={[styles.postImage, styles.noMediaPlaceholder]}>
            <MaterialIcons name={isVideo ? "video-library" : "image"} size={32} color="#444" />
          </View>
        )}

        {/* Video teaser overlay - only when active */}
        {showVideo && isVideo && videoUrl && isActive && (
          <VideoView
            player={player}
            style={[styles.postImage, styles.teaserVideoOverlay]}
            contentFit="cover"
            nativeControls={false}
          />
        )}

        {/* Play indicator */}
        {isVideo && (
          <View style={[styles.playIconOverlay, isActive && styles.playIconActive]}>
            {isActive ? (
              <View style={styles.playingIndicator}>
                <View style={styles.playingDot} />
              </View>
            ) : (
              <MaterialIcons name="play-circle-outline" size={40} color="#fff" />
            )}
          </View>
        )}
      </View>

      {/* Caption and Stats */}
      <View style={styles.postFooter}>
        <Text style={[styles.postCaption, { color: '#fff' }]} numberOfLines={2}>
          {post.title || post.description || ''}
        </Text>
        {(post.createdAt || post.uploadDate || (post as any).created_at) && (
          <Text style={[styles.postTimestamp, { color: '#999' }]}>
            {timeAgo(post.createdAt || post.uploadDate || (post as any).created_at)}
          </Text>
        )}
        <View style={styles.postFooterActions}>
          <View style={styles.postAction}>
            <Feather
              name="heart"
              size={14}
              color={(post.likes || 0) > 0 ? "#ff2d55" : "#999"}
            />
            <Text style={[styles.postActionText, { color: secondaryColor }]}>
              {post.likes || 0}
            </Text>
          </View>
          <View style={styles.postAction}>
            <Feather name="message-circle" size={14} color="#999" />
            <Text style={[styles.postActionText, { color: secondaryColor }]}>
              {post.comments_count || 0}
            </Text>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
};

const COLORS = {
  light: {
    background: '#f5f5f5',
    card: '#fff',
    border: '#e5e7eb',
    text: '#222',
    textSecondary: '#666',
    primary: '#007AFF',
    button: '#007AFF',
    buttonText: '#fff',
  },
  dark: {
    background: '#18181b',
    card: '#232326',
    border: '#27272a',
    text: '#f3f4f6',
    textSecondary: '#a1a1aa',
    primary: '#60a5fa',
    button: '#60a5fa',
    buttonText: '#18181b',
  },
};

export default function ExternalUserProfileScreen() {
  const { id } = useLocalSearchParams();
  const { user: currentUser } = useAuth();

  // Redirect if this is the logged-in user
  useEffect(() => {
    if (currentUser && currentUser.id === id) {
      router.replace('/(tabs)/profile');
    }
  }, [currentUser, id]);
  if (currentUser && currentUser.id === id) return null;

  return (
    <RealtimeProvider>
      <ProfileContent id={id} currentUser={currentUser} />
    </RealtimeProvider>
  );
}

const ModalVideoPlayer = ({ source }: { source: string }) => {
  const player = useVideoPlayer(source, (player) => {
    player.play();
    player.loop = true;
  });
  return <VideoView player={player} style={styles.overlayMedia} contentFit="contain" nativeControls={true} />;
};

function ProfileContent(props: { id: string | string[] | undefined, currentUser: User | null }) {
  const { id, currentUser } = props;
  const [profile, setProfile] = useState<User | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [approvedPosts, setApprovedPosts] = useState<any[]>([]);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [postsError, setPostsError] = useState<string | null>(null);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followsMeBack, setFollowsMeBack] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [postModalVisible, setPostModalVisible] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const { sendFollowAction, isConnected } = useRealtime();
  const C = COLORS.dark; // Force dark mode
  const navigation = useNavigation();

  // Video teaser playback state
  const [activeTeaserIndex, setActiveTeaserIndex] = useState(0);
  const [isScreenFocused, setIsScreenFocused] = useState(true);
  const teaserIntervalRef = useRef<any>(null);

  // Error and loading states
  const [error, setError] = useState<{ type: 'network' | 'server' | 'unknown'; message: string } | null>(null);

  // Cycle through video teasers
  useEffect(() => {
    if (isScreenFocused && approvedPosts.length > 0) {
      const videoPosts = approvedPosts.filter(p => !!p.video_url);

      if (videoPosts.length > 0) {
        if (teaserIntervalRef.current) {
          clearInterval(teaserIntervalRef.current);
        }

        teaserIntervalRef.current = setInterval(() => {
          setActiveTeaserIndex(prev => {
            const videoIndices = approvedPosts
              .map((p, i) => p.video_url ? i : -1)
              .filter(i => i !== -1);

            if (videoIndices.length === 0) return 0;

            const currentPos = videoIndices.indexOf(prev);
            const nextPos = (currentPos + 1) % videoIndices.length;
            return videoIndices[nextPos] ?? 0;
          });
        }, 4000);
      }
    }

    return () => {
      if (teaserIntervalRef.current) {
        clearInterval(teaserIntervalRef.current);
      }
    };
  }, [isScreenFocused, approvedPosts]);

  // Handle screen focus
  useFocusEffect(
    useCallback(() => {
      setIsScreenFocused(true);
      return () => setIsScreenFocused(false);
    }, [])
  );

  // Fetch profile info
  useEffect(() => {
    const fetchProfile = async () => {
      if (!id) return;
      setLoadingProfile(true);
      setProfileError(null);
      setError(null);
      try {
        const response = await userApi.getUserById(id as string);
        if (response.status === 'success' && response.data) {
          const userData = response.data;
          // Normalize user data structure
          setProfile({
            ...userData,
            name: userData.name || userData.username || 'User',
            username: userData.username || '',
            profile_picture: userData.profile_picture || '',
            bio: userData.bio || '',
            email: (userData as any).email || '',
            phone1: (userData as any).phone1 || '',
            phone2: (userData as any).phone2 || '',
            followers_count: userData.followers_count || (userData as any).follower_count || 0,
            following_count: userData.following_count || (userData as any).subscribers || 0,
            posts_count: userData.posts_count || 0,
            id: userData.id || id as string,
          } as any);
        } else {
          const errorMsg = response.message || 'Failed to fetch user profile';
          setProfileError(errorMsg);
          setError({ type: 'server', message: errorMsg });
        }
      } catch (err: any) {
        const isNetworkError = err?.message?.includes('Network') || err?.code === 'NETWORK_ERROR' || !err?.response;
        const errorMsg = err?.message || 'Failed to fetch user profile';
        setProfileError(errorMsg);
        setError({
          type: isNetworkError ? 'network' : 'server',
          message: isNetworkError
            ? 'No internet connection. Please check your network and try again.'
            : errorMsg
        });
      } finally {
        setLoadingProfile(false);
      }
    };
    fetchProfile();
  }, [id]);

  // Fetch follow state and check if they follow me back
  useEffect(() => {
    const checkFollow = async () => {
      if (!currentUser || !id || currentUser.id === id) return;
      try {
        // Check if I'm following them
        const response = await followsApi.checkFollowing(id as string);
        setIsFollowing(!!response.data?.isFollowing);

        // Check if they follow me back by checking my followers list
        try {
          const myFollowersResponse = await followsApi.getFollowers(currentUser.id, 1, 100);
          if (myFollowersResponse.status === 'success' && myFollowersResponse.data?.followers) {
            // Check if the profile user (id) is in my followers list
            const followsMe = myFollowersResponse.data.followers.some((f: any) => f.id === id);
            setFollowsMeBack(followsMe);
          } else {
            setFollowsMeBack(false);
          }
        } catch {
          setFollowsMeBack(false);
        }
      } catch {
        setIsFollowing(false);
        setFollowsMeBack(false);
      }
    };
    checkFollow();
  }, [id, currentUser]);

  // Real-time updates for profile stats
  useEffect(() => {
    if (!isConnected || !id) return;

    // Listen for new posts from this user
    const handleNewPost = (data: any) => {
      if (data.userId === id) {
        console.log('New post detected for user:', id);
        // Refresh posts and update count
        fetchApprovedPosts();
        // Update profile stats
        if (profile) {
          setProfile(prev => prev ? { ...prev, posts_count: (prev.posts_count || 0) + 1 } : null);
        }
      }
    };

    // Listen for follow/unfollow actions
    const handleFollowAction = (data: any) => {
      if (data.targetUserId === id) {
        console.log('Follow action detected for user:', id);
        // Update followers count
        if (profile) {
          const newFollowersCount = data.action === 'follow'
            ? (profile.followers_count || 0) + 1
            : Math.max(0, (profile.followers_count || 0) - 1);
          setProfile(prev => prev ? { ...prev, followers_count: newFollowersCount } : null);
        }
      }
    };

    // Listen for post approval/rejection
    const handlePostStatusChange = (data: any) => {
      if (data.userId === id) {
        console.log('Post status change detected for user:', id);
        // Refresh posts to get updated list
        fetchApprovedPosts();
        // Update profile stats based on action
        if (profile) {
          const newPostsCount = data.action === 'approve'
            ? (profile.posts_count || 0) + 1
            : Math.max(0, (profile.posts_count || 0) - 1);
          setProfile(prev => prev ? { ...prev, posts_count: newPostsCount } : null);
        }
      }
    };

    // Set up real-time listeners using the existing realtime context
    // This will depend on your realtime context implementation
    // For now, we'll use a polling approach as fallback
    const pollInterval = setInterval(() => {
      // Poll for updates every 30 seconds
      fetchApprovedPosts();
    }, 30000);

    return () => {
      clearInterval(pollInterval);
    };
  }, [isConnected, id, profile]);

  // Fetch approved posts
  const fetchApprovedPosts = async () => {
    if (!id) return;
    setLoadingPosts(true);
    setPostsError(null);
    try {
      const response = await userApi.getUserApprovedPosts(id as string);
      if (response.status === 'success' && response.data) {
        // Handle both array and object with posts property
        const posts = Array.isArray(response.data)
          ? response.data
          : (response.data as any)?.posts || [];
        // Normalize backend shapes so UI always has `user`, `fullUrl`, and consistent fields
        const normalized = (posts as any[]).map((p: any) => {
          const userFromPost = p.user;
          const authorName = p.authorName || p.username || userFromPost?.username;
          const authorProfilePicture =
            p.authorProfilePicture || userFromPost?.profile_picture || p.profile_picture;

          const video_url = p.video_url || p.videoUrl || '';
          const fullUrl = p.fullUrl || video_url || p.mediaUrl || '';

          return {
            ...p,
            video_url,
            fullUrl,
            // CRITICAL: Backend returns mediaType='video', but filterHlsReady checks type='video'
            type: p.type || p.mediaType || (video_url ? 'video' : 'image'),
            // CRITICAL: Preserve HLS fields for filterHlsReady — backend returns both camelCase & snake_case
            processing_status: p.processing_status || p.processingStatus,
            processingStatus: p.processingStatus || p.processing_status,
            hlsReady: p.hlsReady || false,
            comments_count: p.comment_count ?? p.commentsCount ?? p.comments_count ?? 0,
            likes: p.likes ?? p.likesCount ?? 0,
            user: userFromPost || {
              id: (profile as any)?.id || p.user_id || p.userId,
              username: authorName,
              profile_picture: authorProfilePicture,
            },
          };
        });

        // Apply HLS filter — only show HLS-transcoded video posts
        setApprovedPosts(filterHlsReady(normalized));
      } else {
        setPostsError(response.message || 'Failed to fetch posts');
      }
    } catch (err: any) {
      const isNetworkError = err?.message?.includes('Network') || err?.code === 'NETWORK_ERROR';
      setPostsError(isNetworkError
        ? 'Network error. Please check your connection.'
        : err?.message || 'Failed to fetch posts');
    } finally {
      setLoadingPosts(false);
    }
  };

  useEffect(() => {
    fetchApprovedPosts();
  }, [id]);

  // Refresh function
  const onRefresh = () => {
    setRefreshing(true);
    // Re-fetch profile and posts
    const fetchData = async () => {
      try {
        if (id) {
          const [profileResponse, postsResponse] = await Promise.all([
            userApi.getUserById(id as string),
            userApi.getUserApprovedPosts(id as string)
          ]);
          if (profileResponse.status === 'success' && profileResponse.data) {
            setProfile(profileResponse.data);
          }
          if (postsResponse.status === 'success' && postsResponse.data) {
            const posts = Array.isArray(postsResponse.data)
              ? postsResponse.data
              : (postsResponse.data as any)?.posts || [];
            const normalized = (posts as any[]).map((p: any) => {
              const userFromPost = p.user;
              const authorName = p.authorName || p.username || userFromPost?.username;
              const authorProfilePicture =
                p.authorProfilePicture || userFromPost?.profile_picture || p.profile_picture;
              const video_url = p.video_url || p.videoUrl || '';
              const fullUrl = p.fullUrl || video_url || p.mediaUrl || '';
              return {
                ...p,
                video_url,
                fullUrl,
                type: p.type || p.mediaType || (video_url ? 'video' : 'image'),
                processing_status: p.processing_status || p.processingStatus,
                processingStatus: p.processingStatus || p.processing_status,
                hlsReady: p.hlsReady || false,
                comments_count: p.comment_count ?? p.commentsCount ?? p.comments_count ?? 0,
                likes: p.likes ?? p.likesCount ?? 0,
                user: userFromPost || {
                  id: (profileResponse.data as any)?.id || p.user_id || p.userId,
                  username: authorName,
                  profile_picture: authorProfilePicture,
                },
              };
            });
            setApprovedPosts(normalized);
          }
        }
      } catch (err: any) {
        console.error('Error refreshing data:', err);
      } finally {
        setRefreshing(false);
      }
    };
    fetchData();
  };

  const handleFollow = async () => {
    if (!id || !currentUser) return;

    setFollowLoading(true);
    try {
      const response = await followsApi.follow(id as string);
      if (response.status === 'success') {
        setIsFollowing(true);
        // Update followers count immediately
        if (profile) {
          setProfile(prev => prev ? { ...prev, followers_count: (prev.followers_count || 0) + 1 } : null);
        }
        // Send real-time follow action
        if (isConnected) {
          sendFollowAction(id as string, true);
        }
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to follow user');
    } finally {
      setFollowLoading(false);
    }
  };

  const handleUnfollow = async () => {
    if (!id || !currentUser) return;

    setFollowLoading(true);
    try {
      const response = await followsApi.unfollow(id as string);
      if (response.status === 'success') {
        setIsFollowing(false);
        // Update followers count immediately
        if (profile) {
          setProfile(prev => prev ? { ...prev, followers_count: Math.max(0, (prev.followers_count || 0) - 1) } : null);
        }
        // Send real-time unfollow action
        if (isConnected) {
          sendFollowAction(id as string, false);
        }
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to unfollow user');
    } finally {
      setFollowLoading(false);
    }
  };

  const handlePostPress = (post: Post) => {
    // Navigate to full-screen profile feed with current post as initial
    router.push({
      pathname: '/profile-feed/[userId]',
      params: {
        userId: id as string,
        initialPostId: post.id,
        status: 'active',
        initialPostData: JSON.stringify(post) // CRITICAL: Pass data for instant loading
      }
    });
  };

  const handleClosePostModal = () => {
    setPostModalVisible(false);
    setSelectedPost(null);
  };

  // Cleanup effect to pause videos when modal closes
  useEffect(() => {
    if (!postModalVisible && selectedPost) {
      setSelectedPost(null);
    }
  }, [postModalVisible]);

  const handleSharePost = async () => {
    if (!selectedPost) return;

    try {
      const mediaUrl = selectedPost.video_url || selectedPost.image;
      await Share.share({
        message: mediaUrl || 'Check out this post!',
        title: 'Share Post',
        url: mediaUrl,
      });
    } catch (error) {
      Alert.alert('Error', 'Failed to share post');
    }
  };

  const handleDownloadPost = async () => {
    if (!selectedPost) return;

    try {
      const mediaUrl = selectedPost.video_url || selectedPost.image;
      if (mediaUrl) {
        // For now, just share the URL
        await Share.share({
          message: mediaUrl,
          title: 'Download Post',
          url: mediaUrl,
        });
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to download post');
    }
  };

  function getPostMedia(post: any) {
    if (Array.isArray(post.media) && post.media[0]) {
      return { url: post.media[0].url, type: post.media[0].type };
    }
    if (post.image) return { url: post.image, type: 'image' };
    if (post.imageUrl) return { url: post.imageUrl, type: 'image' };
    if (post.video_url) return { url: post.video_url, type: 'video' };
    if (post.videoUrl) return { url: post.videoUrl, type: 'video' };
    return { url: '', type: '' };
  }

  function getCategoryString(category: string | object) {
    if (typeof category === 'string') return category;
    if (typeof category === 'object' && category !== null) {
      return (category as any).name || 'Unknown';
    }
    return 'Unknown';
  }

  // Set the header title to the user's name or username
  useEffect(() => {
    if (profile) {
      navigation.setOptions({
        title: profile.name || profile.username || 'Profile',
      });
    }
  }, [profile, navigation]);

  if (loadingProfile) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: C.background }]} edges={['top']}>
        <View style={styles.loadingContainer}>
          <DotsSpinner size={10} color={C.primary} />
          <Text style={[styles.loadingText, { color: C.text }]}>Loading profile...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (profileError || !profile) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: C.background }]} edges={['top']}>
        <View style={styles.loadingContainer}>
          <MaterialIcons name="error-outline" size={48} color={C.textSecondary} />
          <Text style={[styles.errorText, { color: C.text }]}>
            {profileError || 'Failed to load profile'}
          </Text>
          {error && error.type === 'network' && (
            <Text style={[styles.errorSubtext, { color: C.textSecondary }]}>
              Please check your internet connection
            </Text>
          )}
          <TouchableOpacity
            style={[styles.retryButton, { backgroundColor: C.primary }]}
            onPress={onRefresh}
          >
            <Text style={[styles.retryButtonText, { color: C.buttonText }]}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: C.background }]} edges={['top']}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: C.background, borderBottomColor: C.border }]}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <MaterialIcons name="arrow-back" size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: C.text }]}>
          {profile?.name || profile?.username || 'Profile'}
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
        {/* Profile Info */}
        <View style={[styles.profileSection, { backgroundColor: C.card, borderBottomColor: C.border }]}>
          <View style={styles.profileHeader}>
            <View style={styles.avatarShadowWrapper}>
              <Avatar
                user={profile}
                size={80}
                style={styles.avatarLarge}
              />
            </View>
            <View style={styles.profileInfo}>
              <Text style={[styles.profileName, { color: C.text }]}>
                {profile?.name || profile?.username || 'User'}
              </Text>
              <Text style={[styles.profileUsername, { color: C.textSecondary }]}>
                @{profile?.username || 'unknown'}
              </Text>
              {profile?.bio && (
                <Text style={[styles.profileBio, { color: C.text }]} numberOfLines={3}>
                  {profile.bio}
                </Text>
              )}
            </View>
          </View>

          {/* Contact Info - Only show if available */}
          {((profile as any)?.email || (profile as any)?.phone1 || (profile as any)?.phone2) && (
            <View style={[styles.contactInfo, { borderTopColor: C.border, borderTopWidth: 1, paddingTop: 16, marginTop: 16 }]}>
              {(profile as any)?.email && (
                <View style={styles.contactItem}>
                  <MaterialIcons name="email" size={18} color={C.primary} />
                  <Text style={[styles.contactText, { color: C.text }]}>{(profile as any).email}</Text>
                </View>
              )}
              {(profile as any)?.phone1 && (
                <View style={styles.contactItem}>
                  <MaterialIcons name="phone" size={18} color={C.primary} />
                  <Text style={[styles.contactText, { color: C.text }]}>{(profile as any).phone1}</Text>
                </View>
              )}
              {(profile as any)?.phone2 && (
                <View style={styles.contactItem}>
                  <MaterialIcons name="phone" size={18} color={C.primary} />
                  <Text style={[styles.contactText, { color: C.text }]}>{(profile as any).phone2}</Text>
                </View>
              )}
            </View>
          )}

          {/* Stats */}
          <View style={[styles.statsRow, { borderTopColor: C.border, borderTopWidth: 1, paddingTop: 20, marginTop: 20 }]}>
            <TouchableOpacity
              style={[styles.statItem, { backgroundColor: C.background }]}
              onPress={() => {
                router.push({
                  pathname: '/followers/[id]' as any,
                  params: { id: id as string, type: 'posts' }
                });
              }}
            >
              <Text style={[styles.statValue, { color: C.text }]}>{approvedPosts.length}</Text>
              <Text style={[styles.statLabel, { color: C.textSecondary }]}>Posts</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.statItem, { backgroundColor: C.background }]}
              onPress={() => {
                router.push({
                  pathname: '/followers/[id]' as any,
                  params: { id: id as string, type: 'followers' }
                });
              }}
            >
              <Text style={[styles.statValue, { color: C.text }]}>{profile?.followers_count ?? 0}</Text>
              <Text style={[styles.statLabel, { color: C.textSecondary }]}>Followers</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.statItem, { backgroundColor: C.background }]}
              onPress={() => {
                router.push({
                  pathname: '/followers/[id]' as any,
                  params: { id: id as string, type: 'following' }
                });
              }}
            >
              <Text style={[styles.statValue, { color: C.text }]}>{profile?.following_count ?? 0}</Text>
              <Text style={[styles.statLabel, { color: C.textSecondary }]}>Following</Text>
            </TouchableOpacity>
          </View>

          {/* Follow Button */}
          {currentUser && currentUser.id !== id && (
            <TouchableOpacity
              onPress={isFollowing ? handleUnfollow : handleFollow}
              disabled={followLoading}
              style={[
                styles.followButton,
                {
                  backgroundColor: isFollowing ? 'transparent' : C.primary,
                  borderColor: C.primary,
                  borderWidth: 1,
                  marginTop: 20
                }
              ]}
            >
              {followLoading ? (
                <DotsSpinner size={6} color={isFollowing ? C.primary : C.buttonText} />
              ) : (
                <Text style={[
                  styles.followButtonText,
                  { color: isFollowing ? C.primary : C.buttonText }
                ]}>
                  {isFollowing ? 'Following' : (followsMeBack ? 'Follow Back' : 'Follow')}
                </Text>
              )}
            </TouchableOpacity>
          )}
        </View>

        {/* Posts Section */}
        <View style={[styles.postsSection, { backgroundColor: C.background }]}>
          <Text style={[styles.sectionTitle, { color: C.text }]}>Posts ({approvedPosts.length})</Text>
          {loadingPosts ? (
            <View style={styles.loadingContainer}>
              <DotsSpinner size={8} color={C.primary} />
              <Text style={[styles.loadingText, { color: C.textSecondary, marginTop: 12 }]}>Loading posts...</Text>
            </View>
          ) : postsError ? (
            <View style={styles.loadingContainer}>
              <MaterialIcons name="error-outline" size={32} color={C.textSecondary} />
              <Text style={[styles.errorText, { color: C.textSecondary }]}>{postsError}</Text>
              <TouchableOpacity
                style={[styles.retryButton, { backgroundColor: C.primary, marginTop: 12 }]}
                onPress={fetchApprovedPosts}
              >
                <Text style={[styles.retryButtonText, { color: C.buttonText }]}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : approvedPosts.length === 0 ? (
            <View style={styles.emptyContainer}>
              <MaterialIcons name="photo-library" size={48} color={C.textSecondary} />
              <Text style={[styles.emptyText, { color: C.textSecondary }]}>No posts yet</Text>
            </View>
          ) : (
            <FlatList
              data={approvedPosts}
              renderItem={({ item, index }) => (
                <VideoThumbnailCard
                  post={item}
                  isActive={isScreenFocused && activeTeaserIndex === index}
                  onPress={() => handlePostPress(item)}
                  cardColor={C.card}
                  textColor={C.text}
                  secondaryColor={C.textSecondary}
                />
              )}
              keyExtractor={item => item.id}
              numColumns={3}
              columnWrapperStyle={{ gap: 1 }}
              scrollEnabled={false}
              contentContainerStyle={{ paddingBottom: 40 }}
            />
          )}
        </View>
      </ScrollView>

      {/* Post Modal Overlay */}
      <Modal visible={postModalVisible} animationType="slide" transparent onRequestClose={handleClosePostModal}>
        <View style={[styles.overlayBackdrop, { backgroundColor: 'rgba(0,0,0,0.95)' }]}>
          <View style={styles.overlayContent}>
            <TouchableOpacity style={styles.overlayClose} onPress={handleClosePostModal}>
              <MaterialIcons name="close" size={28} color="#fff" />
            </TouchableOpacity>
            {selectedPost && (() => {
              const { url: mediaUrl, type: mediaType } = getPostMedia(selectedPost);
              const isVideo = mediaType === 'video';
              return (
                <View style={styles.overlayMediaContainer}>
                  {mediaUrl ? (
                    isVideo ? (
                      <ModalVideoPlayer source={mediaUrl} />
                    ) : (
                      <Image
                        source={{ uri: mediaUrl }}
                        style={styles.overlayMedia}
                        resizeMode="contain"
                      />
                    )
                  ) : (
                    <Image
                      source={{ uri: 'https://via.placeholder.com/300' }}
                      style={styles.overlayMedia}
                      resizeMode="contain"
                    />
                  )}
                  <View style={styles.overlayActions}>
                    <TouchableOpacity style={styles.overlayAction} onPress={handleSharePost}>
                      <MaterialIcons name="share" size={24} color="#fff" />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.overlayAction} onPress={handleDownloadPost}>
                      <MaterialIcons name="download" size={24} color="#fff" />
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })()}
          </View>
        </View>
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
  profileSection: {
    padding: 20,
    borderBottomWidth: 1,
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  avatarShadowWrapper: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    marginRight: 16,
  },
  avatarLarge: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#f0f0f0',
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 4,
  },
  profileUsername: {
    fontSize: 14,
    marginBottom: 8,
  },
  profileBio: {
    fontSize: 14,
    lineHeight: 20,
  },
  contactInfo: {
    marginBottom: 20,
  },
  contactItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  contactText: {
    fontSize: 14,
    marginLeft: 8,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 20,
  },
  statItem: {
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginHorizontal: 4,
    minWidth: 80,
  },
  statValue: {
    fontSize: 18,
    fontWeight: '600',
  },
  statLabel: {
    fontSize: 12,
    marginTop: 2,
  },
  followButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
  },
  followButtonText: {
    fontSize: 16,
    fontWeight: '500',
  },
  postsSection: {
    padding: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
  },
  postCard: {
    borderRadius: 12,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    width: '48%',
    borderWidth: 1,
    overflow: 'hidden',
  },
  postHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
  },
  postUserInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  postUserAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    marginRight: 8,
  },
  postUsername: {
    fontSize: 12,
    fontWeight: '500',
  },
  postImage: {
    width: '100%',
    height: 150,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
  },
  playIconOverlay: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: [{ translateX: -24 }, { translateY: -24 }],
  },
  postFooter: {
    padding: 12,
  },
  postCaption: {
    fontSize: 12,
    marginBottom: 4,
  },
  postTimestamp: {
    fontSize: 10,
    marginBottom: 8,
    opacity: 0.7,
  },
  postFooterActions: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  postAction: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 16,
  },
  postActionText: {
    fontSize: 12,
    marginLeft: 4,
  },
  categoryTag: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    alignSelf: 'flex-start',
  },
  categoryText: {
    fontSize: 10,
    fontWeight: '500',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
  },
  errorText: {
    textAlign: 'center',
    fontSize: 16,
    marginTop: 12,
    marginBottom: 8,
  },
  errorSubtext: {
    textAlign: 'center',
    fontSize: 14,
    marginBottom: 16,
  },
  retryButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryButtonText: {
    fontSize: 16,
    fontWeight: '500',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    marginTop: 12,
    fontSize: 16,
  },
  overlayBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  overlayContent: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  overlayClose: {
    position: 'absolute',
    top: 50,
    right: 20,
    zIndex: 1,
    padding: 8,
  },
  overlayMediaContainer: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 20,
  },
  overlayMedia: {
    width: '100%',
    height: '90%',
    maxWidth: '95%',
    maxHeight: '90%',
  },
  overlayActions: {
    position: 'absolute',
    bottom: 50,
    flexDirection: 'row',
  },
  overlayAction: {
    marginHorizontal: 20,
    padding: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 25,
  },
  realtimeIndicator: {
    position: 'absolute',
    top: -8,
    right: -8,
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 4,
    borderWidth: 1,
    borderColor: '#007AFF',
  },
  realtimeText: {
    fontSize: 12,
  },
  videoThumbnail: {
    position: 'relative',
    width: '100%',
    height: 150,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    overflow: 'hidden',
  },
  teaserVideoOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  noMediaPlaceholder: {
    backgroundColor: '#1a1a1a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  playIconActive: {
    backgroundColor: 'rgba(239, 68, 68, 0.9)',
    borderRadius: 20,
  },
  playingIndicator: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#fff',
  },
  defaultAvatar: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  defaultAvatarText: {
    color: '#fff',
    fontWeight: '700',
  },
}); 