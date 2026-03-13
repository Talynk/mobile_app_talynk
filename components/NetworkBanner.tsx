import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { networkStatus } from '@/lib/network-status';

type BannerState = {
  variant: 'offline' | 'online';
  message: string;
  visible: boolean;
};

export default function NetworkBanner() {
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(-140)).current;
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [banner, setBanner] = useState<BannerState>({
    variant: 'offline',
    message: '',
    visible: false,
  });

  useEffect(() => {
    const clearHideTimer = () => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    };

    const hideBanner = () => {
      clearHideTimer();
      Animated.timing(translateY, {
        toValue: -140,
        duration: 220,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) {
          setBanner((current) => ({ ...current, visible: false }));
        }
      });
    };

    const showBanner = (nextBanner: Omit<BannerState, 'visible'>, autoHide = false) => {
      clearHideTimer();
      setBanner({ ...nextBanner, visible: true });
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        damping: 18,
        stiffness: 180,
      }).start();

      if (autoHide) {
        hideTimerRef.current = setTimeout(() => {
          hideBanner();
        }, 2200);
      }
    };

    const unsubscribe = networkStatus.subscribe((status, meta) => {
      if (meta?.source === 'subscribe') {
        if (status === 'offline') {
          showBanner(
            {
              variant: 'offline',
              message: meta?.message || 'No or low internet connection. Reconnecting automatically…',
            },
            false
          );
        }
        return;
      }

      if (status === 'offline') {
        showBanner(
          {
            variant: 'offline',
            message: meta?.message || 'No or low internet connection. Reconnecting automatically…',
          },
          false
        );
      } else {
        showBanner(
          {
            variant: 'online',
            message: 'Back online.',
          },
          true
        );
      }
    });

    return () => {
      clearHideTimer();
      unsubscribe();
    };
  }, [translateY]);

  if (!banner.visible) {
    return null;
  }

  const isOffline = banner.variant === 'offline';

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.wrapper,
        {
          paddingTop: insets.top + 8,
          transform: [{ translateY }],
        },
      ]}
    >
      <View style={[styles.banner, isOffline ? styles.bannerOffline : styles.bannerOnline]}>
        <View style={styles.iconWrap}>
          {isOffline ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Feather name="wifi" size={16} color="#fff" />
          )}
        </View>
        <Text style={styles.message}>{banner.message}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  banner: {
    width: '100%',
    minHeight: 46,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  bannerOffline: {
    backgroundColor: '#b91c1c',
  },
  bannerOnline: {
    backgroundColor: '#059669',
  },
  iconWrap: {
    width: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  message: {
    flex: 1,
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
});
