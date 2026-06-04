import { describe, expect, it } from '@jest/globals';

import {
  filterFeedPlayable,
  filterSecondarySurfacePosts,
  isAdPost,
  isFeedPlayable,
  isHlsReady,
} from '../lib/utils/post-filter';

describe('post feed-playable filtering', () => {
  it('allows images even without video playback URLs', () => {
    expect(isFeedPlayable({ id: 'image-1', type: 'image', imageUrl: 'https://cdn.test/a.jpg' })).toBe(true);
  });

  it('allows completed videos with a real HLS playlist', () => {
    expect(isFeedPlayable({
      id: 'video-1',
      type: 'video',
      processing_status: 'completed',
      hls_url: 'https://cdn.test/hls/video-1/master.m3u8',
    })).toBe(true);
  });

  it('allows completed raw video when the backend explicitly provides raw playback', () => {
    expect(isFeedPlayable({
      id: 'video-2',
      type: 'video',
      processing_status: 'completed',
      stream_type: 'raw',
      playback_url: 'https://cdn.test/raw.mp4',
    })).toBe(true);
  });

  it.each(['uploading', 'pending', 'processing', 'failed'])('rejects %s videos', (status) => {
    expect(isFeedPlayable({
      id: `video-${status}`,
      type: 'video',
      processing_status: status,
      stream_type: 'hls',
      playback_url: 'https://cdn.test/hls/video/master.m3u8',
    })).toBe(false);
  });

  it('rejects thumbnail-only videos', () => {
    expect(isFeedPlayable({
      id: 'video-3',
      type: 'video',
      processing_status: 'completed',
      thumbnail_url: 'https://cdn.test/t.jpg',
    })).toBe(false);
  });

  it('keeps the legacy HLS helper strict', () => {
    expect(isHlsReady({
      id: 'video-4',
      type: 'video',
      hlsReady: true,
      stream_type: 'raw',
      playback_url: 'https://cdn.test/raw.mp4',
    })).toBe(false);
  });

  it('filters mixed lists down to playable feed posts', () => {
    const posts = filterFeedPlayable([
      { id: 'image-1', type: 'image', imageUrl: 'https://cdn.test/a.jpg' },
      { id: 'bad-1', type: 'video', processing_status: 'completed' },
      { id: 'bad-2', type: 'video', processing_status: 'processing', playback_url: 'https://cdn.test/raw.mp4', stream_type: 'raw' },
      { id: 'good-1', type: 'video', hlsReady: true, hls_url: 'https://cdn.test/hls/good-1/master.m3u8' },
      { id: 'good-2', type: 'video', processing_status: 'completed', stream_type: 'raw', playback_url: 'https://cdn.test/raw.mp4' },
    ]);

    expect(posts.map((post) => post.id)).toEqual(['image-1', 'good-1', 'good-2']);
  });

  it('allows ads in For You when they have media but hides them from secondary surfaces', () => {
    const ad = {
      id: 'ad-1',
      type: 'image',
      is_ad: true,
      image_url: 'https://cdn.test/ad.jpg',
    };

    expect(isAdPost(ad)).toBe(true);
    expect(isFeedPlayable(ad)).toBe(true);
    expect(filterSecondarySurfacePosts([ad]).map((post) => post.id)).toEqual([]);
  });
});
