import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppActive } from '@/lib/hooks/use-app-active';
import { enterPlaybackMode } from '@/lib/media/audio-session';
import { getPostDetailCached } from '@/lib/post-details-cache';
import { getPlaybackUrl, getThumbnailUrl } from '@/lib/utils/file-url';
import { getVideoSource } from '@/lib/utils/video-source';

export default function SharedPostScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const postId = typeof id === 'string' ? id : '';
  const insets = useSafeAreaInsets();
  const isAppActive = useAppActive();

  const [post, setPost] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [videoReady, setVideoReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const pauseIndicatorOpacity = useRef(new Animated.Value(0)).current;

  const playbackUrl = post ? getPlaybackUrl(post) : null;
  const isVideo = post?.type === 'video' || !!playbackUrl;
  const thumbnailUrl = post ? getThumbnailUrl(post) : null;
  const videoSource = isVideo && playbackUrl ? getVideoSource(playbackUrl) : null;

  const player = useVideoPlayer(videoSource, (createdPlayer) => {
    try {
      createdPlayer.loop = true;
      createdPlayer.muted = false;
      createdPlayer.staysActiveInBackground = false;
      createdPlayer.timeUpdateEventInterval = 0.25;
      createdPlayer.pause();
    } catch (_) {}
  });

  const handleClose = useCallback(() => {
    try {
      player?.pause();
    } catch (_) {}
    router.replace('/(tabs)' as any);
  }, [player]);

  useEffect(() => {
    let cancelled = false;

    const loadPost = async () => {
      if (!postId) {
        setError('Invalid shared link.');
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);
        const cachedPost = await getPostDetailCached(postId, { requireNetwork: true });
        if (cancelled) return;

        if (!cachedPost) {
          setError('This video is no longer available.');
          setPost(null);
        } else {
          setPost(cachedPost);
        }
      } catch (_) {
        if (!cancelled) {
          setError('Unable to load this shared video right now.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadPost();
    return () => {
      cancelled = true;
    };
  }, [postId]);

  useEffect(() => {
    if (!player || !videoSource || !isAppActive || !isVideo) return;

    void enterPlaybackMode();
    try {
      player.play();
      setIsPlaying(true);
      setVideoReady(true);
    } catch (_) {}

    return () => {
      try {
        player.pause();
      } catch (_) {}
    };
  }, [isAppActive, isVideo, player, videoSource]);

  useEffect(() => {
    if (!player) return;

    const playingSub = player.addListener('playingChange', (event: { isPlaying: boolean }) => {
      setIsPlaying(event.isPlaying);
      if (event.isPlaying) {
        setVideoReady(true);
      }
    });

    return () => {
      try {
        playingSub.remove();
      } catch (_) {}
    };
  }, [player]);

  const handleTapToPause = useCallback(() => {
    if (!player) return;
    try {
      if (player.playing) {
        player.pause();
        Animated.timing(pauseIndicatorOpacity, {
          toValue: 1,
          duration: 120,
          useNativeDriver: true,
        }).start();
      } else {
        void enterPlaybackMode();
        player.play();
        Animated.timing(pauseIndicatorOpacity, {
          toValue: 0,
          duration: 120,
          useNativeDriver: true,
        }).start();
      }
    } catch (_) {}
  }, [pauseIndicatorOpacity, player]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#60a5fa" />
      </View>
    );
  }

  if (error || !post) {
    return (
      <SafeAreaView style={styles.centered}>
        <Text style={styles.errorTitle}>Video unavailable</Text>
        <Text style={styles.errorMessage}>{error || 'This shared video could not be opened.'}</Text>
        <TouchableOpacity style={styles.primaryButton} onPress={handleClose}>
          <Text style={styles.primaryButtonText}>Go to For You</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.container}>
      <Pressable style={styles.mediaPressable} onPress={handleTapToPause}>
        {thumbnailUrl ? (
          <Image
            source={{ uri: thumbnailUrl }}
            style={[styles.media, { opacity: isPlaying && videoReady ? 0 : 1 }]}
            resizeMode="cover"
          />
        ) : null}

        {player && videoSource ? (
          <View pointerEvents="none" style={styles.videoLayer}>
            <VideoView
              player={player}
              style={styles.media}
              contentFit="cover"
              nativeControls={false}
              useExoShutter={Platform.OS === 'android'}
            />
          </View>
        ) : null}

        <Animated.View style={[styles.pauseIndicator, { opacity: pauseIndicatorOpacity }]} pointerEvents="none">
          <Feather name="play" size={48} color="rgba(255,255,255,0.95)" />
        </Animated.View>
      </Pressable>

      <SafeAreaView style={styles.overlay} pointerEvents="box-none">
        <View style={[styles.header, { paddingTop: Math.max(insets.top, 8) }]}>
          <TouchableOpacity style={styles.closeButton} onPress={handleClose} hitSlop={12}>
            <Feather name="x" size={28} color="#fff" />
          </TouchableOpacity>
        </View>

        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <Text style={styles.username}>@{post.user?.username || post.user?.name || 'unknown'}</Text>
          {(post.caption || post.description || post.title) ? (
            <Text style={styles.caption} numberOfLines={3}>
              {post.caption || post.description || post.title}
            </Text>
          ) : null}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  centered: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  mediaPressable: {
    ...StyleSheet.absoluteFillObject,
  },
  media: {
    width: '100%',
    height: '100%',
  },
  videoLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
  },
  header: {
    paddingHorizontal: 16,
  },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  footer: {
    paddingHorizontal: 16,
  },
  username: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
  },
  caption: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 14,
    lineHeight: 20,
  },
  pauseIndicator: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  errorMessage: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 20,
  },
  primaryButton: {
    backgroundColor: '#60a5fa',
    borderRadius: 999,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  primaryButtonText: {
    color: '#000',
    fontWeight: '700',
    fontSize: 15,
  },
});
