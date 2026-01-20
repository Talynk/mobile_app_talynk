import React, { useRef } from 'react';
import { View, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Video, ResizeMode, AVPlaybackStatus } from 'expo-av';
import { Feather } from '@expo/vector-icons';
import { useVideoMute } from '@/lib/hooks/use-video-mute';

interface VideoPlayerProps {
  source: string | { uri: string };
  style?: any;
  resizeMode?: ResizeMode;
  shouldPlay?: boolean;
  isLooping?: boolean;
  useNativeControls?: boolean;
  isMuted?: boolean;
  volume?: number;
  onPlaybackStatusUpdate?: (status: AVPlaybackStatus) => void;
  onPress?: () => void;
  showMuteToggle?: boolean;
  testID?: string;
}

/**
 * Reusable Video Player component with click-to-mute functionality
 * Clicking in the middle of the video toggles mute/unmute (Instagram-style)
 */
export const VideoPlayer = React.forwardRef<Video, VideoPlayerProps>(({
  source,
  style,
  resizeMode = ResizeMode.CONTAIN,
  shouldPlay = false,
  isLooping = false,
  useNativeControls = false,
  isMuted: initialMuted = true,
  volume = 0,
  onPlaybackStatusUpdate,
  onPress,
  showMuteToggle = true,
  testID,
}, ref) => {
  const videoRef = useRef<Video>(null);
  const { isMuted, toggleMute } = useVideoMute();
  const [isLoading, setIsLoading] = React.useState(false);

  // Use external mute state if provided
  const effectiveIsMuted = initialMuted !== undefined ? initialMuted : isMuted;

  const handleVideoPress = () => {
    if (showMuteToggle) {
      toggleMute();
    }
    onPress?.();
  };

  const handlePlaybackStatusUpdate = (status: AVPlaybackStatus) => {
    if (status.isLoaded) {
      setIsLoading(false);
    }
    onPlaybackStatusUpdate?.(status);
  };

  return (
    <View style={style}>
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={handleVideoPress}
        style={styles.videoContainer}
      >
        <Video
          ref={ref || videoRef}
          source={typeof source === 'string' ? { uri: source } : source}
          style={styles.video}
          resizeMode={resizeMode}
          shouldPlay={shouldPlay}
          isLooping={isLooping}
          isMuted={effectiveIsMuted}
          volume={effectiveIsMuted ? 0 : (volume !== undefined ? volume : 1)}
          useNativeControls={useNativeControls}
          onPlaybackStatusUpdate={handlePlaybackStatusUpdate}
          onLoadStart={() => setIsLoading(true)}
          testID={testID}
        />

        {/* Mute indicator overlay - visible in center */}
        {showMuteToggle && (
          <View style={styles.muteIndicatorContainer}>
            {isLoading && (
              <ActivityIndicator size="small" color="rgba(255,255,255,0.6)" />
            )}
            {!isLoading && effectiveIsMuted && (
              <View style={styles.muteIcon}>
                <Feather name="volume-x" size={32} color="rgba(255,255,255,0.7)" />
              </View>
            )}
          </View>
        )}
      </TouchableOpacity>
    </View>
  );
});

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
