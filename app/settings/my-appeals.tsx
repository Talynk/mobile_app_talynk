import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Animated,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { reportsApi } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

interface Appeal {
  id: string;
  postId: string;
  reason: string;
  additionalInfo?: string;
  status: 'pending' | 'approved' | 'rejected';
  adminResponse?: string;
  createdAt: string;
  updatedAt?: string;
  post?: {
    id: string;
    title?: string;
    description?: string;
    thumbnail_url?: string;
  };
}

const STATUS_CONFIG = {
  pending: { label: 'Pending', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.12)', icon: 'schedule' as const },
  approved: { label: 'Approved', color: '#10b981', bg: 'rgba(16, 185, 129, 0.12)', icon: 'check-circle' as const },
  rejected: { label: 'Rejected', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.12)', icon: 'cancel' as const },
};

export default function MyAppealsScreen() {
  const [appeals, setAppeals] = useState<Appeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { user } = useAuth();
  const insets = useSafeAreaInsets();

  const loadAppeals = useCallback(async () => {
    if (!user) return;
    try {
      setLoading(true);
      const response = await reportsApi.getMyAppeals();
      if (response.status === 'success' && response.data) {
        const raw = (response.data as any).appeals || response.data;
        const list = Array.isArray(raw) ? raw : [];
        setAppeals(
          list.map((a: any) => ({
            id: a.id || a.appeal_id || String(Date.now()),
            postId: a.postId || a.post_id || '',
            reason: a.reason || a.appealReason || a.appeal_reason || '',
            additionalInfo: a.additionalInfo || a.additional_info,
            status: (a.status || 'pending').toLowerCase() as Appeal['status'],
            adminResponse: a.adminResponse || a.admin_response,
            createdAt: a.createdAt || a.created_at || new Date().toISOString(),
            updatedAt: a.updatedAt || a.updated_at,
            post: a.post,
          }))
        );
      } else {
        setAppeals([]);
      }
    } catch {
      setAppeals([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      loadAppeals();
    }, [loadAppeals])
  );

  const onRefresh = () => {
    setRefreshing(true);
    loadAppeals();
  };

  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      const now = new Date();
      const diffMs = now.getTime() - d.getTime();
      const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
      if (diffHrs < 1) return 'Just now';
      if (diffHrs < 24) return `${diffHrs}h ago`;
      const diffDays = Math.floor(diffHrs / 24);
      if (diffDays < 7) return `${diffDays}d ago`;
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return 'Recently';
    }
  };

  const renderAppeal = ({ item }: { item: Appeal }) => {
    const statusCfg = STATUS_CONFIG[item.status] || STATUS_CONFIG.pending;

    return (
      <TouchableOpacity
        style={styles.appealCard}
        activeOpacity={0.7}
        onPress={() => {
          if (item.postId) {
            router.push({ pathname: '/post/[id]', params: { id: item.postId } });
          }
        }}
      >
        {/* Status Badge + Date Row */}
        <View style={styles.cardTopRow}>
          <View style={[styles.statusBadge, { backgroundColor: statusCfg.bg }]}>
            <MaterialIcons name={statusCfg.icon} size={14} color={statusCfg.color} />
            <Text style={[styles.statusText, { color: statusCfg.color }]}>{statusCfg.label}</Text>
          </View>
          <Text style={styles.dateText}>{formatDate(item.createdAt)}</Text>
        </View>

        {/* Reason */}
        <Text style={styles.reasonText} numberOfLines={3}>
          {item.reason}
        </Text>

        {/* Admin Response */}
        {item.adminResponse && (
          <View style={styles.adminResponseBox}>
            <View style={styles.adminResponseHeader}>
              <MaterialIcons name="admin-panel-settings" size={14} color="#8b5cf6" />
              <Text style={styles.adminResponseLabel}>Admin Response</Text>
            </View>
            <Text style={styles.adminResponseText}>{item.adminResponse}</Text>
          </View>
        )}

        {/* View Post Link */}
        {item.postId && (
          <View style={styles.viewPostRow}>
            <MaterialIcons name="open-in-new" size={14} color="#60a5fa" />
            <Text style={styles.viewPostText}>View Post</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  // Shimmer loading
  const shimmerAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!loading) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(shimmerAnim, { toValue: 0, duration: 800, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [loading, shimmerAnim]);
  const shimmerOpacity = shimmerAnim.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.7] });

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} activeOpacity={0.7}>
          <MaterialIcons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Appeals</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading && appeals.length === 0 ? (
        <View style={styles.skeletonList}>
          {[1, 2, 3].map((i) => (
            <View key={i} style={styles.skeletonCard}>
              <Animated.View style={[styles.skeletonLine, { width: '30%', opacity: shimmerOpacity }]} />
              <Animated.View style={[styles.skeletonLine, { width: '90%', marginTop: 12, opacity: shimmerOpacity }]} />
              <Animated.View style={[styles.skeletonLine, { width: '60%', marginTop: 8, opacity: shimmerOpacity }]} />
            </View>
          ))}
        </View>
      ) : (
        <FlatList
          data={appeals}
          renderItem={renderAppeal}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#60a5fa" colors={['#60a5fa']} />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconBg}>
                <MaterialIcons name="gavel" size={40} color="#f59e0b" />
              </View>
              <Text style={styles.emptyTitle}>No Appeals Yet</Text>
              <Text style={styles.emptySubtext}>
                If a post of yours is suspended, you can appeal the decision and it will appear here.
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  listContent: {
    padding: 16,
    paddingBottom: 40,
  },
  appealCard: {
    backgroundColor: '#111114',
    borderRadius: 16,
    padding: 18,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  dateText: {
    color: '#666',
    fontSize: 12,
  },
  reasonText: {
    color: '#ddd',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 8,
  },
  adminResponseBox: {
    backgroundColor: 'rgba(139, 92, 246, 0.08)',
    borderRadius: 10,
    padding: 12,
    marginTop: 8,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.15)',
  },
  adminResponseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  adminResponseLabel: {
    color: '#8b5cf6',
    fontSize: 12,
    fontWeight: '600',
  },
  adminResponseText: {
    color: '#bbb',
    fontSize: 13,
    lineHeight: 18,
  },
  viewPostRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 10,
  },
  viewPostText: {
    color: '#60a5fa',
    fontSize: 13,
    fontWeight: '500',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    paddingHorizontal: 40,
  },
  emptyIconBg: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  emptyTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
  },
  emptySubtext: {
    color: '#888',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  skeletonList: {
    padding: 16,
  },
  skeletonCard: {
    backgroundColor: '#111114',
    borderRadius: 16,
    padding: 18,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  skeletonLine: {
    height: 12,
    borderRadius: 6,
    backgroundColor: '#1a1a1e',
  },
});
