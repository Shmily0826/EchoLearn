import type { VideoPlatform } from '../types';
import { extractUrl } from './urlExtract';

const BILIBILI_BVID_RE = /^BV[a-zA-Z0-9]{10}$/i;
const BILIBILI_PAGE_RE = /^\d{1,4}$/;

/** Exact public hosts accepted by the Bilibili API routes. */
export function isBilibiliHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'b23.tv'
    || host === 'bilibili.com'
    || host === 'www.bilibili.com'
    || host === 'm.bilibili.com';
}

export function isValidBilibiliBvid(value: string): boolean {
  return BILIBILI_BVID_RE.test(value);
}

/**
 * Detect which platform a URL / ID belongs to.
 */
export function detectPlatform(input: string): VideoPlatform | null {
  if (!input) return null;
  const trimmed = input.trim();

  // Bilibili URL patterns
  if (parseBilibiliId(trimmed)) return 'bilibili';

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
  // Share text often includes a title before the URL, e.g.
  // "【【Easy English】...】 https://b23.tv/nbSyQzx". Pull the URL out first so
  // the rest of the parser only ever sees a clean URL (or a bare BV id).
  const extracted = extractUrl(input);
  const trimmed = (extracted ?? input).trim();

  // Plain BV ID
  if (isValidBilibiliBvid(trimmed)) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed);

    if (!isBilibiliHost(url.hostname)) return null;

    // bilibili.com/video/BVxxx or m.bilibili.com/video/BVxxx. Anchor the
    // segment so a malformed overlong ID cannot be silently truncated.
    const pathMatch = url.pathname.match(/^\/video\/(BV[a-zA-Z0-9]{10})(?:\/)?$/i);
    if (pathMatch) {
      return pathMatch[1];
    }

    // b23.tv short link. If the BV id is in the path directly, return it.
    // Otherwise it's a short code (e.g. b23.tv/nbSyQzx) that redirects to the
    // real video — the backend resolves it to a BV id, so return the full URL
    // and let the caller resolve it there.
    if (url.hostname.toLowerCase() === 'b23.tv') {
      const shortPath = url.pathname.slice(1);
      if (isValidBilibiliBvid(shortPath)) {
        return shortPath;
      }
      return shortPath && !shortPath.includes('/') ? trimmed : null;
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
    const values = url.searchParams.getAll('p');
    const p = values.length === 1 ? values[0] : undefined;
    if (p && BILIBILI_PAGE_RE.test(p)) {
      const n = parseInt(p, 10);
      return n > 0 ? n : undefined;
    }
  } catch {
    // ignore
  }
  return undefined;
}

/** Return true when a Bilibili URL explicitly contains an invalid `p` value. */
export function hasInvalidBilibiliPage(input: string): boolean {
  try {
    const url = new URL(input.trim());
    const values = url.searchParams.getAll('p');
    if (values.length === 0) return false;
    return values.length !== 1 || !BILIBILI_PAGE_RE.test(values[0]) || Number(values[0]) < 1;
  } catch {
    return false;
  }
}

/**
 * Build a full Bilibili video URL from a BV ID.
 */
export function buildBilibiliUrl(bvid: string): string {
  return `https://www.bilibili.com/video/${bvid}`;
}
