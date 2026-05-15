type FeedEndpoint = 'public' | 'personalized' | 'recommendations' | 'following' | 'catalog';

type FeedRequestTelemetry = {
  endpoint: FeedEndpoint;
  refresh?: number;
  fingerprintPresent?: boolean;
  pipeline?: string;
  countryPersonalization?: string | null;
  adImpressionsCount?: number;
};

type DuplicateRatioTelemetry = {
  endpoint: FeedEndpoint;
  refresh?: number;
  duplicateRatio: number;
  totalItems: number;
  uniqueItems: number;
};

function getSentry() {
  if (__DEV__) {
    return null;
  }

  try {
    // Lazy-load so telemetry does not affect startup.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('@sentry/react-native');
  } catch {
    return null;
  }
}

function addFeedBreadcrumb(
  event: string,
  payload: Record<string, unknown>,
  level: 'debug' | 'info' | 'warning' | 'error' = 'info',
) {
  const Sentry = getSentry();
  if (!Sentry) {
    return;
  }

  try {
    Sentry.addBreadcrumb({
      category: 'feed',
      level,
      message: event,
      data: payload,
    });
  } catch {
    // Best-effort only.
  }
}

function captureFeedMessage(
  event: string,
  payload: Record<string, unknown>,
  level: 'info' | 'warning' | 'error' = 'info',
) {
  const Sentry = getSentry();
  if (!Sentry) {
    return;
  }

  try {
    Sentry.captureMessage(event, {
      level,
      tags: {
        area: 'feed',
        event,
      },
      extra: payload,
    });
  } catch {
    // Best-effort only.
  }
}

function logTelemetry(event: string, payload: Record<string, unknown>) {
  if (__DEV__) {
    console.log(`[FeedTelemetry] ${event}`, payload);
  }

  addFeedBreadcrumb(event, payload);
}

export const feedTelemetry = {
  trackFeedRequest(payload: FeedRequestTelemetry) {
    logTelemetry('feed_request', payload);
  },
  trackPersonalizedFeedLoaded(payload: {
    endpoint: FeedEndpoint;
    refresh?: number;
    preferenceCount: number;
    topCategoryName: string | null;
    postsCount: number;
    adCount: number;
    pipeline?: string;
    cached?: boolean;
  }) {
    logTelemetry('personalized_feed_loaded', payload);
  },
  trackPreferenceHintRendered(payload: {
    refresh?: number;
    topCategoryName: string | null;
    preferenceCount: number;
  }) {
    logTelemetry('preference_hint_rendered', payload);
  },
  trackEngagementAfterFeedImpression(payload: {
    sessionId: string;
    postId: string;
    action: 'like' | 'comment' | 'share';
    timestamp: string;
    refresh?: number;
  }) {
    logTelemetry('engagement_after_feed_impression', payload);
  },
  trackDuplicateRatio(payload: DuplicateRatioTelemetry) {
    logTelemetry('feed_duplicate_ratio', payload);
  },
  trackPullToRefresh(payload: { endpoint: FeedEndpoint; refresh: number }) {
    logTelemetry('feed_pull_to_refresh', payload);
  },
  trackSeenResetCalled(payload: { endpoint: 'guest' | 'auth'; refresh: number }) {
    logTelemetry('feed_seen_reset_called', payload);
  },
  trackResumeRefetch(payload: {
    screenName: string;
    endpoint?: FeedEndpoint;
    backgroundDurationMs: number;
  }) {
    logTelemetry('feed_resume_refetch', payload);
  },
  trackResumeHardReset(payload: {
    screenName: string;
    endpoint?: FeedEndpoint;
    backgroundDurationMs: number;
  }) {
    logTelemetry('feed_resume_hard_reset', payload);
  },
  trackFeedFirstPageOutcome(payload: {
    endpoint?: FeedEndpoint;
    outcome: 'success' | 'empty' | 'error' | 'degraded';
    message?: string;
    postsCount?: number;
  }) {
    logTelemetry('feed_first_page_outcome', payload);
    if (payload.outcome === 'empty') {
      addFeedBreadcrumb('feed_empty_first_page', payload, 'warning');
    } else if (payload.outcome === 'error') {
      captureFeedMessage('feed_first_page_error', payload, 'error');
    }
  },
  trackFeedNetworkError(payload: {
    endpoint?: FeedEndpoint;
    message: string;
  }) {
    addFeedBreadcrumb('feed_network_error', payload, 'warning');
    if (__DEV__) {
      console.log('[FeedTelemetry] feed_network_error', payload);
    }
  },
  trackManualReload(payload: {
    screenName: string;
    endpoint?: FeedEndpoint;
  }) {
    logTelemetry('feed_reload_manual', payload);
  },
  trackVideoSourceMode(payload: {
    mode: 'direct' | 'android_cache';
    postId: string;
    screenName: string;
  }) {
    logTelemetry('video_source_mode', payload);
  },
  trackVideoTimeToFirstFrame(payload: {
    postId: string;
    screenName: string;
    sourceMode: 'direct' | 'android_cache';
    durationMs: number;
  }) {
    logTelemetry('video_time_to_first_frame_ms', payload);
  },
  trackVideoStall(payload: {
    postId: string;
    screenName: string;
    count: number;
  }) {
    logTelemetry('video_stall_count', payload);
  },
  trackActiveFeedPlayers(payload: {
    count: number;
    postId: string;
    screenName: string;
  }) {
    logTelemetry('active_feed_players_count', payload);
  },
  trackPageAlignmentError(payload: {
    screenName: string;
    alignmentErrorPx: number;
    pageHeight: number;
    index: number;
  }) {
    if (payload.alignmentErrorPx <= 1) {
      return;
    }
    logTelemetry('page_alignment_error_px', payload);
  },
  trackShareSuccess(payload: { postId: string }) {
    logTelemetry('feed_share_post_success', payload);
  },
  trackShareFail(payload: { postId: string; message: string }) {
    logTelemetry('feed_share_post_fail', payload);
  },
};
