let proxyReady = false;
let proxyFailed = false;
let proxyDisabledForSession = false;
let startupPromise: Promise<boolean> | null = null;

export function markVideoProxyStartup(promise: Promise<boolean>) {
  startupPromise = promise;
}

export function getVideoProxyStartupPromise() {
  return startupPromise;
}

export function markVideoProxyReady() {
  proxyReady = true;
  proxyFailed = false;
}

export function markVideoProxyFailed() {
  proxyReady = false;
  proxyFailed = true;
}

export function isVideoProxyReady() {
  return proxyReady && !proxyDisabledForSession;
}

export function hasVideoProxyFailed() {
  return proxyFailed;
}

export function disableVideoProxyForSession() {
  proxyDisabledForSession = true;
  proxyReady = false;
}

export function isVideoProxyDisabledForSession() {
  return proxyDisabledForSession;
}
