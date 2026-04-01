import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { Post } from '@/types';
import { getFileUrl, getPostMediaUrl } from '@/lib/utils/file-url';
import { getPostVideoAssetsCached } from '@/lib/post-video-assets-cache';

type DownloadProgress = {
  progress: number;
  totalBytesWritten: number;
  totalBytesExpected: number;
};

type DownloadableMedia = {
  url: string;
  extension: string;
  mediaType: 'image' | 'video';
};

type MediaLibraryModule = {
  isAvailableAsync: () => Promise<boolean>;
  getPermissionsAsync: (writeOnly?: boolean, granularPermissions?: string[]) => Promise<any>;
  requestPermissionsAsync: (writeOnly?: boolean, granularPermissions?: string[]) => Promise<any>;
  saveToLibraryAsync: (localUri: string) => Promise<void>;
};

function getExtensionFromUrl(url: string, fallback: string): string {
  const cleanUrl = url.split('?')[0];
  const match = cleanUrl.match(/\.([a-z0-9]{3,5})$/i);
  return match?.[1]?.toLowerCase() || fallback;
}

async function resolveDownloadableMedia(post: Post): Promise<DownloadableMedia | null> {
  const isVideo = post.type === 'video' || post.mediaType === 'video';

  if (!isVideo) {
    const imageUrl = getPostMediaUrl(post);
    if (!imageUrl) {
      return null;
    }

    return {
      url: imageUrl,
      extension: getExtensionFromUrl(imageUrl, 'jpg'),
      mediaType: 'image',
    };
  }

  const videoAssets = post.id ? await getPostVideoAssetsCached(post.id) : null;
  const rawVideoUrl = getFileUrl(
    videoAssets?.video_url ||
      videoAssets?.videoUrl ||
      post.video_url ||
      post.videoUrl ||
      '',
  );

  if (!rawVideoUrl) {
    return null;
  }

  return {
    url: rawVideoUrl,
    extension: getExtensionFromUrl(rawVideoUrl, 'mp4'),
    mediaType: 'video',
  };
}

function getPermissionMessage(permission: any, mediaType: DownloadableMedia['mediaType']): string {
  if (permission?.canAskAgain === false) {
    return `Allow Talentix to save ${mediaType === 'video' ? 'videos' : 'images'} in your device settings, then try again.`;
  }

  return `Storage permission is required to save this ${mediaType === 'video' ? 'video' : 'image'} to your device.`;
}

async function ensureLibraryPermission(
  MediaLibrary: MediaLibraryModule,
  mediaType: DownloadableMedia['mediaType'],
) {
  const granularPermissions = Platform.OS === 'android'
    ? [mediaType === 'video' ? 'video' : 'photo']
    : undefined;

  const existingPermission = await MediaLibrary.getPermissionsAsync(true, granularPermissions);
  if (existingPermission?.granted) {
    return existingPermission;
  }

  const requestedPermission = await MediaLibrary.requestPermissionsAsync(true, granularPermissions);
  if (requestedPermission?.granted) {
    return requestedPermission;
  }

  throw new Error(getPermissionMessage(requestedPermission, mediaType));
}

function getMediaLibraryModule(): MediaLibraryModule | null {
  try {
    // Load lazily so app boot never crashes when the current dev client
    // does not include ExpoMediaLibrary yet.
    return require('expo-media-library');
  } catch {
    return null;
  }
}

export async function downloadPostToLibrary(
  post: Post,
  callbacks?: {
    onProgress?: (progress: DownloadProgress) => void;
  },
) {
  const downloadable = await resolveDownloadableMedia(post);
  if (!downloadable) {
    throw new Error('This post is not ready for download yet.');
  }

  const MediaLibrary = getMediaLibraryModule();
  if (!MediaLibrary) {
    throw new Error('This app build is missing the download module. Rebuild the app to save posts locally.');
  }

  const isAvailable = await MediaLibrary.isAvailableAsync();
  if (!isAvailable) {
    throw new Error('Saving to the device library is not available on this device.');
  }

  await ensureLibraryPermission(MediaLibrary, downloadable.mediaType);

  const localUri = `${FileSystem.cacheDirectory}talentix_${post.id}_${Date.now()}.${downloadable.extension}`;
  const resumable = FileSystem.createDownloadResumable(
    downloadable.url,
    localUri,
    {},
    (state) => {
      callbacks?.onProgress?.({
        progress:
          state.totalBytesExpectedToWrite > 0
            ? state.totalBytesWritten / state.totalBytesExpectedToWrite
            : 0,
        totalBytesWritten: state.totalBytesWritten,
        totalBytesExpected: state.totalBytesExpectedToWrite,
      });
    },
  );

  const result = await resumable.downloadAsync();
  if (!result?.uri) {
    throw new Error('Failed to download the post.');
  }
  await MediaLibrary.saveToLibraryAsync(result.uri);

  return {
    asset: null,
    mediaType: downloadable.mediaType,
  };
}
