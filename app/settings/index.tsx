import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  Animated,
} from 'react-native';
import { router } from 'expo-router';
import { MaterialIcons, Feather, Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/auth-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Avatar } from '@/components/Avatar';
import { APP_VERSION } from '@/lib/config';

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
  divider: '#1c1c22',
};

interface SettingsItem {
  key: string;
  label: string;
  subtitle?: string;
  icon: string;
  iconFamily?: 'material' | 'feather' | 'ionicons';
  color?: string;
  bgColor?: string;
  onPress: () => void;
  danger?: boolean;
}

interface SettingsSection {
  title: string;
  icon?: string;
  items: SettingsItem[];
}

function AnimatedRow({ children, index }: { children: React.ReactNode; index: number }) {
  const scale = React.useRef(new Animated.Value(1)).current;

  const onPressIn = () => {
    Animated.spring(scale, {
      toValue: 0.97,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start();
  };

  const onPressOut = () => {
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start();
  };

  return (
    <Animated.View
      style={{ transform: [{ scale }] }}
      onTouchStart={onPressIn}
      onTouchEnd={onPressOut}
      onTouchCancel={onPressOut}
    >
      {children}
    </Animated.View>
  );
}

function IconBadge({ name, family = 'material', color = THEME.accent, bgColor }: {
  name: string;
  family?: 'material' | 'feather' | 'ionicons';
  color?: string;
  bgColor?: string;
}) {
  const bg = bgColor || (color === THEME.danger ? THEME.dangerDim : THEME.accentDim);
  const IconComponent = family === 'feather' ? Feather : family === 'ionicons' ? Ionicons : MaterialIcons;
  return (
    <View style={[styles.iconBadge, { backgroundColor: bg }]}>
      <IconComponent name={name as any} size={20} color={color} />
    </View>
  );
}

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();

  const handleLogout = () => {
    Alert.alert(
      'Log Out',
      'Are you sure you want to log out of your account?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log Out',
          style: 'destructive',
          onPress: async () => {
            await logout();
            router.replace('/auth/login');
          },
        },
      ]
    );
  };

  const handleDeleteAccount = () => {
    router.push('/settings/delete-account' as any);
  };

  const sections: SettingsSection[] = [
    {
      title: 'SECURITY',
      icon: 'shield',
      items: [
        {
          key: 'change_password',
          label: 'Change Password',
          subtitle: 'Update your account password',
          icon: 'lock',
          iconFamily: 'feather',
          onPress: () => router.push('/settings/change-password' as any),
        },
        {
          key: 'sessions',
          label: 'Active Sessions',
          subtitle: 'Manage where you\'re logged in',
          icon: 'smartphone',
          iconFamily: 'feather',
          onPress: () => router.push('/settings/sessions' as any),
        },
      ],
    },
    {
      title: 'SUPPORT',
      icon: 'help-circle',
      items: [
        {
          key: 'help',
          label: 'Help Center',
          subtitle: 'FAQs and guides',
          icon: 'help-circle',
          iconFamily: 'feather',
          onPress: () => router.push('/settings/help-center' as any),
        },
        {
          key: 'report',
          label: 'Report a Problem',
          subtitle: 'Let us know what went wrong',
          icon: 'alert-triangle',
          iconFamily: 'feather',
          onPress: () => router.push('/settings/report-problem' as any),
        },
      ],
    },
    {
      title: 'LEGAL',
      icon: 'file-text',
      items: [
        {
          key: 'terms',
          label: 'Terms & Conditions',
          subtitle: 'Our terms of service',
          icon: 'file-text',
          iconFamily: 'feather',
          onPress: () => router.push('/auth/terms'),
        },
        {
          key: 'privacy',
          label: 'Privacy Policy',
          subtitle: 'How we handle your data',
          icon: 'shield',
          iconFamily: 'feather',
          onPress: () => router.push('/settings/privacy-policy' as any),
        },
        {
          key: 'about',
          label: 'About Talentix',
          subtitle: 'Our story and mission',
          icon: 'info',
          iconFamily: 'feather',
          onPress: () => router.push('/settings/about' as any),
        },
      ],
    },
    {
      title: 'ACCOUNT',
      icon: 'user',
      items: [
        {
          key: 'logout',
          label: 'Log Out',
          subtitle: 'Sign out of this device',
          icon: 'log-out',
          iconFamily: 'feather',
          color: THEME.danger,
          onPress: handleLogout,
          danger: true,
        },
        {
          key: 'delete',
          label: 'Delete Account',
          subtitle: 'Permanently remove your account',
          icon: 'trash-2',
          iconFamily: 'feather',
          color: THEME.danger,
          onPress: handleDeleteAccount,
          danger: true,
        },
      ],
    },
  ];

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} hitSlop={12}>
          <Feather name="arrow-left" size={24} color={THEME.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Profile Card */}
        <TouchableOpacity
          style={styles.profileCard}
          activeOpacity={0.8}
          onPress={() => router.push('/(tabs)/profile')}
        >
          <LinearGradient
            colors={['rgba(96, 165, 250, 0.08)', 'rgba(96, 165, 250, 0.02)']}
            style={styles.profileGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <Avatar
              user={user}
              size={56}
              fallbackName={user?.username || user?.name || 'U'}
            />
            <View style={styles.profileInfo}>
              <Text style={styles.profileName} numberOfLines={1}>
                {user?.username || user?.name || 'User'}
              </Text>
              <Text style={styles.profileEmail} numberOfLines={1}>
                {user?.email || 'user@talynk.com'}
              </Text>
            </View>
            <Feather name="chevron-right" size={20} color={THEME.textSecondary} />
          </LinearGradient>
        </TouchableOpacity>

        {/* Sections */}
        {sections.map((section, sIdx) => (
          <View key={section.title} style={styles.sectionWrapper}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
            </View>
            <View style={styles.sectionCard}>
              {section.items.map((item, iIdx) => (
                <AnimatedRow key={item.key} index={iIdx}>
                  <TouchableOpacity
                    style={[
                      styles.row,
                      iIdx < section.items.length - 1 && styles.rowBorder,
                    ]}
                    onPress={item.onPress}
                    activeOpacity={0.65}
                  >
                    <IconBadge
                      name={item.icon}
                      family={item.iconFamily}
                      color={item.color || THEME.accent}
                    />
                    <View style={styles.rowTextWrap}>
                      <Text
                        style={[
                          styles.rowLabel,
                          item.danger && { color: THEME.danger },
                        ]}
                      >
                        {item.label}
                      </Text>
                      {item.subtitle && (
                        <Text style={styles.rowSubtitle}>{item.subtitle}</Text>
                      )}
                    </View>
                    <Feather
                      name="chevron-right"
                      size={18}
                      color={item.danger ? THEME.danger : THEME.textSecondary}
                      style={{ opacity: 0.6 }}
                    />
                  </TouchableOpacity>
                </AnimatedRow>
              ))}
            </View>
          </View>
        ))}

        {/* App Info Footer */}
        <View style={styles.footer}>
          <View style={styles.footerLogoRow}>
            <Text style={styles.footerAppName}>Talentix</Text>
            <View style={styles.versionBadge}>
              <Text style={styles.versionText}>v{APP_VERSION}</Text>
            </View>
          </View>
          <Text style={styles.footerTagline}>Where Authentic Talent Shines ✨</Text>
          <Text style={styles.footerCopy}>© {new Date().getFullYear()} Talentix. All rights reserved.</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: THEME.bg,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
  },
  headerTitle: {
    color: THEME.text,
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  // Profile card
  profileCard: {
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 28,
    borderWidth: 1,
    borderColor: THEME.cardBorder,
  },
  profileGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  profileInfo: {
    flex: 1,
    marginLeft: 14,
  },
  profileName: {
    color: THEME.text,
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  profileEmail: {
    color: THEME.textSecondary,
    fontSize: 13,
    marginTop: 2,
  },
  // Sections
  sectionWrapper: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    marginLeft: 4,
  },
  sectionTitle: {
    color: THEME.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  sectionCard: {
    backgroundColor: THEME.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: THEME.cardBorder,
    overflow: 'hidden',
  },
  // Rows
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  rowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: THEME.divider,
  },
  iconBadge: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTextWrap: {
    flex: 1,
    marginLeft: 14,
  },
  rowLabel: {
    color: THEME.text,
    fontSize: 15,
    fontWeight: '600',
  },
  rowSubtitle: {
    color: THEME.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  // Footer
  footer: {
    alignItems: 'center',
    paddingTop: 20,
    paddingBottom: 32,
  },
  footerLogoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  footerAppName: {
    color: THEME.textSecondary,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  versionBadge: {
    backgroundColor: THEME.accentDim,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginLeft: 8,
  },
  versionText: {
    color: THEME.accent,
    fontSize: 11,
    fontWeight: '700',
  },
  footerTagline: {
    color: THEME.textSecondary,
    fontSize: 13,
    marginBottom: 4,
    opacity: 0.7,
  },
  footerCopy: {
    color: THEME.textSecondary,
    fontSize: 11,
    opacity: 0.5,
  },
});