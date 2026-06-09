import type { RefObject } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FlatList, NativeSyntheticEvent, NativeScrollEvent } from 'react-native';

import { feedTelemetry } from '@/lib/feed-telemetry';

type PagerOptions<ItemT> = {
  itemCount: number;
  pageHeight: number;
  listRef: RefObject<FlatList<ItemT> | null>;
  screenName: string;
  onIndexSettled?: (index: number) => void;
  onIndexChanged?: (index: number) => void;
  onTransitionEnd?: () => void;
};

function normalizeHeight(height: number) {
  return Math.max(1, Math.round(height));
}

export function useVerticalSnapPager<ItemT>({
  itemCount,
  pageHeight,
  listRef,
  screenName,
  onIndexSettled,
  onIndexChanged,
  onTransitionEnd,
}: PagerOptions<ItemT>) {
  const [stablePageHeight, setStablePageHeight] = useState(() => normalizeHeight(pageHeight));

  useEffect(() => {
    const next = normalizeHeight(pageHeight);
    setStablePageHeight((current) => {
      if (current === next) {
        return current;
      }
      // After the first real measurement, ignore tiny layout jitter so snap offsets
      // do not oscillate and throw the feed back to index 0.
      if (current > 1 && Math.abs(current - next) <= 4) {
        return current;
      }
      return next;
    });
  }, [pageHeight]);

  const snapToOffsets = useMemo(
    () => Array.from({ length: Math.max(0, itemCount) }, (_, index) => index * stablePageHeight),
    [itemCount, stablePageHeight],
  );

  const resolveIndexFromOffset = useCallback((offsetY: number) => {
    if (itemCount <= 0) {
      return 0;
    }

    const rawIndex = Math.round(offsetY / stablePageHeight);
    return Math.max(0, Math.min(rawIndex, itemCount - 1));
  }, [itemCount, stablePageHeight]);

  const getItemLayout = useCallback((_: ArrayLike<ItemT> | null | undefined, index: number) => ({
    length: stablePageHeight,
    offset: stablePageHeight * index,
    index,
  }), [stablePageHeight]);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = resolveIndexFromOffset(event.nativeEvent.contentOffset.y);
    onIndexChanged?.(index);
    return index;
  }, [onIndexChanged, resolveIndexFromOffset]);

  const handleMomentumScrollEnd = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetY = event.nativeEvent.contentOffset.y;
    const nextIndex = resolveIndexFromOffset(offsetY);

    const expectedOffset = nextIndex * stablePageHeight;
    const alignmentErrorPx = Math.abs(offsetY - expectedOffset);

    feedTelemetry.trackPageAlignmentError({
      screenName,
      alignmentErrorPx,
      pageHeight: stablePageHeight,
      index: nextIndex,
    });

    onIndexSettled?.(nextIndex);
    onTransitionEnd?.();
    return nextIndex;
  }, [onIndexSettled, onTransitionEnd, resolveIndexFromOffset, screenName, stablePageHeight]);

  return {
    pageHeight: stablePageHeight,
    snapToInterval: stablePageHeight,
    snapToOffsets,
    getItemLayout,
    handleScroll,
    handleMomentumScrollEnd,
    resolveIndexFromOffset,
  };
}
