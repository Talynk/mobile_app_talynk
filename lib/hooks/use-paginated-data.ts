import { useState, useCallback, useRef, useEffect } from 'react';

interface UsePaginatedDataOptions<T> {
  /** Fetch function that returns paginated data */
  fetchFn: (page: number, limit: number) => Promise<{ data: T[]; hasMore: boolean }>;
  /** Items per page */
  pageSize?: number;
  /** Maximum pages to keep in memory (older pages are discarded) */
  maxPagesInMemory?: number;
  /** Auto-load first page on mount */
  autoLoad?: boolean;
}

interface UsePaginatedDataReturn<T> {
  /** Current data array */
  data: T[];
  /** Loading state for initial load */
  loading: boolean;
  /** Loading state for loading more */
  loadingMore: boolean;
  /** Whether there's more data to load */
  hasMore: boolean;
  /** Current page number */
  page: number;
  /** Error state */
  error: string | null;
  /** Load more data */
  loadMore: () => Promise<void>;
  /** Refresh data (resets to page 1) */
  refresh: () => Promise<void>;
  /** Clear all data */
  clear: () => void;
}

/**
 * Memory-conscious paginated data hook
 * Automatically manages memory by limiting pages kept in memory
 * 
 * @example
 * const { data, loading, loadMore, refresh } = usePaginatedData({
 *   fetchFn: async (page, limit) => {
 *     const response = await api.getPosts(page, limit);
 *     return { data: response.posts, hasMore: response.hasNext };
 *   },
 *   pageSize: 20,
 *   maxPagesInMemory: 5,
 * });
 */
export const usePaginatedData = <T extends { id: string | number }>({
  fetchFn,
  pageSize = 20,
  maxPagesInMemory = 5,
  autoLoad = true,
}: UsePaginatedDataOptions<T>): UsePaginatedDataReturn<T> => {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  
  const isMounted = useRef(true);
  const isLoadingRef = useRef(false);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const loadData = useCallback(async (pageNum: number, isRefresh = false) => {
    if (isLoadingRef.current) return;
    
    isLoadingRef.current = true;
    
    try {
      if (pageNum === 1 || isRefresh) {
        setLoading(true);
      } else {
        setLoadingMore(true);
      }
      setError(null);

      const result = await fetchFn(pageNum, pageSize);

      if (!isMounted.current) return;

      const newData = result.data;
      setHasMore(result.hasMore && newData.length === pageSize);

      if (pageNum === 1 || isRefresh) {
        setData(newData);
      } else {
        setData(prevData => {
          // Combine and deduplicate by id
          const combined = [...prevData, ...newData];
          const unique = combined.filter((item, index, self) =>
            index === self.findIndex(t => t.id === item.id)
          );
          
          // Memory management: keep only recent pages
          const maxItems = pageSize * maxPagesInMemory;
          if (unique.length > maxItems) {
            return unique.slice(-maxItems);
          }
          return unique;
        });
      }

      setPage(pageNum);
    } catch (err: any) {
      if (!isMounted.current) return;
      setError(err.message || 'Failed to load data');
      console.error('[usePaginatedData] Error:', err);
    } finally {
      if (isMounted.current) {
        setLoading(false);
        setLoadingMore(false);
      }
      isLoadingRef.current = false;
    }
  }, [fetchFn, pageSize, maxPagesInMemory]);

  const loadMore = useCallback(async () => {
    if (loadingMore || loading || !hasMore) return;
    await loadData(page + 1);
  }, [loadData, page, loadingMore, loading, hasMore]);

  const refresh = useCallback(async () => {
    setHasMore(true);
    await loadData(1, true);
  }, [loadData]);

  const clear = useCallback(() => {
    setData([]);
    setPage(1);
    setHasMore(true);
    setError(null);
  }, []);

  // Auto-load on mount
  useEffect(() => {
    if (autoLoad) {
      loadData(1);
    }
  }, [autoLoad]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    data,
    loading,
    loadingMore,
    hasMore,
    page,
    error,
    loadMore,
    refresh,
    clear,
  };
};

export default usePaginatedData;



















