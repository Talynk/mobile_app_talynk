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
import { Linking } from 'react-native';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { postsApi, challengesApi } from '@/lib/api';
import { apiClient } from '@/lib/api-client';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialIcons, Feather } from '@expo/vector-icons';
import { uploadNotificationService } from '@/lib/notification-service';
import { categoriesApi } from '@/lib/api';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/auth-context';
import { useCreateFocus } from '@/lib/create-focus-context';
import { API_BASE_URL } from '@/lib/config';
import * as FileSystem from 'expo-file-system/legacy';
import { generateThumbnail } from '@/lib/utils/thumbnail';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import {
  Camera as VisionCamera,
  useCameraDevice,
  useCameraPermission as useVisionCameraPermission,
  useMicrophonePermission as useVisionMicrophonePermission,
} from 'react-native-vision-camera';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Audio } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import Constants from 'expo-constants';
import { videoReadyTracker } from '@/lib/video-ready-tracker';
import {
  cleanupPreparedVideo,
  prepareVideoForUpload,
  PreparedVideoAsset,
  uploadPreparedVideo,
} from '@/lib/utils/video-upload';
import { useAppActive } from '@/lib/hooks/use-app-active';
import { useRefetchOnReconnect } from '@/lib/hooks/use-network-status';
import { fetchWithRetry } from '@/lib/utils/fetch-with-retry';
import {
  getCachedCreateCategories,
  getCachedJoinedChallenges,
  setCachedCreateCategories,
  setCachedJoinedChallenges,
  upsertCachedJoinedChallenge,
} from '@/lib/create-screen-cache';
import { isChallengeParticipationOpen } from '@/lib/utils/challenge';
import { getCategoryDisplayName } from '@/lib/utils/category-display';
import websocketService from '@/lib/websocket-service';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const ANDROID_13_API_LEVEL = 33;

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

const BEAUTY_CONTENT_WARNING =
  'Posting nudity or exposing private parts is not permitted on this platform.';

/**
 * Legacy multipart upload via XHR to POST /api/posts
 * Used for: image uploads (no HLS needed) and fallback when signed URL is unavailable
 */
async function _legacyMultipartUpload(
  mediaUri: string,
  fileName: string,
  fileType: string,
  autoTitle: string,
  categoryName: string,
  status: string,
  fileData: any,
  categoryId: string,
  uploadNotificationService: any,
  setUploading: (v: boolean) => void,
  setUploadProgress: (v: number) => void,
  setServerMediaUrl: (v: string | null) => void,
  setCaption: (v: string) => void,
  setSelectedGroup: (v: string) => void,
  setSelectedCategoryId: (v: string) => void,
  setRecordedVideoUri: (v: string | null) => void,
  setEditedVideoUri: (v: string | null) => void,
  setThumbnailUri: (v: string | null) => void,
  setIsVideoPlaying: (v: boolean) => void,
  setCapturedImageUri: (v: string | null) => void,
): Promise<void> {
  return new Promise<void>((resolveUpload) => {
    const formData = new FormData();
    formData.append('title', autoTitle);
    formData.append('caption', autoTitle); // caption field
    formData.append('post_category', categoryName);
    formData.append('category_id', categoryId);
    formData.append('status', status);
    formData.append('file', fileData as any);

    const xhr = new XMLHttpRequest();
    const apiUrl = `${API_BASE_URL}/api/posts`;
    xhr.open('POST', apiUrl);
    xhr.setRequestHeader('Accept', 'application/json');

    AsyncStorage.getItem('talynk_token').then((authToken) => {
      if (!authToken) {
        setUploading(false);
        setUploadProgress(0);
        Alert.alert('Authentication Error', 'Please login again to create posts.');
        resolveUpload();
        return;
      }

      xhr.setRequestHeader('Authorization', `Bearer ${authToken.trim()}`);

      let lastLoggedPercent = -10;
      xhr.upload.onprogress = async (event) => {
        if (event.lengthComputable) {
          const percent = Math.min(Math.round((event.loaded / event.total) * 100), 100);
          setUploadProgress(percent);
          await uploadNotificationService.showUploadProgress(percent, fileName);
          if (percent - lastLoggedPercent >= 10 || percent === 100) {
            console.log(`[Upload] Legacy progress: ${percent}%`);
            lastLoggedPercent = percent;
          }
        }
      };

      xhr.onload = async () => {
        setUploading(false);
        setUploadProgress(0);

        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const response = JSON.parse(xhr.responseText);
            if (response.status === 'success') {
              await uploadNotificationService.showUploadComplete(fileName);

              const postData = response.data?.post || response.data;
              const mediaUrl = postData?.video_url || postData?.fullUrl || postData?.image_url;
              if (mediaUrl) {
                setServerMediaUrl(mediaUrl);
              }

              const isVideoPost = postData?.type === 'video';
              const successMessage = status === 'draft'
                ? 'Draft saved successfully!'
                : isVideoPost
                  ? 'Post published! Video is being optimized for streaming.'
                  : 'Post published successfully!';

              Alert.alert('Success', successMessage, [
                {
                  text: 'View Profile',
                  onPress: () => {
                    setServerMediaUrl(null);
                    setCapturedImageUri(null);
                    router.replace('/(tabs)/profile');
                  },
                },
              ]);

              setCaption('');
              setSelectedGroup('');
              setSelectedCategoryId('');
              setRecordedVideoUri(null);
              setEditedVideoUri(null);
              setThumbnailUri(null);
              setIsVideoPlaying(false);
            } else {
              await uploadNotificationService.showUploadError(response.message || 'Failed to create post', fileName);
              Alert.alert('Error', response.message || 'Failed to create post');
            }
          } catch (e) {
            await uploadNotificationService.showUploadError('Failed to parse server response', fileName);
            Alert.alert('Error', 'Failed to parse server response.');
          }
        } else {
          let serverMessage = `Server responded with status ${xhr.status}`;
          try {
            const parsed = JSON.parse(xhr.responseText);
            if (parsed?.message) serverMessage = parsed.message;
          } catch (_) { }
          await uploadNotificationService.showUploadError(serverMessage, fileName);
          Alert.alert('Error', serverMessage);
        }
        resolveUpload();
      };

      xhr.onerror = async () => {
        setUploading(false);
        setUploadProgress(0);
        await uploadNotificationService.showUploadError('Network error', fileName);
        Alert.alert('Error', 'Network error. Please check your connection.');
        resolveUpload();
      };

      xhr.ontimeout = async () => {
        setUploading(false);
        setUploadProgress(0);
        await uploadNotificationService.showUploadError('Upload timeout', fileName);
        Alert.alert('Error', 'Upload timed out. Please try again.');
        resolveUpload();
      };

      xhr.send(formData);
    });
  });
}

export default function CreatePostScreen() {
  const params = useLocalSearchParams();
  const forcedChallengeId =
    typeof params.challengeId === 'string' && params.challengeId.trim().length > 0
      ? params.challengeId
      : null;
  const forcedChallengeName =
    typeof params.challengeName === 'string' && params.challengeName.trim().length > 0
      ? params.challengeName
      : null;
  const preferredDestination =
    typeof params.preferredDestination === 'string' && params.preferredDestination.trim().length > 0
      ? params.preferredDestination
      : null;
  const isChallengeOnlyFlow = params.fromChallenge === '1' && !!forcedChallengeId;
  const { isAuthenticated, loading: authLoading, user, token } = useAuth();
  const [title, setTitle] = useState('');
  const [caption, setCaption] = useState('');
  const [selectedGroup, setSelectedGroup] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const showBeautySafetyNotice = selectedGroup.trim().toLowerCase() === 'beauty';
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
  const [cameraSessionKey, setCameraSessionKey] = useState(0);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [microphonePermission, requestMicrophonePermission] = useMicrophonePermissions();
  const {
    hasPermission: hasVisionCameraPermission,
    requestPermission: requestVisionCameraPermission,
  } = useVisionCameraPermission();
  const {
    hasPermission: hasVisionMicrophonePermission,
    requestPermission: requestVisionMicrophonePermission,
  } = useVisionMicrophonePermission();
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [showPostActionModal, setShowPostActionModal] = useState(false);
  const [maxReachedContext, setMaxReachedContext] = useState<{ challengeName: string; max: number } | null>(null);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const cameraRef = useRef<CameraView>(null);
  const visionCameraRef = useRef<React.ElementRef<typeof VisionCamera> | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingSafetyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordingDurationRef = useRef(0);
  const stoppedDueToMaxDurationRef = useRef(false);
  const [showPreRecordInfoModal, setShowPreRecordInfoModal] = useState(false);
  const [showMaxDurationReachedModal, setShowMaxDurationReachedModal] = useState(false);
  const C = COLORS.dark;
  const [mainCategories, setMainCategories] = useState<{ id: number, name: string, children?: { id: number, name: string }[] }[]>([]);
  const [subcategories, setSubcategories] = useState<{ id: number, name: string }[]>([]);
  const insets = useSafeAreaInsets();
  const [loadingCategories, setLoadingCategories] = useState<boolean>(false);
  const [loadingSubcategories, setLoadingSubcategories] = useState<boolean>(false);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const isAppActive = useAppActive();
  // expo-video preview player for recorded/captured video
  const previewPlayer = useVideoPlayer(editedVideoUri || recordedVideoUri, (player) => {
    if (player) {
      player.loop = true;
      player.muted = false;
    }
  });
  const [cameraFacing, setCameraFacing] = useState<'front' | 'back'>('back');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const [joinedChallenges, setJoinedChallenges] = useState<any[]>([]);
  const [availableChallenges, setAvailableChallenges] = useState<any[]>([]);
  const [selectedChallengeId, setSelectedChallengeId] = useState<string | null>(null);
  const [loadingChallenges, setLoadingChallenges] = useState(false);
  const [loadingAvailableChallenges, setLoadingAvailableChallenges] = useState(false);
  const [joinCompetitionModalVisible, setJoinCompetitionModalVisible] = useState(false);
  const [joiningCompetitionId, setJoiningCompetitionId] = useState<string | null>(null);
  const [challengePostCounts, setChallengePostCounts] = useState<Record<string, { count: number; max: number }>>({});
  const [categoriesFetchFailed, setCategoriesFetchFailed] = useState(false);
  const [challengesFetchFailed, setChallengesFetchFailed] = useState(false);
  const [draftReplaceModalVisible, setDraftReplaceModalVisible] = useState(false);
  const [existingDrafts, setExistingDrafts] = useState<any[]>([]);
  const [pendingDraftStatus, setPendingDraftStatus] = useState<'active' | 'draft'>('draft');
  const effectiveSelectedChallengeId = isChallengeOnlyFlow ? forcedChallengeId : selectedChallengeId;
  const loadingChallengeCountsRef = useRef<Set<string>>(new Set());
  const joinedChallengesRequestIdRef = useRef(0);
  const joinedChallengesRef = useRef<any[]>([]);
  const launchSystemCameraCaptureRef = useRef<(mode: 'video' | 'picture') => Promise<boolean>>(async () => false);
  const handlePickFromGalleryRef = useRef<() => void>(() => {});
  const shouldUseVisionCameraVideo =
    Platform.OS === 'android' && Number(Platform.Version) === ANDROID_13_API_LEVEL;
  const isUsingVisionCameraVideo = shouldUseVisionCameraVideo && cameraMode === 'video';
  const visionCameraDevice = useCameraDevice(cameraFacing);

  // Track mount state to prevent state updates after unmount (fixes crash)
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      if (recordingSafetyTimeoutRef.current) {
        clearTimeout(recordingSafetyTimeoutRef.current);
        recordingSafetyTimeoutRef.current = null;
      }
      recordingDurationRef.current = 0;
    };
  }, []);

  // Signal Create tab focus so feed screens can reduce video preload (avoid OOM during record/upload)
  const { setCreateFocused } = useCreateFocus();
  useFocusEffect(
    useCallback(() => {
      setCreateFocused(true);
      return () => setCreateFocused(false);
    }, [setCreateFocused])
  );

  // --- AUTHENTICATION CHECK ---
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      Alert.alert(
        'Authentication Required',
        'You need to be logged in to create posts. Would you like to sign in or sign up?',
        [
          {
            text: 'Cancel',
            style: 'cancel',
            onPress: () => router.replace('/')
          },
          {
            text: 'Sign Up',
            onPress: () => router.push('/auth/register')
          },
          {
            text: 'Sign In',
            onPress: () => router.push('/auth/login')
          }
        ]
      );
    }
  }, [isAuthenticated, authLoading]);

  useEffect(() => {
    if (!preferredDestination) {
      return;
    }

    if (preferredDestination === 'draft') {
      showToast('Competition limit reached. Use Save Draft below when you finish this post.');
      return;
    }

    if (preferredDestination === 'main_feed') {
      showToast('Competition limit reached. Publish this post to the main feed instead.');
    }
  }, [preferredDestination]);


  // --- CONFIGURE AUDIO MODE ---
  useEffect(() => {
    const configureAudio = async () => {
      if (Platform.OS !== 'ios') {
        return;
      }
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

  useEffect(() => {
    if (!previewPlayer || isAppActive) return;

    try {
      previewPlayer.pause();
      setIsVideoPlaying(false);
    } catch (_) {}
  }, [isAppActive, previewPlayer]);

  const CATEGORY_ORDER = ['Music', 'Sport', 'Performance', 'Beauty', 'Arts', 'Communication'];

  const normalizeCategories = useCallback((categories: any[]) => {
    const mains = (categories || []).map((category) => ({
      id: category.id,
      name: category.name,
      children: (category.children || []).map((child: any) => ({
        id: child.id,
        name: child.name,
      })),
    }));

    mains.sort((a, b) => {
      const indexA = CATEGORY_ORDER.indexOf(a.name);
      const indexB = CATEGORY_ORDER.indexOf(b.name);
      if (indexA !== -1 && indexB !== -1) return indexA - indexB;
      if (indexA !== -1) return -1;
      if (indexB !== -1) return 1;
      return a.name.localeCompare(b.name);
    });

    return mains;
  }, []);

  const normalizeJoinedChallenges = useCallback((input: any) => {
    let rawList: any[] = [];
    if (Array.isArray(input)) {
      rawList = input;
    } else if (Array.isArray(input?.challenges)) {
      rawList = input.challenges;
    } else if (Array.isArray(input?.data)) {
      rawList = input.data;
    } else if (typeof input === 'object' && input) {
      const values = Object.values(input);
      const arrayValue = values.find((value) => Array.isArray(value));
      if (arrayValue) {
        rawList = arrayValue as any[];
      }
    }

    const now = new Date();
    const deduped = new Map<string, any>();

    rawList
      .map((item: any) => item?.challenge || item)
      .filter((challenge: any) => challenge && challenge.id)
      .filter((challenge: any) => {
        return isChallengeParticipationOpen(challenge, now);
      })
      .forEach((challenge: any) => {
        deduped.set(String(challenge.id), challenge);
      });

    return Array.from(deduped.values());
  }, []);

  // --- FETCH CATEGORIES (with aggressive retry) ---
  const loadCategoriesRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) return;

    const loadCategories = async () => {
      let hydratedFromCache = false;
      const cachedCategories = await getCachedCreateCategories<any[]>();

      if (cachedCategories?.length) {
        hydratedFromCache = true;
        setMainCategories(normalizeCategories(cachedCategories));
        setLoadingCategories(false);
        setCategoriesFetchFailed(false);
      } else {
        setLoadingCategories(true);
        setCategoriesFetchFailed(false);
      }

      try {
        const res = await fetchWithRetry(() => categoriesApi.getAll(), {
          maxAttempts: hydratedFromCache ? 2 : 4,
          initialDelayMs: hydratedFromCache ? 500 : 1000,
        });
        if (res.status === 'success' && (res.data as any)?.categories) {
          const categories = (res.data as any).categories as any[];
          setMainCategories(normalizeCategories(categories));
          void setCachedCreateCategories(categories);
          setCategoriesFetchFailed(false);
        } else {
          setCategoriesFetchFailed(!hydratedFromCache);
        }
      } catch {
        setCategoriesFetchFailed(!hydratedFromCache);
      } finally {
        setLoadingCategories(false);
      }
    };
    loadCategoriesRef.current = loadCategories;
    loadCategories();
  }, [authLoading, isAuthenticated, normalizeCategories]);

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

  useEffect(() => {
    joinedChallengesRef.current = joinedChallenges;
  }, [joinedChallenges]);

  const syncSelectedJoinedChallenge = useCallback((availableChallenges: any[]) => {
    if (
      !isChallengeOnlyFlow &&
      params.challengeId &&
      availableChallenges.some((challenge: any) => String(challenge.id) === String(params.challengeId))
    ) {
      setSelectedChallengeId(params.challengeId as string);
    }
  }, [isChallengeOnlyFlow, params.challengeId]);

  const applyJoinedChallenges = useCallback(
    async (
      input: any,
      options?: {
        requestId?: number;
        persist?: boolean;
        keepCurrentOnEmpty?: boolean;
      },
    ) => {
      if (
        typeof options?.requestId === 'number' &&
        options.requestId !== joinedChallengesRequestIdRef.current
      ) {
        return [];
      }

      const normalized = normalizeJoinedChallenges(input);
      const nextChallenges =
        options?.keepCurrentOnEmpty && normalized.length === 0 && joinedChallengesRef.current.length > 0
          ? joinedChallengesRef.current
          : normalized;

      joinedChallengesRef.current = nextChallenges;
      setJoinedChallenges(nextChallenges);
      syncSelectedJoinedChallenge(nextChallenges);

      if (options?.persist && user?.id) {
        await setCachedJoinedChallenges(user.id, normalized);
      }

      return normalized;
    },
    [normalizeJoinedChallenges, syncSelectedJoinedChallenge, user?.id],
  );

  // Fetch joined challenges with immediate cache hydration, no-cache network fetch, and stale-response protection.
  const loadJoinedChallengesRef = useRef<() => void>(() => {});
  const loadJoinedChallenges = useCallback(async (options?: { background?: boolean }) => {
    if (!isAuthenticated || authLoading || !user?.id) {
      return;
    }

    const requestId = joinedChallengesRequestIdRef.current + 1;
    joinedChallengesRequestIdRef.current = requestId;

    let hadCachedChallenges = false;
    const cachedChallenges = await getCachedJoinedChallenges<any[]>(user.id);
    if (requestId !== joinedChallengesRequestIdRef.current) {
      return;
    }

    if (cachedChallenges?.length) {
      hadCachedChallenges = true;
      await applyJoinedChallenges(cachedChallenges, { requestId });
      setLoadingChallenges(false);
      setChallengesFetchFailed(false);
    } else if (!options?.background) {
      setLoadingChallenges(true);
      setChallengesFetchFailed(false);
    }

    const fetchFreshJoinedChallenges = () =>
      challengesApi.getJoinedChallenges({ fresh: true, timeout: 20000, maxAttempts: 3 });

    try {
      let response = await fetchFreshJoinedChallenges();
      if (requestId !== joinedChallengesRequestIdRef.current) {
        return;
      }

      let normalized = response.status === 'success'
        ? normalizeJoinedChallenges(response.data?.challenges ?? response.data)
        : [];

      // Some devices appear to get an empty first payload right after join; do one fast second pass before
      // accepting the empty result.
      if (response.status === 'success' && normalized.length === 0 && hadCachedChallenges) {
        await new Promise((resolve) => setTimeout(resolve, 700));
        if (requestId !== joinedChallengesRequestIdRef.current) {
          return;
        }
        response = await fetchFreshJoinedChallenges();
        if (requestId !== joinedChallengesRequestIdRef.current) {
          return;
        }
        normalized = response.status === 'success'
          ? normalizeJoinedChallenges(response.data?.challenges ?? response.data)
          : [];
      }

      if (response.status === 'success') {
        await applyJoinedChallenges(normalized, {
          requestId,
          persist: true,
          keepCurrentOnEmpty: hadCachedChallenges,
        });
        setChallengesFetchFailed(false);
      } else if (!hadCachedChallenges) {
        joinedChallengesRef.current = [];
        setJoinedChallenges([]);
        setChallengesFetchFailed(true);
      }
    } catch (error: any) {
      console.warn('[Create] Error fetching joined challenges:', error?.message);
      if (!hadCachedChallenges) {
        joinedChallengesRef.current = [];
        setJoinedChallenges([]);
        setChallengesFetchFailed(true);
      }
    } finally {
      if (requestId === joinedChallengesRequestIdRef.current) {
        setLoadingChallenges(false);
      }
    }
  }, [applyJoinedChallenges, authLoading, isAuthenticated, normalizeJoinedChallenges, user?.id]);

  useEffect(() => {
    loadJoinedChallengesRef.current = () => {
      void loadJoinedChallenges();
    };
  }, [loadJoinedChallenges]);

  useEffect(() => {
    void loadJoinedChallenges();
  }, [loadJoinedChallenges]);

  useFocusEffect(
    useCallback(() => {
      if (!authLoading && isAuthenticated && user?.id) {
        void loadJoinedChallenges({ background: joinedChallengesRef.current.length > 0 });
      }
    }, [authLoading, isAuthenticated, loadJoinedChallenges, user?.id]),
  );

  useEffect(() => {
    if (!user?.id) {
      return;
    }

    const handleChallengeUpdated = () => {
      void loadJoinedChallenges({ background: joinedChallengesRef.current.length > 0 });
    };

    websocketService.on('challengeUpdated', handleChallengeUpdated);
    return () => {
      websocketService.off('challengeUpdated', handleChallengeUpdated);
    };
  }, [loadJoinedChallenges, user?.id]);

  const loadJoinableChallenges = useCallback(async () => {
    if (!user?.id) {
      return;
    }

    setLoadingAvailableChallenges(true);
    try {
      const response = await fetchWithRetry(() => challengesApi.getAll('active'), {
        maxAttempts: 3,
        initialDelayMs: 400,
      });

      if (response.status !== 'success') {
        throw new Error(response.message || 'Failed to load competitions');
      }

      const rawChallenges =
        (response.data as any)?.challenges ||
        response.data ||
        [];

      const now = new Date();
      const joinedIds = new Set(joinedChallengesRef.current.map((challenge: any) => String(challenge.id)));
      const joinableChallenges = (Array.isArray(rawChallenges) ? rawChallenges : [])
        .map((item: any) => item?.challenge || item)
        .filter((challenge: any) => challenge?.id)
        .filter((challenge: any) => !joinedIds.has(String(challenge.id)))
        .filter((challenge: any) => challenge.organizer_id !== user.id && challenge.organizer?.id !== user.id)
        .filter((challenge: any) => isChallengeParticipationOpen(challenge, now))
        .sort((a: any, b: any) => {
          const aStart = new Date(a.start_date || 0).getTime();
          const bStart = new Date(b.start_date || 0).getTime();
          return aStart - bStart;
        });

      setAvailableChallenges(joinableChallenges);
    } catch (error: any) {
      console.warn('[Create] Error loading joinable competitions:', error?.message);
      showToast('Unable to load competitions right now');
      setAvailableChallenges([]);
    } finally {
      setLoadingAvailableChallenges(false);
    }
  }, [user?.id]);

  const openJoinCompetitionModal = useCallback(() => {
    setJoinCompetitionModalVisible(true);
    void loadJoinableChallenges();
  }, [loadJoinableChallenges]);

  const ensureChallengePostCount = useCallback(async (
    challenge: any,
    options?: { force?: boolean },
  ) => {
    if (!challenge?.id || !user?.id || loadingChallengeCountsRef.current.has(challenge.id)) {
      return null;
    }

    if (!options?.force && challengePostCounts[challenge.id]) {
      return challengePostCounts[challenge.id];
    }

    loadingChallengeCountsRef.current.add(challenge.id);

    try {
      const response = await challengesApi.getParticipantPosts(challenge.id, user.id, 1, 100);
      const count = Array.isArray(response.data?.posts) ? response.data.posts.length : 0;
      const max = Number(challenge.max_content_per_account ?? challenge.min_content_per_account) || 5;
      const nextInfo = { count, max };

      if (!isMountedRef.current) return;

      setChallengePostCounts((prev) => ({
        ...prev,
        [challenge.id]: nextInfo,
      }));

      return nextInfo;
    } catch {
      if (!isMountedRef.current) return;

      const nextInfo = {
        count: challengePostCounts[challenge.id]?.count ?? 0,
        max: Number(challenge.max_content_per_account ?? challenge.min_content_per_account) || 5,
      };

      setChallengePostCounts((prev) => ({
        ...prev,
        [challenge.id]: nextInfo,
      }));

      return nextInfo;
    } finally {
      loadingChallengeCountsRef.current.delete(challenge.id);
    }
  }, [challengePostCounts, user?.id]);

  // Warm a small subset of challenge counts after the list is visible instead of blocking initial rendering.
  useEffect(() => {
    if (!user?.id || joinedChallenges.length === 0) return;

    let cancelled = false;
    const timeoutId = setTimeout(() => {
      void (async () => {
        for (const challenge of joinedChallenges.slice(0, 6)) {
          if (cancelled) return;
          await ensureChallengePostCount(challenge, { force: true });
        }
      })();
    }, 800);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [ensureChallengePostCount, joinedChallenges, user?.id]);

  const handleJoinCompetitionFromCreate = useCallback(async (challenge: any) => {
    if (!user?.id || !challenge?.id || joiningCompetitionId) {
      return;
    }

    setJoiningCompetitionId(String(challenge.id));
    try {
      const response = await challengesApi.join(String(challenge.id));
      if (response?.status !== 'success') {
        throw new Error(response?.message || 'Failed to join competition');
      }

      await upsertCachedJoinedChallenge(user.id, {
        ...challenge,
        is_participant: true,
      });
      await applyJoinedChallenges(
        [...joinedChallengesRef.current, { ...challenge, is_participant: true }],
        { persist: true },
      );

      setAvailableChallenges((prev) => prev.filter((item: any) => String(item.id) !== String(challenge.id)));
      setSelectedChallengeId(String(challenge.id));
      setJoinCompetitionModalVisible(false);
      showToast(`Joined ${challenge.name || 'competition'}`);
      void ensureChallengePostCount(challenge);
    } catch (error: any) {
      const message = error?.message || 'Failed to join competition';
      Alert.alert('Unable to Join Competition', message);
    } finally {
      setJoiningCompetitionId(null);
    }
  }, [applyJoinedChallenges, ensureChallengePostCount, joiningCompetitionId, user?.id]);

  const isMaxPostsReached = (() => {
    if (!effectiveSelectedChallengeId) return false;
    const info = challengePostCounts[effectiveSelectedChallengeId];
    if (!info) return false;
    return info.count >= info.max;
  })();

  const incrementChallengePostCount = useCallback((challengeId: string | null | undefined) => {
    if (!challengeId) {
      return;
    }

    const challenge = joinedChallengesRef.current.find((item: any) => String(item.id) === String(challengeId));
    const fallbackMax = Number(challenge?.max_content_per_account ?? challenge?.min_content_per_account) || 5;

    setChallengePostCounts((prev) => {
      const current = prev[challengeId];
      const max = current?.max ?? fallbackMax;

      return {
        ...prev,
        [challengeId]: {
          count: Math.min((current?.count ?? 0) + 1, max),
          max,
        },
      };
    });
  }, []);

  // Re-fetch categories and joined challenges automatically when connectivity returns
  useRefetchOnReconnect(() => {
    loadCategoriesRef.current();
    loadJoinedChallengesRef.current();
  });

  const remountCamera = useCallback((nextMode: 'video' | 'picture') => {
    const mountFreshInstance = () => {
      if (!isMountedRef.current) return;
      setCameraMode(nextMode);
      setIsCameraReady(false);
      setShowCamera(true);
      setCameraSessionKey((prev) => prev + 1);
    };

    stoppedDueToMaxDurationRef.current = false;
    setRecordingDuration(0);
    recordingDurationRef.current = 0;

    if (showCamera) {
      setShowCamera(false);
      setTimeout(mountFreshInstance, 180);
      return;
    }

    mountFreshInstance();
  }, [showCamera]);

  const ensureCameraPermissions = useCallback(
    async (mode: 'video' | 'picture') => {
      if (shouldUseVisionCameraVideo && mode === 'video') {
        const hasCameraAccess = hasVisionCameraPermission || await requestVisionCameraPermission();
        if (!hasCameraAccess) {
          Alert.alert(
            'Camera Permission Denied',
            'Camera access is required to record a video. Please enable it in Settings to continue.',
            [
              { text: 'Open Settings', onPress: () => Linking.openSettings() },
              { text: 'Cancel', style: 'cancel' },
            ],
          );
          return false;
        }

        const hasMicAccess = hasVisionMicrophonePermission || await requestVisionMicrophonePermission();
        if (!hasMicAccess) {
          Alert.alert(
            'Microphone Access',
            'Microphone permission was denied. You can continue and record silently, or enable microphone access for video with audio.',
            [
              {
                text: 'Continue Silent',
                onPress: () => remountCamera(mode),
              },
              { text: 'Open Settings', onPress: () => Linking.openSettings() },
              { text: 'Cancel', style: 'cancel' },
            ],
          );
          return false;
        }

        remountCamera(mode);
        return true;
      }

      const camPerm = cameraPermission?.granted ? cameraPermission : await requestCameraPermission();
      if (!camPerm?.granted) {
        if (!(camPerm as any)?.canAskAgain) {
          Alert.alert(
            'Camera Permission Denied',
            'Camera access was permanently denied. Please enable it in Settings to continue.',
            [
              { text: 'Open Settings', onPress: () => Linking.openSettings() },
              { text: 'Cancel', style: 'cancel' },
            ],
          );
        }
        return false;
      }

      if (mode === 'video') {
        const micPerm = microphonePermission?.granted
          ? microphonePermission
          : await requestMicrophonePermission();

        if (!micPerm?.granted) {
          const canAskAgain = (micPerm as any)?.canAskAgain !== false;
          Alert.alert(
            'Microphone Access',
            canAskAgain
              ? 'Microphone permission was denied. You can continue and record silently, or grant microphone access for video with audio.'
              : 'Microphone permission was permanently denied. You can continue and record silently, or enable microphone access in Settings.',
            [
              {
                text: canAskAgain ? 'Continue Silent' : 'Record Silent',
                onPress: () => remountCamera(mode),
              },
              ...(!canAskAgain
                ? [{ text: 'Open Settings', onPress: () => Linking.openSettings() }]
                : []),
              { text: 'Cancel', style: 'cancel' },
            ],
          );
          return false;
        }
      }

      remountCamera(mode);
      return true;
    },
    [
      cameraPermission,
      hasVisionCameraPermission,
      hasVisionMicrophonePermission,
      microphonePermission,
      remountCamera,
      requestCameraPermission,
      requestMicrophonePermission,
      requestVisionCameraPermission,
      requestVisionMicrophonePermission,
      shouldUseVisionCameraVideo,
    ],
  );

  // Camera-ready watchdog: auto-retry once after 6s, then warn user at 14s
  useEffect(() => {
    if (!showCamera || isCameraReady) return;

    const autoRetry = setTimeout(() => {
      if (!isCameraReady && showCamera && cameraRetryCountRef.current < 1) {
        cameraRetryCountRef.current += 1;
        console.warn('[Camera] Watchdog: auto-retrying camera (attempt', cameraRetryCountRef.current, ')');
        remountCamera(cameraMode);
      }
    }, 6000);

    const finalWatchdog = setTimeout(() => {
      if (!isCameraReady && showCamera) {
        console.error('[Camera] Watchdog: camera did not become ready after retry');
        try {
          const Sentry = require('@sentry/react-native');
          Sentry.captureMessage('Camera blank/dark: onCameraReady never fired after retry', {
            level: 'error',
            extra: {
              cameraMode,
              cameraFacing,
              cameraPermGranted: cameraPermission?.granted,
              micPermGranted: microphonePermission?.granted,
              retryCount: cameraRetryCountRef.current,
              deviceModel:
                ((Platform.constants as { Model?: string; model?: string } | undefined)?.Model ??
                  (Platform.constants as { Model?: string; model?: string } | undefined)?.model ??
                  'unknown'),
              osVersion: Platform.Version,
            },
          });
        } catch {}
        Alert.alert(
          'Camera not responding',
          'The camera could not start on this device. This can happen on older or low-memory devices.\n\nTry:\n• Closing all other apps\n• Restarting your phone\n• Using the gallery to pick existing media instead',
          [
            { text: 'Try Again', onPress: () => { cameraRetryCountRef.current = 0; remountCamera(cameraMode); } },
            ...(cameraMode === 'video'
              ? [{ text: 'Use Device Camera', onPress: () => { cancelCamera(); void launchSystemCameraCaptureRef.current('video'); } }]
              : []),
            { text: 'Pick from Gallery', onPress: () => { cancelCamera(); handlePickFromGalleryRef.current(); } },
            { text: 'Close Camera', style: 'cancel', onPress: cancelCamera },
          ],
        );
      }
    }, isUsingVisionCameraVideo ? 14000 : 14000);

    return () => { clearTimeout(autoRetry); clearTimeout(finalWatchdog); };
  }, [showCamera, isCameraReady, remountCamera, cameraMode, isUsingVisionCameraVideo]);

  // --- CAMERA RECORDING ---
  const handleRecordVideo = useCallback(async () => {
    try {
      if (Platform.OS === 'ios') {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
          shouldDuckAndroid: false,
          playThroughEarpieceAndroid: false,
        });
      }

      // Show informative 2-min limit modal first (only for video); user taps "Proceed to record" to open camera
      setCameraMode('video');
      setRecordingDuration(0);
      setShowPreRecordInfoModal(true);
    } catch (error: any) {
      console.error('Camera error:', error);
      Alert.alert('Error', error.message || 'Failed to open camera. Please try again.');
    }
  }, []);

  const cameraRetryCountRef = useRef(0);

  const proceedToRecord = async () => {
    setShowPreRecordInfoModal(false);
    cameraRetryCountRef.current = 0;
    await ensureCameraPermissions('video');
  };

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

  const getSelectedCategoryDisplayName = () => {
    return getCategoryDisplayName(getSelectedCategoryName());
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

  const handlePickedVideoAsset = useCallback(async (videoUri: string) => {
    setCapturedImageUri(null);
    setEditedVideoUri(null);
    setRecordedVideoUri(videoUri);
    setShowCamera(false);
    setIsCameraReady(false);

    const pickedThumbnail = await generateThumbnail(videoUri).catch(() => null);
    if (pickedThumbnail) {
      setThumbnailUri(pickedThumbnail);
    }

    showToast('Video selected successfully!');
  }, []);

  const launchSystemCameraCapture = useCallback(async (mode: 'video' | 'picture') => {
    try {
      const cameraPermission = await ImagePicker.requestCameraPermissionsAsync();
      if (!cameraPermission.granted) {
        Alert.alert('Permission Required', 'Camera permission is required to continue.');
        return false;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: mode === 'video' ? ['videos'] : ['images'],
        allowsEditing: false,
        quality: 1,
        videoMaxDuration: mode === 'video' ? 120 : undefined,
        cameraType:
          cameraFacing === 'front'
            ? ImagePicker.CameraType.front
            : ImagePicker.CameraType.back,
      });

      if (result.canceled || !result.assets?.length) {
        return false;
      }

      const asset = result.assets[0];
      if (!asset?.uri) {
        throw new Error('The camera did not return any media.');
      }

      if (mode === 'video') {
        await handlePickedVideoAsset(asset.uri);
      } else {
        await processCapturedImage(asset.uri);
      }

      return true;
    } catch (error: any) {
      Alert.alert('Camera Error', error?.message || 'Failed to open the device camera.');
      return false;
    }
  }, [cameraFacing, handlePickedVideoAsset, processCapturedImage]);
  launchSystemCameraCaptureRef.current = launchSystemCameraCapture;

  const handlePickFromGallery = useCallback(async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          'Permission Required',
          'Photo library access is required to choose existing media.',
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        allowsEditing: false,
        quality: 1,
        videoMaxDuration: 120,
      });

      if (result.canceled || !result.assets?.length) {
        return;
      }

      const asset = result.assets[0];
      if (!asset?.uri) {
        Alert.alert('Error', 'The selected media could not be loaded.');
        return;
      }

      if (asset.type === 'video') {
        await handlePickedVideoAsset(asset.uri);
        return;
      }

      await processCapturedImage(asset.uri);
    } catch (error: any) {
      console.error('[Gallery] Failed to pick media:', error);
      Alert.alert('Error', error?.message || 'Failed to pick media from gallery.');
    }
  }, [handlePickedVideoAsset, processCapturedImage]);
  handlePickFromGalleryRef.current = () => {
    void handlePickFromGallery();
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

  const startRecording = useCallback(async () => {
    if (isRecording) return;

    try {
      if (!isCameraReady) {
        Alert.alert('Camera Starting', 'Please wait for the camera preview to finish loading.');
        return;
      }

      if (isUsingVisionCameraVideo) {
        if (!visionCameraRef.current || !visionCameraDevice) {
          Alert.alert('Camera Error', 'The video camera is not ready yet. Please wait a moment and try again.');
          return;
        }

        const MAX_RECORDING_SECONDS = 120;
        setIsRecording(true);
        setRecordingDuration(0);
        recordingDurationRef.current = 0;

        recordingTimerRef.current = setInterval(() => {
          setRecordingDuration((prev) => {
            const newDuration = prev + 1;
            recordingDurationRef.current = newDuration;
            if (newDuration >= MAX_RECORDING_SECONDS) {
              stoppedDueToMaxDurationRef.current = true;
              void visionCameraRef.current?.stopRecording().catch((error) => {
                console.error('[VisionCamera] Failed to stop after max duration:', error);
              });
              return MAX_RECORDING_SECONDS;
            }
            return newDuration;
          });
        }, 1000);
        recordingSafetyTimeoutRef.current = setTimeout(() => {
          void visionCameraRef.current?.stopRecording().catch((error) => {
            console.error('[VisionCamera] Safety timeout stop failed:', error);
          });
        }, (MAX_RECORDING_SECONDS + 1) * 1000);

        visionCameraRef.current.startRecording({
          fileType: 'mp4',
          videoCodec: 'h264',
          onRecordingFinished: (video) => {
            setTimeout(async () => {
              if (!isMountedRef.current) {
                return;
              }

              setIsRecording(false);
              if (recordingTimerRef.current) {
                clearInterval(recordingTimerRef.current);
                recordingTimerRef.current = null;
              }
              if (recordingSafetyTimeoutRef.current) {
                clearTimeout(recordingSafetyTimeoutRef.current);
                recordingSafetyTimeoutRef.current = null;
              }

              const videoUri = video.path.startsWith('file://') ? video.path : `file://${video.path}`;

              try {
                const fileInfo = await FileSystem.getInfoAsync(videoUri);
                if (!fileInfo.exists || Number((fileInfo as any).size || 0) < 1024) {
                  throw new Error('Recorded video file was not saved correctly.');
                }
              } catch (error) {
                console.error('[VisionCamera] Video file validation failed:', error);
                if (isMountedRef.current) {
                  Alert.alert('Recording failed', 'Failed to save video. Please try again.');
                  setShowCamera(false);
                  setRecordingDuration(0);
                  recordingDurationRef.current = 0;
                }
                return;
              }

              if (recordingDurationRef.current > 120) {
                Alert.alert(
                  'Video Too Long',
                  'Your recording is longer than 2 minutes. Please record a shorter video.'
                );
                if (isMountedRef.current) {
                  setShowCamera(false);
                  setRecordingDuration(0);
                  recordingDurationRef.current = 0;
                }
                return;
              }

              setRecordedVideoUri(videoUri);
              setEditedVideoUri(null);
              setCapturedImageUri(null);
              setShowCamera(false);
              setRecordingDuration(0);
              recordingDurationRef.current = 0;

              if (stoppedDueToMaxDurationRef.current) {
                stoppedDueToMaxDurationRef.current = false;
                setShowMaxDurationReachedModal(true);
              }

              generateThumbnail(videoUri)
                .then((thumbnail) => {
                  if (isMountedRef.current && thumbnail) {
                    setThumbnailUri(thumbnail);
                  }
                })
                .catch((thumbError) => {
                  console.error('[VisionCamera] Thumbnail generation error (non-critical):', thumbError);
                });
            }, 100);
          },
          onRecordingError: (error) => {
            console.error('[VisionCamera] Recording error:', error);
            setTimeout(() => {
              if (!isMountedRef.current) return;

              setIsRecording(false);
              if (recordingTimerRef.current) {
                clearInterval(recordingTimerRef.current);
                recordingTimerRef.current = null;
              }
              if (recordingSafetyTimeoutRef.current) {
                clearTimeout(recordingSafetyTimeoutRef.current);
                recordingSafetyTimeoutRef.current = null;
              }
              recordingDurationRef.current = 0;

              if (error?.message && !String(error.message).includes('cancel')) {
                Alert.alert(
                  'Recording failed',
                  'Failed to record video. Please try again.',
                  [{ text: 'OK' }],
                );
              }
              setShowCamera(false);
              setRecordingDuration(0);
            }, 100);
          },
        });

        return;
      }

      if (!cameraRef.current) {
        return;
      }

      setIsRecording(true);
      setRecordingDuration(0);
      recordingDurationRef.current = 0;

      const MAX_RECORDING_SECONDS = 120;
      recordingTimerRef.current = setInterval(() => {
        setRecordingDuration((prev) => {
          const newDuration = prev + 1;
          recordingDurationRef.current = newDuration;
          if (newDuration >= MAX_RECORDING_SECONDS) {
            stoppedDueToMaxDurationRef.current = true;
            stopRecording();
            return MAX_RECORDING_SECONDS;
          }
          return newDuration;
        });
      }, 1000);
      recordingSafetyTimeoutRef.current = setTimeout(() => {
        stopRecording();
      }, (MAX_RECORDING_SECONDS + 1) * 1000);

      if (Platform.OS === 'ios') {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
          shouldDuckAndroid: false,
          playThroughEarpieceAndroid: false,
          staysActiveInBackground: false,
        });
        await new Promise((resolve) => setTimeout(resolve, 160));
      }

      const recordingOptions: Parameters<CameraView['recordAsync']>[0] = {
        maxDuration: MAX_RECORDING_SECONDS,
      };

      if (Platform.OS === 'ios') {
        recordingOptions.codec = 'avc1';
      }

      const recordingPromise = cameraRef.current.recordAsync(recordingOptions);

      recordingPromise.then(async (video) => {
        // CRITICAL FIX: Prevent crash by ensuring all operations are safe
        // Use setTimeout to defer state updates and prevent race conditions
        setTimeout(async () => {
          // Check if component is still mounted before any state updates
          if (!isMountedRef.current) {
            console.log('[Recording] Component unmounted, skipping state updates');
            return;
          }

          setIsRecording(false);
          if (recordingTimerRef.current) {
            clearInterval(recordingTimerRef.current);
            recordingTimerRef.current = null;
          }
          if (recordingSafetyTimeoutRef.current) {
            clearTimeout(recordingSafetyTimeoutRef.current);
            recordingSafetyTimeoutRef.current = null;
          }

          if (video && video.uri) {
            // Verify video file exists before processing
            try {
              const fileInfo = await FileSystem.getInfoAsync(video.uri);
              if (!fileInfo.exists || Number((fileInfo as any).size || 0) < 1024) {
                console.error('[Recording] Video file does not exist:', video.uri);
                if (isMountedRef.current) {
                  Alert.alert('Error', 'Video file was not saved properly. Please try again.');
                  setShowCamera(false);
                  setRecordingDuration(0);
                }
                return;
              }
            } catch (fileCheckError) {
              console.error('[Recording] Error checking video file:', fileCheckError);
              // Continue anyway - file might still be valid
            }

            if (recordingDurationRef.current > 120) {
              Alert.alert(
                'Video Too Long',
                'Your recording is longer than 2 minutes. Please record a shorter video.'
              );
              if (isMountedRef.current) {
                setShowCamera(false);
                setRecordingDuration(0);
                recordingDurationRef.current = 0;
              }
              return;
            }

            // CRITICAL FIX: Generate thumbnail AFTER closing camera to prevent crash
            // Don't block on thumbnail generation - do it asynchronously
            if (isMountedRef.current) {
              setRecordedVideoUri(video.uri);
              setEditedVideoUri(null);
              setCapturedImageUri(null);
              setShowCamera(false);
              setRecordingDuration(0);
              recordingDurationRef.current = 0;

              if (stoppedDueToMaxDurationRef.current) {
                stoppedDueToMaxDurationRef.current = false;
                setShowMaxDurationReachedModal(true);
              }

              // Generate thumbnail in background (non-blocking)
              generateThumbnail(video.uri)
                .then(thumbnail => {
                  if (isMountedRef.current && thumbnail) {
                    setThumbnailUri(thumbnail);
                  }
                })
                .catch(thumbError => {
                  console.error('Thumbnail generation error (non-critical):', thumbError);
                  // Don't show error - thumbnail is optional
                });
            }
          } else {
            if (isMountedRef.current) {
              Alert.alert('Error', 'Failed to save video. Please try again.');
              setShowCamera(false);
              setRecordingDuration(0);
            }
          }
        }, 100); // Small delay to ensure camera is fully stopped
      }).catch((error: any) => {
        console.error('Recording promise error:', error);

        // CRITICAL FIX: Use setTimeout to prevent crash during error handling
        setTimeout(() => {
          if (!isMountedRef.current) return;

          setIsRecording(false);
          if (recordingTimerRef.current) {
            clearInterval(recordingTimerRef.current);
            recordingTimerRef.current = null;
          }
          if (recordingSafetyTimeoutRef.current) {
            clearTimeout(recordingSafetyTimeoutRef.current);
            recordingSafetyTimeoutRef.current = null;
          }
          if (error?.message && !error.message.includes('cancel')) {
            Alert.alert(
              'Recording failed',
              shouldUseVisionCameraVideo
                ? 'In-app recording failed on this device. Use the device camera to continue recording safely.'
                : 'Failed to record video. Please try again.',
              shouldUseVisionCameraVideo
                ? [
                    { text: 'Use Device Camera', onPress: () => void launchSystemCameraCapture('video') },
                    { text: 'Cancel', style: 'cancel' },
                  ]
                : [{ text: 'OK' }],
            );
          }
          if (isMountedRef.current) {
            setShowCamera(false);
            setRecordingDuration(0);
            recordingDurationRef.current = 0;
          }
        }, 100);
      });
    } catch (error: any) {
      console.error('Recording error:', error);
      Alert.alert(
        'Recording error',
        shouldUseVisionCameraVideo
          ? 'In-app recording could not start on this device. Use the device camera instead.'
          : 'Failed to start recording. Please try again.',
        shouldUseVisionCameraVideo
          ? [
              { text: 'Use Device Camera', onPress: () => void launchSystemCameraCapture('video') },
              { text: 'Cancel', style: 'cancel' },
            ]
          : [{ text: 'OK' }],
      );
      setIsRecording(false);
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      if (recordingSafetyTimeoutRef.current) {
        clearTimeout(recordingSafetyTimeoutRef.current);
        recordingSafetyTimeoutRef.current = null;
      }
      recordingDurationRef.current = 0;
    }
  }, [isRecording, isCameraReady, isUsingVisionCameraVideo, launchSystemCameraCapture, shouldUseVisionCameraVideo, visionCameraDevice]);

  const stopRecording = () => {
    if (!isRecording) return;

    setIsRecording(false);
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (recordingSafetyTimeoutRef.current) {
      clearTimeout(recordingSafetyTimeoutRef.current);
      recordingSafetyTimeoutRef.current = null;
    }
    recordingDurationRef.current = 0;

    if (isUsingVisionCameraVideo) {
      void visionCameraRef.current?.stopRecording().catch((error) => {
        console.error('[VisionCamera] Failed to stop recording:', error);
      });
      return;
    }

    cameraRef.current?.stopRecording();
  };

  const cancelCamera = () => {
    if (isRecording) {
      stopRecording();
    }
    setShowCamera(false);
    setIsCameraReady(false);
    setRecordingDuration(0);
    setIsRecording(false);
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (recordingSafetyTimeoutRef.current) {
      clearTimeout(recordingSafetyTimeoutRef.current);
      recordingSafetyTimeoutRef.current = null;
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

  const MAX_DRAFTS = 3;

  const resetComposerState = useCallback(() => {
    setServerMediaUrl(null);
    setCapturedImageUri(null);
    setCaption('');
    setSelectedGroup('');
    setSelectedCategoryId('');
    setSelectedChallengeId(null);
    setRecordedVideoUri(null);
    setEditedVideoUri(null);
    setThumbnailUri(null);
    setIsVideoPlaying(false);
    setUploading(false);
    setUploadProgress(0);
  }, []);

  // --- SUBMIT ---
  const handleCreatePost = async (status: 'active' | 'draft' = 'active') => {
    if (!isAuthenticated || !user) {
      Alert.alert(
        'Authentication Required',
        'You need to be logged in to create posts. Would you like to sign in or sign up?',
        [
          {
            text: 'Sign Up',
            onPress: () => router.push('/auth/register')
          },
          {
            text: 'Sign In',
            onPress: () => router.push('/auth/login')
          }
        ]
      );
      return;
    }

    if (status === 'draft') {
      try {
        const draftRes = await postsApi.getDrafts(1, 10);
        const drafts = draftRes.data?.posts ?? [];
        if (drafts.length >= MAX_DRAFTS) {
          setExistingDrafts(drafts);
          setPendingDraftStatus('draft');
          setDraftReplaceModalVisible(true);
          return;
        }
      } catch (_) {}
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

    let preparedVideo: PreparedVideoAsset | null = null;

    try {
      let lastReportedProgress = -1;
      const updateProgress = (nextProgress: number) => {
        const clamped = Math.max(0, Math.min(100, Math.round(nextProgress)));
        setUploadProgress(clamped);
        if (clamped === 100 || clamped <= 5 || clamped - lastReportedProgress >= 3 || clamped < lastReportedProgress) {
          lastReportedProgress = clamped;
          void uploadNotificationService.showUploadProgress(clamped, 'video');
        }
      };

      const categoryName = getSelectedCategoryName();
      if (!categoryName || categoryName.trim() === '') {
        setUploading(false);
        setUploadProgress(0);
        Alert.alert('Category Error', 'Selected category name is missing. Please re-select a category and try again.');
        return;
      }

      let mediaUri = imageUri || rawVideoUri;
      if (!mediaUri) {
        throw new Error('No media file to upload');
      }

      const isVideo = !!rawVideoUri;

      if (isVideo && rawVideoUri) {
        updateProgress(4);
        preparedVideo = await prepareVideoForUpload(rawVideoUri, (progress) => {
          updateProgress(4 + progress * 16);
        });
        mediaUri = preparedVideo.uploadUri;

        if (preparedVideo.thumbnailUri) {
          setThumbnailUri(preparedVideo.thumbnailUri);
        }
      }

      const fileInfo = await FileSystem.getInfoAsync(mediaUri);
      if (!fileInfo.exists) {
        throw new Error('Media file not found');
      }

      const fileName = preparedVideo?.fileName || mediaUri.split('/').pop() || (isVideo ? 'video.mp4' : 'image.jpg');
      const fileType = preparedVideo?.mimeType || 'image/jpeg';

      const mediaInfo = await FileSystem.getInfoAsync(mediaUri);
      if (!mediaInfo.exists) {
        throw new Error(`Media file not found at: ${mediaUri}`);
      }
      console.log('[Upload] Media file verified:', {
        uri: mediaUri,
        exists: mediaInfo.exists,
        size: mediaInfo.size,
        fileName,
        fileType,
        preparedFrom: preparedVideo?.originalUri,
        preparedSize: preparedVideo?.uploadSizeBytes,
      });

      let fileData: any = {
        uri: mediaUri,
        name: fileName,
        type: fileType,
      };
      const selectedChallenge = joinedChallenges.find(
        (challenge: any) => challenge.id === effectiveSelectedChallengeId,
      );
      const selectedChallengeName =
        selectedChallenge?.name || forcedChallengeName || undefined;

      // Note: For React Native, FormData.append(name, file) expects:
      // - file as a Blob/File object with uri property (which RN handles)
      // - OR a string/number
      // We don't convert to base64 for FormData as it expects the native file object
      // FormData will read the file from the URI automatically

      if (effectiveSelectedChallengeId && !isVideo) {
        const formData = new FormData();
        formData.append('title', caption.trim().substring(0, 50) || 'My Post');
        formData.append('caption', caption);
        formData.append('post_category', categoryName);
        formData.append('file', fileData as any);

        console.log('[Upload] Creating post in challenge:', {
          challengeId: effectiveSelectedChallengeId,
          title: caption.trim().substring(0, 50),
          categoryName,
          fileName,
          fileType
        });

        const xhr = new XMLHttpRequest();
        const apiUrl = `${API_BASE_URL}/api/challenges/${effectiveSelectedChallengeId}/posts`;

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

          if (xhr.status < 200 || xhr.status >= 300) {
            let errorMsg = `Server error (${xhr.status})`;
            let errorCode = '';
            let errorCap = 5;
            try {
              const errResponse = JSON.parse(xhr.responseText);
              errorMsg = errResponse.message || errResponse.error || errorMsg;
              errorCode = errResponse.code || '';
              errorCap = Number(errResponse.max_content_per_account || errResponse.data?.max_content_per_account) || 5;
            } catch (_) { }
            console.warn('[Upload] Challenge post server error:', xhr.status, errorMsg, errorCode);

            if (errorCode === 'MAX_CHALLENGE_POSTS_REACHED') {
              Alert.alert(
                'Competition Limit Reached',
                `You've reached the maximum posts for this competition (${errorCap}). Your content was not uploaded. What would you like to do?`,
                [
                  {
                    text: 'Publish to Main Feed',
                    onPress: () => {
                      setSelectedChallengeId(null);
                      handleCreatePost('active');
                    },
                  },
                  {
                    text: 'Save as Draft',
                    onPress: () => {
                      setSelectedChallengeId(null);
                      handleCreatePost('draft');
                    },
                  },
                  { text: 'Discard', style: 'destructive', onPress: () => resetComposerState() },
                ],
                { cancelable: false },
              );
              return;
            }

            await uploadNotificationService.showUploadError(errorMsg, fileName);
            Alert.alert('Upload Failed', errorMsg);
            return;
          }

          try {
            const response = JSON.parse(xhr.responseText);
            console.log('[Upload] Challenge post response:', response);

            if (response.status === 'success') {
              const challengeIdToOpen = effectiveSelectedChallengeId;
              const createdPost = response.data?.post;
              const createdPostId = createdPost?.id as string | undefined;
              const createdType = createdPost?.type || createdPost?.mediaType || null;

              // As soon as upload is done, mark it complete in the UI.
              // For videos, backend will continue HLS processing and send a notification when ready.
              await uploadNotificationService.showUploadComplete(fileName);

              if (challengeIdToOpen) {
                incrementChallengePostCount(challengeIdToOpen);
              }

              setRecordedVideoUri(null);
              setEditedVideoUri(null);
              setThumbnailUri(null);
              setCaption('');
              setSelectedGroup('');
              setSelectedCategoryId('');
              setSelectedChallengeId(null);
              setIsVideoPlaying(false);
              setServerMediaUrl(null);
              setCapturedImageUri(null);
              setUploading(false);
              setUploadProgress(0);

              const isImagePost = createdType === 'image' || createdType === 'photo' || !createdType;
              const successBody = isImagePost
                ? 'Post uploaded successfully to the competition and is ready to view.'
                : 'Video uploaded to the competition. It is being processed for streaming; you will receive a notification when it is ready to watch.';

              Alert.alert('Post uploaded', successBody, [
                {
                  text: 'View challenge',
                  onPress: () => {
                    if (challengeIdToOpen) {
                      router.replace(`/challenges/${challengeIdToOpen}` as any);
                    } else {
                      router.back();
                    }
                  },
                },
                { text: 'Done', onPress: () => router.back() },
              ]);
            } else {
              const errorMsg = response.message || 'Failed to create post in challenge';
              await uploadNotificationService.showUploadError(errorMsg, fileName);
              Alert.alert('Upload Failed', errorMsg);
            }
          } catch (parseError) {
            console.error('[Upload] Error parsing response:', parseError);
            await uploadNotificationService.showUploadError('Failed to create post in challenge', fileName);
            Alert.alert('Upload Error', 'Failed to create post in competition. Please try again.');
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

      const autoTitle = caption.trim().substring(0, 50) || 'My Post';

      // ============================================================
      // VIDEO: Signed URL direct-to-R2 upload flow
      // Step 1: createUpload → Step 2: PUT to R2 → Step 3: completeUpload
      // ============================================================
      if (isVideo) {
        console.log('[Upload] Using signed URL flow for video');

        // Step 1: Get signed upload URL from backend
        updateProgress(22);

        const createRes = await postsApi.createUpload({
          title: autoTitle,
          caption: caption,
          post_category: categoryName,
          status: status,
        });

        if (createRes.status !== 'success' || !createRes.data?.uploadUrl) {
          throw new Error(createRes.message || 'Upload service is currently unavailable');
        }

        const { postId, uploadUrl } = createRes.data;
        console.log('[Upload] Got signed URL for post:', postId);

        // Step 2: Upload video directly to R2 via signed URL
        updateProgress(28);

        try {
          await uploadPreparedVideo(
            uploadUrl,
            mediaUri,
            (totalBytesSent, totalBytesExpectedToSend) => {
              if (totalBytesExpectedToSend > 0) {
                const rawPercent = totalBytesSent / totalBytesExpectedToSend;
                updateProgress(28 + rawPercent * 60);
              }
            }
          );
          console.log('[Upload] R2 upload complete (compressed/native upload)');
        } catch (uploadError: any) {
          console.error('[Upload] R2 upload failed:', uploadError.message);
          setUploading(false);
          setUploadProgress(0);
          await uploadNotificationService.showUploadError('Video upload failed: ' + uploadError.message, fileName);
          Alert.alert('Upload Error', 'Failed to upload video. Please try again.');
          return;
        }

        // Step 3: Notify backend upload is complete → queues HLS processing
        updateProgress(92);
        console.log('[Upload] Notifying backend upload complete for post:', postId);

        const completeRes = await postsApi.completeUpload(postId);

        if (completeRes.status !== 'success') {
          console.error('[Upload] Complete upload failed:', completeRes.message);
          setUploading(false);
          setUploadProgress(0);
          await uploadNotificationService.showUploadError('Failed to finish the upload.', fileName);
          Alert.alert('Error', 'Video upload finished, but the app could not finalize it. Please try again.');
          return;
        }

        let challengeLinkFailed = false;
        let challengeLinkErrorCode: string | undefined;
        let challengeLinkCap: number | undefined;
        if (effectiveSelectedChallengeId && status !== 'draft') {
          const linkRes = await challengesApi.addPostToChallenge(effectiveSelectedChallengeId, postId);
          if (linkRes.status !== 'success') {
            challengeLinkFailed = true;
            console.warn('[Upload] Failed to link uploaded post to challenge:', linkRes.message, (linkRes as any)?.code);

            challengeLinkErrorCode = (linkRes as any)?.code;
            if (challengeLinkErrorCode === 'MAX_CHALLENGE_POSTS_REACHED') {
              challengeLinkCap =
                Number((linkRes as any)?.data?.max_content_per_account) ||
                Number((linkRes as any)?.data?.challenge_max_content_per_account) ||
                Number((linkRes as any)?.data?.challenge_max_posts_per_account) ||
                5;
            }
          }
        }

        await videoReadyTracker.track(user.id, {
          postId,
          destination: status === 'draft' ? 'draft' : (effectiveSelectedChallengeId ? 'challenge' : 'post'),
          challengeId: effectiveSelectedChallengeId || undefined,
          challengeName: selectedChallengeName,
        });

        updateProgress(100);
        await uploadNotificationService.showUploadQueued(
          status === 'draft' ? 'draft' : (effectiveSelectedChallengeId ? 'challenge' : 'post'),
          selectedChallengeName
        );

        if (effectiveSelectedChallengeId && !challengeLinkFailed) {
          incrementChallengePostCount(effectiveSelectedChallengeId);
        }

        if (
          challengeLinkFailed &&
          challengeLinkErrorCode === 'MAX_CHALLENGE_POSTS_REACHED' &&
          effectiveSelectedChallengeId
        ) {
          setUploading(false);
          setUploadProgress(0);
          Alert.alert(
            'Competition Limit Reached',
            `Your content was uploaded but could not be linked to the competition because you've reached the maximum (${challengeLinkCap ?? 5} posts). What would you like to do?`,
            [
              {
                text: 'Keep on Main Feed',
                onPress: () => {
                  void cleanupPreparedVideo(preparedVideo);
                  resetComposerState();
                  router.replace('/(tabs)/profile');
                },
              },
              {
                text: 'Save as Draft',
                onPress: async () => {
                  try {
                    const response = await apiClient.put(`/api/posts/${postId}/status`, { status: 'draft' });
                    if (__DEV__) console.log('[Upload] Moved to draft:', response.status);
                  } catch { /* best effort */ }
                  void cleanupPreparedVideo(preparedVideo);
                  resetComposerState();
                  router.replace('/(tabs)/profile');
                },
              },
              {
                text: 'Delete Post',
                style: 'destructive',
                onPress: async () => {
                  try {
                    await postsApi.deletePost(postId);
                  } catch { /* best effort */ }
                  void cleanupPreparedVideo(preparedVideo);
                  resetComposerState();
                },
              },
            ],
            { cancelable: false },
          );
          return;
        }

        const successMessage = status === 'draft'
          ? 'Draft uploaded. You will be notified when it is ready.'
          : effectiveSelectedChallengeId
            ? challengeLinkFailed
              ? 'Video uploaded. It will appear on your profile when ready, but adding it to the competition failed.'
              : 'Video uploaded. You will be notified when the competition post is ready.'
            : 'Video uploaded. You will be notified when it is ready.';

        Alert.alert('Upload complete', successMessage, [
          {
            text: 'View profile',
            onPress: () => {
              void cleanupPreparedVideo(preparedVideo);
              resetComposerState();
              router.replace('/(tabs)/profile');
            }
          }
        ]);

        await cleanupPreparedVideo(preparedVideo);
        resetComposerState();
        return;
      }

      // ============================================================
      // IMAGE: Legacy multipart upload (images don't need HLS)
      // ============================================================
      console.log('[Upload] Using legacy multipart for image');
      await _legacyMultipartUpload(
        mediaUri, fileName, fileType, autoTitle, categoryName, status,
        fileData, getSelectedCategoryId(), uploadNotificationService,
        setUploading, setUploadProgress, setServerMediaUrl,
        setCaption, setSelectedGroup, setSelectedCategoryId as any,
        setRecordedVideoUri, setEditedVideoUri, setThumbnailUri, setIsVideoPlaying,
        setCapturedImageUri,
      );
    } catch (error: any) {
      await cleanupPreparedVideo(preparedVideo);
      setUploading(false);
      setUploadProgress(0);
      await uploadNotificationService.showUploadError(error.message || 'Failed to create post', 'video.mp4');
      Alert.alert('Error', error.message || 'Failed to create post. Please try again.');
    }
  };

  const currentVideoUri = editedVideoUri || recordedVideoUri;
  const currentMediaUri = currentVideoUri || capturedImageUri;

  const handlePlayPause = async () => {
    if (previewPlayer) {
      try {
        if (isVideoPlaying) {
          previewPlayer.pause();
          setIsVideoPlaying(false);
        } else {
          // Ensure audio plays in silent mode on iOS
          await Audio.setAudioModeAsync({
            allowsRecordingIOS: false,
            playsInSilentModeIOS: true,
            shouldDuckAndroid: false,
            playThroughEarpieceAndroid: false,
          });
          previewPlayer.muted = false;
          previewPlayer.play();
          setIsVideoPlaying(true);
        }
      } catch (e) {
        console.warn('[Preview] Play/pause error:', e);
      }
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
          style={[{ paddingVertical: 16, paddingHorizontal: 32, borderRadius: 12, marginBottom: 12, minWidth: 200, alignItems: 'center' }, { backgroundColor: C.card, borderWidth: 1, borderColor: C.primary }]}
          onPress={() => router.push('/auth/register')}
        >
          <Text style={[{ fontSize: 16, fontWeight: '600' }, { color: C.primary }]}>Sign Up</Text>
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

      {/* Pre-record info modal: 2-min limit, only when opening camera for video */}
      <Modal
        visible={showPreRecordInfoModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPreRecordInfoModal(false)}
      >
        <TouchableOpacity
          activeOpacity={1}
          style={styles.preRecordOverlay}
          onPress={() => setShowPreRecordInfoModal(false)}
        >
          <TouchableOpacity activeOpacity={1} onPress={() => {}} style={styles.preRecordCard}>
            <View style={styles.preRecordIconWrap}>
              <MaterialIcons name="videocam" size={48} color="#60a5fa" />
              <View style={styles.preRecordBadge}>
                <Text style={styles.preRecordBadgeText}>2 min max</Text>
              </View>
            </View>
            <Text style={styles.preRecordTitle}>Video recording limit</Text>
            <Text style={styles.preRecordMessage}>
              You can record up to <Text style={styles.preRecordHighlight}>2 minutes</Text> maximum. Recording will stop automatically at 2 minutes and you’ll be taken to add captions.
            </Text>
            <Text style={styles.preRecordHint}>You can stop earlier anytime.</Text>
            <TouchableOpacity
              style={styles.preRecordProceedButton}
              onPress={proceedToRecord}
              activeOpacity={0.85}
            >
              <MaterialIcons name="fiber-manual-record" size={22} color="#fff" />
              <Text style={styles.preRecordProceedText}>Proceed to record</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.preRecordCancelButton}
              onPress={() => setShowPreRecordInfoModal(false)}
            >
              <Text style={styles.preRecordCancelText}>Cancel</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* 2 minutes reached — notify then user continues to caption screen */}
      <Modal
        visible={showMaxDurationReachedModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowMaxDurationReachedModal(false)}
      >
        <View style={styles.maxDurationOverlay}>
          <View style={styles.maxDurationCard}>
            <View style={styles.maxDurationIconWrap}>
              <MaterialIcons name="timer" size={44} color="#f59e0b" />
            </View>
            <Text style={styles.maxDurationTitle}>2 minutes max reached</Text>
            <Text style={styles.maxDurationMessage}>
              Maximum recording time reached. Taking you to add captions and publish.
            </Text>
            <TouchableOpacity
              style={styles.maxDurationButton}
              onPress={() => setShowMaxDurationReachedModal(false)}
              activeOpacity={0.9}
            >
              <Text style={styles.maxDurationButtonText}>Continue</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Camera Modal */}
      {showCamera && (
        <View
          style={[styles.cameraContainer, { paddingTop: insets.top }]}
        >
          {isUsingVisionCameraVideo && visionCameraDevice ? (
            <VisionCamera
              key={`vision-camera-${cameraSessionKey}-${cameraFacing}`}
              ref={visionCameraRef}
              style={styles.camera}
              device={visionCameraDevice}
              isActive={showCamera && isAppActive}
              preview
              video
              audio={hasVisionMicrophonePermission}
              androidPreviewViewType="texture-view"
              outputOrientation="device"
              torch="off"
              zoom={1}
              onInitialized={() => {
                console.log('[VisionCamera] Session initialized');
              }}
              onPreviewStarted={() => {
                console.log('[VisionCamera] Preview started');
                setIsCameraReady(true);
              }}
              onError={(error: any) => {
                console.error('[VisionCamera] Mount/runtime error:', error);
                try {
                  const Sentry = require('@sentry/react-native');
                  Sentry.captureException(new Error(`VisionCamera error: ${error?.message || JSON.stringify(error)}`));
                } catch {}
                Alert.alert(
                  'Camera Error',
                  'The camera could not start on this device. Please try closing other apps or restart the app.',
                  [{ text: 'Close Camera', onPress: cancelCamera }],
                );
              }}
            />
          ) : (
            <CameraView
              key={`camera-${cameraSessionKey}-${cameraMode}-${cameraFacing}`}
              ref={cameraRef}
              style={styles.camera}
              facing={cameraFacing}
              mode={cameraMode}
              zoom={0}
              mirror={cameraFacing === 'front'}
              mute={cameraMode === 'video' && !microphonePermission?.granted}
              enableTorch={false}
              flash="off"
              onCameraReady={() => {
                console.log('[Camera] Camera is ready');
                setIsCameraReady(true);
              }}
              onMountError={(error: any) => {
                console.error('[Camera] Mount error:', error);
                try {
                  const Sentry = require('@sentry/react-native');
                  Sentry.captureException(new Error(`Camera mount error: ${error?.message || JSON.stringify(error)}`));
                } catch {}
                Alert.alert(
                  'Camera Error',
                  'The camera could not start on this device. Please try closing other apps or restart the app.',
                  [{ text: 'Close Camera', onPress: cancelCamera }],
                );
              }}
            />
          )}

          {!isCameraReady && (
            <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center', zIndex: 50 }}>
              <ActivityIndicator size="large" color="#60a5fa" />
              <Text style={{ color: '#fff', marginTop: 16, fontSize: 15, fontWeight: '600' }}>Starting camera...</Text>
              <Text style={{ color: '#9ca3af', marginTop: 6, fontSize: 13, textAlign: 'center', paddingHorizontal: 40 }}>
                If this takes too long, try closing other apps or tap Close below.
              </Text>
              <TouchableOpacity
                style={{ marginTop: 24, paddingVertical: 10, paddingHorizontal: 24, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 10 }}
                onPress={cancelCamera}
              >
                <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>Close Camera</Text>
              </TouchableOpacity>
            </View>
          )}

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
              {cameraMode === 'video' && (
                <Text style={styles.recordLimitHint}>
                </Text>
              )}
              <View style={styles.cameraBottomControls}>
                <TouchableOpacity
                  style={styles.cameraModeButton}
                  onPress={() => {
                    const nextMode = cameraMode === 'video' ? 'picture' : 'video';
                    void ensureCameraPermissions(nextMode);
                  }}
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

      {/* STAGE 1: FULL STUDIO (CAMERA) – NO FORMS - fixed header so content stays below status bar */}
      {!currentVideoUri && !capturedImageUri && (
        <View style={{ flex: 1, backgroundColor: C.background }}>
          <View style={[styles.createFixedHeader, { paddingTop: insets.top + 8, paddingBottom: 12, borderBottomColor: C.border, backgroundColor: C.background }]}>
            <Text style={[styles.createFixedHeaderTitle, { color: C.text }]}>Studio</Text>
          </View>
          <View style={[styles.studioContainer, { flex: 1 }]}>
            <View style={styles.studioHeader}>
              <Text style={[styles.studioSubtitle, { color: C.textSecondary }]}>
                Record a video up to 2 minutes maximum or take a picture. Add details after.
              </Text>
            </View>

          <View style={styles.studioBody}>
            <MaterialIcons name="videocam" size={72} color={C.primary} />
              <Text style={[styles.studioHint, { color: C.textSecondary }]}>
              {shouldUseVisionCameraVideo
                ? 'Using the in-app Android 13 video camera with native recording'
                : 'Camera opens automatically'}
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
        </View>
      )}

      {/* STAGE 2: DETAILS FORM (AFTER MEDIA CONFIRMED) - fixed header so content scrolls under it */}
      {currentMediaUri && (
        <View style={{ flex: 1, backgroundColor: C.background }}>
          <View style={[styles.createFixedHeader, { paddingTop: insets.top + 8, paddingBottom: 12, borderBottomColor: C.border, backgroundColor: C.background }]}>
            <Text style={[styles.createFixedHeaderTitle, { color: C.text }]}>New Post</Text>
          </View>
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
          >
            <ScrollView
              style={[styles.scrollView, { backgroundColor: C.background }]}
              contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
              nestedScrollEnabled={true}
            >
              <View style={styles.videoPreviewSection}>
              <View style={styles.videoPreviewContainer}>
                {currentVideoUri ? (
                  <>
                    <VideoView
                      player={previewPlayer}
                      style={styles.videoPlayer}
                      contentFit="cover"
                      nativeControls={false}
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
                        setTimeout(() => {
                          setCapturedImageUri(null);
                        }, 100);
                        void ensureCameraPermissions('picture');
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
                      if (uploading) {
                        Alert.alert(
                          'Discard anyway?',
                          'Upload in progress. Discard will cancel and clear this post.',
                          [
                            { text: 'Cancel', style: 'cancel' },
                            { text: 'Discard', style: 'destructive', onPress: () => resetComposerState() },
                          ]
                        );
                      } else {
                        Alert.alert(
                          'Discard Post?',
                          'Are you sure you want to discard this post?',
                          [
                            { text: 'Cancel', style: 'cancel' },
                            { text: 'Discard', style: 'destructive', onPress: () => resetComposerState() },
                          ]
                        );
                      }
                    }}
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
                    placeholder="Describe your content... 🎬 What makes this special? Add #hashtags"
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
                    autoComplete="off"
                    importantForAutofill="noExcludeDescendants"
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
                        {getSelectedCategoryDisplayName()}
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
                  ) : categoriesFetchFailed ? (
                    <TouchableOpacity
                      style={{ paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 8 }}
                      onPress={() => loadCategoriesRef.current?.()}
                    >
                      <MaterialIcons name="refresh" size={18} color={C.primary} />
                      <Text style={{ color: C.primary, fontSize: 13, fontWeight: '600' }}>
                        Unable to load categories. Tap to retry.
                      </Text>
                    </TouchableOpacity>
                  ) : (
                    <View style={{ paddingVertical: 8 }}>
                      <Text style={{ color: C.textSecondary, fontSize: 13 }}>
                        No categories available.
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
                                {getCategoryDisplayName(cat.name)}
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

                {showBeautySafetyNotice && (
                  <View
                    style={[
                      styles.warningBanner,
                      {
                        backgroundColor: C.warningBg,
                        borderColor: C.warningBorder,
                        marginTop: 12,
                      },
                    ]}
                  >
                    <View style={styles.warningBannerHeader}>
                      <MaterialIcons name="warning-amber" size={20} color={C.warning} />
                      <Text style={[styles.warningBannerTitle, { color: C.warning }]}>
                        Beauty Category Notice
                      </Text>
                    </View>
                    <Text style={[styles.warningBannerText, { color: C.text }]}>
                      {BEAUTY_CONTENT_WARNING}
                    </Text>
                  </View>
                )}

                {(recordedVideoUri || capturedImageUri) && (
                  <View style={styles.inputGroup}>
                    {loadingChallenges ? (
                      <View style={{ paddingVertical: 12 }}>
                        <Text style={[styles.subLabel, { color: C.textSecondary, marginBottom: 10 }]}>
                          Loading competitions...
                        </Text>
                        {[1, 2, 3].map((i) => (
                          <View
                            key={`chall-skel-${i}`}
                            style={{
                              height: 44,
                              borderRadius: 12,
                              backgroundColor: C.inputBg,
                              marginBottom: 8,
                              opacity: 1 - i * 0.2,
                            }}
                          />
                        ))}
                      </View>
                    ) : challengesFetchFailed ? (
                      <View style={{ paddingVertical: 12, alignItems: 'center' }}>
                        <Text style={[styles.subLabel, { color: C.textSecondary, marginBottom: 8, textAlign: 'center' }]}>
                          Unable to load competitions. Check your connection.
                        </Text>
                        <TouchableOpacity
                          style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 16, backgroundColor: C.primary, borderRadius: 8 }}
                          onPress={() => loadJoinedChallengesRef.current()}
                        >
                          <MaterialIcons name="refresh" size={18} color="#fff" />
                          <Text style={{ color: '#fff', marginLeft: 6, fontWeight: '600', fontSize: 14 }}>Retry</Text>
                        </TouchableOpacity>
                      </View>
                    ) : isChallengeOnlyFlow ? (
                      <View style={styles.challengeSelectionStack}>
                        <Text style={[styles.subLabel, styles.challengeListLabel, { color: C.textSecondary }]}>
                          Posting to this competition
                        </Text>
                        <View
                          style={[
                            styles.challengePrimaryAction,
                            styles.challengeLockedCard,
                            { borderColor: C.primary, backgroundColor: C.card },
                          ]}
                        >
                          <View style={styles.challengeLockedHeader}>
                            <MaterialIcons name="emoji-events" size={18} color={C.primary} />
                            <Text style={[styles.challengePrimaryActionText, { color: C.text }]}>
                              {forcedChallengeName || 'Competition'}
                            </Text>
                          </View>
                          <Text style={[styles.challengePrimaryActionHint, { color: C.textSecondary }]}>
                            This post will be submitted only to the competition you opened.
                          </Text>
                        </View>
                      </View>
                    ) : joinedChallenges.length > 0 ? (
                      <>
                        <View style={styles.labelRow}>

                          
                        </View>

                        <View style={styles.challengeSelectionStack}>
                          <View
                            style={{
                              borderWidth: 1,
                              borderColor: C.border,
                              backgroundColor: C.card,
                              borderRadius: 12,
                              padding: 12,
                              marginBottom: 12,
                            }}
                          >
                            <Text style={[styles.subLabel, { color: C.textSecondary, marginBottom: 8, fontWeight: '700' }]}>
                              Step 1 of 2: Choose destination
                            </Text>

                            <TouchableOpacity
                              style={{
                                borderWidth: 1,
                                borderColor: !effectiveSelectedChallengeId ? C.primary : C.border,
                                backgroundColor: !effectiveSelectedChallengeId ? `${C.primary}20` : 'transparent',
                                borderRadius: 10,
                                paddingVertical: 10,
                                paddingHorizontal: 12,
                                marginBottom: 8,
                                flexDirection: 'row',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                              }}
                              onPress={() => setSelectedChallengeId(null)}
                            >
                              <View style={{ flex: 1, paddingRight: 8 }}>
                                <Text style={{ color: C.text, fontSize: 14, fontWeight: '700' }}>Main Feed</Text>
                                <Text style={{ color: C.textSecondary, fontSize: 12 }}>
                                  Post normally without linking to a competition
                                </Text>
                              </View>
                              <MaterialIcons
                                name={!effectiveSelectedChallengeId ? 'radio-button-checked' : 'radio-button-unchecked'}
                                size={20}
                                color={!effectiveSelectedChallengeId ? C.primary : C.textSecondary}
                              />
                            </TouchableOpacity>

                            <Text style={{ color: C.textSecondary, fontSize: 16, marginBottom: 8, marginTop: 20, fontWeight: '700' }}>
                              Or choose one joined competition below:
                            </Text>
                          </View>

                          <View style={styles.competitionOptionsGrid}>
                            {joinedChallenges.map((challenge: any) => {
                              const info = challengePostCounts[challenge.id];
                              const isFull = info ? info.count >= info.max : false;
                              const isSelected = effectiveSelectedChallengeId === challenge.id;
                              return (
                                <TouchableOpacity
                                  key={challenge.id}
                                  style={[
                                    styles.competitionOptionCard,
                                    { borderColor: C.border, backgroundColor: C.card },
                                    isSelected && !isFull && { borderColor: C.primary, backgroundColor: `${C.primary}20` },
                                    isFull && { borderColor: C.warning, backgroundColor: `${C.warning}18` },
                                  ]}
                                  onPress={async () => {
                                    const latestInfo = await ensureChallengePostCount(challenge, { force: true });
                                    const resolvedInfo = latestInfo ?? challengePostCounts[challenge.id] ?? info;
                                    const resolvedIsFull = resolvedInfo ? resolvedInfo.count >= resolvedInfo.max : false;

                                    if (resolvedIsFull) {
                                      setMaxReachedContext({
                                        challengeName: challenge.name || 'this competition',
                                        max: resolvedInfo?.max ?? 5,
                                      });
                                      setShowPostActionModal(true);
                                      return;
                                    }

                                    setSelectedChallengeId(challenge.id);
                                  }}
                                >
                                  <View style={{ flex: 1, minWidth: 0 }}>
                                    <Text style={[styles.competitionOptionTitle, { color: C.text }]} numberOfLines={1}>
                                      {challenge.name}
                                    </Text>
                                    <Text style={[styles.competitionOptionMeta, { color: C.textSecondary }]}>
                                      {info
                                        ? `${info.count}/${info.max} submitted`
                                        : `Up to ${Number(challenge.max_content_per_account ?? challenge.min_content_per_account) || 5} posts`}
                                    </Text>
                                  </View>
                                  <View style={[styles.competitionOptionBadge, { backgroundColor: isFull ? `${C.warning}30` : isSelected ? `${C.primary}25` : `${C.border}66` }]}>
                                    <Text style={[styles.competitionOptionBadgeText, { color: isFull ? C.warning : isSelected ? C.primary : C.textSecondary }]}>
                                      {isFull ? 'Full' : isSelected ? 'Selected' : 'Use'}
                                    </Text>
                                  </View>
                                </TouchableOpacity>
                              );
                            })}
                          </View>

                          <Text style={[styles.subLabel, { color: C.textSecondary, marginTop: 8 }]}>
                            Step 2 of 2: Use the submit buttons below (Publish, Save Draft, or Discard).
                          </Text>
                        </View>
                      </>
                    ) : (
                      <View style={{ paddingVertical: 8 }}>
                        <Text style={[styles.subLabel, { color: C.textSecondary }]}>
                          No Competitions joined yet. Join a Competition to post in it.
                        </Text>
                        <TouchableOpacity
                          style={{
                            marginTop: 12,
                            flexDirection: 'row',
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: C.primary,
                            borderRadius: 12,
                            paddingVertical: 12,
                            paddingHorizontal: 16,
                            alignSelf: 'flex-start',
                          }}
                          onPress={openJoinCompetitionModal}
                          accessibilityRole="button"
                          accessibilityLabel="Join competition"
                        >
                          <Feather name="plus-circle" size={18} color="#fff" />
                          <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700', marginLeft: 8 }}>
                            Join Competition
                          </Text>
                        </TouchableOpacity>
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

              {/* ── Submit actions section ── */}
              <View style={styles.submitSectionContainer}>
                <View style={styles.submitSectionDivider}>
                  <View style={{ flex: 1, height: 1, backgroundColor: C.border }} />
                  <Text style={{ color: C.textSecondary, fontSize: 13, fontWeight: '700', marginHorizontal: 12, letterSpacing: 0.5, textTransform: 'uppercase' }}>
                    {effectiveSelectedChallengeId ? 'Submit' : 'How would you like to submit?'}
                  </Text>
                  <View style={{ flex: 1, height: 1, backgroundColor: C.border }} />
                </View>

                {effectiveSelectedChallengeId && isMaxPostsReached && (
                  <View style={[styles.maxPostsBanner, { backgroundColor: C.warningBg, borderColor: C.warningBorder }]}>
                    <MaterialIcons name="info-outline" size={18} color={C.warning} />
                    <Text style={{ color: C.warning, fontSize: 13, flex: 1, marginLeft: 8 }}>
                      You've reached the maximum posts for this competition ({challengePostCounts[effectiveSelectedChallengeId]?.max ?? 5}). Choose another competition or publish to the main feed.
                    </Text>
                  </View>
                )}

                {effectiveSelectedChallengeId ? (
                  <View style={styles.quickActionButtonsContainer}>
                    <TouchableOpacity
                    style={[styles.quickActionButton, styles.quickPublishButton, (uploading || isMaxPostsReached) && styles.quickActionButtonDisabled]}
                      onPress={() => {
                      if (isMaxPostsReached) {
                        const info = challengePostCounts[effectiveSelectedChallengeId];
                        const selectedChallenge = joinedChallenges.find((c: any) => c.id === effectiveSelectedChallengeId);
                        setMaxReachedContext({
                          challengeName: selectedChallenge?.name || 'this competition',
                          max: info?.max ?? 5,
                        });
                          setShowPostActionModal(true);
                          return;
                        }
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
                      accessibilityLabel="Post to competition"
                      accessibilityRole="button"
                    >
                      {uploading ? (
                        <ActivityIndicator color="#fff" size="small" />
                      ) : (
                        <>
                          <MaterialIcons name="emoji-events" size={20} color="#fff" />
                          <Text style={styles.quickActionButtonText}>Post to Competition</Text>
                        </>
                      )}
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.quickActionButton, styles.quickDraftButton, uploading && styles.quickActionButtonDisabled]}
                      onPress={async () => {
                        if (!caption.trim() && !selectedGroup) {
                          showToast('Please add a caption and select a category');
                        } else if (!caption.trim()) {
                          showToast('Caption is required');
                        } else if (!selectedGroup) {
                          showToast('Please select a category group');
                        } else if (!selectedCategoryId) {
                          showToast('Please select a specific category');
                        } else {
                          setSelectedChallengeId(null);
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
                          uploading ? 'Discard anyway?' : 'Discard Post?',
                          uploading
                            ? 'Upload in progress. Discard will cancel and clear this post.'
                            : 'Are you sure you want to discard this post? This action cannot be undone.',
                          [
                            { text: 'Cancel', style: 'cancel' },
                            { text: 'Discard', style: 'destructive', onPress: () => resetComposerState() },
                          ]
                        );
                      }}
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
                          uploading ? 'Discard anyway?' : 'Discard Post?',
                          uploading
                            ? 'Upload in progress. Discard will cancel and clear this post.'
                            : 'Are you sure you want to discard this post? This action cannot be undone.',
                          [
                            { text: 'Cancel', style: 'cancel' },
                            { text: 'Discard', style: 'destructive', onPress: () => resetComposerState() },
                          ]
                        );
                      }}
                      accessibilityLabel="Discard post"
                      accessibilityRole="button"
                    >
                      <MaterialIcons name="delete-outline" size={20} color="#fff" />
                      <Text style={styles.quickActionButtonText}>Discard</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>

              <View style={{ height: insets.bottom + 20 }} />
            </View>
          </ScrollView>
          </KeyboardAvoidingView>
        </View>
      )}

      <Modal visible={joinCompetitionModalVisible} transparent animationType="slide">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: '#18181b', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: Math.max(insets.bottom + 20, 28), maxHeight: '72%' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={{ color: '#fff', fontSize: 20, fontWeight: '800' }}>Join Competition</Text>
                <Text style={{ color: '#9ca3af', fontSize: 13, marginTop: 4 }}>
                  Join here and continue uploading this same content without losing it.
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setJoinCompetitionModalVisible(false)}
                style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#27272a' }}
              >
                <Feather name="x" size={18} color="#fff" />
              </TouchableOpacity>
            </View>

            {loadingAvailableChallenges ? (
              <View style={{ paddingVertical: 24, alignItems: 'center' }}>
                <ActivityIndicator color={C.primary} />
                <Text style={{ color: '#9ca3af', marginTop: 12 }}>Loading competitions...</Text>
              </View>
            ) : availableChallenges.length === 0 ? (
              <View style={{ paddingVertical: 24, alignItems: 'center' }}>
                <MaterialIcons name="emoji-events" size={36} color="#6b7280" />
                <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700', marginTop: 12 }}>No joinable competitions right now</Text>
                <Text style={{ color: '#9ca3af', fontSize: 13, textAlign: 'center', marginTop: 6, lineHeight: 19 }}>
                  New competitions will appear here as soon as they are open for participation.
                </Text>
              </View>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false}>
                {availableChallenges.map((challenge: any) => (
                  <View
                    key={challenge.id}
                    style={{
                      borderWidth: 1,
                      borderColor: '#27272a',
                      backgroundColor: '#111827',
                      borderRadius: 16,
                      padding: 14,
                      marginBottom: 12,
                    }}
                  >
                    <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }} numberOfLines={1}>
                      {challenge.name}
                    </Text>
                    {!!challenge.description && (
                      <Text style={{ color: '#9ca3af', fontSize: 12, lineHeight: 18, marginTop: 6 }} numberOfLines={2}>
                        {challenge.description}
                      </Text>
                    )}
                    <Text style={{ color: '#9ca3af', fontSize: 12, marginTop: 8 }}>
                      Up to {Number(challenge.max_content_per_account ?? challenge.min_content_per_account) || 5} posts
                    </Text>
                    <TouchableOpacity
                      style={{
                        marginTop: 12,
                        backgroundColor: joiningCompetitionId === String(challenge.id) ? '#1d4ed8' : C.primary,
                        borderRadius: 12,
                        paddingVertical: 11,
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexDirection: 'row',
                      }}
                      onPress={() => void handleJoinCompetitionFromCreate(challenge)}
                      disabled={joiningCompetitionId === String(challenge.id)}
                    >
                      {joiningCompetitionId === String(challenge.id) ? (
                        <ActivityIndicator color="#fff" size="small" />
                      ) : (
                        <>
                          <Feather name="plus-circle" size={16} color="#fff" />
                          <Text style={{ color: '#fff', fontWeight: '700', marginLeft: 8 }}>Join and Continue</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* Post Action Modal: shown when max competition posts reached */}
      <Modal visible={showPostActionModal} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <View style={{ backgroundColor: '#18181b', borderRadius: 20, padding: 24, width: '100%', maxWidth: 340, alignItems: 'center' }}>
            <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(245,158,11,0.15)', justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
              <MaterialIcons name="warning-amber" size={32} color="#f59e0b" />
            </View>
            <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700', textAlign: 'center', marginBottom: 8 }}>
              Competition Limit Reached
            </Text>
            <Text style={{ color: '#9ca3af', fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 24 }}>
              You've reached the maximum number of posts for "{maxReachedContext?.challengeName || 'this competition'}" ({maxReachedContext?.max ?? challengePostCounts[effectiveSelectedChallengeId ?? '']?.max ?? 5}). What would you like to do with this content?
            </Text>

            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#60a5fa', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 20, width: '100%', marginBottom: 10 }}
              onPress={() => {
                setShowPostActionModal(false);
                setSelectedChallengeId(null);
                if (!caption.trim() || !selectedGroup || !selectedCategoryId) {
                  showToast('Please fill in caption and category first');
                  return;
                }
                handleCreatePost('active');
              }}
            >
              <MaterialIcons name="public" size={20} color="#fff" />
              <Text style={{ color: '#fff', fontSize: 15, fontWeight: '600', marginLeft: 8 }}>Publish to Main Feed</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#374151', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 20, width: '100%', marginBottom: 10 }}
              onPress={() => {
                setShowPostActionModal(false);
                setSelectedChallengeId(null);
                if (!caption.trim() || !selectedGroup || !selectedCategoryId) {
                  showToast('Please fill in caption and category first');
                  return;
                }
                handleCreatePost('draft');
              }}
            >
              <MaterialIcons name="save" size={20} color="#fff" />
              <Text style={{ color: '#fff', fontSize: 15, fontWeight: '600', marginLeft: 8 }}>Save as Draft</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#7f1d1d', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 20, width: '100%', marginBottom: 4 }}
              onPress={() => {
                setShowPostActionModal(false);
                resetComposerState();
              }}
            >
              <MaterialIcons name="delete-outline" size={20} color="#fca5a5" />
              <Text style={{ color: '#fca5a5', fontSize: 15, fontWeight: '600', marginLeft: 8 }}>Discard</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={{ paddingVertical: 10, marginTop: 4 }}
              onPress={() => setShowPostActionModal(false)}
            >
              <Text style={{ color: '#6b7280', fontSize: 13 }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={draftReplaceModalVisible} transparent animationType="slide">
        <TouchableOpacity
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}
          activeOpacity={1}
          onPress={() => setDraftReplaceModalVisible(false)}
        >
          <View style={{ backgroundColor: '#18181b', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 40 }}>
            <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 4 }}>
              Maximum Drafts Reached
            </Text>
            <Text style={{ color: '#9ca3af', fontSize: 14, marginBottom: 16 }}>
              You can only have {MAX_DRAFTS} drafts. Choose one to replace:
            </Text>
            {existingDrafts.map((draft: any) => (
              <TouchableOpacity
                key={draft.id}
                style={{
                  flexDirection: 'row', alignItems: 'center', padding: 12,
                  backgroundColor: '#232326', borderRadius: 12, marginBottom: 8,
                }}
                onPress={async () => {
                  setDraftReplaceModalVisible(false);
                  try {
                    await postsApi.deletePost(draft.id);
                    await handleCreatePost(pendingDraftStatus);
                  } catch (e) {
                    showToast('Failed to replace draft. Try again.');
                  }
                }}
              >
                <View style={{ width: 48, height: 48, borderRadius: 8, backgroundColor: '#1a1a1a', justifyContent: 'center', alignItems: 'center', marginRight: 12 }}>
                  <Feather name={draft.type === 'video' ? 'video' : 'image'} size={20} color="#60a5fa" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }} numberOfLines={1}>
                    {draft.caption || draft.title || draft.description || 'Untitled draft'}
                  </Text>
                  <Text style={{ color: '#9ca3af', fontSize: 12, marginTop: 2 }}>
                    {draft.createdAt ? new Date(draft.createdAt).toLocaleDateString() : 'Unknown date'}
                  </Text>
                </View>
                <Feather name="trash-2" size={18} color="#ef4444" />
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={{ alignItems: 'center', paddingVertical: 14, marginTop: 4 }}
              onPress={() => setDraftReplaceModalVisible(false)}
            >
              <Text style={{ color: '#9ca3af', fontSize: 15, fontWeight: '600' }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

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
  createFixedHeader: {
    paddingHorizontal: 16,
    backgroundColor: 'transparent',
    borderBottomWidth: 1,
  },
  createFixedHeaderTitle: {
    fontSize: 18,
    fontWeight: '700',
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
    marginBottom: 32,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
    marginTop: 20,
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
  challengePillRow: {
    paddingHorizontal: 4,
    paddingBottom: 4,
  },
  competitionOptionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 2,
  },
  competitionOptionCard: {
    minWidth: 150,
    flexGrow: 1,
    flexBasis: '46%',
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  competitionOptionTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  competitionOptionMeta: {
    fontSize: 12,
    marginTop: 2,
  },
  competitionOptionBadge: {
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 8,
    alignSelf: 'center',
  },
  competitionOptionBadgeText: {
    fontSize: 11,
    fontWeight: '700',
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
  preRecordOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  preRecordCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 24,
    padding: 28,
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  preRecordIconWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: 'rgba(96, 165, 250, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    position: 'relative',
  },
  preRecordBadge: {
    position: 'absolute',
    bottom: -6,
    backgroundColor: '#60a5fa',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  preRecordBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  preRecordTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 12,
    textAlign: 'center',
  },
  preRecordMessage: {
    color: '#d1d5db',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 10,
    paddingHorizontal: 8,
  },
  preRecordHighlight: {
    color: '#60a5fa',
    fontWeight: '700',
  },
  preRecordHint: {
    color: '#9ca3af',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginBottom: 24,
    paddingHorizontal: 4,
  },
  preRecordProceedButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#60a5fa',
    paddingVertical: 16,
    paddingHorizontal: 28,
    borderRadius: 14,
    width: '100%',
    gap: 10,
    marginBottom: 12,
  },
  preRecordProceedText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  preRecordCancelButton: {
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  preRecordCancelText: {
    color: '#9ca3af',
    fontSize: 15,
    fontWeight: '500',
  },
  maxDurationOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  maxDurationCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 24,
    padding: 28,
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  maxDurationIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  maxDurationTitle: {
    color: '#fff',
    fontSize: 19,
    fontWeight: '700',
    marginBottom: 10,
    textAlign: 'center',
  },
  maxDurationMessage: {
    color: '#d1d5db',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 24,
    paddingHorizontal: 8,
  },
  maxDurationButton: {
    backgroundColor: '#f59e0b',
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 14,
    width: '100%',
  },
  maxDurationButtonText: {
    color: '#000',
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
  },
  recordLimitHint: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.85)',
    textAlign: 'center',
    marginBottom: 10,
    paddingHorizontal: 16,
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
    marginBottom: 10,
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
    marginBottom: 40,
    marginTop: 6,
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
    marginTop: 20,
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
  challengeSelectionStack: {
    gap: 18,
  },
  challengeIntroText: {
    marginBottom: 18,
  },
  challengePrimaryAction: {
    marginTop: 20,
    borderWidth: 1,
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  challengeLockedCard: {
    marginTop: 0,
  },
  challengeLockedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  challengePrimaryActionText: {
    fontSize: 15,
    fontWeight: '700',
  },
  challengePrimaryActionHint: {
    fontSize: 12,
    marginTop: 6,
    lineHeight: 17,
  },
  challengeOrRow: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
    marginBottom: 2,
  },
  challengeOrText: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.4,
  },
  challengeListLabel: {
    marginTop: 12,
    marginBottom: 6,
    fontSize: 16,
  },
  warningBanner: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginBottom: 8,
    marginTop: -50,
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
  submitSectionContainer: {
    marginTop: 16,
    paddingTop: 4,
  },
  submitSectionDivider: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 16,
    marginBottom: 14,
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
  maxPostsBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 10,
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
