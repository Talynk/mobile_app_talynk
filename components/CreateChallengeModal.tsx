import React, { useState, useCallback } from 'react';
import {
    View,
    Text,
    Modal,
    StyleSheet,
    TouchableOpacity,
    TextInput,
    ScrollView,
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Platform,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Feather } from '@expo/vector-icons';
import { challengesApi } from '@/lib/api';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface CreateChallengeModalProps {
    visible: boolean;
    onClose: () => void;
    onCreated: () => void;
}

type FieldErrorKey = 'name' | 'description' | 'organizer_name' | 'organizer_contact' | 'rewards' | 'start_date' | 'end_date' | 'min_content_per_account' | 'scoring_criteria';

function formatDateForInput(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function parseDateInput(value: string): Date {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date();
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d);
}

export default function CreateChallengeModal({ visible, onClose, onCreated }: CreateChallengeModalProps) {
    const insets = useSafeAreaInsets();
    const [loading, setLoading] = useState(false);
    const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldErrorKey, string>>>({});
    const [showStartPicker, setShowStartPicker] = useState(false);
    const [showEndPicker, setShowEndPicker] = useState(false);

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

    const updateField = useCallback((key: string, value: string | boolean) => {
        setFormData(prev => ({ ...prev, [key]: value }));
        setFieldErrors(prev => {
            const next = { ...prev };
            delete next[key as FieldErrorKey];
            return next;
        });
    }, []);

    const validate = useCallback((): boolean => {
        const errors: Partial<Record<FieldErrorKey, string>> = {};

        const name = (formData.name || '').trim();
        if (!name) {
            errors.name = 'Competition name is required';
        } else if (name.length < 2) {
            errors.name = 'Name must be at least 2 characters';
        }

        const description = (formData.description || '').trim();
        if (!description) {
            errors.description = 'Description is required';
        } else if (description.length < 10) {
            errors.description = 'Please add a longer description (at least 10 characters)';
        }

        const organizer_name = (formData.organizer_name || '').trim();
        if (!organizer_name) {
            errors.organizer_name = 'Organizer name is required';
        }

        if (formData.has_rewards) {
            const rewards = (formData.rewards || '').trim();
            if (!rewards) {
                errors.rewards = 'Please describe the reward (e.g. $500 prize)';
            }
        }

        const startStr = (formData.start_date || '').trim();
        if (!startStr) {
            errors.start_date = 'Start date is required';
        } else {
            const startDate = parseDateInput(startStr);
            if (isNaN(startDate.getTime())) {
                errors.start_date = 'Please enter a valid start date';
            }
        }

        const endStr = (formData.end_date || '').trim();
        if (!endStr) {
            errors.end_date = 'End date is required';
        } else {
            const endDate = parseDateInput(endStr);
            if (isNaN(endDate.getTime())) {
                errors.end_date = 'Please enter a valid end date';
            } else if (startStr) {
                const startDate = parseDateInput(startStr);
                if (endDate < startDate) {
                    errors.end_date = 'End date must be on or after start date';
                }
            }
        }

        const minContent = formData.min_content_per_account.trim();
        const minNum = parseInt(minContent, 10);
        if (minContent === '' || isNaN(minNum) || minNum < 1) {
            errors.min_content_per_account = 'Minimum must be at least 1';
        }

        setFieldErrors(errors);
        return Object.keys(errors).length === 0;
    }, [formData]);

    const handleSubmit = async () => {
        setShowStartPicker(false);
        setShowEndPicker(false);
        if (!validate()) {
            return;
        }

        setLoading(true);
        setFieldErrors({});
        try {
            const payload = {
                ...formData,
                min_content_per_account: parseInt(formData.min_content_per_account, 10) || 1,
                start_date: new Date(formData.start_date).toISOString(),
                end_date: new Date(formData.end_date).toISOString(),
            };

            const response = await challengesApi.create(payload);

            if (response.status === 'success') {
                Alert.alert(
                    'Competition Submitted! 🎉',
                    'Your competition has been created and submitted for review. An administrator will check and approve or reject it. If it gets approved it will appear in the "Created by Me" tab.\n\nPlease wait for approval before it becomes visible to others.',
                    [{ text: 'OK' }]
                );
                onCreated();
                onClose();
            } else {
                Alert.alert('Error', response.message || 'Failed to create competition');
            }
        } catch (error) {
            console.error('Create competition error:', error);
            Alert.alert('Error', 'Failed to create competition');
        } finally {
            setLoading(false);
        }
    };

    const handleStartDateChange = (event: any, selectedDate?: Date) => {
        if (Platform.OS === 'android') setShowStartPicker(false);
        if (event?.type === 'dismissed') return;
        if (selectedDate) {
            updateField('start_date', formatDateForInput(selectedDate));
        }
    };

    const handleEndDateChange = (event: any, selectedDate?: Date) => {
        if (Platform.OS === 'android') setShowEndPicker(false);
        if (event?.type === 'dismissed') return;
        if (selectedDate) {
            updateField('end_date', formatDateForInput(selectedDate));
        }
    };

    const minEndDate = formData.start_date ? parseDateInput(formData.start_date) : new Date();

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
                    <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
                        <View style={styles.inputGroup}>
                            <Text style={styles.label}>Competition Name *</Text>
                            <TextInput
                                style={[styles.input, fieldErrors.name && styles.inputError]}
                                placeholder="e.g. Summer Dance Off"
                                placeholderTextColor="#666"
                                value={formData.name}
                                onChangeText={(text) => updateField('name', text)}
                            />
                            {fieldErrors.name ? <Text style={styles.errorText}>{fieldErrors.name}</Text> : null}
                        </View>

                        <View style={styles.inputGroup}>
                            <Text style={styles.label}>Description *</Text>
                            <TextInput
                                style={[styles.input, styles.textArea, fieldErrors.description && styles.inputError]}
                                placeholder="Describe what participants need to do..."
                                placeholderTextColor="#666"
                                multiline
                                numberOfLines={4}
                                value={formData.description}
                                onChangeText={(text) => updateField('description', text)}
                            />
                            {fieldErrors.description ? <Text style={styles.errorText}>{fieldErrors.description}</Text> : null}
                        </View>

                        <View style={styles.row}>
                            <View style={[styles.inputGroup, { flex: 1, marginRight: 8 }]}>
                                <Text style={styles.label}>Organizer Name *</Text>
                                <TextInput
                                    style={[styles.input, fieldErrors.organizer_name && styles.inputError]}
                                    placeholder="Your Name"
                                    placeholderTextColor="#666"
                                    value={formData.organizer_name}
                                    onChangeText={(text) => updateField('organizer_name', text)}
                                />
                                {fieldErrors.organizer_name ? <Text style={styles.errorText}>{fieldErrors.organizer_name}</Text> : null}
                            </View>
                            <View style={[styles.inputGroup, { flex: 1, marginLeft: 8 }]}>
                                <Text style={styles.label}>Contact (email or phone)</Text>
                                <TextInput
                                    style={[styles.input, fieldErrors.organizer_contact && styles.inputError]}
                                    placeholder="Email or phone"
                                    placeholderTextColor="#666"
                                    value={formData.organizer_contact}
                                    onChangeText={(text) => updateField('organizer_contact', text)}
                                />
                                {fieldErrors.organizer_contact ? <Text style={styles.errorText}>{fieldErrors.organizer_contact}</Text> : null}
                            </View>
                        </View>

                        <View style={styles.switchContainer}>
                            <Text style={styles.switchLabel}>Has a Reward</Text>
                            <View style={styles.yesNoIndicatorRow}>
                                <TouchableOpacity
                                    style={[styles.yesNoChip, formData.has_rewards && styles.yesNoChipActive]}
                                    onPress={() => updateField('has_rewards', true)}
                                >
                                    <Text style={[styles.yesNoChipText, formData.has_rewards && styles.yesNoChipTextActive]}>Yes</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={[styles.yesNoChip, !formData.has_rewards && styles.yesNoChipActive]}
                                    onPress={() => updateField('has_rewards', false)}
                                >
                                    <Text style={[styles.yesNoChipText, !formData.has_rewards && styles.yesNoChipTextActive]}>No</Text>
                                </TouchableOpacity>
                            </View>
                        </View>

                        {formData.has_rewards && (
                            <View style={styles.inputGroup}>
                                <Text style={styles.label}>Rewards Details *</Text>
                                <TextInput
                                    style={[styles.input, fieldErrors.rewards && styles.inputError]}
                                    placeholder="e.g. $500 Cash Prize"
                                    placeholderTextColor="#666"
                                    value={formData.rewards}
                                    onChangeText={(text) => updateField('rewards', text)}
                                />
                                {fieldErrors.rewards ? <Text style={styles.errorText}>{fieldErrors.rewards}</Text> : null}
                            </View>
                        )}

                        <View style={styles.row}>
                            <View style={[styles.inputGroup, { flex: 1, marginRight: 8 }]}>
                                <Text style={styles.label}>Start Date *</Text>
                                <TouchableOpacity
                                    style={[styles.input, styles.dateTouchable, fieldErrors.start_date && styles.inputError]}
                                    onPress={() => { setShowEndPicker(false); setShowStartPicker(true); }}
                                    activeOpacity={0.8}
                                >
                                    <Text style={styles.dateText}>{formData.start_date || 'Pick date'}</Text>
                                    <Feather name="calendar" size={20} color="#888" />
                                </TouchableOpacity>
                                {fieldErrors.start_date ? <Text style={styles.errorText}>{fieldErrors.start_date}</Text> : null}
                                {showStartPicker && (
                                    <View style={styles.pickerWrapper}>
                                        <DateTimePicker
                                            value={parseDateInput(formData.start_date)}
                                            mode="date"
                                            display={Platform.OS === 'ios' ? 'calendar' : 'default'}
                                            onChange={handleStartDateChange}
                                            minimumDate={new Date()}
                                        />
                                        {Platform.OS === 'ios' && (
                                            <TouchableOpacity style={styles.pickerDoneButton} onPress={() => setShowStartPicker(false)}>
                                                <Text style={styles.pickerDoneText}>Done</Text>
                                            </TouchableOpacity>
                                        )}
                                    </View>
                                )}
                            </View>
                            <View style={[styles.inputGroup, { flex: 1, marginLeft: 8 }]}>
                                <Text style={styles.label}>End Date *</Text>
                                <TouchableOpacity
                                    style={[styles.input, styles.dateTouchable, fieldErrors.end_date && styles.inputError]}
                                    onPress={() => { setShowStartPicker(false); setShowEndPicker(true); }}
                                    activeOpacity={0.8}
                                >
                                    <Text style={styles.dateText}>{formData.end_date || 'Pick date'}</Text>
                                    <Feather name="calendar" size={20} color="#888" />
                                </TouchableOpacity>
                                {fieldErrors.end_date ? <Text style={styles.errorText}>{fieldErrors.end_date}</Text> : null}
                                {showEndPicker && (
                                    <View style={styles.pickerWrapper}>
                                        <DateTimePicker
                                            value={parseDateInput(formData.end_date)}
                                            mode="date"
                                            display={Platform.OS === 'ios' ? 'calendar' : 'default'}
                                            onChange={handleEndDateChange}
                                            minimumDate={minEndDate}
                                        />
                                        {Platform.OS === 'ios' && (
                                            <TouchableOpacity style={styles.pickerDoneButton} onPress={() => setShowEndPicker(false)}>
                                                <Text style={styles.pickerDoneText}>Done</Text>
                                            </TouchableOpacity>
                                        )}
                                    </View>
                                )}
                            </View>
                        </View>

                        <View style={styles.inputGroup}>
                            <Text style={styles.label}>Scoring Criteria</Text>
                            <TextInput
                                style={[styles.input, styles.textArea, fieldErrors.scoring_criteria && styles.inputError]}
                                placeholder="How will winners be chosen?"
                                placeholderTextColor="#666"
                                multiline
                                numberOfLines={3}
                                value={formData.scoring_criteria}
                                onChangeText={(text) => updateField('scoring_criteria', text)}
                            />
                            {fieldErrors.scoring_criteria ? <Text style={styles.errorText}>{fieldErrors.scoring_criteria}</Text> : null}
                        </View>

                        <View style={styles.inputGroup}>
                            <Text style={styles.label}>Min content per account *</Text>
                            <TextInput
                                style={[styles.input, fieldErrors.min_content_per_account && styles.inputError]}
                                placeholder="1"
                                placeholderTextColor="#666"
                                keyboardType="numeric"
                                value={formData.min_content_per_account}
                                onChangeText={(text) => updateField('min_content_per_account', text)}
                            />
                            {fieldErrors.min_content_per_account ? <Text style={styles.errorText}>{fieldErrors.min_content_per_account}</Text> : null}
                        </View>

                        <TouchableOpacity
                            style={[styles.submitButton, loading && styles.submitButtonDisabled]}
                            onPress={handleSubmit}
                            disabled={loading}
                        >
                            {loading ? (
                                <ActivityIndicator color="#fff" />
                            ) : (
                                <Text style={styles.submitButtonText}>Submit Competition</Text>
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
    inputError: {
        borderColor: '#ef4444',
        backgroundColor: 'rgba(239, 68, 68, 0.08)',
    },
    errorText: {
        color: '#f87171',
        fontSize: 13,
        marginTop: 6,
        marginLeft: 4,
    },
    dateTouchable: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    dateText: {
        color: '#fff',
        fontSize: 16,
    },
    pickerWrapper: {
        marginTop: 8,
        marginBottom: 8,
    },
    pickerDoneButton: {
        marginTop: 12,
        paddingVertical: 10,
        paddingHorizontal: 20,
        backgroundColor: '#60a5fa',
        borderRadius: 10,
        alignSelf: 'flex-start',
    },
    pickerDoneText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '600',
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
    yesNoIndicatorRow: {
        flexDirection: 'row',
        gap: 12,
    },
    yesNoChip: {
        paddingVertical: 10,
        paddingHorizontal: 20,
        borderRadius: 8,
        backgroundColor: '#333',
        borderWidth: 1,
        borderColor: '#555',
    },
    yesNoChipActive: {
        backgroundColor: '#60a5fa',
        borderColor: '#60a5fa',
    },
    yesNoChipText: {
        color: '#999',
        fontSize: 15,
        fontWeight: '600',
    },
    yesNoChipTextActive: {
        color: '#fff',
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
