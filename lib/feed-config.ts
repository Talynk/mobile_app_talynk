export const FEED_REFRESH_BUCKET_MS = 60_000;
export const FEED_DEFAULT_PAGE_SIZE = 10;
export const FEED_LOAD_MORE_PAGE_SIZE = 10;

export const FEED_INTEGRATION_CONFIG = {
  enableSeenResetOnPullToRefresh: false,
  enableCatalogFeedFallback: false,
} as const;

export function createFeedRefreshSeed(now = Date.now()) {
  return Math.floor(now / FEED_REFRESH_BUCKET_MS);
}

export function createNextFeedRefreshSeed(previousSeed?: number) {
  const currentSeed = createFeedRefreshSeed();
  if (previousSeed == null) {
    return currentSeed;
  }

  return currentSeed > previousSeed ? currentSeed : previousSeed + 1;
}
