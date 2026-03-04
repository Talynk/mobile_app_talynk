import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  useWindowDimensions,
  Animated,
} from 'react-native';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather, MaterialIcons } from '@expo/vector-icons';

const ONBOARDING_KEY = 'talynk_has_seen_onboarding';

interface OnboardingPage {
  id: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  color: string;
}

// Define pageStyles first so it's available when pages array is evaluated
const pageStyles = StyleSheet.create({
  page: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  content: {
    alignItems: 'center',
    marginBottom: 100,
  },
  iconContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 40,
  },
  iconGroup: {
    position: 'relative',
  },
  title: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 16,
    letterSpacing: -0.5,
  },
  description: {
    color: '#9ca3af',
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
  },
});

const pages: OnboardingPage[] = [
  {
    id: '1',
    icon: (
      <View style={pageStyles.iconGroup}>
        <Feather name="video" size={40} color="#60a5fa" />
        <MaterialIcons name="star" size={28} color="#fbbf24" style={{ position: 'absolute', top: -6, right: -10 }} />
      </View>
    ),
    title: 'Showcase Your Talent',
    description:
      "Record and share your unique talents with the world. Talynk is Rwanda's platform for creative expression.",
    color: '#60a5fa',
  },
  {
    id: '2',
    icon: (
      <View style={pageStyles.iconGroup}>
        <MaterialIcons name="emoji-events" size={40} color="#fbbf24" />
        <Feather name="users" size={28} color="#10b981" style={{ position: 'absolute', bottom: -6, right: -10 }} />
      </View>
    ),
    title: 'Discover & Compete',
    description:
      'Watch amazing content, join competitions, and challenge yourself to grow.',
    color: '#fbbf24',
  },
  {
    id: '3',
    icon: (
      <View style={pageStyles.iconGroup}>
        <Feather name="globe" size={40} color="#10b981" />
        <Feather name="heart" size={28} color="#ff2d55" style={{ position: 'absolute', top: -6, right: -10 }} />
      </View>
    ),
    title: 'Join the Community',
    description:
      'Connect with creators, follow your favorites, and be part of something bigger.',
    color: '#10b981',
  },
];

export default function OnboardingScreen() {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [currentPage, setCurrentPage] = useState(0);
  const flatListRef = useRef<FlatList>(null);
  const scrollX = useRef(new Animated.Value(0)).current;

  const completeOnboarding = async () => {
    await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
    router.replace('/(tabs)');
  };

  const goToNext = () => {
    if (currentPage < pages.length - 1) {
      flatListRef.current?.scrollToIndex({ index: currentPage + 1, animated: true });
    } else {
      completeOnboarding();
    }
  };

  const renderPage = ({ item, index }: { item: OnboardingPage; index: number }) => (
    <View style={[pageStyles.page, { width, height }]}>
      <View style={pageStyles.content}>
        <View style={[pageStyles.iconContainer, { borderColor: item.color }]}>
          {item.icon}
        </View>
        <Text style={pageStyles.title}>{item.title}</Text>
        <Text style={pageStyles.description}>{item.description}</Text>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={[styles.skipButton, { top: insets.top + 12 }]}
        onPress={completeOnboarding}
      >
        <Text style={styles.skipText}>Skip</Text>
      </TouchableOpacity>

      <Animated.FlatList
        ref={flatListRef}
        data={pages}
        renderItem={renderPage}
        keyExtractor={(item) => item.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        bounces={false}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { x: scrollX } } }],
          { useNativeDriver: false }
        )}
        onMomentumScrollEnd={(e) => {
          const idx = Math.round(e.nativeEvent.contentOffset.x / width);
          setCurrentPage(idx);
        }}
      />

      <View style={[styles.footer, { paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.dotsContainer}>
          {pages.map((_, i) => {
            const inputRange = [(i - 1) * width, i * width, (i + 1) * width];
            const dotWidth = scrollX.interpolate({
              inputRange,
              outputRange: [8, 24, 8],
              extrapolate: 'clamp',
            });
            const dotOpacity = scrollX.interpolate({
              inputRange,
              outputRange: [0.3, 1, 0.3],
              extrapolate: 'clamp',
            });
            return (
              <Animated.View
                key={i}
                style={[
                  styles.dot,
                  {
                    width: dotWidth,
                    opacity: dotOpacity,
                    backgroundColor: pages[currentPage].color,
                  },
                ]}
              />
            );
          })}
        </View>

        <TouchableOpacity
          style={[styles.nextButton, { backgroundColor: pages[currentPage].color }]}
          onPress={goToNext}
          activeOpacity={0.8}
        >
          <Text style={styles.nextButtonText}>
            {currentPage === pages.length - 1 ? 'Get Started' : 'Next'}
          </Text>
          <Feather
            name={currentPage === pages.length - 1 ? 'check' : 'arrow-right'}
            size={20}
            color="#000"
          />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  skipButton: {
    position: 'absolute',
    right: 20,
    zIndex: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  skipText: {
    color: '#9ca3af',
    fontSize: 16,
    fontWeight: '500',
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 24,
    alignItems: 'center',
    gap: 24,
  },
  dotsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    height: 8,
    borderRadius: 4,
  },
  nextButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 28,
    gap: 8,
    width: '100%',
  },
  nextButtonText: {
    color: '#000',
    fontSize: 18,
    fontWeight: '700',
  },
});
