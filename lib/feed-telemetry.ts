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
