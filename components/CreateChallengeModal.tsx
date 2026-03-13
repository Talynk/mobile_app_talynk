import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
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
    FlatList,
    type LayoutChangeEvent,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Feather } from '@expo/vector-icons';
import { challengesApi, countriesApi } from '@/lib/api';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Country } from '@/types';
import {
    formatChallengeDateTime,
    getCurrentTimeZoneLabel,
    parseChallengeDate,
} from '@/lib/utils/challenge';

export interface ChallengeForEdit {
    id: string;
    name?: string;
    description?: string | null;
    has_rewards?: boolean;
    rewards?: string | null;
    organizer_name?: string;
    organizer_contact?: string;
    contact_email?: string;
    eligibility_criteria?: string | null;
    what_you_do?: string | null;
    start_date?: string;
    end_date?: string;
    min_content_per_account?: number;
    scoring_criteria?: string | null;
}

interface CreateChallengeModalProps {
    visible: boolean;
    onClose: () => void;
    onCreated: () => void;
    /** When provided, modal is in edit mode: form prefilled, submit calls PUT. Only for pending challenges. */
    editChallenge?: ChallengeForEdit | null;
    onUpdated?: () => void;
}

type FieldErrorKey = 'name' | 'description' | 'organizer_name' | 'organizer_contact' | 'contact_email' | 'rewards' | 'start_date' | 'end_date' | 'min_content_per_account' | 'scoring_criteria' | 'eligibility_criteria' | 'what_you_do';

function parseDateInput(value: string): Date {
    if (!value) return new Date();
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const [y, m, d] = value.split('-').map(Number);
        return new Date(y, m - 1, d, 0, 0, 0, 0);
    }
    return parseChallengeDate(value) || new Date();
}

const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);
tomorrow.setHours(9, 0, 0, 0);
const oneWeekLater = new Date(tomorrow);
oneWeekLater.setDate(oneWeekLater.getDate() + 7);
oneWeekLater.setHours(23, 59, 0, 0);
const defaultStartDate = tomorrow.toISOString();
const defaultEndDate = oneWeekLater.toISOString();

const defaultFormData = {
    name: '',
    description: '',
    has_rewards: false,
    rewards: '',
    organizer_name: '',
    organizer_contact: '',
    contact_country_code: '+250',
    contact_phone_digits: '',
    contact_email: '',
    eligibility_criteria: '',
    what_you_do: '',
    start_date: defaultStartDate,
    end_date: defaultEndDate,
    min_content_per_account: '1',
    scoring_criteria: '',
};

function parseOrganizerContact(full: string): { code: string; digits: string } {
    if (!full || !full.trim()) return { code: '+250', digits: '' };
    const s = full.trim();
    const match = s.match(/^(\+\d{1,4})(\d+)$/);
    if (match) return { code: match[1], digits: match[2].replace(/\D/g, '').slice(0, 9) };
    const digitsOnly = s.replace(/\D/g, '').slice(0, 9);
    if (s.startsWith('+')) return { code: '+250', digits: digitsOnly };
    return { code: '+250', digits: digitsOnly };
}

export default function CreateChallengeModal({ visible, onClose, onCreated, editChallenge, onUpdated }: CreateChallengeModalProps) {
    const insets = useSafeAreaInsets();
    const localTimeZoneLabel = useMemo(() => getCurrentTimeZoneLabel(), []);
    const [loading, setLoading] = useState(false);
    const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldErrorKey, string>>>({});
    const [activePickerField, setActivePickerField] = useState<'start_date' | 'end_date' | null>(null);
    const [activePickerMode, setActivePickerMode] = useState<'date' | 'time' | 'datetime' | null>(null);
    const [androidPickerDraft, setAndroidPickerDraft] = useState<Date | null>(null);

    const [formData, setFormData] = useState({ ...defaultFormData });
    const [showCountryPicker, setShowCountryPicker] = useState(false);
    const [countries, setCountries] = useState<Country[]>([]);
    const [countrySearchQuery, setCountrySearchQuery] = useState('');
    const scrollViewRef = useRef<ScrollView>(null);
    const fieldYOffsets = useRef<Partial<Record<FieldErrorKey, number>>>({});

    const isEditMode = !!editChallenge?.id;

    const scrollToFirstError = useCallback((firstKey: FieldErrorKey) => {
        const y = fieldYOffsets.current[firstKey];
        const scroll = scrollViewRef.current;
        if (typeof y === 'number' && scroll) {
            scroll.scrollTo({ y: Math.max(0, y - 100), animated: true });
        }
    }, []);

    const saveFieldLayout = useCallback((key: FieldErrorKey) => (e: LayoutChangeEvent) => {
        const { layout } = e.nativeEvent;
        fieldYOffsets.current[key] = layout.y;
    }, []);

    useEffect(() => {
        if (visible && editChallenge?.id) {
            const start = editChallenge.start_date ? parseDateInput(editChallenge.start_date).toISOString() : defaultFormData.start_date;
            const end = editChallenge.end_date ? parseDateInput(editChallenge.end_date).toISOString() : defaultFormData.end_date;
            const { code, digits } = parseOrganizerContact(editChallenge.organizer_contact ?? '');
            setFormData({
                name: editChallenge.name ?? '',
                description: editChallenge.description ?? '',
                has_rewards: !!editChallenge.has_rewards,
                rewards: editChallenge.rewards ?? '',
                organizer_name: editChallenge.organizer_name ?? '',
                organizer_contact: editChallenge.organizer_contact ?? '',
                contact_country_code: code,
                contact_phone_digits: digits,
                contact_email: editChallenge.contact_email ?? '',
                eligibility_criteria: editChallenge.eligibility_criteria ?? '',
                what_you_do: editChallenge.what_you_do ?? '',
                start_date: start,
                end_date: end,
                min_content_per_account: String(editChallenge.min_content_per_account ?? 1),
                scoring_criteria: editChallenge.scoring_criteria ?? '',
            });
            setFieldErrors({});
        } else if (visible && !editChallenge) {
            setFormData({ ...defaultFormData });
            setFieldErrors({});
        }
    }, [visible, editChallenge?.id]);

    const closeDatePicker = useCallback(() => {
        setActivePickerField(null);
        setActivePickerMode(null);
        setAndroidPickerDraft(null);
    }, []);

    const openDatePicker = useCallback((field: 'start_date' | 'end_date') => {
        setActivePickerField(field);
        setAndroidPickerDraft(parseDateInput(formData[field]));
        setActivePickerMode(Platform.OS === 'ios' ? 'datetime' : 'date');
    }, [formData]);

    useEffect(() => {
        if (!showCountryPicker) return;
        let cancelled = false;
        countriesApi.getAll()
            .then((res) => {
                if (cancelled) return;
                const list: Country[] = [];
                const raw = (res.data as any)?.countries ?? (Array.isArray((res.data as any)?.data) ? (res.data as any).data : res.data);
                if (Array.isArray(raw)) raw.forEach((c: any) => list.push({ id: c.id, name: c.name || c.country_name, code: c.code || c.dial_code || '', flag_emoji: c.flag_emoji }));
                setCountries(list);
            })
            .catch(() => { if (!cancelled) setCountries([]); });
        return () => { cancelled = true; };
    }, [showCountryPicker]);

    const filteredCountries = useMemo(() => {
        if (!countrySearchQuery.trim()) return countries;
        const q = countrySearchQuery.toLowerCase().trim();
        return countries.filter((c) =>
            (c.name || '').toLowerCase().includes(q) ||
            (c.code || '').toLowerCase().includes(q)
        );
    }, [countries, countrySearchQuery]);

    const updateField = useCallback((key: string, value: string | boolean) => {
        setFormData(prev => ({ ...prev, [key]: value }));
        setFieldErrors(prev => {
            const next = { ...prev };
            delete next[key as FieldErrorKey];
            return next;
        });
    }, []);

    const validate = useCallback((): {
        valid: boolean;
        errors: Partial<Record<FieldErrorKey, string>>;
        firstKey: FieldErrorKey | null;
    } => {
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

        const contactCode = (formData.contact_country_code || '').trim();
        const contactDigits = (formData.contact_phone_digits || '').replace(/\D/g, '');
        if (!contactCode || !contactCode.startsWith('+')) {
            errors.organizer_contact = 'Select country code';
        } else if (!contactDigits) {
            errors.organizer_contact = 'Enter phone number (excluding country code)';
        } else if (contactDigits.length < 6) {
            errors.organizer_contact = 'Phone number is too short';
        }

        if (formData.has_rewards) {
            const rewards = (formData.rewards || '').trim();
            if (!rewards) {
                errors.rewards = 'Please describe the reward (e.g. $500 prize)';
            }
        }

        const contact_email = (formData.contact_email || '').trim();
        if (!contact_email) {
            errors.contact_email = 'Contact email is required';
        } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact_email)) {
            errors.contact_email = 'Please enter a valid email address';
        }

        const startStr = (formData.start_date || '').trim();
        if (!startStr) {
            errors.start_date = 'Start date and time are required';
        } else {
            const startDate = parseDateInput(startStr);
            if (isNaN(startDate.getTime())) {
                errors.start_date = 'Please enter a valid start date and time';
            } else if (!isEditMode) {
                if (startDate.getTime() < Date.now()) {
                    errors.start_date = 'Start date and time must be now or in the future';
                }
            }
        }

        const endStr = (formData.end_date || '').trim();
        if (!endStr) {
            errors.end_date = 'End date and time are required';
        } else {
            const endDate = parseDateInput(endStr);
            if (isNaN(endDate.getTime())) {
                errors.end_date = 'Please enter a valid end date and time';
            } else if (startStr) {
                const startDate = parseDateInput(startStr);
                if (endDate < startDate) {
                    errors.end_date = 'End date and time must be after the start date and time';
                }
            }
        }

        const minContent = formData.min_content_per_account.trim();
        const minNum = parseInt(minContent, 10);
        if (minContent === '' || isNaN(minNum) || minNum < 1) {
            errors.min_content_per_account = 'Minimum must be at least 1';
        }

        const firstKey = (Object.keys(errors)[0] as FieldErrorKey) || null;
        setFieldErrors(errors);
        return { valid: Object.keys(errors).length === 0, errors, firstKey };
    }, [formData, isEditMode]);

    const handleSubmit = async () => {
        closeDatePicker();
        const result = validate();
        if (!result.valid) {
            if (result.firstKey) {
                setTimeout(() => scrollToFirstError(result.firstKey!), 100);
            }
            return;
        }

        setLoading(true);
        setFieldErrors({});
        try {
            const payload: Record<string, unknown> = {
                name: (formData.name || '').trim(),
                description: (formData.description || '').trim() || null,
                has_rewards: formData.has_rewards,
                rewards: formData.has_rewards ? (formData.rewards || '').trim() || null : null,
                organizer_name: (formData.organizer_name || '').trim(),
                organizer_contact: ((formData.contact_country_code || '').replace(/\s/g, '') + (formData.contact_phone_digits || '').replace(/\D/g, '')).trim() || (formData.organizer_contact || '').trim(),
                contact_email: (formData.contact_email || '').trim(),
                eligibility_criteria: (formData.eligibility_criteria || '').trim() || null,
                what_you_do: (formData.what_you_do || '').trim() || null,
                min_content_per_account: parseInt(formData.min_content_per_account, 10) || 1,
                start_date: parseDateInput(formData.start_date).toISOString(),
                end_date: parseDateInput(formData.end_date).toISOString(),
                scoring_criteria: (formData.scoring_criteria || '').trim() || null,
            };

            const followUpEmail = 'strongmind250@gmail.com';

            if (isEditMode && editChallenge?.id) {
                const response = await challengesApi.update(editChallenge.id, payload);
                if (response.status === 'success') {
                    Alert.alert('Competition Updated', 'Your competition details have been updated successfully.', [{ text: 'OK' }]);
                    onUpdated?.();
                    onClose();
                } else {
                    Alert.alert('Error', response.message || 'Failed to update competition');
                }
            } else {
                const response = await challengesApi.create(payload as any);
                if (response.status === 'success') {
                    Alert.alert(
                        'Competition Submitted! 🎉',
                        `Your competition has been created and submitted for review. An administrator will check and approve or reject it and any decision will be notified to you immediately.\nWhat you can do now is just edit your competition details in created by me tab before it gets approved. Once it gets approved you won't be able to edit it anymore.\n\nFor follow-up on approval, contact: ${followUpEmail}`,
                        [{ text: 'OK' }]
                    );
                    onCreated();
                    onClose();
                } else {
                    Alert.alert('Error', response.message || 'Failed to create competition');
                }
            }
        } catch (error) {
            console.error(isEditMode ? 'Update competition error' : 'Create competition error', error);
            Alert.alert('Error', isEditMode ? 'Failed to update competition' : 'Failed to create competition');
        } finally {
            setLoading(false);
        }
    };

    const handleDatePickerChange = (event: any, selectedDate?: Date) => {
        if (!activePickerField || !activePickerMode) {
            return;
        }

        if (event?.type === 'dismissed') {
            closeDatePicker();
            return;
        }

        if (!selectedDate) {
            return;
        }

        if (Platform.OS === 'ios') {
            updateField(activePickerField, selectedDate.toISOString());
            return;
        }

        if (activePickerMode === 'date') {
            const currentValue = parseDateInput(formData[activePickerField]);
            const merged = new Date(currentValue);
            merged.setFullYear(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
            setAndroidPickerDraft(merged);
            setActivePickerMode('time');
            return;
        }

        const base = androidPickerDraft ? new Date(androidPickerDraft) : parseDateInput(formData[activePickerField]);
        base.setHours(selectedDate.getHours(), selectedDate.getMinutes(), 0, 0);
        updateField(activePickerField, base.toISOString());
        closeDatePicker();
    };

    const pickerValue = activePickerField
        ? (activePickerMode === 'time' && androidPickerDraft
            ? androidPickerDraft
            : parseDateInput(formData[activePickerField]))
        : new Date();

    const minStartDate = isEditMode ? undefined : new Date();
    const minEndDate = formData.start_date ? parseDateInput(formData.start_date) : new Date();
    const showActivePicker = !!activePickerField && !!activePickerMode;

    return (
        <Modal
            visible={visible}
            animationType="slide"
            presentationStyle="pageSheet"
            onRequestClose={onClose}
        >
            <View style={[styles.container, { paddingTop: Platform.OS === 'android' ? insets.top : 0 }]}>
                <View style={styles.header}>
                    <Text style={styles.headerTitle}>{isEditMode ? 'Edit Competition before approval' : 'Create Competition'}</Text>
                    <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                        <Feather name="x" size={24} color="#fff" />
                    </TouchableOpacity>
                </View>

                <KeyboardAvoidingView
                    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                    style={{ flex: 1 }}
                >
                    <ScrollView ref={scrollViewRef} keyboardShouldPersistTaps="handled">
                        <View style={styles.form}>
                        <View onLayout={saveFieldLayout('name')} style={styles.inputGroup}>
                            <Text style={styles.label}>Competition Name *</Text>
                            <TextInput
                                style={[styles.input, fieldErrors.name && styles.inputError]}
                                placeholder="e.g. Summer Dance Off"
                                placeholderTextColor="#9ca3af"
                                value={formData.name}
                                onChangeText={(text) => updateField('name', text)}
                            />
                            {fieldErrors.name ? <Text style={styles.errorText}>{fieldErrors.name}</Text> : null}
                        </View>

                        <View onLayout={saveFieldLayout('description')} style={styles.inputGroup}>
                            <Text style={styles.label}>Description *</Text>
                            <TextInput
                                style={[styles.input, styles.textArea, fieldErrors.description && styles.inputError]}
                                placeholder="Describe what participants need to do..."
                                placeholderTextColor="#9ca3af"
                                multiline
                                numberOfLines={4}
                                value={formData.description}
                                onChangeText={(text) => updateField('description', text)}
                            />
                            {fieldErrors.description ? <Text style={styles.errorText}>{fieldErrors.description}</Text> : null}
                        </View>

                        <View onLayout={saveFieldLayout('organizer_name')} style={styles.inputGroup}>
                            <Text style={styles.label}>Organizer Name *</Text>
                            <TextInput
                                style={[styles.input, fieldErrors.organizer_name && styles.inputError]}
                                placeholder="e.g. John Doe"
                                placeholderTextColor="#9ca3af"
                                value={formData.organizer_name}
                                onChangeText={(text) => updateField('organizer_name', text)}
                            />
                            {fieldErrors.organizer_name ? <Text style={styles.errorText}>{fieldErrors.organizer_name}</Text> : null}
                        </View>

                        <View onLayout={saveFieldLayout('what_you_do')} style={styles.inputGroup}>
                            <Text style={styles.label}>About the organizer</Text>
                            <TextInput
                                style={[styles.input, styles.textArea, fieldErrors.what_you_do && styles.inputError]}
                                placeholder="Describe your products or services"
                                placeholderTextColor="#9ca3af"
                                multiline
                                numberOfLines={3}
                                value={formData.what_you_do}
                                onChangeText={(text) => updateField('what_you_do', text)}
                            />
                            {fieldErrors.what_you_do ? <Text style={styles.errorText}>{fieldErrors.what_you_do}</Text> : null}
                        </View>

                        <View onLayout={saveFieldLayout('organizer_contact')} style={styles.inputGroup}>
                            <Text style={styles.label}>Contact phone *</Text>
                            <View style={styles.phoneRow}>
                                <TouchableOpacity
                                    style={[styles.phoneCodeBox, fieldErrors.organizer_contact && styles.inputError]}
                                    onPress={() => setShowCountryPicker(true)}
                                    activeOpacity={0.8}
                                >
                                    <Text style={styles.phoneCodeText} numberOfLines={1}>
                                        {formData.contact_country_code || '+?'}
                                    </Text>
                                    <Feather name="chevron-down" size={16} color="#9ca3af" />
                                </TouchableOpacity>
                                <TextInput
                                    style={[styles.input, styles.phoneDigitsInput, fieldErrors.organizer_contact && styles.inputError]}
                                    placeholder="Write your number excluding country code"
                                    placeholderTextColor="#9ca3af"
                                    value={formData.contact_phone_digits}
                                    onChangeText={(text) => updateField('contact_phone_digits', text.replace(/\D/g, '').slice(0, 15))}
                                    keyboardType="phone-pad"
                                    maxLength={15}
                                />
                            </View>
                            {fieldErrors.organizer_contact ? <Text style={styles.errorText}>{fieldErrors.organizer_contact}</Text> : null}
                        </View>

                        <View onLayout={saveFieldLayout('contact_email')} style={styles.inputGroup}>
                            <Text style={styles.label}>Contact email *</Text>
                            <TextInput
                                style={[styles.input, fieldErrors.contact_email && styles.inputError]}
                                placeholder="e.g. you@example.com"
                                placeholderTextColor="#9ca3af"
                                value={formData.contact_email}
                                onChangeText={(text) => updateField('contact_email', text)}
                                keyboardType="email-address"
                                autoCapitalize="none"
                                autoCorrect={false}
                            />
                            {fieldErrors.contact_email ? <Text style={styles.errorText}>{fieldErrors.contact_email}</Text> : null}
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
                            <View onLayout={saveFieldLayout('rewards')} style={styles.inputGroup}>
                                <Text style={styles.label}>Rewards Details *</Text>
                                <TextInput
                                    style={[styles.input, fieldErrors.rewards && styles.inputError]}
                                    placeholder="e.g. $500 Cash Prize"
                                    placeholderTextColor="#9ca3af"
                                    value={formData.rewards}
                                    onChangeText={(text) => updateField('rewards', text)}
                                />
                                {fieldErrors.rewards ? <Text style={styles.errorText}>{fieldErrors.rewards}</Text> : null}
                            </View>
                        )}

                        <View style={styles.row}>
                            <View onLayout={saveFieldLayout('start_date')} style={[styles.inputGroup, { flex: 1, marginRight: 8 }]}>
                                <Text style={styles.label}>Start Date & Time *</Text>
                                <TouchableOpacity
                                    style={[styles.input, styles.dateTouchable, fieldErrors.start_date && styles.inputError]}
                                    onPress={() => openDatePicker('start_date')}
                                    activeOpacity={0.8}
                                >
                                    <Text style={styles.dateText}>
                                        {formatChallengeDateTime(formData.start_date, { month: 'short', includeTimeZone: false })}
                                    </Text>
                                    <Feather name="calendar" size={20} color="#888" />
                                </TouchableOpacity>
                                {fieldErrors.start_date ? <Text style={styles.errorText}>{fieldErrors.start_date}</Text> : null}
                            </View>
                            <View onLayout={saveFieldLayout('end_date')} style={[styles.inputGroup, { flex: 1, marginLeft: 8 }]}>
                                <Text style={styles.label}>End Date & Time *</Text>
                                <TouchableOpacity
                                    style={[styles.input, styles.dateTouchable, fieldErrors.end_date && styles.inputError]}
                                    onPress={() => openDatePicker('end_date')}
                                    activeOpacity={0.8}
                                >
                                    <Text style={styles.dateText}>
                                        {formatChallengeDateTime(formData.end_date, { month: 'short', includeTimeZone: false })}
                                    </Text>
                                    <Feather name="calendar" size={20} color="#888" />
                                </TouchableOpacity>
                                {fieldErrors.end_date ? <Text style={styles.errorText}>{fieldErrors.end_date}</Text> : null}
                            </View>
                        </View>
                        <Text style={styles.dateHelperText}>
                            Times are saved exactly and shown in your local time zone ({localTimeZoneLabel}).
                        </Text>
                        {showActivePicker && (
                            <View style={styles.pickerWrapper}>
                                <DateTimePicker
                                    value={pickerValue}
                                    mode={activePickerMode as 'date' | 'time' | 'datetime'}
                                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                                    onChange={handleDatePickerChange}
                                    minimumDate={
                                        activePickerMode === 'time'
                                            ? undefined
                                            : activePickerField === 'start_date'
                                                ? minStartDate
                                                : minEndDate
                                    }
                                />
                                {Platform.OS === 'ios' && (
                                    <TouchableOpacity style={styles.pickerDoneButton} onPress={closeDatePicker}>
                                        <Text style={styles.pickerDoneText}>Done</Text>
                                    </TouchableOpacity>
                                )}
                            </View>
                        )}

                        <View onLayout={saveFieldLayout('eligibility_criteria')} style={styles.inputGroup}>
                            <Text style={styles.label}>Participant eligibility criteria</Text>
                            <TextInput
                                style={[styles.input, styles.textArea, fieldErrors.eligibility_criteria && styles.inputError]}
                                placeholder="Who can participate (e.g. age, location, skill level)"
                                placeholderTextColor="#9ca3af"
                                multiline
                                numberOfLines={2}
                                value={formData.eligibility_criteria}
                                onChangeText={(text) => updateField('eligibility_criteria', text)}
                            />
                            {fieldErrors.eligibility_criteria ? <Text style={styles.errorText}>{fieldErrors.eligibility_criteria}</Text> : null}
                        </View>

                        <View onLayout={saveFieldLayout('scoring_criteria')} style={styles.inputGroup}>
                            <Text style={styles.label}>Scoring Criteria</Text>
                            <TextInput
                                style={[styles.input, styles.textArea, fieldErrors.scoring_criteria && styles.inputError]}
                                placeholder="How will winners be chosen?"
                                placeholderTextColor="#9ca3af"
                                multiline
                                numberOfLines={3}
                                value={formData.scoring_criteria}
                                onChangeText={(text) => updateField('scoring_criteria', text)}
                            />
                            {fieldErrors.scoring_criteria ? <Text style={styles.errorText}>{fieldErrors.scoring_criteria}</Text> : null}
                        </View>

                        <View onLayout={saveFieldLayout('min_content_per_account')} style={styles.inputGroup}>
                            <Text style={styles.label}>Min content per account *</Text>
                            <TextInput
                                style={[styles.input, fieldErrors.min_content_per_account && styles.inputError]}
                                placeholder="e.g. 1"
                                placeholderTextColor="#9ca3af"
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
                                <Text style={styles.submitButtonText}>{isEditMode ? 'Save Changes' : 'Submit Competition'}</Text>
                            )}
                        </TouchableOpacity>

                        <View style={styles.followUpHint}>
                            <Text style={styles.followUpHintText}>Follow-up email for approval: strongmind250@gmail.com</Text>
                        </View>

                        <View style={{ height: 40 }} />
                        </View>
                    </ScrollView>
                </KeyboardAvoidingView>
            </View>

            {/* Country code picker modal */}
            <Modal
                visible={showCountryPicker}
                transparent
                animationType="slide"
                onRequestClose={() => setShowCountryPicker(false)}
            >
                <KeyboardAvoidingView
                    style={styles.countryPickerOverlay}
                    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                    keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
                >
                    <View style={styles.countryPickerCard}>
                        <View style={styles.countryPickerHeader}>
                            <Text style={styles.countryPickerTitle}>Select country code</Text>
                            <TouchableOpacity onPress={() => { setShowCountryPicker(false); setCountrySearchQuery(''); }}>
                                <Feather name="x" size={24} color="#9ca3af" />
                            </TouchableOpacity>
                        </View>
                        <TextInput
                            style={styles.countrySearchInput}
                            placeholder="Search country or code..."
                            placeholderTextColor="#9ca3af"
                            value={countrySearchQuery}
                            onChangeText={setCountrySearchQuery}
                        />
                        <FlatList
                            data={filteredCountries}
                            keyExtractor={(item) => String(item.id)}
                            style={styles.countryList}
                            keyboardShouldPersistTaps="handled"
                            renderItem={({ item }) => (
                                <TouchableOpacity
                                    style={styles.countryRow}
                                    onPress={() => {
                                        updateField('contact_country_code', item.code?.startsWith('+') ? item.code : `+${item.code}`);
                                        setShowCountryPicker(false);
                                        setCountrySearchQuery('');
                                    }}
                                    activeOpacity={0.7}
                                >
                                    <Text style={styles.countryRowFlag}>{item.flag_emoji ?? '🏳️'}</Text>
                                    <Text style={styles.countryRowName} numberOfLines={1}>{item.name}</Text>
                                    <Text style={styles.countryRowCode}>{item.code?.startsWith('+') ? item.code : `+${item.code || ''}`}</Text>
                                </TouchableOpacity>
                            )}
                            ListEmptyComponent={
                                <View style={styles.countryListEmpty}>
                                    <Text style={styles.countryListEmptyText}>
                                        {countries.length === 0 ? 'Loading...' : 'No country found'}
                                    </Text>
                                </View>
                            }
                        />
                    </View>
                </KeyboardAvoidingView>
            </Modal>
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
        minHeight: 48,
        color: '#fff',
        fontSize: 16,
    },
    inputSingleLine: {
        minHeight: 48,
    },
    organizerContactRow: {
        flexDirection: 'row',
        marginBottom: 16,
        gap: 12,
        alignItems: 'flex-start',
    },
    organizerNameWrap: {
        flex: 1,
        minWidth: 140,
    },
    organizerNameInput: {
        width: '100%',
    },
    contactPhoneWrap: {
        flex: 1,
        minWidth: 160,
    },
    phoneRow: {
        flexDirection: 'row',
        gap: 8,
        alignItems: 'center',
    },
    phoneCodeBox: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: '#1a1a1a',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#333',
        paddingHorizontal: 12,
        minHeight: 48,
        minWidth: 88,
    },
    phoneCodeText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '600',
    },
    phoneDigitsInput: {
        flex: 1,
        minHeight: 48,
    },
    countryPickerOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.6)',
        justifyContent: 'flex-end',
    },
    countryPickerCard: {
        backgroundColor: '#1a1a1a',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        maxHeight: '70%',
        paddingBottom: 24,
    },
    countryPickerHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingVertical: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#333',
    },
    countryPickerTitle: {
        color: '#fff',
        fontSize: 18,
        fontWeight: '700',
    },
    countrySearchInput: {
        backgroundColor: '#232326',
        borderRadius: 12,
        marginHorizontal: 20,
        marginTop: 12,
        paddingHorizontal: 16,
        paddingVertical: 12,
        minHeight: 48,
        color: '#fff',
        fontSize: 16,
        borderWidth: 1,
        borderColor: '#333',
    },
    countryList: {
        maxHeight: 360,
        marginTop: 8,
    },
    countryRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 14,
        paddingHorizontal: 20,
        borderBottomWidth: 1,
        borderBottomColor: '#2a2a2a',
    },
    countryRowFlag: {
        fontSize: 22,
        marginRight: 12,
    },
    countryRowName: {
        flex: 1,
        color: '#f3f4f6',
        fontSize: 16,
    },
    countryRowCode: {
        color: '#9ca3af',
        fontSize: 15,
        fontWeight: '600',
    },
    countryListEmpty: {
        padding: 24,
        alignItems: 'center',
    },
    countryListEmptyText: {
        color: '#9ca3af',
        fontSize: 15,
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
        flex: 1,
        paddingRight: 12,
    },
    dateHelperText: {
        color: '#9ca3af',
        fontSize: 12,
        lineHeight: 18,
        marginTop: -4,
        marginBottom: 12,
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
    followUpHint: {
        marginTop: 16,
        paddingVertical: 12,
        paddingHorizontal: 16,
        backgroundColor: 'rgba(96, 165, 250, 0.12)',
        borderRadius: 10,
        borderLeftWidth: 4,
        borderLeftColor: '#60a5fa',
    },
    followUpHintText: {
        color: '#93c5fd',
        fontSize: 14,
    },
});
