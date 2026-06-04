import { describe, expect, it, beforeEach, jest } from '@jest/globals';

import {
  getPendingDirectUploadSessions,
  PendingDirectUploadSession,
  removePendingDirectUploadSession,
  updatePendingDirectUploadSession,
  upsertPendingDirectUploadSession,
} from '../lib/upload-session-store';

const mockStorage = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn((key: string) => Promise.resolve(mockStorage.get(key) ?? null)),
  setItem: jest.fn((key: string, value: string) => {
    mockStorage.set(key, value);
    return Promise.resolve();
  }),
  removeItem: jest.fn((key: string) => {
    mockStorage.delete(key);
    return Promise.resolve();
  }),
}));

function makeSession(postId: string, patch: Partial<PendingDirectUploadSession> = {}): PendingDirectUploadSession {
  const now = new Date('2026-06-03T10:00:00.000Z').toISOString();
  return {
    id: `user-1:${postId}`,
    userId: 'user-1',
    postId,
    uploadUrl: `https://upload.test/${postId}`,
    videoUrl: `https://cdn.test/${postId}.mp4`,
    expiresAt: new Date('2026-06-03T10:10:00.000Z').toISOString(),
    fileUri: `file:///cache/${postId}.mp4`,
    fileName: `${postId}.mp4`,
    mimeType: 'video/mp4',
    title: 'Video',
    postCategory: 'Dance',
    status: 'active',
    destination: 'post',
    step: 'created',
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}

describe('upload-session-store', () => {
  beforeEach(() => {
    mockStorage.clear();
    jest.useFakeTimers().setSystemTime(new Date('2026-06-03T10:00:00.000Z'));
  });

  it('persists, updates, and removes direct upload sessions', async () => {
    await upsertPendingDirectUploadSession('user-1', makeSession('post-1'));
    expect((await getPendingDirectUploadSessions('user-1')).map((session) => session.postId)).toEqual(['post-1']);

    await updatePendingDirectUploadSession('user-1', 'post-1', { step: 'put_done' });
    expect((await getPendingDirectUploadSessions('user-1'))[0].step).toBe('put_done');

    await removePendingDirectUploadSession('user-1', 'post-1');
    expect(await getPendingDirectUploadSessions('user-1')).toEqual([]);
  });

  it('keeps at most five newest sessions per user', async () => {
    for (let index = 0; index < 7; index += 1) {
      await upsertPendingDirectUploadSession('user-1', makeSession(`post-${index}`, {
        updatedAt: new Date(Date.now() + index * 1000).toISOString(),
      }));
    }

    const sessions = await getPendingDirectUploadSessions('user-1');
    expect(sessions).toHaveLength(5);
    expect(sessions.map((session) => session.postId)).toEqual(['post-6', 'post-5', 'post-4', 'post-3', 'post-2']);
  });

  it('drops sessions that expired more than twenty four hours ago', async () => {
    await upsertPendingDirectUploadSession('user-1', makeSession('fresh'));
    await upsertPendingDirectUploadSession('user-1', makeSession('stale', {
      expiresAt: new Date('2026-06-02T09:59:00.000Z').toISOString(),
    }));

    expect((await getPendingDirectUploadSessions('user-1')).map((session) => session.postId)).toEqual(['fresh']);
  });
});
