import { describe, expect, it } from '@jest/globals';

import { filterHlsReady, isHlsReady } from '../lib/utils/post-filter';

describe('post HLS readiness filtering', () => {
  it('allows images even without video playback URLs', () => {
    expect(isHlsReady({ id: 'image-1', type: 'image', imageUrl: 'https://cdn.test/a.jpg' })).toBe(true);
  });

  it('rejects completed videos when the HLS playlist is missing', () => {
    expect(isHlsReady({
      id: 'video-1',
      type: 'video',
      processing_status: 'completed',
      thumbnail_url: 'https://cdn.test/t.jpg',
    })).toBe(false);
  });

  it('rejects hlsReady videos when only a raw MP4 URL is present', () => {
    expect(isHlsReady({
      id: 'video-2',
      type: 'video',
      hlsReady: true,
      playback_url: 'https://cdn.test/raw.mp4',
    })).toBe(false);
  });

  it('rejects thumbnail-only videos', () => {
    expect(isHlsReady({
      id: 'video-3',
      type: 'video',
      thumbnail_url: 'https://cdn.test/t.jpg',
    })).toBe(false);
  });

  it('allows videos with a real HLS playlist', () => {
    expect(isHlsReady({
      id: 'video-4',
      type: 'video',
      hlsReady: true,
      hls_url: 'https://cdn.test/hls/video-4/master.m3u8',
    })).toBe(true);
  });

  it('filters mixed lists down to ready images and HLS videos only', () => {
    const posts = filterHlsReady([
      { id: 'image-1', type: 'image', imageUrl: 'https://cdn.test/a.jpg' },
      { id: 'bad-1', type: 'video', processing_status: 'completed' },
      { id: 'bad-2', type: 'video', hlsReady: true, playback_url: 'https://cdn.test/raw.mp4' },
      { id: 'good-1', type: 'video', hlsReady: true, hls_url: 'https://cdn.test/hls/good-1/master.m3u8' },
    ]);

    expect(posts.map((post) => post.id)).toEqual(['image-1', 'good-1']);
  });
});
