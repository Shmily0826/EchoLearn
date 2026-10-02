import { afterEach, describe, expect, it, vi } from 'vitest';
import handler from '../api/youtube';
import { getRecentVideosFromChannel } from '../src/services/youtubeApi';

const channel = {
  id: 'UCchannel',
  snippet: { title: 'Channel' },
  contentDetails: { relatedPlaylists: { uploads: 'UUchannel' } },
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('YouTube channel lookup', () => {
  it('retries an expired page token without repeating channel search', async () => {
    const calls: URL[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input), 'https://app.test');
      calls.push(url);
      const endpoint = url.searchParams.get('endpoint');
      if (endpoint === 'channels' && url.searchParams.get('id') === 'UCchannel') return Response.json({ items: [channel] });
      if (endpoint === 'channels') return Response.json({ items: [] });
      if (endpoint === 'search') return Response.json({ items: [{ snippet: { channelId: 'UCchannel' } }] });
      if (url.searchParams.has('pageToken')) return Response.json({ items: [] });
      return Response.json({ items: [{
        snippet: {
          resourceId: { videoId: 'video-1' },
          title: 'Video',
          publishedAt: '2026-10-02T00:00:00Z',
          thumbnails: {},
        },
      }] });
    }));

    const result = await getRecentVideosFromChannel('legacy-channel-name', 10, 'expired');

    expect(result.videos.map((video) => video.videoId)).toEqual(['video-1']);
    expect(calls.filter((url) => url.searchParams.get('endpoint') === 'search')).toHaveLength(1);
    expect(calls.filter((url) => url.searchParams.get('endpoint') === 'channels')).toHaveLength(3);
    expect(calls.filter((url) => url.searchParams.get('endpoint') === 'playlistItems')).toHaveLength(2);
  });

  it('reports a YouTube quota response as a provider error, not no data', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      error: { errors: [{ reason: 'quotaExceeded' }] },
    }, { status: 403 })));

    await expect(getRecentVideosFromChannel('@channel'))
      .rejects.toMatchObject({ name: 'YouTubeApiError', code: 'quota_exceeded' });
  });

  it('keeps a successful empty lookup distinct from provider failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ items: [] })));

    await expect(getRecentVideosFromChannel('@missing')).resolves.toMatchObject({
      videos: [], channelId: '', channelTitle: '',
    });
  });

  it('restricts search to one channel result and three calls per IP per minute (per instance)', async () => {
    vi.stubEnv('YOUTUBE_API_KEY', 'test-key');
    const fetchMock = vi.fn(async () => Response.json({ items: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const ip = `youtube-search-test-${Date.now()}`;
    const now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);

    for (let index = 0; index < 4; index += 1) {
      const response = await handler(new Request(
        `https://app.test/api/youtube?endpoint=search&type=channel&maxResults=1&q=channel-${index}`,
        { headers: { 'x-forwarded-for': ip } },
      ));
      expect(response.status).toBe(index < 3 ? 200 : 429);
    }
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const invalid = await handler(new Request(
      'https://app.test/api/youtube?endpoint=search&type=video&maxResults=50&q=anything',
      { headers: { 'x-forwarded-for': `${ip}-invalid` } },
    ));
    expect(invalid.status).toBe(400);
  });

  it('classifies proxy rate limits and network failures separately', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'rate limited' }, { status: 429 })));
    await expect(getRecentVideosFromChannel('@channel'))
      .rejects.toMatchObject({ code: 'rate_limited' });

    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      error: { errors: [{ reason: 'userRateLimitExceeded' }] },
    }, { status: 403 })));
    await expect(getRecentVideosFromChannel('@channel'))
      .rejects.toMatchObject({ code: 'rate_limited' });

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    await expect(getRecentVideosFromChannel('@channel'))
      .rejects.toMatchObject({ code: 'provider_failure' });
  });
});
