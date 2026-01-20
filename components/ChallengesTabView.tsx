import React, { useState } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
} from 'react-native';
import ChallengesList from './ChallengesList';

interface ChallengesTabViewProps {
    onCreateChallenge: () => void;
    refreshTrigger?: number;
}

const TABS = [
    { key: 'created' as const, label: 'Created by Me' },
    { key: 'joined' as const, label: 'Joined' },
    { key: 'not-joined' as const, label: 'Not Joined' },
];

export default function ChallengesTabView({ onCreateChallenge, refreshTrigger }: ChallengesTabViewProps) {
    const [activeTab, setActiveTab] = useState<'created' | 'joined' | 'not-joined'>('created');

    return (
        <View style={styles.container}>
            {/* Tab Bar */}
            <View style={styles.tabBar}>
                {TABS.map((tab) => (
                    <TouchableOpacity
                        key={tab.key}
                        style={[
                            styles.tab,
                            activeTab === tab.key && styles.tabActive
                        ]}
                        onPress={() => setActiveTab(tab.key)}
                    >
                        <Text style={[
                            styles.tabText,
                            activeTab === tab.key && styles.tabTextActive
                        ]}>
                            {tab.label}
                        </Text>
                    </TouchableOpacity>
                ))}
            </View>

            {/* Content */}
            <ChallengesList 
                onCreateChallenge={onCreateChallenge}
                refreshTrigger={refreshTrigger}
                activeTab={activeTab}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#000',
    },
    tabBar: {
        flexDirection: 'row',
        borderBottomWidth: 1,
        borderBottomColor: '#333',
        backgroundColor: '#000',
    },
    tab: {
        flex: 1,
        paddingVertical: 12,
        alignItems: 'center',
        justifyContent: 'center',
        borderBottomWidth: 3,
        borderBottomColor: 'transparent',
    },
    tabActive: {
        borderBottomColor: '#60a5fa',
    },
    tabText: {
        fontSize: 13,
        fontWeight: '600',
        color: '#666',
    },
    tabTextActive: {
        color: '#fff',
    },
});
