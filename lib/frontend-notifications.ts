import AsyncStorage from '@react-native-async-storage/async-storage';

import { Notification } from '@/types';
import { localNotificationEvents } from './local-notification-events';

type VideoReadyDestination = 'post' | 'draft' | 'challenge';

interface VideoReadyNotificationInput {
  userId: string;
  postId: string;
  destination: VideoReadyDestination;
  challengeId?: string;
  challengeName?: string;
}

interface ChallengeStatusNotificationInput {
  userId: string;
  challengeId: string;
  challengeName?: string;
  type: 'challenge_live' | 'challenge_schedule_updated';
  action?: string;
  startDate?: string;
  endDate?: string;
}

const storageKey = (userId: string) => `@frontend_notifications:${userId}`;

async function readNotifications(userId: string): Promise<Notification[]> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(userId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeNotifications(userId: string, notifications: Notification[]) {
  await AsyncStorage.setItem(storageKey(userId), JSON.stringify(notifications));
}

function buildVideoReadyMessage(input: VideoReadyNotificationInput): string {
  if (input.destination === 'draft') {
    return 'Your draft video is ready.';
  }

  if (input.challengeName) {
    return `Your competition post in ${input.challengeName} is ready.`;
  }

  return 'Your video is ready.';
}

function buildChallengeStatusMessage(input: ChallengeStatusNotificationInput): string {
  const challengeLabel = input.challengeName || 'A competition';

  if (input.type === 'challenge_live') {
    return `${challengeLabel} is live now. Started early by admin.`;
  }

  return `${challengeLabel} schedule was updated by admin.`;
}

export const frontendNotifications = {
  async getAll(userId: string): Promise<Notification[]> {
    const notifications = await readNotifications(userId);
    return [...notifications].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  },

  async getUnreadCount(userId: string): Promise<number> {
    const notifications = await readNotifications(userId);
    return notifications.filter((notification) => !notification.isRead).length;
  },

  async addVideoReadyNotification(input: VideoReadyNotificationInput): Promise<Notification> {
    const notifications = await readNotifications(input.userId);
    const existing = notifications.find(
      (notification) =>
        notification.type === 'video_ready' &&
        notification.metadata?.postId === input.postId
    );

    if (existing) {
      return existing;
    }

    const notification: Notification = {
      id: -Date.now(),
      userID: input.userId,
      message: buildVideoReadyMessage(input),
      type: 'video_ready',
      isRead: false,
      createdAt: new Date().toISOString(),
      metadata: {
        postId: input.postId,
        challengeId: input.challengeId,
        challengeName: input.challengeName,
        status: input.destination,
      },
      related_post_id: input.postId,
    };

    await writeNotifications(input.userId, [notification, ...notifications]);
    localNotificationEvents.emitChanged();
    return notification;
  },

  async addChallengeStatusNotification(input: ChallengeStatusNotificationInput): Promise<Notification> {
    const notifications = await readNotifications(input.userId);
    const message = buildChallengeStatusMessage(input);
    const existing = notifications.find(
      (notification) =>
        notification.type === input.type &&
        notification.metadata?.challengeId === input.challengeId &&
        notification.message === message &&
        notification.metadata?.action === input.action &&
        notification.metadata?.startDate === input.startDate &&
        notification.metadata?.endDate === input.endDate
    );

    if (existing) {
      return existing;
    }

    const notification: Notification = {
      id: -Date.now(),
      userID: input.userId,
      message,
      type: input.type,
      isRead: false,
      createdAt: new Date().toISOString(),
      metadata: {
        challengeId: input.challengeId,
        challengeName: input.challengeName,
        action: input.action,
        startDate: input.startDate,
        endDate: input.endDate,
      },
    };

    await writeNotifications(input.userId, [notification, ...notifications]);
    localNotificationEvents.emitChanged();
    return notification;
  },

  async markAsRead(userId: string, notificationId: number | string) {
    const notifications = await readNotifications(userId);
    const updated = notifications.map((notification) =>
      String(notification.id) === String(notificationId)
        ? { ...notification, isRead: true }
        : notification
    );
    await writeNotifications(userId, updated);
    localNotificationEvents.emitChanged();
  },

  async markAllAsRead(userId: string) {
    const notifications = await readNotifications(userId);
    const updated = notifications.map((notification) => ({ ...notification, isRead: true }));
    await writeNotifications(userId, updated);
    localNotificationEvents.emitChanged();
  },

  async delete(userId: string, notificationId: number | string) {
    const notifications = await readNotifications(userId);
    const updated = notifications.filter(
      (notification) => String(notification.id) !== String(notificationId)
    );
    await writeNotifications(userId, updated);
    localNotificationEvents.emitChanged();
  },

  async deleteAll(userId: string) {
    await writeNotifications(userId, []);
    localNotificationEvents.emitChanged();
  },
};
