import { useEffect, useRef, useCallback } from 'react';
import { AppState, AppStateStatus } from 'react-native';

type CleanupFn = () => void;
type Subscription = { remove: () => void } | { unsubscribe: () => void } | CleanupFn;

/**
 * Hook for managing subscriptions and cleanup to prevent memory leaks
 * Automatically cleans up all registered subscriptions on unmount
 * 
 * @example
 * const { registerCleanup, registerSubscription, isMounted } = useCleanup();
 * 
 * useEffect(() => {
 *   const subscription = eventEmitter.addListener('event', handler);
 *   registerSubscription(subscription);
 *   
 *   const interval = setInterval(updateData, 1000);
 *   registerCleanup(() => clearInterval(interval));
 * }, []);
 */
export const useCleanup = () => {
  const isMounted = useRef(true);
  const cleanupFunctions = useRef<Set<CleanupFn>>(new Set());
  const subscriptions = useRef<Set<Subscription>>(new Set());

  /**
   * Register a cleanup function to be called on unmount
   */
  const registerCleanup = useCallback((cleanupFn: CleanupFn) => {
    cleanupFunctions.current.add(cleanupFn);
    
    // Return unregister function
    return () => {
      cleanupFunctions.current.delete(cleanupFn);
    };
  }, []);

  /**
   * Register a subscription (with remove() or unsubscribe() method)
   */
  const registerSubscription = useCallback((subscription: Subscription) => {
    subscriptions.current.add(subscription);
    
    // Return unregister function
    return () => {
      subscriptions.current.delete(subscription);
    };
  }, []);

  /**
   * Safely execute a function only if component is mounted
   */
  const safeExecute = useCallback(<T>(fn: () => T): T | undefined => {
    if (isMounted.current) {
      return fn();
    }
    return undefined;
  }, []);

  /**
   * Safely set state only if component is mounted
   */
  const safeSetState = useCallback(<T>(setter: React.Dispatch<React.SetStateAction<T>>, value: T | ((prev: T) => T)) => {
    if (isMounted.current) {
      setter(value as T);
    }
  }, []);

  useEffect(() => {
    isMounted.current = true;

    return () => {
      isMounted.current = false;

      // Clean up all subscriptions
      subscriptions.current.forEach(subscription => {
        try {
          if (typeof subscription === 'function') {
            subscription();
          } else if ('remove' in subscription) {
            subscription.remove();
          } else if ('unsubscribe' in subscription) {
            subscription.unsubscribe();
          }
        } catch (error) {
          // Silently handle cleanup errors
        }
      });
      subscriptions.current.clear();

      // Run all cleanup functions
      cleanupFunctions.current.forEach(cleanupFn => {
        try {
          cleanupFn();
        } catch (error) {
          // Silently handle cleanup errors
        }
      });
      cleanupFunctions.current.clear();
    };
  }, []);

  return {
    isMounted: isMounted.current,
    isMountedRef: isMounted,
    registerCleanup,
    registerSubscription,
    safeExecute,
    safeSetState,
  };
};

/**
 * Hook to handle app state changes for memory management
 * Useful for clearing caches when app goes to background
 * 
 * @example
 * useAppStateMemory({
 *   onBackground: () => {
 *     // Clear non-essential caches
 *     imageCache.clear();
 *   },
 *   onForeground: () => {
 *     // Refresh data if needed
 *     refreshData();
 *   },
 * });
 */
export const useAppStateMemory = ({
  onBackground,
  onForeground,
  onInactive,
}: {
  onBackground?: () => void;
  onForeground?: () => void;
  onInactive?: () => void;
}) => {
  const appState = useRef(AppState.currentState);

  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (appState.current === 'active' && nextAppState === 'background') {
        onBackground?.();
      } else if (appState.current === 'background' && nextAppState === 'active') {
        onForeground?.();
      } else if (nextAppState === 'inactive') {
        onInactive?.();
      }
      
      appState.current = nextAppState;
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      subscription.remove();
    };
  }, [onBackground, onForeground, onInactive]);

  return appState.current;
};

export default useCleanup;



















