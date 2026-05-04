import 'react-native-reanimated';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack, router, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useCallback, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { LogBox, AppState, AppStateStatus, View, Image, ActivityIndicator, Animated, Modal, Text, TouchableOpacity, StyleSheet as RNStyleSheet, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/query-client';
import { AuthProvider } from '@/lib/auth-context';
import { CacheProvider } from '@/lib/cache-context';
import { Provider } from 'react-redux';
import { store } from '@/lib/store';
import { initializeStore } from '@/lib/store/initializeStore';
import { useFrameworkReady } from '@/hooks/useFrameworkReady';
import { imageCache } from '@/lib/utils/image-cache';
import talynkLogo from '@/assets/images/mobile-app-logo.png';
import { MuteProvider } from '@/lib/mute-context';
import { CreateFocusProvider } from '@/lib/create-focus-context';
import { VideoReadyWatcher } from '@/components/VideoReadyWatcher';
import NetworkBanner from '@/components/NetworkBanner';
import { API_BASE_URL } from '@/lib/config';
import { networkStatus } from '@/lib/network-status';
import { RealtimeProvider } from '@/lib/realtime-context';
import { NotificationBadgeProvider } from '@/lib/notification-badge-context';
import { useAuth } from '@/lib/auth-context';
import { UploadNotificationService } from '@/lib/notification-service';
import { initGlobalVideoPauseListener } from '@/lib/hooks/use-video-pause-on-blur';
import { IOS_STARTUP_FLAGS } from '@/lib/utils/ios-startup-flags';

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  // Ensure that reloading on `/modal` keeps a back button present.
  initialRouteName: '(tabs)',
};

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

// Defer Sentry init and avoid importing Sentry in dev so Expo Dev Launcher never sees React context created early (Android: "App react context shouldn't be created before").
let sentryInitialized = false;
let sentryBootPhase: 'startup' | 'fonts' | 'navigation' | 'ready' = 'startup';
// Emergency iOS launch-safe mode for preview/internal builds.
// Controlled via a dedicated flag file for one-by-one rollout.
const IOS_LAUNCH_SAFE_MODE = Platform.OS === 'ios' && IOS_STARTUP_FLAGS.launchSafeMode;
function captureSentryBootBreadcrumb(message: string) {
  if (__DEV__) return;
  try {
    const Sentry = require('@sentry/react-native');
    Sentry.addBreadcrumb({
      category: 'boot',
      level: 'info',
      message,
      data: { phase: sentryBootPhase },
    });
  } catch (_) {}
}

function installGlobalSentryHandlers() {
  if (__DEV__) return;
  const Sentry = require('@sentry/react-native');

  // Capture JS fatal + non-fatal crashes that may bypass React error boundaries.
  const errorUtils = (global as any).ErrorUtils;
  if (errorUtils?.getGlobalHandler && errorUtils?.setGlobalHandler) {
    const previousHandler = errorUtils.getGlobalHandler();
    errorUtils.setGlobalHandler((error: unknown, isFatal?: boolean) => {
      Sentry.captureException(error, {
        level: isFatal ? 'fatal' : 'error',
        tags: {
          isFatal: String(Boolean(isFatal)),
          bootPhase: sentryBootPhase,
        },
      });
      captureSentryBootBreadcrumb(`Global handler caught ${isFatal ? 'fatal' : 'non-fatal'} error`);

      if (previousHandler) {
        previousHandler(error, isFatal);
      }
    });
  }

  // Capture unhandled promise rejections.
  const onUnhandledRejection = (event: any) => {
    const reason = event?.reason ?? event;
    Sentry.captureException(reason, {
      level: 'error',
      tags: { unhandledRejection: 'true', bootPhase: sentryBootPhase },
    });
  };

  if (typeof globalThis !== 'undefined') {
    const existing = (globalThis as any).__talynkUnhandledRejectionHandlerInstalled;
    if (!existing && (globalThis as any).addEventListener) {
      try {
        (globalThis as any).addEventListener('unhandledrejection', onUnhandledRejection);
        (globalThis as any).__talynkUnhandledRejectionHandlerInstalled = true;
      } catch (_) {}
    }
  }
}

function initSentryOnce() {
  if (__DEV__ || sentryInitialized) return;
  sentryInitialized = true;
  const Sentry = require('@sentry/react-native');
  Sentry.init({
    dsn: 'https://826972301f2cf9d457818170954c4b49@o4510978923692032.ingest.de.sentry.io/4510985398452304',
    sendDefaultPii: true,
    attachStacktrace: true,
    maxBreadcrumbs: 200,
    enableAutoSessionTracking: true,
    enableNativeCrashHandling: true,
    enableAppHangTracking: true,
    enableAutoPerformanceTracing: true,
    tracesSampleRate: 1.0,
    profilesSampleRate: 1.0,
    beforeSend(event: { message?: string; environment?: string }, hint?: { originalException?: unknown }) {
      const ex = hint?.originalException as Error | undefined;
      const msg = (event.message || ex?.message || '').toString();
      // Drop only known Dev Launcher initialization noise.
      if (/App react context shouldn't be created before|DevLauncherAppLoader/.test(msg)) return null;
      return event;
    },
    ignoreErrors: ['App react context shouldn\'t be created before'],
  });
  installGlobalSentryHandlers();
  Sentry.setTag('bootPhase', sentryBootPhase);
  captureSentryBootBreadcrumb('Sentry initialized');
}

function RootLayoutInner() {
  useFrameworkReady();
  useEffect(() => {
    sentryBootPhase = 'startup';
    initSentryOnce();
  }, []);
  // --- SENTRY TEST (temporary): Uncomment below, run app once, check dashboard, then remove ---
  // useEffect(() => {
  //   Sentry.captureException(new Error('Sentry test event from Talynk app'));
  //   Sentry.captureMessage('Sentry test message from Talynk app');
  // }, []);
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    ...FontAwesome.font,
  });
  const [showSplash, setShowSplash] = useState(true);
  const spinAnim = new Animated.Value(0);

  // Expo Router uses Error Boundaries to catch errors in the navigation tree.
  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      sentryBootPhase = 'fonts';
      captureSentryBootBreadcrumb('Fonts loaded, splash animation starting');
      // Start spin animation
      Animated.loop(
        Animated.timing(spinAnim, {
          toValue: 1,
          duration: 1500,
          useNativeDriver: true,
        })
      ).start();

      // Hide splash after 2.5 seconds
      setTimeout(() => {
        setShowSplash(false);
        SplashScreen.hideAsync();
        sentryBootPhase = 'navigation';
        captureSentryBootBreadcrumb('Splash hidden, moving to navigation');
      }, 2500);
    }
  }, [loaded]);

  if (!loaded || showSplash) {
    const spin = spinAnim.interpolate({
      inputRange: [0, 1],
      outputRange: ['0deg', '360deg'],
    });

    return (
      <View style={{ flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' }}>
        <Image
          source={talynkLogo}
          style={{ width: 120, height: 120, marginBottom: 32 }}
          resizeMode="contain"
        />
        <Animated.View style={{ transform: [{ rotate: spin }] }}>
          <ActivityIndicator size={48} color="#60a5fa" />
        </Animated.View>
      </View>
    );
  }

  return <RootLayoutNav />;
}

function RootLayoutNav() {
  const theme = DarkTheme;
  const [onboardingChecked, setOnboardingChecked] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    initializeStore().catch(() => {});
    initGlobalVideoPauseListener();

    if (IOS_LAUNCH_SAFE_MODE || (Platform.OS === 'ios' && !IOS_STARTUP_FLAGS.enableStartupNotificationPermissionPrompt)) {
      captureSentryBootBreadcrumb('iOS launch-safe mode enabled: deferred notification permission prompt');
      return;
    }

    // Request notification permissions on startup (Android / non-safe mode only).
    UploadNotificationService.getInstance().requestPermissions().catch(err => {
      console.warn('Failed to ask for notification permissions on startup', err);
    });
  }, []);

  useEffect(() => {
    if (__DEV__) return;
    try {
      const Sentry = require('@sentry/react-native');
      sentryBootPhase = 'ready';
      Sentry.setTag('bootPhase', sentryBootPhase);
      Sentry.addBreadcrumb({
        category: 'navigation',
        level: 'info',
        message: `route:${pathname || 'unknown'}`,
      });
    } catch (_) {}
  }, [pathname]);

  useEffect(() => {
    AsyncStorage.getItem('talynk_has_seen_onboarding')
      .then((val) => {
        if (val !== 'true') {
          router.replace('/onboarding');
        }
      })
      .catch(() => {})
      .finally(() => setOnboardingChecked(true));
  }, []);

  // Initialize image cache (never crash app)
  useEffect(() => {
    try {
      imageCache.initialize();
    } catch (_) {}
  }, []);

  // Start video cache: iOS uses expo-video-cache (startVideoCacheServer.ios.ts); Android no-op (startVideoCacheServer.android.ts). Android bundle never references expo-video-cache.
  useEffect(() => {
    if (IOS_LAUNCH_SAFE_MODE) {
      captureSentryBootBreadcrumb('iOS launch-safe mode enabled: skipping startup video cache server');
      return;
    }
    try {
      require('@/lib/utils/startVideoCacheServer').start();
      captureSentryBootBreadcrumb('startup video cache server started');
    } catch (error) {
      captureSentryBootBreadcrumb('startup video cache server failed');
      if (!__DEV__) {
        try {
          const Sentry = require('@sentry/react-native');
          Sentry.captureException(error, {
            tags: { context: 'startup_video_cache_server' },
            level: 'error',
          });
        } catch (_) {}
      }
    }
  }, []);

  // Memory management: Clear caches when app goes to background
  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (nextAppState === 'background') {
        // Trigger garbage collection hints by clearing old cache entries
        imageCache.cleanupExpired();
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    let isDisposed = false;
    let inFlight = false;
    let retryIntervalId: ReturnType<typeof setInterval> | null = null;

    const stopRetryLoop = () => {
      if (retryIntervalId) {
        clearInterval(retryIntervalId);
        retryIntervalId = null;
      }
    };

    const checkConnectivity = async () => {
      if (
        isDisposed ||
        inFlight ||
        AppState.currentState !== 'active' ||
        networkStatus.getStatus() !== 'offline'
      ) {
        return;
      }

      inFlight = true;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      try {
        const response = await fetch(`${API_BASE_URL}/api/categories?t=${Date.now()}`, {
          method: 'GET',
          signal: controller.signal,
        });

        if (response.ok) {
          networkStatus.reportOnline({ source: 'offline-probe' });
        }
      } catch (error: any) {
        const message = String(error?.message || '');
        if (/AbortError|aborted/i.test(message)) {
          return;
        }
        if (/Network request failed|Failed to fetch/i.test(message)) {
          networkStatus.reportOffline({ source: 'offline-probe' });
          return;
        }
      } finally {
        clearTimeout(timeoutId);
        inFlight = false;
      }
    };

    const startRetryLoop = () => {
      if (retryIntervalId) {
        return;
      }

      retryIntervalId = setInterval(() => {
        void checkConnectivity();
      }, 5000);
    };

    const unsubscribe = networkStatus.subscribe((status, meta) => {
      if (meta?.source === 'subscribe') {
        if (status === 'offline') {
          startRetryLoop();
          void checkConnectivity();
        }
        return;
      }

      if (status === 'offline') {
        startRetryLoop();
        void checkConnectivity();
      } else {
        stopRetryLoop();
      }
    });

    const appStateSubscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active' && networkStatus.getStatus() === 'offline') {
        void checkConnectivity();
      }
    });

    return () => {
      isDisposed = true;
      stopRetryLoop();
      appStateSubscription.remove();
      unsubscribe();
    };
  }, []);

  // Ignore dev-only warnings
  useEffect(() => {
    LogBox.ignoreLogs([
      'Unable to activate keep awake',
      'Non-serializable values were found in the navigation state',
    ]);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
    <Provider store={store}>
      <CacheProvider>
        <MuteProvider>
          <AuthProvider>
            <RealtimeProvider>
            <NotificationBadgeProvider>
            <CreateFocusProvider>
            <ThemeProvider value={theme}>
              <View style={{ flex: 1 }}>
                <VideoReadyWatcher />
                <NetworkBanner />
                <SuspensionModal />
                <Stack
                  screenOptions={{
                    headerShown: false,
                    animation: 'none',
                    animationDuration: 0,
                  }}
                >
                  <Stack.Screen name="onboarding" options={{ headerShown: false }} />
                  <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                  <Stack.Screen name="auth" options={{ headerShown: false }} />
                  <Stack.Screen name="post/[id]" options={{ headerShown: false }} />
                  <Stack.Screen name="user/[id]" options={{ headerShown: false }} />
                  <Stack.Screen name="profile-feed/[userId]" options={{ headerShown: false }} />
                  <Stack.Screen name="search" options={{ headerShown: false }} />
                  <Stack.Screen name="category/[name]" options={{ headerShown: false }} />
                  <Stack.Screen name="challenges/[id]" options={{ headerShown: false }} />
                  <Stack.Screen name="challenges/[id]/posts" options={{ headerShown: false }} />
                  <Stack.Screen name="settings/index" options={{ headerShown: false }} />
                  <Stack.Screen name="settings/change-password" options={{ headerShown: false }} />
                  <Stack.Screen name="settings/delete-account" options={{ headerShown: false }} />
                  <Stack.Screen name="settings/sessions" options={{ headerShown: false }} />
                  <Stack.Screen name="settings/help-center" options={{ headerShown: false }} />
                  <Stack.Screen name="settings/report-problem" options={{ headerShown: false }} />
                  <Stack.Screen name="settings/about" options={{ headerShown: false }} />
                  <Stack.Screen name="settings/privacy-policy" options={{ headerShown: false }} />
                  <Stack.Screen name="settings/my-appeals" options={{ headerShown: false }} />
                </Stack>
              </View>
              <StatusBar style="light" />
            </ThemeProvider>
            </CreateFocusProvider>
            </NotificationBadgeProvider>
            </RealtimeProvider>
          </AuthProvider>
        </MuteProvider>
      </CacheProvider>
    </Provider>
    </QueryClientProvider>
  );
}

/** Full-screen modal shown when the account is suspended */
function SuspensionModal() {
  const { isSuspended, suspensionReason, clearSuspension } = useAuth();

  const handleDismiss = () => {
    clearSuspension();
    router.replace('/auth/login' as any);
  };

  if (!isSuspended) return null;

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent>
      <View style={suspensionStyles.overlay}>
        <View style={suspensionStyles.card}>
          <View style={suspensionStyles.iconWrapper}>
            <View style={suspensionStyles.iconCircle}>
              <Text style={suspensionStyles.iconText}>⚠️</Text>
            </View>
          </View>
          <Text style={suspensionStyles.title}>Account Suspended</Text>
          <Text style={suspensionStyles.message}>
            {suspensionReason || 'Your account has been suspended. Please contact support [email: contact@support.talentix.net] for more information or inquiries.'}
          </Text>
          <TouchableOpacity style={suspensionStyles.button} onPress={handleDismiss} activeOpacity={0.8}>
            <Text style={suspensionStyles.buttonText}>OK</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const suspensionStyles = RNStyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#1a1a1a',
    borderRadius: 24,
    padding: 32,
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  iconWrapper: {
    marginBottom: 20,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconText: {
    fontSize: 36,
  },
  title: {
    color: '#ef4444',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 12,
    textAlign: 'center',
  },
  message: {
    color: '#ccc',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 28,
  },
  button: {
    backgroundColor: '#ef4444',
    paddingVertical: 14,
    paddingHorizontal: 48,
    borderRadius: 14,
    width: '100%',
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});

// In dev, never load Sentry so Dev Launcher doesn't hit "App react context shouldn't be created before". In prod, wrap with Sentry.
const RootLayout = __DEV__
  ? RootLayoutInner
  : require('@sentry/react-native').wrap(RootLayoutInner);
export default RootLayout;
