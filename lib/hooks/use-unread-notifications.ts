import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../auth-context';
import { useRealtime } from '../realtime-context';
import { notificationsApi } from '../api';
import { Notification } from '@/types';
import { frontendNotifications } from '../frontend-notifications';
import { localNotificationEvents } from '../local-notification-events';
import * as Notifications from 'expo-notifications';

/**
 * Hook to track unread notification count
 * Updates in real-time when new notifications arrive
 */
export const useUnreadNotifications = () => {
  const { user } = useAuth();
  const { onNewNotification } = useRealtime();
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  // Fetch initial unread count
  const fetchUnreadCount = useCallback(async () => {
    if (!user) {
      setUnreadCount(0);
      setLoading(false);
      return;
    }

    try {
      const [response, localUnread] = await Promise.all([
        notificationsApi.getAll(),
        frontendNotifications.getUnreadCount(user.id),
      ]);
      if (response.status === 'success' && response.data?.notifications) {
        const notifications = response.data.notifications as Notification[];
        const unread = notifications.filter(n => !n.isRead).length;
        setUnreadCount(unread + localUnread);
      } else {
        setUnreadCount(localUnread);
      }
    } catch (error) {
      // Silently handle errors - don't log 401 errors (expected when not authenticated)
      setUnreadCount(0);
    } finally {
      setLoading(false);
    }
  }, [user]);

  // Fetch on mount and when user changes
  useEffect(() => {
    fetchUnreadCount();
  }, [fetchUnreadCount]);

  // Listen to real-time notifications — only count notifications destined for current user
  useEffect(() => {
    if (!user) return;

    const unsubscribe = onNewNotification((update: any) => {
      const notification = update.notification;
      if (!notification) return;

      // Only increment if this notification is for the current user (backend may send recipientId / userId)
      const recipientId = update.recipientId ?? update.userId ?? update.userID ?? notification.recipientId ?? notification.userId ?? notification.userID;
      if (recipientId != null && recipientId !== user.id) return;

      if (!notification.isRead && !notification.is_read) {
        setUnreadCount(prev => prev + 1);
        
        // Trigger a local system notification popup
        const notificationTitle = getNotificationTitle(notification.type);
        Notifications.scheduleNotificationAsync({
          content: {
            title: notificationTitle,
            body: notification.message || 'You have a new notification',
            data: { 
              notificationId: notification.id,
              type: notification.type,
              url: getNotificationDeepLinkUrl(notification) 
            },
            sound: true,
          },
          trigger: null, // trigger immediately
        }).catch(err => console.warn('Failed to schedule local notification:', err));
      }
    });

    return unsubscribe;
  }, [onNewNotification, user]);

  // Helper to format a nice title for push notifications
  const getNotificationTitle = (type: string) => {
    switch (type) {
      case 'like': return 'New Like';
      case 'comment': return 'New Comment';
      case 'follow': return 'New Follower';
      case 'video_ready': return 'Video Ready';
      case 'post_approved': return 'Post Approved';
      case 'post_rejected': return 'Post Rejected';
      case 'post_flagged': return 'Post Flagged';
      case 'post_suspended': return 'Post Suspended';
      case 'appeal_approved': return 'Appeal Approved';
      case 'appeal_rejected': return 'Appeal Rejected';
      case 'report_reviewed': return 'Report Reviewed';
      default: return 'New Notification';
    }
  };

  // Helper to get fallback deep link url
  const getNotificationDeepLinkUrl = (notification: any) => {
    // In a real generic setup, you'd map types to expo-router deep link paths.
    // For now we just pass the data so a global handler could theoretically route it.
    const postId = notification.metadata?.postId || notification.related_post_id;
    if (postId) return `/post/${postId}`;
    const challengeId = notification.metadata?.challengeId;
    if (challengeId) return `/challenges/${challengeId}`;
    if (notification.related_user_id) return `/user/${notification.related_user_id}`;
    return '/(tabs)/notifications';
  };

  useEffect(() => {
    if (!user) return;
    return localNotificationEvents.onChanged(() => {
      fetchUnreadCount();
    });
  }, [fetchUnreadCount, user]);

  // Function to manually refresh count (useful when marking as read)
  const refreshCount = useCallback(() => {
    fetchUnreadCount();
  }, [fetchUnreadCount]);

  return {
    unreadCount,
    loading,
    refreshCount,
  };
};

