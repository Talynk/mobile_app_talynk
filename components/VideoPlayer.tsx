import React from 'react';
import { View, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Feather } from '@expo/vector-icons';
import { useVideoMute } from '@/lib/hooks/use-video-mute';

interface VideoPlayerProps {
  source: string | { uri: string };
  style?: any;
  contentFit?: 'contain' | 'cover' | 'fill';
  shouldPlay?: boolean;
  isLooping?: boolean;
  nativeControls?: boolean;
  isMuted?: boolean;
  onPress?: () => void;
  showMuteToggle?: boolean;
  testID?: string;
}

/**
 * Reusable Video Player component with click-to-mute functionality.
 * Uses expo-video (NOT expo-av). Instagram-style tap to mute/unmute.
 */
export const VideoPlayer = ({
  source,
  style,
  contentFit = 'contain',
  shouldPlay = false,
  isLooping = false,
  nativeControls = false,
  isMuted: initialMuted,
  onPress,
  showMuteToggle = true,
  testID,
}: VideoPlayerProps) => {
  const { isMuted, toggleMute } = useVideoMute();
  const muteOpacity = React.useRef(new Animated.Value(0)).current;

  // Resolve source URI
  const uri = typeof source === 'string' ? source : source?.uri || '';

  const effectiveIsMuted = initialMuted !== undefined ? initialMuted : isMuted;

  const player = useVideoPlayer(uri || null, (p) => {
    p.loop = isLooping;
    p.muted = effectiveIsMuted;
    if (shouldPlay) {
      p.play();
    }
  });

  // Sync mute state
  React.useEffect(() => {
    if (player) {
      player.muted = effectiveIsMuted;
    }
  }, [effectiveIsMuted, player]);

  const handleVideoPress = () => {
    if (showMuteToggle) {
      toggleMute();
      // Animate mute indicator
      Animated.sequence([
        Animated.timing(muteOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.delay(800),
        Animated.timing(muteOpacity, {
          toValue: 0,
          duration: 500,
          useNativeDriver: true,
        }),
      ]).start();
    }
    onPress?.();
  };

  return (
    <View style={style}>
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={handleVideoPress}
        style={styles.videoContainer}
        testID={testID}
      >
        <VideoView
          player={player}
          style={styles.video}
          contentFit={contentFit}
          nativeControls={nativeControls}
        />

        {/* Mute indicator overlay */}
        {showMuteToggle && (
          <View style={styles.muteIndicatorContainer}>
            <Animated.View style={[styles.muteIcon, { opacity: muteOpacity }]}>
              <Feather
                name={effectiveIsMuted ? 'volume-x' : 'volume-2'}
                size={32}
                color="rgba(255,255,255,0.8)"
              />
            </Animated.View>
          </View>
        )}
      </TouchableOpacity>
    </View>
  );
};

VideoPlayer.displayName = 'VideoPlayer';

const styles = StyleSheet.create({
  videoContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
  },
  video: {
    width: '100%',
    height: '100%',
  },
  muteIndicatorContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    pointerEvents: 'none',
  },
  muteIcon: {
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: 40,
    padding: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
