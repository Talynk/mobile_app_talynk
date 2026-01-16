import { SimpleEventEmitter } from './simple-event-emitter';

/**
 * Global event emitter for auth-related events.
 * Used to notify auth context and other components about auth state changes.
 */
class AuthEventEmitter extends SimpleEventEmitter {
  // Event: Unauthorized (401) - token is invalid or expired
  emitUnauthorized() {
    console.log('[AuthEvents] Emitting unauthorized event');
    this.emit('unauthorized');
  }

  // Listen for unauthorized events
  onUnauthorized(callback: () => void) {
    this.on('unauthorized', callback);
  }

  // Stop listening for unauthorized events
  offUnauthorized(callback: () => void) {
    this.off('unauthorized', callback);
  }
}

export const authEventEmitter = new AuthEventEmitter();
