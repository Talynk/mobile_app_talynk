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
  const [serverMediaUrl, setServerMediaUrl] = useState<string | null>(null);
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
  const [isCameraReady, setIsCameraReady] = useState(false);
  const cameraRef = useRef<CameraView>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
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
  useEffect(() => {
    const configureAudio = async () => {
      try {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
          shouldDuckAndroid: false,
          playThroughEarpieceAndroid: false,
        });
        console.log('Audio mode configured for recording');
      } catch (error) {
        console.error('Error configuring audio mode:', error);
      }
    };
    configureAudio();
  }, []);

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

  // Fetch joined challenges
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
          const challenges = response.data
            .map((item: any) => {
              if (item.challenge) {
                return item.challenge;
              }
              return item;
            })
            .filter((challenge: any) => challenge && challenge.id && challenge.name);
          
          console.log('[Create] Extracted challenges:', challenges.length, challenges);
          setJoinedChallenges(challenges);
          
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

  // --- Handle camera mode changes ---
  useEffect(() => {
    if (showCamera && cameraRef.current) {
      console.log('[Camera] Mode changed to:', cameraMode);
      setIsCameraReady(false); // Reset ready state when mode changes
      const timeoutId = setTimeout(() => {
        console.log('[Camera] Reconfigured for mode:', cameraMode);
      }, 100);
      
      return () => clearTimeout(timeoutId);
    }
  }, [cameraMode, showCamera]);

  // --- CAMERA RECORDING ---
  const handleRecordVideo = useCallback(async () => {
    try {
      if (!cameraPermission?.granted) {
        const cameraResult = await requestCameraPermission();
        if (!cameraResult.granted) {
          Alert.alert('Permission Required', 'Camera permission is required to record videos.');
          return;
        }
      }

      if (cameraMode === 'video' && !microphonePermission?.granted) {
        const micResult = await requestMicrophonePermission();
        if (!micResult.granted) {
          Alert.alert('Permission Required', 'Microphone permission is required to record audio with your video.');
          return;
        }
      }

      try {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: cameraMode === 'video',
          playsInSilentModeIOS: true,
          shouldDuckAndroid: false,
          playThroughEarpieceAndroid: false,
        });
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (audioError) {
        console.error('Error setting audio mode:', audioError);
      }

      setShowCamera(true);
      setRecordingDuration(0);
      setCameraMode('video');
      
    } catch (error: any) {
      console.error('Camera error:', error);
      Alert.alert('Error', error.message || 'Failed to open camera. Please try again.');
    }
  }, [cameraPermission, microphonePermission, requestCameraPermission, requestMicrophonePermission, cameraMode]);

  // --- AUTO OPEN CAMERA ON FIRST MOUNT WHEN AUTHENTICATED ---
  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) return;
    if (hasOpenedCameraOnMount) return;

    setHasOpenedCameraOnMount(true);

    const timeoutId = setTimeout(() => {
      handleRecordVideo();
    }, 400);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [authLoading, isAuthenticated, hasOpenedCameraOnMount, handleRecordVideo]);

  // --- CATEGORY HELPERS ---
  const getCategoriesForGroup = () => {
    if (!selectedGroup) return [];
    const parent = mainCategories.find(c => c.name === selectedGroup);
    return parent?.children || [];
  };
  
  const getSelectedCategoryName = () => {
    if (!selectedCategoryId) return '';
    const foundSub = subcategories.find(cat => String(cat.id) === selectedCategoryId);
    if (foundSub) return foundSub.name;

    const foundFromLoaded = mainCategories
      .flatMap(c => c.children || [])
      .find(cat => String(cat.id) === selectedCategoryId);
    if (foundFromLoaded) return foundFromLoaded.name;

    return '';
  };

  const getSelectedCategoryId = () => {
    return selectedCategoryId || '';
  };

  // --- Helper function to process captured image ---
  const processCapturedImage = async (imageUri: string) => {
    try {
      const verifiedInfo = await FileSystem.getInfoAsync(imageUri);
      if (!verifiedInfo.exists) {
        throw new Error('Image file not found after capture');
      }
      
      let destPath = imageUri;
      const timestamp = Date.now();
      const fileName = `photo_${timestamp}.jpg`;
      const cacheDir = FileSystem.cacheDirectory;
      
      try {
        destPath = `${cacheDir}${fileName}`;
        await FileSystem.copyAsync({
          from: imageUri,
          to: destPath,
        });
        
        const copiedInfo = await FileSystem.getInfoAsync(destPath);
        if (!copiedInfo.exists || ((copiedInfo as any).size < 1000)) {
          console.warn('[Camera] Cache copy failed, using original URI');
          destPath = imageUri;
        }
      } catch (copyError) {
        console.warn('[Camera] Could not copy to cache:', copyError);
        destPath = imageUri;
      }
      
      console.log('[Camera] Image ready:', destPath);
      
      setRecordedVideoUri(null);
      setEditedVideoUri(null);
      setShowCamera(false);
      setCapturedImageUri(destPath);
      showToast('Image captured successfully!');
      
    } catch (processError: any) {
      console.error('Image processing error:', processError);
      Alert.alert('Processing Error', 'Failed to process captured image. Please try again.');
    }
  };

  // --- IMAGE CAPTURE ---
  const takePicture = async () => {
    if (!cameraRef.current) {
      console.error('[Camera] Camera ref is not available');
      Alert.alert('Error', 'Camera is not ready. Please try again.');
      return;
    }

    try {
      // Verify camera is ready and mode is correct
      if (!isCameraReady) {
        console.warn('[Camera] Camera is still initializing, waiting...');
        // Wait up to 2 seconds for camera to be ready
        let waitCount = 0;
        while (!isCameraReady && waitCount < 20) {
          await new Promise(resolve => setTimeout(resolve, 100));
          waitCount++;
        }
        if (!isCameraReady) {
          console.error('[Camera] Camera failed to initialize');
          Alert.alert('Error', 'Camera is not ready. Please try again.');
          return;
        }
      }
      
      // Verify we're in picture mode before capturing
      if (cameraMode !== 'picture') {
        console.error('[Camera] Camera is not in picture mode:', cameraMode);
        Alert.alert('Error', 'Camera must be in picture mode to take photos.');
        return;
      }
      
      console.log('[Camera] Taking picture with mode:', cameraMode, 'facing:', cameraFacing);
      
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.9,
        base64: false,
        exif: true,
        skipProcessing: false,
        imageType: 'jpg',
        scale: 1,
        isImageMirror: cameraFacing === 'front',
      });
      
      // Check if photo is null/undefined
      if (!photo) {
        console.error('[Camera] takePictureAsync returned null/undefined');
        console.error('[Camera] Camera state:', {
          hasRef: !!cameraRef.current,
          mode: cameraMode,
          ready: isCameraReady,
          facing: cameraFacing
        });
        Alert.alert('Error', 'Failed to capture image. Camera returned no data. Please try again.');
        return;
      }
      
      console.log('[Camera] Photo captured successfully:', {
        uri: photo.uri,
        width: photo.width,
        height: photo.height,
        exif: photo.exif ? 'yes' : 'no'
      });
      
      if (photo && photo.uri) {
        const fileInfo = await FileSystem.getInfoAsync(photo.uri);
        console.log('[Camera] Image file info:', {
          exists: fileInfo.exists,
          size: fileInfo.exists ? (fileInfo as any).size : 0,
          uri: photo.uri
        });
        
        if (!fileInfo.exists || ((fileInfo as any).size < 1000)) {
          console.error('[Camera] Image file is too small or invalid:', (fileInfo as any).size);
          
          // Attempt fallback capture
          try {
            const fallbackPhoto = await cameraRef.current?.takePictureAsync({
              quality: 0.8,
              skipProcessing: true,
            });
            
            if (fallbackPhoto?.uri) {
              const fallbackInfo = await FileSystem.getInfoAsync(fallbackPhoto.uri);
              if (fallbackInfo.exists && ((fallbackInfo as any).size > 1000)) {
                console.log('[Camera] Fallback capture successful');
                await processCapturedImage(fallbackPhoto.uri);
                return;
              }
            }
          } catch (fallbackError) {
            console.error('[Camera] Fallback capture failed:', fallbackError);
          }
          
          Alert.alert('Error', 'Failed to capture valid image. Please try again.');
          return;
        }
        
        await processCapturedImage(photo.uri);
      } else {
        Alert.alert('Error', 'No image data returned from camera.');
      }
    } catch (error: any) {
      console.error('Image capture error:', error);
      console.error('[Camera] Error stack:', error.stack);
      Alert.alert('Capture Error', `Failed to take picture: ${error.message || 'Please try again'}`);
    }
  };

  const startRecording = async () => {
    if (!cameraRef.current) return;

    try {
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
      
      recordingTimerRef.current = setInterval(() => {
        setRecordingDuration((prev) => {
          const newDuration = prev + 1;
          if (newDuration >= 150) {
            stopRecording();
            return 150;
          }
          return newDuration;
        });
      }, 1000);

      try {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
          shouldDuckAndroid: false,
          playThroughEarpieceAndroid: false,
          staysActiveInBackground: false,
        });
        
        if (!microphonePermission?.granted) {
          console.error('Microphone permission not granted before recording');
          Alert.alert('Error', 'Microphone permission is required for audio recording.');
          setIsRecording(false);
          return;
        }
        
        await new Promise(resolve => setTimeout(resolve, 200));
        
        console.log('Audio mode set for recording, microphone permission verified');
      } catch (audioError) {
        console.error('Error setting audio mode:', audioError);
        Alert.alert('Audio Error', 'Failed to configure audio for recording. Please try again.');
        setIsRecording(false);
        return;
      }

      const recordingOptions: any = {
        maxDuration: 150,
        mute: false,
        quality: 'high',
      };
      
      if (Platform.OS === 'ios') {
        recordingOptions.codec = 'h264';
        recordingOptions.extension = '.mov';
        recordingOptions.videoBitrate = 5000000;
        recordingOptions.audioBitrate = 192000;
        recordingOptions.audioSampleRate = 48000;
        recordingOptions.audioChannels = 2;
      } else {
        recordingOptions.maxFileSize = 100 * 1024 * 1024;
        recordingOptions.extension = '.mp4';
        recordingOptions.videoBitrate = 5000000;
        recordingOptions.audioBitrate = 256000;
        recordingOptions.audioSampleRate = 48000;
        recordingOptions.audioChannels = 2;
      }
      
      console.log('Starting recording with options:', recordingOptions);
      console.log('Audio mode set, microphone permission:', microphonePermission?.granted);
      
      const recordingPromise = cameraRef.current.recordAsync(recordingOptions);
      
      recordingPromise.then((video) => {
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
          setCapturedImageUri(null);
          
          generateThumbnail(video.uri).then((thumb) => {
            setThumbnailUri(thumb);
          }).catch((thumbError) => {
            console.error('Thumbnail generation error:', thumbError);
          });
          
          setShowCamera(false);
          setRecordingDuration(0);
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

  // --- VIDEO EDITING ---
  const handleEditVideo = async () => {
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

    const hasPermission = await uploadNotificationService.requestPermissions();
    if (!hasPermission) {
      console.log('Notification permissions not granted');
    }
    
    setUploading(true);
    setUploadProgress(0);
    
    try {
      const categoryName = getSelectedCategoryName();
      if (!categoryName || categoryName.trim() === '') {
        setUploading(false);
        setUploadProgress(0);
        Alert.alert('Category Error', 'Selected category name is missing. Please re-select a category and try again.');
        return;
      }

      const mediaUri = imageUri || rawVideoUri;
      if (!mediaUri) {
        throw new Error('No media file to upload');
      }

      const fileInfo = await FileSystem.getInfoAsync(mediaUri);
      if (!fileInfo.exists) {
        throw new Error('Media file not found');
      }

      const isVideo = !!rawVideoUri;
      const fileName = mediaUri.split('/').pop() || (isVideo ? 'video.mp4' : 'image.jpg');
      const fileType = isVideo ? 'video/mp4' : 'image/jpeg';
      
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

      let fileData: any = {
        uri: mediaUri,
        name: fileName,
        type: fileType,
      };

      // Note: For React Native, FormData.append(name, file) expects:
      // - file as a Blob/File object with uri property (which RN handles)
      // - OR a string/number
      // We don't convert to base64 for FormData as it expects the native file object
      // FormData will read the file from the URI automatically

      if (selectedChallengeId) {
        const formData = new FormData();
        formData.append('title', caption.trim().substring(0, 50) || 'My Post');
        formData.append('caption', caption);
        formData.append('post_category', categoryName);
        formData.append('file', fileData as any);
        
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
              await uploadNotificationService.showUploadComplete(fileName);
              
              // Extract media URL from response for preview
              // Backend returns: response.data.post.video_url
              const postData = response.data?.post || response.data;
              let mediaUrl = postData?.video_url || postData?.fullUrl || postData?.image_url;
              
              // CRITICAL FIX: For images, we need to ensure proper URL handling
              // Verify the URL is complete and valid before setting
              if (mediaUrl) {
                // Add cache busting for fresh image loads
                const cacheBustUrl = mediaUrl.includes('?') 
                  ? `${mediaUrl}&t=${Date.now()}`
                  : `${mediaUrl}?t=${Date.now()}`;
                
                console.log('[Upload] Challenge post - URL Details:', {
                  originalUrl: mediaUrl,
                  cacheBustUrl: cacheBustUrl,
                  fileType: postData?.type || 'unknown',
                  isImage: postData?.type === 'image'
                });
                
                // Use original URL without cache bust to keep it clean
                // But log both for debugging
                setServerMediaUrl(mediaUrl);
                console.log('[Upload] Challenge post - Setting server media URL:', mediaUrl);
              } else {
                console.warn('[Upload] Challenge post - No media URL found in response:', {
                  responseData: response.data,
                  postData: postData,
                  allKeys: postData ? Object.keys(postData) : []
                });
              }
              
              setRecordedVideoUri(null);
              // Keep capturedImageUri for preview display
              setEditedVideoUri(null);
              setThumbnailUri(null);
              setCaption('');
              setSelectedGroup('');
              setSelectedCategoryId('');
              setSelectedChallengeId(null);
              setIsVideoPlaying(false);
              
              // Delay navigation to show the server image
              setTimeout(() => {
                setServerMediaUrl(null);
                setCapturedImageUri(null);
                router.back();
              }, 1500);
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
      
      const formData = new FormData();
      const autoTitle = caption.trim().substring(0, 50) || 'My Post';
      formData.append('title', autoTitle);
      formData.append('caption', caption);
      
      const categoryId = getSelectedCategoryId();
      
      formData.append('post_category', categoryName);
      formData.append('category_id', categoryId);
      formData.append('status', status);
      
      formData.append('file', fileData as any);
      
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
              
              // Extract media URL from response for preview
              // Backend returns: response.data.post.video_url
              const postData = response.data?.post || response.data;
              let mediaUrl = postData?.video_url || postData?.fullUrl || postData?.image_url;
              
              // CRITICAL FIX: For images, we need to ensure proper URL handling
              // Verify the URL is complete and valid before setting
              if (mediaUrl) {
                // Add cache busting for fresh image loads
                const cacheBustUrl = mediaUrl.includes('?') 
                  ? `${mediaUrl}&t=${Date.now()}`
                  : `${mediaUrl}?t=${Date.now()}`;
                
                console.log('[Upload] Regular post - URL Details:', {
                  originalUrl: mediaUrl,
                  cacheBustUrl: cacheBustUrl,
                  fileType: postData?.type || 'unknown',
                  isImage: postData?.type === 'image'
                });
                
                // Use original URL without cache bust to keep it clean
                // But log both for debugging
                setServerMediaUrl(mediaUrl);
                console.log('[Upload] Regular post - Setting server media URL:', mediaUrl);
              } else {
                console.warn('[Upload] Regular post - No media URL found in response:', {
                  responseData: response.data,
                  postData: postData,
                  allKeys: postData ? Object.keys(postData) : []
                });
              }
              
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
                      setServerMediaUrl(null);
                      setCapturedImageUri(null);
                      router.replace('/(tabs)/profile');
                    }
                  }
                ]
              );
              
              setCaption('');
              setSelectedGroup('');
              setSelectedCategoryId('');
              setRecordedVideoUri(null);
              // Keep capturedImageUri for preview display
              setEditedVideoUri(null);
              setThumbnailUri(null);
              setIsVideoPlaying(false);
            } else {
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
          let serverMessage = `Failed to create post. Server responded with status ${xhr.status}`;
          try {
            const parsed = JSON.parse(xhr.responseText);
            if (parsed?.message) serverMessage = parsed.message;
          } catch (_) {
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

  const handlePlayPause = async () => {
    if (videoRef.current) {
      if (isVideoPlaying) {
        await videoRef.current.pauseAsync();
      } else {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: true,
          shouldDuckAndroid: false,
          playThroughEarpieceAndroid: false,
        });
        
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

  // Show loading screen
  if (authLoading) {
    return (
      <View style={[styles.container, { backgroundColor: C.background, justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={C.primary} />
        <Text style={[{ fontSize: 16, marginTop: 12, fontWeight: '500' }, { color: C.text }]}>Loading...</Text>
      </View>
    );
  }

  // Show login prompt
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

  return (
    <View style={[styles.container, { backgroundColor: C.background }]}>
      <StatusBar style="light" backgroundColor="#000000" />
      
      {/* Camera Modal */}
      {showCamera && (
        <View
          style={[styles.cameraContainer, { paddingTop: insets.top }]}
        >
          <CameraView
            ref={cameraRef}
            style={styles.camera}
            facing={cameraFacing}
            mode={cameraMode}
            autofocus="on"
            zoom={0}
            enableTorch={false}
            flash={cameraMode === 'picture' ? 'on' : 'off'}
            videoQuality="1080p"
            onCameraReady={() => {
              console.log('[Camera] Camera is ready');
              setIsCameraReady(true);
            }}
          />
          <View style={styles.cameraOverlay}>
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

            <View style={[styles.cameraBottomBar, { paddingBottom: insets.bottom + 20 }]}>
              <View style={styles.cameraBottomControls}>
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
        </View>
      )}

      {/* STAGE 1: FULL STUDIO (CAMERA) – NO FORMS */}
      {!currentVideoUri && !capturedImageUri && (
        <View style={[styles.studioContainer, { paddingTop: insets.top + 16 }]}>
          <View style={styles.studioHeader}>
            <Text style={[styles.studioTitle, { color: C.text }]}>Studio</Text>
            <Text style={[styles.studioSubtitle, { color: C.textSecondary }]}>
              Record up to 2:30. Add details after recording.
            </Text>
          </View>

          <View style={styles.studioBody}>
            <MaterialIcons name="videocam" size={72} color={C.primary} />
            <Text style={[styles.studioHint, { color: C.textSecondary }]}>
              Camera opens automatically
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
                    Open Camera
                  </Text>
                </>
              )}
            </TouchableOpacity>

            <Text style={[styles.studioWarning, { color: C.warning }]}>
              Authentic content only
            </Text>
          </View>
        </View>
      )}

      {/* STAGE 2: DETAILS FORM (AFTER MEDIA CONFIRMED) */}
      {currentMediaUri && (
        <KeyboardAvoidingView 
          style={{ flex: 1 }} 
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 20 : 0}
        >
        <ScrollView
          style={[styles.scrollView, { backgroundColor: C.background }]}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          nestedScrollEnabled={true}
        >
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
                      isMuted={false}
                      volume={1.0}
                      onPlaybackStatusUpdate={(status) => {
                        if (status.isLoaded) {
                          setIsVideoPlaying(status.isPlaying);
                        }
                      }}
                    />
                    
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
                  <View style={styles.imagePreviewContainer}>
                    {serverMediaUrl && !capturedImageUri ? (
                      <Image
                        key={`server-image-${serverMediaUrl}`}
                        source={{ uri: serverMediaUrl }}
                        style={styles.videoPlayer}
                        resizeMode="cover"
                        progressiveRenderingEnabled={true}
                        onError={(error) => {
                          console.error('[ImagePreview] Server image failed to load:', {
                            uri: serverMediaUrl,
                            error: error,
                            timestamp: new Date().toISOString()
                          });
                        }}
                        onLoad={() => {
                          console.log('[ImagePreview] Server image loaded successfully:', {
                            uri: serverMediaUrl,
                            timestamp: new Date().toISOString()
                          });
                        }}
                      />
                    ) : (
                      <Image
                        key={`local-image-${capturedImageUri}`}
                        source={{ uri: capturedImageUri || '' }}
                        style={styles.videoPlayer}
                        resizeMode="cover"
                        onError={(error) => {
                          console.error('[ImagePreview] Local image failed to load:', {
                            uri: capturedImageUri,
                            error: error
                          });
                        }}
                        onLoad={() => {
                          console.log('[ImagePreview] Local image loaded successfully:', capturedImageUri);
                        }}
                      />
                    )}
                    {serverMediaUrl && (
                      <Text style={styles.uploadingIndicator}>✓ Uploaded</Text>
                    )}
                  </View>
                )}

                <View style={styles.videoControlsBar}>
                  <TouchableOpacity
                    style={styles.videoControlButton}
                    onPress={() => {
                      if (currentVideoUri) {
                        handleRecordVideo();
                      } else {
                        setServerMediaUrl(null);
                        setCameraMode('picture');
                        setShowCamera(true);
                        setTimeout(() => {
                          setCapturedImageUri(null);
                        }, 100);
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
                      setServerMediaUrl(null);
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

            <View style={styles.formContainer}>
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

              {selectedChallengeId ? (
                <View style={styles.quickActionButtonsContainer}>
                  <TouchableOpacity
                    style={[styles.quickActionButton, styles.quickPublishButton, uploading && styles.quickActionButtonDisabled]}
                    onPress={() => {
                      if (!caption.trim() && !selectedGroup) {
                        showToast('Please add a caption and select a category');
                      } else if (!caption.trim()) {
                        showToast('Caption is required');
                      } else if (!selectedGroup) {
                        showToast('Please select a category group');
                      } else if (!selectedCategoryId) {
                        showToast('Please select a specific category');
                      } else {
                        handleCreatePost('active');
                      }
                    }}
                    disabled={uploading || !currentMediaUri}
                    accessibilityLabel="Post to challenge"
                    accessibilityRole="button"
                  >
                    {uploading ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <>
                        <MaterialIcons name="emoji-events" size={20} color="#fff" />
                        <Text style={styles.quickActionButtonText}>Post to Challenge</Text>
                      </>
                    )}
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
                              setSelectedChallengeId(null);
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
              ) : (
                <View style={styles.quickActionButtonsContainer}>
                  <TouchableOpacity
                    style={[styles.quickActionButton, styles.quickPublishButton, uploading && styles.quickActionButtonDisabled]}
                    onPress={() => {
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
              )}

              <View style={{ height: insets.bottom + 20 }} />
          </View>
        </ScrollView>
        </KeyboardAvoidingView>
      )}

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
    flexGrow: 1,
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
    backgroundColor: 'transparent',
  },
  camera: {
    width: '100%',
    height: '100%',
    backgroundColor: 'transparent',
  },
  cameraOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
    pointerEvents: 'box-none',
    backgroundColor: 'transparent',
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
  imagePreviewContainer: {
    width: '100%',
    height: SCREEN_WIDTH * 0.75,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  uploadingIndicator: {
    position: 'absolute',
    bottom: 16,
    alignSelf: 'center',
    color: '#fff',
    fontSize: 12,
    fontWeight: '500',
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
    includeFontPadding: false,
    textAlignVertical: 'top',
  },
  captionFooter: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    alignItems: 'flex-end',
  },
  charCount: {
    fontSize: 12,
  },
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