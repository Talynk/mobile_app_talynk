import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  FlatList,
  TextInput,
  Share,
  Modal,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Video, ResizeMode } from 'expo-av';
import { MaterialIcons, Feather } from '@expo/vector-icons';
import { postsApi, followsApi, likesApi } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useCache } from '@/lib/cache-context';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ReportModal from '@/components/ReportModal';
import { getPostMediaUrl, getProfilePictureUrl } from '@/lib/utils/file-url';
import { Avatar } from '@/components/Avatar';
import { useVideoMute } from '@/lib/hooks/use-video-mute';

const timeAgo = (dateString?: string | null) => {
  if (!dateString) return '';
  const now = new Date();
  const postDate = new Date(dateString);
  if (isNaN(postDate.getTime())) return '';

  const diffInSeconds = Math.floor((now.getTime() - postDate.getTime()) / 1000);
  if (diffInSeconds < 60) return `${diffInSeconds}s`;

  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) return `${diffInMinutes}m`;

  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) return `${diffInHours}h`;

  const diffInDays = Math.floor(diffInHours / 24);
  if (diffInDays < 7) return `${diffInDays}d`;

  return postDate.toLocaleDateString();
};

export default function PostDetailScreen() {
  const { id, postData } = useLocalSearchParams();
  const { user } = useAuth();
  const { likedPosts, followedUsers, updateLikedPosts, updateFollowedUsers } = useCache();
  const { isMuted, toggleMute } = useVideoMute();
  const videoRef = useRef<Video>(null);
  const insets = useSafeAreaInsets();

  // Try to parse postData if it was passed
  let initialPost = null;
  if (postData && typeof postData === 'string') {
    try {
      initialPost = JSON.parse(postData);
    } catch (e) {
      initialPost = null;
    }
  }

  const [post, setPost] = useState<any>(initialPost || null);
  const [loading, setLoading] = useState(!initialPost);
  const [comments, setComments] = useState<any[]>([]);
  const [commentText, setCommentText] = useState('');
  const [commentLoading, setCommentLoading] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [reportModalVisible, setReportModalVisible] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);

  useEffect(() => {
    // Only fetch if we don't have initialPost
    if (!initialPost) {
      fetchPost();
    }
    fetchComments();
  }, [id, initialPost]);

  const fetchPost = async () => {
    try {
      setLoading(true);
      const response = await postsApi.getById(id as string);

      // Log post structure for debugging
      if (__DEV__) {
        console.log('📥 [fetchPost] API Response:', {
          status: response.status,
          post: response.data ? {
            id: response.data.id,
            type: response.data.type,
            video_url: response.data.video_url,
            image: response.data.image,
            imageUrl: response.data.imageUrl,
            fullUrl: (response.data as any).fullUrl,
            allKeys: Object.keys(response.data),
          } : null,
          fullPost: response.data,
        });
      }

      if (response.status === 'success' && response.data) {
        setPost(response.data);
      }
    } catch (error) {
      console.error('Error fetching post:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchComments = async () => {
    try {
      const response = await postsApi.getComments(id as string);
      if (response.status === 'success' && response.data?.comments) {
        setComments(response.data.comments);
      } else {
        setComments([]);
      }
    } catch (error) {
      console.error('Error fetching comments:', error);
      setComments([]);
    }
  };

  const handleLike = async () => {
    if (!user) {
      router.push('/auth/login');
      return;
    }

    const isCurrentlyLiked = likedPosts.has(post.id);
    updateLikedPosts(post.id, !isCurrentlyLiked);

    try {
      const response = await likesApi.toggle(post.id);

      if (response.status === 'success' && response.data) {
        setPost((prev: any) => ({
          ...prev,
          likes: response.data.likeCount || (prev.likes || 0)
        }));
      } else {
        // Revert on error (unless it's post not found)
        const isPostNotFound = response.message?.includes('not found') || response.message?.includes('Post not found');
        if (!isPostNotFound) {
          updateLikedPosts(post.id, isCurrentlyLiked); // Revert
        }
      }
    } catch (error: any) {
      // Revert on error
      updateLikedPosts(post.id, isCurrentlyLiked);

      const isPostNotFound = error?.message?.includes('not found') || error?.message?.includes('Post not found');
      if (!isPostNotFound) {
        console.error('Like toggle error:', error);
      }
      updateLikedPosts(post.id, isCurrentlyLiked);
    }
  };

  const handleFollow = async () => {
    if (!user) {
      router.push('/auth/login');
      return;
    }

    const isCurrentlyFollowing = followedUsers.has(post.user?.id || '');
    setFollowLoading(true);

    try {
      const response = isCurrentlyFollowing
        ? await followsApi.unfollow(post.user.id)
        : await followsApi.follow(post.user.id);

      if (response.status === 'success') {
        updateFollowedUsers(post.user.id, !isCurrentlyFollowing);
      }
    } catch (error) {
      console.error('Follow error:', error);
    } finally {
      setFollowLoading(false);
    }
  };

  const handleAddComment = async () => {
    if (!user) {
      router.push('/auth/login');
      return;
    }

    if (!commentText.trim()) return;

    setCommentLoading(true);
    try {
      const response = await postsApi.addComment(id as string, commentText);
      if (response.status === 'success') {
        // Refresh comments after adding
        await fetchComments();
        setCommentText('');
      } else {
        Alert.alert('Error', response.message || 'Failed to add comment');
      }
    } catch (error) {
      console.error('Error adding comment:', error);
      Alert.alert('Error', 'Failed to add comment. Please try again.');
    } finally {
      setCommentLoading(false);
    }
  };

  const handleShare = async () => {
    try {
      await Share.share({
        message: post?.caption || '',
        url: getPostMediaUrl(post) || '',
        title: 'Check out this post on Talynk!'
      });
    } catch (error) {
      console.error('Share error:', error);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#60a5fa" />
      </View>
    );
  }

  if (!post) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>Post not found</Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Get media URL with fallbacks and validation
  const getMediaUrl = () => {
    return getPostMediaUrl(post);
  };

  const mediaUrl = getMediaUrl();
  const hasValidMedia = mediaUrl && mediaUrl.trim() !== '';
  const isVideo =
    post.type === 'video' ||
    (!!mediaUrl &&
      (mediaUrl.toLowerCase().includes('.mp4') ||
        mediaUrl.toLowerCase().includes('.mov') ||
        mediaUrl.toLowerCase().includes('.webm')));
  const isLiked = likedPosts.has(post.id);
  const isFollowing = followedUsers.has(post.user?.id || '');

  const handleVideoPress = () => {
    if (isVideo) {
      toggleMute();
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
    >
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBack}>
          <Feather name="arrow-left" size={24} color="#fff" />
        </TouchableOpacity>

        <View style={styles.headerUserInfo}>
          <Avatar
            user={post.user}
            size={32}
            style={styles.headerAvatar}
          />
          <Text style={styles.headerUsername}>@{post.user?.username || post.user?.name || 'unknown'}</Text>

          {user && user.id !== post.user?.id && (
            <TouchableOpacity
              style={[
                styles.followButton,
                { backgroundColor: isFollowing ? 'rgba(255,255,255,0.2)' : '#60a5fa' }
              ]}
              onPress={handleFollow}
              disabled={followLoading}
            >
              <Text style={[
                styles.followButtonText,
                { color: isFollowing ? '#fff' : '#000' }
              ]}>
                {followLoading ? '...' : (isFollowing ? 'Following' : 'Follow')}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.headerRight}>
          {/* Report Button - Directly visible */}
          {user && user.id !== post.user?.id && (
            <TouchableOpacity
              onPress={() => setReportModalVisible(true)}
              style={styles.reportButton}
            >
              <Feather name="flag" size={20} color="#ef4444" />
            </TouchableOpacity>
          )}

          {/* Menu Button */}
          <TouchableOpacity onPress={() => setMenuVisible(true)} style={styles.headerMenu}>
            <Feather name="more-vertical" size={24} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Media */}
      <View style={styles.mediaContainer}>
        {hasValidMedia ? (
          <View style={styles.mediaWrapper}>
            {isVideo ? (
              <TouchableOpacity
                activeOpacity={0.95}
                onPress={handleVideoPress}
                style={styles.videoTouchable}
              >
                <Video
                  ref={videoRef}
                  source={{ uri: mediaUrl! }}
                  style={styles.media}
                  resizeMode={ResizeMode.CONTAIN}
                  useNativeControls
                  shouldPlay={true}
                  isLooping={false}
                  isMuted={isMuted}
                  volume={isMuted ? 0 : 1}
                />

                {/* Mute indicator - click to toggle */}
                {isMuted && (
                  <View style={styles.muteIndicatorContainer}>
                    <View style={styles.muteIndicatorBadge}>
                      <Feather name="volume-x" size={24} color="rgba(255,255,255,0.8)" />
                    </View>
                  </View>
                )}
              </TouchableOpacity>
            ) : (
              <Image
                source={{ uri: mediaUrl! }}
                style={styles.media}
                resizeMode="contain"
                onError={() => {
                  console.error('[Post Detail] Failed to load image:', mediaUrl);
                }}
              />
            )}
          </View>
        ) : (
          <View style={styles.noMediaContainer}>
            <Feather name="image" size={48} color="#666" />
            <Text style={styles.noMediaText}>No media available</Text>
          </View>
        )}
      </View>

      {/* Actions Bar */}
      <View style={styles.actionsBar}>
        <TouchableOpacity style={styles.actionButton} onPress={handleLike}>
          <Feather
            name="heart"
            size={24}
            color={isLiked ? "#ff2d55" : "#fff"}
            fill={isLiked ? "#ff2d55" : "none"}
          />
          <Text style={styles.actionText}>{post.likes || 0}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionButton}>
          <Feather name="message-circle" size={24} color="#fff" />
          <Text style={styles.actionText}>{comments.length}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionButton} onPress={handleShare}>
          <Feather name="share-2" size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Post Info and Comments - Scrollable */}
      <ScrollView
        style={styles.scrollContent}
        contentContainerStyle={styles.scrollContentContainer}
        showsVerticalScrollIndicator={false}
      >
        {/* Caption - Show only once, prefer caption over description over content */}
        <View style={styles.captionContainer}>
          <Text style={styles.caption}>
            {post.caption || post.description || post.content || ''}
          </Text>
          {post.category && (
            <TouchableOpacity
              style={styles.categoryBadge}
              onPress={() => router.push({
                pathname: '/category/[name]',
                params: { name: typeof post.category === 'string' ? post.category : post.category.name }
              })}
            >
              <Text style={styles.categoryText}>
                #{typeof post.category === 'string' ? post.category : post.category.name}
              </Text>
            </TouchableOpacity>
          )}
          {(post.createdAt || post.uploadDate) && (
            <Text style={styles.postDate}>
              {timeAgo(post.createdAt || post.uploadDate)}
            </Text>
          )}
        </View>

        {/* Comments */}
        <View style={styles.commentsSection}>
          <Text style={styles.commentsTitle}>Comments</Text>

          {comments.length > 0 ? (
            comments.map((item, index) => (
              <View key={item.comment_id?.toString() || `comment-${index}`} style={styles.commentItem}>
                <Avatar
                  user={item.User || item.user}
                  size={32}
                  style={styles.commentAvatar}
                />
                <View style={styles.commentContent}>
                  <Text style={styles.commentUsername}>
                    {item.User?.name || item.User?.username || item.user?.name || item.user?.username || 'unknown'}
                  </Text>
                  <Text style={styles.commentText}>
                    {item.comment_text || item.content || item.comment || ''}
                  </Text>
                  <Text style={styles.commentDate}>
                    {item.comment_date || item.createdAt || item.created_at
                      ? new Date(item.comment_date || item.createdAt || item.created_at).toLocaleDateString()
                      : ''}
                  </Text>
                </View>
              </View>
            ))
          ) : (
            <Text style={styles.noComments}>No comments yet. Be the first to comment!</Text>
          )}
        </View>
      </ScrollView>

      {/* Comment Input */}
      <View style={[styles.commentInputContainer, { paddingBottom: insets.bottom + 12 }]}>
        <TextInput
          style={styles.commentInput}
          placeholder="Add a comment..."
          placeholderTextColor="#666"
          value={commentText}
          onChangeText={setCommentText}
          multiline
        />
        <TouchableOpacity
          onPress={handleAddComment}
          disabled={!commentText.trim() || commentLoading}
          style={[
            styles.sendButton,
            (!commentText.trim() || commentLoading) && styles.sendButtonDisabled
          ]}
        >
          {commentLoading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Feather name="send" size={20} color="#fff" />
          )}
        </TouchableOpacity>
      </View>

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
                handleShare();
              }}
            >
              <Feather name="share-2" size={20} color="#fff" />
              <Text style={styles.menuItemText}>Share</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setMenuVisible(false);
                setReportModalVisible(true);
              }}
            >
              <Feather name="flag" size={20} color="#fff" />
              <Text style={styles.menuItemText}>Report</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Report Modal */}
      <ReportModal
        isVisible={reportModalVisible}
        onClose={() => setReportModalVisible(false)}
        postId={post.id}
        onReported={() => {
          setReportModalVisible(false);
          Alert.alert('Reported', 'Thank you for reporting this content.');
        }}
      />
    </KeyboardAvoidingView>
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
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  errorText: {
    color: '#fff',
    fontSize: 18,
    marginBottom: 20,
  },
  backButton: {
    backgroundColor: '#60a5fa',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },
  backButtonText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '600',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: 'rgba(0,0,0,0.8)',
  },
  headerBack: {
    padding: 8,
    marginRight: 8,
  },
  headerUserInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  headerAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginRight: 8,
  },
  headerUsername: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginRight: 12,
  },
  followButton: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  followButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  reportButton: {
    padding: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  headerMenu: {
    padding: 8,
  },
  mediaContainer: {
    height: 400,
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
  videoTouchable: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  media: {
    width: '100%',
    height: '100%',
  },
  muteIndicatorContainer: {
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
  noMediaContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  noMediaText: {
    color: '#666',
    fontSize: 14,
    marginTop: 12,
  },
  actionsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#1a1a1a',
    gap: 20,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  actionText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  scrollContent: {
    flex: 1,
  },
  scrollContentContainer: {
    paddingBottom: 20,
  },
  captionContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#1a1a1a',
  },
  caption: {
    color: '#fff',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 8,
  },
  postDate: {
    color: '#666',
    fontSize: 12,
    marginTop: 8,
  },
  categoryBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#60a5fa',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  categoryText: {
    color: '#000',
    fontSize: 12,
    fontWeight: '600',
  },
  commentsSection: {
    backgroundColor: '#000',
    paddingBottom: 16,
  },
  commentsTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#333',
  },
  commentItem: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  commentAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginRight: 12,
  },
  commentContent: {
    flex: 1,
  },
  commentUsername: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
  },
  commentText: {
    color: '#fff',
    fontSize: 14,
    marginBottom: 4,
  },
  commentDate: {
    color: '#666',
    fontSize: 12,
  },
  noComments: {
    color: '#666',
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 40,
  },
  commentInputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#1a1a1a',
    borderTopWidth: 1,
    borderTopColor: '#333',
  },
  commentInput: {
    flex: 1,
    backgroundColor: '#333',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 14,
    maxHeight: 100,
    marginRight: 12,
  },
  sendButton: {
    backgroundColor: '#60a5fa',
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: '#333',
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
  menuItemText: {
    color: '#fff',
    fontSize: 16,
    marginLeft: 12,
  },
});