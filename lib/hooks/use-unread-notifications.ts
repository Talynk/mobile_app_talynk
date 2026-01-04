import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../auth-context';
import { useRealtime } from '../realtime-context';
import { notificationsApi } from '../api';
import { Notification } from '@/types';

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
      const response = await notificationsApi.getAll();
      if (response.status === 'success' && response.data?.notifications) {
        const notifications = response.data.notifications as Notification[];
        const unread = notifications.filter(n => !n.isRead).length;
        setUnreadCount(unread);
      }
    } catch (error) {
      console.error('Error fetching unread notifications:', error);
    } finally {
      setLoading(false);
    }
  }, [user]);

  // Fetch on mount and when user changes
  useEffect(() => {
    fetchUnreadCount();
  }, [fetchUnreadCount]);

  // Listen to real-time notifications
  useEffect(() => {
    if (!user) return;

    const unsubscribe = onNewNotification((update) => {
      const notification = update.notification;
      
      // Only increment if notification is unread
      if (!notification.isRead && !notification.is_read) {
        setUnreadCount(prev => prev + 1);
      }
    });

    return unsubscribe;
  }, [onNewNotification, user]);

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


