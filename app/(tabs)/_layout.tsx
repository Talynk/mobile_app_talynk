import React from 'react';
import { Tabs, router } from 'expo-router';
import { View, TouchableOpacity, useColorScheme, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons, Feather } from '@expo/vector-icons';

import RealtimeProvider from '@/lib/realtime-context';
import { NotificationBadgeProvider, useNotificationBadge } from '@/lib/notification-badge-context';

function CustomTabBar({ state, descriptors, navigation }: { state: any; descriptors: any; navigation: any }) {
  const insets = useSafeAreaInsets();
  const bg = '#000000';
  const active = '#ffffff';
  const inactive = '#666666';
  const primary = '#60a5fa';
  const { unreadCount } = useNotificationBadge();

  const icons = [
    <Feather name="home" size={26} />, // Feed
    <Feather name="search" size={26} />, // Explore
    <Feather name="plus" size={32} color={primary} />, // Create
    <Feather name="bell" size={26} />, // Notifications
    <Feather name="user" size={26} />, // Profile
  ];

  return (
    <View style={{
      flexDirection: 'row',
      backgroundColor: bg,
      height: 60 + insets.bottom,
      paddingBottom: insets.bottom,
      alignItems: 'center',
      justifyContent: 'space-between',
      borderTopWidth: 0.5,
      borderTopColor: '#333333',
    }}>
      {state.routes.map((route: any, idx: number) => {
        const isFocused = state.index === idx;
        const onPress = () => {
          if (!isFocused) navigation.navigate(route.name);
        };

        // Center create button - opens create tab
        if (idx === 2) {
          return (
            <View key={route.key} style={{ flex: 1, alignItems: 'center' }}>
              <TouchableOpacity
                onPress={onPress}
                activeOpacity={0.8}
                style={{
                  width: 48,
                  height: 32,
                  borderRadius: 8,
                  backgroundColor: primary,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Feather name="plus" size={20} color="#000000" />
              </TouchableOpacity>
            </View>
          );
        }

        // Other tabs
        const isNotificationsTab = idx === 3; // Notifications is at index 3
        const icon = icons[idx];
        
        if (!icon) return null;
        
        return (
          <TouchableOpacity
            key={route.key}
            onPress={onPress}
            activeOpacity={0.8}
            style={{ flex: 1, alignItems: 'center', justifyContent: 'center', height: 50, position: 'relative' }}
          >
            {React.cloneElement(icon, { 
              color: isFocused ? active : inactive,
              size: isFocused ? 28 : 24
            })}
            
            {/* Notification Badge - Only show on notifications tab when there are unread notifications */}
            {isNotificationsTab && unreadCount > 0 && (
              <View style={styles.badge}>
                {unreadCount > 9 ? (
                  <Text style={styles.badgeTextPlus}>+</Text>
                ) : (
                  <Text style={styles.badgeText}>{unreadCount}</Text>
                )}
              </View>
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export default function TabLayout() {
  return (
    <View style={{ flex: 1, backgroundColor: '#000000' }}>
      <RealtimeProvider>
        <NotificationBadgeProvider>
          <Tabs
            tabBar={props => <CustomTabBar {...props} />}
            screenOptions={{
              headerShown: false,
            }}
          >
            <Tabs.Screen name="index" />
            <Tabs.Screen name="explore" />
            <Tabs.Screen name="create" />
            <Tabs.Screen name="notifications" />
            <Tabs.Screen name="profile" />
          </Tabs>
        </NotificationBadgeProvider>
      </RealtimeProvider>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    top: 2,
    right: '50%',
    marginRight: -18, // Position badge to the right of center, above the icon
    backgroundColor: '#ef4444',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#000000',
    zIndex: 10,
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 14,
    textAlign: 'center',
  },
  badgeTextPlus: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 14,
    textAlign: 'center',
  },
});