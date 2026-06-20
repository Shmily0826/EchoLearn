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
  const channel = data.items?.[0];
  if (!channel) return null;

  return {
    channelId: channel.id,
    title: channel.snippet.title,
    uploadsPlaylistId: channel.contentDetails.relatedPlaylists.uploads,
  };
}

/**
 * Fetch up to `count` recent public videos from the given channel (handle or id).
 * Returns an empty array when no videos can be found or the API key is missing.
 */
export async function getRecentVideosFromChannel(
  input: string,
  count = 10,
): Promise<ChannelVideo[]> {
  const channel = await getChannelByHandleOrId(input);
  if (!channel) return [];

  const key = apiKey();
  const params = new URLSearchParams({
    part: 'snippet',
    playlistId: channel.uploadsPlaylistId,
    maxResults: String(Math.min(count, 50)),
    key,
  });

  const res = await fetch(`${BASE}/playlistItems?${params}`);
  if (!res.ok) return [];

  const data = await res.json();
  const items: Array<{
    snippet: {
      resourceId: { videoId: string };
      title: string;
      publishedAt: string;
      thumbnails: Record<string, { url: string }>;
    };
  }> = data.items ?? [];

  return items.map((item) => {
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
}

/**
 * Fetch the latest public video from the given channel (handle or id).
 * Returns null when no video can be found or the API key is missing.
 * @deprecated Use getRecentVideosFromChannel for batch fetching.
 */
export async function getLatestVideoFromChannel(
  input: string,
): Promise<ChannelVideo | null> {
  const videos = await getRecentVideosFromChannel(input, 1);
  return videos[0] ?? null;
}
