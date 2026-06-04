const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const prisma = require('./prisma');

class WebSocketServer {
  constructor() {
    this.wss = null;
    this.clients = new Map(); // userId -> Set of WebSocket connections
    this.postSubscriptions = new Map(); // postId -> Set of userIds
    this.userSubscriptions = new Map(); // userId -> Set of postIds
  }

  initialize(server) {
    this.wss = new WebSocket.Server({ 
      server, 
      path: '/ws',
      verifyClient: (info) => {
        // Allow connection, we'll authenticate in the connection handler
        return true;
      }
    });

    this.wss.on('connection', (ws, req) => {
      this.handleConnection(ws, req);
    });

    console.log('[WebSocket] Server initialized at /ws');
  }

  async handleConnection(ws, req) {
    try {
      // Parse query parameters
      const url = new URL(req.url, `http://${req.headers.host}`);
      const userId = url.searchParams.get('userId');
      const token = url.searchParams.get('token');

      // Authenticate user
      if (!userId || !token) {
        console.log('[WebSocket] Connection rejected: missing userId or token');
        ws.close(1008, 'Missing userId or token');
        return;
      }

      let decoded;
      try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
      } catch (error) {
        console.log('[WebSocket] Connection rejected: invalid token');
        ws.close(1008, 'Invalid token');
        return;
      }

      // Verify userId matches token
      if (decoded.id !== userId && decoded.userId !== userId) {
        console.log('[WebSocket] Connection rejected: userId mismatch');
        ws.close(1008, 'UserId mismatch');
        return;
      }

      // Store connection info
      ws.userId = userId;
      ws.isAlive = true;

      // Add to clients map
      if (!this.clients.has(userId)) {
        this.clients.set(userId, new Set());
      }
      this.clients.get(userId).add(ws);

      console.log(`[WebSocket] Client connected: ${userId} (${this.clients.get(userId).size} connections)`);

      // Setup heartbeat
      ws.on('pong', () => {
        ws.isAlive = true;
      });

      // Handle messages
      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(ws, message);
        } catch (error) {
          console.error('[WebSocket] Message parse error:', error);
        }
      });

      // Handle close
      ws.on('close', () => {
        this.handleDisconnection(ws);
      });

      // Handle errors
      ws.on('error', (error) => {
        console.error(`[WebSocket] Error for user ${userId}:`, error);
      });

      // Send connection confirmation
      this.send(ws, {
        type: 'connected',
        data: { userId, timestamp: Date.now() }
      });

    } catch (error) {
      console.error('[WebSocket] Connection error:', error);
      ws.close(1011, 'Server error');
    }
  }

  handleMessage(ws, message) {
    const { type, data } = message;

    switch (type) {
      case 'ping':
        this.send(ws, {
          type: 'pong',
          data: { timestamp: Date.now() }
        });
        break;

      case 'subscribe':
        if (data.postId && ws.userId) {
          this.subscribeToPost(ws.userId, data.postId);
        }
        break;

      case 'unsubscribe':
        if (data.postId && ws.userId) {
          this.unsubscribeFromPost(ws.userId, data.postId);
        }
        break;

      case 'like':
        // Like action is handled by REST API, but we can broadcast the update
        if (data.postId && data.userId && typeof data.isLiked === 'boolean') {
          this.broadcastLikeUpdate(data.postId, data.userId, data.isLiked);
        }
        break;

      case 'comment':
        // Comment action is handled by REST API, but we can broadcast the update
        // The actual comment creation will emit via emitEvent
        break;

      case 'follow':
        // Follow action is handled by REST API, but we can broadcast the update
        if (data.targetUserId && data.userId && typeof data.isFollowing === 'boolean') {
          this.broadcastFollowUpdate(data.targetUserId, data.userId, data.isFollowing);
        }
        break;

      default:
        console.log(`[WebSocket] Unknown message type: ${type}`);
    }
  }

  subscribeToPost(userId, postId) {
    if (!this.userSubscriptions.has(userId)) {
      this.userSubscriptions.set(userId, new Set());
    }
    this.userSubscriptions.get(userId).add(postId);

    if (!this.postSubscriptions.has(postId)) {
      this.postSubscriptions.set(postId, new Set());
    }
    this.postSubscriptions.get(postId).add(userId);

    console.log(`[WebSocket] User ${userId} subscribed to post ${postId}`);
  }

  unsubscribeFromPost(userId, postId) {
    if (this.userSubscriptions.has(userId)) {
      this.userSubscriptions.get(userId).delete(postId);
    }

    if (this.postSubscriptions.has(postId)) {
      this.postSubscriptions.get(postId).delete(userId);
    }

    console.log(`[WebSocket] User ${userId} unsubscribed from post ${postId}`);
  }

  handleDisconnection(ws) {
    if (!ws.userId) return;

    const userId = ws.userId;
    
    // Remove from clients
    if (this.clients.has(userId)) {
      this.clients.get(userId).delete(ws);
      if (this.clients.get(userId).size === 0) {
        this.clients.delete(userId);
        // Clean up subscriptions
        this.userSubscriptions.delete(userId);
      }
    }

    console.log(`[WebSocket] Client disconnected: ${userId}`);
  }

  // Send message to a specific WebSocket connection
  send(ws, message) {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({
          type: message.type,
          data: message.data,
          timestamp: Date.now()
        }));
      } catch (error) {
        console.error('[WebSocket] Send error:', error);
      }
    }
  }

  // Broadcast to all connections of a specific user
  broadcastToUser(userId, message) {
    if (this.clients.has(userId)) {
      this.clients.get(userId).forEach(ws => {
        this.send(ws, message);
      });
    }
  }

  // Broadcast to all users subscribed to a post
  async broadcastToPostSubscribers(postId, message) {
    if (this.postSubscriptions.has(postId)) {
      const subscribers = Array.from(this.postSubscriptions.get(postId));
      
      // Also include post owner
      try {
        const post = await prisma.post.findUnique({
          where: { id: postId },
          select: { user_id: true }
        });
        
        if (post && !subscribers.includes(post.user_id)) {
          subscribers.push(post.user_id);
        }
      } catch (error) {
        console.error('[WebSocket] Error fetching post owner:', error);
      }

      subscribers.forEach(userId => {
        this.broadcastToUser(userId, message);
      });
    }
  }

  // Broadcast like update
  async broadcastLikeUpdate(postId, userId, isLiked) {
    try {
      // Get current like count
      const likeCount = await prisma.postLike.count({
        where: { post_id: postId }
      });

      const message = {
        type: 'likeUpdate',
        data: {
          postId,
          userId,
          isLiked,
          likeCount
        }
      };

      // Also send as 'like' for compatibility
      const likeMessage = {
        type: 'like',
        data: {
          postId,
          userId,
          isLiked,
          likeCount
        }
      };

      // Broadcast to post subscribers
      await this.broadcastToPostSubscribers(postId, message);
      await this.broadcastToPostSubscribers(postId, likeMessage);

      // Also send postUpdate
      await this.broadcastToPostSubscribers(postId, {
        type: 'postUpdate',
        data: {
          postId,
          likes: likeCount,
          isLiked
        }
      });
    } catch (error) {
      console.error('[WebSocket] Error broadcasting like update:', error);
    }
  }

  // Broadcast comment update
  async broadcastCommentUpdate(postId, commentId, userId) {
    try {
      // Fetch comment with user info
      const comment = await prisma.comment.findUnique({
        where: { id: commentId },
        select: {
          id: true,
          comment_text: true,
          comment_date: true,
          user: {
            select: {
              id: true,
              username: true,
              profile_picture: true
            }
          }
        }
      });

      if (!comment) return;

      const message = {
        type: 'newComment',
        data: {
          postId,
          comment: {
            id: comment.id,
            text: comment.comment_text,
            content: comment.comment_text, // For compatibility
            user: {
              id: comment.user.id,
              name: comment.user.username,
              username: comment.user.username,
              avatar: comment.user.profile_picture || null,
              profile_picture: comment.user.profile_picture || null
            },
            createdAt: comment.comment_date.toISOString()
          }
        }
      };

      // Also send as 'comment' for compatibility
      const commentMessage = {
        type: 'comment',
        data: message.data
      };

      // Broadcast to post subscribers
      await this.broadcastToPostSubscribers(postId, message);
      await this.broadcastToPostSubscribers(postId, commentMessage);

      // Also send postUpdate with comment count
      const commentCount = await prisma.comment.count({
        where: { post_id: postId }
      });

      await this.broadcastToPostSubscribers(postId, {
        type: 'postUpdate',
        data: {
          postId,
          comments: commentCount
        }
      });
    } catch (error) {
      console.error('[WebSocket] Error broadcasting comment update:', error);
    }
  }

  // Broadcast follow update
  broadcastFollowUpdate(targetUserId, userId, isFollowing) {
    const message = {
      type: 'followUpdate',
      data: {
        targetUserId,
        userId,
        isFollowing
      }
    };

    // Also send as 'follow' for compatibility
    const followMessage = {
      type: 'follow',
      data: message.data
    };

    // Notify the target user
    this.broadcastToUser(targetUserId, message);
    this.broadcastToUser(targetUserId, followMessage);
  }

  /**
   * Broadcast challenge schedule / lifecycle updates to all connected mobile clients.
   * Payload mirrors Socket.IO event `challenge:updated`.
   */
  broadcastChallengeUpdate(payload) {
    const message = {
      type: 'challenge:updated',
      data: payload,
    };
    this.clients.forEach((wsSet) => {
      wsSet.forEach((ws) => this.send(ws, message));
    });
  }

  // Broadcast notification
  async broadcastNotification(userId, notification) {
    // userId can be either user ID (UUID) or username
    // We need to find the user by ID first, then also try username
    let targetUserId = userId;
    
    // If notification has a notification object with user info, use that
    if (notification.notification) {
      notification = notification.notification;
    }

    // If we have userID (username) but need userId, look it up
    if (notification.userID && !targetUserId) {
      try {
        const user = await prisma.user.findUnique({
          where: { username: notification.userID },
          select: { id: true }
        });
        if (user) {
          targetUserId = user.id;
        }
      } catch (error) {
        console.error('[WebSocket] Error looking up user by username:', error);
      }
    }

    const message = {
      type: 'newNotification',
      data: {
        notification: {
          id: notification.id || notification.notification_id,
          type: notification.type,
          text: notification.message || notification.text || notification.notification_text,
          isRead: notification.isRead || notification.is_read || false,
          createdAt: notification.createdAt || notification.created_at || notification.notification_date || new Date().toISOString()
        }
      }
    };

    // Also send as 'notification' for compatibility
    const notificationMessage = {
      type: 'notification',
      data: message.data
    };

    // Try to broadcast by userId (UUID)
    if (targetUserId) {
      this.broadcastToUser(targetUserId, message);
      this.broadcastToUser(targetUserId, notificationMessage);
    }

    // Also try by username if we have it
    if (notification.userID) {
      // Find user by username and broadcast
      try {
        const user = await prisma.user.findUnique({
          where: { username: notification.userID },
          select: { id: true }
        });
        if (user && user.id !== targetUserId) {
          this.broadcastToUser(user.id, message);
          this.broadcastToUser(user.id, notificationMessage);
        }
      } catch (error) {
        // Ignore lookup errors
      }
    }
  }

  // Broadcast post update
  async broadcastPostUpdate(postId, updateData) {
    const message = {
      type: 'postUpdate',
      data: {
        postId,
        ...updateData
      }
    };

    await this.broadcastToPostSubscribers(postId, message);
  }

  // Setup heartbeat interval
  startHeartbeat() {
    if (this.heartbeatInterval) return;

    this.heartbeatInterval = setInterval(() => {
      this.wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
          ws.terminate();
          return;
        }

        ws.isAlive = false;
        ws.ping();
      });
    }, 30000); // 30 seconds
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  // Cleanup
  close() {
    this.stopHeartbeat();
    if (this.wss) {
      this.wss.close();
    }
    this.clients.clear();
    this.postSubscriptions.clear();
    this.userSubscriptions.clear();
  }
}

// Singleton instance
const websocketServer = new WebSocketServer();

module.exports = websocketServer;

