module.exports = {
  project: {
    ios: {},
    android: {
      packageName: 'com.ihirwe.talynksocial'
    }
  },
  dependencies: {
    'ffmpeg-kit-react-native': {
      platforms: {
        // Android is handled by Expo config plugin + patch-package.
        android: null,
        // iOS ffmpeg-kit upstream binaries currently return 404 during pod install.
        // Disable iOS autolinking to prevent pod install failure in EAS iOS builds.
        ios: null
      }
    }
  }
};
