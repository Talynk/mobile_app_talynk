import { SimpleEventEmitter } from './simple-event-emitter';
import { API_BASE_URL } from './config';

export interface WebSocketMessage {
  type: string;
  data: any;
  timestamp: number;
}

export interface PostUpdate {
  postId: string;
  likes: number;
  comments: number;
  isLiked: boolean;
}

export interface CommentUpdate {
  postId: string;
  comment: {
    id: string;
    text: string;
    content?: string;
    user: {
      id: string;
      name: string;
      username: string;
      avatar?: string;
      profile_picture?: string;
    };
    createdAt: string;
  };
}

export interface NotificationUpdate {
  notification: {
    id: number | string;
    userID?: string;
    type?: string;
    message?: string; // Backend sends 'message'
    text?: string; // Legacy support
    isRead?: boolean;
    is_read?: boolean; // Legacy support
    createdAt?: string;
    created_at?: string; // Legacy support
  };
}

export interface LikeUpdate {
  postId: string;
  userId: string;
  isLiked: boolean;
  likeCount: number;
}

class WebSocketService extends SimpleEventEmitter {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 2; // Reduced - fail fast if backend doesn't support WS
  private reconnectDelay = 2000;
  private isConnecting = false;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private userId: string | null = null;
  private token: string | null = null;
  private messageQueue: Array<{ type: string; data: any }> = [];
  private subscribedPosts = new Set<string>();
  private connectionEnabled = true;
  private hasConnectedOnce = false; // Track if we've ever successfully connected
  private silentMode = false; // Suppress logs after initial failure

  constructor() {
    super();
  }

  connect(userId: string, token: string) {
    // Don't connect if disabled or already connecting
    if (!this.connectionEnabled || this.isConnecting) {
      return;
    }

    if (this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    this.isConnecting = true;
    this.userId = userId;
    this.token = token;

    try {
      const wsProtocol = API_BASE_URL.startsWith('https') ? 'wss' : 'ws';
      const wsHost = API_BASE_URL.replace(/^https?:\/\//, '');
      const fullUrl = `${wsProtocol}://${wsHost}/ws?userId=${userId}&token=${token}`;
      
      if (!this.silentMode) {
        console.log('[WS] Attempting to connect to real-time server...');
      }
      
      this.ws = new WebSocket(fullUrl);

      // Set a short connection timeout - fail fast
      const connectionTimeout = setTimeout(() => {
        if (this.ws?.readyState !== WebSocket.OPEN) {
          this.handleConnectionFailure();
        }
      }, 3000);

      this.ws.onopen = () => {
        clearTimeout(connectionTimeout);
        console.log('[WS] ✓ Real-time connection established');
        this.isConnecting = false;
        this.reconnectAttempts = 0;
        this.reconnectDelay = 2000;
        this.hasConnectedOnce = true;
        this.silentMode = false;
        this.emit('connected');
        
        this.startHeartbeat();
        this.processMessageQueue();
        this.resubscribeToPosts();
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          this.handleMessage(message);
        } catch (error) {
          // Silently ignore parse errors
        }
      };

      this.ws.onerror = () => {
        clearTimeout(connectionTimeout);
        this.isConnecting = false;
        // Only log on first attempt
        if (this.reconnectAttempts === 0 && !this.silentMode) {
          console.log('[WS] Real-time server not available');
        }
      };

      this.ws.onclose = () => {
        clearTimeout(connectionTimeout);
        this.isConnecting = false;
        this.stopHeartbeat();
        
        // Only emit disconnected if we were previously connected
        if (this.hasConnectedOnce) {
          this.emit('disconnected');
        }
        
        // Only reconnect if we've successfully connected before
        if (this.hasConnectedOnce && this.connectionEnabled && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.handleReconnect();
        } else if (!this.hasConnectedOnce) {
          // Never connected - backend doesn't support WebSocket
          this.handleConnectionFailure();
        }
      };

    } catch (error) {
      this.isConnecting = false;
      this.handleConnectionFailure();
    }
  }

  private handleConnectionFailure() {
    this.reconnectAttempts++;
    
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      if (!this.silentMode) {
        console.log('[WS] Real-time features unavailable - using standard updates');
      }
      this.disableConnection();
    } else {
      // Try one more time silently
      this.silentMode = true;
      setTimeout(() => {
        if (this.connectionEnabled && this.userId && this.token) {
          this.connect(this.userId, this.token);
        }
      }, this.reconnectDelay);
    }
  }

  private disableConnection() {
    this.connectionEnabled = false;
    this.isConnecting = false;
    this.silentMode = true;
    this.stopHeartbeat();
    if (this.ws) {
      try {
        this.ws.close();
      } catch (e) {
        // Ignore close errors
      }
      this.ws = null;
    }
    this.emit('disabled');
  }

  private handleMessage(message: WebSocketMessage) {
    const { type, data } = message;

    switch (type) {
      case 'pong':
        break;

      case 'like':
      case 'likeUpdate':
      case 'post:likeToggled': // Per NOTIFICATIONS&REPORTING.md
        this.emit('likeUpdate', data as LikeUpdate);
        this.emit('postUpdate', {
          postId: data.postId,
          likes: data.likeCount,
          isLiked: data.isLiked,
        } as PostUpdate);
        break;

      case 'comment':
      case 'newComment':
        this.emit('newComment', data as CommentUpdate);
        break;

      case 'postUpdate':
        this.emit('postUpdate', data as PostUpdate);
        break;

      case 'notification':
      case 'newNotification':
      case 'notification:created': // Per NOTIFICATIONS&REPORTING.md
        console.log('[WebSocket] 🔔 Received notification event:', {
          eventType: type,
          hasData: !!data,
          dataKeys: data ? Object.keys(data) : [],
          rawData: data,
        });
        
        // Handle both formats from NOTIFICATIONS.md:
        // Format 1: { type: "notification:created", data: { notification: {...} } }
        // Format 2: { type: "notification", data: { notification: {...} } }
        const notificationData = (data as any).notification || data;
        
        console.log('[WebSocket] 📋 Extracted notification data:', {
          id: notificationData?.id,
          type: notificationData?.type,
          message: notificationData?.message?.substring(0, 50),
          hasMetadata: !!notificationData?.metadata,
          metadata: notificationData?.metadata,
        });
        
        this.emit('newNotification', { notification: notificationData } as NotificationUpdate);
        console.log('[WebSocket] ✅ Emitted newNotification event');
        break;

      case 'follow':
      case 'followUpdate':
        this.emit('followUpdate', data);
        break;

      default:
        break;
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.send({ type: 'ping', data: { timestamp: Date.now() } });
      }
    }, 30000);
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private processMessageQueue() {
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      if (message) {
        this.send(message);
      }
    }
  }

  private resubscribeToPosts() {
    this.subscribedPosts.forEach(postId => {
      this.send({
        type: 'subscribe',
        data: { postId, userId: this.userId }
      });
    });
  }

  disconnect() {
    this.stopHeartbeat();
    this.connectionEnabled = false;

    if (this.ws) {
      try {
        this.ws.close(1000, 'User disconnected');
      } catch (e) {
        // Ignore
      }
      this.ws = null;
    }

    this.isConnecting = false;
    this.userId = null;
    this.token = null;
    this.messageQueue = [];
    this.subscribedPosts.clear();
    if (this.hasConnectedOnce) {
      this.emit('disconnected');
    }
  }

  send(message: { type: string; data: any }) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      const fullMessage: WebSocketMessage = {
        type: message.type,
        data: message.data,
        timestamp: Date.now()
      };
      try {
        this.ws.send(JSON.stringify(fullMessage));
      } catch (e) {
        // Queue on failure
        this.messageQueue.push(message);
      }
    } else if (this.connectionEnabled) {
      // Queue message for when connection is established
      this.messageQueue.push(message);
    }
    // If connection disabled, silently drop the message - REST API will handle it
  }

  private handleReconnect() {
    if (!this.connectionEnabled) return;
    
    this.reconnectAttempts++;
    const delay = Math.min(this.reconnectDelay * this.reconnectAttempts, 10000);

    if (!this.silentMode) {
      console.log(`[WS] Reconnecting in ${delay / 1000}s...`);
    }

    setTimeout(() => {
      if (this.connectionEnabled && this.userId && this.token) {
        this.connect(this.userId, this.token);
      }
    }, delay);
  }

  isConnectedNow(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  // Check if real-time is available
  isAvailable(): boolean {
    return this.connectionEnabled && this.hasConnectedOnce;
  }

  // Enable connection (call this to re-enable after being disabled)
  enableConnection() {
    this.connectionEnabled = true;
    this.reconnectAttempts = 0;
    this.silentMode = false;
    this.hasConnectedOnce = false;
  }

  subscribeToPost(postId: string) {
    this.subscribedPosts.add(postId);
    if (this.isConnectedNow()) {
      this.send({
        type: 'subscribe',
        data: { postId, userId: this.userId }
      });
    }
  }

  unsubscribeFromPost(postId: string) {
    this.subscribedPosts.delete(postId);
    if (this.isConnectedNow()) {
      this.send({
        type: 'unsubscribe',
        data: { postId, userId: this.userId }
      });
    }
  }

  sendLikeAction(postId: string, isLiked: boolean) {
    this.send({
      type: 'like',
      data: { postId, userId: this.userId, isLiked }
    });
  }

  sendCommentAction(postId: string, commentText: string) {
    this.send({
      type: 'comment',
      data: { postId, userId: this.userId, text: commentText }
    });
  }

  sendFollowAction(targetUserId: string, isFollowing: boolean) {
    this.send({
      type: 'follow',
      data: { targetUserId, userId: this.userId, isFollowing }
    });
  }
}

export const websocketService = new WebSocketService();
export default websocketService;
