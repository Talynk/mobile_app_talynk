import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { router } from 'expo-router';
import { safeRouterBack } from '@/lib/utils/navigation';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const THEME = {
  bg: '#000000',
  card: '#111114',
  cardBorder: '#1e1e24',
  accent: '#60a5fa',
  text: '#f3f4f6',
  textSecondary: '#a1a1aa',
};

const SECTIONS = [
  {
    title: '1. Information We Collect',
    content: `When you use Talentix, we collect information that you provide directly:

• **Account Information**: Your name, email address, phone number, country, date of birth, and profile picture when you create an account.
• **Content**: Videos, images, captions, comments, and other content you post on the platform.
• **Communications**: Messages you send to our support team.

We also automatically collect:

• **Device Information**: Device type, operating system, unique device identifiers, and app version.
• **Usage Data**: How you interact with the app, including pages viewed, features used, and time spent.
• **Log Data**: IP addresses, browser type, and session information.`,
  },
  {
    title: '2. How We Use Your Information',
    content: `We use the information we collect to:

• Provide, maintain, and improve the Talentix platform.
• Process and manage your account.
• Moderate content to ensure compliance with our community guidelines.
• Run challenges and competitions, including determining and announcing winners.
• Send you important updates, security alerts, and support messages.
• Analyze usage patterns to improve user experience.
• Prevent fraud and maintain the security of our platform.`,
  },
  {
    title: '3. How We Share Your Information',
    content: `We do not sell your personal information. We may share your information in the following circumstances:

• **Public Profile**: Your username, profile picture, bio, and public posts are visible to all users.
• **Service Providers**: We share data with trusted third-party services that help us operate (e.g., cloud hosting, analytics).
• **Legal Requirements**: We may disclose information when required by law or to protect rights, safety, and property.
• **With Your Consent**: We may share information with your explicit permission.`,
  },
  {
    title: '4. Data Security',
    content: `We implement industry-standard security measures to protect your information:

• Encryption of data in transit (TLS/SSL) and at rest.
• Secure authentication with token-based sessions.
• Regular security audits and monitoring.
• Access controls limiting who can view your data.

While we strive to protect your data, no method of electronic transmission or storage is 100% secure.`,
  },
  {
    title: '5. Data Retention',
    content: `We retain your personal information for as long as your account is active or as needed to provide services. When you delete your account:

• Your profile, posts, and content are permanently removed.
• Certain data may be retained for legal compliance or dispute resolution purposes.
• Anonymized, aggregated data may be retained for analytics.`,
  },
  {
    title: '6. Your Rights',
    content: `You have the following rights regarding your data:

• **Access**: You can view your personal information through your profile settings.
• **Correction**: You can update your profile information at any time.
• **Deletion**: You can delete your account and all associated data through Settings > Delete Account.
• **Data Portability**: You can request a copy of your data by contacting support.
• **Withdraw Consent**: You can revoke permissions at any time through your device settings.`,
  },
  {
    title: '7. Cookies and Tracking',
    content: `The Talentix mobile app does not use traditional browser cookies. However, we may use:

• Local storage to remember your preferences and login state.
• Analytics tools to understand app usage patterns.
• Device identifiers for fraud prevention and session management.`,
  },
  {
    title: '8. Children\'s Privacy',
    content: `Talentix is not intended for children under the age of 13. We do not knowingly collect personal information from children under 13. If we learn that we have collected such information, we will take steps to delete it promptly.`,
  },
  {
    title: '9. Changes to This Policy',
    content: `We may update this Privacy Policy from time to time. We will notify you of significant changes through the app or via email. Your continued use of Talentix after changes are posted constitutes your acceptance of the updated policy.`,
  },
  {
    title: '10. Contact Us',
    content: `If you have questions or concerns about this Privacy Policy or our data practices, please contact us:

• **Email**: contact@support.talentix.net
• **In-App**: Settings > Support > Report a Problem`,
  },
];

export default function PrivacyPolicyScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => safeRouterBack(router, '/settings/index' as any)} style={styles.backButton} hitSlop={12}>
          <Feather name="arrow-left" size={24} color={THEME.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Privacy Policy</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>Privacy Policy</Text>
        <Text style={styles.lastUpdated}>
          Last updated: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
        </Text>
        <Text style={styles.intro}>
          At Talentix, we take your privacy seriously. This Privacy Policy explains how we collect, use, share, and protect your personal information when you use our platform.
        </Text>

        {SECTIONS.map((section, i) => (
          <View key={i} style={styles.section}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            <Text style={styles.sectionText}>{section.content}</Text>
          </View>
        ))}

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            By using Talentix, you acknowledge that you have read and understood this Privacy Policy.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: THEME.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 12, backgroundColor: THEME.bg,
    borderBottomWidth: 1, borderBottomColor: THEME.cardBorder,
  },
  backButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: THEME.text, fontSize: 18, fontWeight: '700', flex: 1, textAlign: 'center' },
  scrollView: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 40 },
  title: { color: THEME.text, fontSize: 28, fontWeight: '700', marginBottom: 8 },
  lastUpdated: { color: THEME.textSecondary, fontSize: 14, marginBottom: 20 },
  intro: { color: THEME.textSecondary, fontSize: 15, lineHeight: 24, marginBottom: 28 },
  section: { marginBottom: 24 },
  sectionTitle: { color: THEME.text, fontSize: 18, fontWeight: '600', marginBottom: 12 },
  sectionText: { color: THEME.textSecondary, fontSize: 15, lineHeight: 24 },
  footer: {
    marginTop: 24, paddingTop: 24,
    borderTopWidth: 1, borderTopColor: THEME.cardBorder,
  },
  footerText: { color: THEME.textSecondary, fontSize: 14, lineHeight: 20, fontStyle: 'italic', textAlign: 'center' },
});
