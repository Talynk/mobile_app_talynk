/**
 * Ensures the Detour HTTPS App Link intent-filter (autoVerify) is always present
 * in MainActivity, even if android/ was generated before app.json intentFilters existed.
 */
const { AndroidConfig, withAndroidManifest } = require('@expo/config-plugins');

const HOST = 'talentix.godetour.link';
const PATH_PREFIX = '/mIlEGaC9ru';

function hasDetourIntentFilter(mainActivity) {
  return mainActivity['intent-filter']?.some((filter) => {
    const entries = filter.data ?? [];
    const list = Array.isArray(entries) ? entries : [entries];
    return list.some(
      (entry) =>
        entry?.$?.['android:scheme'] === 'https' &&
        entry?.$?.['android:host'] === HOST &&
        entry?.$?.['android:pathPrefix'] === PATH_PREFIX,
    );
  });
}

function buildDetourIntentFilter() {
  return {
    $: {
      'android:autoVerify': 'true',
      'data-generated': 'true',
      'data-detour-app-link': 'true',
    },
    action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
    category: [
      { $: { 'android:name': 'android.intent.category.BROWSABLE' } },
      { $: { 'android:name': 'android.intent.category.DEFAULT' } },
    ],
    data: [
      {
        $: {
          'android:scheme': 'https',
          'android:host': HOST,
          'android:pathPrefix': PATH_PREFIX,
        },
      },
    ],
  };
}

module.exports = function withAndroidDetourAppLinks(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;
    const mainActivity = AndroidConfig.Manifest.getMainActivityOrThrow(manifest);

    if (!mainActivity['intent-filter']) {
      mainActivity['intent-filter'] = [];
    }

    if (!hasDetourIntentFilter(mainActivity)) {
      mainActivity['intent-filter'].push(buildDetourIntentFilter());
    }

    return cfg;
  });
};
