import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ScrollView,
  ActivityIndicator,
  FlatList,
  Modal,
  Share,
  Alert,
  RefreshControl,
  Dimensions,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useAuth } from '@/lib/auth-context';
import { userApi, postsApi, likesApi, viewsApi } from '@/lib/api';
import { Post } from '@/types';
import { MaterialIcons, Feather } from '@expo/vector-icons';
import { Video, ResizeMode, AVPlaybackStatus } from 'expo-av';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EditProfileModal } from '@/components/EditProfileModal';
import DotsSpinner from '@/components/DotsSpinner';
import { useLikesManager } from '@/lib/hooks/use-likes-manager';
import { useAppDispatch, useAppSelector } from '@/lib/store/hooks';
import { addLikedPost, removeLikedPost, setPostLikeCount } from '@/lib/store/slices/likesSlice';
import { LinearGradient } from 'expo-linear-gradient';
import { useVideoThumbnail } from '@/lib/hooks/use-video-thumbnail';
import { getFileUrl, getPostMediaUrl, getThumbnailUrl, getProfilePictureUrl } from '@/lib/utils/file-url';
import { Avatar } from '@/components/Avatar';

const { width: screenWidth } = Dimensions.get('window');
const POST_ITEM_SIZE = (screenWidth - 4) / 3; // 3 columns with 2px gaps


// Video thumbnail component with teaser playback
interface VideoThumbnailProps {
  post: Post;
  isActive: boolean;
  onPress: () => void;
  onOptionsPress?: () => void;
  onPublishPress?: () => void;
  onViewsPress?: () => void;
}

const VideoThumbnail = ({ post, isActive, onPress, onOptionsPress, onPublishPress, onViewsPress }: VideoThumbnailProps) => {
  const videoRef = useRef<Video>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [showVideo, setShowVideo] = useState(false);

  const videoUrl = getFileUrl(post.video_url || post.videoUrl || '');
  const isVideo = !!videoUrl;

  // Get fallback image URL
  const fallbackImageUrl = getThumbnailUrl(post) || getFileUrl(post.image || (post as any).thumbnail || '');

  // Generate thumbnail for videos, use image directly for non-videos
  const generatedThumbnail = useVideoThumbnail(
    isVideo ? videoUrl : null,
    fallbackImageUrl || '',
    1000 // Extract thumbnail at 1 second
  );

  // For videos: use generated thumbnail, fallback to provided image
  // For images: use image directly
  const staticThumbnailUrl = isVideo
    ? (generatedThumbnail || fallbackImageUrl)
    : getPostMediaUrl(post) || '';

  useEffect(() => {
    if (isActive && isVideo && videoUrl) {
      // Small delay before showing video to ensure smooth transition
      const timer = setTimeout(() => {
        setShowVideo(true);
      }, 200);
      return () => clearTimeout(timer);
    } else {
      setShowVideo(false);
      setIsLoaded(false);
      // Stop video when not active
      if (videoRef.current) {
        videoRef.current.pauseAsync().catch(() => { });
      }
    }
  }, [isActive, isVideo, videoUrl]);

  const handlePlaybackStatusUpdate = (status: AVPlaybackStatus) => {
    if (status.isLoaded) {
      setIsLoaded(true);
      // Loop the teaser after 3 seconds
      if (status.positionMillis && status.positionMillis > 3000) {
        videoRef.current?.setPositionAsync(0);
      }
    }
  };

  return (
    <TouchableOpacity
      style={styles.postItem}
      onPress={onPress}
      onLongPress={onOptionsPress}
      activeOpacity={0.9}
    >
      {/* Static thumbnail image - always visible in background */}
      {staticThumbnailUrl ? (
        <Image
          source={{ uri: staticThumbnailUrl }}
          style={styles.postMedia}
          resizeMode="cover"
          onError={() => {
            // If generated thumbnail fails, fallback to provided image
            if (isVideo && fallbackImageUrl && staticThumbnailUrl !== fallbackImageUrl) {
              // This will be handled by the hook's fallback
            }
          }}
        />
      ) : (
        <View style={[styles.postMedia, styles.noMediaPlaceholder]}>
          {isVideo && !staticThumbnailUrl ? (
            <ActivityIndicator size="small" color="#60a5fa" />
          ) : (
            <MaterialIcons name={isVideo ? "video-library" : "image"} size={28} color="#444" />
          )}
        </View>
      )}

      {/* Video teaser overlay - only when active */}
      {showVideo && isVideo && videoUrl && isActive && (
        <Video
          ref={videoRef}
          source={{ uri: videoUrl }}
          style={[styles.postMedia, styles.teaserVideo]}
          resizeMode={ResizeMode.COVER}
          shouldPlay={isActive}
          isLooping={false}
          isMuted={true}
          volume={0}
          onPlaybackStatusUpdate={handlePlaybackStatusUpdate}
        />
      )}

      {/* Overlay with stats */}
      <View style={styles.postOverlay}>
        <View style={styles.postStats}>
          <Feather name="heart" size={12} color="#fff" />
          <Text style={styles.postStatText}>{formatNumber(post.likes || 0)}</Text>
        </View>
        
        {/* Views count button */}
        {onViewsPress && (
          <TouchableOpacity
            style={styles.postStats}
            onPress={(e) => {
              e.stopPropagation();
              onViewsPress();
            }}
            activeOpacity={0.7}
          >
            <Feather name="eye" size={12} color="#fff" />
            <Text style={styles.postStatText}>{formatNumber((post as any).views || (post as any).view_count || 0)}</Text>
          </TouchableOpacity>
        )}

        {/* Status indicator */}
        <View style={[
          styles.statusIndicator,
          { backgroundColor: getStatusColor(post.status || 'active') }
        ]}>
          <MaterialIcons
            name={getStatusIcon(post.status || 'active') as any}
            size={10}
            color="#fff"
          />
        </View>
      </View>

      {/* Video play indicator / Active indicator */}
      {isVideo && (
        <View style={[
          styles.videoPlayIndicator,
          isActive && styles.videoPlayIndicatorActive
        ]}>
          {isActive ? (
            <View style={styles.playingDot} />
          ) : (
            <Feather name="play" size={14} color="#fff" />
          )}
        </View>
      )}

      {/* Options button (3 dots) */}
      {onOptionsPress && (
        <TouchableOpacity
          style={styles.postOptionsButton}
          onPress={(e) => {
            e.stopPropagation();
            onOptionsPress();
          }}
          activeOpacity={0.7}
        >
          <Feather name="more-vertical" size={16} color="#fff" />
        </TouchableOpacity>
      )}

      {/* Publish button for draft posts */}
      {(() => {
        const isDraft = post.status === 'draft' || post.status === 'Draft';
        if (__DEV__ && isDraft) {
          console.log('📤 [VideoThumbnail] Draft post detected, showing publish button:', {
            postId: post.id,
            status: post.status,
            hasOnPublishPress: !!onPublishPress,
          });
        }
        return isDraft && onPublishPress;
      })() && (
          <TouchableOpacity
            style={styles.publishDraftButton}
            onPress={(e) => {
              e.stopPropagation();
              if (__DEV__) {
                console.log('📤 [VideoThumbnail] Publish button pressed');
              }
              onPublishPress?.();
            }}
            activeOpacity={0.8}
          >
            <Feather name="send" size={14} color="#fff" />
            <Text style={styles.publishDraftButtonText}>Publish</Text>
          </TouchableOpacity>
        )}
    </TouchableOpacity>
  );
};

// Helper functions moved outside component for use in VideoThumbnail
const formatNumber = (num: number): string => {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  }
  return num.toString();
};

const getStatusColor = (status: string) => {
  switch (status) {
    case 'active': return '#10b981';
    case 'draft': return '#6b7280';
    case 'suspended': return '#ef4444';
    // Legacy status support (for migration period)
    case 'approved': return '#10b981';
    case 'pending': return '#f59e0b';
    case 'rejected': return '#ef4444';
    case 'reported': return '#8b5cf6';
    default: return '#10b981'; // Default to active
  }
};

const getStatusIcon = (status: string) => {
  switch (status) {
    case 'active': return 'check-circle';
    case 'draft': return 'drafts';
    case 'suspended': return 'cancel';
    // Legacy status support (for migration period)
    case 'approved': return 'check-circle';
    case 'pending': return 'schedule';
    case 'rejected': return 'cancel';
    case 'reported': return 'report';
    default: return 'check-circle'; // Default to active
  }
};

const PROFILE_TABS = [
  { key: 'active', label: 'Active Posts', icon: 'check-circle' },
  { key: 'draft', label: 'Drafts', icon: 'drafts' },
  { key: 'suspended', label: 'Suspended', icon: 'cancel' },
];

export default function ProfileScreen() {
  const { user, logout } = useAuth();
  const dispatch = useAppDispatch();
  const likedPosts = useAppSelector(state => state.likes.likedPosts);
  const postLikeCounts = useAppSelector(state => state.likes.postLikeCounts);
  const likesManager = useLikesManager();

  const [profile, setProfile] = useState<any>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('active');
  const [refreshing, setRefreshing] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [postOptionsModalVisible, setPostOptionsModalVisible] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [totalLikes, setTotalLikes] = useState(0);
  const [videoRef, setVideoRef] = useState<Video | null>(null);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [videoLoading, setVideoLoading] = useState(false);
  const [useNativeControls, setUseNativeControls] = useState(false);
  const [decoderErrorDetected, setDecoderErrorDetected] = useState(false);

  // Error and loading states
  const [error, setError] = useState<{ type: 'network' | 'server' | 'unknown'; message: string } | null>(null);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [likingPostId, setLikingPostId] = useState<string | null>(null);

  // Video teaser playback state
  const [activeTeaserIndex, setActiveTeaserIndex] = useState(0);
  const [isScreenFocused, setIsScreenFocused] = useState(true);
  const [viewsModalVisible, setViewsModalVisible] = useState(false);
  const [viewsModalPostId, setViewsModalPostId] = useState<string | null>(null);
  const [viewsData, setViewsData] = useState<any[]>([]);
  const [loadingViews, setLoadingViews] = useState(false);
  const [likesModalVisible, setLikesModalVisible] = useState(false);
  const [likesData, setLikesData] = useState<any[]>([]);
  const [loadingLikes, setLoadingLikes] = useState(false);
  const teaserIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const insets = useSafeAreaInsets();

  // Cycle through video teasers - one at a time
  useEffect(() => {
    if (isScreenFocused && posts.length > 0) {
      // Find video posts only
      const videoPosts = posts.filter(p => !!p.video_url);

      if (videoPosts.length > 0) {
        // Clear any existing interval
        if (teaserIntervalRef.current) {
          clearInterval(teaserIntervalRef.current);
        }

        // Cycle through video posts every 4 seconds
        teaserIntervalRef.current = setInterval(() => {
          setActiveTeaserIndex(prev => {
            const videoIndices = posts
              .map((p, i) => getFileUrl(p.video_url) ? i : -1)
              .filter(i => i !== -1);

            if (videoIndices.length === 0) return 0;

            const currentVideoPosition = videoIndices.indexOf(prev);
            const nextPosition = (currentVideoPosition + 1) % videoIndices.length;
            return videoIndices[nextPosition] ?? 0;
          });
        }, 4000);
      }
    }

    return () => {
      if (teaserIntervalRef.current) {
        clearInterval(teaserIntervalRef.current);
      }
    };
  }, [isScreenFocused, posts]);

  // Handle screen focus for video playback and refresh posts
  useFocusEffect(
    useCallback(() => {
      setIsScreenFocused(true);
      // Refresh posts when screen comes into focus (e.g., after publishing a new post)
      if (user) {
        loadPosts(false);
        loadProfile(false);
      }
      return () => {
        setIsScreenFocused(false);
      };
    }, [user, activeTab])
  );

  useEffect(() => {
    if (!user) {
      router.replace('/auth/login');
      return;
    }

    if (__DEV__) {
      console.log('🔄 [useEffect] Tab or user changed:', {
        activeTab,
        userId: user?.id,
      });
    }

    loadProfile();
    loadPosts();
  }, [user, activeTab]);


  const loadProfile = async (showLoading = false) => {
    try {
      setError(null);
      if (showLoading) setLoadingProfile(true);

      // Fetch profile and statistics in parallel for better performance
      const [profileResponse, statsResponse] = await Promise.all([
        userApi.getProfile(),
        userApi.getStatistics()
      ]);

      if (profileResponse.status === 'success' && profileResponse.data) {
        const userData = (profileResponse.data as any).user || profileResponse.data;
        
        // Get following count from profile - backend returns followingCount directly
        let followingCount = userData.followingCount || 0;
        
        // If still 0, try statistics endpoint
        if (followingCount === 0 && statsResponse.status === 'success' && statsResponse.data) {
          const stats = (statsResponse.data as any).statistics || statsResponse.data;
          followingCount = stats.following_count || 0;
        }

        setProfile({
          ...userData,
          name: userData.username,
          followers_count: userData.follower_count || userData.followers_count || userData.followersCount || 0,
          following_count: followingCount, // Use followingCount from backend
          posts_count: userData.posts_count || userData.postsCount || 0,
          phone1: userData.phone1,
          phone2: userData.phone2,
          email: userData.email,
          profile_picture: userData.profile_picture,
          bio: userData.bio || '',
          username: userData.username,
          id: userData.id,
        });
      } else {
        setError({ type: 'server', message: profileResponse.message || 'Failed to load profile' });
      }
    } catch (error: any) {
      console.error('Error loading profile:', error);
      const isNetworkError = error?.message?.includes('Network') || error?.code === 'NETWORK_ERROR' || !error?.response;
      setError({
        type: isNetworkError ? 'network' : 'server',
        message: isNetworkError
          ? 'No internet connection. Please check your network and try again.'
          : error?.message || 'Failed to load profile. Please try again.'
      });
    } finally {
      setLoading(false);
      setLoadingProfile(false);
    }
  };

  const loadPosts = async (showLoading = false) => {
    try {
      setError(null);
      if (showLoading) setLoadingPosts(true);

      if (__DEV__) {
        console.log('📥 [loadPosts] Loading posts for tab:', activeTab);
      }

      // Fetch drafts separately if draft tab is active
      let response;
      if (activeTab === 'draft') {
        if (__DEV__) {
          console.log('📥 [loadPosts] Fetching drafts...');
        }
        response = await postsApi.getDrafts(1, 100);
        if (__DEV__) {
          console.log('📥 [loadPosts] Drafts API Response:', {
            status: response.status,
            postsCount: response.data?.posts?.length || 0,
            firstDraft: response.data?.posts?.[0] ? {
              id: response.data.posts[0].id,
              status: response.data.posts[0].status,
              type: response.data.posts[0].type,
              video_url: response.data.posts[0].video_url,
              image: response.data.posts[0].image,
              allKeys: Object.keys(response.data.posts[0]),
            } : null,
          });
        }
        if (response.status === 'success' && response.data?.posts) {
          setPosts(response.data.posts);
          setTotalLikes(0); // Drafts don't have likes yet
          return;
        }
      }

      if (__DEV__) {
        console.log('📥 [loadPosts] Fetching own posts...');
      }
      response = await userApi.getOwnPosts();

      if (__DEV__) {
        console.log('📥 [loadPosts] Own Posts API Response:', {
          status: response.status,
          postsCount: response.data?.posts?.length || 0,
          firstPost: response.data?.posts?.[0] ? {
            id: response.data.posts[0].id,
            status: response.data.posts[0].status,
            type: response.data.posts[0].type,
            video_url: response.data.posts[0].video_url,
            image: response.data.posts[0].image,
            allKeys: Object.keys(response.data.posts[0]),
          } : null,
        });
      }

      if (response.status === 'success' && response.data?.posts) {
        let filteredPosts = response.data.posts;

        // Filter by tab
        switch (activeTab) {
          case 'active':
            // Show active posts (or legacy approved posts, or posts with no status default to active)
            filteredPosts = filteredPosts.filter((p: any) =>
              p.status === 'active' ||
              p.status === 'approved' || // Legacy support
              !p.status // Default to active
            );
            break;
          case 'draft':
            filteredPosts = filteredPosts.filter((p: any) => p.status === 'draft');
            break;
          case 'suspended':
            // Show suspended posts (or legacy rejected/reported posts)
            filteredPosts = filteredPosts.filter((p: any) =>
              p.status === 'suspended' ||
              p.status === 'rejected' || // Legacy support
              p.status === 'reported' // Legacy support
            );
            break;
          default:
            // Default to active
            filteredPosts = filteredPosts.filter((p: any) =>
              p.status === 'active' ||
              p.status === 'approved' || // Legacy support
              !p.status // Default to active
            );
        }

        if (__DEV__) {
          console.log('📥 [loadPosts] Filtered posts:', {
            activeTab,
            beforeFilter: response.data.posts.length,
            afterFilter: filteredPosts.length,
            statusBreakdown: filteredPosts.reduce((acc: any, p: any) => {
              const status = p.status || 'active';
              acc[status] = (acc[status] || 0) + 1;
              return acc;
            }, {}),
          });
        }

        setPosts(filteredPosts);

        // Calculate total likes
        const likes = filteredPosts.reduce((sum: number, post: any) => {
          const cachedCount = postLikeCounts[post.id];
          return sum + (cachedCount !== undefined ? cachedCount : (post.likes || 0));
        }, 0);
        setTotalLikes(likes);
      } else {
        setError({ type: 'server', message: response.message || 'Failed to load posts' });
      }
    } catch (error: any) {
      console.error('Error loading posts:', error);
      const isNetworkError = error?.message?.includes('Network') || error?.code === 'NETWORK_ERROR' || !error?.response;
      setError({
        type: isNetworkError ? 'network' : 'server',
        message: isNetworkError
          ? 'No internet connection. Please check your network and try again.'
          : error?.message || 'Failed to load posts. Please try again.'
      });
    } finally {
      setLoadingPosts(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    setError(null);
    Promise.all([loadProfile(true), loadPosts(true)]).finally(() => setRefreshing(false));
  };

  // Optimistic like handler
  const handleLike = async (postId: string) => {
    if (!user) {
      Alert.alert(
        'Login Required',
        'Please log in to like posts.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Login', onPress: () => router.push('/auth/login') }
        ]
      );
      return;
    }

    if (likingPostId === postId) return; // Prevent double clicks
    setLikingPostId(postId);

    const isCurrentlyLiked = likedPosts.includes(postId);
    const currentCount = postLikeCounts[postId] || posts.find(p => p.id === postId)?.likes || 0;

    // Optimistic update - update UI immediately
    const newIsLiked = !isCurrentlyLiked;
    const newCount = newIsLiked ? currentCount + 1 : Math.max(0, currentCount - 1);

    if (newIsLiked) {
      dispatch(addLikedPost(postId));
    } else {
      dispatch(removeLikedPost(postId));
    }
    dispatch(setPostLikeCount({ postId, count: newCount }));

    // Update local posts array
    setPosts(prevPosts =>
      prevPosts.map(post =>
        post.id === postId
          ? { ...post, likes: newCount }
          : post
      )
    );

    // Update total likes
    setTotalLikes(prev => newIsLiked ? prev + 1 : Math.max(0, prev - 1));

    // Background API call
    try {
      const response = await likesApi.toggle(postId);

      if (response.status === 'success' && response.data) {
        // Update with server response
        const serverIsLiked = response.data.isLiked;
        const serverLikeCount = response.data.likeCount;

        if (serverIsLiked) {
          dispatch(addLikedPost(postId));
        } else {
          dispatch(removeLikedPost(postId));
        }
        dispatch(setPostLikeCount({ postId, count: serverLikeCount }));

        // Update local posts array with server response
        setPosts(prevPosts =>
          prevPosts.map(post =>
            post.id === postId
              ? { ...post, likes: serverLikeCount }
              : post
          )
        );

        // Update total likes with server response
        const diff = serverLikeCount - newCount;
        setTotalLikes(prev => Math.max(0, prev + diff));
      } else {
        // Revert on error
        if (isCurrentlyLiked) {
          dispatch(addLikedPost(postId));
        } else {
          dispatch(removeLikedPost(postId));
        }
        dispatch(setPostLikeCount({ postId, count: currentCount }));
        setPosts(prevPosts =>
          prevPosts.map(post =>
            post.id === postId
              ? { ...post, likes: currentCount }
              : post
          )
        );
        setTotalLikes(prev => {
          const diff = currentCount - newCount;
          return Math.max(0, prev + diff);
        });

        // Only show alert for non-404 errors (post not found should be silent)
        const isPostNotFound = response.message?.includes('not found') || response.message?.includes('Post not found');
        if (!isPostNotFound) {
          Alert.alert('Error', 'Failed to update like. Please try again.');
        }
      }
    } catch (error: any) {
      // Revert on error
      if (isCurrentlyLiked) {
        dispatch(addLikedPost(postId));
      } else {
        dispatch(removeLikedPost(postId));
      }
      dispatch(setPostLikeCount({ postId, count: currentCount }));
      setPosts(prevPosts =>
        prevPosts.map(post =>
          post.id === postId
            ? { ...post, likes: currentCount }
            : post
        )
      );
      setTotalLikes(prev => {
        const diff = currentCount - newCount;
        return Math.max(0, prev + diff);
      });

      const isNetworkError = error?.message?.includes('Network') || error?.code === 'NETWORK_ERROR';
      const isPostNotFound = error?.message?.includes('not found') || error?.message?.includes('Post not found');

      // Only show alerts for network errors, not for post not found
      if (isNetworkError) {
        Alert.alert(
          'Network Error',
          'Unable to update like. Your action will be synced when connection is restored.',
          [{ text: 'OK' }]
        );
      } else if (!isPostNotFound) {
        // Silent fail for post not found, show alert for other errors
        Alert.alert('Error', 'Failed to update like. Please try again.');
      }
    } finally {
      setLikingPostId(null);
    }
  };

  const handleVideoPlayPause = async () => {
    if (videoRef) {
      try {
        if (isVideoPlaying) {
          await videoRef.pauseAsync();
          setIsVideoPlaying(false);
        } else {
          await videoRef.playAsync();
          setIsVideoPlaying(true);
        }
      } catch (error) {
        console.error('Video play/pause error:', error);
      }
    }
  };

  const handleVideoLoad = () => {
    setVideoError(false);
    console.log('Video loaded successfully');
  };

  const handleVideoError = (error: any) => {
    const errorMessage = error?.message || error?.toString() || '';

    // Check for decoder errors - but we're already using native controls, so just log
    if (errorMessage.includes('Decoder') || errorMessage.includes('decoder') || errorMessage.includes('OMX')) {
      // Native controls should handle this better, but if it still fails, show error
      console.warn('Video decoder error (using native controls):', errorMessage);
      setVideoError(true);
      setVideoLoading(false);
      setIsVideoPlaying(false);
    } else {
      // Other errors (network, format, etc.)
      console.error('Video error:', errorMessage);
      setVideoError(true);
      setIsVideoPlaying(false);
      setVideoLoading(false);
    }
  };


  const handlePlaybackStatusUpdate = (status: any) => {
    if (status.isLoaded) {
      setIsVideoPlaying(status.isPlaying);
    }
  };

  const resetVideoState = () => {
    setIsVideoPlaying(false);
    setVideoError(false);
    setVideoLoading(false);
    setUseNativeControls(false);
    setDecoderErrorDetected(false);
    setVideoRef(null);
  };

  const handlePublishDraft = async (postId: string) => {
    // Log the draft post being published
    const draftPost = posts.find(p => p.id === postId);
    if (__DEV__) {
      console.log('📤 [handlePublishDraft] Publishing draft post:', {
        postId,
        post: draftPost ? {
          id: draftPost.id,
          status: draftPost.status,
          type: draftPost.type,
          video_url: draftPost.video_url,
          image: draftPost.image,
          caption: draftPost.caption,
          category: draftPost.category,
          allKeys: Object.keys(draftPost),
        } : null,
      });
    }

    Alert.alert(
      'Publish Post',
      'Are you sure you want to publish this draft? It will be submitted for review.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Publish',
          style: 'default',
          onPress: async () => {
            try {
              if (__DEV__) {
                console.log('📤 [handlePublishDraft] Calling API to publish post:', postId);
              }

              const response = await postsApi.publishDraft(postId);

              if (__DEV__) {
                console.log('📤 [handlePublishDraft] API Response:', {
                  status: response.status,
                  message: response.message,
                  data: response.data ? {
                    post: {
                      id: response.data.post?.id,
                      status: response.data.post?.status,
                      type: response.data.post?.type,
                      video_url: response.data.post?.video_url,
                      image: response.data.post?.image,
                    },
                  } : null,
                });
              }

              if (response.status === 'success') {
                // Remove from drafts list
                setPosts(prevPosts => {
                  const filtered = prevPosts.filter(post => post.id !== postId);
                  if (__DEV__) {
                    console.log('📤 [handlePublishDraft] Removed from drafts. Remaining drafts:', filtered.length);
                  }
                  return filtered;
                });

                // Show success message
                Alert.alert(
                  'Success',
                  'Your post has been published and is pending review.',
                  [{ text: 'OK' }]
                );

                // Refresh posts to update counts
                await loadPosts(true);
              } else {
                if (__DEV__) {
                  console.error('❌ [handlePublishDraft] Failed to publish:', response.message);
                }
                Alert.alert('Error', response.message || 'Failed to publish post. Please try again.');
              }
            } catch (error: any) {
              if (__DEV__) {
                console.error('❌ [handlePublishDraft] Error publishing draft:', {
                  error,
                  message: error?.message,
                  postId,
                });
              }
              Alert.alert(
                'Error',
                error?.message || 'Failed to publish post. Please try again.'
              );
            }
          }
        }
      ]
    );
  };

  const handleDeletePost = async (postId: string) => {
    const postToDelete = posts.find(p => p.id === postId);

    if (__DEV__) {
      console.log('🗑️ [handleDeletePost] Deleting post:', {
        postId,
        post: postToDelete ? {
          id: postToDelete.id,
          status: postToDelete.status,
          type: postToDelete.type,
        } : null,
      });
    }

    Alert.alert(
      'Delete Post',
      'Are you sure you want to delete this post?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive', onPress: async () => {
            try {
              if (__DEV__) {
                console.log('🗑️ [handleDeletePost] Calling API to delete post:', postId);
              }

              await postsApi.deletePost(postId);

              if (__DEV__) {
                console.log('🗑️ [handleDeletePost] Post deleted successfully');
              }

              setPosts(prev => {
                const filtered = prev.filter(p => p.id !== postId);
                if (__DEV__) {
                  console.log('🗑️ [handleDeletePost] Removed from list. Remaining posts:', filtered.length);
                }
                return filtered;
              });
              setPostOptionsModalVisible(false);
              setSelectedPost(null);
            } catch (error: any) {
              if (__DEV__) {
                console.error('❌ [handleDeletePost] Error deleting post:', {
                  error,
                  message: error?.message,
                  postId,
                });
              }
              Alert.alert('Error', 'Failed to delete post');
            }
          }
        }
      ]
    );
  };

  const renderPost = ({ item, index }: { item: Post; index: number }) => {
    const isActiveTeaser = isScreenFocused && activeTeaserIndex === index;

    // Log post being rendered (only first few to avoid spam)
    if (__DEV__ && index < 3) {
      console.log(`📄 [renderPost ${index}] Rendering post:`, {
        id: item.id,
        status: item.status,
        type: item.type,
        video_url: item.video_url,
        image: item.image,
        imageUrl: item.imageUrl,
        fullUrl: (item as any).fullUrl,
        caption: item.caption,
        category: item.category,
        activeTab,
        allKeys: Object.keys(item),
      });
    }

    return (
      <VideoThumbnail
        post={item}
        isActive={isActiveTeaser}
        onPress={() => {
          if (__DEV__) {
            console.log('👆 [renderPost] Post pressed:', {
              postId: item.id,
              status: item.status,
              activeTab,
            });
          }
          // Navigate to full-screen profile feed with current post as initial
          router.push({
            pathname: '/profile-feed/[userId]',
            params: {
              userId: user?.id || '',
              initialPostId: item.id,
              status: activeTab
            }
          });
        }}
        onViewsPress={async () => {
          setViewsModalPostId(item.id);
          setViewsModalVisible(true);
          setLoadingViews(true);
          try {
            const response = await viewsApi.getViewStats(item.id);
            if (response.status === 'success' && response.data?.recentViews) {
              setViewsData(response.data.recentViews);
            } else {
              setViewsData([]);
            }
          } catch (error) {
            console.error('Error loading views:', error);
            setViewsData([]);
            Alert.alert('Error', 'Failed to load views');
          } finally {
            setLoadingViews(false);
          }
        }}
        onOptionsPress={() => {
          if (__DEV__) {
            console.log('⚙️ [renderPost] Options pressed for post:', {
              postId: item.id,
              status: item.status,
            });
          }
          // Open options modal when 3 dots is clicked
          setSelectedPost(item);
          setPostOptionsModalVisible(true);
        }}
        onPublishPress={() => {
          if (__DEV__) {
            console.log('📤 [renderPost] Publish button pressed for draft:', {
              postId: item.id,
              status: item.status,
            });
          }
          // Publish draft directly from grid
          handlePublishDraft(item.id);
        }}
      />
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#60a5fa" />
      </View>
    );
  }

  if (!user || !profile) {
    return (
      <View style={styles.container}>
        <View style={styles.loginPrompt}>
          <Feather name="user" size={64} color="#666" />
          <Text style={styles.loginPromptText}>Sign in to view your profile</Text>
          <TouchableOpacity
            style={styles.loginButton}
            onPress={() => router.push('/auth/login')}
          >
            <Text style={styles.loginButtonText}>Sign In</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Text style={styles.headerTitle}>Profile</Text>
        <TouchableOpacity onPress={() => setMenuVisible(true)} style={styles.menuButton}>
          <Feather name="more-horizontal" size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      <ScrollView
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#60a5fa" />
        }
      >
        {/* Profile Info */}
        <View style={styles.profileSection}>
          <Avatar
            user={profile}
            size={100}
            style={styles.avatar}
          />
          <Text style={styles.username}>@{profile.username}</Text>
          {profile.bio && <Text style={styles.bio}>{profile.bio}</Text>}

          {/* Stats */}
          <View style={styles.statsContainer}>
            <TouchableOpacity style={styles.stat}>
              <Text style={styles.statValue}>{profile.posts_count || 0}</Text>
              <Text style={styles.statLabel}>Posts</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.stat}
              onPress={() => router.push({
                pathname: '/followers/[id]',
                params: { id: profile.id, type: 'followers' }
              })}
            >
              <Text style={styles.statValue}>{profile.followers_count || 0}</Text>
              <Text style={styles.statLabel}>Followers</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.stat}
              onPress={() => router.push({
                pathname: '/followers/[id]',
                params: { id: profile.id, type: 'following' }
              })}
            >
              <Text style={styles.statValue}>{profile.following_count || 0}</Text>
              <Text style={styles.statLabel}>Following</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.stat}
              onPress={async () => {
                setLikesModalVisible(true);
                setLoadingLikes(true);
                try {
                  // Fetch likes for all posts and combine
                  const allLikers = new Map<string, any>();
                  for (const post of posts) {
                    try {
                      const response = await likesApi.getLikers(post.id, 1, 50);
                      if (response.status === 'success' && response.data?.users) {
                        response.data.users.forEach((user: any) => {
                          if (!allLikers.has(user.id)) {
                            allLikers.set(user.id, {
                              ...user,
                              likedPosts: [post.id],
                              totalLikesGiven: 1,
                            });
                          } else {
                            const existing = allLikers.get(user.id);
                            if (!existing.likedPosts.includes(post.id)) {
                              existing.likedPosts.push(post.id);
                              existing.totalLikesGiven += 1;
                            }
                          }
                        });
                      }
                    } catch (error) {
                      console.error('Error fetching likers for post:', post.id, error);
                    }
                  }
                  setLikesData(Array.from(allLikers.values()));
                } catch (error) {
                  console.error('Error loading likes data:', error);
                  Alert.alert('Error', 'Failed to load likes data');
                } finally {
                  setLoadingLikes(false);
                }
              }}
            >
              <Text style={styles.statValue}>{totalLikes}</Text>
              <Text style={styles.statLabel}>Likes</Text>
            </TouchableOpacity>
          </View>

          {/* Edit Profile Button */}
          <TouchableOpacity
            style={styles.editButton}
            onPress={() => setEditModalVisible(true)}
          >
            <Text style={styles.editButtonText}>Edit Profile</Text>
          </TouchableOpacity>
        </View>

        {/* Tabs */}
        <View style={styles.tabsContainer}>
          {PROFILE_TABS.map((tab) => (
            <TouchableOpacity
              key={tab.key}
              style={[
                styles.tab,
                activeTab === tab.key && styles.tabActive
              ]}
              onPress={() => {
                if (__DEV__) {
                  console.log('🔄 [Tab Change] Switching to tab:', {
                    from: activeTab,
                    to: tab.key,
                  });
                }
                setActiveTab(tab.key);
              }}
            >
              <MaterialIcons
                name={tab.icon as any}
                size={16}
                color={activeTab === tab.key ? '#60a5fa' : '#666'}
              />
              <Text style={[
                styles.tabText,
                activeTab === tab.key && styles.tabTextActive
              ]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Posts Grid */}
        <FlatList
          data={posts}
          renderItem={renderPost}
          keyExtractor={(item) => item.id}
          numColumns={3}
          scrollEnabled={false}
          contentContainerStyle={styles.postsGrid}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <MaterialIcons name="video-library" size={48} color="#666" />
              <Text style={styles.emptyText}>No {activeTab} posts</Text>
              {activeTab === 'active' && (
                <TouchableOpacity
                  style={styles.createButton}
                  onPress={() => router.push('/(tabs)/create')}
                >
                  <Text style={styles.createButtonText}>Create your first post</Text>
                </TouchableOpacity>
              )}
            </View>
          }
        />
      </ScrollView>

      {/* Menu Modal */}
      <Modal visible={menuVisible} transparent animationType="fade">
        <TouchableOpacity
          style={styles.menuOverlay}
          onPress={() => setMenuVisible(false)}
          activeOpacity={1}
        >
          <View style={styles.menuContainer}>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setMenuVisible(false);
                setEditModalVisible(true);
              }}
            >
              <Feather name="edit" size={20} color="#fff" />
              <Text style={styles.menuItemText}>Edit Profile</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setMenuVisible(false);
                router.push('/settings');
              }}
            >
              <Feather name="settings" size={20} color="#fff" />
              <Text style={styles.menuItemText}>Settings</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.menuItem, styles.menuItemDanger]}
              onPress={() => {
                setMenuVisible(false);
                Alert.alert(
                  'Log Out',
                  'Are you sure you want to log out?',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Log Out', style: 'destructive', onPress: logout }
                  ]
                );
              }}
            >
              <Feather name="log-out" size={20} color="#ef4444" />
              <Text style={[styles.menuItemText, { color: '#ef4444' }]}>Log Out</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Views Modal */}
      <Modal visible={viewsModalVisible} transparent animationType="slide">
        <TouchableOpacity
          style={styles.menuOverlay}
          onPress={() => setViewsModalVisible(false)}
          activeOpacity={1}
        >
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Views</Text>
              <TouchableOpacity onPress={() => setViewsModalVisible(false)}>
                <MaterialIcons name="close" size={24} color="#fff" />
              </TouchableOpacity>
            </View>
            {loadingViews ? (
              <View style={styles.modalLoading}>
                <ActivityIndicator size="large" color="#60a5fa" />
              </View>
            ) : viewsData.length > 0 ? (
              <FlatList
                data={viewsData}
                keyExtractor={(item) => item.user?.id || item.id || Math.random().toString()}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.modalUserItem}
                    onPress={() => {
                      if (item.user?.id) {
                        router.push({
                          pathname: '/user/[id]',
                          params: { id: item.user.id }
                        });
                        setViewsModalVisible(false);
                      }
                    }}
                  >
                    <Avatar
                      user={item.user}
                      size={50}
                      style={styles.modalUserAvatar}
                    />
                    <View style={styles.modalUserInfo}>
                      <Text style={styles.modalUserName}>
                        {item.user?.username || item.user?.display_name || 'Anonymous'}
                      </Text>
                      {item.viewedAt && (
                        <Text style={styles.modalUserMeta}>
                          {new Date(item.viewedAt).toLocaleDateString()}
                        </Text>
                      )}
                    </View>
                  </TouchableOpacity>
                )}
                contentContainerStyle={styles.modalListContent}
              />
            ) : (
              <View style={styles.modalEmpty}>
                <MaterialIcons name="visibility-off" size={48} color="#666" />
                <Text style={styles.modalEmptyText}>No views yet</Text>
              </View>
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Likes Modal */}
      <Modal visible={likesModalVisible} transparent animationType="slide">
        <TouchableOpacity
          style={styles.menuOverlay}
          onPress={() => setLikesModalVisible(false)}
          activeOpacity={1}
        >
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>People Who Liked Your Posts</Text>
              <TouchableOpacity onPress={() => setLikesModalVisible(false)}>
                <MaterialIcons name="close" size={24} color="#fff" />
              </TouchableOpacity>
            </View>
            {loadingLikes ? (
              <View style={styles.modalLoading}>
                <ActivityIndicator size="large" color="#60a5fa" />
              </View>
            ) : likesData.length > 0 ? (
              <FlatList
                data={likesData}
                keyExtractor={(item) => item.id || Math.random().toString()}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.modalUserItem}
                    onPress={() => {
                      if (item.id) {
                        router.push({
                          pathname: '/user/[id]',
                          params: { id: item.id }
                        });
                        setLikesModalVisible(false);
                      }
                    }}
                  >
                    <Avatar
                      user={item}
                      size={50}
                      style={styles.modalUserAvatar}
                    />
                    <View style={styles.modalUserInfo}>
                      <Text style={styles.modalUserName}>
                        {item.username || item.display_name || 'Unknown'}
                      </Text>
                      <Text style={styles.modalUserMeta}>
                        Liked {item.totalLikesGiven || item.likedPosts?.length || 0} of your posts
                      </Text>
                    </View>
                  </TouchableOpacity>
                )}
                contentContainerStyle={styles.modalListContent}
              />
            ) : (
              <View style={styles.modalEmpty}>
                <MaterialIcons name="favorite-border" size={48} color="#666" />
                <Text style={styles.modalEmptyText}>No likes yet</Text>
              </View>
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Post Options Modal */}
      <Modal visible={postOptionsModalVisible} transparent animationType="slide">
        <TouchableOpacity
          style={styles.menuOverlay}
          onPress={() => setPostOptionsModalVisible(false)}
          activeOpacity={1}
        >
          <View style={styles.menuContainer}>
            {/* Post Preview */}
            {selectedPost && (
              <View style={styles.postOptionsPreview}>
                <View style={styles.postOptionsPreviewMedia}>
                  {getFileUrl(selectedPost.video_url) ? (
                    <View style={styles.postOptionsThumbnail}>
                      <Feather name="video" size={24} color="#60a5fa" />
                    </View>
                  ) : getPostMediaUrl(selectedPost) ? (
                    <Image
                      source={{ uri: selectedPost.image }}
                      style={styles.postOptionsThumbnail}
                      resizeMode="cover"
                    />
                  ) : (
                    <View style={styles.postOptionsThumbnail}>
                      <MaterialIcons name="image" size={24} color="#666" />
                    </View>
                  )}
                </View>
                <View style={styles.postOptionsInfo}>
                  <Text style={styles.postOptionsCaption} numberOfLines={2}>
                    {selectedPost.caption || selectedPost.description || selectedPost.title || 'No caption'}
                  </Text>
                  <View style={styles.postOptionsStats}>
                    <Text style={styles.postOptionsStatText}>
                      {formatNumber(selectedPost.likes || 0)} likes
                    </Text>
                    <Text style={styles.postOptionsStatText}>
                      • {formatNumber(selectedPost.comments_count || 0)} comments
                    </Text>
                  </View>
                </View>
              </View>
            )}

            <View style={styles.menuDivider} />

            {/* Publish Draft Button - Only show for draft posts */}
            {selectedPost?.status === 'draft' && (
              <TouchableOpacity
                style={[styles.menuItem, styles.menuItemPrimary]}
                onPress={() => {
                  setPostOptionsModalVisible(false);
                  if (selectedPost) {
                    handlePublishDraft(selectedPost.id);
                  }
                }}
              >
                <Feather name="send" size={20} color="#10b981" />
                <Text style={[styles.menuItemText, { color: '#10b981' }]}>Publish Post</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setPostOptionsModalVisible(false);
                if (selectedPost) {
                  Share.share({
                    message: selectedPost.caption || selectedPost.description || '',
                    url: selectedPost.video_url || selectedPost.image || '',
                  });
                }
              }}
            >
              <Feather name="share-2" size={20} color="#60a5fa" />
              <Text style={styles.menuItemText}>Share Post</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.menuItem, styles.menuItemDanger]}
              onPress={() => {
                setPostOptionsModalVisible(false);
                if (selectedPost) {
                  handleDeletePost(selectedPost.id);
                }
              }}
            >
              <Feather name="trash-2" size={20} color="#ef4444" />
              <Text style={[styles.menuItemText, { color: '#ef4444' }]}>Delete Post</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => setPostOptionsModalVisible(false)}
            >
              <Feather name="x" size={20} color="#fff" />
              <Text style={styles.menuItemText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Edit Profile Modal */}
      <EditProfileModal
        isVisible={editModalVisible}
        onClose={() => setEditModalVisible(false)}
        user={profile}
        onProfileUpdated={(updatedUser) => {
          setProfile(updatedUser);
          setEditModalVisible(false);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loginPrompt: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  loginPromptText: {
    color: '#fff',
    fontSize: 18,
    marginTop: 16,
    marginBottom: 24,
    textAlign: 'center',
  },
  loginButton: {
    backgroundColor: '#60a5fa',
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 24,
  },
  loginButtonText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '600',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  menuButton: {
    padding: 8,
  },
  profileSection: {
    alignItems: 'center',
    padding: 24,
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    marginBottom: 16,
  },
  username: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 8,
  },
  bio: {
    color: '#999',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 20,
  },
  statsContainer: {
    flexDirection: 'row',
    marginBottom: 20,
  },
  stat: {
    alignItems: 'center',
    marginHorizontal: 20,
  },
  statValue: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  statLabel: {
    color: '#999',
    fontSize: 12,
    marginTop: 2,
  },
  editButton: {
    backgroundColor: '#1a1a1a',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#333',
  },
  editButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  tabsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 20,
    marginHorizontal: 2,
    backgroundColor: '#1a1a1a',
  },
  tabActive: {
    backgroundColor: 'rgba(96, 165, 250, 0.2)',
  },
  tabText: {
    color: '#666',
    fontSize: 12,
    fontWeight: '500',
    marginLeft: 4,
  },
  tabTextActive: {
    color: '#60a5fa',
  },
  postsGrid: {
    padding: 2,
  },
  postItem: {
    width: (screenWidth - 6) / 3,
    aspectRatio: 0.75, // 3:4 aspect ratio for better previews
    margin: 1,
    position: 'relative',
    backgroundColor: '#1a1a1a',
    borderRadius: 2,
    overflow: 'hidden',
  },
  postMedia: {
    width: '100%',
    height: '100%',
    backgroundColor: '#1a1a1a',
  },
  postOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    padding: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  postStats: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  postStatText: {
    color: '#fff',
    fontSize: 10,
    marginLeft: 3,
    fontWeight: '600',
  },
  statusIndicator: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoPlayIndicator: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 12,
    padding: 4,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 24,
    minHeight: 24,
  },
  videoPlayIndicatorActive: {
    backgroundColor: '#ef4444',
  },
  playingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#fff',
  },
  postOptionsButton: {
    position: 'absolute',
    top: 4,
    left: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 12,
    padding: 6,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 28,
    minHeight: 28,
  },
  publishDraftButton: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: '#10b981',
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#10b981',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  publishDraftButtonText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
    marginLeft: 4,
  },
  teaserVideo: {
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
  defaultAvatar: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  defaultAvatarText: {
    color: '#fff',
    fontWeight: '700',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 60,
    width: screenWidth,
  },
  emptyText: {
    color: '#fff',
    fontSize: 16,
    marginTop: 16,
    marginBottom: 16,
  },
  createButton: {
    backgroundColor: '#60a5fa',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
  },
  createButtonText: {
    color: '#000',
    fontSize: 14,
    fontWeight: '600',
  },
  menuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  menuContainer: {
    backgroundColor: '#18181b',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    paddingBottom: 40, // Increased bottom padding
    maxHeight: '70%', // Reduced max height to ensure content fits
    marginBottom: 40, // Increased margin at bottom for better spacing
  },
  menuDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
    marginVertical: 8,
  },
  postOptionsPreview: {
    flexDirection: 'row',
    padding: 12,
    backgroundColor: '#232326',
    borderRadius: 12,
    marginBottom: 8,
  },
  postOptionsPreviewMedia: {
    marginRight: 12,
  },
  postOptionsThumbnail: {
    width: 60,
    height: 60,
    borderRadius: 8,
    backgroundColor: '#1a1a1a',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  postOptionsInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  postOptionsCaption: {
    color: '#fff',
    fontSize: 14,
    marginBottom: 6,
    lineHeight: 18,
  },
  postOptionsStats: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  postOptionsStatText: {
    color: '#999',
    fontSize: 12,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginBottom: 8,
    backgroundColor: '#232326',
  },
  menuItemDanger: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
  },
  menuItemPrimary: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
  },
  menuItemText: {
    color: '#fff',
    fontSize: 16,
    marginLeft: 12,
  },
  postModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  postModalContainer: {
    width: '90%',
    maxHeight: '90%',
    backgroundColor: '#18181b',
    borderRadius: 20,
    padding: 16,
    position: 'relative',
  },
  postModalClose: {
    position: 'absolute',
    top: 16,
    right: 16,
    zIndex: 10,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 20,
    padding: 8,
  },
  postModalMedia: {
    width: '100%',
    height: 300,
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 16,
  },
  modalMedia: {
    width: '100%',
    height: '100%',
  },
  postModalInfo: {
    marginBottom: 16,
    paddingHorizontal: 4,
  },
  postModalCaption: {
    color: '#fff',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 12,
  },
  postModalStats: {
    flexDirection: 'row',
    gap: 16,
  },
  postModalStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  postModalStatText: {
    color: '#999',
    fontSize: 12,
  },
  postModalActions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  modalActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 20,
    backgroundColor: '#232326',
  },
  modalActionButtonDanger: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
  },
  modalActionText: {
    color: '#fff',
    fontSize: 14,
    marginLeft: 8,
  },
  videoContainer: {
    position: 'relative',
    width: '100%',
    height: '100%',
  },
  videoOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  playPauseButton: {
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderRadius: 30,
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoErrorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
  },
  videoErrorText: {
    color: '#666',
    fontSize: 16,
    marginTop: 12,
    marginBottom: 16,
  },
  retryButton: {
    backgroundColor: '#60a5fa',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },
  retryButtonText: {
    color: '#000',
    fontSize: 14,
    fontWeight: '600',
  },
  loadingText: {
    color: '#fff',
    fontSize: 14,
    marginTop: 8,
  },
  nativeControlsButton: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderRadius: 20,
    padding: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalContainer: {
    backgroundColor: '#18181b',
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
    color: '#fff',
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
    backgroundColor: '#232326',
    marginBottom: 8,
  },
  modalUserAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginRight: 12,
    backgroundColor: '#1a1a1a',
  },
  modalUserInfo: {
    flex: 1,
  },
  modalUserName: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  modalUserMeta: {
    color: '#999',
    fontSize: 12,
  },
  modalEmpty: {
    paddingVertical: 60,
    alignItems: 'center',
  },
  modalEmptyText: {
    color: '#999',
    fontSize: 16,
    marginTop: 16,
  },
});