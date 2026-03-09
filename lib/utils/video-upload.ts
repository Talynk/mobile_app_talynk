import * as FileSystem from 'expo-file-system/legacy';
import {
  Video as CompressorVideo,
  backgroundUpload,
  createVideoThumbnail,
  getRealPath,
  getVideoMetaData,
  UploaderHttpMethod,
  UploadType,
} from 'react-native-compressor';

const COMPRESS_IF_LARGER_THAN_BYTES = 4 * 1024 * 1024;
const COMPRESS_IF_LONGER_THAN_SECONDS = 15;
const MAX_VIDEO_DIMENSION = 1280;
const MAX_UPLOAD_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1250;

type FileInfoWithSize = {
  exists: boolean;
  size?: number;
};

export type PreparedVideoAsset = {
  originalUri: string;
  uploadUri: string;
  fileName: string;
  mimeType: 'video/mp4';
  thumbnailUri?: string;
  didCompress: boolean;
  originalSizeBytes: number;
  uploadSizeBytes: number;
  durationSeconds: number;
};

function ensureFileUri(uri: string): string {
  if (!uri) return uri;
  if (uri.startsWith('file://') || uri.startsWith('content://') || uri.startsWith('http')) {
    return uri;
  }
  return `file://${uri}`;
}

function getFileNameFromUri(uri: string): string {
  const base = uri.split('/').pop() || `video-${Date.now()}.mp4`;
  return base.toLowerCase().endsWith('.mp4') ? base : `${base.replace(/\.[^/.]+$/, '')}.mp4`;
}

async function getSafeFileInfo(uri: string): Promise<FileInfoWithSize> {
  try {
    return await FileSystem.getInfoAsync(uri) as FileInfoWithSize;
  } catch {
    return { exists: false };
  }
}

async function getSafeVideoMetaData(uri: string) {
  try {
    return await getVideoMetaData(uri);
  } catch {
    return null;
  }
}

function shouldCompressVideo(
  uri: string,
  fileInfo: FileInfoWithSize,
  metaData: Awaited<ReturnType<typeof getSafeVideoMetaData>>
): boolean {
  const extension = uri.split('.').pop()?.toLowerCase() || '';
  const fileSize = fileInfo.size || 0;
  const duration = metaData?.duration || 0;
  const largestDimension = Math.max(metaData?.width || 0, metaData?.height || 0);

  return (
    extension !== 'mp4' ||
    fileSize >= COMPRESS_IF_LARGER_THAN_BYTES ||
    duration >= COMPRESS_IF_LONGER_THAN_SECONDS ||
    largestDimension > MAX_VIDEO_DIMENSION
  );
}

async function resolveVideoUri(uri: string): Promise<string> {
  if (!uri.startsWith('content://')) {
    return ensureFileUri(uri);
  }

  try {
    const resolved = await getRealPath(uri, 'video');
    return ensureFileUri(resolved);
  } catch {
    return uri;
  }
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function prepareVideoForUpload(
  sourceUri: string,
  onCompressionProgress?: (progress: number) => void
): Promise<PreparedVideoAsset> {
  const originalUri = await resolveVideoUri(sourceUri);
  const originalFileInfo = await getSafeFileInfo(originalUri);

  if (!originalFileInfo.exists) {
    throw new Error('Video file not found on device');
  }

  const originalMeta = await getSafeVideoMetaData(originalUri);
  const shouldCompress = shouldCompressVideo(originalUri, originalFileInfo, originalMeta);

  let uploadUri = originalUri;
  let didCompress = false;

  if (shouldCompress) {
    try {
      await CompressorVideo.activateBackgroundTask();
    } catch {
      // Best-effort only.
    }

    try {
      const compressedPath = await CompressorVideo.compress(
        originalUri,
        {
          compressionMethod: 'auto',
          maxSize: 720,
          minimumFileSizeForCompress: 0,
        },
        (progress) => onCompressionProgress?.(progress)
      );
      uploadUri = ensureFileUri(compressedPath);

      const compressedInfo = await getSafeFileInfo(uploadUri);
      if (!compressedInfo.exists) {
        throw new Error('Compressed video file was not created');
      }

      didCompress = uploadUri !== originalUri;
    } catch (error) {
      const originalExtension = originalUri.split('.').pop()?.toLowerCase();
      if (originalExtension !== 'mp4') {
        throw error;
      }
      uploadUri = originalUri;
      didCompress = false;
    } finally {
      try {
        await CompressorVideo.deactivateBackgroundTask();
      } catch {
        // Best-effort only.
      }
    }
  }

  const uploadFileInfo = await getSafeFileInfo(uploadUri);
  const uploadMeta = await getSafeVideoMetaData(uploadUri);

  let thumbnailUri: string | undefined;
  try {
    const thumbnail = await createVideoThumbnail(uploadUri);
    thumbnailUri = ensureFileUri(thumbnail.path);
  } catch {
    thumbnailUri = undefined;
  }

  return {
    originalUri,
    uploadUri,
    fileName: getFileNameFromUri(uploadUri),
    mimeType: 'video/mp4',
    thumbnailUri,
    didCompress,
    originalSizeBytes: originalFileInfo.size || 0,
    uploadSizeBytes: uploadFileInfo.size || originalFileInfo.size || 0,
    durationSeconds: uploadMeta?.duration || originalMeta?.duration || 0,
  };
}

export async function uploadPreparedVideo(
  uploadUrl: string,
  fileUri: string,
  onProgress?: (written: number, total: number) => void
) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_UPLOAD_ATTEMPTS; attempt += 1) {
    try {
      const response = await backgroundUpload(
        uploadUrl,
        fileUri,
        {
          uploadType: UploadType.BINARY_CONTENT,
          httpMethod: UploaderHttpMethod.PUT,
          mimeType: 'video/mp4',
          headers: {
            'Content-Type': 'video/mp4',
          },
        },
        onProgress
      );

      const statusCode = Number(response?.status || response?.responseCode || 0);
      if (statusCode >= 200 && statusCode < 300) {
        return response;
      }

      throw new Error(statusCode ? `Upload failed with status ${statusCode}` : 'Upload failed');
    } catch (error) {
      lastError = error;
      if (attempt < MAX_UPLOAD_ATTEMPTS) {
        await wait(RETRY_DELAY_MS * attempt);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Upload failed');
}

export async function cleanupPreparedVideo(preparedVideo: PreparedVideoAsset | null) {
  if (!preparedVideo) return;

  const pathsToDelete = new Set<string>();

  if (preparedVideo.uploadUri && preparedVideo.uploadUri !== preparedVideo.originalUri) {
    pathsToDelete.add(preparedVideo.uploadUri);
  }

  if (preparedVideo.thumbnailUri) {
    pathsToDelete.add(preparedVideo.thumbnailUri);
  }

  await Promise.allSettled(
    Array.from(pathsToDelete).map(async (uri) => {
      if (!uri.startsWith('file://')) return;
      await FileSystem.deleteAsync(uri, { idempotent: true });
    })
  );
}
