import { Platform } from 'react-native';

const ANDROID_MEDIA_CODEC_COOLDOWN_MS = 180;

let androidMediaCodecQueue: Promise<void> = Promise.resolve();

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * `react-native-compressor` can crash on Android when MediaCodec-backed jobs overlap or
 * are started back-to-back too aggressively. Keep those jobs serialized on Android only.
 */
export async function runSerializedAndroidMediaCodecTask<T>(
  label: string,
  task: () => Promise<T>
): Promise<T> {
  if (Platform.OS !== 'android') {
    return task();
  }

  let releaseQueue:
    | ((value?: void | PromiseLike<void>) => void)
    | undefined;
  const previousTask = androidMediaCodecQueue;
  androidMediaCodecQueue = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });

  await previousTask;

  try {
    return await task();
  } catch (error) {
    console.warn(`[AndroidMediaCodecGuard] ${label} failed`, error);
    throw error;
  } finally {
    await wait(ANDROID_MEDIA_CODEC_COOLDOWN_MS);
    if (releaseQueue) {
      releaseQueue();
    }
  }
}
