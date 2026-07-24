import type { ChannelVideo } from '../types';

/**
 * YouTube Data API calls go through the server-side proxy at /api/youtube.
 * The API key is held server-side (process.env.YOUTUBE_API_KEY) and never
 * exposed in the client bundle. See api/youtube.ts for the proxy implementation.
 */
const PROXY = '/api/youtube';

/**
 * Whether the YouTube Data API is available.
 * Since the key is now server-side, we optimistically return true.
 * The proxy will return an error if the key is not configured.
 */
export function hasApiKey(): boolean {
  return true;
}

/**
 * Fetch the video title (and optionally channel name) via YouTube oEmbed API.
 * No API key required. Returns null on failure.
 */
export async function getVideoTitle(
  videoUrlOrId: string,
): Promise<{ title: string; channelTitle: string } | null> {
  try {
    const url = videoUrlOrId.startsWith('http')
      ? videoUrlOrId
      : `https://www.youtube.com/watch?v=${videoUrlOrId}`;
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { title?: string; author_name?: string };
    if (!data.title) return null;
    return { title: data.title, channelTitle: data.author_name || '' };
  } catch {
    return null;
  }
}

/** Helper: call the YouTube proxy with whitelisted params. */
async function proxyFetch(endpoint: string, params: Record<string, string>): Promise<Response> {
  const qs = new URLSearchParams({ endpoint, ...params });
  return fetch(`${PROXY}?${qs.toString()}`);
}

/**
 * Resolve a channel handle (@name) or channelId to its uploads playlist ID.
 * Returns null when the channel cannot be found.
 */
export async function getChannelByHandleOrId(
  input: string,
): Promise<{ channelId: string; title: string; uploadsPlaylistId: string } | null> {
  const isHandle = input.startsWith('@');

  const res = await proxyFetch('channels', {
    part: 'contentDetails,snippet',
    ...(isHandle ? { forHandle: input } : { id: input }),
  });
  if (!res.ok) return null;

  const data = await res.json();
  let channel = data.items?.[0];

  // If not found and input doesn't start with @, try prepending @
  if (!channel && !isHandle) {
    const retryRes = await proxyFetch('channels', {
      part: 'contentDetails,snippet',
      forHandle: `@${input}`,
    });
    if (retryRes.ok) {
      const retryData = await retryRes.json();
      channel = retryData.items?.[0];
    }
  }

  // If still not found, try search API as last resort
  if (!channel) {
    const searchRes = await proxyFetch('search', {
      part: 'snippet',
      q: input.replace(/^@/, ''),
      type: 'channel',
      maxResults: '1',
    });
    if (searchRes.ok) {
      const searchData = await searchRes.json();
      const searchChannelId = searchData.items?.[0]?.snippet?.channelId;
      if (searchChannelId) {
        const detailRes = await proxyFetch('channels', {
          part: 'contentDetails,snippet',
          id: searchChannelId,
        });
        if (detailRes.ok) {
          const detailData = await detailRes.json();
          channel = detailData.items?.[0];
        }
      }
    }
  }

  if (!channel) return null;

  return {
    channelId: channel.id,
    title: channel.snippet.title,
    uploadsPlaylistId: channel.contentDetails.relatedPlaylists.uploads,
  };
}

/**
 * Fetch up to `count` recent public videos from the given channel (handle or id).
 * Supports pagination via `pageToken`.
 */
export async function getRecentVideosFromChannel(
  input: string,
  count = 10,
  pageToken?: string,
): Promise<{ videos: ChannelVideo[]; nextPageToken?: string; channelId: string; channelTitle: string }> {
  const channel = await getChannelByHandleOrId(input);
  if (!channel) return { videos: [], channelId: '', channelTitle: '' };

  const params: Record<string, string> = {
    part: 'snippet',
    playlistId: channel.uploadsPlaylistId,
    maxResults: String(Math.min(count, 50)),
  };
  if (pageToken) params.pageToken = pageToken;

  const res = await proxyFetch('playlistItems', params);
  if (!res.ok) return { videos: [], channelId: channel.channelId, channelTitle: channel.title };

  const data = await res.json();
  const items: Array<{
    snippet: {
      resourceId: { videoId: string };
      title: string;
      publishedAt: string;
      thumbnails: Record<string, { url: string }>;
    };
  }> = data.items ?? [];

  const videos = items.map((item) => {
    const videoId = item.snippet.resourceId.videoId;
    const thumbs = item.snippet.thumbnails;
    const thumbnailUrl =
      thumbs?.high?.url ?? thumbs?.medium?.url ?? thumbs?.default?.url ?? '';
    return {
      videoId,
      title: item.snippet.title,
      channelId: channel.channelId,
      channelTitle: channel.title,
      publishedAt: item.snippet.publishedAt,
      thumbnailUrl,
      youtubeUrl: `https://www.youtube.com/watch?v=${videoId}`,
    };
  });

  return {
    videos,
    nextPageToken: data.nextPageToken || undefined,
    channelId: channel.channelId,
    channelTitle: channel.title,
  };
}

/**
 * Fetch the latest public video from the given channel (handle or id).
 * @deprecated Use getRecentVideosFromChannel for batch fetching.
 */
export async function getLatestVideoFromChannel(
  input: string,
): Promise<ChannelVideo | null> {
  const result = await getRecentVideosFromChannel(input, 1);
  return result.videos[0] ?? null;
}
