import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  StatusBar,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const THEME = {
  background: '#000000',
  card: '#232326',
  border: '#27272a',
  text: '#f3f4f6',
  textSecondary: '#a1a1aa',
  primary: '#60a5fa',
};

export default function TermsAndConditionsScreen() {
  const insets = useSafeAreaInsets();
  const C = THEME;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: C.background }]}>
      <StatusBar barStyle="light-content" />
      
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
          hitSlop={10}
        >
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: C.text }]}>Terms and Conditions</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.title, { color: C.text }]}>Terms and Conditions</Text>
        <Text style={[styles.lastUpdated, { color: C.textSecondary }]}>
          Last updated: {new Date().toLocaleDateString()}
        </Text>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: C.text }]}>1. Acceptance of Terms</Text>
          <Text style={[styles.sectionText, { color: C.textSecondary }]}>
            By accessing and using Talentix, you accept and agree to be bound by the terms and provision of this agreement. If you do not agree to abide by the above, please do not use this service.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: C.text }]}>2. Use License</Text>
          <Text style={[styles.sectionText, { color: C.textSecondary }]}>
            Permission is granted to temporarily download one copy of Talentix for personal, non-commercial transitory viewing only. This is the grant of a license, not a transfer of title, and under this license you may not:
          </Text>
          <Text style={[styles.bulletPoint, { color: C.textSecondary }]}>
            • Modify or copy the materials
          </Text>
          <Text style={[styles.bulletPoint, { color: C.textSecondary }]}>
            • Use the materials for any commercial purpose or for any public display
          </Text>
          <Text style={[styles.bulletPoint, { color: C.textSecondary }]}>
            • Attempt to decompile or reverse engineer any software contained in Talentix
          </Text>
          <Text style={[styles.bulletPoint, { color: C.textSecondary }]}>
            • Remove any copyright or other proprietary notations from the materials
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: C.text }]}>3. User Content</Text>
          <Text style={[styles.sectionText, { color: C.textSecondary }]}>
            You are responsible for all content that you post, upload, or otherwise make available through Talentix. You agree not to post content that:
          </Text>
          <Text style={[styles.bulletPoint, { color: C.textSecondary }]}>
            • Is illegal, harmful, threatening, abusive, or discriminatory
          </Text>
          <Text style={[styles.bulletPoint, { color: C.textSecondary }]}>
            • Infringes on any intellectual property rights
          </Text>
          <Text style={[styles.bulletPoint, { color: C.textSecondary }]}>
            • Contains false or misleading information
          </Text>
          <Text style={[styles.bulletPoint, { color: C.textSecondary }]}>
            • Violates any applicable laws or regulations
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: C.text }]}>4. Content Authenticity</Text>
          <Text style={[styles.sectionText, { color: C.textSecondary }]}>
            All content posted on Talentix must be 100% authentic. You agree not to post:
          </Text>
          <Text style={[styles.bulletPoint, { color: C.textSecondary }]}>
            • AI-generated content, deepfakes, or manipulated media
          </Text>
          <Text style={[styles.bulletPoint, { color: C.textSecondary }]}>
            • Content created using voice changers or filters that alter quality
          </Text>
          <Text style={[styles.bulletPoint, { color: C.textSecondary }]}>
            • Any content that misrepresents your identity or abilities
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: C.text }]}>5. Intellectual Property</Text>
          <Text style={[styles.sectionText, { color: C.textSecondary }]}>
            The content, organization, graphics, design, compilation, and other matters related to Talentix are protected under applicable copyrights, trademarks, and other proprietary rights. Copying, redistribution, or use of any such materials is strictly prohibited.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: C.text }]}>6. Privacy Policy</Text>
          <Text style={[styles.sectionText, { color: C.textSecondary }]}>
            Your use of Talentix is also governed by our Privacy Policy. Please review our Privacy Policy to understand our practices regarding the collection and use of your personal information.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: C.text }]}>7. Account Security</Text>
          <Text style={[styles.sectionText, { color: C.textSecondary }]}>
            You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account. You agree to notify us immediately of any unauthorized use of your account.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: C.text }]}>8. Termination</Text>
          <Text style={[styles.sectionText, { color: C.textSecondary }]}>
            We reserve the right to terminate or suspend your account and access to Talentix at any time, without prior notice, for conduct that we believe violates these Terms and Conditions or is harmful to other users, us, or third parties.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: C.text }]}>9. Limitation of Liability</Text>
          <Text style={[styles.sectionText, { color: C.textSecondary }]}>
            Talentix shall not be liable for any indirect, incidental, special, consequential, or punitive damages resulting from your use of or inability to use the service.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: C.text }]}>10. Changes to Terms</Text>
          <Text style={[styles.sectionText, { color: C.textSecondary }]}>
            We reserve the right to modify these Terms and Conditions at any time. Your continued use of Talentix after any such changes constitutes your acceptance of the new Terms and Conditions.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: C.text }]}>11. Contact Information</Text>
          <Text style={[styles.sectionText, { color: C.textSecondary }]}>
            If you have any questions about these Terms and Conditions, please contact us at support@talynk.com.
          </Text>
        </View>

        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: C.textSecondary }]}>
            By using Talentix, you acknowledge that you have read, understood, and agree to be bound by these Terms and Conditions.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#27272a',
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    flex: 1,
    textAlign: 'center',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 8,
  },
  lastUpdated: {
    fontSize: 14,
    marginBottom: 32,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
  },
  sectionText: {
    fontSize: 15,
    lineHeight: 24,
    marginBottom: 8,
  },
  bulletPoint: {
    fontSize: 15,
    lineHeight: 24,
    marginLeft: 16,
    marginBottom: 4,
  },
  footer: {
    marginTop: 32,
    paddingTop: 24,
    borderTopWidth: 1,
    borderTopColor: '#27272a',
  },
  footerText: {
    fontSize: 14,
    lineHeight: 20,
    fontStyle: 'italic',
    textAlign: 'center',
  },
});










