import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { networkStatus } from '@/lib/network-status';
import { API_BASE_URL } from '@/lib/config';
import { queryClient } from '@/lib/query-client';

const PING_INTERVAL_OFFLINE = 3000;
const PING_TIMEOUT = 5000;
const BACK_ONLINE_DISPLAY_MS = 2000;

export default function NetworkBanner() {
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState(false);
  const [backOnline, setBackOnline] = useState(false);
  const slideAnim = useRef(new Animated.Value(-80)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasOfflineRef = useRef(false);

  const showBanner = () => {
    setVisible(true);
    setBackOnline(false);
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(opacityAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const hideBanner = () => {
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: -80,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(opacityAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setVisible(false);
      setBackOnline(false);
    });
  };

  const showBackOnlineThenHide = () => {
    setBackOnline(true);
    hideTimerRef.current = setTimeout(() => {
      hideBanner();
    }, BACK_ONLINE_DISPLAY_MS);
  };

  const pingServer = async (): Promise<boolean> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PING_TIMEOUT);
    try {
      const res = await fetch(`${API_BASE_URL}/api/health`, {
        method: 'HEAD',
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return res.ok || res.status < 500;
    } catch {
      clearTimeout(timeout);
      return false;
    }
  };

  const startPolling = () => {
    stopPolling();
    pingRef.current = setInterval(async () => {
      const isOnline = await pingServer();
      if (isOnline) {
        networkStatus.reportOnline({ source: 'network-banner-ping' });
      }
    }, PING_INTERVAL_OFFLINE);
  };

  const stopPolling = () => {
    if (pingRef.current) {
      clearInterval(pingRef.current);
      pingRef.current = null;
    }
  };

  useEffect(() => {
    const unsubscribe = networkStatus.subscribe((status) => {
      if (status === 'offline') {
        wasOfflineRef.current = true;
        if (hideTimerRef.current) {
          clearTimeout(hideTimerRef.current);
          hideTimerRef.current = null;
        }
        showBanner();
        startPolling();
      } else if (status === 'online' && wasOfflineRef.current) {
        wasOfflineRef.current = false;
        stopPolling();
        showBackOnlineThenHide();
        queryClient.refetchQueries();
      }
    });

    return () => {
      unsubscribe();
      stopPolling();
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  if (!visible) return null;

  const topPadding = insets.top > 0 ? insets.top : Platform.OS === 'android' ? 24 : 20;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.container,
        {
          paddingTop: topPadding,
          backgroundColor: backOnline ? '#16a34a' : '#dc2626',
          transform: [{ translateY: slideAnim }],
          opacity: opacityAnim,
        },
      ]}
    >
      <Feather
        name={backOnline ? 'wifi' : 'wifi-off'}
        size={14}
        color="#fff"
        style={styles.icon}
      />
      <Text style={styles.text}>
        {backOnline ? 'Back online' : 'No internet connection'}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 99999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 8,
  },
  icon: {
    marginRight: 6,
  },
  text: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
});
