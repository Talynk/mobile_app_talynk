import AsyncStorage from '@react-native-async-storage/async-storage';

type CachedValue<T> = {
  data: T;
  savedAt: number;
};

const memoryCache = new Map<string, CachedValue<unknown>>();

const CATEGORIES_KEY = '@create_screen:categories';
const joinedChallengesKey = (userId: string) => `@create_screen:joined_challenges:${userId}`;

async function readCache<T>(key: string): Promise<CachedValue<T> | null> {
  const inMemory = memoryCache.get(key) as CachedValue<T> | undefined;
  if (inMemory) {
    return inMemory;
  }

  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as CachedValue<T>;
    if (!parsed || typeof parsed !== 'object' || !('data' in parsed)) {
      return null;
    }

    memoryCache.set(key, parsed as CachedValue<unknown>);
    return parsed;
  } catch {
    return null;
  }
}

async function writeCache<T>(key: string, data: T) {
  const payload: CachedValue<T> = {
    data,
    savedAt: Date.now(),
  };

  memoryCache.set(key, payload as CachedValue<unknown>);

  try {
    await AsyncStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // Best-effort cache only.
  }
}

export async function getCachedCreateCategories<T>(): Promise<T | null> {
  return (await readCache<T>(CATEGORIES_KEY))?.data ?? null;
}

export async function setCachedCreateCategories<T>(categories: T) {
  await writeCache(CATEGORIES_KEY, categories);
}

export async function getCachedJoinedChallenges<T>(userId: string): Promise<T | null> {
  if (!userId) {
    return null;
  }

  return (await readCache<T>(joinedChallengesKey(userId)))?.data ?? null;
}

export async function setCachedJoinedChallenges<T>(userId: string, challenges: T) {
  if (!userId) {
    return;
  }

  await writeCache(joinedChallengesKey(userId), challenges);
}
