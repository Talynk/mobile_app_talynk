import { useEffect } from 'react';

import { useAuth } from '@/lib/auth-context';
import { frontendNotifications } from '@/lib/frontend-notifications';
import { localNotificationEvents } from '@/lib/local-notification-events';
import { uploadNotificationService } from '@/lib/notification-service';
import { postsApi } from '@/lib/api';
import { PendingVideoEntry, videoReadyTracker } from '@/lib/video-ready-tracker';

const FIRST_PHASE_MS = 2 * 60 * 1000;
const SECOND_PHASE_MS = 12 * 60 * 1000;
const FIRST_PHASE_INTERVAL_MS = 5 * 1000;
const SECOND_PHASE_INTERVAL_MS = 15 * 1000;
const LATE_PHASE_INTERVAL_MS = 30 * 1000;

function getPollingInterval(entry: PendingVideoEntry, now = Date.now()) {
  const startedAt = new Date(entry.pollStartedAt || entry.createdAt).getTime();
  const elapsed = Number.isFinite(startedAt) ? now - startedAt : 0;
  if (elapsed < FIRST_PHASE_MS) {
    return FIRST_PHASE_INTERVAL_MS;
  }
  if (elapsed < SECOND_PHASE_MS) {
    return SECOND_PHASE_INTERVAL_MS;
  }
  return LATE_PHASE_INTERVAL_MS;
}

function isEntryDue(entry: PendingVideoEntry, now = Date.now()) {
  if (!entry.lastCheckedAt) {
    return true;
  }

  const lastCheckedAt = new Date(entry.lastCheckedAt).getTime();
  if (!Number.isFinite(lastCheckedAt)) {
    return true;
  }

  return now - lastCheckedAt >= getPollingInterval(entry, now);
}

export function VideoReadyWatcher() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user?.id) {
      return;
    }

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const checkPendingVideos = async () => {
      const pendingEntries = await videoReadyTracker.getAll(user.id);
      if (!pendingEntries.length || cancelled) {
        return;
      }

      const now = Date.now();
      const dueEntries = pendingEntries.filter((entry) => isEntryDue(entry, now));
      if (!dueEntries.length) {
        return;
      }

      const results = await Promise.allSettled(
        dueEntries.map(async (entry) => ({
          entry,
          status: await postsApi.getProcessingStatus(entry.postId),
        }))
      );

      for (const result of results) {
        if (cancelled || result.status !== 'fulfilled') {
          continue;
        }

        const { entry, status } = result.value;
        if (status.status !== 'success') {
          const message = String(status.message || '').toLowerCase();
          const nextCheckCount = (entry.checkCount ?? 0) + 1;
          await videoReadyTracker.update(user.id, entry.postId, {
            lastCheckedAt: new Date().toISOString(),
            checkCount: nextCheckCount,
            lastKnownStatus: message.includes('not found') ? 'not_found' : entry.lastKnownStatus,
          });
          if (message.includes('not found') && nextCheckCount >= 3) {
            await videoReadyTracker.untrack(user.id, entry.postId);
          }
          continue;
        }

        const processing = status.data?.processing;
        const statusLabel = processing?.status || (processing?.hlsReady ? 'completed' : 'unknown');
        const eta = processing?.queue?.estimatedSecondsRemaining;
        const isReady =
          processing?.hlsReady === true || processing?.status === 'completed';
        const isFailed = processing?.status === 'failed';

        await videoReadyTracker.update(user.id, entry.postId, {
          lastCheckedAt: new Date().toISOString(),
          checkCount: (entry.checkCount ?? 0) + 1,
          lastKnownStatus: eta ? `${statusLabel}:${eta}` : statusLabel,
        });

        if (isFailed) {
          await frontendNotifications.addVideoFailedNotification({
            userId: user.id,
            postId: entry.postId,
            destination: entry.destination,
            challengeId: entry.challengeId,
            challengeName: entry.challengeName,
          });
          await videoReadyTracker.untrack(user.id, entry.postId);
          await uploadNotificationService.showVideoProcessingFailed(entry.destination, entry.challengeName);
          continue;
        }

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

    const scheduleNextCheck = async () => {
      if (cancelled) {
        return;
      }

      await checkPendingVideos().catch(() => {});
      if (cancelled) {
        return;
      }

      const pendingEntries = await videoReadyTracker.getAll(user.id);
      const now = Date.now();
      const delay = pendingEntries.length
        ? Math.max(
            1000,
            Math.min(
              ...pendingEntries.map((entry) => {
                if (!entry.lastCheckedAt) {
                  return 1000;
                }
                const lastCheckedAt = new Date(entry.lastCheckedAt).getTime();
                const elapsedSinceCheck = Number.isFinite(lastCheckedAt) ? now - lastCheckedAt : 0;
                return getPollingInterval(entry, now) - elapsedSinceCheck;
              })
            )
          )
        : LATE_PHASE_INTERVAL_MS;

      timeoutId = setTimeout(() => {
        void scheduleNextCheck();
      }, delay);
    };

    void scheduleNextCheck();

    return () => {
      cancelled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [user?.id]);

  return null;
}
