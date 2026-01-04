import React, { useRef, useCallback, useMemo, memo } from 'react';
import {
  FlatList,
  FlatListProps,
  View,
  Text,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';

interface OptimizedFlatListProps<T> extends Omit<FlatListProps<T>, 'data' | 'renderItem'> {
  /** Data array */
  data: T[];
  /** Render function for each item */
  renderItem: FlatListProps<T>['renderItem'];
  /** Unique key extractor */
  keyExtractor: (item: T, index: number) => string;
  /** Fixed item height (enables getItemLayout optimization) */
  itemHeight?: number;
  /** Loading state */
  loading?: boolean;
  /** Loading more state */
  loadingMore?: boolean;
  /** Error message */
  error?: string | null;
  /** Has more data to load */
  hasMore?: boolean;
  /** Called when reaching end of list */
  onLoadMore?: () => void;
  /** Called on pull-to-refresh */
  onRefresh?: () => void;
  /** Refreshing state */
  refreshing?: boolean;
  /** Empty list message */
  emptyMessage?: string;
  /** Empty list component */
  EmptyComponent?: React.ComponentType;
  /** Header component */
  HeaderComponent?: React.ReactElement;
  /** Footer loading indicator */
  showFooterLoader?: boolean;
  /** Accent color for loaders */
  accentColor?: string;
  /** Memory optimization level: 'low' | 'medium' | 'high' */
  memoryMode?: 'low' | 'medium' | 'high';
}

// Memory optimization presets
const MEMORY_PRESETS = {
  low: {
    windowSize: 5,
    initialNumToRender: 5,
    maxToRenderPerBatch: 5,
    updateCellsBatchingPeriod: 50,
  },
  medium: {
    windowSize: 3,
    initialNumToRender: 3,
    maxToRenderPerBatch: 3,
    updateCellsBatchingPeriod: 100,
  },
  high: {
    windowSize: 2,
    initialNumToRender: 1,
    maxToRenderPerBatch: 1,
    updateCellsBatchingPeriod: 150,
  },
};

/**
 * Memory-optimized FlatList component with built-in:
 * - Automatic virtualization configuration
 * - Loading states
 * - Pull-to-refresh
 * - Load more on scroll
 * - Empty state handling
 * - Error display
 * 
 * @example
 * <OptimizedFlatList
 *   data={posts}
 *   renderItem={({ item }) => <PostItem post={item} />}
 *   keyExtractor={item => item.id}
 *   itemHeight={600}
 *   loading={loading}
 *   loadingMore={loadingMore}
 *   hasMore={hasMore}
 *   onLoadMore={loadMore}
 *   onRefresh={refresh}
 *   refreshing={refreshing}
 *   memoryMode="high"
 * />
 */
function OptimizedFlatListComponent<T>({
  data,
  renderItem,
  keyExtractor,
  itemHeight,
  loading = false,
  loadingMore = false,
  error = null,
  hasMore = true,
  onLoadMore,
  onRefresh,
  refreshing = false,
  emptyMessage = 'No items to display',
  EmptyComponent,
  HeaderComponent,
  showFooterLoader = true,
  accentColor = '#60a5fa',
  memoryMode = 'medium',
  ...flatListProps
}: OptimizedFlatListProps<T>) {
  const flatListRef = useRef<FlatList<T>>(null);
  const isLoadingMore = useRef(false);
  const memorySettings = MEMORY_PRESETS[memoryMode];

  // Optimized getItemLayout for fixed height items
  const getItemLayout = useMemo(() => {
    if (!itemHeight) return undefined;
    
    return (_data: ArrayLike<T> | null | undefined, index: number) => ({
      length: itemHeight,
      offset: itemHeight * index,
      index,
    });
  }, [itemHeight]);

  // Handle end reached
  const handleEndReached = useCallback(() => {
    if (isLoadingMore.current || !hasMore || loading || loadingMore) return;
    
    isLoadingMore.current = true;
    onLoadMore?.();
    
    // Reset loading flag after a delay
    setTimeout(() => {
      isLoadingMore.current = false;
    }, 1000);
  }, [hasMore, loading, loadingMore, onLoadMore]);

  // Scroll handler with debounce for memory optimization
  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    flatListProps.onScroll?.(event);
  }, [flatListProps.onScroll]);

  // Empty state component
  const renderEmptyComponent = useCallback(() => {
    if (loading) {
      return (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={accentColor} />
        </View>
      );
    }

    if (error) {
      return (
        <View style={styles.centerContainer}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      );
    }

    if (EmptyComponent) {
      return <EmptyComponent />;
    }

    return (
      <View style={styles.centerContainer}>
        <Text style={styles.emptyText}>{emptyMessage}</Text>
      </View>
    );
  }, [loading, error, EmptyComponent, emptyMessage, accentColor]);

  // Footer component (loading more indicator)
  const renderFooter = useCallback(() => {
    if (!showFooterLoader || !loadingMore) return null;
    
    return (
      <View style={styles.footerLoader}>
        <ActivityIndicator size="small" color={accentColor} />
      </View>
    );
  }, [showFooterLoader, loadingMore, accentColor]);

  // Refresh control
  const refreshControl = useMemo(() => {
    if (!onRefresh) return undefined;
    
    return (
      <RefreshControl
        refreshing={refreshing}
        onRefresh={onRefresh}
        tintColor={accentColor}
        colors={[accentColor]}
        progressViewOffset={20}
      />
    );
  }, [onRefresh, refreshing, accentColor]);

  return (
    <FlatList
      ref={flatListRef}
      data={data}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      
      // Memory optimization settings
      windowSize={memorySettings.windowSize}
      initialNumToRender={memorySettings.initialNumToRender}
      maxToRenderPerBatch={memorySettings.maxToRenderPerBatch}
      updateCellsBatchingPeriod={memorySettings.updateCellsBatchingPeriod}
      removeClippedSubviews={true}
      
      // Layout optimization
      getItemLayout={getItemLayout}
      
      // Scroll optimization
      scrollEventThrottle={16}
      onScroll={handleScroll}
      
      // Load more
      onEndReached={handleEndReached}
      onEndReachedThreshold={0.5}
      
      // Pull to refresh
      refreshControl={refreshControl}
      
      // Components
      ListHeaderComponent={HeaderComponent}
      ListEmptyComponent={renderEmptyComponent}
      ListFooterComponent={renderFooter}
      
      // Performance
      maintainVisibleContentPosition={null}
      
      // Pass through remaining props
      {...flatListProps}
    />
  );
}

const styles = StyleSheet.create({
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    color: '#888',
    fontSize: 16,
    textAlign: 'center',
  },
  errorText: {
    color: '#ef4444',
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  footerLoader: {
    paddingVertical: 20,
    alignItems: 'center',
  },
});

// Memoize the component
export const OptimizedFlatList = memo(OptimizedFlatListComponent) as typeof OptimizedFlatListComponent;

export default OptimizedFlatList;



















