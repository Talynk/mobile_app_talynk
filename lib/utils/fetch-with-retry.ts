/**
 * Exponential-backoff retry wrapper for any async fetch function.
 * Retries on network errors, timeouts, AbortError, and 5xx server errors.
 * Does NOT retry on 4xx (auth/validation) errors.
 */
export interface FetchRetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
}

function isRetryable(error: any): boolean {
  if (!error) return false;

  if (error.name === 'AbortError' || error.message === 'Aborted') return true;

  const code = error.code || '';
  if (
    code === 'ECONNABORTED' ||
    code === 'ETIMEDOUT' ||
    code === 'NETWORK_ERROR' ||
    code === 'ERR_NETWORK'
  ) {
    return true;
  }

  const msg = (error.message || '').toLowerCase();
  if (
    msg.includes('network') ||
    msg.includes('timeout') ||
    msg.includes('abort') ||
    msg.includes('econnreset') ||
    msg.includes('fetch failed')
  ) {
    return true;
  }

  const status = error.response?.status;
  if (typeof status === 'number' && status >= 500) return true;

  if (!status && !error.response) return true;

  return false;
}

export async function fetchWithRetry<T>(
  fetchFn: () => Promise<T>,
  options?: FetchRetryOptions,
): Promise<T> {
  const maxAttempts = options?.maxAttempts ?? 4;
  const initialDelay = options?.initialDelayMs ?? 1000;
  const maxDelay = options?.maxDelayMs ?? 8000;

  let lastError: any;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fetchFn();
    } catch (error: any) {
      lastError = error;

      if (attempt >= maxAttempts || !isRetryable(error)) {
        throw error;
      }

      const delay = Math.min(initialDelay * Math.pow(2, attempt - 1), maxDelay);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw lastError;
}
