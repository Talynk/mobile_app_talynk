import React, { useState } from 'react';
import {
    View,
    Text,
    Modal,
    StyleSheet,
    TouchableOpacity,
    TextInput,
    ScrollView,
    Switch,
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { challengesApi } from '@/lib/api';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface CreateChallengeModalProps {
    visible: boolean;
    onClose: () => void;
    onCreated: () => void;
}

export default function CreateChallengeModal({ visible, onClose, onCreated }: CreateChallengeModalProps) {
    const insets = useSafeAreaInsets();
    const [loading, setLoading] = useState(false);

    const [formData, setFormData] = useState({
        name: '',
        description: '',
        has_rewards: false,
        rewards: '',
        organizer_name: '',
        organizer_contact: '',
        start_date: new Date().toISOString().split('T')[0],
        end_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        min_content_per_account: '1',
        scoring_criteria: '',
    });

    const updateField = (key: string, value: any) => {
        setFormData(prev => ({ ...prev, [key]: value }));
    };

    const handleSubmit = async () => {
        if (!formData.name || !formData.description || !formData.organizer_name) {
            Alert.alert('Error', 'Please fill in all required fields');
            return;
        }

        setLoading(true);
        try {
            const payload = {
                ...formData,
                min_content_per_account: parseInt(formData.min_content_per_account) || 1,
                start_date: new Date(formData.start_date).toISOString(),
                end_date: new Date(formData.end_date).toISOString(),
            };

            const response = await challengesApi.create(payload);

            if (response.status === 'success') {
                Alert.alert('Success', 'Competition created successfully!');
                onCreated();
                onClose();
            } else {
                Alert.alert('Error', response.message || 'Failed to create challenge');
            }
        } catch (error) {
            console.error('Create challenge error:', error);
            Alert.alert('Error', 'Failed to create challenge');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Modal
            visible={visible}
            animationType="slide"
            presentationStyle="pageSheet"
            onRequestClose={onClose}
        >
            <View style={[styles.container, { paddingTop: Platform.OS === 'android' ? insets.top : 0 }]}>
                <View style={styles.header}>
                    <Text style={styles.headerTitle}>Create Competition</Text>
                    <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                        <Feather name="x" size={24} color="#fff" />
                    </TouchableOpacity>
                </View>

                <KeyboardAvoidingView
                    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                    style={{ flex: 1 }}
                >
                    <ScrollView contentContainerStyle={styles.form}>
                        <View style={styles.inputGroup}>
                            <Text style={styles.label}>Challenge Name *</Text>
                            <TextInput
                                style={styles.input}
                                placeholder="e.g. Summer Dance Off"
                                placeholderTextColor="#666"
                                value={formData.name}
                                onChangeText={(text) => updateField('name', text)}
                            />
                        </View>

                        <View style={styles.inputGroup}>
                            <Text style={styles.label}>Description *</Text>
                            <TextInput
                                style={[styles.input, styles.textArea]}
                                placeholder="Describe what participants need to do..."
                                placeholderTextColor="#666"
                                multiline
                                numberOfLines={4}
                                value={formData.description}
                                onChangeText={(text) => updateField('description', text)}
                            />
                        </View>

                        <View style={styles.row}>
                            <View style={[styles.inputGroup, { flex: 1, marginRight: 8 }]}>
                                <Text style={styles.label}>Organizer Name *</Text>
                                <TextInput
                                    style={styles.input}
                                    placeholder="Your Name"
                                    placeholderTextColor="#666"
                                    value={formData.organizer_name}
                                    onChangeText={(text) => updateField('organizer_name', text)}
                                />
                            </View>
                            <View style={[styles.inputGroup, { flex: 1, marginLeft: 8 }]}>
                                <Text style={styles.label}>Contact Info</Text>
                                <TextInput
                                    style={styles.input}
                                    placeholder="Email/Phone"
                                    placeholderTextColor="#666"
                                    value={formData.organizer_contact}
                                    onChangeText={(text) => updateField('organizer_contact', text)}
                                />
                            </View>
                        </View>

                        <View style={styles.switchContainer}>
                            <Text style={styles.switchLabel}>Has Rewards?</Text>
                            <Switch
                                value={formData.has_rewards}
                                onValueChange={(val) => updateField('has_rewards', val)}
                                trackColor={{ false: '#333', true: '#60a5fa' }}
                                thumbColor="#fff"
                            />
                        </View>

                        {formData.has_rewards && (
                            <View style={styles.inputGroup}>
                                <Text style={styles.label}>Rewards Details *</Text>
                                <TextInput
                                    style={styles.input}
                                    placeholder="e.g. $500 Cash Prize"
                                    placeholderTextColor="#666"
                                    value={formData.rewards}
                                    onChangeText={(text) => updateField('rewards', text)}
                                />
                            </View>
                        )}

                        <View style={styles.row}>
                            <View style={[styles.inputGroup, { flex: 1, marginRight: 8 }]}>
                                <Text style={styles.label} numberOfLines={1}>Start Date</Text>
                                <TextInput
                                    style={styles.input}
                                    placeholder="YYYY-MM-DD"
                                    placeholderTextColor="#666"
                                    value={formData.start_date}
                                    onChangeText={(text) => updateField('start_date', text)}
                                />
                            </View>
                            <View style={[styles.inputGroup, { flex: 1, marginLeft: 8 }]}>
                                <Text style={styles.label} numberOfLines={1}>End Date</Text>
                                <TextInput
                                    style={styles.input}
                                    placeholder="YYYY-MM-DD"
                                    placeholderTextColor="#666"
                                    value={formData.end_date}
                                    onChangeText={(text) => updateField('end_date', text)}
                                />
                            </View>
                        </View>

                        <View style={styles.inputGroup}>
                            <Text style={styles.label}>Scoring Criteria</Text>
                            <TextInput
                                style={[styles.input, styles.textArea]}
                                placeholder="How will winners be chosen?"
                                placeholderTextColor="#666"
                                multiline
                                numberOfLines={3}
                                value={formData.scoring_criteria}
                                onChangeText={(text) => updateField('scoring_criteria', text)}
                            />
                        </View>

                        <View style={styles.inputGroup}>
                            <Text style={styles.label}>Min Content Per Account</Text>
                            <TextInput
                                style={styles.input}
                                placeholder="1"
                                placeholderTextColor="#666"
                                keyboardType="numeric"
                                value={formData.min_content_per_account}
                                onChangeText={(text) => updateField('min_content_per_account', text)}
                            />
                        </View>

                        <TouchableOpacity
                            style={[styles.submitButton, loading && styles.submitButtonDisabled]}
                            onPress={handleSubmit}
                            disabled={loading}
                        >
                            {loading ? (
                                <ActivityIndicator color="#fff" />
                            ) : (
                                <Text style={styles.submitButtonText}>Create Challenge</Text>
                            )}
                        </TouchableOpacity>

                        <View style={{ height: 40 }} />
                    </ScrollView>
                </KeyboardAvoidingView>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#121212',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#2c2c2e',
    },
    headerTitle: {
        color: '#fff',
        fontSize: 18,
        fontWeight: '600',
    },
    closeButton: {
        padding: 4,
    },
    form: {
        padding: 16,
    },
    inputGroup: {
        marginBottom: 16,
    },
    label: {
        color: '#ccc',
        fontSize: 14,
        marginBottom: 8,
        fontWeight: '500',
    },
    input: {
        backgroundColor: '#1a1a1a',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#333',
        paddingHorizontal: 16,
        paddingVertical: 12,
        color: '#fff',
        fontSize: 16,
    },
    textArea: {
        minHeight: 100,
        textAlignVertical: 'top',
    },
    row: {
        flexDirection: 'row',
    },
    switchContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 16,
        backgroundColor: '#1a1a1a',
        padding: 16,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#333',
    },
    switchLabel: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '500',
    },
    submitButton: {
        backgroundColor: '#60a5fa',
        borderRadius: 12,
        paddingVertical: 16,
        alignItems: 'center',
        marginTop: 20,
    },
    submitButtonDisabled: {
        opacity: 0.7,
    },
    submitButtonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '600',
    },
});
