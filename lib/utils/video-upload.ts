import * as FileSystem from 'expo-file-system/legacy';
import {
  Video as CompressorVideo,
  backgroundUpload,
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

function createUploadAbortError(): Error {
  const e = new Error('Upload cancelled');
  e.name = 'AbortError';
  return e;
}

/** Guess an order-of-magnitude upload rate before any bytes move (sparse native progress). */
export function estimateWarmupUploadBytesPerSecond(totalBytes: number): number {
  if (totalBytes <= 0) return 256 * 1024;
  const bySize = totalBytes / 75;
  return Math.min(Math.max(bySize, 48 * 1024), 12 * 1024 * 1024);
}

/**
 * Native progress is often bursty; EMA stays 0 until the second tick. Blend session-average
 * (bytes / elapsed) with instantaneous smoothing so speed/ETA stay visible and sane.
 */
function blendedBytesPerSecond(params: {
  smoothedInstant: number;
  bestWrittenBytes: number;
  elapsedMs: number;
  totalBytes: number;
}): { bps: number; isEstimated: boolean } {
  const { smoothedInstant, bestWrittenBytes, elapsedMs, totalBytes } = params;
  const elapsedSec = Math.max(elapsedMs / 1000, 0.001);
  const sessionAvg = bestWrittenBytes > 0 ? bestWrittenBytes / elapsedSec : 0;
  const fromSamples = Math.max(
    Number.isFinite(smoothedInstant) ? smoothedInstant : 0,
    Number.isFinite(sessionAvg) ? sessionAvg : 0
  );

  if (fromSamples > 0) {
    return { bps: fromSamples, isEstimated: false };
  }

  if (totalBytes > 0) {
    return { bps: estimateWarmupUploadBytesPerSecond(totalBytes), isEstimated: true };
  }

  return { bps: 0, isEstimated: true };
}

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

export type UploadProgressSnapshot = {
  attempt: number;
  maxAttempts: number;
  writtenBytes: number;
  bestWrittenBytes: number;
  totalBytes: number;
  currentAttemptPercent: number;
  overallPercent: number;
  /** Blended rate for UI: max(instant EMA, session average), or a size-based warmup before first bytes. */
  bytesPerSecond: number;
  etaSeconds: number;
  elapsedMs: number;
  /** True when speed/ETA use a heuristic (no real throughput sample yet). */
  speedIsEstimated?: boolean;
};

export type UploadRetrySnapshot = {
  attempt: number;
  maxAttempts: number;
  retryDelayMs: number;
  uploadedBytes: number;
  totalBytes: number;
  errorMessage: string;
};

export type UploadPreparedVideoCallbacks = {
  onProgress?: (snapshot: UploadProgressSnapshot) => void;
  onRetry?: (snapshot: UploadRetrySnapshot) => void;
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
  const [originalFileInfo, originalMeta] = await Promise.all([
    getSafeFileInfo(originalUri),
    getSafeVideoMetaData(originalUri),
  ]);

  if (!originalFileInfo.exists) {
    throw new Error('Video file not found on device');
  }

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

  const [uploadFileInfo, uploadMeta] = await Promise.all([
    getSafeFileInfo(uploadUri),
    getSafeVideoMetaData(uploadUri),
  ]);

  return {
    originalUri,
    uploadUri,
    fileName: getFileNameFromUri(uploadUri),
    mimeType: 'video/mp4',
    didCompress,
    originalSizeBytes: originalFileInfo.size || 0,
    uploadSizeBytes: uploadFileInfo.size || originalFileInfo.size || 0,
    durationSeconds: uploadMeta?.duration || originalMeta?.duration || 0,
  };
}

export async function uploadPreparedVideo(
  uploadUrl: string,
  fileUri: string,
  callbacks?: UploadPreparedVideoCallbacks,
  abortSignal?: AbortSignal
) {
  const fileInfo = await getSafeFileInfo(fileUri);
  const fallbackTotalBytes = Math.max(0, fileInfo.size || 0);
  const startedAt = Date.now();
  let bestWrittenBytes = 0;
  let smoothedBytesPerSecond = 0;
  let lastError: unknown;

  const emitUploadSnapshot = (
    attempt: number,
    now: number,
    normalizedTotal: number,
    cappedWritten: number
  ) => {
    const elapsedMs = now - startedAt;
    const currentAttemptPercent =
      normalizedTotal > 0 ? (cappedWritten / normalizedTotal) * 100 : 0;
    const overallPercent =
      normalizedTotal > 0 ? (bestWrittenBytes / normalizedTotal) * 100 : currentAttemptPercent;

    const { bps: displayBps, isEstimated } = blendedBytesPerSecond({
      smoothedInstant: smoothedBytesPerSecond,
      bestWrittenBytes,
      elapsedMs,
      totalBytes: normalizedTotal,
    });

    const remaining = Math.max(0, normalizedTotal - bestWrittenBytes);
    const etaSeconds =
      displayBps > 0 && normalizedTotal > 0
        ? Math.max(remaining / displayBps, 0)
        : 0;

    callbacks?.onProgress?.({
      attempt,
      maxAttempts: MAX_UPLOAD_ATTEMPTS,
      writtenBytes: cappedWritten,
      bestWrittenBytes,
      totalBytes: normalizedTotal,
      currentAttemptPercent,
      overallPercent,
      bytesPerSecond: displayBps,
      etaSeconds,
      elapsedMs,
      speedIsEstimated: isEstimated,
    });
  };

  emitUploadSnapshot(1, Date.now(), fallbackTotalBytes, 0);

  for (let attempt = 1; attempt <= MAX_UPLOAD_ATTEMPTS; attempt += 1) {
    let lastTickAt = Date.now();
    let lastWrittenBytes = 0;
    let lastTotalBytes = fallbackTotalBytes;
    let uploadTickTimer: ReturnType<typeof setInterval> | null = null;

    if (abortSignal?.aborted) {
      throw createUploadAbortError();
    }

    try {
      uploadTickTimer = setInterval(() => {
        if (abortSignal?.aborted) return;
        const now = Date.now();
        const normalizedTotal = Math.max(0, lastTotalBytes);
        const cappedWritten =
          normalizedTotal > 0
            ? Math.min(bestWrittenBytes, normalizedTotal)
            : bestWrittenBytes;
        emitUploadSnapshot(attempt, now, normalizedTotal, cappedWritten);
      }, 400);

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
        (written, total) => {
          const now = Date.now();
          const normalizedTotal = Math.max(0, Number(total) || fallbackTotalBytes);
          lastTotalBytes = normalizedTotal;
          const normalizedWritten = Math.max(0, Number(written) || 0);
          const cappedWritten =
            normalizedTotal > 0 ? Math.min(normalizedWritten, normalizedTotal) : normalizedWritten;

          if (cappedWritten > bestWrittenBytes) {
            bestWrittenBytes = cappedWritten;
          }

          const deltaBytes = Math.max(0, cappedWritten - lastWrittenBytes);
          const deltaMs = Math.max(1, now - lastTickAt);
          if (deltaBytes > 0) {
            const instantaneousBytesPerSecond = deltaBytes / (deltaMs / 1000);
            smoothedBytesPerSecond =
              smoothedBytesPerSecond > 0
                ? smoothedBytesPerSecond * 0.75 + instantaneousBytesPerSecond * 0.25
                : instantaneousBytesPerSecond;
          }

          lastWrittenBytes = cappedWritten;
          lastTickAt = now;

          emitUploadSnapshot(attempt, now, normalizedTotal, cappedWritten);
        },
        abortSignal
      );

      if (uploadTickTimer) {
        clearInterval(uploadTickTimer);
        uploadTickTimer = null;
      }

      const statusCode = Number(response?.status || response?.responseCode || 0);
      if (statusCode >= 200 && statusCode < 300) {
        return response;
      }

      throw new Error(statusCode ? `Upload failed with status ${statusCode}` : 'Upload failed');
    } catch (error) {
      if (uploadTickTimer) {
        clearInterval(uploadTickTimer);
        uploadTickTimer = null;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw error;
      }
      const msg = error instanceof Error ? error.message : String(error);
      if (/cancel/i.test(msg) || /abort/i.test(msg)) {
        throw createUploadAbortError();
      }
      lastError = error;
      if (attempt < MAX_UPLOAD_ATTEMPTS) {
        const retryDelayMs = RETRY_DELAY_MS * attempt;
        callbacks?.onRetry?.({
          attempt,
          maxAttempts: MAX_UPLOAD_ATTEMPTS,
          retryDelayMs,
          uploadedBytes: bestWrittenBytes,
          totalBytes: fallbackTotalBytes,
          errorMessage: error instanceof Error ? error.message : 'Upload interrupted',
        });
        await wait(retryDelayMs);
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
