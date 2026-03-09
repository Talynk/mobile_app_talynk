import AsyncStorage from '@react-native-async-storage/async-storage';

export interface PendingVideoEntry {
  postId: string;
  destination: 'post' | 'draft' | 'challenge';
  challengeId?: string;
  challengeName?: string;
  createdAt: string;
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
    if (entries.some((item) => item.postId === entry.postId)) {
      return;
    }

    await writeEntries(userId, [
      {
        ...entry,
        createdAt: new Date().toISOString(),
      },
      ...entries,
    ]);
  },

  async untrack(userId: string, postId: string) {
    const entries = await readEntries(userId);
    await writeEntries(
      userId,
      entries.filter((item) => item.postId !== postId)
    );
  },
};
