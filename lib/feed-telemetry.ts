type FeedEndpoint = 'public' | 'personalized' | 'recommendations';

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

function logTelemetry(event: string, payload: Record<string, unknown>) {
  if (__DEV__) {
    console.log(`[FeedTelemetry] ${event}`, payload);
  }
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
  trackShareSuccess(payload: { postId: string }) {
    logTelemetry('feed_share_post_success', payload);
  },
  trackShareFail(payload: { postId: string; message: string }) {
    logTelemetry('feed_share_post_fail', payload);
  },
};
