import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { INSTALL_REFERRER_HANDLED_KEY } from '@/lib/share-config';

function parsePostIdFromReferrer(referrer: string | null | undefined): string | null {
  if (!referrer) return null;
  try {
    const params = new URLSearchParams(referrer);
    const postId = params.get('postId')?.trim();
    if (postId && /^[0-9a-f-]{36}$/i.test(postId)) {
      return postId;
    }
  } catch (_) {
    const match = referrer.match(/postId=([0-9a-f-]{36})/i);
    if (match?.[1]) return match[1];
  }
  return null;
}

type InstallReferrerInfo = {
  installReferrer?: string | null;
};

type PlayInstallReferrerModule = {
  getInstallReferrerInfo: (
    callback: (info: InstallReferrerInfo | null, error: unknown) => void,
  ) => void;
};

function getPlayInstallReferrerModule(): PlayInstallReferrerModule | null {
  if (Platform.OS !== 'android') return null;
  try {
    const moduleRef = require('react-native-play-install-referrer') as {
      PlayInstallReferrer?: PlayInstallReferrerModule;
    };
    return moduleRef.PlayInstallReferrer ?? null;
  } catch (_) {
    return null;
  }
}

/** Android: read Play Install Referrer once after a fresh install from a shared link. */
export async function consumeDeferredSharePostId(): Promise<string | null> {
  if (Platform.OS !== 'android') return null;

  const alreadyHandled = await AsyncStorage.getItem(INSTALL_REFERRER_HANDLED_KEY);
  if (alreadyHandled === 'true') return null;

  const moduleRef = getPlayInstallReferrerModule();
  if (!moduleRef?.getInstallReferrerInfo) return null;

  const postId = await new Promise<string | null>((resolve) => {
    try {
      moduleRef.getInstallReferrerInfo((info, error) => {
        if (error || !info?.installReferrer) {
          resolve(null);
          return;
        }
        resolve(parsePostIdFromReferrer(info.installReferrer));
      });
    } catch (_) {
      resolve(null);
    }
  });

  if (!postId) return null;

  await AsyncStorage.setItem(INSTALL_REFERRER_HANDLED_KEY, 'true');
  return postId;
}
