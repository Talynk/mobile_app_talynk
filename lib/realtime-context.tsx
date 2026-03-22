import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import { useAuth } from './auth-context';
import { useCache } from './cache-context';
import websocketService, {
  PostUpdate,
  CommentUpdate,
  NotificationUpdate,
  LikeUpdate,
  ChallengeLikesUpdate,
  ChallengeUpdatedEvent,
} from './websocket-service';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { authEventEmitter } from './auth-event-emitter';
import { getCachedJoinedChallenges } from './create-screen-cache';
import { frontendNotifications } from './frontend-notifications';

interface RealtimeContextType {
  isConnected: boolean;
  isAvailable: boolean; // Whether real-time features are supported
  subscribeToPost: (postId: string) => void;
  unsubscribeFromPost: (postId: string) => void;
  sendLikeAction: (postId: string, isLiked: boolean) => void;
  sendCommentAction: (postId: string, commentText: string) => void;
  sendFollowAction: (targetUserId: string, isFollowing: boolean) => void;
  onPostUpdate: (callback: (update: PostUpdate) => void) => () => void;
  onNewComment: (callback: (update: CommentUpdate) => void) => () => void;
  onNewNotification: (callback: (update: NotificationUpdate) => void) => () => void;
  onLikeUpdate: (callback: (update: LikeUpdate) => void) => () => void;
  onChallengeLikesUpdated: (callback: (update: ChallengeLikesUpdate) => void) => () => void;
}

const RealtimeContext = createContext<RealtimeContextType | undefined>(undefined);

export const useRealtime = () => {
  const context = useContext(RealtimeContext);
  if (!context) {
    // Return a dummy context for components that might use it outside provider
    return {
      isConnected: false,
      isAvailable: false,
      subscribeToPost: () => {},
      unsubscribeFromPost: () => {},
      sendLikeAction: () => {},
      sendCommentAction: () => {},
      sendFollowAction: () => {},
      onPostUpdate: () => () => {},
      onNewComment: () => () => {},
      onNewNotification: () => () => {},
      onLikeUpdate: () => () => {},
      onChallengeLikesUpdated: () => () => {},
    };
  }
  return context;
};

interface RealtimeProviderProps {
  children: React.ReactNode;
}

export const RealtimeProvider: React.FC<RealtimeProviderProps> = ({ children }) => {
  const { user, token } = useAuth();
  const { updateLikedPosts } = useCache();
  const [isConnected, setIsConnected] = useState(false);
  const [isAvailable, setIsAvailable] = useState(true);
  const subscribedPosts = useRef<Set<string>>(new Set());
  const postUpdateCallbacks = useRef<Set<(update: PostUpdate) => void>>(new Set());
  const commentCallbacks = useRef<Set<(update: CommentUpdate) => void>>(new Set());
  const notificationCallbacks = useRef<Set<(update: NotificationUpdate) => void>>(new Set());
  const likeUpdateCallbacks = useRef<Set<(update: LikeUpdate) => void>>(new Set());
  const challengeLikeCallbacks = useRef<Set<(update: ChallengeLikesUpdate) => void>>(new Set());

  useEffect(() => {
    const initWebSocket = async () => {
      if (user?.id) {
        // Get token from storage if not available (use correct storage key)
        let authToken = token;
        if (!authToken) {
          authToken = await AsyncStorage.getItem('talynk_token');
          console.log('[Realtime] Retrieved token from storage:', authToken ? 'success' : 'failed');
        }
        
        // Connect to WebSocket when user is authenticated
        if (authToken) {
          websocketService.connect(user.id, authToken);
          
          const handleConnected = () => {
            setIsConnected(true);
            setIsAvailable(true);
          };

          const handleDisconnected = () => {
            setIsConnected(false);
          };

          const handleDisabled = () => {
            // WebSocket is not available on this backend
            setIsConnected(false);
            setIsAvailable(false);
          };

          const handlePostUpdate = (update: PostUpdate) => {
            postUpdateCallbacks.current.forEach(callback => callback(update));
          };

          const handleNewComment = (update: CommentUpdate) => {
            commentCallbacks.current.forEach(callback => callback(update));
          };

          const handleNewNotification = (update: NotificationUpdate) => {
            console.log('[Realtime] 🔔 Handling new notification:', {
              hasNotification: !!update.notification,
              notificationId: update.notification?.id,
              notificationType: update.notification?.type,
              callbackCount: notificationCallbacks.current.size,
            });
            notificationCallbacks.current.forEach(callback => {
              try {
                callback(update);
              } catch (error) {
                console.error('[Realtime] ❌ Error in notification callback:', error);
              }
            });
          };

          const handleLikeUpdate = (update: LikeUpdate) => {
            // Update cache if it's for the current user
            if (update.userId === user.id) {
              updateLikedPosts(update.postId, update.isLiked);
            }
            likeUpdateCallbacks.current.forEach(callback => callback(update));
          };

          const handleChallengeLikesUpdated = (update: ChallengeLikesUpdate) => {
            challengeLikeCallbacks.current.forEach(callback => callback(update));
          };

          const handleChallengeUpdated = async (update: ChallengeUpdatedEvent) => {
            if (!user.id || !update?.challengeId) {
              return;
            }

            const joinedChallenges = (await getCachedJoinedChallenges<any[]>(user.id)) ?? [];
            const matchingChallenge = joinedChallenges.find(
              (challenge: any) => String(challenge?.id) === String(update.challengeId)
            );

            if (!matchingChallenge) {
              return;
            }

            const notificationType =
              update.action === 'start_now' || update.status === 'active'
                ? 'challenge_live'
                : 'challenge_schedule_updated';

            await frontendNotifications.addChallengeStatusNotification({
              userId: user.id,
              challengeId: String(update.challengeId),
              challengeName: matchingChallenge.name,
              type: notificationType,
              action: update.action,
              startDate: update.start_date,
              endDate: update.end_date,
            });
          };

          websocketService.on('connected', handleConnected);
          websocketService.on('disconnected', handleDisconnected);
          websocketService.on('disabled', handleDisabled);
          websocketService.on('postUpdate', handlePostUpdate);
          websocketService.on('newComment', handleNewComment);
          websocketService.on('newNotification', handleNewNotification);
          websocketService.on('likeUpdate', handleLikeUpdate);
          websocketService.on('challengeLikesUpdated', handleChallengeLikesUpdated);
          websocketService.on('challengeUpdated', handleChallengeUpdated);

          // Handle account suspension via WebSocket
          const handleAccountSuspended = (data: any) => {
            if (!data?.userId || data.userId === user.id) {
              authEventEmitter.emitAccountSuspended(data?.reason);
            }
          };
          websocketService.on('accountSuspended', handleAccountSuspended);

          return () => {
            websocketService.off('connected', handleConnected);
            websocketService.off('disconnected', handleDisconnected);
            websocketService.off('disabled', handleDisabled);
            websocketService.off('postUpdate', handlePostUpdate);
            websocketService.off('newComment', handleNewComment);
            websocketService.off('newNotification', handleNewNotification);
            websocketService.off('likeUpdate', handleLikeUpdate);
            websocketService.off('challengeLikesUpdated', handleChallengeLikesUpdated);
            websocketService.off('challengeUpdated', handleChallengeUpdated);
            websocketService.off('accountSuspended', handleAccountSuspended);
            websocketService.disconnect();
          };
        }
      }
    };

    initWebSocket();
  }, [user?.id, token, updateLikedPosts]);

  const subscribeToPost = useCallback((postId: string) => {
    if (!subscribedPosts.current.has(postId)) {
      subscribedPosts.current.add(postId);
      websocketService.subscribeToPost(postId);
    }
  }, []);

  const unsubscribeFromPost = useCallback((postId: string) => {
    if (subscribedPosts.current.has(postId)) {
      subscribedPosts.current.delete(postId);
      websocketService.unsubscribeFromPost(postId);
    }
  }, []);

  const sendLikeAction = useCallback((postId: string, isLiked: boolean) => {
    websocketService.sendLikeAction(postId, isLiked);
  }, []);

  const sendCommentAction = useCallback((postId: string, commentText: string) => {
    websocketService.sendCommentAction(postId, commentText);
  }, []);

  const sendFollowAction = useCallback((targetUserId: string, isFollowing: boolean) => {
    websocketService.sendFollowAction(targetUserId, isFollowing);
  }, []);

  const onPostUpdate = useCallback((callback: (update: PostUpdate) => void) => {
    postUpdateCallbacks.current.add(callback);
    return () => {
      postUpdateCallbacks.current.delete(callback);
    };
  }, []);

  const onNewComment = useCallback((callback: (update: CommentUpdate) => void) => {
    commentCallbacks.current.add(callback);
    return () => {
      commentCallbacks.current.delete(callback);
    };
  }, []);

  const onNewNotification = useCallback((callback: (update: NotificationUpdate) => void) => {
    notificationCallbacks.current.add(callback);
    return () => {
      notificationCallbacks.current.delete(callback);
    };
  }, []);

  const onLikeUpdate = useCallback((callback: (update: LikeUpdate) => void) => {
    likeUpdateCallbacks.current.add(callback);
    return () => {
      likeUpdateCallbacks.current.delete(callback);
    };
  }, []);

  const onChallengeLikesUpdated = useCallback((callback: (update: ChallengeLikesUpdate) => void) => {
    challengeLikeCallbacks.current.add(callback);
    return () => {
      challengeLikeCallbacks.current.delete(callback);
    };
  }, []);

  const value: RealtimeContextType = {
    isConnected,
    isAvailable,
    subscribeToPost,
    unsubscribeFromPost,
    sendLikeAction,
    sendCommentAction,
    sendFollowAction,
    onPostUpdate,
    onNewComment,
    onNewNotification,
    onLikeUpdate,
    onChallengeLikesUpdated,
  };

  return (
    <RealtimeContext.Provider value={value}>
      {children}
    </RealtimeContext.Provider>
  );
};

export default RealtimeProvider;
