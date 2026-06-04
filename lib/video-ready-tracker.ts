import AsyncStorage from '@react-native-async-storage/async-storage';

export interface PendingVideoEntry {
  postId: string;
  destination: 'post' | 'draft' | 'challenge';
  challengeId?: string;
  challengeName?: string;
  createdAt: string;
  lastCheckedAt?: string;
  pollStartedAt?: string;
  checkCount?: number;
  lastKnownStatus?: string;
}

const storageKey = (userId: string) => `@pending_video_posts:${userId}`;

async function readEntries(userId: string): Promise<PendingVideoEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(userId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeEntries(userId: string, entries: PendingVideoEntry[]) {
  await AsyncStorage.setItem(storageKey(userId), JSON.stringify(entries));
}

export const videoReadyTracker = {
  async getAll(userId: string): Promise<PendingVideoEntry[]> {
    return readEntries(userId);
  },

  async track(userId: string, entry: Omit<PendingVideoEntry, 'createdAt'>) {
    const entries = await readEntries(userId);
    const existing = entries.find((item) => item.postId === entry.postId);
    if (existing) {
      await writeEntries(
        userId,
        entries.map((item) =>
          item.postId === entry.postId
            ? {
                ...item,
                ...entry,
                createdAt: item.createdAt,
                pollStartedAt: item.pollStartedAt ?? new Date().toISOString(),
              }
            : item
        )
      );
      return;
    }

    await writeEntries(userId, [
      {
        ...entry,
        createdAt: new Date().toISOString(),
        pollStartedAt: new Date().toISOString(),
        checkCount: 0,
      },
      ...entries,
    ]);
  },

  async update(userId: string, postId: string, patch: Partial<PendingVideoEntry>) {
    const entries = await readEntries(userId);
    await writeEntries(
      userId,
      entries.map((item) =>
        item.postId === postId
          ? {
              ...item,
              ...patch,
              postId: item.postId,
              createdAt: item.createdAt,
            }
          : item
      )
    );
  },

  async untrack(userId: string, postId: string) {
    const entries = await readEntries(userId);
    await writeEntries(
      userId,
      entries.filter((item) => item.postId !== postId)
    );
  },
};
