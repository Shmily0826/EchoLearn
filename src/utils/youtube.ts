/**
 * Extracts the YouTube video ID from various URL formats.
 *
 * Supported formats:
 *   - https://www.youtube.com/watch?v=dQw4w9WgXcQ
 *   - https://youtu.be/dQw4w9WgXcQ
 *   - https://www.youtube.com/embed/dQw4w9WgXcQ
 *   - https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=120
 *   - Plain video ID: dQw4w9WgXcQ
 *
 * @returns The 11-character video ID, or null if not recognized.
 */
export function parseYouTubeId(input: string): string | null {
  if (!input) return null;

  const trimmed = input.trim();

  // Plain 11-character ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }

  // Try parsing as URL
  try {
    const url = new URL(trimmed);

    // youtu.be/<id>
    if (url.hostname === 'youtu.be') {
      const id = url.pathname.slice(1).split('/')[0];
      return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }

    // youtube.com/watch?v=<id>
    if (url.searchParams.has('v')) {
      const id = url.searchParams.get('v');
      return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }

    // youtube.com/embed/<id>
    const embedMatch = url.pathname.match(/\/embed\/([a-zA-Z0-9_-]{11})/);
    if (embedMatch) {
      return embedMatch[1];
    }
  } catch {
    // Not a valid URL and not a plain ID
  }

  return null;
}

/**
 * Extracts the start time from a YouTube URL's `t` parameter.
 * Supports both `t=120` (seconds) and `t=1m30s` formats.
 */
export function parseStartTime(input: string): number | undefined {
  try {
    const url = new URL(input.trim());
    const t = url.searchParams.get('t');
    if (!t) return undefined;

    // Plain seconds
    if (/^\d+$/.test(t)) return parseInt(t, 10);

    // Xm Ys format
    const mMatch = t.match(/(?:(\d+)m)?(?:(\d+)s)?/);
    if (mMatch) {
      const minutes = parseInt(mMatch[1] || '0', 10);
      const seconds = parseInt(mMatch[2] || '0', 10);
      return minutes * 60 + seconds;
    }
  } catch {
    // ignore
  }
  return undefined;
}
