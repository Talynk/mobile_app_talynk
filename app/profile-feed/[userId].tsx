import React, { useState, useEffect, useRef, useCallback, createContext, useContext } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
  Image,
  Dimensions,
  StatusBar,
  Share,
  Animated,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Video, ResizeMode } from 'expo-av';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { postsApi, likesApi, userApi } from '@/lib/api';
import { API_BASE_URL } from '@/lib/config';
import { Post } from '@/types';
import { useAuth } from '@/lib/auth-context';
import { useCache } from '@/lib/cache-context';
import { useAppDispatch, useAppSelector } from '@/lib/store/hooks';
import { 
  addLikedPost, 
  removeLikedPost, 
  setPostLikeCount, 
  setPostLikeCounts,
} from '@/lib/store/slices/likesSlice';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { useRealtime } from '@/lib/realtime-context';
import RealtimeProvider from '@/lib/realtime-context';
import { useRealtimePost } from '@/lib/hooks/use-realtime-post';
import { useLikesManager } from '@/lib/hooks/use-likes-manager';
import ReportModal from '@/components/ReportModal';
import CommentsModal from '@/components/CommentsModal';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

// Global mute context
const MuteContext = createContext({ isMuted: false, setIsMuted: (v: boolean) => {} });
const useMute = () => useContext(MuteContext);

// Global video manager to ensure only one video plays at a time
const activeVideoRef = { current: null as Video | null };
const pauseAllVideosExcept = async (currentVideo: Video | null) => {
  if (activeVideoRef.current && activeVideoRef.current !== currentVideo) {
    try {
      const status = await activeVideoRef.current.getStatusAsync();
      if (status?.isLoaded && status.isPlaying) {
        await activeVideoRef.current.pauseAsync();
      }
    } catch (error) {
      // Silently handle errors
    }
  }
  activeVideoRef.current = currentVideo;
};

// Utility functions
const formatNumber = (num: number): string => {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  }
  return num.toString();
};


import { getPostMediaUrl, getThumbnailUrl, getProfilePictureUrl } from '@/lib/utils/file-url';
import { Avatar } from '@/components/Avatar';
import { timeAgo } from '@/lib/utils/time-ago';

const getMediaUrl = (post: Post): string | null => {
  return getPostMediaUrl(post);
};

interface PostItemProps {
  item: Post;
  index: number;
  onLike: (postId: string) => void;
  onComment: (postId: string) => void;
  onShare: (postId: string) => void;
  onReport: (postId: string) => void;
  isLiked: boolean;
  isActive: boolean;
  availableHeight: number;
}

// Expandable caption component
const ExpandableCaption = ({ text, maxLines = 3 }: { text: string; maxLines?: number }) => {
  const [expanded, setExpanded] = useState(false);

  if (!text) return null;

  const estimatedLines = text.length / 50;
  const shouldTruncate = estimatedLines > maxLines || text.split('\n').length > maxLines;

  return (
    <View>
      <Text 
        style={styles.caption} 
        numberOfLines={expanded ? undefined : maxLines}
      >
        {text}
      </Text>
      {shouldTruncate && (
        <TouchableOpacity onPress={() => setExpanded(!expanded)} activeOpacity={0.7}>
          <Text style={styles.showMoreText}>
            {expanded ? 'Show less' : 'Show more'}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const PostItem: React.FC<PostItemProps> = ({ 
  item, 
  index, 
  onLike, 
  onComment, 
  onShare, 
  onReport,
  isLiked, 
  isActive,
  availableHeight
}) => {
  const { user } = useAuth();
  const { sendLikeAction } = useRealtime();
  const dispatch = useAppDispatch();
  const likedPosts = useAppSelector(state => state.likes.likedPosts);
  const postLikeCounts = useAppSelector(state => state.likes.postLikeCounts);
  
  const isPostLiked = likedPosts.includes(item.id);
  const cachedLikeCount = postLikeCounts[item.id];
  const initialLikeCount = cachedLikeCount !== undefined ? cachedLikeCount : (item.likes || 0);
  
  const { likes, comments, isLiked: realtimeIsLiked, updateLikesLocally } = useRealtimePost({
    postId: item.id,
    initialLikes: initialLikeCount,
    initialComments: item.comments_count || 0,
    initialIsLiked: isPostLiked || isLiked,
  });
  
  const videoRef = useRef<Video>(null);
  const [isLiking, setIsLiking] = useState(false);
  const [imageError, setImageError] = useState(false);
  const { isMuted, setIsMuted } = useMute();
  const [videoError, setVideoError] = useState(false);
  const [videoLoaded, setVideoLoaded] = useState(false);
  const [videoLoading, setVideoLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [useNativeControls, setUseNativeControls] = useState(false);
  const [decoderErrorDetected, setDecoderErrorDetected] = useState(false);
  const [videoProgress, setVideoProgress] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const insets = useSafeAreaInsets();
  
  const likeScale = useRef(new Animated.Value(1)).current;
  const likeOpacity = useRef(new Animated.Value(0)).current;

  const mediaUrl = getMediaUrl(item);
  
  // Log post item structure for debugging (only first 3 items to avoid spam)
  if (__DEV__ && index < 3) {
    console.log(`📄 [ProfileFeed PostItem ${index}] Post data:`, {
      id: item.id,
      type: item.type,
      video_url: item.video_url,
      image: item.image,
      imageUrl: item.imageUrl,
      fullUrl: (item as any).fullUrl,
      mediaUrl: mediaUrl,
      allKeys: Object.keys(item),
    });
  }
  const isVideo =
    item.type === 'video' ||
    (mediaUrl !== null &&
      (mediaUrl.includes('.mp4') ||
        mediaUrl.includes('.mov') ||
        mediaUrl.includes('.webm')));

  useEffect(() => {
    if (!videoRef.current || useNativeControls || !isVideo) return;
    
    const managePlayback = async () => {
      try {
        const currentVideo = videoRef.current;
        if (!currentVideo) return;
        
        const status = await currentVideo.getStatusAsync();
        if (!status?.isLoaded) return;
        
        if (isActive) {
          await pauseAllVideosExcept(currentVideo);
          if (!status.isPlaying) {
            await currentVideo.playAsync();
          }
        } else {
          if (status.isPlaying) {
            await currentVideo.pauseAsync();
          }
          if (activeVideoRef.current === currentVideo) {
            activeVideoRef.current = null;
          }
        }
      } catch (error) {
        // Silently handle errors
      }
    };
    
    managePlayback();
  }, [isActive, useNativeControls, isVideo]);

  useEffect(() => {
    return () => {
      if (videoRef.current) {
        if (activeVideoRef.current === videoRef.current) {
          activeVideoRef.current = null;
        }
        videoRef.current.unloadAsync().catch(() => {});
      }
    };
  }, []);

  const handleVideoTap = () => {
    setIsMuted(!isMuted);
  };

  const handleLike = async () => {
    if (!user) {
      Alert.alert(
        'Login Required',
        'Please log in to like posts and interact with the community.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Log In', onPress: () => router.push('/auth/login') }
        ]
      );
      return;
    }
    
    if (isLiking) return;
    setIsLiking(true);
    
    const currentIsLiked = isPostLiked;
    const newIsLiked = !currentIsLiked;
    
    Animated.sequence([
      Animated.timing(likeScale, {
        toValue: 1.3,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(likeScale, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start();

    if (newIsLiked) {
      Animated.sequence([
        Animated.timing(likeOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(likeOpacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
    }
    
    sendLikeAction(item.id, newIsLiked);
    await onLike(item.id);
    
    setIsLiking(false);
  };

  const handleComment = useCallback(() => {
    if (onComment && item.id) {
      onComment(item.id);
    }
  }, [onComment, item.id]);

  const handleUserPress = () => {
    if (item.user?.id) {
      router.push({
        pathname: '/user/[id]',
        params: { id: item.user.id }
      });
    }
  };

  const handleCategoryPress = () => {
    const categoryName = typeof item.category === 'string' ? item.category : item.category?.name;
    if (categoryName) {
      router.push({
        pathname: '/category/[name]',
        params: { name: categoryName }
      });
    }
  };

  return (
    <View style={[styles.postContainer, { height: availableHeight }]}>
      {/* Media */}
      <View style={[styles.mediaContainer, { height: availableHeight }]}>
        {isVideo ? (
          videoError || !isActive ? (
            // Show thumbnail when video has error OR when not active (memory optimization)
            <TouchableOpacity 
              style={styles.mediaWrapper} 
              activeOpacity={1} 
              onPress={handleVideoTap}
            >
              {mediaUrl ? (
                <Image
                  source={{ uri: getThumbnailUrl(item) || mediaUrl }}
                  style={styles.media}
                  resizeMode="cover"
                  onError={() => {
                    setImageError(true);
                  }}
                />
              ) : (
                <View style={[styles.media, styles.placeholderContainer]}>
                  <Feather name="video-off" size={48} color="#666" />
                  <Text style={styles.placeholderText}>Video unavailable</Text>
                </View>
              )}
              {/* Play icon overlay for inactive videos */}
              {!videoError && !isActive && (
                <View style={styles.playIconOverlay}>
                  <View style={styles.playIconCircle}>
                    <Feather name="play" size={32} color="#fff" />
                  </View>
                </View>
              )}
            </TouchableOpacity>
          ) : (
            // Only load Video component when active
            <TouchableOpacity 
              style={styles.mediaWrapper} 
              activeOpacity={1} 
              onPress={handleVideoTap}
            >
              <Video
                ref={videoRef}
                source={{ 
                  uri: mediaUrl || '',
                  headers: {
                    'Cache-Control': 'public, max-age=31536000, immutable'
                  }
                }}
                style={styles.media}
                resizeMode={ResizeMode.COVER}
                shouldPlay={useNativeControls ? false : !decoderErrorDetected && isActive}
                isLooping={!useNativeControls}
                isMuted={useNativeControls ? false : isMuted}
                usePoster={false}
                shouldCorrectPitch={true}
                volume={useNativeControls ? 1.0 : (isMuted ? 0.0 : 1.0)}
                useNativeControls={useNativeControls}
                progressUpdateIntervalMillis={100}
                onLoadStart={() => {
                  setVideoLoading(true);
                }}
                onLoad={() => {
                  setVideoLoaded(true);
                  setVideoLoading(false);
                  if (!useNativeControls && videoRef.current && isActive) {
                    pauseAllVideosExcept(videoRef.current).then(() => {
                      videoRef.current?.playAsync().catch(() => {});
                    });
                  }
                }}
                onError={(error: any) => {
                  if (!decoderErrorDetected) {
                    const errorMessage = error?.message || error?.toString() || '';
                    if (errorMessage.includes('Decoder') || errorMessage.includes('decoder') || errorMessage.includes('OMX')) {
                      setDecoderErrorDetected(true);
                      setUseNativeControls(true);
                      setVideoError(false);
                      setVideoLoaded(true);
                    } else {
                      setVideoError(true);
                      setVideoLoading(false);
                    }
                  }
                }}
                onPlaybackStatusUpdate={(status: any) => {
                  if (status.isLoaded) {
                    if (!useNativeControls) {
                      if (status.isPlaying !== isPlaying) {
                        setIsPlaying(status.isPlaying);
                      }
                      if (status.durationMillis && status.positionMillis !== undefined) {
                        const progress = status.durationMillis > 0 
                          ? status.positionMillis / status.durationMillis 
                          : 0;
                        setVideoProgress(progress);
                        setVideoDuration(status.durationMillis);
                      }
                    }
                  }
                }}
              />
            </TouchableOpacity>
          )
        ) : (
          <View style={styles.mediaWrapper}>
            {mediaUrl && !imageError ? (
              <Image
                source={{ uri: mediaUrl }}
                style={styles.media}
                resizeMode="cover"
                onError={() => setImageError(true)}
              />
            ) : (
              <View style={[styles.media, styles.placeholderContainer]}>
                <Feather name="image" size={48} color="#666" />
                <Text style={styles.placeholderText}>Image unavailable</Text>
              </View>
            )}
          </View>
        )}

        {/* Mute indicator */}
        {isVideo && !useNativeControls && isActive && (
          <View style={styles.muteIndicator}>
            <Feather name={isMuted ? 'volume-x' : 'volume-2'} size={20} color="#fff" />
          </View>
        )}


        {/* Heart animation overlay */}
        <Animated.View 
          style={[
            styles.heartOverlay,
            { opacity: likeOpacity }
          ]}
          pointerEvents="none"
        >
          <MaterialIcons name="favorite" size={100} color="#fff" />
        </Animated.View>

        {/* Right side actions */}
        <View style={styles.actionsContainer}>
          {/* User avatar */}
          <TouchableOpacity style={styles.avatarContainer} onPress={handleUserPress}>
            <Avatar
              user={item.user}
              size={40}
              style={styles.avatar}
            />
          </TouchableOpacity>

          {/* Like */}
          <TouchableOpacity style={styles.actionButton} onPress={handleLike}>
            <Animated.View style={{ transform: [{ scale: likeScale }] }}>
              <MaterialIcons 
                name={isPostLiked ? 'favorite' : 'favorite-border'} 
                size={28} 
                color={isPostLiked ? '#ef4444' : '#fff'} 
              />
            </Animated.View>
            <Text style={styles.actionText}>{formatNumber(cachedLikeCount ?? likes)}</Text>
          </TouchableOpacity>

          {/* Comment */}
          <TouchableOpacity style={styles.actionButton} onPress={handleComment}>
            <Feather name="message-circle" size={26} color="#fff" />
            <Text style={styles.actionText}>{formatNumber(comments)}</Text>
          </TouchableOpacity>

          {/* Share */}
          <TouchableOpacity style={styles.actionButton} onPress={() => onShare(item.id)}>
            <Feather name="share-2" size={24} color="#fff" />
          </TouchableOpacity>

          {/* More Actions */}
          <TouchableOpacity style={styles.actionButton} onPress={() => onReport(item.id)}>
            <Feather name="more-horizontal" size={24} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Bottom Info - positioned above progress bar */}
        <View style={[styles.bottomInfo, { bottom: Math.max(insets.bottom + 5, 21) }]}>
          <View style={styles.bottomInfoContent}>
            <TouchableOpacity onPress={handleUserPress}>
              <Text style={styles.username}>@{item.user?.username || 'unknown'}</Text>
            </TouchableOpacity>
            
            {/* Show caption/description only once - prefer caption, then description, then title */}
            {(item.caption || item.description || item.title) && (
              <ExpandableCaption 
                text={item.caption || item.description || item.title || ''} 
                maxLines={2} 
              />
            )}
            {/* Timestamp */}
            {(item.createdAt || item.uploadDate || (item as any).created_at) && (
              <Text style={styles.timestamp}>
                {timeAgo(item.createdAt || item.uploadDate || (item as any).created_at)}
              </Text>
            )}
          </View>

          {/* Category Badge */}
          {item.category && (
            <TouchableOpacity style={styles.categoryBadge} onPress={handleCategoryPress}>
              <Text style={styles.categoryText}>
                #{typeof item.category === 'string' ? item.category : item.category.name}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Video progress bar - at the very bottom edge */}
        {isVideo && !useNativeControls && isActive && videoDuration > 0 && (
          <View style={[styles.progressBarContainer, { bottom: insets.bottom }]}>
            <View style={[styles.progressBar, { width: `${videoProgress * 100}%` }]} />
          </View>
        )}
      </View>
    </View>
  );
};

export default function ProfileFeedScreen() {
  const { userId, initialPostId, status } = useLocalSearchParams();
  
  return (
    <RealtimeProvider>
      <ProfileFeedContent 
        userId={userId as string} 
        initialPostId={initialPostId as string} 
        status={status as string} 
      />
    </RealtimeProvider>
  );
}

interface ProfileFeedContentProps {
  userId: string;
  initialPostId?: string;
  status?: string;
}

function ProfileFeedContent({ userId, initialPostId, status }: ProfileFeedContentProps) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isScreenFocused, setIsScreenFocused] = useState(true);
  const [initialScrollDone, setInitialScrollDone] = useState(false);
  const lastActiveIndexRef = useRef(0);
  const [reportModalVisible, setReportModalVisible] = useState(false);
  const [reportPostId, setReportPostId] = useState<string | null>(null);
  const [commentsModalVisible, setCommentsModalVisible] = useState(false);
  const [commentsPostId, setCommentsPostId] = useState<string | null>(null);
  const [commentsPostTitle, setCommentsPostTitle] = useState<string>('');
  const [commentsPostAuthor, setCommentsPostAuthor] = useState<string>('');
  const [isMuted, setIsMuted] = useState(false);
  const [username, setUsername] = useState<string>('');
  const flatListRef = useRef<FlatList>(null);
  const { user } = useAuth();
  const { syncLikedPostsFromServer } = useCache();
  const dispatch = useAppDispatch();
  const likedPosts = useAppSelector(state => state.likes.likedPosts);
  const insets = useSafeAreaInsets();
  
  const likesManager = useLikesManager();
  
  // Calculate available height for posts
  const headerHeight = insets.top + 50;
  const bottomNavHeight = 0; // No bottom nav in this screen
  const availableHeight = screenHeight - headerHeight - bottomNavHeight;

  const LIMIT = 20;

  const loadPosts = useCallback(async (page = 1, refresh = false) => {
    try {
      if (refresh) {
        setRefreshing(true);
        setCurrentPage(1);
        setHasMore(true);
      } else if (page === 1) {
        setLoading(true);
      } else {
        setLoadingMore(true);
      }
      
      const postStatus = status || 'active';
      const isOwnProfile = user && user.id === userId;
      
      let response;
      let postsArray: Post[] = [];
      
      if (isOwnProfile) {
        // Use getOwnPosts for current user's posts (has full data including media URLs)
        response = await userApi.getOwnPosts();
        if (response.status === 'success' && response.data?.posts) {
          let allPosts = response.data.posts || [];
          // Filter by status
          if (postStatus === 'active') {
            // Show active posts (or legacy approved posts, or posts with no status default to active)
            postsArray = allPosts.filter((p: any) => 
              p.status === 'active' || 
              p.status === 'approved' || // Legacy support
              !p.status // Default to active
            );
          } else if (postStatus === 'draft') {
            postsArray = allPosts.filter((p: any) => p.status === 'draft');
          } else if (postStatus === 'suspended') {
            // Show suspended posts (or legacy rejected/reported posts)
            postsArray = allPosts.filter((p: any) => 
              p.status === 'suspended' || 
              p.status === 'rejected' || // Legacy support
              p.status === 'reported' // Legacy support
            );
          } else {
            // Legacy status support
            if (postStatus === 'approved') {
              postsArray = allPosts.filter((p: any) => p.status === 'approved' || !p.status);
            } else if (postStatus === 'pending') {
              postsArray = allPosts.filter((p: any) => p.status === 'pending');
            } else if (postStatus === 'rejected') {
              postsArray = allPosts.filter((p: any) => p.status === 'rejected');
            } else if (postStatus === 'reported') {
              postsArray = allPosts.filter((p: any) => p.status === 'reported');
            } else {
              postsArray = allPosts;
            }
          }
        }
      } else {
        // Use getUserPosts for other users' posts
        response = await userApi.getUserPosts(userId, page, LIMIT, postStatus as string);
        if (response.status === 'success') {
          const postsData = response.data?.posts || response.data || [];
          postsArray = Array.isArray(postsData) ? postsData : [];
        }
      }
      
      // Log posts structure for debugging
      if (__DEV__) {
        console.log('📥 [ProfileFeed fetchPosts] API Response:', {
          status: response?.status,
          isOwnProfile,
          postStatus,
          postsCount: postsArray.length,
          firstPost: postsArray[0] ? {
            id: postsArray[0].id,
            type: postsArray[0].type,
            video_url: postsArray[0].video_url,
            image: postsArray[0].image,
            imageUrl: postsArray[0].imageUrl,
            fullUrl: (postsArray[0] as any).fullUrl,
            allKeys: Object.keys(postsArray[0]),
          } : null,
          samplePost: postsArray[0],
        });
      }
      
      if (response?.status === 'success' && postsArray.length >= 0) {
        const pagination = response.data?.pagination || {};
        const hasMoreData = pagination.hasNextPage !== false && postsArray.length === LIMIT;
        setHasMore(hasMoreData);
        
        // Update like counts in Redux
        const likeCountsMap: Record<string, number> = {};
        postsArray.forEach((post: Post) => {
          if (post.likes !== undefined) {
            likeCountsMap[post.id] = post.likes;
          }
        });
        if (Object.keys(likeCountsMap).length > 0) {
          dispatch(setPostLikeCounts(likeCountsMap));
        }
        
        // Sync liked posts from server if user is logged in
        if (user && postsArray.length > 0) {
          const postIds = postsArray.map((p: Post) => p.id);
          syncLikedPostsFromServer(postIds).catch(console.error);
        }
        
        // Prefetch video URLs for instant playback (Expo AV handles caching automatically)
        if (postsArray.length > 0 && (page === 1 || refresh)) {
          const videoPosts = postsArray
            .filter(p => (p.type === 'video' || p.video_url) && getMediaUrl(p))
            .slice(0, 3); // Prefetch first 3 videos
          
          // Videos will be cached automatically when loaded by Expo AV
          // The cache headers in source will ensure proper caching
        }
        
        if (page === 1 || refresh) {
          // Ensure posts are in correct order (newest first typically)
          const sortedPosts = [...postsArray].sort((a, b) => {
            const dateA = new Date(a.createdAt || a.uploadDate || 0).getTime();
            const dateB = new Date(b.createdAt || b.uploadDate || 0).getTime();
            return dateB - dateA; // Newest first
          });
          
          setPosts(sortedPosts);
          
          // Get username from first post
          if (sortedPosts.length > 0 && sortedPosts[0].user?.username) {
            setUsername(sortedPosts[0].user.username);
          }
          
          // Scroll to initial post if provided
          if (initialPostId && !initialScrollDone) {
            const initialIndex = sortedPosts.findIndex((p: Post) => p.id === initialPostId);
            if (initialIndex >= 0) {
              setTimeout(() => {
                flatListRef.current?.scrollToIndex({ index: initialIndex, animated: false });
                setCurrentIndex(initialIndex);
                setInitialScrollDone(true);
              }, 100);
            } else {
              setInitialScrollDone(true);
            }
          } else {
            setInitialScrollDone(true);
          }
        } else {
          // Deduplicate when appending
          setPosts(prev => {
            const existingIds = new Set(prev.map(p => p.id));
            const newPosts = postsArray.filter(p => p.id && !existingIds.has(p.id));
            return [...prev, ...newPosts];
          });
        }
      } else {
        if (page === 1) {
          setPosts([]);
        }
        setHasMore(false);
      }
    } catch (error: any) {
      console.error('Error loading posts:', error);
      if (page === 1) {
        setPosts([]);
      }
      setHasMore(false);
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, [userId, status, user, dispatch, syncLikedPostsFromServer, initialPostId, initialScrollDone]);

  const loadMorePosts = useCallback(() => {
    if (!loadingMore && hasMore && !loading) {
      const nextPage = currentPage + 1;
      setCurrentPage(nextPage);
      loadPosts(nextPage, false);
    }
  }, [loadPosts, loadingMore, hasMore, loading, currentPage]);

  useEffect(() => {
    if (userId) {
      loadPosts(1, false);
    }
  }, [userId, status]);

  // Track current index with ref to avoid infinite loops
  const currentIndexRef = useRef(0);
  
  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  useFocusEffect(
    useCallback(() => {
      setIsScreenFocused(true);
      if (lastActiveIndexRef.current >= 0) {
        setCurrentIndex(lastActiveIndexRef.current);
      }
      return () => {
        // Use ref to avoid dependency issues
        setIsScreenFocused(false);
        lastActiveIndexRef.current = currentIndexRef.current;
        pauseAllVideosExcept(null);
      };
    }, []) // Empty dependency array - only run on focus/blur
  );

  const onRefresh = () => {
    setCurrentPage(1);
    setHasMore(true);
    setInitialScrollDone(false);
    loadPosts(1, true);
  };

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

    await likesManager.toggleLike(postId);
    
    const newLikeCount = likesManager.getLikeCount(postId);
    setPosts(prevPosts => 
      prevPosts.map(post => 
        post.id === postId 
          ? { ...post, likes: newLikeCount }
          : post
      )
    );
  };

  const handleComment = useCallback((postId: string) => {
    if (!postId) return;
    
    const post = posts.find(p => p.id === postId);
    setCommentsPostId(postId);
    setCommentsPostTitle(post?.title || post?.description || '');
    setCommentsPostAuthor(post?.user?.username || '');
    setCommentsModalVisible(true);
  }, [posts]);

  const handleShare = async (postId: string) => {
    const post = posts.find(p => p.id === postId);
    if (post) {
      try {
        const mediaUrl = getMediaUrl(post);
        await Share.share({
          message: mediaUrl || post.caption || 'Check out this post on Talynk!',
          title: 'Check out this post on Talynk!',
          url: mediaUrl || undefined,
        });
      } catch (error) {
        // Silently handle share errors
      }
    }
  };

  const handleReport = (postId: string) => {
    if (!user) {
      router.push('/auth/login');
      return;
    }
    setReportPostId(postId);
    setReportModalVisible(true);
  };

  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    if (viewableItems.length > 0) {
      const visibleItem = viewableItems[0];
      const newIndex = visibleItem.index || 0;
      const postId = visibleItem.item?.id;
      
      if (postId) {
        likesManager.onPostVisible(postId);
      }
      
      if (activeVideoRef.current) {
        pauseAllVideosExcept(null);
      }
      setCurrentIndex(newIndex);
      lastActiveIndexRef.current = newIndex;
    } else {
      pauseAllVideosExcept(null);
      setCurrentIndex(-1);
    }
  }).current;

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 50,
    minimumViewTime: 100,
  }).current;

  if (loading && posts.length === 0) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#60a5fa" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" translucent />
      
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <TouchableOpacity 
          style={styles.backButton}
          onPress={() => router.back()}
          accessibilityLabel="Go back"
          accessibilityRole="button"
        >
          <Feather name="arrow-left" size={24} color="#fff" />
        </TouchableOpacity>
        
        <Text style={styles.headerTitle}>
          {username ? `@${username}'s Posts` : 'Posts'}
        </Text>
        
        <View style={styles.headerSpacer} />
      </View>

      <MuteContext.Provider value={{ isMuted, setIsMuted }}>
        <FlatList
          ref={flatListRef}
          data={posts}
          renderItem={({ item, index }) => (
            <PostItem
              item={item}
              index={index}
              onLike={handleLike}
              onComment={handleComment}
              onShare={handleShare}
              onReport={handleReport}
              isLiked={likedPosts.includes(item.id)}
              isActive={isScreenFocused && currentIndex === index}
              availableHeight={availableHeight}
            />
          )}
          keyExtractor={(item, index) => {
            // Ensure unique keys - use id if available, fallback to index
            return item.id ? `post-${item.id}` : `post-${index}`;
          }}
          pagingEnabled
          showsVerticalScrollIndicator={false}
          snapToInterval={availableHeight}
          snapToAlignment="start"
          decelerationRate="fast"
          contentContainerStyle={{ paddingBottom: 0 }}
          windowSize={2}
          initialNumToRender={1}
          maxToRenderPerBatch={1}
          updateCellsBatchingPeriod={100}
          removeClippedSubviews={true}
          getItemLayout={(data, index) => ({
            length: availableHeight,
            offset: availableHeight * index,
            index,
          })}
          extraData={posts.length}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#60a5fa"
              progressViewOffset={20}
            />
          }
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          onEndReached={loadMorePosts}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            loadingMore ? (
              <View style={[styles.loadingMore, { height: availableHeight * 0.2 }]}>
                <ActivityIndicator size="small" color="#60a5fa" />
              </View>
            ) : null
          }
          ListEmptyComponent={
            !loading ? (
              <View style={[styles.emptyContainer, { height: availableHeight }]}>
                <Feather name="video-off" size={64} color="#666" />
                <Text style={styles.emptyText}>No posts to show</Text>
              </View>
            ) : null
          }
          onScrollToIndexFailed={(info) => {
            setTimeout(() => {
              flatListRef.current?.scrollToIndex({ 
                index: Math.min(info.index, posts.length - 1), 
                animated: false 
              });
            }, 100);
          }}
        />
      </MuteContext.Provider>

      {/* Report Modal */}
      <ReportModal
        isVisible={reportModalVisible}
        postId={reportPostId}
        onClose={() => {
          setReportModalVisible(false);
          setReportPostId(null);
        }}
        onReported={() => {
          setReportModalVisible(false);
          setReportPostId(null);
        }}
      />

      {/* Comments Modal */}
      <CommentsModal
        visible={commentsModalVisible}
        postId={commentsPostId || ''}
        postTitle={commentsPostTitle}
        postAuthor={commentsPostAuthor}
        onClose={() => {
          setCommentsModalVisible(false);
          setCommentsPostId(null);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    zIndex: 100,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  headerSpacer: {
    width: 40,
  },
  postContainer: {
    width: screenWidth,
    backgroundColor: '#000',
  },
  mediaContainer: {
    width: screenWidth,
    position: 'relative',
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  mediaWrapper: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
  },
  media: {
    width: '100%',
    height: '100%',
    backgroundColor: '#000',
  },
  placeholderContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
  },
  placeholderText: {
    color: '#666',
    marginTop: 8,
    fontSize: 14,
  },
  playIconOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  playIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingLeft: 4,
  },
  muteIndicator: {
    position: 'absolute',
    top: 80,
    right: 16,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 20,
    padding: 8,
  },
  progressBarContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 3,
    zIndex: 15,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#fff',
  },
  heartOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionsContainer: {
    position: 'absolute',
    right: 12,
    bottom: 100,
    alignItems: 'center',
    gap: 20,
    zIndex: 10,
  },
  avatarContainer: {
    marginBottom: 8,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: '#fff',
  },
  actionButton: {
    alignItems: 'center',
    gap: 4,
  },
  actionText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '500',
  },
  bottomInfo: {
    position: 'absolute',
    left: 12,
    right: 80,
    bottom: 0,
    zIndex: 10,
    paddingBottom: 8,
    maxHeight: '40%', // Ensure it doesn't take too much space
  },
  bottomInfoContent: {
    marginBottom: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    borderRadius: 12,
    padding: 12,
    maxWidth: '100%',
  },
  username: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  caption: {
    color: '#fff',
    fontSize: 14,
    lineHeight: 20,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  showMoreText: {
    color: '#aaa',
    fontSize: 14,
    marginTop: 4,
  },
  timestamp: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 11,
    marginTop: 4,
    textShadowColor: 'rgba(0, 0, 0, 0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  categoryBadge: {
    backgroundColor: 'rgba(96, 165, 250, 0.8)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    alignSelf: 'flex-start',
    marginTop: 4,
    marginBottom: 8,
  },
  categoryText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '500',
  },
  loadingMore: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyText: {
    color: '#666',
    fontSize: 18,
    marginTop: 16,
    textAlign: 'center',
  },
});

