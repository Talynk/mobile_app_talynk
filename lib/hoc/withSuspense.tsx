import React, { Suspense, ComponentType } from 'react';
import { View, ActivityIndicator, StyleSheet, Text } from 'react-native';

interface LoadingIndicatorProps {
  message?: string;
  size?: 'small' | 'large';
  color?: string;
}

/**
 * Default loading indicator component shown during lazy loading
 */
export const LoadingIndicator: React.FC<LoadingIndicatorProps> = ({
  message = 'Loading...',
  size = 'large',
  color = '#60a5fa',
}) => (
  <View style={styles.loadingContainer}>
    <ActivityIndicator size={size} color={color} />
    {message && <Text style={styles.loadingText}>{message}</Text>}
  </View>
);

/**
 * Higher-Order Component that wraps a component with Suspense
 * for lazy loading support
 * 
 * @param Component - The component to wrap (typically from React.lazy)
 * @param fallback - Optional custom fallback component
 * @returns Wrapped component with Suspense
 * 
 * @example
 * const LazyScreen = React.lazy(() => import('./screens/HeavyScreen'));
 * const SuspendedScreen = withSuspense(LazyScreen);
 */
export const withSuspense = <P extends object>(
  Component: ComponentType<P>,
  fallback?: React.ReactNode
): ComponentType<P> => {
  const WrappedComponent = (props: P) => (
    <Suspense fallback={fallback || <LoadingIndicator />}>
      <Component {...props} />
    </Suspense>
  );

  // Copy display name for debugging
  const displayName = Component.displayName || Component.name || 'Component';
  WrappedComponent.displayName = `withSuspense(${displayName})`;

  return WrappedComponent;
};

/**
 * Creates a lazy-loaded component with Suspense wrapper in one call
 * 
 * @param importFn - Dynamic import function
 * @param fallback - Optional custom fallback
 * @returns Lazy-loaded component wrapped with Suspense
 * 
 * @example
 * const LazyFeed = createLazyComponent(() => import('./screens/Feed'));
 */
export const createLazyComponent = <P extends object>(
  importFn: () => Promise<{ default: ComponentType<P> }>,
  fallback?: React.ReactNode
): ComponentType<P> => {
  const LazyComponent = React.lazy(importFn);
  return withSuspense(LazyComponent as ComponentType<P>, fallback);
};

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#888',
  },
});

export default withSuspense;



















