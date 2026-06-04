import AsyncStorage from '@react-native-async-storage/async-storage';

export type PendingDirectUploadStep =
  | 'created'
  | 'putting'
  | 'put_done'
  | 'complete_called'
  | 'tracking_processing';

export type PendingDirectUploadSession = {
  id: string;
  userId: string;
  postId: string;
  uploadUrl: string;
  videoUrl?: string;
  expiresAt: string;
  fileUri: string;
  fileName: string;
  mimeType: 'video/mp4';
  title: string;
  caption?: string;
  postCategory: string;
  categoryId?: number;
  status: 'active' | 'draft';
  destination: 'post' | 'draft';
  step: PendingDirectUploadStep;
  createdAt: string;
  updatedAt: string;
};

const MAX_SESSIONS_PER_USER = 5;
const EXPIRED_RETENTION_MS = 24 * 60 * 60 * 1000;

function getStorageKey(userId: string) {
  return `@direct_upload_sessions:${userId}`;
}

function nowIso() {
  return new Date().toISOString();
}

function shouldKeepSession(session: PendingDirectUploadSession, now = Date.now()) {
  const expiresAt = new Date(session.expiresAt).getTime();
  if (!Number.isFinite(expiresAt)) {
    return false;
  }

  return expiresAt + EXPIRED_RETENTION_MS > now;
}

async function readSessions(userId: string): Promise<PendingDirectUploadSession[]> {
  try {
    const raw = await AsyncStorage.getItem(getStorageKey(userId));
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((session): session is PendingDirectUploadSession => !!session?.postId && !!session?.userId)
      .filter((session) => shouldKeepSession(session))
      .sort((left, right) => {
        const leftTime = new Date(left.updatedAt || left.createdAt).getTime();
        const rightTime = new Date(right.updatedAt || right.createdAt).getTime();
        return rightTime - leftTime;
      })
      .slice(0, MAX_SESSIONS_PER_USER);
  } catch {
    return [];
  }
}

async function writeSessions(userId: string, sessions: PendingDirectUploadSession[]) {
  const normalized = sessions
    .filter((session) => shouldKeepSession(session))
    .sort((left, right) => {
      const leftTime = new Date(left.updatedAt || left.createdAt).getTime();
      const rightTime = new Date(right.updatedAt || right.createdAt).getTime();
      return rightTime - leftTime;
    })
    .slice(0, MAX_SESSIONS_PER_USER);

  await AsyncStorage.setItem(getStorageKey(userId), JSON.stringify(normalized));
}

export async function getPendingDirectUploadSessions(userId: string) {
  const sessions = await readSessions(userId);
  await writeSessions(userId, sessions);
  return sessions;
}

export async function upsertPendingDirectUploadSession(
  userId: string,
  session: PendingDirectUploadSession,
) {
  const sessions = await readSessions(userId);
  const withoutCurrent = sessions.filter((item) => item.postId !== session.postId);
  await writeSessions(userId, [
    {
      ...session,
      userId,
      updatedAt: session.updatedAt || nowIso(),
    },
    ...withoutCurrent,
  ]);
}

export async function updatePendingDirectUploadSession(
  userId: string,
  postId: string,
  patch: Partial<PendingDirectUploadSession>,
) {
  const sessions = await readSessions(userId);
  const nextSessions = sessions.map((session) =>
    session.postId === postId
      ? {
          ...session,
          ...patch,
          postId: session.postId,
          userId,
          updatedAt: nowIso(),
        }
      : session
  );
  await writeSessions(userId, nextSessions);
}

export async function removePendingDirectUploadSession(userId: string, postId: string) {
  const sessions = await readSessions(userId);
  await writeSessions(userId, sessions.filter((session) => session.postId !== postId));
}

export async function cleanupExpiredDirectUploadSessions(userId: string) {
  const sessions = await readSessions(userId);
  await writeSessions(userId, sessions);
}
