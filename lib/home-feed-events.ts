type HomeFeedRefreshListener = (requestId: number) => void;

let homeFeedRefreshRequestId = 0;
const listeners = new Set<HomeFeedRefreshListener>();

export function requestHomeFeedRefresh() {
  homeFeedRefreshRequestId += 1;
  listeners.forEach((listener) => {
    listener(homeFeedRefreshRequestId);
  });
  return homeFeedRefreshRequestId;
}

export function getHomeFeedRefreshRequestId() {
  return homeFeedRefreshRequestId;
}

export function subscribeHomeFeedRefresh(listener: HomeFeedRefreshListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
