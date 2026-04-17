import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  useWindowDimensions,
  Animated,
  Pressable,
  AppState,
} from 'react-native';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { useVideoPlayer, VideoView } from 'expo-video';
import { registerVideoPauser } from '@/lib/hooks/use-video-pause-on-blur';

const ONBOARDING_KEY = 'talynk_has_seen_onboarding';

interface OnboardingPage {
  id: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  color: string;
  type?: 'feature' | 'guide';
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
    paddingTop: 20,
  },
  iconContainer: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 28,
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
      "Record and share your unique talents with the world. Talentix is a platform for creative expression all over the world.",
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
  {
    id: '4',
    icon: (
      <View style={pageStyles.iconGroup}>
        <Feather name="play-circle" size={40} color="#60a5fa" />
        <MaterialIcons
          name="auto-stories"
          size={26}
          color="#fbbf24"
          style={{ position: 'absolute', top: -6, right: -10 }}
        />
      </View>
    ),
    title: 'Starter Guide',
    description:
      'Watch a quick walkthrough to learn exactly how Talentix works. You are also free to skip it.',
    color: '#60a5fa',
    type: 'guide',
  },
];

export default function OnboardingScreen() {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [currentPage, setCurrentPage] = useState(0);
  const flatListRef = useRef<FlatList>(null);
  const scrollX = useRef(new Animated.Value(0)).current;
  const [guideStarted, setGuideStarted] = useState(false);
  const [guidePlaying, setGuidePlaying] = useState(false);
  const [guideMuted, setGuideMuted] = useState(false);
  const [guideProgress, setGuideProgress] = useState(0);
  const [guideDuration, setGuideDuration] = useState(0);
  const guideSource = require('../guide_video/Talentix_Starter_Guide.mp4');
  const guidePageIndex = pages.length - 1;

  const guidePlayer = useVideoPlayer(guideSource, (player) => {
    player.loop = false;
    player.muted = false;
    player.staysActiveInBackground = false;
    player.pause();
  });

  // Pause when app goes to background
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && guidePlayer) {
        try { guidePlayer.pause(); } catch { }
        setGuidePlaying(false);
      }
    });
    return () => sub.remove();
  }, [guidePlayer]);

  // Register with global video pause coordinator
  useEffect(() => {
    if (!guidePlayer) return;
    return registerVideoPauser(() => {
      try {
        guidePlayer.pause();
      } catch { }
      setGuidePlaying(false);
    });
  }, [guidePlayer]);

  useEffect(() => {
    if (!guidePlayer) return;
    const interval = setInterval(() => {
      try {
        const ct = guidePlayer.currentTime || 0;
        const dur = guidePlayer.duration || 0;
        if (dur > 0) {
          setGuideDuration(dur);
          const ratio = Math.max(0, Math.min(1, ct / dur));
          setGuideProgress(ratio);
          if (ratio >= 0.995 && guidePlaying) {
            setGuidePlaying(false);
          }
        }
      } catch {
        // no-op
      }
    }, 250);
    return () => clearInterval(interval);
  }, [guidePlayer, guidePlaying]);

  useEffect(() => {
    if (!guidePlayer) return;
    try {
      guidePlayer.muted = guideMuted;
    } catch {
      // no-op
    }
  }, [guidePlayer, guideMuted]);

  useEffect(() => {
    if (!guidePlayer) return;
    try {
      if (currentPage === guidePageIndex && guideStarted && guidePlaying) {
        guidePlayer.play();
      } else {
        guidePlayer.pause();
      }
    } catch {
      // no-op
    }
  }, [currentPage, guidePageIndex, guidePlayer, guidePlaying, guideStarted]);

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

  const formatSeconds = (s: number) => {
    const total = Math.max(0, Math.floor(s));
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const startGuidePlayback = () => {
    if (!guidePlayer) return;
    setGuideStarted(true);
    setGuidePlaying(true);
    try {
      guidePlayer.currentTime = 0;
      guidePlayer.play();
    } catch {
      // no-op
    }
  };

  const toggleGuidePlayback = () => {
    if (!guidePlayer) return;
    setGuideStarted(true);
    setGuidePlaying((prev) => {
      const next = !prev;
      try {
        if (next) guidePlayer.play();
        else guidePlayer.pause();
      } catch {
        // no-op
      }
      return next;
    });
  };

  const seekGuideBy = (deltaSeconds: number) => {
    if (!guidePlayer) return;
    try {
      const dur = guidePlayer.duration || guideDuration || 0;
      const ct = guidePlayer.currentTime || 0;
      const next = Math.max(0, Math.min(dur > 0 ? dur : Number.MAX_SAFE_INTEGER, ct + deltaSeconds));
      guidePlayer.currentTime = next;
      if (dur > 0) {
        setGuideProgress(Math.max(0, Math.min(1, next / dur)));
      }
    } catch {
      // no-op
    }
  };

  const seekGuideToRatio = (ratio: number) => {
    if (!guidePlayer) return;
    try {
      const dur = guidePlayer.duration || guideDuration || 0;
      if (dur > 0) {
        const next = Math.max(0, Math.min(dur, dur * ratio));
        guidePlayer.currentTime = next;
        setGuideProgress(next / dur);
      }
    } catch {
      // no-op
    }
  };

  const isGuidePage = (item: OnboardingPage) => item.type === 'guide';

  const renderPage = ({ item }: { item: OnboardingPage; index: number }) => (
    <View style={[
      pageStyles.page,
      { width, height },
      isGuidePage(item) && { justifyContent: 'flex-start', paddingTop: insets.top + 50 },
    ]}>
      <View style={[
        pageStyles.content,
        isGuidePage(item) && { marginBottom: 0 },
      ]}>
        {!(item.type === 'guide' && guideStarted) && (
          <>
            <View style={[
              pageStyles.iconContainer,
              { borderColor: item.color },
              isGuidePage(item) && { width: 70, height: 70, borderRadius: 35, marginBottom: 12 },
            ]}>
              {item.icon}
            </View>
            <Text style={[
              pageStyles.title,
              isGuidePage(item) && { fontSize: 24, marginBottom: 8 },
            ]}>{item.title}</Text>
            <Text style={[
              pageStyles.description,
              isGuidePage(item) && { fontSize: 14, lineHeight: 20, marginBottom: 0 },
            ]}>{item.description}</Text>
          </>
        )}
        {item.type === 'guide' && (
          <View style={[styles.guideSection, guideStarted && styles.guideSectionPlaying]}>
            {!guideStarted && (
              <Text style={styles.guideCallToAction}>Click on the button below to start playing</Text>
            )}
            <View style={styles.guideVideoShell}>
              {!guideStarted ? (
                <Pressable style={styles.guideStartCard} onPress={startGuidePlayback}>
                  <View style={styles.guideStartIcon}>
                    <Feather name="play" size={32} color="#000" />
                  </View>
                  <TouchableOpacity style={styles.guideSkipInline} onPress={completeOnboarding}>
                    <Text style={styles.guideSkipInlineText}>Skip video and continue</Text>
                  </TouchableOpacity>
                </Pressable>
              ) : (
                <>
                  <VideoView
                    player={guidePlayer}
                    style={styles.guideVideo}
                    contentFit="contain"
                    nativeControls={false}
                  />
                  <View style={styles.guideOverlayControls}>
                    <TouchableOpacity style={styles.guideControlFab} onPress={toggleGuidePlayback}>
                      <Feather name={guidePlaying ? 'pause' : 'play'} size={18} color="#fff" />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.guideControlFab} onPress={() => setGuideMuted((m) => !m)}>
                      <Feather name={guideMuted ? 'volume-x' : 'volume-2'} size={18} color="#fff" />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.guideControlFab} onPress={() => seekGuideBy(-10)}>
                      <MaterialIcons name="replay-10" size={20} color="#fff" />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.guideControlFab} onPress={() => seekGuideBy(10)}>
                      <MaterialIcons name="forward-10" size={20} color="#fff" />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.guideControlFab} onPress={completeOnboarding}>
                      <Feather name="skip-forward" size={18} color="#fff" />
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </View>

            {guideStarted && (
              <View style={styles.guideProgressWrap}>
                <TouchableOpacity
                  activeOpacity={0.9}
                  style={styles.guideProgressTrack}
                  onPress={(e) => {
                    const { locationX } = e.nativeEvent;
                    const ratio = Math.max(0, Math.min(1, locationX / Math.max(1, width - 116)));
                    seekGuideToRatio(ratio);
                  }}
                >
                  <View style={[styles.guideProgressFill, { width: `${guideProgress * 100}%` }]} />
                </TouchableOpacity>
                <Text style={styles.guideTimeText}>
                  {formatSeconds((guidePlayer?.currentTime || 0))} / {formatSeconds(guideDuration)}
                </Text>
              </View>
            )}
          </View>
        )}
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
            {currentPage === pages.length - 1 ? 'Continue to App' : 'Next'}
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
  guideCallToAction: {
    color: '#f3f4f6',
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  guideSection: {
    width: '100%',
    marginTop: 10,
    alignItems: 'center',
  },
  guideSectionPlaying: {
    marginTop: 40,
  },
  guideVideoShell: {
    width: '100%',
    maxWidth: 460,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#000',
    borderWidth: 1,
    borderColor: '#27272a',
    paddingVertical: 10,
    marginTop: 10,
  },
  guideStartCard: {
    minHeight: 160,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  guideStartIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#60a5fa',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  guideSkipInline: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#3f3f46',
  },
  guideSkipInlineText: {
    color: '#d4d4d8',
    fontSize: 12,
    fontWeight: '600',
  },
  guideVideo: {
    width: '100%',
    aspectRatio: 9 / 16,
    maxHeight: 500,
    minHeight: 340,
    backgroundColor: '#000',
  },
  guideOverlayControls: {
    position: 'absolute',
    right: 10,
    top: 16,
    gap: 8,
  },
  guideControlFab: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  guideProgressWrap: {
    width: '100%',
    maxWidth: 440,
    marginTop: 12,
  },
  guideProgressTrack: {
    width: '100%',
    height: 8,
    borderRadius: 999,
    backgroundColor: '#27272a',
    overflow: 'hidden',
  },
  guideProgressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#60a5fa',
  },
  guideTimeText: {
    marginTop: 6,
    textAlign: 'right',
    color: '#a1a1aa',
    fontSize: 12,
    fontWeight: '500',
  },
});
