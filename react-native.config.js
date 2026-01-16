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
        android: null  // Disable autolinking for Android - Expo config plugin handles it
      }
    }
  }
};
