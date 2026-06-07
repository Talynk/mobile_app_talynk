import { useEffect, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';

export function useAppActive() {
  const [isAppActive, setIsAppActive] = useState(AppState.currentState === 'active');

  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      setIsAppActive(nextAppState === 'active');
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    let blurSubscription: ReturnType<typeof AppState.addEventListener> | null = null;
    let focusSubscription: ReturnType<typeof AppState.addEventListener> | null = null;

    try {
      blurSubscription = AppState.addEventListener('blur' as any, () => {
        setIsAppActive(false);
      });
      focusSubscription = AppState.addEventListener('focus' as any, () => {
        setIsAppActive(AppState.currentState === 'active');
      });
    } catch (_) {
      // Android-only focus/blur events are not available on every RN runtime.
    }

    return () => {
      subscription.remove();
      blurSubscription?.remove();
      focusSubscription?.remove();
    };
  }, []);

  return isAppActive;
}
