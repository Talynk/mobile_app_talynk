import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  useColorScheme,
  ActivityIndicator,
  ScrollView,
  Dimensions,
  Modal,
} from 'react-native';
import { formatDistanceToNow } from 'date-fns';
import { Surface, TextInput as PaperInput, Button, Divider } from 'react-native-paper';
import { Avatar } from './Avatar';

const { width: screenWidth } = Dimensions.get('window');

const COLORS = {
  dark: {
    background: '#000000',
    card: '#1a1a1a',
    border: '#2a2a2a',
    text: '#ffffff',
    textSecondary: '#8e8e93',
    textTertiary: '#666666',
    primary: '#0095f6',
    inputBg: '#1a1a1a',
    inputBorder: '#2a2a2a',
    inputText: '#ffffff',
    buttonBg: '#0095f6',
    buttonText: '#ffffff',
    spinner: '#0095f6',
    likeColor: '#ed4956',
  },
  light: {
    background: '#ffffff',
    card: '#ffffff',
    border: '#dbdbdb',
    text: '#262626',
    textSecondary: '#8e8e93',
    textTertiary: '#666666',
    primary: '#0095f6',
    inputBg: '#ffffff',
    inputBorder: '#dbdbdb',
    inputText: '#262626',
    buttonBg: '#0095f6',
    buttonText: '#ffffff',
    spinner: '#0095f6',
    likeColor: '#ed4956',
  },
};

interface Comment {
  id?: string;
  comment_id?: string;
  text?: string;
  comment_text?: string;
  user?: {
  id: string;
    name: string;
    avatar?: string;
    username?: string;
  };
  User?: {
    id: string;
    name: string;
    avatar?: string;
    username?: string;
  };
  created_at?: string;
  comment_date?: string;
}

interface CommentsOverlayProps {
  postId: string;
  isVisible: boolean;
  onClose: () => void;
  comments: Comment[];
  onAddComment: (text: string) => Promise<void>;
  loading?: boolean;
}

export default function CommentsOverlay({
  postId,
  isVisible,
  onClose,
  comments,
  onAddComment,
  loading = false,
}: CommentsOverlayProps) {
  const [newComment, setNewComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const colorScheme = useColorScheme() || 'dark';
  const C = COLORS[colorScheme];

  // --- Emoji bar ---
  const EMOJIS = ['❤️', '👏', '🔥', '😂', '😍', '😮', '👍', '🎉'];
  const handleEmoji = (emoji: string) => setNewComment((c) => c + emoji);

  const handleSubmitComment = async () => {
    if (!newComment.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onAddComment(newComment.trim());
      setNewComment('');
    } catch (error) {
      console.error('Error adding comment:', error);
    } finally {
      setSubmitting(false);
    }
  };

  function getRelativeTime(dateString?: string) {
    if (!dateString) return '';
    try {
      return formatDistanceToNow(new Date(dateString), { addSuffix: true });
    } catch {
      return 'recently';
    }
  }

  const renderComment = ({ item }: { item: any }) => {
    // Support both 'User' and 'user' fields for user info
    const commentUser = item.User || item.user || {};
    const commentText = item.comment_text || item.text || '';
    const commentDate = item.comment_date || item.created_at;
    
    return (
    <View style={styles.commentItem}>
      <Avatar
        user={commentUser}
        size={32}
        style={styles.commentAvatar}
      />
      <View style={styles.commentContent}>
        <View style={styles.commentHeader}>
          <Text style={[styles.commentUsername, { color: C.text }]}>
              {commentUser.name || commentUser.username || 'unknown'}
            </Text>
            <Text style={[styles.commentText, { color: C.text }]}>
              {' '}{commentText}
          </Text>
          </View>
          <View style={styles.commentFooter}>
          <Text style={[styles.commentDate, { color: C.textSecondary }]}>
              {getRelativeTime(commentDate)}
          </Text>
            <TouchableOpacity style={styles.commentAction}>
              <Text style={[styles.commentActionText, { color: C.textSecondary }]}>Reply</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.commentAction}>
              <Text style={[styles.commentActionText, { color: C.textSecondary }]}>Like</Text>
            </TouchableOpacity>
          </View>
      </View>
    </View>
  );
  };

  if (!isVisible) return null;

  return (
    <Modal
      visible={isVisible}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        {/* Blurred Background */}
        <View style={[styles.blurBackground, { backgroundColor: 'rgba(0, 0, 0, 0.6)' }]} />
        
        {/* Centered Modal Content */}
        <View style={styles.modalContainer}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        {/* Header */}
        <View style={[styles.header, { backgroundColor: C.card, borderBottomColor: C.border }]}>
          <View style={styles.headerContent}>
          <Text style={[styles.headerTitle, { color: C.text }]}>Comments</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Text style={[styles.closeButtonText, { color: C.text }]}>✕</Text>
          </TouchableOpacity>
          </View>
        </View>

        {/* Comments List */}
        <View style={styles.commentsContainer}>
          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={C.spinner} />
            </View>
          ) : (
            <FlatList
              data={comments}
              renderItem={renderComment}
              keyExtractor={(item, index) => 
                (item.comment_id ? item.comment_id.toString() :
                item.id ? item.id.toString() :
                `comment-${index}`)
              }
              showsVerticalScrollIndicator={false}
              ListEmptyComponent={
                <View style={styles.emptyContainer}>
                  <Text style={[styles.emptyText, { color: C.textSecondary }]}>No comments yet</Text>
                  <Text style={[styles.emptySubtext, { color: C.textTertiary }]}>Be the first to comment!</Text>
                </View>
              }
              contentContainerStyle={{ paddingBottom: 140 }}
              ItemSeparatorComponent={() => <Divider style={[styles.separator, { backgroundColor: C.border }]} />}
            />
          )}
        </View>

        {/* Input Section */}
        <View style={[styles.inputSection, { backgroundColor: C.card, borderTopColor: C.border }]}>
          {/* Emoji Bar */}
          <View style={[styles.emojiBar, { backgroundColor: C.card, borderBottomColor: C.border }]}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.emojiScroll}>
              {EMOJIS.map((emoji) => (
                <TouchableOpacity key={emoji} onPress={() => handleEmoji(emoji)} style={styles.emojiButton}>
                  <Text style={styles.emoji}>{emoji}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
        </View>

        {/* Comment Input */}
          <View style={styles.inputRow}>
            <View style={[styles.inputContainer, { backgroundColor: C.inputBg, borderColor: C.inputBorder }]}>
          <TextInput
                style={[styles.commentInput, { color: C.inputText }]}
            placeholder="Add a comment..."
            placeholderTextColor={C.textSecondary}
            value={newComment}
            onChangeText={setNewComment}
            multiline
            maxLength={500}
                textAlignVertical="center"
          />
            </View>
          <TouchableOpacity
              onPress={handleSubmitComment} 
              disabled={!newComment.trim() || submitting}
            style={[
              styles.sendButton,
                { 
                  backgroundColor: newComment.trim() && !submitting ? C.primary : C.textTertiary,
                  opacity: newComment.trim() && !submitting ? 1 : 0.5
                }
            ]}
          >
            {submitting ? (
              <ActivityIndicator size="small" color={C.buttonText} />
            ) : (
                <Text style={[styles.sendButtonText, { color: C.buttonText }]}>Post</Text>
            )}
          </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  blurBackground: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  modalContainer: {
    width: '90%',
    height: '80%',
    backgroundColor: 'transparent',
    borderRadius: 20,
    overflow: 'hidden',
  },
  container: {
    flex: 1,
    backgroundColor: '#1a1a1a',
    borderRadius: 20,
    overflow: 'hidden',
  },
  header: {
    borderBottomWidth: 0.5,
    paddingVertical: 16,
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  closeButton: {
    padding: 4,
  },
  closeButtonText: {
    fontSize: 20,
    fontWeight: '300',
  },
  commentsContainer: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  commentItem: {
    flexDirection: 'row',
    paddingHorizontal: 20,
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
  commentHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
  },
  commentUsername: {
    fontSize: 13,
    fontWeight: '600',
  },
  commentText: {
    fontSize: 13,
    lineHeight: 18,
    flex: 1,
  },
  commentFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  commentDate: {
    fontSize: 12,
    marginRight: 12,
  },
  commentAction: {
    marginRight: 12,
  },
  commentActionText: {
    fontSize: 12,
    fontWeight: '500',
  },
  separator: {
    height: 0.5,
    marginLeft: 64,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    textAlign: 'center',
  },
  inputSection: {
    borderTopWidth: 0.5,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
  },
  emojiBar: {
    borderBottomWidth: 0.5,
    paddingVertical: 8,
  },
  emojiScroll: {
    paddingHorizontal: 20,
  },
  emojiButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginRight: 4,
  },
  emoji: {
    fontSize: 20,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  inputContainer: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 20,
    marginRight: 12,
    minHeight: 36,
    maxHeight: 100,
  },
  commentInput: {
    fontSize: 14,
    paddingHorizontal: 16,
    paddingVertical: 8,
    textAlignVertical: 'center',
  },
  sendButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 18,
    minWidth: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
}); 