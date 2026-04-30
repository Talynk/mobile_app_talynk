/**
 * iOS startup safety switches.
 *
 * Keep crash-prone startup features disabled by default on legacy/unstable devices.
 * Re-enable one-by-one for controlled rollout and fast rollback.
 */
export const IOS_STARTUP_FLAGS = {
  /**
   * Master iOS launch-safe mode.
   * true  -> keep risky startup paths disabled.
   * false -> allow startup features according to individual flags below.
   */
  launchSafeMode: true,

  /** Request push notification permission during startup boot effect. */
  enableStartupNotificationPermissionPrompt: false,

  /** Start custom iOS video cache proxy at startup. */
  enableVideoCacheProxy: false,
} as const;

