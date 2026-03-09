import { SimpleEventEmitter } from './simple-event-emitter';

export interface VideoReadyEventPayload {
  userId: string;
  postId: string;
  challengeId?: string;
  challengeName?: string;
}

class LocalNotificationEvents extends SimpleEventEmitter {
  emitChanged() {
    this.emit('changed');
  }

  onChanged(listener: () => void) {
    this.on('changed', listener);
    return () => {
      this.off('changed', listener);
    };
  }

  emitVideoReady(payload: VideoReadyEventPayload) {
    this.emit('video-ready', payload);
  }

  onVideoReady(listener: (payload: VideoReadyEventPayload) => void) {
    this.on('video-ready', listener);
    return () => {
      this.off('video-ready', listener);
    };
  }
}

export const localNotificationEvents = new LocalNotificationEvents();
