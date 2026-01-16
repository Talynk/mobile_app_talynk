import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
  Image,
} from 'react-native';
import { notificationsApi } from '@/lib/api';
import { router, useFocusEffect } from 'expo-router';
import { MaterialIcons, Feather } from '@expo/vector-icons';
import { useAuth } from '@/lib/auth-context';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRealtime } from '@/lib/realtime-context';
import { Notification } from '@/types';
import { useNotificationBadge } from '@/lib/notification-badge-context';

const NOTIFICATION_TABS = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
];

export default function NotificationsScreen() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState('all');
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const { isConnected, onNewNotification } = useRealtime();
  const { refreshCount } = useNotificationBadge();

  // Load notifications on mount and when screen is focused
  useFocusEffect(
    useCallback(() => {
      if (user) {
        loadNotifications();
        // Refresh badge count when screen is focused
        refreshCount();
      }
    }, [user, refreshCount])
  );

  // Subscribe to real-time notifications
  useEffect(() => {
    if (!user) return;

    const unsubscribe = onNewNotification((update) => {
      console.log('[Notifications] 🔔 Received real-time notification update:', {
        updateKeys: Object.keys(update),
        hasNotification: !!update.notification,
        rawUpdate: update,
      });
      
      // Handle both "newNotification" and "notification" event types
      // Per API docs: { userId, userID, notification: { id, type, message, isRead, createdAt, metadata } }
      const notificationData = update.notification || update;
      
      console.log('[Notifications] 📋 Processing notification data:', {
        id: notificationData.id,
        type: notificationData.type,
        message: notificationData.message?.substring(0, 50),
        hasMetadata: !!notificationData.metadata,
        metadata: notificationData.metadata,
      });
      
      const newNotification: Notification = {
        id: notificationData.id || Date.now(),
        userID: notificationData.userID || user.username || '',
        message: notificationData.message || notificationData.text || '',
        type: notificationData.type,
        isRead: notificationData.isRead || notificationData.is_read || false,
        createdAt: notificationData.createdAt || notificationData.created_at || new Date().toISOString(),
        metadata: notificationData.metadata || {},
        // Extract metadata fields to related_* for backward compatibility
        related_post_id: notificationData.metadata?.postId,
        related_user_id: notificationData.related_user_id,
      };
      
      console.log('[Notifications] ✨ Created notification object:', {
        id: newNotification.id,
        type: newNotification.type,
        isRead: newNotification.isRead,
        hasMetadata: Object.keys(newNotification.metadata || {}).length > 0,
        postId: newNotification.metadata?.postId || newNotification.related_post_id,
      });
      
      // Add to top of list, avoid duplicates
      setNotifications(prev => {
        const exists = prev.some(n => n.id === newNotification.id);
        if (exists) {
          console.log('[Notifications] ⚠️ Duplicate notification ignored:', newNotification.id);
          return prev;
        }
        console.log('[Notifications] ➕ Adding new notification to list. Total count:', prev.length + 1);
        return [newNotification, ...prev];
      });
    });

    return unsubscribe;
  }, [onNewNotification, user]);

  const loadNotifications = async () => {
    if (!user) return;
    
    try {
      console.log('[Notifications] 📥 Loading notifications for user:', user.username);
      setLoading(true);
      const response = await notificationsApi.getAll();
      
      console.log('[Notifications] 📦 API Response:', {
        status: response.status,
        notificationCount: response.data?.notifications?.length || 0,
      });
      
      if (response.status === 'success' && response.data?.notifications) {
        // Normalize notification structure (handle both old and new formats)
        const normalized = response.data.notifications.map((n: any) => ({
          id: n.id || n.notification_id,
          userID: n.userID || n.user_id || '',
          message: n.message || n.notification_text || '',
          type: n.type,
          isRead: n.isRead !== undefined ? n.isRead : (n.is_read !== undefined ? n.is_read : false),
          createdAt: n.createdAt || n.notification_date || n.created_at || new Date().toISOString(),
          metadata: n.metadata || {},
          // Extract metadata fields to related_* for backward compatibility
          related_post_id: n.related_post_id || n.metadata?.postId,
          related_user_id: n.related_user_id,
          related_user: n.related_user,
        }));
        
        console.log('[Notifications] ✅ Normalized notifications:', {
          count: normalized.length,
          unreadCount: normalized.filter(n => !n.isRead).length,
          types: normalized.map(n => n.type),
        });
        
        setNotifications(normalized);
      } else {
        console.warn('[Notifications] ⚠️ Unexpected response format:', response);
      }
    } catch (error) {
      console.error('[Notifications] ❌ Error loading notifications:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    loadNotifications();
  };

  const markAllAsRead = async () => {
    if (!user) return;
    
    try {
      console.log('[Notifications] 📝 Marking all notifications as read');
      const response = await notificationsApi.markAllAsRead();
      console.log('[Notifications] 📝 Mark all as read response:', {
        status: response.status,
        count: response.data?.count,
      });
      
      if (response.status === 'success') {
        setNotifications(prev => {
          const updated = prev.map(notification => ({ ...notification, isRead: true }));
          console.log('[Notifications] ✅ Marked all as read. Updated count:', updated.length);
          return updated;
        });
        // Refresh badge count
        refreshCount();
      }
    } catch (error) {
      console.error('[Notifications] ❌ Error marking all notifications as read:', error);
    }
  };

  const deleteNotification = async (notificationId: string) => {
    if (!user) return;
    
    try {
      console.log('[Notifications] 🗑️ Deleting notification:', notificationId);
      const response = await notificationsApi.delete(notificationId);
      console.log('[Notifications] 🗑️ Delete response:', response.status);
      
      if (response.status === 'success') {
        setNotifications(prev => {
          const filtered = prev.filter(n => n.id.toString() !== notificationId);
          console.log('[Notifications] ✅ Notification deleted. Remaining count:', filtered.length);
          return filtered;
        });
        // Refresh badge count
        refreshCount();
      }
    } catch (error) {
      console.error('[Notifications] ❌ Error deleting notification:', error);
    }
  };

  const deleteAllNotifications = async () => {
    if (!user) return;
    
    try {
      console.log('[Notifications] 🗑️ Deleting all notifications');
      const response = await notificationsApi.deleteAll();
      console.log('[Notifications] 🗑️ Delete all response:', {
        status: response.status,
        count: response.data?.count,
      });
      
      if (response.status === 'success') {
        setNotifications([]);
        console.log('[Notifications] ✅ All notifications deleted');
        // Refresh badge count
        refreshCount();
      }
    } catch (error) {
      console.error('[Notifications] ❌ Error deleting all notifications:', error);
    }
  };

  const getFilteredNotifications = () => {
    if (activeTab === 'unread') {
      return notifications.filter(n => !n.isRead);
    }
    return notifications;
  };

  const getNotificationIcon = (type?: string, message?: string) => {
    const lowerMessage = (message || '').toLowerCase();
    
    switch (type) {
      // Core notification types from API documentation
      case 'comment':
        return { name: 'chat-bubble', color: '#60a5fa', bg: 'rgba(96, 165, 250, 0.15)' };
      case 'like':
        return { name: 'favorite', color: '#ff2d55', bg: 'rgba(255, 45, 85, 0.15)' };
      case 'follow':
        return { name: 'person-add', color: '#10b981', bg: 'rgba(16, 185, 129, 0.15)' };
      
      // Challenge notification types
      case 'challenge_approved':
        return { name: 'check-circle', color: '#10b981', bg: 'rgba(16, 185, 129, 0.15)' };
      case 'challenge_rejected':
        return { name: 'cancel', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.15)' };
      
      // Post status notification types
      case 'post_status_update':
        return { name: 'info', color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.15)' };
      case 'post_approved':
        return { name: 'check-circle', color: '#10b981', bg: 'rgba(16, 185, 129, 0.15)' };
      case 'post_rejected':
        return { name: 'cancel', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.15)' };
      case 'post_review':
        return { name: 'gavel', color: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.15)' };
      case 'post_flagged':
        return { name: 'flag', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)' };
      case 'post_unfrozen':
        return { name: 'lock-open', color: '#10b981', bg: 'rgba(16, 185, 129, 0.15)' };
      case 'post_appeal':
        return { name: 'gavel', color: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.15)' };
      case 'appeal_approved':
        return { name: 'check-circle', color: '#10b981', bg: 'rgba(16, 185, 129, 0.15)' };
      case 'appeal_rejected':
        return { name: 'cancel', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.15)' };
      
      // View milestone notification
      case 'view_milestone':
        return { name: 'trending-up', color: '#fbbf24', bg: 'rgba(251, 191, 36, 0.15)' };
      
      // Comment report (admin only)
      case 'comment_report':
        return { name: 'report', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.15)' };
      
      // Legacy/other types
      case 'subscription':
        return { name: 'subscriptions', color: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.15)' };
      case 'post_featured':
        return { name: 'star', color: '#fbbf24', bg: 'rgba(251, 191, 36, 0.15)' };
      case 'broadcast':
        return { name: 'campaign', color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.15)' };
      
      default:
        // Fallback: check message content for like notifications
        if (lowerMessage.includes('liked')) {
          return { name: 'favorite', color: '#ff2d55', bg: 'rgba(255, 45, 85, 0.15)' };
        }
        return { name: 'notifications', color: '#666', bg: 'rgba(102, 102, 102, 0.15)' };
    }
  };

  const formatTimeAgo = (dateString: string) => {
    try {
      const now = new Date();
      const date = new Date(dateString);
      const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

      if (diffInSeconds < 60) return 'just now';
      const diffInMinutes = Math.floor(diffInSeconds / 60);
      if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
      const diffInHours = Math.floor(diffInMinutes / 60);
      if (diffInHours < 24) return `${diffInHours}h ago`;
      const diffInDays = Math.floor(diffInHours / 24);
      if (diffInDays < 7) return `${diffInDays}d ago`;
      return date.toLocaleDateString();
    } catch {
      return 'recently';
    }
  };

  const handleNotificationPress = (item: Notification) => {
    console.log('[Notifications] 👆 Notification pressed:', {
      id: item.id,
      type: item.type,
      isRead: item.isRead,
      metadata: item.metadata,
      related_post_id: item.related_post_id,
      related_user_id: item.related_user_id,
    });
    
    // Mark as read when pressed
    if (!item.isRead) {
      console.log('[Notifications] 📝 Marking notification as read:', item.id);
      notificationsApi.markAsRead(item.id.toString())
        .then((response) => {
          console.log('[Notifications] 📝 Mark as read response:', response.status);
        })
        .catch((error) => {
          console.error('[Notifications] ❌ Error marking as read:', error);
        });
      setNotifications(prev =>
        prev.map(n => n.id === item.id ? { ...n, isRead: true } : n)
      );
      refreshCount();
    }

    // Navigate based on notification type per NOTIFICATIONS_API_REVIEWED.md
    // Use metadata fields first, then fallback to related_* fields
    const postId = item.metadata?.postId || item.related_post_id;
    const challengeId = item.metadata?.challengeId;
    
    console.log('[Notifications] 🧭 Navigation data:', {
      type: item.type,
      postId,
      challengeId,
      related_user_id: item.related_user_id,
    });
    
    switch (item.type) {
      // Post-related notifications - navigate to post
      case 'comment':
      case 'like':
      case 'post_approved':
      case 'post_rejected':
      case 'post_status_update':
      case 'post_review':
      case 'view_milestone':
        if (postId) {
          router.push({
            pathname: '/post/[id]',
            params: { id: postId }
          });
        } else if (user?.id) {
          // Fallback to user profile if no post ID
          router.push({
            pathname: '/user/[id]',
            params: { id: user.id }
          });
        }
        break;
      
      // Post flagging/appeals - navigate to user's posts
      case 'post_flagged':
      case 'appeal_approved':
      case 'appeal_rejected':
      case 'post_unfrozen':
        if (user?.id) {
          router.push({
            pathname: '/user/[id]',
            params: { id: user.id }
          });
        }
        break;
      
      // Follow notifications - navigate to user profile
      case 'follow':
        if (item.related_user_id) {
          router.push({
            pathname: '/user/[id]',
            params: { id: item.related_user_id }
          });
        }
        break;
      
      // Challenge notifications - navigate to challenge
      case 'challenge_approved':
      case 'challenge_rejected':
        if (challengeId) {
          router.push({
            pathname: '/challenges/[id]',
            params: { id: challengeId }
          });
        }
        break;
      
      // Comment report (admin) - navigate to post
      case 'comment_report':
        if (postId) {
          router.push({
            pathname: '/post/[id]',
            params: { id: postId }
          });
        }
        break;
      
      default:
        // Default navigation based on available data
        if (postId) {
          router.push({
            pathname: '/post/[id]',
            params: { id: postId }
          });
        } else if (challengeId) {
          router.push({
            pathname: '/challenges/[id]',
            params: { id: challengeId }
          });
        } else if (item.related_user_id) {
          router.push({
            pathname: '/user/[id]',
            params: { id: item.related_user_id }
          });
        }
        break;
    }
  };

  const renderNotification = ({ item }: { item: Notification }) => {
    const icon = getNotificationIcon(item.type, item.message);
    
    return (
      <View
        style={[
          styles.notificationItem,
          !item.isRead && styles.notificationItemUnread
        ]}
      >
        <TouchableOpacity
          style={styles.notificationItemContent}
          onPress={() => handleNotificationPress(item)}
          activeOpacity={0.7}
        >
          <View style={[styles.notificationIcon, { backgroundColor: icon.bg }]}>
            <MaterialIcons name={icon.name as any} size={22} color={icon.color} />
          </View>
          
          <View style={styles.notificationContent}>
            <Text style={[
              styles.notificationText,
              !item.isRead && styles.notificationTextUnread
            ]}>
              {item.message}
            </Text>
            <Text style={styles.notificationTime}>
              {formatTimeAgo(item.createdAt)}
            </Text>
          </View>
          
          {!item.isRead && <View style={styles.unreadDot} />}
        </TouchableOpacity>
        
        <TouchableOpacity
          style={styles.deleteButton}
          onPress={() => deleteNotification(item.id.toString())}
          activeOpacity={0.7}
        >
          <Feather name="x" size={18} color="#999" />
        </TouchableOpacity>
      </View>
    );
  };

  if (!user) {
    return (
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <Text style={styles.headerTitle}>Notifications</Text>
        </View>
        
        <View style={styles.loginPrompt}>
          <View style={styles.loginIconContainer}>
            <Feather name="bell" size={48} color="#60a5fa" />
          </View>
          <Text style={styles.loginPromptTitle}>Stay in the loop</Text>
          <Text style={styles.loginPromptText}>
            Sign in to see your notifications
          </Text>
          <TouchableOpacity 
            style={styles.loginButton}
            onPress={() => router.push('/auth/login')}
            activeOpacity={0.8}
          >
            <Text style={styles.loginButtonText}>Sign In</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const unreadCount = notifications.filter(n => !n.isRead).length;
  const filteredNotifications = getFilteredNotifications();

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle}>Notifications</Text>
          {isConnected && (
            <View style={styles.connectedIndicator}>
              <View style={styles.connectedDot} />
            </View>
          )}
        </View>
        <View style={styles.headerActions}>
          {unreadCount > 0 && (
            <TouchableOpacity onPress={markAllAsRead} style={styles.markAllButton}>
              <Feather name="check-circle" size={14} color="#60a5fa" />
              <Text style={styles.markAllText}>Mark all read</Text>
            </TouchableOpacity>
          )}
          {notifications.length > 0 && (
            <TouchableOpacity onPress={deleteAllNotifications} style={styles.deleteAllButton}>
              <Feather name="trash-2" size={14} color="#ef4444" />
              <Text style={styles.deleteAllText}>Delete all</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Tabs */}
      <View style={styles.tabsContainer}>
        {NOTIFICATION_TABS.map((tab) => {
          const count = tab.key === 'unread' ? unreadCount : notifications.length;
          return (
            <TouchableOpacity
              key={tab.key}
              style={[
                styles.tab,
                activeTab === tab.key && styles.tabActive
              ]}
              onPress={() => setActiveTab(tab.key)}
              activeOpacity={0.7}
            >
              <Text style={[
                styles.tabText,
                activeTab === tab.key && styles.tabTextActive
              ]}>
                {tab.label}
              </Text>
              {count > 0 && (
                <View style={[
                  styles.tabBadge,
                  activeTab === tab.key && styles.tabBadgeActive
                ]}>
                  <Text style={[
                    styles.tabBadgeText,
                    activeTab === tab.key && styles.tabBadgeTextActive
                  ]}>{count}</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#60a5fa" />
          <Text style={styles.loadingText}>Loading notifications...</Text>
        </View>
      ) : (
        <FlatList
          data={filteredNotifications}
          renderItem={renderNotification}
          keyExtractor={(item) => item.id.toString()}
          refreshControl={
            <RefreshControl 
              refreshing={refreshing} 
              onRefresh={onRefresh} 
              tintColor="#60a5fa"
              colors={['#60a5fa']}
            />
          }
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconContainer}>
                <Feather 
                  name={activeTab === 'unread' ? 'check-circle' : 'bell'} 
                  size={48} 
                  color="#3b82f6" 
                />
              </View>
              <Text style={styles.emptyTitle}>
                {activeTab === 'unread' ? 'All caught up!' : 'No notifications yet'}
              </Text>
              <Text style={styles.emptySubtext}>
                {activeTab === 'unread' 
                  ? 'You\'ve read all your notifications'
                  : 'Notifications will appear here when you get activity'
                }
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  connectedIndicator: {
    padding: 4,
  },
  connectedDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10b981',
  },
  markAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(96, 165, 250, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(96, 165, 250, 0.2)',
  },
  markAllText: {
    color: '#60a5fa',
    fontSize: 13,
    fontWeight: '600',
  },
  tabsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    marginBottom: 8,
    gap: 10,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: '#1a1a1a',
    gap: 6,
  },
  tabActive: {
    backgroundColor: '#60a5fa',
  },
  tabText: {
    color: '#888',
    fontSize: 14,
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#000',
  },
  tabBadge: {
    backgroundColor: '#333',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    minWidth: 20,
    alignItems: 'center',
  },
  tabBadgeActive: {
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  tabBadgeText: {
    color: '#888',
    fontSize: 11,
    fontWeight: '600',
  },
  tabBadgeTextActive: {
    color: '#000',
  },
  listContent: {
    paddingBottom: 20,
  },
  notificationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  notificationItemUnread: {
    backgroundColor: 'rgba(96, 165, 250, 0.05)',
  },
  notificationItemContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  deleteButton: {
    padding: 8,
    marginLeft: 8,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  deleteAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.2)',
  },
  deleteAllText: {
    color: '#ef4444',
    fontSize: 13,
    fontWeight: '600',
  },
  notificationIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  notificationContent: {
    flex: 1,
  },
  notificationText: {
    color: '#ccc',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 4,
  },
  notificationTextUnread: {
    color: '#fff',
    fontWeight: '500',
  },
  notificationTime: {
    color: '#666',
    fontSize: 12,
  },
  unreadDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#60a5fa',
    marginLeft: 8,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    color: '#666',
    fontSize: 14,
  },
  loginPrompt: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  loginIconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(96, 165, 250, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  loginPromptTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 8,
  },
  loginPromptText: {
    color: '#888',
    fontSize: 15,
    marginBottom: 32,
    textAlign: 'center',
  },
  loginButton: {
    backgroundColor: '#60a5fa',
    paddingHorizontal: 40,
    paddingVertical: 14,
    borderRadius: 25,
  },
  loginButtonText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '700',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 80,
    paddingHorizontal: 40,
  },
  emptyIconContainer: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  emptyTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  emptySubtext: {
    color: '#888',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
});
