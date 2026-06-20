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
 * Fetch the latest public video from the given channel (handle or id).
 * Returns null when no video can be found or the API key is missing.
 */
export async function getLatestVideoFromChannel(
  input: string,
): Promise<ChannelVideo | null> {
  const channel = await getChannelByHandleOrId(input);
  if (!channel) return null;

  const key = apiKey();
  const params = new URLSearchParams({
    part: 'snippet',
    playlistId: channel.uploadsPlaylistId,
    maxResults: '1',
    key,
  });

  const res = await fetch(`${BASE}/playlistItems?${params}`);
  if (!res.ok) return null;

  const data = await res.json();
  const item = data.items?.[0];
  if (!item) return null;

  const videoId: string = item.snippet.resourceId.videoId;
  const thumbs = item.snippet.thumbnails;
  const thumbnailUrl: string =
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
}
