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
}

export default function ChallengesList({ onCreateChallenge, refreshTrigger, activeTab = 'created' }: ChallengesListProps) {
    const [challenges, setChallenges] = useState<Challenge[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const { user } = useAuth();

    const fetchChallenges = async () => {
        try {
            setLoading(true);
            setRefreshing(true);

            if (!user) {
                setChallenges([]);
                setLoading(false);
                setRefreshing(false);
                return;
            }

            let challengesToDisplay: Challenge[] = [];

            if (activeTab === 'created') {
                // Fetch NOT-JOINED challenges (user hasn't created or joined)
                const allResponse = await challengesApi.getAll('active');
                const createdResponse = await challengesApi.getMyChallenges();
                const joinedResponse = await challengesApi.getJoinedChallenges();

                let allChallenges: Challenge[] = [];
                if (allResponse.status === 'success') {
                    const data = allResponse.data?.challenges || allResponse.data || [];
                    allChallenges = Array.isArray(data) ? data : [];
                }

                const createdIds = new Set<string>();
                if (createdResponse.status === 'success') {
                    const created = createdResponse.data?.challenges || [];
                    Array.isArray(created) && created.forEach((ch: any) => createdIds.add(ch.id));
                }

                const joinedIds = new Set<string>();
                if (joinedResponse.status === 'success') {
                    const joined = joinedResponse.data || [];
                    Array.isArray(joined) && joined.forEach((item: any) => {
                        const ch = item.challenge || item;
                        joinedIds.add(ch.id);
                    });
                }

                // Filter: not created by user AND not joined by user
                challengesToDisplay = allChallenges.filter((ch: any) => 
                    !createdIds.has(ch.id) && !joinedIds.has(ch.id)
                );
            } else if (activeTab === 'joined') {
                // Fetch user's joined challenges
                const response = await challengesApi.getJoinedChallenges();
                if (response.status === 'success') {
                    const data = response.data || [];
                    // Extract challenge from participations wrapper if needed
                    challengesToDisplay = Array.isArray(data) 
                        ? data.map((item: any) => item.challenge || item)
                        : [];
                }
            } else if (activeTab === 'not-joined') {
                // Fetch user's CREATED challenges
                const response = await challengesApi.getMyChallenges();
                if (response.status === 'success') {
                    const data = response.data?.challenges || response.data || [];
                    challengesToDisplay = Array.isArray(data) ? data : [];
                }
            }

            // Sort by creation date (newest first)
            challengesToDisplay.sort((a, b) => {
                const dateA = new Date((a as any).createdAt || a.start_date).getTime();
                const dateB = new Date((b as any).createdAt || b.start_date).getTime();
                return dateB - dateA;
            });

            setChallenges(challengesToDisplay);

            if (__DEV__) {
                console.log('📋 [ChallengesList] Fetched challenges for tab:', {
                    tab: activeTab,
                    count: challengesToDisplay.length,
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
    }, [activeTab, user, refreshTrigger]);

    const onRefresh = () => {
        setRefreshing(true);
        fetchChallenges();
    };

    const getChallengeStatus = (challenge: any) => {
        // Use is_currently_active field from API if available
        if (challenge.is_currently_active !== undefined) {
            if (challenge.is_currently_active) {
                return { label: 'Active', color: '#10b981' };
            } else {
                const now = new Date();
                const startDate = new Date(challenge.start_date);
                const endDate = new Date(challenge.end_date);
                
                if (now < startDate) return { label: 'Upcoming', color: '#f59e0b' };
                if (now > endDate) return { label: 'Ended', color: '#666' };
                return { label: 'Inactive', color: '#666' };
            }
        }
        
        // Fallback to date-based logic
        const now = new Date();
        const startDate = new Date(challenge.start_date);
        const endDate = new Date(challenge.end_date);
        
        if (now < startDate) return { label: 'Upcoming', color: '#f59e0b' };
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
        
        return (
            <TouchableOpacity
                style={styles.card}
                onPress={() => {
                    const { router } = require('expo-router');
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

    const filteredChallenges = challenges;

    return (
        <View style={styles.container}>
            <View style={styles.actionsContainer}>
                <TouchableOpacity
                    style={styles.createButton}
                    onPress={onCreateChallenge}
                >
                    <Feather name="plus" size={20} color="#fff" />
                    <Text style={styles.createButtonText}>Create Competition</Text>
                </TouchableOpacity>
            </View>

            <FlatList
                data={filteredChallenges}
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
                            {activeTab === 'created' ? 'No challenges created' : 
                             activeTab === 'joined' ? 'No challenges joined' : 
                             'No challenges available'}
                        </Text>
                        <Text style={styles.emptySubtext}>
                            {activeTab === 'created' ? 'Create one to get started!' :
                             activeTab === 'joined' ? 'Join a challenge to participate!' :
                             'Check back later!'}
                        </Text>
                    </View>
                }
            />
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
