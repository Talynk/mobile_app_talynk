import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { APP_VERSION } from '@/lib/config';

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

const VALUES = [
  { icon: 'star', title: 'Authenticity First', description: 'Every piece of content on Talentix is 100% real. No AI-generated content, no filters that alter the truth — just pure, raw talent.' },
  { icon: 'users', title: 'Community Driven', description: 'We believe the best talent rises through genuine community engagement. Your voice matters — every like, comment, and share helps shape who gets discovered.' },
  { icon: 'globe', title: 'Global Stage', description: 'Talent knows no borders. Talentix connects creators from every corner of the world, giving everyone an equal opportunity to shine.' },
  { icon: 'award', title: 'Fair Competition', description: 'Our challenge system creates exciting, transparent competitions where talent speaks louder than follower counts.' },
  { icon: 'shield', title: 'Safe Space', description: 'We\'re committed to maintaining a respectful, inclusive environment where creators feel safe to express themselves.' },
];

const STATS = [
  { label: 'Founded', value: '2024' },
  { label: 'Version', value: `v${APP_VERSION}` },
  { label: 'Platform', value: 'iOS & Android' },
];

export default function AboutScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} hitSlop={12}>
          <Feather name="arrow-left" size={24} color={THEME.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>About Talentix</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.logoCircle}>
            <Text style={styles.logoText}>T</Text>
          </View>
          <Text style={styles.heroTitle}>Talentix</Text>
          <Text style={styles.heroTagline}>Where Authentic Talent Shines</Text>
        </View>

        {/* Story */}
        <View style={styles.storyCard}>
          <Text style={styles.storyTitle}>Our Story</Text>
          <Text style={styles.storyText}>
            Talentix was born from a simple observation: in a world flooded with filters, AI-generated content, and manufactured personas, genuine talent often gets buried. We asked ourselves — what if there was a platform where authenticity wasn't just encouraged, it was required?
          </Text>
          <Text style={styles.storyText}>
            That's Talentix. A social platform built specifically for talented individuals who want to showcase their real skills. Whether you're a musician, dancer, artist, comedian, athlete, or any kind of creator — Talentix is your stage.
          </Text>
          <Text style={styles.storyText}>
            Our unique challenge system creates exciting competitions where the community decides who shines brightest. No algorithms boosting paid content, no shortcuts — just pure talent meeting genuine appreciation.
          </Text>
        </View>

        {/* Mission */}
        <View style={styles.missionCard}>
          <Feather name="target" size={22} color={THEME.accent} />
          <Text style={styles.missionLabel}>OUR MISSION</Text>
          <Text style={styles.missionText}>
            To create the world's most authentic talent discovery platform where every creator has a fair chance to be seen, appreciated, and celebrated for who they truly are.
          </Text>
        </View>

        {/* Values */}
        <Text style={styles.valuesTitle}>What We Stand For</Text>
        {VALUES.map((value, i) => (
          <View key={i} style={styles.valueCard}>
            <View style={styles.valueIcon}>
              <Feather name={value.icon as any} size={20} color={THEME.accent} />
            </View>
            <View style={styles.valueText}>
              <Text style={styles.valueTitle}>{value.title}</Text>
              <Text style={styles.valueDescription}>{value.description}</Text>
            </View>
          </View>
        ))}

        {/* Stats */}
        <View style={styles.statsRow}>
          {STATS.map((stat, i) => (
            <View key={i} style={styles.statCard}>
              <Text style={styles.statValue}>{stat.value}</Text>
              <Text style={styles.statLabel}>{stat.label}</Text>
            </View>
          ))}
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>Made with ❤️ for creators everywhere</Text>
          <Text style={styles.footerCopy}>© {new Date().getFullYear()} Talentix. All rights reserved.</Text>
          <Text style={styles.footerContact}>contact@support.talentix.net</Text>
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
  scrollContent: { padding: 20, paddingBottom: 40 },
  // Hero
  hero: { alignItems: 'center', paddingVertical: 24 },
  logoCircle: {
    width: 80, height: 80, borderRadius: 24,
    backgroundColor: THEME.accentDim, alignItems: 'center', justifyContent: 'center',
    marginBottom: 16, borderWidth: 2, borderColor: 'rgba(96, 165, 250, 0.2)',
  },
  logoText: { fontSize: 36, fontWeight: '900', color: THEME.accent },
  heroTitle: { color: THEME.text, fontSize: 28, fontWeight: '800', letterSpacing: 1, marginBottom: 4 },
  heroTagline: { color: THEME.textSecondary, fontSize: 14, fontWeight: '500', fontStyle: 'italic' },
  // Story
  storyCard: {
    backgroundColor: THEME.card, borderRadius: 14, borderWidth: 1,
    borderColor: THEME.cardBorder, padding: 20, marginBottom: 20,
  },
  storyTitle: { color: THEME.text, fontSize: 18, fontWeight: '700', marginBottom: 12 },
  storyText: { color: THEME.textSecondary, fontSize: 14, lineHeight: 22, marginBottom: 12 },
  // Mission
  missionCard: {
    backgroundColor: THEME.accentDim, borderRadius: 14, padding: 20,
    alignItems: 'center', marginBottom: 24, borderWidth: 1,
    borderColor: 'rgba(96, 165, 250, 0.15)',
  },
  missionLabel: { color: THEME.accent, fontSize: 11, fontWeight: '800', letterSpacing: 2, marginTop: 10, marginBottom: 8 },
  missionText: { color: THEME.text, fontSize: 14, lineHeight: 22, textAlign: 'center' },
  // Values
  valuesTitle: { color: THEME.text, fontSize: 18, fontWeight: '700', marginBottom: 14, marginLeft: 4 },
  valueCard: {
    flexDirection: 'row', backgroundColor: THEME.card, borderRadius: 12,
    borderWidth: 1, borderColor: THEME.cardBorder, padding: 14,
    marginBottom: 10, alignItems: 'flex-start',
  },
  valueIcon: {
    width: 40, height: 40, borderRadius: 10,
    backgroundColor: THEME.accentDim, alignItems: 'center', justifyContent: 'center',
    marginRight: 14,
  },
  valueText: { flex: 1 },
  valueTitle: { color: THEME.text, fontSize: 15, fontWeight: '700', marginBottom: 4 },
  valueDescription: { color: THEME.textSecondary, fontSize: 13, lineHeight: 19 },
  // Stats
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14, marginBottom: 24 },
  statCard: {
    flex: 1, alignItems: 'center', backgroundColor: THEME.card,
    borderRadius: 12, borderWidth: 1, borderColor: THEME.cardBorder,
    paddingVertical: 16, marginHorizontal: 4,
  },
  statValue: { color: THEME.accent, fontSize: 18, fontWeight: '800', marginBottom: 2 },
  statLabel: { color: THEME.textSecondary, fontSize: 11, fontWeight: '600' },
  // Footer
  footer: { alignItems: 'center', paddingTop: 12, paddingBottom: 20 },
  footerText: { color: THEME.textSecondary, fontSize: 14, marginBottom: 4 },
  footerCopy: { color: THEME.textSecondary, fontSize: 11, opacity: 0.5, marginBottom: 2 },
  footerContact: { color: THEME.accent, fontSize: 12, fontWeight: '600', opacity: 0.7 },
});
