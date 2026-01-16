import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
  useColorScheme,
  Platform,
  Dimensions,
  KeyboardAvoidingView,
  Image,
  Modal,
  Animated,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { router, useLocalSearchParams } from 'expo-router';
import { postsApi, challengesApi } from '@/lib/api';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialIcons, Feather } from '@expo/vector-icons';
import { uploadNotificationService } from '@/lib/notification-service';
import { categoriesApi } from '@/lib/api';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/auth-context';
import { API_BASE_URL } from '@/lib/config';
import * as FileSystem from 'expo-file-system/legacy';
import { generateThumbnail } from '@/lib/utils/thumbnail';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { Video, ResizeMode, Audio } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import ViewShot from 'react-native-view-shot';
import { WatermarkOverlay } from '@/lib/utils/watermark';
import { captureRef } from 'react-native-view-shot';
import watermarkLogo from '../../assets/images/watermark_logo.png';
import Constants from 'expo-constants';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const COLORS = {
  dark: {
    background: '#000000',
    card: '#232326',
    border: '#27272a',
    text: '#f3f4f6',
    textSecondary: '#a1a1aa',
    primary: '#60a5fa',
    inputBg: '#232326',
    inputBorder: '#27272a',
    inputText: '#f3f4f6',
    buttonBg: '#60a5fa',
    buttonText: '#fff',
    spinner: '#60a5fa',
    error: '#ef4444',
    success: '#10b981',
    warning: '#f59e0b',
    errorBg: '#7f1d1d',
    errorBorder: '#b91c1c',
    successBg: '#14532d',
    successBorder: '#22c55e',
    warningBg: '#78350f',
    warningBorder: '#f59e42',
    placeholder: '#71717a',
    buttonDisabled: '#444',
  },
};

export default function CreatePostScreen() {
  const params = useLocalSearchParams();
  const { isAuthenticated, loading: authLoading, user, token } = useAuth();
  const [title, setTitle] = useState('');
  const [caption, setCaption] = useState('');
  const [selectedGroup, setSelectedGroup] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [recordedVideoUri, setRecordedVideoUri] = useState<string | null>(null);
  const [capturedImageUri, setCapturedImageUri] = useState<string | null>(null);
  const [editedVideoUri, setEditedVideoUri] = useState<string | null>(null);
  const [thumbnailUri, setThumbnailUri] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [errors, setErrors] = useState<{ [k: string]: string }>({});
  const [accordionOpen, setAccordionOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [editing, setEditing] = useState(false);
  const [hasOpenedCameraOnMount, setHasOpenedCameraOnMount] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [cameraMode, setCameraMode] = useState<'video' | 'picture'>('video');
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [microphonePermission, requestMicrophonePermission] = useMicrophonePermissions();
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [showPostActionModal, setShowPostActionModal] = useState(false);
  const cameraRef = useRef<CameraView>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cameraViewShotRef = useRef<ViewShot>(null);
  const watermarkViewRef = useRef<View>(null);
  const imageCompositeRef = useRef<ViewShot>(null); // For compositing image + watermark
  const [tempImageUri, setTempImageUri] = useState<string | null>(null); // Temporary image for compositing
  const C = COLORS.dark;
  const [mainCategories, setMainCategories] = useState<{ id: number, name: string, children?: { id: number, name: string }[] }[]>([]);
  const [subcategories, setSubcategories] = useState<{ id: number, name: string }[]>([]);
  const insets = useSafeAreaInsets();
  const [loadingCategories, setLoadingCategories] = useState<boolean>(false);
  const [loadingSubcategories, setLoadingSubcategories] = useState<boolean>(false);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const videoRef = useRef<Video>(null);
  const [cameraFacing, setCameraFacing] = useState<'front' | 'back'>('back');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const [joinedChallenges, setJoinedChallenges] = useState<any[]>([]);
  const [selectedChallengeId, setSelectedChallengeId] = useState<string | null>(null);
  const [loadingChallenges, setLoadingChallenges] = useState(false);

  // --- AUTHENTICATION CHECK ---
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      Alert.alert(
        'Authentication Required',
        'You need to be logged in to create posts. Would you like to sign in?',
        [
          {
            text: 'Cancel',
            style: 'cancel',
            onPress: () => router.replace('/')
          },
          {
            text: 'Sign In',
            onPress: () => router.push('/auth/login')
          }
        ]
      );
    }
  }, [isAuthenticated, authLoading]);


  // --- CONFIGURE AUDIO MODE ---
  // Initialize audio mode on component mount
  useEffect(() => {
    const configureAudio = async () => {
      try {
        // Set initial audio mode for recording
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,                  // Required during recording
          playsInSilentModeIOS: true,                // Play audio even in silent mode
          shouldDuckAndroid: false,
          playThroughEarpieceAndroid: false,         // Force speaker on Android
        });
        console.log('Audio mode configured for recording');
      } catch (error) {
        console.error('Error configuring audio mode:', error);
      }
    };
    configureAudio();
  }, []);

  // Preferred category order
  const CATEGORY_ORDER = ['Music', 'Sport', 'Performance', 'Beauty', 'Arts', 'Communication'];

  // --- FETCH CATEGORIES ---
  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) return;

    const loadCategories = async () => {
      setLoadingCategories(true);
      const res = await categoriesApi.getAll();
      if (res.status === 'success' && (res.data as any)?.categories) {
        const cats = (res.data as any).categories as { id: number, name: string, children?: any[] }[];
        const mains = cats.map(c => ({ id: c.id, name: c.name, children: (c.children || []).map(sc => ({ id: sc.id, name: sc.name })) }));
        // Sort categories according to preferred order
        mains.sort((a, b) => {
          const indexA = CATEGORY_ORDER.indexOf(a.name);
          const indexB = CATEGORY_ORDER.indexOf(b.name);
          if (indexA !== -1 && indexB !== -1) return indexA - indexB;
          if (indexA !== -1) return -1;
          if (indexB !== -1) return 1;
          return a.name.localeCompare(b.name);
        });
        setMainCategories(mains);
      }
      setLoadingCategories(false);
    };
    loadCategories();
  }, [authLoading, isAuthenticated]);

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) return;

    const loadSubs = async () => {
      if (!selectedGroup) { setSubcategories([]); return; }
      setLoadingSubcategories(true);
      const parent = mainCategories.find(c => c.name === selectedGroup);
      if (!parent) { setSubcategories([]); return; }
      setSubcategories(parent.children || []);
      setLoadingSubcategories(false);
    };
    loadSubs();
  }, [authLoading, isAuthenticated, selectedGroup, mainCategories]);

  // Fetch joined challenges when authenticated
  useEffect(() => {
    const fetchJoinedChallenges = async () => {
      if (!isAuthenticated || authLoading) {
        return;
      }
      
      try {
        setLoadingChallenges(true);
        console.log('[Create] Fetching joined challenges...');
        const response = await challengesApi.getJoinedChallenges();
        console.log('[Create] Joined challenges API response:', {
          status: response.status,
          dataLength: response.data?.length,
          data: response.data
        });
        
        if (response.status === 'success' && response.data && Array.isArray(response.data)) {
          // Extract challenge objects from the response
          // Each item has a nested 'challenge' property according to the API docs
          const challenges = response.data
            .map((item: any) => {
              // Handle the API response structure: item.challenge contains the challenge object
              if (item.challenge) {
                return item.challenge;
              }
              // Fallback: if challenge is already at root level
              return item;
            })
            .filter((challenge: any) => challenge && challenge.id && challenge.name);
          
          console.log('[Create] Extracted challenges:', challenges.length, challenges);
          setJoinedChallenges(challenges);
          
          // Auto-select challenge if passed via params
          if (params.challengeId && challenges.some((c: any) => c.id === params.challengeId)) {
            setSelectedChallengeId(params.challengeId as string);
            console.log('[Create] Auto-selected challenge:', params.challengeId);
          }
        } else {
          console.warn('[Create] No joined challenges found or invalid response:', response);
          setJoinedChallenges([]);
        }
      } catch (error: any) {
        console.error('[Create] Error fetching joined challenges:', error);
        console.error('[Create] Error details:', {
          message: error.message,
          response: error.response?.data,
          status: error.response?.status
        });
        setJoinedChallenges([]);
      } finally {
        setLoadingChallenges(false);
      }
    };
    
    fetchJoinedChallenges();
  }, [isAuthenticated, authLoading, params.challengeId]);

  // --- CAMERA RECORDING ---
  // Define handleRecordVideo with useCallback so it can be used in useEffect
  const handleRecordVideo = useCallback(async () => {
    try {
      // Request camera permission
      if (!cameraPermission?.granted) {
        const cameraResult = await requestCameraPermission();
        if (!cameraResult.granted) {
          Alert.alert('Permission Required', 'Camera permission is required to record videos.');
          return;
        }
      }

      // Request microphone permission for audio recording
      if (!microphonePermission?.granted) {
        const micResult = await requestMicrophonePermission();
        if (!micResult.granted) {
          Alert.alert('Permission Required', 'Microphone permission is required to record audio with your video.');
          return;
        }
      }

      // CRITICAL: Set audio mode for recording before opening camera
      // This ensures the audio session is ready when the camera opens
      try {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,  // CRITICAL: Required for iOS audio recording
          playsInSilentModeIOS: true,
          shouldDuckAndroid: false,
          playThroughEarpieceAndroid: false,
        });
        // Small delay to ensure audio mode is fully initialized
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (audioError) {
        console.error('Error setting audio mode before camera:', audioError);
      }

      setShowCamera(true);
      setRecordingDuration(0);
    } catch (error: any) {
      console.error('Camera error:', error);
      Alert.alert('Error', error.message || 'Failed to open camera. Please try again.');
    }
  }, [cameraPermission, microphonePermission, requestCameraPermission, requestMicrophonePermission]);

  // --- AUTO OPEN CAMERA ON FIRST MOUNT WHEN AUTHENTICATED ---
  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) return;
    if (hasOpenedCameraOnMount) return;

    setHasOpenedCameraOnMount(true);

    // Small delay so the screen can finish rendering before opening the native camera.
    // This makes auto-open more reliable on some devices / platforms.
    const timeoutId = setTimeout(() => {
      handleRecordVideo();
    }, 400);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [authLoading, isAuthenticated, hasOpenedCameraOnMount, handleRecordVideo]);

  // --- CATEGORY HELPERS ---
  // All category data (main + sub) now comes directly from the backend response,
  // so we never hardcode groups or subcategories. This keeps the UI in sync
  // with whatever the backend currently holds.
  const getCategoriesForGroup = () => {
    if (!selectedGroup) return [];
    const parent = mainCategories.find(c => c.name === selectedGroup);
    return parent?.children || [];
  };
  
  const getSelectedCategoryName = () => {
    if (!selectedCategoryId) return '';
    const foundSub = subcategories.find(cat => String(cat.id) === selectedCategoryId);
    if (foundSub) return foundSub.name;

    // Fallback to loaded mainCategories (server-provided category structure)
    const foundFromLoaded = mainCategories
      .flatMap(c => c.children || [])
      .find(cat => String(cat.id) === selectedCategoryId);
    if (foundFromLoaded) return foundFromLoaded.name;

    return '';
  };

  const getSelectedCategoryId = () => {
    return selectedCategoryId || '';
  };

  // Show loading screen while checking authentication
  if (authLoading) {
    return (
      <View style={[styles.container, { backgroundColor: C.background, justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={C.primary} />
        <Text style={[{ fontSize: 16, marginTop: 12, fontWeight: '500' }, { color: C.text }]}>Loading...</Text>
      </View>
    );
  }

  // Show login prompt if not authenticated
  if (!isAuthenticated) {
    return (
      <View style={[styles.container, { backgroundColor: C.background, justifyContent: 'center', alignItems: 'center', padding: 20 }]}>
        <MaterialIcons name="lock" size={64} color={C.primary} />
        <Text style={[{ fontSize: 24, fontWeight: '700', marginTop: 20, marginBottom: 12, textAlign: 'center' }, { color: C.text }]}>Authentication Required</Text>
        <Text style={[{ fontSize: 16, lineHeight: 24, textAlign: 'center', marginBottom: 32 }, { color: C.textSecondary }]}>
          You need to be logged in to create posts and share your content with the community.
        </Text>
        <TouchableOpacity
          style={[{ paddingVertical: 16, paddingHorizontal: 32, borderRadius: 12, marginBottom: 12, minWidth: 200, alignItems: 'center' }, { backgroundColor: C.primary }]}
          onPress={() => router.push('/auth/login')}
        >
          <Text style={[{ fontSize: 16, fontWeight: '600' }, { color: C.buttonText }]}>Sign In</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[{ paddingVertical: 12, paddingHorizontal: 24, borderRadius: 12, borderWidth: 1, minWidth: 120, alignItems: 'center' }, { borderColor: C.border }]}
          onPress={() => router.replace('/')}
        >
          <Text style={[{ fontSize: 14, fontWeight: '500' }, { color: C.text }]}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const startRecording = async () => {
    if (!cameraRef.current) return;

    try {
      // Double-check microphone permission before recording
      if (!microphonePermission?.granted) {
        const micResult = await requestMicrophonePermission();
        if (!micResult.granted) {
          Alert.alert(
            'Microphone Permission Required',
            'Microphone access is required to record audio with your video. Please enable it in your device settings.',
            [{ text: 'OK' }]
          );
          setIsRecording(false);
          return;
        }
      }

      setIsRecording(true);
      setRecordingDuration(0);
      
      // Start duration timer
      recordingTimerRef.current = setInterval(() => {
        setRecordingDuration((prev) => {
          const newDuration = prev + 1;
          // Auto-stop at 2:30 (150 seconds)
          if (newDuration >= 150) {
            stopRecording();
            return 150;
          }
          return newDuration;
        });
      }, 1000);

      // CRITICAL: Set audio mode for recording BEFORE starting
      // This must be done right before recording to ensure proper audio capture
      // The order and timing here is critical for audio to work properly
      try {
        // First, ensure we're in recording mode with optimal settings
        // These settings help capture louder, clearer audio
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,  // CRITICAL: Required for iOS audio recording
          playsInSilentModeIOS: true,
          shouldDuckAndroid: false,  // Don't duck other audio on Android
          playThroughEarpieceAndroid: false, // Use speaker, not earpiece
          staysActiveInBackground: false, // Don't need background recording
        });
        
        // Verify microphone permission is still granted
        if (!microphonePermission?.granted) {
          console.error('Microphone permission not granted before recording');
          Alert.alert('Error', 'Microphone permission is required for audio recording.');
          setIsRecording(false);
          return;
        }
        
        // Small delay to ensure audio session is fully initialized
        // This is critical - without this delay, audio might not be captured properly
        // Increased delay slightly to ensure audio session is ready
        await new Promise(resolve => setTimeout(resolve, 200));
        
        console.log('Audio mode set for recording, microphone permission verified');
      } catch (audioError) {
        console.error('Error setting audio mode:', audioError);
        Alert.alert('Audio Error', 'Failed to configure audio for recording. Please try again.');
        setIsRecording(false);
        return;
      }

      // Start recording (this is async and will resolve when stopRecording is called)
      // Enhanced audio settings for better quality and volume
      // CRITICAL: These settings aim to capture clear, loud audio like native camera apps
      const recordingOptions: any = {
        maxDuration: 150, // 2:30 minutes in seconds
        mute: false, // CRITICAL: Ensure audio is not muted - explicitly set to false
        quality: 'high', // Use high quality recording
      };
      
      // Platform-specific options with enhanced audio settings
      if (Platform.OS === 'ios') {
        recordingOptions.codec = 'h264';
        recordingOptions.extension = '.mov';
        recordingOptions.videoBitrate = 5000000; // 5 Mbps video
        // iOS audio settings optimized for clear, loud audio
        recordingOptions.audioBitrate = 192000; // Increased from 128kbps for better quality
        recordingOptions.audioSampleRate = 48000; // Higher sample rate (48kHz) for better quality
        recordingOptions.audioChannels = 2; // Stereo audio
        // Note: iOS handles noise suppression automatically, but higher bitrate helps
      } else {
        // Android settings optimized for clear, loud audio
        recordingOptions.maxFileSize = 100 * 1024 * 1024; // 100MB max for Android
        recordingOptions.extension = '.mp4';
        recordingOptions.videoBitrate = 5000000; // 5 Mbps video
        // Android audio settings - optimized for video recording (like native camera)
        recordingOptions.audioBitrate = 256000; // Higher audio bitrate (256 kbps) for better quality
        recordingOptions.audioSampleRate = 48000; // Higher sample rate (48kHz) for better quality
        recordingOptions.audioChannels = 2; // Stereo audio (2 channels)
        // Try to use video-optimized audio source if available
        // Note: expo-camera may not expose audioSource directly, but higher bitrate helps
      }
      
      console.log('Starting recording with options:', recordingOptions);
      console.log('Audio mode set, microphone permission:', microphonePermission?.granted);
      
      const recordingPromise = cameraRef.current.recordAsync(recordingOptions);
      
      recordingPromise.then((video) => {
        // This will be called when recording stops
        setIsRecording(false);
        if (recordingTimerRef.current) {
          clearInterval(recordingTimerRef.current);
          recordingTimerRef.current = null;
        }
        
        if (video && video.uri) {
          if (recordingDuration > 150) {
            Alert.alert(
              'Video Too Long',
              'Your recording is longer than 2 minutes and 30 seconds. Please record a shorter video.'
            );
            setShowCamera(false);
            setRecordingDuration(0);
            return;
          }

          setRecordedVideoUri(video.uri);
          setEditedVideoUri(null);
          setCapturedImageUri(null); // Clear image when video is recorded
          
          // Generate thumbnail
          generateThumbnail(video.uri).then((thumb) => {
            setThumbnailUri(thumb);
          }).catch((thumbError) => {
            console.error('Thumbnail generation error:', thumbError);
          });
          
          setShowCamera(false);
          setRecordingDuration(0);
          // Don't show modal - buttons will be in the form
        } else {
          Alert.alert('Error', 'Failed to save video. Please try again.');
          setShowCamera(false);
          setRecordingDuration(0);
        }
      }).catch((error: any) => {
        console.error('Recording promise error:', error);
        setIsRecording(false);
        if (recordingTimerRef.current) {
          clearInterval(recordingTimerRef.current);
          recordingTimerRef.current = null;
        }
        // Don't show error if user cancelled
        if (error?.message && !error.message.includes('cancel')) {
          Alert.alert('Error', 'Failed to record video. Please try again.');
        }
        setShowCamera(false);
        setRecordingDuration(0);
      });
    } catch (error: any) {
      console.error('Recording error:', error);
      Alert.alert('Error', 'Failed to start recording. Please try again.');
      setIsRecording(false);
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
    }
  };

  const stopRecording = () => {
    if (!cameraRef.current || !isRecording) return;

    setIsRecording(false);
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    // stopRecording() returns void, the video comes from the promise in startRecording
    cameraRef.current.stopRecording();
  };

  const cancelCamera = () => {
    if (isRecording) {
      stopRecording();
    }
    setShowCamera(false);
    setRecordingDuration(0);
    setIsRecording(false);
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  };

  // --- CREATE WATERMARK IMAGE (optional helper, currently unused for upload) ---
  const createWatermarkImage = async (): Promise<string | null> => {
    try {
      if (!user?.id || !watermarkViewRef.current) {
        console.warn('User ID or watermark view not available');
        return null;
      }

      try {
        // Give React a moment to ensure the hidden watermark view is fully rendered
        await new Promise(resolve => setTimeout(resolve, 150));

        const watermarkUri = await captureRef(watermarkViewRef, {
          format: 'png',
          quality: 1.0,
        });
        return watermarkUri;
      } catch (error) {
        console.error('Error capturing watermark view:', error);
        return null;
      }
    } catch (error) {
      console.error('Error creating watermark image:', error);
      return null;
    }
  };

  // --- NORMALIZE IMAGE TO 9:16 (1080x1920) ---
  const normalizeImageAspect = async (imageUri: string): Promise<string> => {
    try {
      const info = await ImageManipulator.manipulateAsync(
        imageUri,
        [],
        { compress: 1, format: ImageManipulator.SaveFormat.JPEG }
      );

      const sourceWidth = info.width;
      const sourceHeight = info.height;

      if (!sourceWidth || !sourceHeight) {
        return imageUri;
      }

      const targetWidth = 1080;
      const targetHeight = 1920;
      const scale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);

      const resizedWidth = Math.round(sourceWidth * scale);
      const resizedHeight = Math.round(sourceHeight * scale);

      const resized = await ImageManipulator.manipulateAsync(
        imageUri,
        [{ resize: { width: resizedWidth, height: resizedHeight } }],
        { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG }
      );

      const cropOriginX = Math.max(0, Math.round((resizedWidth - targetWidth) / 2));
      const cropOriginY = Math.max(0, Math.round((resizedHeight - targetHeight) / 2));

      const cropped = await ImageManipulator.manipulateAsync(
        resized.uri,
        [{
          crop: {
            originX: cropOriginX,
            originY: cropOriginY,
            width: targetWidth,
            height: targetHeight,
          },
        }],
        { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG }
      );

      return cropped.uri;
    } catch (error) {
      console.error('Error normalizing image aspect ratio:', error);
      return imageUri;
    }
  };

  // --- ADD WATERMARK TO IMAGE ---
  // Uses view-shot to composite the watermark onto the image
  // NO FALLBACKS - MUST WORK OR THROW ERROR
  const addWatermarkToImage = async (imageUri: string): Promise<string> => {
      if (!user?.id) {
      throw new Error('[Watermark] User ID not available. Cannot add watermark to image.');
    }

    if (!imageUri) {
      throw new Error('[Watermark] Image URI is required');
      }

      // Set the image URI temporarily so we can render it in the composite view
      setTempImageUri(imageUri);
      
      // Wait a bit for the view to render
    await new Promise(resolve => setTimeout(resolve, 200));
      
      // Capture the composite view (image + watermark overlay)
    if (!imageCompositeRef.current) {
      setTempImageUri(null);
      throw new Error('[Watermark] Image composite ref not available. Cannot add watermark.');
    }

    try {
      // Use ViewShot's capture method directly
      if (!imageCompositeRef.current || typeof imageCompositeRef.current.capture !== 'function') {
        setTempImageUri(null);
        throw new Error('[Watermark] ViewShot capture method not available');
      }
      
      const watermarkedUri = await imageCompositeRef.current.capture();
      setTempImageUri(null); // Clear temp image
      
      if (!watermarkedUri) {
        throw new Error('[Watermark] Failed to capture watermarked image. ViewShot returned null.');
      }

      // Verify the output file exists
      const outputInfo = await FileSystem.getInfoAsync(watermarkedUri);
      if (!outputInfo.exists) {
        throw new Error(`[Watermark] Watermarked image file not found: ${watermarkedUri}`);
      }

      console.log('[Watermark] ✅ Image watermarked successfully:', watermarkedUri);
      return watermarkedUri;
    } catch (error: any) {
      setTempImageUri(null);
      const errorMsg = `[Watermark] Failed to add watermark to image: ${error?.message || error}`;
      console.error(errorMsg);
      throw new Error(errorMsg);
    }
  };

  // --- ADD WATERMARK TO VIDEO ---
  const addWatermarkToVideo = async (videoUri: string): Promise<string> => {
    try {
      if (!user?.id) {
        console.warn('User ID not available, skipping watermark');
        return videoUri;
      }

      // Video watermarking requires FFmpeg or server-side processing
      // For Expo Go, we can't easily watermark videos client-side
      // The best approach is server-side processing after upload
      // For now, return the original video
      console.warn('Video watermarking requires server-side processing or native modules');
      return videoUri;
    } catch (error) {
      console.error('Error adding watermark to video:', error);
      return videoUri;
    }
  };

  // --- IMAGE CAPTURE ---
  const takePicture = async () => {
    if (!cameraRef.current) return;

    try {
      let imageUri: string | null = null;

      // Use native camera capture
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.92,
        base64: false,
        skipProcessing: false,
        exif: false,
      });
      
      console.log('[Camera] Photo captured:', photo);
      
      if (photo && photo.uri) {
        imageUri = photo.uri;
        
        // Verify the image file exists and has content
        const fileInfo = await FileSystem.getInfoAsync(imageUri);
        console.log('[Camera] Image file info:', fileInfo);
        
        if (!fileInfo.exists || (fileInfo.size && fileInfo.size < 1000)) {
          console.error('[Camera] Invalid image file - size:', fileInfo.size);
          Alert.alert('Error', 'Captured image appears to be invalid. Please try again.');
          return;
        }
      }

      if (imageUri) {
        // First set the captured image immediately so user sees something
        // This prevents the "black image" issue
        setRecordedVideoUri(null);
        setEditedVideoUri(null);
        
        // Close camera to show form
        setShowCamera(false);
        
        // Process image in background - normalize and watermark
        try {
          // Normalize the image to 9:16 (1080x1920)
          const normalizedUri = await normalizeImageAspect(imageUri);
          console.log('[Camera] Normalized image URI:', normalizedUri);
          
          // Verify normalized image
          const normalizedInfo = await FileSystem.getInfoAsync(normalizedUri);
          if (!normalizedInfo.exists || (normalizedInfo.size && normalizedInfo.size < 1000)) {
            console.warn('[Camera] Normalized image invalid, using original');
            setCapturedImageUri(imageUri);
            return;
          }

          // Try to add watermark, but don't fail if it doesn't work
          try {
            const watermarkedUri = await addWatermarkToImage(normalizedUri);
            console.log('[Camera] Watermarked image URI:', watermarkedUri);
            
            // Verify watermarked image
            const watermarkedInfo = await FileSystem.getInfoAsync(watermarkedUri);
            if (watermarkedInfo.exists && watermarkedInfo.size && watermarkedInfo.size > 1000) {
              setCapturedImageUri(watermarkedUri);
            } else {
              console.warn('[Camera] Watermarked image invalid, using normalized');
              setCapturedImageUri(normalizedUri);
            }
          } catch (watermarkError: any) {
            console.warn('[Camera] Watermarking failed, using normalized image:', watermarkError.message);
            setCapturedImageUri(normalizedUri);
            showToast('Image captured');
          }
        } catch (processError: any) {
          console.error('[Camera] Image processing error:', processError);
          // If all processing fails, use the original image
          setCapturedImageUri(imageUri);
          showToast('Image captured');
        }
      } else {
        Alert.alert('Error', 'Failed to capture image. Please try again.');
      }
    } catch (error: any) {
      console.error('Image capture error:', error);
      Alert.alert('Error', `Failed to capture image: ${error.message || 'Unknown error'}. Please try again.`);
    }
  };

  // --- VIDEO EDITING --- (Re-record instead of edit)
  const handleEditVideo = async () => {
    // For now, just re-record
    handleRecordVideo();
  };

  // --- TOAST MESSAGE ---
  const showToast = (message: string) => {
    setToastMessage(message);
    Animated.sequence([
      Animated.timing(toastOpacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.delay(2500),
      Animated.timing(toastOpacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setToastMessage(null);
    });
  };

  // --- VALIDATION ---
  const validate = async () => {
    const newErrors: { [k: string]: string } = {};
    if (!caption.trim()) {
      newErrors.caption = 'Caption is required';
      showToast('Caption is required');
    }
    if (!selectedGroup) {
      newErrors.group = 'Please select a category group';
      if (!newErrors.caption) {
        showToast('Please select a category group');
      }
    }
    if (!selectedCategoryId) {
      newErrors.category = 'Please select a specific category';
      if (!newErrors.caption && !newErrors.group) {
        showToast('Please select a specific category');
      }
    }
    if (!recordedVideoUri && !editedVideoUri && !capturedImageUri) {
      newErrors.media = 'Please record a video or take a picture';
    }
    
    setErrors(newErrors);
    
    return Object.keys(newErrors).length === 0;
  };

  // Toggle camera facing
  const handleFlipCamera = () => {
    setCameraFacing(current => current === 'back' ? 'front' : 'back');
  };

  // --- SUBMIT ---
  const handleCreatePost = async (status: 'active' | 'draft' = 'active') => {
    if (!isAuthenticated || !user) {
      Alert.alert(
        'Authentication Required',
        'You need to be logged in to create posts.',
        [
          {
            text: 'Sign In',
            onPress: () => router.push('/auth/login')
          }
        ]
      );
      return;
    }

    const isValid = await validate();
    if (!isValid) return;
    
    const rawVideoUri = editedVideoUri || recordedVideoUri;
    const imageUri = capturedImageUri;
    
    if (!rawVideoUri && !imageUri) {
      Alert.alert('Error', 'No media to upload');
      return;
    }

    // Request notification permissions
    const hasPermission = await uploadNotificationService.requestPermissions();
    if (!hasPermission) {
      console.log('Notification permissions not granted');
    }
    
    setUploading(true);
    setUploadProgress(0);
    
    try {
      // Backend requires category NAME in `post_category` (not just ID)
      const categoryName = getSelectedCategoryName();
      if (!categoryName || categoryName.trim() === '') {
        setUploading(false);
        setUploadProgress(0);
        Alert.alert('Category Error', 'Selected category name is missing. Please re-select a category and try again.');
        return;
      }

      // --- FRONTEND MEDIA PROCESSING ---
      // We no longer process videos on-device with FFmpegKit because the native
      // module is unstable in this setup. Instead:
      // 1) For videos, we upload the raw recorded file.
      // 2) For images, we still normalize + watermark on-device.

      // Verify image is watermarked if it's an image
      let finalImageUri = imageUri;
      if (imageUri && !rawVideoUri) {
        try {
          finalImageUri = await addWatermarkToImage(imageUri);
        } catch (watermarkError: any) {
          setUploading(false);
          setUploadProgress(0);
          const errorMessage = watermarkError?.message || 'Failed to add watermark to image';
          console.error('[Upload] Image watermarking error:', errorMessage);
          Alert.alert(
            'Image Watermarking Failed',
            errorMessage,
            [{ text: 'OK' }]
          );
          return;
        }
      }

      const mediaUri = rawVideoUri || finalImageUri;
      if (!mediaUri) {
        throw new Error('No media file to upload');
      }

      // Get file info
      const fileInfo = await FileSystem.getInfoAsync(mediaUri);
      if (!fileInfo.exists) {
        throw new Error('Media file not found');
      }

      const isVideo = !!rawVideoUri;
      const fileName = mediaUri.split('/').pop() || (isVideo ? 'video.mp4' : 'image.jpg');
      const fileType = isVideo ? 'video/mp4' : 'image/jpeg';
      
      // Verify media file exists before uploading
      const mediaInfo = await FileSystem.getInfoAsync(mediaUri);
      if (!mediaInfo.exists) {
        throw new Error(`Media file not found at: ${mediaUri}`);
      }
      console.log('[Upload] Media file verified:', {
        uri: mediaUri,
        exists: mediaInfo.exists,
        size: mediaInfo.size,
        fileName,
        fileType
      });

      // If challenge is selected, use challenge-specific API endpoint
      if (selectedChallengeId) {
        const formData = new FormData();
        formData.append('title', caption.trim().substring(0, 50) || 'My Post');
        formData.append('caption', caption);
        formData.append('post_category', categoryName);
        formData.append('file', {
          uri: mediaUri,
          name: fileName,
          type: fileType,
        } as any);
        
        console.log('[Upload] Creating post in challenge:', {
          challengeId: selectedChallengeId,
          title: caption.trim().substring(0, 50),
          categoryName,
          fileName,
          fileType
        });
        
        const xhr = new XMLHttpRequest();
        const apiUrl = `${API_BASE_URL}/api/challenges/${selectedChallengeId}/posts`;
        
        xhr.open('POST', apiUrl);
        xhr.setRequestHeader('Accept', 'application/json');
        
        const authToken = await AsyncStorage.getItem('talynk_token');
        
        if (!authToken) {
          setUploading(false);
          setUploadProgress(0);
          Alert.alert('Authentication Error', 'Please login again to create posts.');
          router.push('/auth/login');
          return;
        }
        
        const cleanToken = authToken.trim();
        xhr.setRequestHeader('Authorization', `Bearer ${cleanToken}`);
        
        let lastLoggedPercent = -10;
        xhr.upload.onprogress = async (event) => {
          if (event.lengthComputable) {
            const percent = Math.min(Math.round((event.loaded / event.total) * 100), 100);
            setUploadProgress(percent);
            await uploadNotificationService.showUploadProgress(percent, fileName);
            
            if (percent - lastLoggedPercent >= 10 || percent === 100) {
              console.log(`Upload progress: ${percent}%`);
              lastLoggedPercent = percent;
            }
          }
        };
        
        xhr.onload = async () => {
          setUploading(false);
          setUploadProgress(0);
          
          if (xhr.status === 401) {
            await uploadNotificationService.showUploadError('Authentication failed. Please login again.', fileName);
            Alert.alert(
              'Authentication Error',
              'Authentication failed. Please login again to create posts.',
              [{ text: 'OK', onPress: () => router.push('/auth/login') }]
            );
            return;
          }
          
          try {
            const response = JSON.parse(xhr.responseText);
            console.log('[Upload] Challenge post response:', response);
            
            if (response.status === 'success') {
              await uploadNotificationService.showUploadSuccess('Post created in challenge successfully!', fileName);
              // Reset form
              setRecordedVideoUri(null);
              setCapturedImageUri(null);
              setEditedVideoUri(null);
              setThumbnailUri(null);
              setCaption('');
              setSelectedGroup('');
              setSelectedCategoryId('');
              setSelectedChallengeId(null);
              setIsVideoPlaying(false);
              // Navigate back or show success
              router.back();
            } else {
              const errorMsg = response.message || 'Failed to create post in challenge';
              await uploadNotificationService.showUploadError(errorMsg, fileName);
              Alert.alert('Upload Failed', errorMsg);
            }
          } catch (parseError) {
            console.error('[Upload] Error parsing response:', parseError);
            await uploadNotificationService.showUploadError('Failed to create post in challenge', fileName);
            Alert.alert('Upload Error', 'Failed to create post in challenge. Please try again.');
          }
        };
        
        xhr.onerror = async () => {
          setUploading(false);
          setUploadProgress(0);
          await uploadNotificationService.showUploadError('Network error. Please check your connection.', fileName);
          Alert.alert('Upload Error', 'Network error. Please check your connection and try again.');
        };
        
        xhr.send(formData);
        return;
      }
      
      // Regular post upload (no challenge)
      const formData = new FormData();
      // Use first 50 chars of caption as title, or generate one
      const autoTitle = caption.trim().substring(0, 50) || 'My Post';
      formData.append('title', autoTitle);
      // Only send caption, not both title and caption to avoid duplication
      formData.append('caption', caption);
      
      const categoryId = getSelectedCategoryId();
      
      formData.append('post_category', categoryName);
      formData.append('category_id', categoryId);
      formData.append('status', status); // Add status (pending or draft)
      
      formData.append('file', {
        uri: mediaUri,
        name: fileName,
        type: fileType,
      } as any);
      
      console.log('[Upload] FormData prepared:', {
        title: autoTitle,
        caption: caption.substring(0, 50) + '...',
        categoryName,
        categoryId,
        status,
        fileName,
        fileType
      });
      
      const xhr = new XMLHttpRequest();
      const apiUrl = `${API_BASE_URL}/api/posts`;
      
      xhr.open('POST', apiUrl);
      xhr.setRequestHeader('Accept', 'application/json');
      
      const authToken = await AsyncStorage.getItem('talynk_token');
      
      if (!authToken) {
        setUploading(false);
        setUploadProgress(0);
        Alert.alert('Authentication Error', 'Please login again to create posts.');
        router.push('/auth/login');
        return;
      }
      
      const cleanToken = authToken.trim();
      xhr.setRequestHeader('Authorization', `Bearer ${cleanToken}`);
      
      let lastLoggedPercent = -10;
      xhr.upload.onprogress = async (event) => {
        if (event.lengthComputable) {
          const percent = Math.min(Math.round((event.loaded / event.total) * 100), 100);
          setUploadProgress(percent);
          await uploadNotificationService.showUploadProgress(percent, fileName);
          
          if (percent - lastLoggedPercent >= 10 || percent === 100) {
            console.log(`Upload progress: ${percent}%`);
            lastLoggedPercent = percent;
          }
        }
      };
      
      xhr.onload = async () => {
        setUploading(false);
        setUploadProgress(0);
        
        if (xhr.status === 401) {
          await uploadNotificationService.showUploadError('Authentication failed. Please login again.', fileName);
          Alert.alert(
            'Authentication Error',
            'Authentication failed. Please login again to create posts.',
            [
              {
                text: 'Login',
                onPress: () => router.push('/auth/login')
              }
            ]
          );
          return;
        }
        
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const response = JSON.parse(xhr.responseText);
            if (response.status === 'success') {
              await uploadNotificationService.showUploadComplete(fileName);
              
              const successMessage = status === 'draft' 
                ? 'Draft saved successfully! You can publish it later from your profile.'
                : 'Post published successfully! It is now live and visible to all users.';
              
              Alert.alert(
                'Success', 
                successMessage, 
                [
                  { 
                    text: 'View Profile', 
                    onPress: () => {
                      router.replace('/(tabs)/profile');
                    }
                  }
                ]
              );
              
              // Reset form
              setCaption('');
              setSelectedGroup('');
              setSelectedCategoryId('');
              setRecordedVideoUri(null);
              setCapturedImageUri(null);
              setEditedVideoUri(null);
              setThumbnailUri(null);
              setIsVideoPlaying(false);
            } else {
              // Handle draft limit error
              if (response.message?.includes('Maximum draft limit reached') || response.message?.includes('draft limit')) {
                Alert.alert(
                  'Draft Limit Reached',
                  `You can only have a maximum of 3 draft posts. Please publish or delete existing drafts before creating a new one.`,
                  [
                    {
                      text: 'View Drafts',
                      onPress: () => router.replace('/(tabs)/profile')
                    },
                    { text: 'OK' }
                  ]
                );
            } else {
              await uploadNotificationService.showUploadError(response.message || 'Failed to create post', fileName);
              Alert.alert('Error', response.message || 'Failed to create post');
              }
            }
          } catch (e) {
            await uploadNotificationService.showUploadError('Failed to parse server response', fileName);
            Alert.alert('Error', 'Failed to parse server response.');
          }
        } else {
          // Try to parse server error for a real message (e.g. "Invalid category", "Maximum draft limit reached")
          let serverMessage = `Failed to create post. Server responded with status ${xhr.status}`;
          try {
            const parsed = JSON.parse(xhr.responseText);
            if (parsed?.message) serverMessage = parsed.message;
          } catch (_) {
            // ignore JSON parse errors
          }
          await uploadNotificationService.showUploadError(`Server responded with status ${xhr.status}`, fileName);
          Alert.alert('Error', serverMessage);
        }
      };
      
      xhr.onerror = async () => {
        setUploading(false);
        setUploadProgress(0);
        console.error('[Upload] XHR onerror triggered');
        console.error('[Upload] XHR status:', xhr.status);
        console.error('[Upload] XHR statusText:', xhr.statusText);
        console.error('[Upload] XHR readyState:', xhr.readyState);
        console.error('[Upload] Media URI:', mediaUri);
        console.error('[Upload] File name:', fileName);
        console.error('[Upload] File type:', fileType);
        await uploadNotificationService.showUploadError('Network or server error', fileName);
        Alert.alert('Error', 'Failed to create post. Network or server error. Please check your internet connection and try again.');
      };
      
      xhr.ontimeout = async () => {
        setUploading(false);
        setUploadProgress(0);
        console.error('[Upload] XHR timeout');
        await uploadNotificationService.showUploadError('Upload timeout', fileName);
        Alert.alert('Error', 'Upload timed out. Please try again.');
      };
      
      xhr.send(formData);
    } catch (error: any) {
      setUploading(false);
      setUploadProgress(0);
      await uploadNotificationService.showUploadError(error.message || 'Failed to create post', 'video.mp4');
      Alert.alert('Error', error.message || 'Failed to create post. Please try again.');
    }
  };

  const currentVideoUri = editedVideoUri || recordedVideoUri;
  const currentMediaUri = currentVideoUri || capturedImageUri;

  // Handle video playback
  const handlePlayPause = async () => {
    if (videoRef.current) {
      if (isVideoPlaying) {
        await videoRef.current.pauseAsync();
      } else {
        // Force speaker for playback (allowsRecordingIOS: false switches to bottom speaker on iOS)
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,  // This switches iOS to bottom speaker
          playsInSilentModeIOS: true,
          shouldDuckAndroid: false,
          playThroughEarpieceAndroid: false, // Force speaker on Android
        });
        
        // Ensure video is unmuted and at full volume before playing
        await videoRef.current.setIsMutedAsync(false);
        await videoRef.current.setVolumeAsync(1.0);
        await videoRef.current.playAsync();
      }
      setIsVideoPlaying(!isVideoPlaying);
    }
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <View style={[styles.container, { backgroundColor: C.background }]}>
      <StatusBar style="light" backgroundColor="#000000" />
      
      {/* Hidden watermark host for FFmpeg (logo + user id) */}
      {user && user.id && (
        <View style={styles.hiddenCompositeView} collapsable={false}>
          <WatermarkOverlay appName="Talentix" userId={user.id} ref={watermarkViewRef} />
        </View>
      )}

      {/* Hidden composite view for watermarking images */}
      {tempImageUri && (
        <View style={styles.hiddenCompositeView} collapsable={false}>
          <ViewShot ref={imageCompositeRef} style={styles.compositeViewShot}>
            <Image 
              source={{ uri: tempImageUri || '' }} 
              style={styles.compositeImage}
              resizeMode="cover"
            />
            {user && user.id && (
              <WatermarkOverlay appName="Talentix" userId={user.id} ref={watermarkViewRef} />
            )}
          </ViewShot>
        </View>
      )}

      {/* Camera Modal */}
      {showCamera && (
        <ViewShot
          ref={cameraViewShotRef}
          options={{ format: 'jpg', quality: 0.9 }}
          style={[styles.cameraContainer, { paddingTop: insets.top }]}
        >
          <CameraView
            ref={cameraRef}
            style={styles.camera}
            facing={cameraFacing}
            mode={cameraMode}
          />
          {/* Overlay with absolute positioning */}
            <View style={styles.cameraOverlay}>
              {/* Watermark - Bottom Right */}
              {user && user.id && (
                <View style={styles.watermarkContainer}>
                  <Image source={watermarkLogo} style={styles.watermarkLogo} resizeMode="contain" />
                  <Text style={styles.watermarkUserId}>{user.id}</Text>
                </View>
              )}

              {/* Top bar - only cancel and timer */}
              <View style={[styles.cameraTopBar, { paddingTop: insets.top + 16 }]}>
                <TouchableOpacity
                  style={styles.cameraCancelButton}
                  onPress={cancelCamera}
                  accessibilityLabel="Cancel"
                  accessibilityRole="button"
                >
                  <MaterialIcons name="close" size={24} color="#fff" />
                </TouchableOpacity>
                
                {isRecording && (
                  <View style={styles.recordingIndicator}>
                    <View style={styles.recordingDot} />
                    <Text style={styles.recordingTimer}>
                      {formatDuration(recordingDuration)}
                    </Text>
                  </View>
                )}

                <View style={{ width: 36 }} />
              </View>

              {/* Bottom controls - phone-like layout */}
              <View style={[styles.cameraBottomBar, { paddingBottom: insets.bottom + 20 }]}>
                <View style={styles.cameraBottomControls}>
                  {/* Left side - Mode toggle */}
                    <TouchableOpacity
                    style={styles.cameraModeButton}
                    onPress={() => setCameraMode(cameraMode === 'video' ? 'picture' : 'video')}
                    disabled={isRecording}
                    accessibilityLabel={`Switch to ${cameraMode === 'video' ? 'picture' : 'video'} mode`}
                    accessibilityRole="button"
                  >
                    <MaterialIcons 
                      name={cameraMode === 'video' ? 'photo-camera' : 'videocam'} 
                      size={28} 
                      color={isRecording ? 'rgba(255,255,255,0.3)' : '#fff'} 
                    />
                  </TouchableOpacity>

                  {/* Center - Record/Stop/Capture Button */}
                  {cameraMode === 'video' ? (
                    !isRecording ? (
                      <TouchableOpacity
                        style={styles.recordButtonCompact}
                      onPress={startRecording}
                        accessibilityLabel="Start recording"
                        accessibilityRole="button"
                    >
                        <View style={styles.recordButtonInnerCompact} />
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                        style={styles.stopButtonCompact}
                      onPress={stopRecording}
                        accessibilityLabel="Stop recording"
                        accessibilityRole="button"
                      >
                        <View style={styles.stopButtonInnerCompact} />
                      </TouchableOpacity>
                    )
                  ) : (
                    <TouchableOpacity
                      style={styles.captureButtonCompact}
                      onPress={takePicture}
                      accessibilityLabel="Take picture"
                      accessibilityRole="button"
                    >
                      <View style={styles.captureButtonInnerCompact} />
                    </TouchableOpacity>
                  )}

                  {/* Right side - Flip camera */}
                  <TouchableOpacity
                    style={styles.cameraFlipButton}
                    onPress={handleFlipCamera}
                    disabled={isRecording}
                    accessibilityLabel="Flip camera"
                    accessibilityRole="button"
                  >
                    <MaterialIcons 
                      name="flip-camera-ios" 
                      size={28} 
                      color={isRecording ? 'rgba(255,255,255,0.3)' : '#fff'} 
                    />
                  </TouchableOpacity>
                </View>
              </View>
            </View>
        </ViewShot>
      )}


      {/* STAGE 1: FULL STUDIO (CAMERA) – NO FORMS */}
      {!currentVideoUri && !capturedImageUri && (
        <View style={[styles.studioContainer, { paddingTop: insets.top + 16 }]}>
          <View style={styles.studioHeader}>
            <Text style={[styles.studioTitle, { color: C.text }]}>Create Post Studio</Text>
            <Text style={[styles.studioSubtitle, { color: C.textSecondary }]}>
              We use an in-app camera studio. Record a video up to 2 min 30 sec. You&apos;ll add caption and categories after you confirm.
            </Text>
          </View>

          <View style={styles.studioBody}>
            <MaterialIcons name="videocam" size={72} color={C.primary} />
            <Text style={[styles.studioHint, { color: C.textSecondary }]}>
              The camera studio should open automatically. If it does not, tap the button below.
            </Text>

            <TouchableOpacity
              style={[
                styles.recordButton,
                { backgroundColor: C.primary, marginTop: 24 },
                (recording || editing) && styles.createButtonDisabled,
              ]}
              onPress={handleRecordVideo}
              disabled={recording || editing}
            >
              {recording ? (
                <ActivityIndicator color={C.buttonText} />
              ) : (
                <>
                  <MaterialIcons name="videocam" size={24} color={C.buttonText} />
                  <Text style={[styles.recordButtonText, { color: C.buttonText }]}>
                    Open Camera Studio
                  </Text>
                </>
              )}
            </TouchableOpacity>

            <Text style={[styles.studioWarning, { color: C.warning }]}>
              Make sure your content is 100% authentic. No AI, deepfakes, or manipulated media.
            </Text>
          </View>
        </View>
      )}

      {/* STAGE 2: DETAILS FORM (AFTER MEDIA CONFIRMED) */}
      {currentMediaUri && (
        <KeyboardAvoidingView 
          style={{ flex: 1 }} 
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
        >
        <ScrollView
          style={[styles.scrollView, { backgroundColor: C.background }]}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Media Preview Section */}
            <View style={[styles.videoPreviewSection, { paddingTop: insets.top + 8 }]}>
              <View style={styles.videoPreviewContainer}>
                {currentVideoUri ? (
                  <>
                    <Video
                      ref={videoRef}
                      source={{ uri: currentVideoUri || '' }}
                      style={styles.videoPlayer}
                      resizeMode={ResizeMode.COVER}
                      isLooping
                      shouldPlay={false}
                      isMuted={false} // CRITICAL: Ensure video playback is not muted
                      volume={1.0} // Full volume playback
                      onPlaybackStatusUpdate={(status) => {
                        if (status.isLoaded) {
                          setIsVideoPlaying(status.isPlaying);
                        }
                      }}
                    />
                    
                    {/* Play/Pause Overlay */}
            <TouchableOpacity
                      style={styles.videoPlayOverlay}
                      onPress={handlePlayPause}
                      activeOpacity={0.8}
                      accessibilityLabel={isVideoPlaying ? 'Pause video' : 'Play video'}
                      accessibilityRole="button"
                    >
                      {!isVideoPlaying && (
                        <View style={styles.playButtonCircle}>
                          <MaterialIcons name="play-arrow" size={48} color="#fff" />
              </View>
                      )}
            </TouchableOpacity>
                  </>
                ) : (
                  <Image
                    source={{ uri: capturedImageUri || '' }}
                    style={styles.videoPlayer}
                    resizeMode="cover"
                  />
                )}

                {/* Media Controls */}
                <View style={styles.videoControlsBar}>
                  <TouchableOpacity
                    style={styles.videoControlButton}
                    onPress={() => {
                      if (currentVideoUri) {
                        handleRecordVideo();
                      } else {
                        setShowCamera(true);
                        setCameraMode('picture');
                      }
                    }}
                    disabled={uploading}
                    accessibilityLabel={currentVideoUri ? "Re-record video" : "Retake photo"}
                    accessibilityRole="button"
                  >
                    <MaterialIcons name={currentVideoUri ? "videocam" : "photo-camera"} size={20} color="#fff" />
                    <Text style={styles.videoControlText}>{currentVideoUri ? "Re-record" : "Retake"}</Text>
                  </TouchableOpacity>
                  
                    <TouchableOpacity
                    style={[styles.videoControlButton, styles.discardButton]}
                      onPress={() => {
                        setRecordedVideoUri(null);
                      setCapturedImageUri(null);
                        setEditedVideoUri(null);
                        setThumbnailUri(null);
                        setCaption('');
                        setSelectedGroup('');
                        setSelectedCategoryId('');
                      setIsVideoPlaying(false);
                      }}
                    disabled={uploading}
                    accessibilityLabel="Discard media"
                    accessibilityRole="button"
                    >
                    <MaterialIcons name="delete-outline" size={20} color="#ef4444" />
                    <Text style={[styles.videoControlText, { color: '#ef4444' }]}>Discard</Text>
                    </TouchableOpacity>
                  </View>
                  </View>
              {errors.media && <Text style={[styles.errorText, { color: C.error, textAlign: 'center', marginTop: 8 }]}>{errors.media}</Text>}
            </View>


            {/* Form Content */}
            <View style={styles.formContainer}>
              {/* Caption Input */}
            <View style={styles.inputGroup}>
                <View style={styles.labelRow}>
                  <Text style={[styles.label, { color: C.text }]}>Caption ✨</Text>
                  <Text style={[styles.labelHint, { color: C.textSecondary }]}>
                    Add emojis and hashtags!
                  </Text>
                </View>
                <View style={[
                  styles.captionInputContainer,
                  { 
                    backgroundColor: C.inputBg,
                    borderColor: errors.caption ? C.error : C.inputBorder 
                  }
                ]}>
                  <TextInput
                    style={[styles.captionInput, { color: C.inputText }]}
                    placeholder="Share your story... 🎬 What makes this special? Add #hashtags"
                    placeholderTextColor={C.placeholder}
                value={caption}
                onChangeText={setCaption}
                multiline
                    scrollEnabled
                textAlignVertical="top"
                    autoCapitalize="sentences"
                    autoCorrect
                    returnKeyType="default"
                    blurOnSubmit={false}
                  />
                  {caption.length > 0 && (
                    <View style={styles.captionFooter}>
                      <Text style={[styles.charCount, { color: C.textSecondary }]}>
                        {caption.length} characters
                      </Text>
                    </View>
                  )}
                </View>
              {errors.caption && (
                <Text style={[styles.errorText, { color: C.error }]}>{errors.caption}</Text>
              )}
            </View>

              {/* Category Selection */}
            <View style={styles.inputGroup}>
                <View style={styles.labelRow}>
                  <Text style={[styles.label, { color: C.text }]}>Category 🏷️</Text>
                  {selectedGroup && selectedCategoryId && (
                    <View style={[styles.selectedBadge, { backgroundColor: C.primary + '20' }]}>
                      <Text style={[styles.selectedBadgeText, { color: C.primary }]}>
                        {getSelectedCategoryName()}
                      </Text>
                    </View>
                  )}
                </View>
                
                {/* Category Groups */}
                <Text style={[styles.subLabel, { color: C.textSecondary }]}>Select a group</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.pillRow}
              >
                {loadingCategories ? (
                    [1, 2, 3, 4, 5].map((i) => (
                    <View
                      key={`cat-skel-${i}`}
                        style={[styles.pillSkeleton, { backgroundColor: C.inputBg, borderColor: C.inputBorder }]}
                    />
                  ))
                ) : mainCategories.length > 0 ? (
                  mainCategories.map((c) => c.name).map(
                    (group) => (
                      <TouchableOpacity
                        key={group}
                        style={[
                            styles.categoryPill,
                            { borderColor: C.border },
                          selectedGroup === group && {
                            backgroundColor: C.primary,
                            borderColor: C.primary,
                          },
                        ]}
                        onPress={() => {
                          setSelectedGroup(group);
                          setSelectedCategoryId('');
                        }}
                          accessibilityLabel={`Select ${group} category`}
                          accessibilityRole="button"
                          accessibilityState={{ selected: selectedGroup === group }}
                      >
                        <Text
                          style={[
                              styles.categoryPillText,
                              { color: selectedGroup === group ? '#fff' : C.text },
                          ]}
                        >
                          {group}
                        </Text>
                      </TouchableOpacity>
                    )
                  )
                ) : (
                  <View style={{ paddingVertical: 8 }}>
                    <Text style={{ color: C.textSecondary, fontSize: 13 }}>
                      No categories available. Please try again later.
                    </Text>
                  </View>
                )}
              </ScrollView>
              {errors.group && (
                <Text style={[styles.errorText, { color: C.error }]}>{errors.group}</Text>
              )}

                {/* Subcategories */}
            {selectedGroup && (
                  <View style={styles.subcategorySection}>
                    <Text style={[styles.subLabel, { color: C.textSecondary }]}>
                      Select a specific category
                    </Text>
                    <View style={styles.subcategoryGrid}>
                  {loadingSubcategories ? (
                        [1, 2, 3, 4, 5, 6].map((i) => (
                      <View
                        key={`subcat-skel-${i}`}
                            style={[styles.subcategoryPillSkeleton, { backgroundColor: C.inputBg }]}
                      />
                    ))
                  ) : (
                    (subcategories.length ? subcategories : getCategoriesForGroup()).map(
                      (cat: { id: number; name: string }) => (
                        <TouchableOpacity
                          key={cat.id}
                          style={[
                                styles.subcategoryPill,
                                { backgroundColor: C.card, borderColor: C.border },
                            selectedCategoryId === String(cat.id) && {
                                  backgroundColor: C.primary + '20',
                              borderColor: C.primary,
                            },
                          ]}
                          onPress={() => setSelectedCategoryId(String(cat.id))}
                              accessibilityLabel={`Select ${cat.name}`}
                              accessibilityRole="button"
                              accessibilityState={{ selected: selectedCategoryId === String(cat.id) }}
                        >
                              {selectedCategoryId === String(cat.id) && (
                                <MaterialIcons name="check-circle" size={16} color={C.primary} style={{ marginRight: 4 }} />
                              )}
                          <Text
                            style={[
                                  styles.subcategoryPillText,
                                  { color: selectedCategoryId === String(cat.id) ? C.primary : C.text },
                            ]}
                          >
                            {cat.name}
                          </Text>
                        </TouchableOpacity>
                      )
                    )
                  )}
                    </View>
                {errors.category && (
                  <Text style={[styles.errorText, { color: C.error }]}>{errors.category}</Text>
                )}
              </View>
            )}

            {/* Challenge Selection - Show after media is captured */}
            {(recordedVideoUri || capturedImageUri) && (
              <View style={styles.inputGroup}>
                {loadingChallenges ? (
                  <View style={{ paddingVertical: 12 }}>
                    <ActivityIndicator size="small" color={C.primary} />
                    <Text style={[styles.subLabel, { color: C.textSecondary, marginTop: 8 }]}>
                      Loading challenges...
                    </Text>
                  </View>
                ) : joinedChallenges.length > 0 ? (
                  <>
                    <View style={styles.labelRow}>
                      <Text style={[styles.label, { color: C.text }]}>Post to Challenge 🏆</Text>
                      <Text style={[styles.labelHint, { color: C.textSecondary }]}>
                        Optional
                      </Text>
                    </View>
                    <Text style={[styles.subLabel, { color: C.textSecondary, marginBottom: 12 }]}>
                      Select a challenge to submit this post to
                    </Text>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.pillRow}
                    >
                      <TouchableOpacity
                        style={[
                          styles.challengePill,
                          { borderColor: C.border },
                          !selectedChallengeId && {
                            backgroundColor: C.primary,
                            borderColor: C.primary,
                          },
                        ]}
                        onPress={() => setSelectedChallengeId(null)}
                      >
                        <Text
                          style={[
                            styles.challengePillText,
                            { color: !selectedChallengeId ? '#fff' : C.text },
                          ]}
                        >
                          No Challenge
                        </Text>
                      </TouchableOpacity>
                      {joinedChallenges.map((challenge: any) => (
                        <TouchableOpacity
                          key={challenge.id}
                          style={[
                            styles.challengePill,
                            { borderColor: C.border },
                            selectedChallengeId === challenge.id && {
                              backgroundColor: C.primary,
                              borderColor: C.primary,
                            },
                          ]}
                          onPress={() => setSelectedChallengeId(challenge.id)}
                        >
                          <Text
                            style={[
                              styles.challengePillText,
                              { color: selectedChallengeId === challenge.id ? '#fff' : C.text },
                            ]}
                            numberOfLines={1}
                          >
                            {challenge.name}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </>
                ) : (
                  <View style={{ paddingVertical: 8 }}>
                    <Text style={[styles.subLabel, { color: C.textSecondary }]}>
                      No challenges joined yet. Join a challenge to post in it.
                    </Text>
                  </View>
                )}
              </View>
            )}
              </View>

              {/* Content Warning */}
              <TouchableOpacity
                style={[styles.warningBanner, { backgroundColor: C.warningBg, borderColor: C.warningBorder }]}
                onPress={() => setAccordionOpen(!accordionOpen)}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Content authenticity guidelines"
              >
                <View style={styles.warningBannerHeader}>
                  <MaterialIcons name="verified" size={20} color={C.warning} />
                  <Text style={[styles.warningBannerTitle, { color: C.warning }]}>
                    Authenticity Required
                  </Text>
                  <MaterialIcons 
                    name={accordionOpen ? 'expand-less' : 'expand-more'} 
                    size={20} 
                    color={C.warning} 
                  />
                </View>
                {accordionOpen && (
                  <Text style={[styles.warningBannerText, { color: C.text }]}>
                    ✓ 100% authentic content only{'\n'}
                    ✗ No AI, deepfakes, or manipulated media{'\n'}
                    ✗ No voice changers or filters that alter quality
                  </Text>
                )}
              </TouchableOpacity>

              {/* Upload Progress */}
              {uploading && (
                <View style={[styles.uploadProgressCard, { backgroundColor: C.card, borderColor: C.primary }]}>
                  <View style={styles.uploadProgressHeader}>
                    <ActivityIndicator size="small" color={C.primary} />
                    <Text style={[styles.uploadProgressTitle, { color: C.text }]}>
                      Uploading your talent...
                    </Text>
                  </View>
                <View style={styles.uploadProgressBarContainer}>
                  <View
                    style={[
                      styles.uploadProgressBar,
                        { width: `${Math.min(Math.max(uploadProgress, 0), 100)}%`, backgroundColor: C.primary },
                    ]}
                  />
                </View>
                  <Text style={[styles.uploadProgressPercent, { color: C.primary }]}>
                    {Math.min(Math.round(uploadProgress), 100)}%
                </Text>
              </View>
            )}

              {/* Action Buttons - Horizontal */}
              <View style={styles.quickActionButtonsContainer}>
            <TouchableOpacity
                  style={[styles.quickActionButton, styles.quickPublishButton, uploading && styles.quickActionButtonDisabled]}
                  onPress={() => {
                    // Show specific error messages for missing fields
                    if (!caption.trim() && !selectedGroup) {
                      showToast('Please add a caption and select a category');
                    } else if (!caption.trim()) {
                      showToast('Caption is required to publish');
                    } else if (!selectedGroup) {
                      showToast('Please select a category group');
                    } else if (!selectedCategoryId) {
                      showToast('Please select a specific category');
                    } else {
                      handleCreatePost('active');
                    }
                  }}
                  disabled={uploading || !currentMediaUri}
                  accessibilityLabel="Publish post"
                  accessibilityRole="button"
            >
              {uploading ? (
                    <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                      <MaterialIcons name="rocket-launch" size={20} color="#fff" />
                      <Text style={styles.quickActionButtonText}>Publish</Text>
                </>
              )}
            </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.quickActionButton, styles.quickDraftButton, uploading && styles.quickActionButtonDisabled]}
                  onPress={async () => {
                    // Show specific error messages for missing fields
                    if (!caption.trim() && !selectedGroup) {
                      showToast('Please add a caption and select a category');
                    } else if (!caption.trim()) {
                      showToast('Caption is required to save draft');
                    } else if (!selectedGroup) {
                      showToast('Please select a category group');
                    } else if (!selectedCategoryId) {
                      showToast('Please select a specific category');
                    } else {
                      await handleCreatePost('draft');
                    }
                  }}
                  disabled={uploading || !currentMediaUri}
                  accessibilityLabel="Save as draft"
                  accessibilityRole="button"
                >
                  <MaterialIcons name="save" size={20} color="#fff" />
                  <Text style={styles.quickActionButtonText}>Save Draft</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.quickActionButton, styles.quickDiscardButton]}
                  onPress={() => {
                    Alert.alert(
                      'Discard Post?',
                      'Are you sure you want to discard this post? This action cannot be undone.',
                      [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Discard',
                          style: 'destructive',
                          onPress: () => {
                            setRecordedVideoUri(null);
                            setCapturedImageUri(null);
                            setEditedVideoUri(null);
                            setThumbnailUri(null);
                            setCaption('');
                            setSelectedGroup('');
                            setSelectedCategoryId('');
                            setIsVideoPlaying(false);
                          }
                        }
                      ]
                    );
                  }}
                  disabled={uploading}
                  accessibilityLabel="Discard post"
                  accessibilityRole="button"
                >
                  <MaterialIcons name="delete-outline" size={20} color="#fff" />
                  <Text style={styles.quickActionButtonText}>Discard</Text>
            </TouchableOpacity>
              </View>

              {/* Bottom spacing */}
              <View style={{ height: insets.bottom + 20 }} />
          </View>
        </ScrollView>
        </KeyboardAvoidingView>
      )}

      {/* Toast Message */}
      {toastMessage && (
        <Animated.View
          style={[
            styles.toastContainer,
            {
              opacity: toastOpacity,
              transform: [
                {
                  translateY: toastOpacity.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-50, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <View style={[styles.toastContent, { backgroundColor: C.errorBg, borderColor: C.errorBorder }]}>
            <MaterialIcons name="error-outline" size={20} color={C.error} />
            <Text style={[styles.toastText, { color: C.error }]}>{toastMessage}</Text>
          </View>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  studioContainer: {
    flex: 1,
    paddingHorizontal: 20,
  },
  studioHeader: {
    marginBottom: 24,
  },
  studioTitle: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 8,
  },
  studioSubtitle: {
    fontSize: 14,
    lineHeight: 20,
  },
  studioBody: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  studioHint: {
    fontSize: 14,
    textAlign: 'center',
    marginTop: 16,
  },
  studioWarning: {
    fontSize: 12,
    marginTop: 24,
    textAlign: 'center',
  },
  accordionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  accordionContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  warningBox: {
    margin: 20,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  warningHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  warningTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  warningText: {
    fontSize: 14,
    marginBottom: 8,
    lineHeight: 20,
  },
  warningList: {
    fontSize: 13,
    lineHeight: 18,
  },
  formContainer: {
    paddingHorizontal: 20,
  },
  inputGroup: {
    marginBottom: 24,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  input: {
    height: 50,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    borderWidth: 1,
  },
  textarea: {
    height: 120,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingTop: 16,
    fontSize: 16,
    borderWidth: 1,
    textAlignVertical: 'top',
  },
  errorText: {
    fontSize: 12,
    marginTop: 4,
  },
  pillRow: {
    paddingHorizontal: 4,
  },
  pill: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    marginRight: 8,
    marginBottom: 8,
  },
  pillSkeleton: {
    height: 38,
    width: 110,
    borderRadius: 20,
    borderWidth: 1,
    marginRight: 8,
    marginBottom: 8,
  },
  pillText: {
    fontSize: 14,
    fontWeight: '500',
  },
  mediaCard: {
    borderWidth: 2,
    borderStyle: 'dashed',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
  },
  mediaUploadArea: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  mediaUploadText: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
    marginBottom: 8,
  },
  mediaUploadSubtext: {
    fontSize: 14,
    marginBottom: 24,
    textAlign: 'center',
  },
  recordButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 12,
    gap: 12,
    minWidth: 200,
    justifyContent: 'center',
  },
  recordButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  mediaPreview: {
    width: '100%',
    alignItems: 'center',
  },
  previewContainer: {
    position: 'relative',
    marginBottom: 12,
    width: '100%',
    alignItems: 'center',
  },
  videoThumbnail: {
    width: '100%',
    height: 200,
    borderRadius: 12,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  removeButton: {
    position: 'absolute',
    top: -8,
    right: -8,
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  mediaFileName: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 16,
  },
  videoActionButtons: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  editButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    gap: 8,
  },
  editButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  rerecordButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
  },
  rerecordButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  createButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 12,
    marginTop: 8,
    gap: 8,
  },
  createButtonDisabled: {
    opacity: 0.6,
  },
  createButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  uploadProgressContainer: {
    marginBottom: 16,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  uploadProgressBarContainer: {
    height: 6,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 8,
  },
  uploadProgressBar: {
    height: '100%',
    borderRadius: 3,
  },
  uploadProgressText: {
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
  },
  cameraContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1000,
    backgroundColor: 'transparent', // Fix dark overlay
  },
  camera: {
    width: '100%',
    height: '100%',
    backgroundColor: 'transparent', // Fix dark overlay
  },
  cameraOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
    pointerEvents: 'box-none',
    backgroundColor: 'transparent', // Ensure no dark background
  },
  cameraTopBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  cameraCancelButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  recordingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ef4444',
    marginRight: 6,
  },
  recordingTimer: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  cameraBottomBar: {
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraBottomControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    paddingHorizontal: 20,
  },
  cameraControls: {
    alignItems: 'center',
  },
  // Compact record button - phone-like
  recordButtonCompact: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#fff',
  },
  recordButtonInnerCompact: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#ef4444',
  },
  stopButtonCompact: {
    width: 70,
    height: 70,
    borderRadius: 10,
    backgroundColor: '#ef4444',
    justifyContent: 'center',
    alignItems: 'center',
  },
  stopButtonInnerCompact: {
    width: 28,
    height: 28,
    borderRadius: 4,
    backgroundColor: '#fff',
  },
  // Camera improvements
  cameraFlipButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cameraModeButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Compact capture button for photos
  captureButtonCompact: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#fff',
  },
  captureButtonInnerCompact: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#fff',
  },
  // Video Preview
  videoPreviewSection: {
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  videoPreviewContainer: {
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  videoPlayer: {
    width: '100%',
    height: SCREEN_WIDTH * 0.75,
    backgroundColor: 'transparent',
  },
  videoPlayOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playButtonCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoControlsBar: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(0,0,0,0.8)',
  },
  videoControlButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  discardButton: {
    backgroundColor: 'rgba(239,68,68,0.15)',
  },
  videoControlText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  // Caption Input
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  labelHint: {
    fontSize: 12,
  },
  captionInputContainer: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  captionInput: {
    minHeight: 120,
    maxHeight: 200,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 16,
    fontSize: 16,
    lineHeight: 24,
  },
  captionFooter: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    alignItems: 'flex-end',
  },
  charCount: {
    fontSize: 12,
  },
  // Category Selection
  subLabel: {
    fontSize: 13,
    marginBottom: 10,
    marginTop: 4,
  },
  selectedBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  selectedBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  categoryPill: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 24,
    borderWidth: 1.5,
    marginRight: 10,
  },
  categoryPillText: {
    fontSize: 14,
    fontWeight: '600',
  },
  subcategorySection: {
    marginTop: 16,
  },
  subcategoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  subcategoryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  subcategoryPillSkeleton: {
    width: 100,
    height: 40,
    borderRadius: 12,
  },
  subcategoryPillText: {
    fontSize: 14,
    fontWeight: '500',
  },
  challengePill: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    marginRight: 8,
  },
  challengePillText: {
    fontSize: 14,
    fontWeight: '500',
  },
  // Warning Banner
  warningBanner: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginBottom: 20,
  },
  warningBannerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  warningBannerTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
  },
  warningBannerText: {
    fontSize: 13,
    lineHeight: 20,
    marginTop: 10,
  },
  // Upload Progress
  uploadProgressCard: {
    borderRadius: 16,
    borderWidth: 2,
    padding: 16,
    marginBottom: 20,
  },
  uploadProgressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  uploadProgressTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  uploadProgressPercent: {
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 8,
  },
  // Publish Button
  publishButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
    borderRadius: 16,
    gap: 10,
  },
  publishButtonDisabled: {
    opacity: 0.5,
  },
  publishButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  // Post Action Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
  },
  postActionModal: {
    backgroundColor: '#1a1a1a',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
  },
  postActionModalTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 8,
    textAlign: 'center',
  },
  postActionModalSubtitle: {
    fontSize: 14,
    color: '#999',
    marginBottom: 24,
    textAlign: 'center',
  },
  postActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
    paddingHorizontal: 24,
    borderRadius: 16,
    marginBottom: 12,
    gap: 12,
  },
  postActionPublishButton: {
    backgroundColor: '#60a5fa',
  },
  postActionDraftButton: {
    backgroundColor: '#8b5cf6',
  },
  postActionDiscardButton: {
    backgroundColor: '#ef4444',
  },
  postActionButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    flex: 1,
  },
  postActionButtonSubtext: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
    marginTop: 4,
  },
  postActionCancelButton: {
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  postActionCancelText: {
    color: '#999',
    fontSize: 16,
    fontWeight: '500',
  },
  // Capture Button
  captureButtonLarge: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: '#fff',
  },
  captureButtonInner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#fff',
  },
  // Draft Save Button
  draftSaveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 16,
    borderWidth: 1,
    gap: 8,
  },
  draftSaveButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  // Quick Action Buttons (Horizontal)
  quickActionButtonsContainer: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    marginBottom: 20,
    marginTop: 8,
  },
  quickActionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    gap: 8,
  },
  quickPublishButton: {
    backgroundColor: '#60a5fa',
  },
  quickDraftButton: {
    backgroundColor: '#8b5cf6',
  },
  quickDiscardButton: {
    backgroundColor: '#ef4444',
  },
  quickActionButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  quickActionButtonDisabled: {
    opacity: 0.5,
  },
  // Watermark
  watermarkContainer: {
    position: 'absolute',
    // Match right‑middle positioning, slightly above center
    top: '40%',
    // Push very close to the right edge; a tiny bit may be off‑screen
    right: -2,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  watermarkText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  watermarkUserId: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 11,
    fontWeight: '500',
    marginTop: 2,
  },
  watermarkLogo: {
    width: 64,
    height: 64,
    marginBottom: 4,
  },
  hiddenCompositeView: {
    position: 'absolute',
    left: -9999,
    top: -9999,
    width: 1,
    height: 1,
    backgroundColor: 'transparent', // Fix dark overlay issue
    opacity: 0,
    overflow: 'hidden',
  },
  compositeViewShot: {
    width: SCREEN_WIDTH,
    height: (SCREEN_WIDTH * 16) / 9,
    backgroundColor: 'transparent', // Ensure no dark background
  },
  compositeImage: {
    width: '100%',
    height: '100%',
    backgroundColor: 'transparent', // Ensure no dark background
  },
  toastContainer: {
    position: 'absolute',
    top: 60,
    left: 20,
    right: 20,
    zIndex: 9999,
    alignItems: 'center',
  },
  toastContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  toastText: {
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
});
