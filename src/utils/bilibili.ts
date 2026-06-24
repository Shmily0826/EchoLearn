import type { VideoPlatform } from '../types';

/**
 * Detect which platform a URL / ID belongs to.
 */
export function detectPlatform(input: string): VideoPlatform | null {
  if (!input) return null;
  const trimmed = input.trim();

  // Bilibili URL patterns
  if (/bilibili\.com/i.test(trimmed)) return 'bilibili';
  if (/b23\.tv/i.test(trimmed)) return 'bilibili';

  // Bilibili BV ID (plain)
  if (/^BV[a-zA-Z0-9]{10}$/i.test(trimmed)) return 'bilibili';

  // YouTube patterns
  if (/youtube\.com/i.test(trimmed)) return 'youtube';
  if (/youtu\.be/i.test(trimmed)) return 'youtube';
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return 'youtube';

  return null;
}

/**
 * Extract the BV ID from various Bilibili URL formats.
 *
 * Supported formats:
 *   - https://www.bilibili.com/video/BV1xx411c7mD
 *   - https://www.bilibili.com/video/BV1xx411c7mD/?t=120
 *   - https://www.bilibili.com/video/BV1xx411c7mD?p=1
 *   - https://b23.tv/BV1xx411c7mD  (short link — only works if it contains BV directly)
 *   - https://m.bilibili.com/video/BV1xx411c7mD
 *   - Plain BV ID: BV1xx411c7mD
 *
 * @returns The BV-prefixed video ID, or null if not recognized.
 */
export function parseBilibiliId(input: string): string | null {
  if (!input) return null;
  const trimmed = input.trim();

  // Plain BV ID
  if (/^BV[a-zA-Z0-9]{10}$/i.test(trimmed)) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed);

    // bilibili.com/video/BVxxx or m.bilibili.com/video/BVxxx
    const pathMatch = url.pathname.match(/\/video\/(BV[a-zA-Z0-9]{10})/i);
    if (pathMatch) {
      return pathMatch[1];
    }

    // b23.tv short link — only handle if BV is in the path directly
    if (url.hostname === 'b23.tv') {
      const shortPath = url.pathname.slice(1);
      if (/^BV[a-zA-Z0-9]{10}$/i.test(shortPath)) {
        return shortPath;
      }
      // b23.tv redirects — can't resolve here, return null
      return null;
    }
  } catch {
    // Not a valid URL
  }

  return null;
}

/**
 * Extract start time from a Bilibili URL's `t` parameter (seconds).
 * e.g. ?t=120 or ?start_progress=120
 */
export function parseBilibiliStartTime(input: string): number | undefined {
  try {
    const url = new URL(input.trim());
    const t = url.searchParams.get('t') || url.searchParams.get('start_progress');
    if (t && /^\d+$/.test(t)) return parseInt(t, 10);
  } catch {
    // ignore
  }
  return undefined;
}

/**
 * Extract page number from a Bilibili URL's `p` parameter.
 * Returns 1-based page number, or undefined if not specified.
 */
export function parseBilibiliPage(input: string): number | undefined {
  try {
    const url = new URL(input.trim());
    const p = url.searchParams.get('p');
    if (p && /^\d+$/.test(p)) {
      const n = parseInt(p, 10);
      return n > 0 ? n : undefined;
    }
  } catch {
    // ignore
  }
  return undefined;
}

/**
 * Build a full Bilibili video URL from a BV ID.
 */
export function buildBilibiliUrl(bvid: string): string {
  return `https://www.bilibili.com/video/${bvid}`;
}
