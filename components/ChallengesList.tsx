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
}

export default function ChallengesList({ onCreateChallenge, refreshTrigger }: ChallengesListProps) {
    const [challenges, setChallenges] = useState<Challenge[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const { user } = useAuth();

    const fetchChallenges = async () => {
        try {
            // Fetch active/approved challenges
            const activeResponse = await challengesApi.getAll('active');
            let activeChallenges: Challenge[] = [];
            
            if (activeResponse.status === 'success') {
                const data = activeResponse.data?.challenges || activeResponse.data || [];
                activeChallenges = Array.isArray(data) ? data : [];
            }

            // Also fetch pending challenges created by the current user
            let myPendingChallenges: Challenge[] = [];
            if (user) {
                try {
                    const myChallengesResponse = await challengesApi.getMyChallenges();
                    if (myChallengesResponse.status === 'success') {
                        const myData = myChallengesResponse.data?.challenges || myChallengesResponse.data || [];
                        const allMyChallenges = Array.isArray(myData) ? myData : [];
                        // Filter for pending challenges
                        myPendingChallenges = allMyChallenges.filter((ch: any) => ch.status === 'pending');
                    }
                } catch (error) {
                    console.error('Error fetching my challenges:', error);
                }
            }

            // Combine active and pending challenges, removing duplicates
            const allChallenges = [...activeChallenges, ...myPendingChallenges];
            const uniqueChallenges = allChallenges.filter((challenge, index, self) =>
                index === self.findIndex((c) => c.id === challenge.id)
            );

            // Sort by creation date (newest first)
            uniqueChallenges.sort((a, b) => {
                const dateA = new Date((a as any).createdAt || a.start_date).getTime();
                const dateB = new Date((b as any).createdAt || b.start_date).getTime();
                return dateB - dateA;
            });

            setChallenges(uniqueChallenges);

            if (__DEV__) {
                console.log('📋 [ChallengesList] Fetched challenges:', {
                    active: activeChallenges.length,
                    pending: myPendingChallenges.length,
                    total: uniqueChallenges.length,
                });
            }
        } catch (error) {
            console.error('Error fetching challenges:', error);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => {
        fetchChallenges();
    }, [user, refreshTrigger]);

    const onRefresh = () => {
        setRefreshing(true);
        fetchChallenges();
    };

    const renderChallengeItem = ({ item }: { item: Challenge }) => (
        <TouchableOpacity
            style={styles.card}
            onPress={() => {
                // Navigate to challenge details (to be implemented)
                // router.push(`/challenge/${item.id}`);
            }}
        >
            <View style={styles.cardHeader}>
                <View style={styles.iconContainer}>
                    <Feather name="award" size={24} color="#60a5fa" />
                </View>
                <View style={styles.headerText}>
                    <Text style={styles.title}>{item.name}</Text>
                    <Text style={styles.organizer}>by {item.organizer_name}</Text>
                </View>
                <View style={styles.badgesContainer}>
                    {item.status === 'pending' && (
                        <View style={styles.pendingBadge}>
                            <Feather name="clock" size={12} color="#fff" />
                            <Text style={styles.pendingText}>Pending</Text>
                        </View>
                    )}
                {item.has_rewards && (
                    <View style={styles.rewardBadge}>
                        <Feather name="gift" size={12} color="#fff" />
                        <Text style={styles.rewardText}>Rewards</Text>
                    </View>
                )}
                </View>
            </View>

            <Text style={styles.description} numberOfLines={2}>
                {item.description}
            </Text>

            <View style={styles.footer}>
                <View style={styles.stat}>
                    <Feather name="users" size={14} color="#666" />
                    <Text style={styles.statText}>{item.participants_count || 0} joined</Text>
                </View>
                <View style={styles.stat}>
                    <Feather name="image" size={14} color="#666" />
                    <Text style={styles.statText}>{item.posts_count || 0} posts</Text>
                </View>
                <View style={styles.dateContainer}>
                    <Feather name="clock" size={14} color="#666" />
                    <Text style={styles.dateText}>
                        Ends {new Date(item.end_date).toLocaleDateString()}
                    </Text>
                </View>
            </View>
        </TouchableOpacity>
    );

    if (loading) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#60a5fa" />
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <View style={styles.actionsContainer}>
                <TouchableOpacity
                    style={styles.createButton}
                    onPress={onCreateChallenge}
                >
                    <Feather name="plus" size={20} color="#fff" />
                    <Text style={styles.createButtonText}>Create Challenge</Text>
                </TouchableOpacity>
            </View>

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
                        <Text style={styles.emptyText}>No active challenges</Text>
                        <Text style={styles.emptySubtext}>Create one to get started!</Text>
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
        alignItems: 'center',
        marginBottom: 12,
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
    },
    title: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '700',
        marginBottom: 2,
    },
    organizer: {
        color: '#666',
        fontSize: 12,
    },
    badgesContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    pendingBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#6b7280',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 8,
        gap: 4,
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
    },
    rewardText: {
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
