import FontAwesome from '@expo/vector-icons/FontAwesome';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useCallback, useState } from 'react';
import 'react-native-reanimated';
import { StatusBar } from 'expo-status-bar';
import { LogBox, AppState, AppStateStatus, View, Image, ActivityIndicator, Animated } from 'react-native';

import { AuthProvider } from '@/lib/auth-context';
import { CacheProvider } from '@/lib/cache-context';
import { Provider } from 'react-redux';
import { store } from '@/lib/store';
import { initializeStore } from '@/lib/store/initializeStore';
import { useFrameworkReady } from '@/hooks/useFrameworkReady';
import { imageCache } from '@/lib/utils/image-cache';
import talynkLogo from '@/assets/images/mobile-app-logo.png';

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

export default function RootLayout() {
  useFrameworkReady();
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
  // Force dark theme
  const theme = DarkTheme;

  // Initialize Redux store from AsyncStorage
  useEffect(() => {
    initializeStore();
  }, []);

  // Initialize image cache
  useEffect(() => {
    imageCache.initialize();
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

  // Ignore dev-only warnings
  useEffect(() => {
    LogBox.ignoreLogs([
      'Unable to activate keep awake',
      'Non-serializable values were found in the navigation state',
    ]);
  }, []);

  return (
    <Provider store={store}>
      <CacheProvider>
        <AuthProvider>
          <ThemeProvider value={theme}>
            <Stack 
              screenOptions={{ 
                headerShown: false,
                // Animation optimization
                animation: 'fade',
              }}
            >
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="auth" options={{ headerShown: false }} />
              <Stack.Screen 
                name="post/[id]" 
                options={{ 
                  headerShown: false,
                }} 
              />
              <Stack.Screen 
                name="user/[id]" 
                options={{ 
                  headerShown: false,
                }} 
              />
              <Stack.Screen 
                name="profile-feed/[userId]" 
                options={{ 
                  headerShown: false,
                }} 
              />
              <Stack.Screen name="search" options={{ headerShown: false }} />
              <Stack.Screen name="category/[name]" options={{ headerShown: false }} />
            </Stack>
            <StatusBar style="light" />
          </ThemeProvider>
        </AuthProvider>
      </CacheProvider>
    </Provider>
  );
}