import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  FlatList,
  TextInput,
  Modal,
  Alert,
  Platform,
  Animated,
  Dimensions,
  Keyboard,
  Pressable,
  ActionSheetIOS,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { postsApi } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Avatar } from './Avatar';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const MODAL_HEIGHT = SCREEN_HEIGHT * 0.7;

interface Comment {
  id?: string;
  comment_id?: string;
  commentor_id?: string;
  content?: string;
  comment_text?: string;
  createdAt?: string;
  created_at?: string;
  comment_date?: string;
  user?: {
    id: string;
    username?: string;
    name?: string;
    profile_picture?: string;
    avatar?: string;
  };
  User?: {
    id: string;
    username?: string;
    name?: string;
    profile_picture?: string;
    avatar?: string;
  };
}

interface CommentsModalProps {
  visible: boolean;
  onClose: () => void;
  postId: string;
  postOwnerId?: string;
  postTitle?: string;
  postAuthor?: string;
  onCommentAdded?: () => void;
  onCommentDeleted?: () => void;
}

const formatTimeAgo = (dateString: string): string => {
  const date = new Date(dateString);
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffInSeconds < 60) return 'now';
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m`;
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h`;
  if (diffInSeconds < 2592000) return `${Math.floor(diffInSeconds / 86400)}d`;
  return `${Math.floor(diffInSeconds / 2592000)}mo`;
};

const REPORT_REASONS = [
  'Spam',
  'Harassment or bullying',
  'Hate speech',
  'Inappropriate content',
  'Misinformation',
  'Other',
];

export default function CommentsModal({ 
  visible, 
  onClose, 
  postId, 
  postOwnerId,
  postTitle, 
  postAuthor,
  onCommentAdded,
  onCommentDeleted,
}: CommentsModalProps) {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [commentText, setCommentText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [selectedComment, setSelectedComment] = useState<Comment | null>(null);
  const [showOptionsModal, setShowOptionsModal] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [reportDescription, setReportDescription] = useState('');
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const inputRef = useRef<TextInput>(null);
  const isMounted = useRef(true);
  const isFetchingRef = useRef(false);
  
  // Animation values
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const keyboardAnim = useRef(new Animated.Value(0)).current;

  // Track mount status
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  // Keyboard listeners - animate the bottom position
  useEffect(() => {
    const keyboardWillShow = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (e) => {
        if (isMounted.current) {
          setKeyboardHeight(e.endCoordinates.height);
          Animated.timing(keyboardAnim, {
            toValue: e.endCoordinates.height,
            duration: Platform.OS === 'ios' ? e.duration : 200,
            useNativeDriver: false,
          }).start();
        }
      }
    );
    const keyboardWillHide = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      (e) => {
        if (isMounted.current) {
          setKeyboardHeight(0);
          Animated.timing(keyboardAnim, {
            toValue: 0,
            duration: Platform.OS === 'ios' ? (e?.duration || 200) : 200,
            useNativeDriver: false,
          }).start();
        }
      }
    );

    return () => {
      keyboardWillShow.remove();
      keyboardWillHide.remove();
    };
  }, []);

  const fetchComments = useCallback(async (page = 1, isInitial = false) => {
    if (!postId || !isMounted.current) return;
    
    // Prevent duplicate fetches with ref
    if (isFetchingRef.current) {
      return;
    }
    
    isFetchingRef.current = true;
    
    try {
      if (isInitial) {
        setLoading(true);
      } else {
        setLoadingMore(true);
      }
      setError(null);
      
      const response = await postsApi.getComments(postId, page, 20);
      
      if (!isMounted.current) return;
      
      if (response.status === 'success') {
        // Handle different response structures
        let newComments: any[] = [];
        
        if (response.data?.comments) {
          newComments = Array.isArray(response.data.comments) ? response.data.comments : [];
        } else if (Array.isArray(response.data)) {
          newComments = response.data;
        }
        
        const pagination = response.data?.pagination || {};
        const currentPage = pagination.page || page;
        const totalPages = pagination.totalPages || 1;
        
        // Calculate hasMore correctly: if current page < total pages, or if we got a full page of results
        const hasMoreData = currentPage < totalPages || (newComments.length === 20 && totalPages > currentPage);
        setHasMore(hasMoreData);
        
        if (page === 1 || isInitial) {
          // Ensure we have valid comments array - don't filter, just validate structure
          setComments(newComments);
          console.log('[Comments] Set comments:', newComments.length);
        } else {
          // Deduplicate comments by ID
          setComments(prev => {
            const existingIds = new Set(prev.map(c => c.id || c.comment_id));
            const uniqueNew = newComments.filter(c => {
              const id = c.id || c.comment_id;
              return id && !existingIds.has(id);
            });
            const updated = [...prev, ...uniqueNew];
            console.log('[Comments] Updated comments:', updated.length);
            return updated;
          });
        }
      } else {
        if (page === 1) setComments([]);
        setHasMore(false);
      }
    } catch (error: any) {
      if (!isMounted.current) return;
      console.error('[Comments] Error fetching:', error);
      setError('Failed to load comments');
      if (page === 1) setComments([]);
      setHasMore(false);
    } finally {
      isFetchingRef.current = false;
      if (isMounted.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [postId]);

  // Handle visibility changes
  useEffect(() => {
    if (!isMounted.current) return;

    if (visible && postId) {
      slideAnim.setValue(SCREEN_HEIGHT);
      fadeAnim.setValue(0);
      keyboardAnim.setValue(0);
      
      Animated.parallel([
        Animated.spring(slideAnim, {
          toValue: 0,
          useNativeDriver: true,
          tension: 65,
          friction: 11,
        }),
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
      
      setCurrentPage(1);
      setHasMore(true);
      setError(null);
      // Only fetch if we have a postId and modal is opening
      if (postId) {
        fetchComments(1, true);
      }
    }
  }, [visible, postId]);

  // Reset state when modal closes
  useEffect(() => {
    if (!visible) {
      const timer = setTimeout(() => {
        if (isMounted.current) {
          setComments([]);
          setCurrentPage(1);
          setHasMore(true);
          setError(null);
          setCommentText('');
          setKeyboardHeight(0);
          setSelectedComment(null);
          setShowOptionsModal(false);
          setShowReportModal(false);
          setReportReason('');
          setReportDescription('');
        }
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [visible]);

  const handleClose = useCallback(() => {
    if (!isMounted.current) return;
    
    Keyboard.dismiss();
    
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: SCREEN_HEIGHT,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      if (isMounted.current) {
        onClose();
      }
    });
  }, [onClose, slideAnim, fadeAnim]);

  const loadMoreComments = () => {
    if (!loadingMore && hasMore && !loading) {
      const nextPage = currentPage + 1;
      setCurrentPage(nextPage);
      fetchComments(nextPage, false);
    }
  };

  const submitComment = async () => {
    const trimmedText = commentText.trim();
    
    if (!trimmedText) {
      Alert.alert('Error', 'Please enter a comment');
      return;
    }
    
    if (!user) {
      Alert.alert('Login Required', 'Please login to comment');
      return;
    }

    if (!postId) {
      Alert.alert('Error', 'Post ID is missing');
      return;
    }

    try {
      setSubmitting(true);
      const commentContent = trimmedText.replace(/\n{3,}/g, '\n\n').trim();
      
      const response = await postsApi.addComment(postId, commentContent);
      
      if (!isMounted.current) return;
      
      if (response.status === 'success') {
        let newComment = null;
        if (response.data?.comment) {
          newComment = Array.isArray(response.data.comment) 
            ? response.data.comment[0] 
            : response.data.comment;
        } else if (response.data) {
          newComment = Array.isArray(response.data) 
            ? response.data[0] 
            : response.data;
        }
        
        if (newComment) {
          if (!newComment.user && !newComment.User) {
            newComment.user = {
              id: user.id,
              username: user.username,
              profile_picture: user.profile_picture,
            };
          }
          if (!newComment.createdAt && !newComment.created_at && !newComment.comment_date) {
            newComment.comment_date = new Date().toISOString();
          }
          if (!newComment.commentor_id) {
            newComment.commentor_id = user.id;
          }
          
          setComments(prev => [newComment, ...prev]);
          setCommentText('');
          
          onCommentAdded?.();
          
          setTimeout(() => {
            if (isMounted.current) {
              flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
            }
          }, 100);
        } else {
          await fetchComments(1, true);
          setCommentText('');
          onCommentAdded?.();
        }
      } else {
        Alert.alert('Error', response.message || 'Failed to submit comment');
      }
    } catch (error: any) {
      console.error('Error submitting comment:', error);
      Alert.alert('Error', 'Failed to submit comment');
    } finally {
      if (isMounted.current) {
        setSubmitting(false);
      }
    }
  };

  const handleDeleteComment = async (comment: Comment) => {
    const commentId = comment.comment_id || comment.id;
    if (!commentId) {
      Alert.alert('Error', 'Cannot delete this comment');
      return;
    }

    Alert.alert(
      'Delete Comment',
      'Are you sure you want to delete this comment?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const response = await postsApi.deleteComment(commentId);
              
              if (response.status === 'success') {
                setComments(prev => prev.filter(c => 
                  (c.comment_id || c.id) !== commentId
                ));
                onCommentDeleted?.();
                Alert.alert('Success', 'Comment deleted');
              } else {
                Alert.alert('Error', response.message || 'Failed to delete comment');
              }
            } catch (error) {
              console.error('Delete comment error:', error);
              Alert.alert('Error', 'Failed to delete comment');
            }
          },
        },
      ]
    );
  };

  const handleReportComment = async () => {
    if (!selectedComment || !reportReason) {
      Alert.alert('Error', 'Please select a reason for reporting');
      return;
    }

    const commentId = selectedComment.comment_id || selectedComment.id;
    if (!commentId) {
      Alert.alert('Error', 'Cannot report this comment');
      return;
    }

    try {
      setReportSubmitting(true);
      const response = await postsApi.reportComment(
        commentId, 
        reportReason, 
        reportDescription.trim() || undefined
      );
      
      if (response.status === 'success') {
        setShowReportModal(false);
        setSelectedComment(null);
        setReportReason('');
        setReportDescription('');
        Alert.alert('Reported', 'Thank you for reporting this comment. We will review it shortly.');
      } else {
        Alert.alert('Error', response.message || 'Failed to report comment');
      }
    } catch (error) {
      console.error('Report comment error:', error);
      Alert.alert('Error', 'Failed to report comment');
    } finally {
      setReportSubmitting(false);
    }
  };

  const showCommentOptions = (comment: Comment) => {
    const commentUser = comment.user || comment.User || {};
    const commentUserId = comment.commentor_id || (commentUser as any).id;
    const isOwnComment = user?.id === commentUserId;
    const isPostOwner = user?.id === postOwnerId;
    const canDelete = isOwnComment || isPostOwner;

    setSelectedComment(comment);

    if (Platform.OS === 'ios') {
      const options = canDelete 
        ? ['Cancel', 'Delete Comment', 'Report Comment']
        : ['Cancel', 'Report Comment'];
      const destructiveButtonIndex = canDelete ? 1 : undefined;
      const cancelButtonIndex = 0;

      ActionSheetIOS.showActionSheetWithOptions(
        {
          options,
          destructiveButtonIndex,
          cancelButtonIndex,
        },
        (buttonIndex) => {
          if (canDelete) {
            if (buttonIndex === 1) {
              handleDeleteComment(comment);
            } else if (buttonIndex === 2) {
              setShowReportModal(true);
            }
          } else {
            if (buttonIndex === 1) {
              setShowReportModal(true);
            }
          }
        }
      );
    } else {
      setShowOptionsModal(true);
    }
  };

  const handleUserPress = (userId: string) => {
    handleClose();
    setTimeout(() => {
      router.push({
        pathname: '/user/[id]',
        params: { id: userId }
      });
    }, 300);
  };

  const handleLoginPress = () => {
    handleClose();
    setTimeout(() => {
      router.push('/auth/login');
    }, 300);
  };

  const renderComment = useCallback(({ item }: { item: Comment }) => {
    if (!item) {
      console.warn('[Comments] renderComment: item is null/undefined');
      return <View style={{ height: 1 }} />;
    }
    
    const commentUser = item.user || item.User || {};
    const commentContent = item.content || item.comment_text || '';
    const commentDate = item.createdAt || item.created_at || item.comment_date || '';
    const username = (commentUser as any).username || (commentUser as any).name || 'unknown';
    const userId = (commentUser as any).id;
    const commentUserId = item.commentor_id || userId;
    const isOwnComment = user?.id === commentUserId;
    
    return (
      <View style={styles.commentItem}>
        <TouchableOpacity 
          onPress={() => userId && handleUserPress(userId)}
          activeOpacity={0.7}
        >
          <Avatar
            user={commentUser}
            size={40}
            style={styles.commentAvatar}
          />
        </TouchableOpacity>
        <View style={styles.commentContent}>
          <Pressable 
            style={styles.commentBubble}
            onLongPress={() => user && showCommentOptions(item)}
            delayLongPress={300}
          >
            <View style={styles.commentHeader}>
              <TouchableOpacity onPress={() => userId && handleUserPress(userId)}>
                <Text style={styles.commentUsername}>@{username}</Text>
              </TouchableOpacity>
              {isOwnComment && (
                <View style={styles.ownerBadge}>
                  <Text style={styles.ownerBadgeText}>You</Text>
                </View>
              )}
              {commentDate && (
                <Text style={styles.commentTime}>• {formatTimeAgo(commentDate)}</Text>
              )}
            </View>
            <Text style={styles.commentText}>{commentContent}</Text>
          </Pressable>
          
          <View style={styles.commentActions}>
            <TouchableOpacity style={styles.commentActionButton} activeOpacity={0.6}>
              <Feather name="heart" size={14} color="#8e8e93" />
              <Text style={styles.commentActionText}>Like</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.commentActionButton} activeOpacity={0.6}>
              <Feather name="corner-up-left" size={14} color="#8e8e93" />
              <Text style={styles.commentActionText}>Reply</Text>
            </TouchableOpacity>
            {user && (
              <TouchableOpacity 
                style={styles.commentActionButton} 
                activeOpacity={0.6}
                onPress={() => showCommentOptions(item)}
              >
                <Feather name="more-horizontal" size={14} color="#8e8e93" />
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    );
  }, [user]);

  // Android Options Modal
  const renderOptionsModal = () => {
    if (!selectedComment) return null;
    
    const commentUser = selectedComment.user || selectedComment.User || {};
    const commentUserId = selectedComment.commentor_id || (commentUser as any).id;
    const isOwnComment = user?.id === commentUserId;
    const isPostOwner = user?.id === postOwnerId;
    const canDelete = isOwnComment || isPostOwner;

    return (
      <Modal
        visible={showOptionsModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowOptionsModal(false)}
      >
        <Pressable 
          style={styles.optionsOverlay}
          onPress={() => setShowOptionsModal(false)}
        >
          <View style={styles.optionsContainer}>
            <Text style={styles.optionsTitle}>Comment Options</Text>
            
            {canDelete && (
              <TouchableOpacity 
                style={styles.optionButton}
                onPress={() => {
                  setShowOptionsModal(false);
                  handleDeleteComment(selectedComment);
                }}
              >
                <Feather name="trash-2" size={20} color="#ef4444" />
                <Text style={[styles.optionText, styles.optionTextDanger]}>Delete Comment</Text>
              </TouchableOpacity>
            )}
            
            <TouchableOpacity 
              style={styles.optionButton}
              onPress={() => {
                setShowOptionsModal(false);
                setShowReportModal(true);
              }}
            >
              <Feather name="flag" size={20} color="#f59e0b" />
              <Text style={styles.optionText}>Report Comment</Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={[styles.optionButton, styles.optionButtonCancel]}
              onPress={() => setShowOptionsModal(false)}
            >
              <Text style={styles.optionTextCancel}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>
    );
  };

  // Report Modal
  const renderReportModal = () => (
    <Modal
      visible={showReportModal}
      transparent
      animationType="slide"
      onRequestClose={() => setShowReportModal(false)}
    >
      <View style={styles.reportOverlay}>
        <View style={styles.reportContainer}>
          <View style={styles.reportHeader}>
            <Text style={styles.reportTitle}>Report Comment</Text>
            <TouchableOpacity onPress={() => setShowReportModal(false)}>
              <Feather name="x" size={24} color="#fff" />
            </TouchableOpacity>
          </View>
          
          <Text style={styles.reportSubtitle}>Why are you reporting this comment?</Text>
          
          <View style={styles.reportReasons}>
            {REPORT_REASONS.map((reason) => (
              <TouchableOpacity
                key={reason}
                style={[
                  styles.reportReasonButton,
                  reportReason === reason && styles.reportReasonButtonActive
                ]}
                onPress={() => setReportReason(reason)}
              >
                <View style={[
                  styles.reportRadio,
                  reportReason === reason && styles.reportRadioActive
                ]}>
                  {reportReason === reason && (
                    <View style={styles.reportRadioInner} />
                  )}
                </View>
                <Text style={[
                  styles.reportReasonText,
                  reportReason === reason && styles.reportReasonTextActive
                ]}>
                  {reason}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          
          <Text style={styles.reportDescLabel}>Additional details (optional)</Text>
          <TextInput
            style={styles.reportDescInput}
            placeholder="Provide more context about the issue..."
            placeholderTextColor="#636366"
            value={reportDescription}
            onChangeText={setReportDescription}
            multiline
            maxLength={500}
          />
          
          <TouchableOpacity
            style={[
              styles.reportSubmitButton,
              (!reportReason || reportSubmitting) && styles.reportSubmitButtonDisabled
            ]}
            onPress={handleReportComment}
            disabled={!reportReason || reportSubmitting}
          >
            {reportSubmitting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.reportSubmitText}>Submit Report</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );

  if (!visible) {
    return null;
  }

  // Calculate dynamic modal height when keyboard is visible
  const isKeyboardVisible = keyboardHeight > 0;
  const availableHeight = isKeyboardVisible 
    ? SCREEN_HEIGHT - keyboardHeight - insets.top - 20
    : MODAL_HEIGHT;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={handleClose}
      statusBarTranslucent
    >
      <View style={styles.modalOverlay}>
        {/* Backdrop */}
        <Pressable style={styles.backdrop} onPress={handleClose}>
          <Animated.View 
            style={[
              StyleSheet.absoluteFill, 
              { opacity: fadeAnim, backgroundColor: 'rgba(0, 0, 0, 0.6)' }
            ]} 
          />
        </Pressable>
        
        {/* Modal Container - positioned at bottom with keyboard offset */}
        <Animated.View
          style={[
            styles.modalWrapper,
            {
              bottom: keyboardAnim,
            },
          ]}
        >
          <Animated.View
            style={[
              styles.modalContainer,
              {
                transform: [{ translateY: slideAnim }],
                maxHeight: availableHeight,
              },
            ]}
          >
            {/* Handle Bar */}
            <View style={styles.handleContainer}>
              <View style={styles.handle} />
            </View>

            {/* Header */}
            <View style={styles.header}>
              <View style={styles.headerLeft}>
                <Text style={styles.headerTitle}>Comments</Text>
                {comments.length > 0 && (
                  <View style={styles.commentCountBadge}>
                    <Text style={styles.commentCountText}>{comments.length}</Text>
                  </View>
                )}
              </View>
              <TouchableOpacity 
                onPress={handleClose} 
                style={styles.closeButton}
                hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
              >
                <View style={styles.closeButtonInner}>
                  <Feather name="x" size={18} color="#fff" />
                </View>
              </TouchableOpacity>
            </View>

            <View style={styles.divider} />

            {/* Comments List - takes available space */}
            <FlatList
              ref={flatListRef}
              data={comments}
              renderItem={renderComment}
              keyExtractor={(item, index) => {
                // Use id first (from API), then comment_id, then fallback to index
                const id = item.id || item.comment_id;
                const key = id ? id.toString() : `comment-${index}`;
                return key;
              }}
              style={styles.commentsList}
              contentContainerStyle={[
                styles.commentsContent,
                comments.length === 0 && !loading && !error && styles.commentsContentEmpty
              ]}
              showsVerticalScrollIndicator={true}
              onEndReached={loadMoreComments}
              onEndReachedThreshold={0.5}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
              removeClippedSubviews={false}
              extraData={comments}
              initialNumToRender={10}
              maxToRenderPerBatch={10}
              ListEmptyComponent={
                loading ? (
                  <View style={styles.centerContainer}>
                    <View style={styles.loadingSpinner}>
                      <ActivityIndicator size="large" color="#3b82f6" />
                    </View>
                    <Text style={styles.loadingText}>Loading comments...</Text>
                  </View>
                ) : error ? (
                  <View style={styles.centerContainer}>
                    <View style={styles.errorIcon}>
                      <Feather name="wifi-off" size={28} color="#ef4444" />
                    </View>
                    <Text style={styles.errorTitle}>Couldn't load comments</Text>
                    <Text style={styles.errorSubtext}>{error}</Text>
                    <TouchableOpacity 
                      style={styles.retryButton}
                      onPress={() => fetchComments(1, true)}
                      activeOpacity={0.8}
                    >
                      <Feather name="refresh-cw" size={14} color="#fff" />
                      <Text style={styles.retryButtonText}>Try Again</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={styles.centerContainer}>
                    <View style={styles.emptyIcon}>
                      <Feather name="message-circle" size={36} color="#3b82f6" />
                    </View>
                    <Text style={styles.emptyTitle}>No comments yet</Text>
                    <Text style={styles.emptySubtext}>Be the first to share your thoughts!</Text>
                  </View>
                )
              }
              ListFooterComponent={
                loadingMore ? (
                  <View style={styles.loadMoreContainer}>
                    <ActivityIndicator size="small" color="#3b82f6" />
                  </View>
                ) : null
              }
            />

            {/* Input Area - fixed at bottom of modal */}
            <View style={[
              styles.inputWrapper,
              { 
                paddingBottom: isKeyboardVisible ? 8 : Math.max(insets.bottom, 16)
              }
            ]}>
              {user ? (
                <View style={styles.inputContainer}>
                  <Avatar
                    user={user}
                    size={36}
                    style={styles.inputAvatar}
                  />
                  <View style={styles.inputFieldWrapper}>
                    <TextInput
                      ref={inputRef}
                      style={styles.commentInput}
                      placeholder="Write a comment..."
                      placeholderTextColor="#636366"
                      value={commentText}
                      onChangeText={setCommentText}
                      multiline
                      maxLength={500}
                      blurOnSubmit={false}
                      returnKeyType="default"
                      editable={!submitting}
                    />
                  </View>
                  <TouchableOpacity
                    style={[
                      styles.sendButton,
                      (!commentText.trim() || submitting) && styles.sendButtonDisabled
                    ]}
                    onPress={submitComment}
                    disabled={!commentText.trim() || submitting}
                    activeOpacity={0.7}
                  >
                    {submitting ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Feather 
                        name="send" 
                        size={18} 
                        color={commentText.trim() ? '#fff' : '#636366'} 
                      />
                    )}
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity 
                  style={styles.loginPrompt}
                  onPress={handleLoginPress}
                  activeOpacity={0.7}
                >
                  <View style={styles.loginPromptIcon}>
                    <Feather name="log-in" size={16} color="#3b82f6" />
                  </View>
                  <Text style={styles.loginText}>Sign in to comment</Text>
                  <Feather name="chevron-right" size={18} color="#3b82f6" />
                </TouchableOpacity>
              )}
              
              {commentText.length > 0 && (
                <View style={styles.charCountContainer}>
                  <Text style={[
                    styles.charCount,
                    commentText.length > 450 && styles.charCountWarning
                  ]}>
                    {commentText.length}/500
                  </Text>
                </View>
              )}
            </View>
          </Animated.View>
        </Animated.View>
      </View>

      {/* Android Options Modal */}
      {renderOptionsModal()}
      
      {/* Report Modal */}
      {renderReportModal()}
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  modalWrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  modalContainer: {
    backgroundColor: '#1a1a1c',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 24,
    flex: 1,
    minHeight: 400,
  },
  handleContainer: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 6,
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: '#48484a',
    borderRadius: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  commentCountBadge: {
    backgroundColor: '#3b82f6',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    minWidth: 24,
    alignItems: 'center',
  },
  commentCountText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  closeButton: {
    padding: 4,
  },
  closeButtonInner: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#2c2c2e',
    justifyContent: 'center',
    alignItems: 'center',
  },
  divider: {
    height: 1,
    backgroundColor: '#2c2c2e',
  },
  commentsList: {
    flex: 1,
  },
  commentsContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  commentsContentEmpty: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  commentItem: {
    flexDirection: 'row',
    marginBottom: 16,
    minHeight: 50,
  },
  commentAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    marginRight: 10,
    backgroundColor: '#2c2c2e',
  },
  commentContent: {
    flex: 1,
  },
  commentBubble: {
    backgroundColor: '#2c2c2e',
    borderRadius: 16,
    borderTopLeftRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  commentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    flexWrap: 'wrap',
    gap: 6,
  },
  commentUsername: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  ownerBadge: {
    backgroundColor: '#3b82f6',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  ownerBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '600',
  },
  commentTime: {
    color: '#636366',
    fontSize: 12,
  },
  commentText: {
    color: '#e5e5ea',
    fontSize: 14,
    lineHeight: 20,
  },
  commentActions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    marginLeft: 8,
    gap: 20,
  },
  commentActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 4,
  },
  commentActionText: {
    color: '#8e8e93',
    fontSize: 12,
    fontWeight: '500',
  },
  centerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 50,
    paddingHorizontal: 40,
  },
  loadingSpinner: {
    marginBottom: 12,
  },
  loadingText: {
    color: '#8e8e93',
    fontSize: 14,
  },
  errorIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  errorTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  errorSubtext: {
    color: '#8e8e93',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 16,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#3b82f6',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  emptyIcon: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: 'rgba(59, 130, 246, 0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 4,
  },
  emptySubtext: {
    color: '#8e8e93',
    fontSize: 14,
    textAlign: 'center',
  },
  loadMoreContainer: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  inputWrapper: {
    borderTopWidth: 1,
    borderTopColor: '#2c2c2e',
    backgroundColor: '#1a1a1c',
    paddingTop: 12,
    paddingHorizontal: 12,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
  },
  inputAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#2c2c2e',
    marginBottom: 3,
  },
  inputFieldWrapper: {
    flex: 1,
  },
  commentInput: {
    backgroundColor: '#2c2c2e',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#3c3c3e',
    paddingHorizontal: 14,
    paddingTop: Platform.OS === 'ios' ? 10 : 8,
    paddingBottom: Platform.OS === 'ios' ? 10 : 8,
    color: '#fff',
    fontSize: 15,
    maxHeight: 100,
    minHeight: 38,
  },
  sendButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#3b82f6',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 3,
  },
  sendButtonDisabled: {
    backgroundColor: '#2c2c2e',
  },
  charCountContainer: {
    alignItems: 'flex-end',
    paddingRight: 52,
    marginTop: 4,
  },
  charCount: {
    color: '#636366',
    fontSize: 11,
  },
  charCountWarning: {
    color: '#f59e0b',
  },
  loginPrompt: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(59, 130, 246, 0.08)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.2)',
  },
  loginPromptIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loginText: {
    color: '#3b82f6',
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
  },
  // Options Modal (Android)
  optionsOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  optionsContainer: {
    backgroundColor: '#1a1a1c',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 40,
  },
  optionsTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 20,
  },
  optionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 16,
    paddingHorizontal: 16,
    backgroundColor: '#2c2c2e',
    borderRadius: 12,
    marginBottom: 10,
  },
  optionButtonCancel: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#3c3c3e',
    justifyContent: 'center',
    marginTop: 10,
  },
  optionText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
  },
  optionTextDanger: {
    color: '#ef4444',
  },
  optionTextCancel: {
    color: '#8e8e93',
    fontSize: 16,
    fontWeight: '500',
  },
  // Report Modal
  reportOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  reportContainer: {
    backgroundColor: '#1a1a1c',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 40,
    maxHeight: SCREEN_HEIGHT * 0.8,
  },
  reportHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  reportTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
  },
  reportSubtitle: {
    color: '#8e8e93',
    fontSize: 14,
    marginBottom: 16,
  },
  reportReasons: {
    gap: 8,
    marginBottom: 20,
  },
  reportReasonButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: '#2c2c2e',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  reportReasonButtonActive: {
    borderColor: '#3b82f6',
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
  },
  reportRadio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#636366',
    justifyContent: 'center',
    alignItems: 'center',
  },
  reportRadioActive: {
    borderColor: '#3b82f6',
  },
  reportRadioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#3b82f6',
  },
  reportReasonText: {
    color: '#e5e5ea',
    fontSize: 15,
    flex: 1,
  },
  reportReasonTextActive: {
    color: '#fff',
    fontWeight: '500',
  },
  reportDescLabel: {
    color: '#8e8e93',
    fontSize: 13,
    marginBottom: 8,
  },
  reportDescInput: {
    backgroundColor: '#2c2c2e',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#3c3c3e',
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#fff',
    fontSize: 15,
    minHeight: 80,
    textAlignVertical: 'top',
    marginBottom: 20,
  },
  reportSubmitButton: {
    backgroundColor: '#ef4444',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  reportSubmitButtonDisabled: {
    backgroundColor: '#2c2c2e',
  },
  reportSubmitText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
