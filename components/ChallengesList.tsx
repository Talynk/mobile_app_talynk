import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    FlatList,
    StyleSheet,
    TouchableOpacity,
    ActivityIndicator,
    RefreshControl,
    Image,
    Alert,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { challengesApi } from '@/lib/api';
import { router } from 'expo-router';
import { useAuth } from '@/lib/auth-context';
import { Avatar } from './Avatar';

interface Challenge {
    id: string;
    name: string;
    description: string;
    has_rewards: boolean;
    rewards?: string;
    organizer_name: string;
    start_date: string;
    end_date: string;
    participants_count?: number;
    posts_count?: number;
    cover_image?: string;
    status?: string;
}

interface ChallengesListProps {
    onCreateChallenge: () => void;
    refreshTrigger?: number;
    activeTab?: 'created' | 'joined' | 'not-joined';
    defaultTab?: 'active' | 'upcoming' | 'ended' | 'created';
}

export default function ChallengesList({ onCreateChallenge, refreshTrigger, defaultTab }: ChallengesListProps) {
    const [challenges, setChallenges] = useState<Challenge[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [internalTab, setInternalTab] = useState<'active' | 'upcoming' | 'ended' | 'created'>('active');
    const [joinedIds, setJoinedIds] = useState<Set<string>>(new Set());
    const { user } = useAuth();

    const fetchChallenges = async () => {
        try {
            setLoading(true);
            setRefreshing(true);

            let challengesToDisplay: Challenge[] = [];
            let userJoinedIds = new Set<string>();
            const now = new Date();

            // Always fetch joined challenges to show badges correctly
            if (user) {
                const joinedRes = await challengesApi.getJoinedChallenges();
                if (joinedRes.status === 'success') {
                    const joined = joinedRes.data || [];
                    Array.isArray(joined) && joined.forEach((item: any) => {
                        const ch = item.challenge || item;
                        userJoinedIds.add(ch.id);
                    });
                }
                setJoinedIds(userJoinedIds);
            }

            // For unauthenticated users: fetch ALL challenges (active, upcoming, ended)
            if (!user) {
                // getAll('active') returns 'active' + 'approved' statuses
                // Since ended challenges are still 'approved', this returns EVERYTHING (Active, Upcoming, Ended)
                const response = await challengesApi.getAll('active');
                if (response.status === 'success') {
                    const data = response.data?.challenges || response.data || [];
                    const all = Array.isArray(data) ? data : [];
                    // Show ALL challenges for unauthenticated users (no date filter)
                    challengesToDisplay = all;
                }
            } else if (internalTab === 'active') {
                // Fetch 'active' from API AND 'my-challenges'
                // We merge them to ensure:
                // 1. Public active/upcoming challenges are shown
                // 2. My own upcoming/pending challenges are shown (even if not in public list yet)
                const [publicRes, myRes] = await Promise.all([
                    challengesApi.getAll('active'),
                    challengesApi.getMyChallenges()
                ]);

                let activeChallenges: Challenge[] = [];

                // Process public challenges
                if (publicRes.status === 'success') {
                    const data = publicRes.data?.challenges || publicRes.data || [];
                    const all = Array.isArray(data) ? data : [];
                    activeChallenges = all;
                }

                // Merge my challenges if they fit the criteria
                if (myRes.status === 'success') {
                    const data = myRes.data?.challenges || myRes.data || [];
                    const myAll = Array.isArray(data) ? data : [];

                    myAll.forEach((ch: any) => {
                        if (!activeChallenges.some(a => a.id === ch.id)) {
                            activeChallenges.push(ch);
                        }
                    });
                }

                // Filter: Active = started AND not ended
                challengesToDisplay = activeChallenges.filter((ch: any) => {
                    const startDate = new Date(ch.start_date);
                    const endDate = new Date(ch.end_date);
                    return startDate <= now && endDate >= now;
                });

            } else if (internalTab === 'ended') {
                // Fetch 'active' (which returns active + approved) because ended challenges still have 'approved' status
                // We CANNOT rely on getAll('ended') as it returns empty
                const response = await challengesApi.getAll('active');
                let endedChallenges: Challenge[] = [];

                if (response.status === 'success') {
                    const data = response.data?.challenges || response.data || [];
                    const all = Array.isArray(data) ? data : [];
                    // Filter for ended challenges
                    endedChallenges = all.filter((ch: any) => new Date(ch.end_date) < now);
                }

                // Also include any JOINED challenges that have ended (even if not in public list)
                if (userJoinedIds.size > 0) {
                    const joinedRes = await challengesApi.getJoinedChallenges();
                    if (joinedRes.status === 'success') {
                        const joined = joinedRes.data || [];
                        const joinedChallenges = Array.isArray(joined) ? joined.map((item: any) => item.challenge || item) : [];

                        // Add joined ended challenges to the list if not already present
                        joinedChallenges.forEach((ch: any) => {
                            if (new Date(ch.end_date) < now) {
                                if (!endedChallenges.some(e => e.id === ch.id)) {
                                    endedChallenges.push(ch);
                                }
                            }
                        });
                    }
                }

                challengesToDisplay = endedChallenges;

            } else if (internalTab === 'upcoming') {
                // Fetch approved challenges that haven't started yet
                const response = await challengesApi.getAll('active');
                let upcomingChallenges: Challenge[] = [];

                if (response.status === 'success') {
                    const data = response.data?.challenges || response.data || [];
                    const all = Array.isArray(data) ? data : [];
                    // Upcoming = approved/active status BUT start_date is in the future
                    upcomingChallenges = all.filter((ch: any) => new Date(ch.start_date) > now);
                }

                challengesToDisplay = upcomingChallenges;

            } else if (internalTab === 'created') {
                // Fetch user's CREATED challenges
                // We fetch both specific 'my-challenges' endpoint AND public 'active' list
                // This ensures we get:
                // 1. Pending/Rejected challenges (from my-challenges)
                // 2. Ended/Approved challenges (from active list, in case my-challenges filters them out)
                const [myRes, publicRes] = await Promise.all([
                    challengesApi.getMyChallenges(),
                    challengesApi.getAll('active')
                ]);

                let myChallenges: Challenge[] = [];

                if (myRes.status === 'success') {
                    const data = myRes.data?.challenges || myRes.data || [];
                    myChallenges = Array.isArray(data) ? data : [];
                }

                if (publicRes.status === 'success') {
                    const data = publicRes.data?.challenges || publicRes.data || [];
                    const allPublic = Array.isArray(data) ? data : [];

                    // Find my challenges in public list
                    const myPublic = allPublic.filter((ch: any) =>
                        ch.organizer?.id === user?.id || ch.organizer_id === user?.id
                    );

                    // Merge unique challenges
                    myPublic.forEach((ch: any) => {
                        if (!myChallenges.some(m => m.id === ch.id)) {
                            myChallenges.push(ch);
                        }
                    });
                }

                challengesToDisplay = myChallenges;
            }

            // Sort by creation date (newest first)
            challengesToDisplay.sort((a, b) => {
                const dateA = new Date((a as any).createdAt || a.start_date).getTime();
                const dateB = new Date((b as any).createdAt || b.start_date).getTime();
                return dateB - dateA;
            });

            setChallenges(challengesToDisplay);

            if (__DEV__) {
                console.log('📋 [ChallengesList] Fetched challenges:', {
                    tab: user ? internalTab : 'ALL (unauthenticated)',
                    count: challengesToDisplay.length,
                    joinedCount: userJoinedIds.size,
                });
            }
        } catch (error) {
            console.error('[ChallengesList] Error fetching challenges:', error);
            setChallenges([]);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => {
        fetchChallenges();
    }, [internalTab, user, refreshTrigger]);

    // Switch tab when parent requests it (e.g., after creating a challenge)
    useEffect(() => {
        if (defaultTab) {
            setInternalTab(defaultTab);
        }
    }, [defaultTab]);

    const onRefresh = () => {
        setRefreshing(true);
        fetchChallenges();
    };

    const getChallengeStatus = (challenge: any) => {
        // Check explicit status field first (important for "Created by Me" tab)
        if (challenge.status === 'pending' || challenge.status === 'draft') {
            return { label: 'Pending Review', color: '#f59e0b' };
        }
        if (challenge.status === 'rejected') {
            return { label: 'Rejected', color: '#ef4444' };
        }

        // Use is_currently_active field from API if available
        if (challenge.is_currently_active !== undefined) {
            if (challenge.is_currently_active) {
                return { label: 'Active', color: '#10b981' };
            } else {
                const now = new Date();
                const startDate = new Date(challenge.start_date);
                const endDate = new Date(challenge.end_date);

                if (now < startDate) return { label: 'Upcoming', color: '#60a5fa' };
                if (now > endDate) return { label: 'Ended', color: '#666' };
                return { label: 'Inactive', color: '#666' };
            }
        }

        // Fallback to date-based logic
        const now = new Date();
        const startDate = new Date(challenge.start_date);
        const endDate = new Date(challenge.end_date);

        if (challenge.status === 'approved' && now < startDate) return { label: 'Approved', color: '#60a5fa' };
        if (now < startDate) return { label: 'Upcoming', color: '#60a5fa' };
        if (now > endDate) return { label: 'Ended', color: '#666' };
        return { label: 'Active', color: '#10b981' };
    };

    const getDateInfo = (challenge: any) => {
        const now = new Date();
        const startDate = new Date(challenge.start_date);
        const endDate = new Date(challenge.end_date);

        if (now >= startDate && now <= endDate) {
            return {
                label: 'Started on',
                date: startDate,
                showEndDate: true,
                endDate: endDate,
            };
        } else if (now < startDate) {
            return {
                label: 'Starts on',
                date: startDate,
                showEndDate: true,
                endDate: endDate,
            };
        } else {
            return {
                label: 'Ended on',
                date: endDate,
                showEndDate: false,
                endDate: endDate,
            };
        }
    };

    const formatDate = (dateString: string) => {
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
    };

    const renderChallengeItem = ({ item }: { item: Challenge }) => {
        const status = getChallengeStatus(item);
        const dateInfo = getDateInfo(item);
        const organizer = (item as any).organizer || {};
        const organizerName = organizer.display_name || organizer.username || item.organizer_name || 'Unknown';
        const organizerUsername = organizer.username || '';
        const participantCount = (item as any)._count?.participants || item.participants_count || 0;
        const postCount = (item as any)._count?.posts || item.posts_count || 0;

        // Check if user has joined this challenge (for showing badge)
        const isJoined = user ? joinedIds.has(item.id) : false;
        const isEnded = internalTab === 'ended' || status.label === 'Ended';

        return (
            <TouchableOpacity
                style={styles.card}
                onPress={() => {
                    if (item.status === 'pending') {
                        Alert.alert(
                            'Pending Approval',
                            'This competition hasn\'t been approved yet. Please wait for administrators to approve it.'
                        );
                        return;
                    }
                    router.push({
                        pathname: '/challenges/[id]',
                        params: { id: item.id }
                    });
                }}
            >
                <View style={styles.cardHeader}>
                    <View style={styles.headerContent}>
                        <View style={styles.iconContainer}>
                            <Feather name="award" size={24} color="#60a5fa" />
                        </View>
                        <View style={styles.headerText}>
                            <Text style={styles.title}>{item.name}</Text>
                            {(organizer.id || item.organizer_name) && (
                                <View style={styles.organizerRow}>
                                    <Avatar
                                        user={organizer.id ? organizer : { profile_picture: null, username: item.organizer_name }}
                                        size={20}
                                        style={styles.organizerAvatar}
                                    />
                                    <Text style={styles.organizer}>
                                        {organizerName}
                                        {organizerUsername && ` @${organizerUsername}`}
                                    </Text>
                                </View>
                            )}
                        </View>
                    </View>
                    <View style={styles.badgesContainer}>
                        {/* "JOINED" badge for active tab when user has joined */}
                        {isJoined && !isEnded && (
                            <View style={styles.joinedBadge}>
                                <Feather name="check-circle" size={12} color="#fff" />
                                <Text style={styles.joinedBadgeText}>Joined</Text>
                            </View>
                        )}
                        <View style={[styles.statusBadge, { backgroundColor: status.color }]}>
                            <Text style={styles.statusText}>{status.label}</Text>
                        </View>
                        {item.status === 'pending' && (
                            <View style={styles.pendingBadge}>
                                <Feather name="clock" size={12} color="#fff" />
                                <Text style={styles.pendingText}>Pending</Text>
                            </View>
                        )}
                        {item.has_rewards && (
                            <View style={styles.rewardBadge}>
                                <Feather name="gift" size={12} color="#fff" />
                                <Text style={styles.rewardText}>
                                    {item.rewards || 'Rewards'}
                                </Text>
                            </View>
                        )}
                    </View>
                </View>

                {item.description && (
                    <Text style={styles.description} numberOfLines={3}>
                        {item.description}
                    </Text>
                )}

                <View style={styles.footer}>
                    <View style={styles.stat}>
                        <Feather name="users" size={14} color="#666" />
                        <Text style={styles.statText}>{participantCount} {participantCount === 1 ? 'participant' : 'participants'}</Text>
                    </View>
                    <View style={styles.stat}>
                        <Feather name="image" size={14} color="#666" />
                        <Text style={styles.statText}>{postCount} {postCount === 1 ? 'post' : 'posts'}</Text>
                    </View>
                </View>

                <View style={styles.dateContainer}>
                    <Feather name="calendar" size={14} color="#666" />
                    <Text style={styles.dateText}>
                        {dateInfo.label} {formatDate(dateInfo.date.toISOString())}
                    </Text>
                    {dateInfo.showEndDate && (
                        <Text style={styles.dateText}>
                            {' • '}Ends {formatDate(dateInfo.endDate.toISOString())}
                        </Text>
                    )}
                </View>
            </TouchableOpacity>
        );
    };

    const TABS = [
        { key: 'active' as const, label: 'Active', icon: 'zap' as const },
        { key: 'upcoming' as const, label: 'Upcoming', icon: 'clock' as const },
        { key: 'ended' as const, label: 'Ended', icon: 'check-square' as const },
        { key: 'created' as const, label: 'Created by Me', icon: 'user' as const },
    ];

    return (
        <View style={styles.container}>
            {/* Only show Create button for authenticated users */}
            {user && (
                <View style={styles.actionsContainer}>
                    <TouchableOpacity
                        style={styles.createButton}
                        onPress={onCreateChallenge}
                    >
                        <Feather name="plus" size={20} color="#fff" />
                        <Text style={styles.createButtonText}>Create Competition</Text>
                    </TouchableOpacity>
                </View>
            )}

            {/* Tabs for authenticated users only */}
            {user && (
                <View style={styles.tabsContainer}>
                    {TABS.map((tab) => (
                        <TouchableOpacity
                            key={tab.key}
                            style={[
                                styles.tabButton,
                                internalTab === tab.key && styles.tabButtonActive
                            ]}
                            onPress={() => setInternalTab(tab.key)}
                        >
                            <Feather
                                name={tab.icon}
                                size={14}
                                color={internalTab === tab.key ? '#fff' : '#888'}
                            />
                            <Text style={[
                                styles.tabButtonText,
                                internalTab === tab.key && styles.tabButtonTextActive
                            ]}>
                                {tab.label}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </View>
            )}

            {loading && challenges.length === 0 ? (
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color="#60a5fa" />
                </View>
            ) : (
                <FlatList
                    data={challenges}
                    renderItem={renderChallengeItem}
                    keyExtractor={(item) => item.id}
                    contentContainerStyle={styles.listContent}
                    refreshControl={
                        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#60a5fa" />
                    }
                    ListEmptyComponent={
                        <View style={styles.emptyContainer}>
                            <Feather name="award" size={48} color="#333" />
                            <Text style={styles.emptyText}>
                                {!user ? 'No competitions available' :
                                    internalTab === 'created' ? 'No competitions created yet' :
                                        internalTab === 'ended' ? 'No ended competitions' :
                                            internalTab === 'upcoming' ? 'No upcoming competitions' :
                                                'No active competitions'}
                            </Text>
                            <Text style={styles.emptySubtext}>
                                {!user ? 'Check back later for new competitions!' :
                                    internalTab === 'created' ? 'Create one to get started!' :
                                        internalTab === 'ended' ? 'Completed competitions will appear here' :
                                            internalTab === 'upcoming' ? 'Approved competitions that haven\'t started will appear here' :
                                                'Check back later or create your own!'}
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
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#000',
    },
    actionsContainer: {
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#1a1a1a',
    },
    createButton: {
        backgroundColor: '#60a5fa',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 12,
        borderRadius: 12,
        gap: 8,
    },
    createButtonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '600',
    },
    tabsContainer: {
        flexDirection: 'row',
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: '#1a1a1a',
        gap: 8,
    },
    tabButton: {
        flex: 1,
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 8,
        backgroundColor: '#1a1a1a',
        alignItems: 'center',
    },
    tabButtonActive: {
        backgroundColor: '#60a5fa',
    },
    tabButtonText: {
        color: '#666',
        fontSize: 13,
        fontWeight: '500',
    },
    tabButtonTextActive: {
        color: '#fff',
        fontWeight: '600',
    },
    listContent: {
        padding: 16,
        paddingBottom: 100,
    },
    card: {
        backgroundColor: '#1a1a1a',
        borderRadius: 16,
        padding: 16,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: '#333',
    },
    cardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 12,
        flexWrap: 'wrap',
        gap: 8,
    },
    headerContent: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'flex-start',
    },
    iconContainer: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: 'rgba(96, 165, 250, 0.1)',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    headerText: {
        flex: 1,
        minWidth: 0,
        marginRight: 8,
    },
    title: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '700',
        marginBottom: 2,
    },
    organizerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 4,
    },
    organizerAvatar: {
        width: 20,
        height: 20,
        borderRadius: 10,
        marginRight: 6,
    },
    organizer: {
        color: '#666',
        fontSize: 12,
    },
    badgesContainer: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'flex-start',
        justifyContent: 'flex-end',
        gap: 6,
        flexShrink: 0,
        marginTop: 4,
        width: 150,
    },
    joinedBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#10b981',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 12,
        gap: 4,
    },
    joinedBadgeText: {
        color: '#fff',
        fontSize: 11,
        fontWeight: '600',
    },
    pendingBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#6b7280',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 8,
        gap: 4,
        width: 72,
        maxWidth: 72,
    },
    pendingText: {
        color: '#fff',
        fontSize: 10,
        fontWeight: '700',
    },
    rewardBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#f59e0b',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 8,
        gap: 4,
        flexShrink: 0,
        width: 72,
        maxWidth: 72,
    },
    rewardText: {
        color: '#fff',
        fontSize: 10,
        fontWeight: '700',
    },
    statusBadge: {
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 8,
        flexShrink: 0,
        width: 72,
        maxWidth: 72,
    },
    statusText: {
        color: '#fff',
        fontSize: 10,
        fontWeight: '700',
    },
    description: {
        color: '#ccc',
        fontSize: 14,
        lineHeight: 20,
        marginBottom: 16,
    },
    footer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderTopWidth: 1,
        borderTopColor: '#333',
        paddingTop: 12,
    },
    stat: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    statText: {
        color: '#666',
        fontSize: 12,
    },
    dateContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    dateText: {
        color: '#666',
        fontSize: 12,
    },
    emptyContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 60,
    },
    emptyText: {
        color: '#fff',
        fontSize: 18,
        fontWeight: '600',
        marginTop: 16,
        marginBottom: 8,
    },
    emptySubtext: {
        color: '#666',
        fontSize: 14,
    },
});
