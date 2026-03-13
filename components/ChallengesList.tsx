import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    View,
    Text,
    FlatList,
    StyleSheet,
    TouchableOpacity,
    ActivityIndicator,
    RefreshControl,
    Alert,
    TextInput,
} from 'react-native';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { challengesApi } from '@/lib/api';
import { router } from 'expo-router';
import { useAuth } from '@/lib/auth-context';
import { Avatar } from './Avatar';
import { useNetworkStatus, useRefetchOnReconnect } from '@/lib/hooks/use-network-status';
import {
    formatChallengeDateTime,
    getChallengeDateInfo,
    getChallengeDisplayStatus,
} from '@/lib/utils/challenge';

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
    organizer_id?: string;
}

interface ChallengesListProps {
    onCreateChallenge: () => void;
    refreshTrigger?: number;
    activeTab?: 'created' | 'joined' | 'not-joined';
    defaultTab?: 'active' | 'upcoming' | 'ended' | 'created';
}

type ChallengesTab = 'live_upcoming' | 'ended' | 'created';

const createEmptyTabCache = (): Record<ChallengesTab, Challenge[]> => ({
    live_upcoming: [],
    ended: [],
    created: [],
});

const createEmptyLoadedTabs = (): Record<ChallengesTab, boolean> => ({
    live_upcoming: false,
    ended: false,
    created: false,
});

export default function ChallengesList({ onCreateChallenge, refreshTrigger, defaultTab }: ChallengesListProps) {
    const [challengeCache, setChallengeCache] = useState<Record<ChallengesTab, Challenge[]>>(createEmptyTabCache);
    const [loadedTabs, setLoadedTabs] = useState<Record<ChallengesTab, boolean>>(createEmptyLoadedTabs);
    const [loading, setLoading] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [internalTab, setInternalTab] = useState<ChallengesTab>('live_upcoming');
    const [joinedIds, setJoinedIds] = useState<Set<string>>(new Set());
    const [searchQuery, setSearchQuery] = useState('');
    const { user } = useAuth();
    const { isOffline } = useNetworkStatus();
    const authKey = user?.id ?? 'guest';
    const previousAuthKeyRef = useRef(authKey);
    const previousRefreshTriggerRef = useRef(refreshTrigger ?? 0);

    const challenges = useMemo(() => {
        const source = challengeCache[internalTab] || [];
        const query = searchQuery.trim().toLowerCase();

        if (!query) {
            return source;
        }

        return source.filter((challenge: any) => {
            const organizer = challenge.organizer || {};
            const haystack = [
                challenge.name,
                challenge.description,
                challenge.organizer_name,
                organizer.username,
                organizer.display_name,
            ]
                .filter(Boolean)
                .join(' ')
                .toLowerCase();

            return haystack.includes(query);
        });
    }, [challengeCache, internalTab, searchQuery]);

    const fetchChallenges = async (
        targetTab: ChallengesTab = internalTab,
        options?: { force?: boolean; pullToRefresh?: boolean }
    ) => {
        if (!options?.force && !options?.pullToRefresh && loadedTabs[targetTab]) {
            return;
        }

        try {
            if (options?.pullToRefresh) {
                setRefreshing(true);
            } else if (!loadedTabs[targetTab]) {
                setLoading(true);
            }

            let challengesToDisplay: Challenge[] = [];
            let userJoinedIds = new Set<string>();
            const now = new Date();

            if (user) {
                const joinedRes = await challengesApi.getJoinedChallenges();
                if (joinedRes.status === 'success') {
                    const joined = joinedRes.data || [];
                    Array.isArray(joined) && joined.forEach((item: any) => {
                        const challenge = item.challenge || item;
                        if (challenge?.id) {
                            userJoinedIds.add(challenge.id);
                        }
                    });
                }
                setJoinedIds(userJoinedIds);
            } else {
                setJoinedIds(new Set());
            }

            if (!user) {
                if (targetTab === 'live_upcoming') {
                    const response = await challengesApi.getAll('active');
                    if (response.status === 'success') {
                        const data = response.data?.challenges || response.data || [];
                        const all = Array.isArray(data) ? data : [];
                        challengesToDisplay = all.filter((challenge: any) => {
                            if (challenge.status !== 'approved' && challenge.status !== 'active') return false;
                            const endDate = new Date(challenge.end_date).getTime();
                            return endDate >= now.getTime();
                        });
                        challengesToDisplay.sort((a: any, b: any) => {
                            const aStart = new Date(a.start_date).getTime();
                            const bStart = new Date(b.start_date).getTime();
                            const aActive = aStart <= now.getTime() && new Date(a.end_date).getTime() >= now.getTime();
                            const bActive = bStart <= now.getTime() && new Date(b.end_date).getTime() >= now.getTime();
                            if (aActive && !bActive) return -1;
                            if (!aActive && bActive) return 1;
                            return aStart - bStart;
                        });
                    }
                } else if (targetTab === 'ended') {
                    const endedRes = await challengesApi.getEnded().catch(() => ({ status: 'success' as const, data: { challenges: [] } }));
                    if (endedRes.status === 'success' && endedRes.data?.challenges) {
                        challengesToDisplay = (endedRes.data.challenges as any[]).map((item: any) => item.challenge || item);
                    }
                }
            } else if (targetTab === 'live_upcoming') {
                const publicRes = await challengesApi.getAll('active');
                let combined: Challenge[] = [];
                if (publicRes.status === 'success') {
                    const data = publicRes.data?.challenges || publicRes.data || [];
                    const all = Array.isArray(data) ? data : [];
                    combined = all.filter((challenge: any) => challenge.status === 'approved' || challenge.status === 'active');
                }

                const activeList = combined.filter((challenge: any) => {
                    const startDate = new Date(challenge.start_date);
                    const endDate = new Date(challenge.end_date);
                    return startDate <= now && endDate >= now;
                });
                const upcomingList = combined.filter((challenge: any) => new Date(challenge.start_date) > now);

                challengesToDisplay = [...activeList, ...upcomingList].sort((a: any, b: any) => {
                    const aStart = new Date(a.start_date).getTime();
                    const bStart = new Date(b.start_date).getTime();
                    const aActive = new Date(a.start_date) <= now && new Date(a.end_date) >= now;
                    const bActive = new Date(b.start_date) <= now && new Date(b.end_date) >= now;
                    if (aActive && !bActive) return -1;
                    if (!aActive && bActive) return 1;
                    return aStart - bStart;
                });
            } else if (targetTab === 'ended') {
                const endedRes = await challengesApi.getEnded().catch(() => ({ status: 'success' as const, data: { challenges: [] } }));
                let endedChallenges: Challenge[] = [];

                if (endedRes.status === 'success' && endedRes.data?.challenges) {
                    endedChallenges = (endedRes.data.challenges as any[]).map((item: any) => item.challenge || item);
                }

                if (userJoinedIds.size > 0) {
                    const joinedRes = await challengesApi.getJoinedChallenges();
                    if (joinedRes.status === 'success') {
                        const joined = joinedRes.data || [];
                        const joinedChallenges = Array.isArray(joined)
                            ? joined.map((item: any) => item.challenge || item)
                            : [];

                        joinedChallenges.forEach((challenge: any) => {
                            if (
                                new Date(challenge.end_date) < now &&
                                challenge?.id &&
                                !endedChallenges.some((existing: any) => existing.id === challenge.id)
                            ) {
                                endedChallenges.push(challenge);
                            }
                        });
                    }
                }

                challengesToDisplay = endedChallenges.sort(
                    (a, b) => new Date(b.end_date).getTime() - new Date(a.end_date).getTime()
                );
            } else if (targetTab === 'created') {
                const [myRes, publicRes] = await Promise.all([
                    challengesApi.getMyChallenges(),
                    challengesApi.getAll('active'),
                ]);

                let myChallenges: Challenge[] = [];

                if (myRes.status === 'success') {
                    const data = myRes.data?.challenges || myRes.data || [];
                    myChallenges = Array.isArray(data) ? data : [];
                }

                if (publicRes.status === 'success') {
                    const data = publicRes.data?.challenges || publicRes.data || [];
                    const allPublic = Array.isArray(data) ? data : [];
                    const myPublic = allPublic.filter(
                        (challenge: any) => challenge.organizer?.id === user?.id || challenge.organizer_id === user?.id
                    );

                    myPublic.forEach((challenge: any) => {
                        if (!myChallenges.some((existing) => existing.id === challenge.id)) {
                            myChallenges.push(challenge);
                        }
                    });
                }

                challengesToDisplay = myChallenges.sort((a, b) => {
                    const dateA = new Date((a as any).createdAt || a.start_date).getTime();
                    const dateB = new Date((b as any).createdAt || b.start_date).getTime();
                    return dateB - dateA;
                });
            }

            setChallengeCache((prev) => ({
                ...prev,
                [targetTab]: challengesToDisplay,
            }));
            setLoadedTabs((prev) => ({
                ...prev,
                [targetTab]: true,
            }));

            if (__DEV__) {
                console.log('📋 [ChallengesList] Fetched challenges:', {
                    tab: user ? targetTab : 'ALL (unauthenticated)',
                    count: challengesToDisplay.length,
                    joinedCount: userJoinedIds.size,
                });
            }
        } catch (error: any) {
            console.warn('[ChallengesList] Error fetching challenges:', error?.message);
            setChallengeCache((prev) => ({
                ...prev,
                [targetTab]: [],
            }));
            setLoadedTabs((prev) => ({
                ...prev,
                [targetTab]: true,
            }));
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useRefetchOnReconnect(() => {
        fetchChallenges(internalTab, { force: true });
    });

    useEffect(() => {
        if (defaultTab === 'active' || defaultTab === 'upcoming') setInternalTab('live_upcoming');
        else if (defaultTab === 'ended') setInternalTab('ended');
        else if (defaultTab === 'created') setInternalTab('created');
    }, [defaultTab]);

    useEffect(() => {
        if (previousAuthKeyRef.current === authKey) {
            return;
        }

        previousAuthKeyRef.current = authKey;
        setChallengeCache(createEmptyTabCache());
        setLoadedTabs(createEmptyLoadedTabs());
        setJoinedIds(new Set());
    }, [authKey]);

    useEffect(() => {
        const currentRefreshTrigger = refreshTrigger ?? 0;
        const refreshChanged = previousRefreshTriggerRef.current !== currentRefreshTrigger;
        previousRefreshTriggerRef.current = currentRefreshTrigger;
        fetchChallenges(internalTab, { force: refreshChanged || !loadedTabs[internalTab] });
    }, [internalTab, authKey, refreshTrigger, loadedTabs]);

    useEffect(() => {
        if (internalTab === 'created') {
            setSearchQuery('');
        }
    }, [internalTab]);

    const onRefresh = () => {
        fetchChallenges(internalTab, { force: true, pullToRefresh: true });
    };

    const getChallengeStatus = (challenge: any) => {
        const status = getChallengeDisplayStatus(challenge);
        switch (status.key) {
            case 'pending':
                return { label: status.label, color: '#f59e0b' };
            case 'rejected':
                return { label: status.label, color: '#ef4444' };
            case 'ongoing':
                return { label: status.label, color: '#10b981' };
            case 'upcoming':
                return { label: status.label, color: '#60a5fa' };
            case 'ended_early':
                return { label: status.label, color: '#9ca3af' };
            case 'ended':
            case 'inactive':
            default:
                return { label: status.label, color: '#666' };
        }
    };

    const getDateInfo = (challenge: any) => {
        return getChallengeDateInfo(challenge);
    };

    const renderChallengeItem = ({ item }: { item: Challenge }) => {
        const status = getChallengeStatus(item);
        const dateInfo = getDateInfo(item);
        const organizer = (item as any).organizer || {};
        const organizerName = organizer.display_name || organizer.username || item.organizer_name || 'Unknown';
        const organizerUsername = organizer.username || '';
        const participantCount = (item as any)._count?.participants || item.participants_count || 0;
        const postCount = (item as any)._count?.posts || item.posts_count || 0;
        const isJoined = user ? joinedIds.has(item.id) : false;
        const isEnded = internalTab === 'ended' || status.label === 'Ended';
        const isOrganizer = !!user && (item.organizer_id === user.id || (item as any).organizer?.id === user.id);
        const blockNonOrganizerPending = item.status === 'pending' && !isOrganizer;

        return (
            <TouchableOpacity
                style={styles.card}
                onPress={() => {
                    if (blockNonOrganizerPending) {
                        Alert.alert(
                            'Pending Approval',
                            'This competition has not been approved yet. Please wait for administrators to approve it.'
                        );
                        return;
                    }

                    router.push({
                        pathname: '/challenges/[id]',
                        params: { id: item.id },
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
                                <Feather name="gift" size={12} color="#fff" style={styles.rewardIcon} />
                                <Text style={styles.rewardText} numberOfLines={3} ellipsizeMode="tail">
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

                {dateInfo ? (
                    <View style={styles.dateContainer}>
                        <Feather name="calendar" size={14} color="#666" />
                        <View style={styles.dateInfoBlock}>
                            <Text style={styles.dateText}>
                                {dateInfo.label} {formatChallengeDateTime(dateInfo.date, { month: 'short' })}
                            </Text>
                            {dateInfo.showEndDate && dateInfo.endDate && (
                                <Text style={styles.dateText}>
                                    Ends {formatChallengeDateTime(dateInfo.endDate, { month: 'short' })}
                                </Text>
                            )}
                        </View>
                    </View>
                ) : null}

                <View style={styles.tapForDetailsRow}>
                    <Text style={styles.tapForDetailsText}>Click here for more details</Text>
                    <Feather name="chevron-right" size={14} color="#60a5fa" />
                </View>
            </TouchableOpacity>
        );
    };

    const TABS_AUTH = [
        { key: 'live_upcoming' as const, label: 'Ongoing & Upcoming', icon: 'zap' as const },
        { key: 'ended' as const, label: 'Ended', icon: 'check-square' as const },
        { key: 'created' as const, label: 'Created by Me', icon: 'user' as const },
    ];
    const TABS_GUEST = [
        { key: 'live_upcoming' as const, label: 'Ongoing & Upcoming', icon: 'zap' as const },
        { key: 'ended' as const, label: 'Ended', icon: 'check-square' as const },
    ];
    const showSearch = internalTab !== 'created';
    const hasSearchQuery = searchQuery.trim().length > 0;

    const emptyTitle = isOffline
        ? 'No internet connection'
        : hasSearchQuery
            ? 'No competitions match your search'
            : !user
                ? 'No competitions available'
                : internalTab === 'created'
                    ? 'No competitions created yet'
                    : internalTab === 'ended'
                        ? 'No ended competitions'
                        : 'No competitions right now';

    const emptySubtitle = isOffline
        ? 'Please reconnect to load competitions.'
        : hasSearchQuery
            ? 'Try a different competition name or organizer.'
            : !user
                ? 'Check back later for new competitions!'
                : internalTab === 'created'
                    ? 'Create one to get started!'
                    : internalTab === 'ended'
                        ? 'Completed competitions will appear here'
                        : 'Check back later or create your own!';

    return (
        <View style={styles.container}>
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

            <View style={styles.tabsContainer}>
                {(user ? TABS_AUTH : TABS_GUEST).map((tab) => (
                    <TouchableOpacity
                        key={tab.key}
                        style={[
                            styles.tabButton,
                            internalTab === tab.key && styles.tabButtonActive,
                        ]}
                        onPress={() => setInternalTab(tab.key)}
                    >
                        <Feather
                            name={tab.icon}
                            size={14}
                            color={internalTab === tab.key ? '#fff' : '#888'}
                        />
                        <Text
                            style={[
                                styles.tabButtonText,
                                internalTab === tab.key && styles.tabButtonTextActive,
                            ]}
                        >
                            {tab.label}
                        </Text>
                    </TouchableOpacity>
                ))}
            </View>

            {showSearch && (
                <View style={styles.searchContainer}>
                    <Feather name="search" size={18} color="#6b7280" />
                    <TextInput
                        style={styles.searchInput}
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                        placeholder={internalTab === 'ended' ? 'Search ended competitions' : 'Search competitions'}
                        placeholderTextColor="#6b7280"
                        returnKeyType="search"
                    />
                    {hasSearchQuery && (
                        <TouchableOpacity
                            onPress={() => setSearchQuery('')}
                            style={styles.searchClearButton}
                            activeOpacity={0.8}
                        >
                            <MaterialIcons name="close" size={18} color="#9ca3af" />
                        </TouchableOpacity>
                    )}
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
                            <Feather
                                name={isOffline ? 'wifi-off' : hasSearchQuery ? 'search' : 'award'}
                                size={48}
                                color="#333"
                            />
                            <Text style={styles.emptyText}>{emptyTitle}</Text>
                            <Text style={styles.emptySubtext}>{emptySubtitle}</Text>
                            {!isOffline && !user && !hasSearchQuery && (
                                <TouchableOpacity
                                    style={styles.emptyCtaButton}
                                    onPress={() => router.push('/auth/login' as any)}
                                    activeOpacity={0.8}
                                >
                                    <Text style={styles.emptyCtaButtonText}>Login to create your own competition</Text>
                                </TouchableOpacity>
                            )}
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
        fontWeight: '700',
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
        fontWeight: '800',
        marginTop: 4,
        textAlign: 'center',
    },
    tabButtonTextActive: {
        color: '#fff',
        fontWeight: '900',
    },
    searchContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginHorizontal: 16,
        marginTop: 12,
        marginBottom: 4,
        backgroundColor: '#111827',
        borderWidth: 1,
        borderColor: '#1f2937',
        borderRadius: 14,
        paddingHorizontal: 14,
        minHeight: 48,
        gap: 10,
    },
    searchInput: {
        flex: 1,
        color: '#f3f4f6',
        fontSize: 15,
        paddingVertical: 12,
    },
    searchClearButton: {
        width: 28,
        height: 28,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#1f2937',
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
        alignItems: 'flex-start',
        alignSelf: 'flex-start',
        backgroundColor: '#f59e0b',
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: 8,
        gap: 6,
        maxWidth: 160,
        minWidth: 0,
    },
    rewardIcon: {
        marginTop: 2,
    },
    rewardText: {
        color: '#fff',
        fontSize: 11,
        fontWeight: '700',
        lineHeight: 16,
        flex: 1,
        minWidth: 0,
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
        alignItems: 'flex-start',
        gap: 6,
    },
    dateInfoBlock: {
        flex: 1,
        gap: 2,
    },
    dateText: {
        color: '#666',
        fontSize: 12,
        lineHeight: 17,
    },
    tapForDetailsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        marginTop: 10,
        paddingTop: 10,
        borderTopWidth: 1,
        borderTopColor: '#2a2a2a',
    },
    tapForDetailsText: {
        color: '#60a5fa',
        fontSize: 13,
        fontWeight: '600',
    },
    emptyContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 60,
    },
    emptyText: {
        color: '#fff',
        fontSize: 18,
        fontWeight: '700',
        marginTop: 16,
        marginBottom: 8,
        textAlign: 'center',
    },
    emptySubtext: {
        color: '#666',
        fontSize: 14,
        textAlign: 'center',
    },
    emptyCtaButton: {
        marginTop: 24,
        backgroundColor: '#60a5fa',
        paddingVertical: 12,
        paddingHorizontal: 20,
        borderRadius: 12,
    },
    emptyCtaButtonText: {
        color: '#fff',
        fontSize: 15,
        fontWeight: '600',
    },
});
