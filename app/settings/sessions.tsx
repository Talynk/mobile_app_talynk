import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { router } from 'expo-router';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { settingsApi } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

const THEME = {
  bg: '#000000',
  card: '#111114',
  cardBorder: '#1e1e24',
  accent: '#60a5fa',
  accentDim: 'rgba(96, 165, 250, 0.12)',
  text: '#f3f4f6',
  textSecondary: '#71717a',
  danger: '#ef4444',
  dangerDim: 'rgba(239, 68, 68, 0.10)',
  success: '#10b981',
  successDim: 'rgba(16, 185, 129, 0.12)',
  divider: '#1c1c22',
};

interface Session {
  id: string;
  device_fingerprint_id?: string;
  user_agent?: string;
  ip_address?: string;
  created_at?: string;
  last_active_at?: string;
  revoked_at?: string | null;
}

function getDeviceInfo(userAgent: string | undefined): { icon: string; name: string } {
  if (!userAgent) return { icon: 'smartphone', name: 'Unknown Device' };
  const ua = userAgent.toLowerCase();
  if (ua.includes('iphone') || ua.includes('ios')) return { icon: 'smartphone', name: 'iPhone' };
  if (ua.includes('ipad')) return { icon: 'tablet', name: 'iPad' };
  if (ua.includes('android')) return { icon: 'smartphone', name: 'Android Device' };
  if (ua.includes('mac')) return { icon: 'monitor', name: 'Mac' };
  if (ua.includes('windows')) return { icon: 'monitor', name: 'Windows PC' };
  if (ua.includes('linux')) return { icon: 'monitor', name: 'Linux PC' };
  if (ua.includes('mobile')) return { icon: 'smartphone', name: 'Mobile Device' };
  return { icon: 'monitor', name: 'Desktop' };
}

function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return 'Unknown';
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 2) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

export default function SessionsScreen() {
  const insets = useSafeAreaInsets();
  const { logout } = useAuth();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const loadSessions = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const response = await settingsApi.getSessions();
      if (response.status === 'success' && response.data?.sessions) {
        // Filter active sessions (not revoked)
        const active = response.data.sessions.filter((s: Session) => !s.revoked_at);
        setSessions(active);
      }
    } catch (err) {
      console.warn('Failed to load sessions:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadSessions();
  }, []);

  const handleRevoke = (session: Session) => {
    const device = getDeviceInfo(session.user_agent);
    Alert.alert(
      'Revoke Session',
      `Are you sure you want to log out of ${device.name} (${session.ip_address || 'unknown IP'})?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revoke',
          style: 'destructive',
          onPress: async () => {
            setRevokingId(session.id);
            try {
              const response = await settingsApi.revokeSession(session.id);
              if (response.status === 'success') {
                setSessions(prev => prev.filter(s => s.id !== session.id));
              } else {
                Alert.alert('Error', response.message || 'Failed to revoke session');
              }
            } catch (err) {
              Alert.alert('Error', 'Failed to revoke session');
            } finally {
              setRevokingId(null);
            }
          },
        },
      ]
    );
  };

  const handleLogoutAll = () => {
    Alert.alert(
      'Log Out All Devices',
      'This will sign you out of all devices including this one. You will need to log in again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log Out All',
          style: 'destructive',
          onPress: async () => {
            setLoading(true);
            try {
              await settingsApi.logoutAll();
              await logout();
              router.replace('/auth/login');
            } catch (err) {
              Alert.alert('Error', 'Failed to log out of all devices');
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  const renderSession = ({ item, index }: { item: Session; index: number }) => {
    const device = getDeviceInfo(item.user_agent);
    const isRevoking = revokingId === item.id;

    return (
      <View style={[styles.sessionCard, index === 0 && styles.sessionCardFirst]}>
        <View style={styles.sessionIcon}>
          <Feather name={device.icon as any} size={22} color={THEME.accent} />
        </View>
        <View style={styles.sessionInfo}>
          <Text style={styles.sessionDevice}>{device.name}</Text>
          <View style={styles.sessionMeta}>
            {item.ip_address && (
              <Text style={styles.sessionMetaText}>
                <Feather name="globe" size={11} color={THEME.textSecondary} /> {item.ip_address}
              </Text>
            )}
            <Text style={styles.sessionMetaText}>
              <Feather name="clock" size={11} color={THEME.textSecondary} /> {formatDate(item.last_active_at || item.created_at)}
            </Text>
          </View>
        </View>
        <TouchableOpacity
          style={styles.revokeButton}
          onPress={() => handleRevoke(item)}
          disabled={isRevoking}
          activeOpacity={0.7}
        >
          {isRevoking ? (
            <ActivityIndicator size="small" color={THEME.danger} />
          ) : (
            <Feather name="x" size={18} color={THEME.danger} />
          )}
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} hitSlop={12}>
          <Feather name="arrow-left" size={24} color={THEME.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Active Sessions</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={THEME.accent} />
          <Text style={styles.loadingText}>Loading sessions...</Text>
        </View>
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={(item) => item.id}
          renderItem={renderSession}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); loadSessions(false); }}
              tintColor={THEME.accent}
            />
          }
          ListHeaderComponent={
            <View style={styles.listHeader}>
              <View style={styles.infoCard}>
                <Feather name="info" size={16} color={THEME.accent} />
                <Text style={styles.infoText}>
                  These are the devices currently logged into your account. Revoke any session you don't recognize.
                </Text>
              </View>
            </View>
          }
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Feather name="shield" size={48} color={THEME.textSecondary} />
              <Text style={styles.emptyTitle}>No Active Sessions</Text>
              <Text style={styles.emptySubtitle}>
                You don't have any other active sessions.
              </Text>
            </View>
          }
          ListFooterComponent={
            sessions.length > 0 ? (
              <TouchableOpacity
                style={styles.logoutAllButton}
                onPress={handleLogoutAll}
                activeOpacity={0.8}
              >
                <Feather name="log-out" size={18} color={THEME.danger} />
                <Text style={styles.logoutAllText}>Log Out of All Devices</Text>
              </TouchableOpacity>
            ) : null
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: THEME.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 12, backgroundColor: THEME.bg,
  },
  backButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20 },
  headerTitle: { color: THEME.text, fontSize: 18, fontWeight: '700', letterSpacing: 0.3 },
  listContent: { padding: 16, paddingBottom: 40 },
  // Info
  infoCard: {
    flexDirection: 'row', backgroundColor: THEME.accentDim, borderRadius: 12,
    padding: 14, gap: 10, alignItems: 'flex-start', marginBottom: 20,
  },
  infoText: { color: THEME.accent, fontSize: 13, lineHeight: 18, flex: 1 },
  listHeader: {},
  // Session Card
  sessionCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: THEME.card, borderRadius: 12,
    padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: THEME.cardBorder,
  },
  sessionCardFirst: {},
  sessionIcon: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: THEME.accentDim, alignItems: 'center', justifyContent: 'center',
  },
  sessionInfo: { flex: 1, marginLeft: 12 },
  sessionDevice: { color: THEME.text, fontSize: 15, fontWeight: '600' },
  sessionMeta: { flexDirection: 'row', gap: 12, marginTop: 4 },
  sessionMetaText: { color: THEME.textSecondary, fontSize: 12 },
  revokeButton: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: THEME.dangerDim, alignItems: 'center', justifyContent: 'center',
  },
  // Loading
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { color: THEME.textSecondary, fontSize: 14 },
  // Empty
  emptyWrap: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyTitle: { color: THEME.text, fontSize: 18, fontWeight: '700', marginTop: 8 },
  emptySubtitle: { color: THEME.textSecondary, fontSize: 14, textAlign: 'center' },
  // Logout All
  logoutAllButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: THEME.dangerDim, borderRadius: 12, height: 50,
    marginTop: 16, gap: 8, borderWidth: 1, borderColor: 'rgba(239, 68, 68, 0.2)',
  },
  logoutAllText: { color: THEME.danger, fontSize: 15, fontWeight: '700' },
});
