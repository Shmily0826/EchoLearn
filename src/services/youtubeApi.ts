import type { ChannelVideo } from '../types';

const BASE = 'https://www.googleapis.com/youtube/v3';

function apiKey(): string {
  return (import.meta.env.VITE_YOUTUBE_API_KEY as string) || '';
}

/** True when the user has set VITE_YOUTUBE_API_KEY. */
export function hasApiKey(): boolean {
  return !!apiKey();
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

/**
 * Resolve a channel handle (@name) or channelId to its uploads playlist ID.
 * Returns null when the channel cannot be found.
 */
export async function getChannelByHandleOrId(
  input: string,
): Promise<{ channelId: string; title: string; uploadsPlaylistId: string } | null> {
  const key = apiKey();
  if (!key) return null;

  const isHandle = input.startsWith('@');
  const params = new URLSearchParams({
    part: 'contentDetails,snippet',
    key,
    ...(isHandle ? { forHandle: input } : { id: input }),
  });

  const res = await fetch(`${BASE}/channels?${params}`);
  if (!res.ok) return null;

  const data = await res.json();
  let channel = data.items?.[0];

  // If not found and input doesn't start with @, try prepending @
  if (!channel && !isHandle) {
    const retryParams = new URLSearchParams({
      part: 'contentDetails,snippet',
      key,
      forHandle: `@${input}`,
    });
    const retryRes = await fetch(`${BASE}/channels?${retryParams}`);
    if (retryRes.ok) {
      const retryData = await retryRes.json();
      channel = retryData.items?.[0];
    }
  }

  // If still not found, try search API as last resort
  if (!channel) {
    const searchParams = new URLSearchParams({
      part: 'snippet',
      q: input.replace(/^@/, ''),
      type: 'channel',
      maxResults: '1',
      key,
    });
    const searchRes = await fetch(`${BASE}/search?${searchParams}`);
    if (searchRes.ok) {
      const searchData = await searchRes.json();
      const searchChannelId = searchData.items?.[0]?.snippet?.channelId;
      if (searchChannelId) {
        // Fetch full channel details with the found ID
        const detailParams = new URLSearchParams({
          part: 'contentDetails,snippet',
          id: searchChannelId,
          key,
        });
        const detailRes = await fetch(`${BASE}/channels?${detailParams}`);
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
 * Supports pagination via `pageToken`. Returns both the videos and the nextPageToken
 * for fetching the next page. Returns empty results when no videos can be found
 * or the API key is missing.
 */
export async function getRecentVideosFromChannel(
  input: string,
  count = 10,
  pageToken?: string,
): Promise<{ videos: ChannelVideo[]; nextPageToken?: string; channelId: string; channelTitle: string }> {
  const channel = await getChannelByHandleOrId(input);
  if (!channel) return { videos: [], channelId: '', channelTitle: '' };

  const key = apiKey();
  const params = new URLSearchParams({
    part: 'snippet',
    playlistId: channel.uploadsPlaylistId,
    maxResults: String(Math.min(count, 50)),
    key,
  });

  if (pageToken) {
    params.set('pageToken', pageToken);
  }

  const res = await fetch(`${BASE}/playlistItems?${params}`);
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
 * Returns null when no video can be found or the API key is missing.
 * @deprecated Use getRecentVideosFromChannel for batch fetching.
 */
export async function getLatestVideoFromChannel(
  input: string,
): Promise<ChannelVideo | null> {
  const result = await getRecentVideosFromChannel(input, 1);
  return result.videos[0] ?? null;
}
