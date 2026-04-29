import { InteractionManager } from 'react-native';

type SentryLevel = 'fatal' | 'error' | 'warning' | 'log' | 'info' | 'debug';

type SafeScrollParams = {
  ref: { current: { scrollToIndex?: (params: { index: number; animated?: boolean }) => void } | null };
  index: number;
  itemCount: number;
  animated?: boolean;
  context: string;
};

type OpenFullscreenParams = {
  setVisible: (visible: boolean) => void;
  setIndex: (index: number) => void;
  ref: { current: { scrollToIndex?: (params: { index: number; animated?: boolean }) => void } | null };
  index: number;
  itemCount: number;
  context: string;
  prewarm?: () => void;
};

function getSentry() {
  if (__DEV__) return null;
  try {
    // Lazy-load to avoid affecting early app startup paths.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('@sentry/react-native');
  } catch {
    return null;
  }
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(typeof error === 'string' ? error : 'Unknown error');
}

export function addFabricBreadcrumb(message: string, data?: Record<string, unknown>) {
  const Sentry = getSentry();
  if (!Sentry) return;
  try {
    Sentry.addBreadcrumb({
      category: 'fabric',
      level: 'info',
      message,
      data,
    });
  } catch {
    // no-op
  }
}

export function captureFabricError(
  error: unknown,
  context: string,
  extras?: Record<string, unknown>,
  level: SentryLevel = 'error',
) {
  const Sentry = getSentry();
  if (!Sentry) return;
  try {
    Sentry.captureException(normalizeError(error), {
      level,
      tags: {
        area: 'fabric',
        context,
      },
      extra: extras,
    });
  } catch {
    // no-op
  }
}

export function safeScrollToIndex({
  ref,
  index,
  itemCount,
  animated = false,
  context,
}: SafeScrollParams): boolean {
  if (!ref?.current || itemCount <= 0) {
    addFabricBreadcrumb('safeScrollToIndex skipped', {
      context,
      reason: !ref?.current ? 'missing_ref' : 'empty_list',
      itemCount,
      requestedIndex: index,
    });
    return false;
  }

  const safeIndex = Math.max(0, Math.min(index, itemCount - 1));
  const run = () => {
    try {
      ref.current?.scrollToIndex?.({ index: safeIndex, animated });
      addFabricBreadcrumb('safeScrollToIndex success', {
        context,
        itemCount,
        requestedIndex: index,
        safeIndex,
      });
      return true;
    } catch (error) {
      captureFabricError(error, 'safeScrollToIndex', {
        context,
        itemCount,
        requestedIndex: index,
        safeIndex,
      });
      return false;
    }
  };

  // On Fabric, some calls happen before mounting settles; run after interactions.
  let success = run();
  if (success) return true;

  InteractionManager.runAfterInteractions(() => {
    success = run();
  });
  return success;
}

export function openFullscreenWithSafeScroll({
  setVisible,
  setIndex,
  ref,
  index,
  itemCount,
  context,
  prewarm,
}: OpenFullscreenParams) {
  const safeIndex = itemCount > 0 ? Math.max(0, Math.min(index, itemCount - 1)) : 0;
  prewarm?.();
  setIndex(safeIndex);
  setVisible(true);

  addFabricBreadcrumb('openFullscreenWithSafeScroll:start', {
    context,
    requestedIndex: index,
    safeIndex,
    itemCount,
  });

  // First attempt shortly after modal visibility flip.
  setTimeout(() => {
    safeScrollToIndex({
      ref,
      index: safeIndex,
      itemCount,
      animated: false,
      context: `${context}:attempt1`,
    });
  }, 60);

  // Second attempt after interactions for slow Fabric mount devices.
  InteractionManager.runAfterInteractions(() => {
    safeScrollToIndex({
      ref,
      index: safeIndex,
      itemCount,
      animated: false,
      context: `${context}:attempt2_after_interactions`,
    });
  });
}
