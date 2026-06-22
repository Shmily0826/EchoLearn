/**
 * YouTube transcript auto-fetch service.
 *
 * Multi-strategy approach:
 *   1. InnerTube API (ANDROID client) — most reliable, may work directly from browser
 *   2. YouTube page HTML scraping via CORS proxy — fallback
 *   3. youtube-transcript npm package — final fallback (uses its own methods)
 *
 * In dev mode, requests go through Vite's proxy to bypass CORS.
 * In production, set VITE_YOUTUBE_PROXY env var or rely on CORS proxies.
 */

import type { TranscriptLine } from '../types';

// ── Configuration ──────────────────────────────────────────────

/**
 * In dev mode, Vite proxies /yt-proxy/* to youtube.com.
 * In production, set VITE_YOUTUBE_PROXY to your proxy base URL
 * (e.g. a Cloudflare Worker URL that forwards to youtube.com).
 */
const YT_PROXY_BASE = import.meta.env.VITE_YOUTUBE_PROXY as string | undefined;
const IS_DEV = import.meta.env.DEV;

/** Build a proxied URL for a YouTube endpoint. */
function proxyUrl(ytUrl: string): string {
  if (IS_DEV) {
    // Dev: route through Vite proxy
    const path = ytUrl.startsWith('https://www.youtube.com')
      ? ytUrl.replace('https://www.youtube.com', '')
      : ytUrl;
    return `/yt-proxy${path}`;
  }
  if (YT_PROXY_BASE) {
    // Production: use configured proxy
    return `${YT_PROXY_BASE}${encodeURIComponent(ytUrl)}`;
  }
  // No proxy — return as-is (may fail due to CORS in browser)
  return ytUrl;
}

// ── CORS proxy fallbacks (used only when Vite proxy / YT_PROXY not available) ──

const CORS_PROXIES = [
  (url: string) =>
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
];

// ── InnerTube API constants ────────────────────────────────────

/** InnerTube API key — read from env, falls back to the well-known public web key. */
const INNERTUBE_API_KEY =
  (import.meta.env.VITE_INNERTUBE_API_KEY as string | undefined) ||
  'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';

const INNERTUBE_API_URL =
  `https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_API_KEY}&prettyPrint=false`;
const INNERTUBE_CLIENT_VERSION = '20.10.38';
const INNERTUBE_USER_AGENT = `com.google.android.youtube/${INNERTUBE_CLIENT_VERSION} (Linux; U; Android 14)`;

/** Max retries for timedtext fetch (YouTube rate-limits this endpoint) */
const CAPTION_RETRY_COUNT = 2;
const CAPTION_RETRY_DELAY_MS = 1500;

// ── Types ──────────────────────────────────────────────────────

interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  name?: { simpleText?: string };
  kind?: string;
}

interface TimedTextEvent {
  tStartMs: number;
  dDurationMs: number;
  segs?: Array<{ utf8: string }>;
}

// ── HTML entity decoding ───────────────────────────────────────

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\\u0026/g, '&')
    .replace(/\\"/g, '"');
}

// ── JSON extraction (brace-counting) ───────────────────────────

function findJsonObjectEnd(src: string, startIdx: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = startIdx; i < src.length; i++) {
    const ch = src[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

function extractPlayerResponse(
  html: string,
): Record<string, unknown> | null {
  const startPatterns = [
    /var\s+ytInitialPlayerResponse\s*=\s*\{/g,
    /ytInitialPlayerResponse\s*=\s*\{/g,
  ];
  for (const pattern of startPatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html)) !== null) {
      const braceIdx = match.index + match[0].length - 1;
      const endIdx = findJsonObjectEnd(html, braceIdx);
      if (endIdx < 0) continue;
      const jsonStr = html.slice(braceIdx, endIdx);
      try {
        return JSON.parse(
          decodeHtmlEntities(jsonStr),
        ) as Record<string, unknown>;
      } catch {
        continue;
      }
    }
  }
  return null;
}

function getCaptionTracks(
  playerResponse: Record<string, unknown>,
): CaptionTrack[] {
  const captions = playerResponse.captions as
    | { playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] } }
    | undefined;
  return captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
}

// ── Caption parsing ────────────────────────────────────────────

function parseJson3TimedText(
  json: Record<string, unknown>,
): TranscriptLine[] {
  const events = (json.events ?? []) as TimedTextEvent[];
  const lines: TranscriptLine[] = [];
  let id = 0;
  for (const event of events) {
    const text = (event.segs ?? [])
      .map((s) => s.utf8)
      .join('')
      .trim();
    if (!text || text === '\n') continue;
    lines.push({
      id: `yt_${++id}`,
      start: event.tStartMs / 1000,
      end: (event.tStartMs + event.dDurationMs) / 1000,
      text,
    });
  }
  return lines;
}

function parseXmlTimedText(xml: string): TranscriptLine[] {
  const lines: TranscriptLine[] = [];
  // srv3 format: <p t="ms" d="ms"><s>word</s>...</p>
  const pRegex = /<p\s+t="(\d+)"\s+d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;
  let match: RegExpExecArray | null;
  let id = 0;

  while ((match = pRegex.exec(xml)) !== null) {
    const startMs = parseInt(match[1], 10);
    const durMs = parseInt(match[2], 10);
    const inner = match[3];
    let text = '';
    const sRegex = /<s[^>]*>([^<]*)<\/s>/g;
    let sMatch: RegExpExecArray | null;
    while ((sMatch = sRegex.exec(inner)) !== null) {
      text += sMatch[1];
    }
    if (!text) text = inner.replace(/<[^>]+>/g, '');
    text = decodeHtmlEntities(text).trim();
    if (text) {
      lines.push({
        id: `yt_${++id}`,
        start: startMs / 1000,
        end: (startMs + durMs) / 1000,
        text,
      });
    }
  }
  if (lines.length > 0) return lines;

  // Classic format: <text start="s" dur="s">content</text>
  const classicRegex =
    /<text\s+start="([\d.]+)"\s+dur="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g;
  while ((match = classicRegex.exec(xml)) !== null) {
    const start = parseFloat(match[1]);
    const dur = parseFloat(match[2]);
    const text = decodeHtmlEntities(match[3]).replace(/\n/g, ' ').trim();
    if (text) {
      lines.push({
        id: `yt_${++id}`,
        start,
        end: start + dur,
        text,
      });
    }
  }
  return lines;
}

// ── Fetch helpers ──────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchText(url: string, init?: RequestInit): Promise<string> {
  const res = await fetch(url, init);
  if (res.status === 429) {
    throw new Error('RATE_LIMITED');
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  // Detect captcha/bot page even on 200 responses
  if (
    text.includes('<title>Sorry') ||
    text.includes('class="g-recaptcha"') ||
    text.includes('captcha')
  ) {
    throw new Error('CAPTCHA');
  }
  return text;
}

async function fetchViaProxy(url: string): Promise<string> {
  // 1. Use Vite proxy or configured proxy
  const proxied = proxyUrl(url);
  if (proxied !== url) {
    try {
      return await fetchText(proxied);
    } catch (err) {
      console.warn(
        `[EchoLearn] Proxy fetch failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  // 2. Try direct (works in Node.js or if CORS allows)
  try {
    return await fetchText(url);
  } catch {
    // direct failed
  }

  // 3. CORS proxy fallbacks
  for (const buildUrl of CORS_PROXIES) {
    try {
      return await fetchText(buildUrl(url));
    } catch {
      continue;
    }
  }

  throw new Error(
    'Could not reach YouTube (all proxies failed). Check your network connection.',
  );
}

/** Fetch caption content from a caption baseUrl */
async function fetchCaptionContent(
  baseUrl: string,
  fmt?: string,
): Promise<string> {
  let url = baseUrl;
  if (fmt && !url.includes('fmt=')) {
    url += (url.includes('?') ? '&' : '?') + `fmt=${fmt}`;
  }
  return fetchViaProxy(url);
}

function selectTrack(
  tracks: CaptionTrack[],
  lang: string,
): CaptionTrack {
  const manual = tracks.find(
    (t) => t.languageCode === lang && t.kind !== 'asr',
  );
  const auto = tracks.find(
    (t) => t.languageCode === lang && t.kind === 'asr',
  );
  const anyLang = tracks.find((t) => t.languageCode === lang);
  return manual ?? auto ?? anyLang ?? tracks[0];
}

function parseCaptionData(data: string): TranscriptLine[] {
  // Try JSON3 first
  if (data.trimStart().startsWith('{')) {
    try {
      const json = JSON.parse(data) as Record<string, unknown>;
      return parseJson3TimedText(json);
    } catch {
      // not JSON
    }
  }
  // Try XML (srv3 or classic)
  if (data.includes('<')) {
    return parseXmlTimedText(data);
  }
  return [];
}

async function fetchAndParseCaptions(
  track: CaptionTrack,
): Promise<TranscriptLine[]> {
  const formats = ['json3', undefined, 'srv3'] as const;

  for (const fmt of formats) {
    for (let attempt = 0; attempt <= CAPTION_RETRY_COUNT; attempt++) {
      try {
        if (attempt > 0) {
          await sleep(CAPTION_RETRY_DELAY_MS * attempt);
        }
        const data = await fetchCaptionContent(track.baseUrl, fmt);
        const lines = parseCaptionData(data);
        if (lines.length > 0) return lines;
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        if (msg === 'RATE_LIMITED' || msg === 'CAPTCHA') {
          if (attempt < CAPTION_RETRY_COUNT) continue;
          throw new Error(
            'YouTube is rate-limiting caption downloads. ' +
              'Please wait a moment and try again, or upload a subtitle file manually.',
          );
        }
        break; // non-retryable error, try next format
      }
    }
  }

  return [];
}

// ── Strategy 1: InnerTube API ──────────────────────────────────

async function fetchViaInnerTube(
  videoId: string,
  lang: string,
): Promise<TranscriptFetchResult | null> {
  try {
    const apiUrl = proxyUrl(INNERTUBE_API_URL);

    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': INNERTUBE_USER_AGENT,
        'X-YouTube-Client-Name': '3',
        'X-YouTube-Client-Version': INNERTUBE_CLIENT_VERSION,
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'ANDROID',
            clientVersion: INNERTUBE_CLIENT_VERSION,
            hl: lang,
          },
        },
        videoId,
        contentCheckOk: true,
        racyCheckOk: true,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.warn(
        `[EchoLearn] InnerTube API error: ${res.status}`,
        errBody.substring(0, 200),
      );
      return null;
    }

    const data = (await res.json()) as Record<string, unknown>;

    // Log playability status for debugging
    const playability = data.playabilityStatus as
      | { status?: string; reason?: string }
      | undefined;
    if (playability?.status !== 'OK') {
      console.warn(
        `[EchoLearn] InnerTube playability: ${playability?.status} — ${playability?.reason}`,
      );
    }

    const tracks = getCaptionTracks(data);
    if (tracks.length === 0) {
      // Log whether captions field exists at all
      const hasCaptions = 'captions' in data;
      console.warn(
        `[EchoLearn] InnerTube: captions field ${hasCaptions ? 'exists but no tracks' : 'missing'}`,
      );
      return null;
    }

    console.log(
      `[EchoLearn] InnerTube: found ${tracks.length} caption track(s)`,
      tracks.map((t) => `${t.languageCode}(${t.kind || 'manual'})`),
    );

    const track = selectTrack(tracks, lang);
    // fetchAndParseCaptions may throw on rate-limit — let it propagate
    const lines = await fetchAndParseCaptions(track);

    if (lines.length === 0) return null;

    return {
      lines,
      language: track.languageCode,
      isAutoGenerated: track.kind === 'asr',
    };
  } catch (err) {
    // Propagate rate-limit errors, swallow others
    if (err instanceof Error && err.message.includes('rate-limiting')) {
      throw err;
    }
    console.warn(
      '[EchoLearn] InnerTube fetch error:',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

// ── Strategy 2: Web page HTML scraping ─────────────────────────

async function fetchViaWebPage(
  videoId: string,
  lang: string,
): Promise<TranscriptFetchResult | null> {
  try {
    const pageUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const html = await fetchViaProxy(pageUrl);

    console.log(`[EchoLearn] Web page: ${html.length} bytes`);

    // Check for captcha/bot detection
    if (
      html.includes('class="g-recaptcha"') ||
      html.includes('captcha') ||
      html.includes('unusual traffic')
    ) {
      throw new Error(
        'YouTube is blocking automated requests (captcha detected)',
      );
    }

    // Check if the page looks like a consent/login page
    if (html.length < 50000) {
      console.warn(
        `[EchoLearn] Web page suspiciously small (${html.length} bytes) — might be a consent/login page`,
      );
    }

    const playerResponse = extractPlayerResponse(html);
    if (!playerResponse) {
      console.warn('[EchoLearn] Could not extract ytInitialPlayerResponse from page HTML');
      throw new Error(
        'Could not extract player data from YouTube page',
      );
    }

    const tracks = getCaptionTracks(playerResponse);
    if (tracks.length === 0) {
      console.warn('[EchoLearn] Web page: player response has no caption tracks');
      return null;
    }

    console.log(
      `[EchoLearn] Web page: found ${tracks.length} caption track(s)`,
    );

    const track = selectTrack(tracks, lang);
    const lines = await fetchAndParseCaptions(track);

    if (lines.length === 0) return null;

    return {
      lines,
      language: track.languageCode,
      isAutoGenerated: track.kind === 'asr',
    };
  } catch (err) {
    // Re-throw meaningful errors, swallow others
    if (err instanceof Error) {
      if (
        err.message.includes('captcha') ||
        err.message.includes('rate-limiting')
      ) {
        throw err;
      }
      console.warn('[EchoLearn] Web page error:', err.message);
    }
    return null;
  }
}

// ── Strategy 3: youtube-transcript npm package ─────────────────

async function fetchViaNpmPackage(
  videoId: string,
  lang: string,
): Promise<TranscriptFetchResult | null> {
  try {
    const { YoutubeTranscript } = await import('youtube-transcript');
    const result = await YoutubeTranscript.fetchTranscript(videoId, {
      lang,
    });
    if (!result || result.length === 0) return null;

    const lines: TranscriptLine[] = result.map((item, i) => ({
      id: `yt_${i + 1}`,
      // youtube-transcript returns offset in seconds (ms / 1000 in some versions)
      // and duration in seconds
      start: item.offset > 1000 ? item.offset / 1000 : item.offset,
      end:
        (item.offset > 1000 ? item.offset / 1000 : item.offset) +
        (item.duration > 1000 ? item.duration / 1000 : item.duration),
      text: item.text,
    }));

    return {
      lines,
      language: result[0]?.lang ?? lang,
      isAutoGenerated: false,
    };
  } catch {
    return null;
  }
}

// ── Public API ─────────────────────────────────────────────────

export interface TranscriptFetchResult {
  lines: TranscriptLine[];
  language: string;
  isAutoGenerated: boolean;
}

/**
 * Fetch the transcript/captions for a YouTube video.
 *
 * Tries multiple strategies in order:
 *   1. InnerTube API (ANDROID client) — most reliable
 *   2. YouTube page HTML scraping — fallback
 *   3. youtube-transcript npm package — last resort
 *
 * @param videoId  The 11-character YouTube video ID
 * @param lang     Preferred language code (default: 'en')
 */
export async function fetchYouTubeTranscript(
  videoId: string,
  lang = 'en',
): Promise<TranscriptFetchResult> {
  const errors: string[] = [];

  // Strategy 1: InnerTube API (may throw rate-limit error)
  try {
    const innerTubeResult = await fetchViaInnerTube(videoId, lang);
    if (innerTubeResult) return innerTubeResult;
    errors.push('InnerTube API returned no captions');
  } catch (err) {
    // If rate-limited, propagate immediately with clear message
    if (err instanceof Error && err.message.includes('rate-limiting')) {
      throw err;
    }
    errors.push(
      `InnerTube: ${err instanceof Error ? err.message : 'failed'}`,
    );
  }

  // Strategy 2: Web page scraping
  try {
    const webResult = await fetchViaWebPage(videoId, lang);
    if (webResult) return webResult;
    errors.push('Web page scraping found no captions');
  } catch (err) {
    if (err instanceof Error && err.message.includes('rate-limiting')) {
      throw err;
    }
    errors.push(
      `Web scraping: ${err instanceof Error ? err.message : 'failed'}`,
    );
  }

  // Strategy 3: npm package
  try {
    const npmResult = await fetchViaNpmPackage(videoId, lang);
    if (npmResult) return npmResult;
    errors.push('NPM package fallback returned no captions');
  } catch {
    errors.push('NPM package fallback failed');
  }

  // All strategies failed
  throw new Error(
    `No captions/subtitles available for this video.\n\n` +
      `Tried ${errors.length} methods:\n` +
      errors.map((e, i) => `  ${i + 1}. ${e}`).join('\n') +
      `\n\nThis video may not have captions/subtitles enabled, ` +
      `or YouTube may be temporarily blocking requests from your network.\n` +
      `You can upload a subtitle file (SRT/VTT) manually.`,
  );
}

/**
 * Quick check if a video likely has captions.
 */
export async function hasCaptions(videoId: string): Promise<boolean> {
  try {
    const result = await fetchYouTubeTranscript(videoId);
    return result.lines.length > 0;
  } catch {
    return false;
  }
}
