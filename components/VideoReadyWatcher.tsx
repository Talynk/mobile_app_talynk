import { useEffect } from 'react';

import { useAuth } from '@/lib/auth-context';
import { frontendNotifications } from '@/lib/frontend-notifications';
import { localNotificationEvents } from '@/lib/local-notification-events';
import { uploadNotificationService } from '@/lib/notification-service';
import { postsApi } from '@/lib/api';
import { videoReadyTracker } from '@/lib/video-ready-tracker';

const POLL_INTERVAL_MS = 12000;

export function VideoReadyWatcher() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user?.id) {
      return;
    }

    let cancelled = false;

    const checkPendingVideos = async () => {
      const pendingEntries = await videoReadyTracker.getAll(user.id);
      if (!pendingEntries.length || cancelled) {
        return;
      }

      const results = await Promise.allSettled(
        pendingEntries.map(async (entry) => ({
          entry,
          status: await postsApi.getProcessingStatus(entry.postId),
        }))
      );

      for (const result of results) {
        if (cancelled || result.status !== 'fulfilled') {
          continue;
        }

        const { entry, status } = result.value;
        const processing = status.data?.processing;
        const isReady =
          processing?.hlsReady === true || processing?.status === 'completed';

        if (!isReady) {
          continue;
        }

        await frontendNotifications.addVideoReadyNotification({
          userId: user.id,
          postId: entry.postId,
          destination: entry.destination,
          challengeId: entry.challengeId,
          challengeName: entry.challengeName,
        });
        await videoReadyTracker.untrack(user.id, entry.postId);
        await uploadNotificationService.showVideoReady(entry.destination, entry.challengeName);
        localNotificationEvents.emitVideoReady({
          userId: user.id,
          postId: entry.postId,
          challengeId: entry.challengeId,
          challengeName: entry.challengeName,
        });
      }
    };

    checkPendingVideos().catch(() => {});
    const interval = setInterval(() => {
      checkPendingVideos().catch(() => {});
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [user?.id]);

  return null;
}
