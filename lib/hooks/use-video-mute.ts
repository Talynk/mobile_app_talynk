import { useState } from 'react';

/**
 * Hook to manage video mute state with easy toggle
 * Used for click-to-mute functionality across all video players
 */
export const useVideoMute = () => {
  const [isMuted, setIsMuted] = useState(false);

  const toggleMute = () => {
    setIsMuted(prev => !prev);
  };

  const setMuted = (muted: boolean) => {
    setIsMuted(muted);
  };

  return {
    isMuted,
    toggleMute,
    setMuted,
  };
};
