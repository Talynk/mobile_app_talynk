import { createDetourNativeIntentHandler } from '@swmansion/react-native-detour/expo-router';

import { detourNativeIntentConfig, isDetourConfigured } from '@/lib/detour-config';

export const redirectSystemPath = createDetourNativeIntentHandler({
  fallbackPath: '/(tabs)',
  config: isDetourConfigured ? detourNativeIntentConfig : undefined,
});
