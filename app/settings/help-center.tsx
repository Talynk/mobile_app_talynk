import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Animated,
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
  accentDim: 'rgba(96, 165, 250, 0.12)',
  text: '#f3f4f6',
  textSecondary: '#71717a',
  divider: '#1c1c22',
};

interface FAQItem {
  question: string;
  answer: string;
  icon: string;
}

interface FAQSection {
  title: string;
  icon: string;
  items: FAQItem[];
}

const FAQ_SECTIONS: FAQSection[] = [
  {
    title: 'Getting Started',
    icon: 'play-circle',
    items: [
      {
        question: 'How do I create my first post?',
        answer: 'Tap the "+" button at the bottom of your screen and select either "Record Video" or "Upload from Gallery." Add a caption, select a category, and hit "Publish." Your post will be reviewed and go live once approved.',
        icon: 'plus-circle',
      },
      {
        question: 'How do I edit my profile?',
        answer: 'Go to your Profile tab, then tap "Edit Profile" to update your display name, bio, profile picture, and other details.',
        icon: 'user',
      },
      {
        question: 'How do I follow someone?',
        answer: 'Visit their profile by tapping their username and tap the "Follow" button. Their content will then appear in your "Following" feed.',
        icon: 'user-plus',
      },
    ],
  },
  {
    title: 'Challenges & Competitions',
    icon: 'award',
    items: [
      {
        question: 'What are Talentix Challenges?',
        answer: 'Challenges are competitions where you can showcase your talent and compete with others. Each challenge has specific rules, a deadline, and prizes. Browse active challenges from the Challenges tab.',
        icon: 'award',
      },
      {
        question: 'How do I join a challenge?',
        answer: 'Open any active challenge, read the rules, and tap "Join Challenge." Then create and submit your content before the deadline. You can also submit existing draft posts to a challenge.',
        icon: 'upload',
      },
      {
        question: 'How are winners selected?',
        answer: 'Winners are determined by a combination of community engagement (likes) and review by challenge organizers. Top performers are featured on the Winners page after the challenge ends.',
        icon: 'star',
      },
    ],
  },
  {
    title: 'Account & Security',
    icon: 'shield',
    items: [
      {
        question: 'How do I change my password?',
        answer: 'Go to Settings > Security > Change Password. You\'ll need to enter your current password and then verify via a one-time code sent to your email.',
        icon: 'lock',
      },
      {
        question: 'How do I delete my account?',
        answer: 'Go to Settings > Account > Delete Account. This action is permanent and will remove all your data including posts, followers, and profile information. You\'ll need to verify with your password and an email code.',
        icon: 'trash-2',
      },
      {
        question: 'I forgot my password, what should I do?',
        answer: 'On the login screen, tap "Forgot Password?" and enter your email. You\'ll receive a verification code to reset your password.',
        icon: 'help-circle',
      },
      {
        question: 'How do I manage my active sessions?',
        answer: 'Go to Settings > Security > Active Sessions to see all devices logged into your account. You can revoke any session you don\'t recognize.',
        icon: 'smartphone',
      },
    ],
  },
  {
    title: 'Content & Privacy',
    icon: 'eye',
    items: [
      {
        question: 'Can I make my account private?',
        answer: 'Currently, all content on Talentix is public to foster talent discovery. We\'re exploring privacy options for future updates.',
        icon: 'eye-off',
      },
      {
        question: 'How do I report inappropriate content?',
        answer: 'Tap the three dots (⋮) on any post and select "Report." Choose a reason and submit. Our moderation team reviews all reports within 24 hours.',
        icon: 'flag',
      },
      {
        question: 'What type of content is not allowed?',
        answer: 'Content must be 100% authentic — no AI-generated content, deepfakes, or manipulated media. Harmful, abusive, discriminatory, or illegal content is strictly prohibited. See our Terms & Conditions for the full policy.',
        icon: 'alert-circle',
      },
    ],
  },
];

function FAQAccordionItem({ item }: { item: FAQItem }) {
  const [expanded, setExpanded] = useState(false);
  const animation = React.useRef(new Animated.Value(0)).current;

  const toggle = () => {
    Animated.spring(animation, {
      toValue: expanded ? 0 : 1,
      useNativeDriver: false,
      speed: 14,
      bounciness: 4,
    }).start();
    setExpanded(!expanded);
  };

  const rotate = animation.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });

  return (
    <TouchableOpacity
      style={styles.faqItem}
      onPress={toggle}
      activeOpacity={0.8}
    >
      <View style={styles.faqQuestion}>
        <View style={styles.faqIconBadge}>
          <Feather name={item.icon as any} size={16} color={THEME.accent} />
        </View>
        <Text style={styles.faqQuestionText}>{item.question}</Text>
        <Animated.View style={{ transform: [{ rotate }] }}>
          <Feather name="chevron-down" size={18} color={THEME.textSecondary} />
        </Animated.View>
      </View>
      {expanded && (
        <Text style={styles.faqAnswer}>{item.answer}</Text>
      )}
    </TouchableOpacity>
  );
}

export default function HelpCenterScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => safeRouterBack(router, '/settings/index' as any)} style={styles.backButton} hitSlop={12}>
          <Feather name="arrow-left" size={24} color={THEME.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Help Center</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Feather name="help-circle" size={36} color={THEME.accent} />
          </View>
          <Text style={styles.heroTitle}>How can we help?</Text>
          <Text style={styles.heroSubtitle}>
            Find answers to common questions below, or report a problem if you need further assistance.
          </Text>
        </View>

        {/* FAQ Sections */}
        {FAQ_SECTIONS.map((section) => (
          <View key={section.title} style={styles.section}>
            <View style={styles.sectionHeader}>
              <Feather name={section.icon as any} size={16} color={THEME.accent} />
              <Text style={styles.sectionTitle}>{section.title}</Text>
            </View>
            <View style={styles.sectionCard}>
              {section.items.map((item, i) => (
                <View key={i}>
                  <FAQAccordionItem item={item} />
                  {i < section.items.length - 1 && <View style={styles.itemDivider} />}
                </View>
              ))}
            </View>
          </View>
        ))}

        {/* Contact Support CTA */}
        <View style={styles.ctaCard}>
          <Feather name="message-circle" size={24} color={THEME.accent} />
          <Text style={styles.ctaTitle}>Still need help?</Text>
          <Text style={styles.ctaSubtitle}>
            Contact our support team and we'll get back to you as soon as possible.
          </Text>
          <TouchableOpacity
            style={styles.ctaButton}
            onPress={() => router.push('/settings/report-problem' as any)}
            activeOpacity={0.8}
          >
            <Feather name="send" size={16} color="#fff" />
            <Text style={styles.ctaButtonText}>Contact Support</Text>
          </TouchableOpacity>
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
  },
  backButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20 },
  headerTitle: { color: THEME.text, fontSize: 18, fontWeight: '700', letterSpacing: 0.3 },
  scrollView: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40 },
  // Hero
  hero: { alignItems: 'center', paddingVertical: 24 },
  heroIcon: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: THEME.accentDim, alignItems: 'center', justifyContent: 'center',
    marginBottom: 16,
  },
  heroTitle: { color: THEME.text, fontSize: 24, fontWeight: '800', marginBottom: 8 },
  heroSubtitle: { color: THEME.textSecondary, fontSize: 14, lineHeight: 20, textAlign: 'center', maxWidth: 300 },
  // Sections
  section: { marginBottom: 24 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10, marginLeft: 4 },
  sectionTitle: { color: THEME.textSecondary, fontSize: 12, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase' },
  sectionCard: {
    backgroundColor: THEME.card, borderRadius: 14,
    borderWidth: 1, borderColor: THEME.cardBorder, overflow: 'hidden',
  },
  itemDivider: { height: StyleSheet.hairlineWidth, backgroundColor: THEME.divider, marginHorizontal: 14 },
  // FAQ Item
  faqItem: { paddingHorizontal: 14, paddingVertical: 14 },
  faqQuestion: { flexDirection: 'row', alignItems: 'center' },
  faqIconBadge: {
    width: 30, height: 30, borderRadius: 8,
    backgroundColor: THEME.accentDim, alignItems: 'center', justifyContent: 'center',
    marginRight: 10,
  },
  faqQuestionText: { flex: 1, color: THEME.text, fontSize: 14, fontWeight: '600' },
  faqAnswer: { color: THEME.textSecondary, fontSize: 13, lineHeight: 20, marginTop: 10, marginLeft: 40 },
  // CTA
  ctaCard: {
    alignItems: 'center', backgroundColor: THEME.card,
    borderRadius: 14, borderWidth: 1, borderColor: THEME.cardBorder,
    padding: 24, marginTop: 8,
  },
  ctaTitle: { color: THEME.text, fontSize: 18, fontWeight: '700', marginTop: 12, marginBottom: 6 },
  ctaSubtitle: { color: THEME.textSecondary, fontSize: 13, lineHeight: 18, textAlign: 'center', marginBottom: 16 },
  ctaButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: THEME.accent, borderRadius: 10, height: 44,
    paddingHorizontal: 24, gap: 8,
  },
  ctaButtonText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
