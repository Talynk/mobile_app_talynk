import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Switch,
  Alert,
} from 'react-native';
import { router } from 'expo-router';
import { MaterialIcons, Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCache } from '@/lib/cache-context';
import { useAuth } from '@/lib/auth-context';

const SETTINGS_SECTIONS = [
  {
    title: 'Account',
    items: [
      { key: 'edit_profile', label: 'Edit Profile', icon: 'person', action: 'navigate' },
      { key: 'privacy', label: 'Privacy and Safety', icon: 'security', action: 'navigate' },
      { key: 'blocked_users', label: 'Blocked Users', icon: 'block', action: 'navigate' },
    ]
  },
  {
    title: 'Notifications',
    items: [
      { key: 'push_notifications', label: 'Push Notifications', icon: 'notifications', action: 'toggle' },
      { key: 'likes_notifications', label: 'Likes', icon: 'favorite', action: 'toggle' },
      { key: 'comments_notifications', label: 'Comments', icon: 'chat', action: 'toggle' },
      { key: 'follows_notifications', label: 'New Followers', icon: 'person-add', action: 'toggle' },
    ]
  },
  {
    title: 'Content & Display',
    items: [
      { key: 'theme', label: 'Dark Mode', icon: 'dark-mode', action: 'toggle' },
      { key: 'autoplay', label: 'Autoplay Videos', icon: 'play-circle', action: 'toggle' },
      { key: 'data_usage', label: 'Data Usage', icon: 'data-usage', action: 'navigate' },
      { key: 'content_filters', label: 'Content Filters', icon: 'filter-list', action: 'navigate' },
    ]
  },
  {
    title: 'Support',
    items: [
      { key: 'help', label: 'Help Center', icon: 'help', action: 'navigate' },
      { key: 'report_problem', label: 'Report a Problem', icon: 'report', action: 'navigate' },
      { key: 'about', label: 'About', icon: 'info', action: 'navigate' },
    ]
  },
  {
    title: 'Account Actions',
    items: [
      { key: 'logout', label: 'Log Out', icon: 'logout', action: 'logout', danger: true },
      { key: 'delete_account', label: 'Delete Account', icon: 'delete-forever', action: 'delete', danger: true },
    ]
  }
];

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { preferences, updatePreferences, clearCache } = useCache();
  const { logout } = useAuth();

  const handleToggle = async (key: string, value: boolean) => {
    switch (key) {
      case 'theme':
        await updatePreferences({ theme: value ? 'dark' : 'light' });
        break;
      case 'autoplay':
        await updatePreferences({ autoplay: value });
        break;
      case 'push_notifications':
      case 'likes_notifications':
      case 'comments_notifications':
      case 'follows_notifications':
        const notificationKey = key.replace('_notifications', '') as keyof typeof preferences.notifications;
        await updatePreferences({
          notifications: {
            ...preferences.notifications,
            [notificationKey]: value
          }
        });
        break;
    }
  };

  const handleAction = (action: string, key: string) => {
    switch (action) {
      case 'logout':
        Alert.alert(
          'Log Out',
          'Are you sure you want to log out?',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Log Out', style: 'destructive', onPress: logout }
          ]
        );
        break;
      case 'delete':
        Alert.alert(
          'Delete Account',
          'This action cannot be undone. Are you sure?',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete', style: 'destructive', onPress: () => {
              // Implement account deletion
              Alert.alert('Feature Coming Soon', 'Account deletion will be available in a future update.');
            }}
          ]
        );
        break;
      case 'navigate':
        Alert.alert('Feature Coming Soon', 'This feature will be available in a future update.');
        break;
    }
  };

  const getToggleValue = (key: string): boolean => {
    switch (key) {
      case 'theme':
        return preferences.theme === 'dark';
      case 'autoplay':
        return preferences.autoplay;
      case 'push_notifications':
        return Object.values(preferences.notifications).some(v => v);
      case 'likes_notifications':
        return preferences.notifications.likes;
      case 'comments_notifications':
        return preferences.notifications.comments;
      case 'follows_notifications':
        return preferences.notifications.follows;
      default:
        return false;
    }
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Feather name="arrow-left" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView style={styles.content}>
        {SETTINGS_SECTIONS.map((section, sectionIndex) => (
          <View key={section.title} style={styles.section}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            
            {section.items.map((item, itemIndex) => {
              const isDanger = 'danger' in item && Boolean((item as { danger?: boolean }).danger);
              return (
              <TouchableOpacity
                key={item.key}
                style={[
                  styles.settingItem,
                  itemIndex === section.items.length - 1 && styles.settingItemLast
                ]}
                onPress={() => {
                  if (item.action === 'toggle') return;
                  handleAction(item.action, item.key);
                }}
                disabled={item.action === 'toggle'}
              >
                <View style={styles.settingLeft}>
                  <MaterialIcons 
                    name={item.icon as any} 
                    size={24} 
                    color={isDanger ? '#ef4444' : '#60a5fa'} 
                  />
                  <Text style={[
                    styles.settingLabel,
                    isDanger && styles.settingLabelDanger
                  ]}>
                    {item.label}
                  </Text>
                </View>
                
                {item.action === 'toggle' ? (
                  <Switch
                    value={getToggleValue(item.key)}
                    onValueChange={(value) => handleToggle(item.key, value)}
                    trackColor={{ false: '#374151', true: '#60a5fa' }}
                    thumbColor="#fff"
                  />
                ) : (
                  <Feather name="chevron-right" size={20} color="#666" />
                )}
              </TouchableOpacity>
            );})}
          </View>
        ))}

        {/* App Info */}
        <View style={styles.appInfo}>
          <Text style={styles.appInfoText}>Talentix Social v1.0.0</Text>
          <Text style={styles.appInfoSubtext}>Made with ❤️ for creators</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: '#000000',
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  content: {
    flex: 1,
  },
  section: {
    marginBottom: 32,
  },
  sectionTitle: {
    color: '#666',
    fontSize: 14,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 12,
    marginLeft: 16,
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: '#1a1a1a',
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  settingItemLast: {
    borderBottomWidth: 0,
  },
  settingLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  settingLabel: {
    color: '#fff',
    fontSize: 16,
    marginLeft: 16,
  },
  settingLabelDanger: {
    color: '#ef4444',
  },
  appInfo: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  appInfoText: {
    color: '#666',
    fontSize: 14,
    marginBottom: 4,
  },
  appInfoSubtext: {
    color: '#666',
    fontSize: 12,
  },
});