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
        // On Android, 'blur' fires for ANY window-focus loss — including opening
        // our own <Modal> (the fullscreen competition/profile feed viewers). That
        // false "inactive" signal tore down the active video player mid-load, so
        // the first posts showed only a frozen frame. Only treat blur as inactive
        // when the app is genuinely no longer active; real backgrounding is
        // already reported by the 'change' event below.
        if (AppState.currentState !== 'active') {
          setIsAppActive(false);
        }
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
