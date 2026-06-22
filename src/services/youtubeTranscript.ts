/**
 * YouTube transcript auto-fetch service.
 *
 * Multi-strategy approach:
 *   1. InnerTube API (ANDROID client) via Vercel Edge Function — most reliable
 *   2. YouTube page HTML scraping via Vercel Edge Function — fallback
 *   3. youtube-transcript npm package — final fallback (uses its own methods)
 *
 * In dev mode, requests go through Vite's proxy to bypass CORS.
 * In production, all YouTube requests are routed through the Vercel Edge Function
 * at /api/yt, which adds proper headers (User-Agent, CONSENT cookie) to avoid
 * YouTube bot detection.
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
  // Production fallback: use the Vercel Edge Function at /api/yt
  return `/api/yt?url=${encodeURIComponent(ytUrl)}`;
}

/** Whether requests are going through the Edge Function (production) */
function isUsingEdgeFunction(): boolean {
  return !IS_DEV && !YT_PROXY_BASE;
}

// ── CORS proxy fallbacks (only for non-proxied GET requests) ──

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

/** Android client config */
const ANDROID_CLIENT_VERSION = '20.10.38';
const ANDROID_UA = `com.google.android.youtube/${ANDROID_CLIENT_VERSION} (Linux; U; Android 14)`;

/** WEB client config */
const WEB_CLIENT_VERSION = '2.20241201.00.00';
const WEB_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

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
  // 1. Use Vite proxy, configured proxy, or Vercel Edge Function
  const proxied = proxyUrl(url);
  if (proxied !== url || isUsingEdgeFunction()) {
    try {
      return await fetchText(proxied);
    } catch (err) {
      console.warn(
        `[EchoLearn] Proxy fetch failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  // In production with Edge Function, don't try direct fetch (CORS will block)
  if (isUsingEdgeFunction()) {
    // Only try public CORS proxies as last resort
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

// ── Strategy 1: InnerTube API (multi-client) ──────────────────

/**
 * Build fetch headers for InnerTube API.
 * When using the Edge Function, we pass X-YouTube-Client-* headers so the
 * function can set matching User-Agent for YouTube.
 */
function innerTubeHeaders(clientName: string, clientVersion: string): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (isUsingEdgeFunction()) {
    // Tell Edge Function which client to emulate
    h['X-YouTube-Client-Name'] = clientName;
    h['X-YouTube-Client-Version'] = clientVersion;
  } else {
    // Dev mode: set UA directly
    h['User-Agent'] = clientName === 'WEB' ? WEB_UA : ANDROID_UA;
    h['X-YouTube-Client-Name'] = clientName === 'WEB' ? '1' : '3';
    h['X-YouTube-Client-Version'] = clientVersion;
  }
  return h;
}

async function fetchViaInnerTubeClient(
  videoId: string,
  lang: string,
  clientName: 'ANDROID' | 'WEB',
): Promise<{ data: Record<string, unknown>; tracks: CaptionTrack[] } | null> {
  const clientVersion = clientName === 'WEB' ? WEB_CLIENT_VERSION : ANDROID_CLIENT_VERSION;
  const apiUrl = proxyUrl(INNERTUBE_API_URL);

  const body: Record<string, unknown> = {
    context: {
      client: {
        clientName,
        clientVersion,
        hl: lang,
      },
    },
    videoId,
    contentCheckOk: true,
    racyCheckOk: true,
  };

  // WEB client needs additional context
  if (clientName === 'WEB') {
    (body.context as Record<string, unknown>).client = {
      ...(body.context as Record<string, Record<string, unknown>>).client,
      userAgent: WEB_UA,
    };
  }

  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: innerTubeHeaders(clientName, clientVersion),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    console.warn(
      `[EchoLearn] InnerTube ${clientName} error: ${res.status}`,
      errBody.substring(0, 200),
    );
    return null;
  }

  const data = (await res.json()) as Record<string, unknown>;

  // Log playability status for debugging
  const playability = data.playabilityStatus as
    | { status?: string; reason?: string }
    | undefined;

  if (playability?.status === 'LOGIN_REQUIRED') {
    console.warn(
      `[EchoLearn] InnerTube ${clientName}: LOGIN_REQUIRED — ${playability?.reason}`,
    );
    return null; // Signal to try next client
  }

  if (playability?.status !== 'OK') {
    console.warn(
      `[EchoLearn] InnerTube ${clientName} playability: ${playability?.status} — ${playability?.reason}`,
    );
  }

  const tracks = getCaptionTracks(data);
  return { data, tracks };
}

async function fetchViaInnerTube(
  videoId: string,
  lang: string,
): Promise<TranscriptFetchResult | null> {
  try {
    // Try ANDROID first, then WEB as fallback
    const clients: Array<'ANDROID' | 'WEB'> = ['ANDROID', 'WEB'];

    for (const client of clients) {
      const result = await fetchViaInnerTubeClient(videoId, lang, client);
      if (!result) continue;

      const { tracks } = result;
      if (tracks.length === 0) {
        const hasCaptions = 'captions' in result.data;
        console.warn(
          `[EchoLearn] InnerTube ${client}: captions field ${hasCaptions ? 'exists but no tracks' : 'missing'}`,
        );
        continue;
      }

      console.log(
        `[EchoLearn] InnerTube ${client}: found ${tracks.length} caption track(s)`,
        tracks.map((t) => `${t.languageCode}(${t.kind || 'manual'})`),
      );

      const track = selectTrack(tracks, lang);
      const lines = await fetchAndParseCaptions(track);

      if (lines.length === 0) continue;

      return {
        lines,
        language: track.languageCode,
        isAutoGenerated: track.kind === 'asr',
      };
    }

    return null;
  } catch (err) {
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

// ── Strategy 0: Local proxy (uses your residential IP) ────────

import { getLocalProxyUrl } from '../utils/storage';

/**
 * Try the local transcript proxy running on the user's machine.
 * This proxy uses the residential IP, bypassing YouTube's datacenter IP blocking.
 * Falls back quickly if the proxy is not running (3-second timeout).
 */
async function fetchViaLocalProxy(
  videoId: string,
  lang: string,
): Promise<TranscriptFetchResult | null> {
  const baseUrl = getLocalProxyUrl();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000); // 8s timeout
    const res = await fetch(
      `${baseUrl}/api/transcript?videoId=${encodeURIComponent(videoId)}&lang=${encodeURIComponent(lang)}`,
      { signal: controller.signal },
    );
    clearTimeout(timeout);

    if (res.ok) {
      const data = (await res.json()) as TranscriptFetchResult & { source?: string };
      if (data.lines && data.lines.length > 0) {
        console.log(
          `[EchoLearn] Local proxy: got ${data.lines.length} lines (${data.language})`,
        );
        return data;
      }
    } else if (res.status !== 503 && res.status !== 502) {
      // 404 = video has no transcript (legitimate), other errors log warning
      const body = await res.text().catch(() => '');
      console.warn(`[EchoLearn] Local proxy error: ${res.status}`, body.substring(0, 200));
    }
  } catch (err) {
    // AbortError = proxy not running (expected), other errors = unexpected
    if (err instanceof Error && err.name !== 'AbortError') {
      console.warn(
        '[EchoLearn] Local proxy error:',
        err.message,
      );
    }
    // AbortError silently ignored — proxy not running
  }

  return null;
}

// ── Strategy 1: Server-side transcript API (CF Worker + Vercel) ──

/**
 * Cloudflare Worker URL for server-side transcript fetching.
 * CF IPs generally have better reputation with YouTube than Vercel/datacenter IPs.
 */
const CF_WORKER_URL = 'https://yt-transcript-proxy.rng2018520.workers.dev';

/**
 * Calls server-side transcript APIs.
 * Tries CF Worker first (better IP reputation), then Vercel /api/transcript as fallback.
 */
async function fetchViaServerApi(
  videoId: string,
  lang: string,
): Promise<TranscriptFetchResult | null> {
  // Try CF Worker first
  try {
    const res = await fetch(
      `${CF_WORKER_URL}/api/transcript?videoId=${encodeURIComponent(videoId)}&lang=${encodeURIComponent(lang)}`,
    );
    if (res.ok) {
      const data = (await res.json()) as TranscriptFetchResult;
      if (data.lines && data.lines.length > 0) {
        console.log(
          `[EchoLearn] CF Worker: got ${data.lines.length} lines (${data.language})`,
        );
        return data;
      }
    } else {
      console.warn(`[EchoLearn] CF Worker error: ${res.status}`);
    }
  } catch (err) {
    console.warn(
      '[EchoLearn] CF Worker error:',
      err instanceof Error ? err.message : err,
    );
  }

  // Fallback: Vercel serverless function
  try {
    const res = await fetch(
      `/api/transcript?videoId=${encodeURIComponent(videoId)}&lang=${encodeURIComponent(lang)}`,
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn(`[EchoLearn] Vercel Server API error: ${res.status}`, body.substring(0, 200));
      return null;
    }
    const data = (await res.json()) as TranscriptFetchResult;
    if (!data.lines || data.lines.length === 0) return null;

    console.log(
      `[EchoLearn] Vercel Server API: got ${data.lines.length} lines (${data.language})`,
    );
    return data;
  } catch (err) {
    console.warn(
      '[EchoLearn] Vercel Server API error:',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

// ── Strategy 4: youtube-transcript npm package (client-side) ──

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
 *   0. Local proxy (uses your residential IP — most reliable)
 *   1. Server-side transcript API (CF Worker → Vercel fallback)
 *   2. InnerTube API (ANDROID/WEB clients) via Edge Function proxy
 *   3. YouTube page HTML scraping via Edge Function proxy
 *   4. youtube-transcript npm package (client-side, last resort)
 *
 * @param videoId  The 11-character YouTube video ID
 * @param lang     Preferred language code (default: 'en')
 */
export async function fetchYouTubeTranscript(
  videoId: string,
  lang = 'en',
): Promise<TranscriptFetchResult> {
  const errors: string[] = [];

  // Strategy 0: Local proxy (residential IP — best chance)
  try {
    const localResult = await fetchViaLocalProxy(videoId, lang);
    if (localResult) return localResult;
    errors.push('Local proxy returned no captions');
  } catch (err) {
    errors.push(
      `Local proxy: ${err instanceof Error ? err.message : 'failed'}`,
    );
  }

  // Strategy 1: Server-side transcript API (CF Worker → Vercel fallback)
  try {
    const serverResult = await fetchViaServerApi(videoId, lang);
    if (serverResult) return serverResult;
    errors.push('Server API (CF Worker + Vercel) returned no captions');
  } catch (err) {
    errors.push(
      `Server API: ${err instanceof Error ? err.message : 'failed'}`,
    );
  }

  // Strategy 2: InnerTube API via Edge Function proxy
  try {
    const innerTubeResult = await fetchViaInnerTube(videoId, lang);
    if (innerTubeResult) return innerTubeResult;
    errors.push('InnerTube API returned no captions');
  } catch (err) {
    if (err instanceof Error && err.message.includes('rate-limiting')) {
      throw err;
    }
    errors.push(
      `InnerTube: ${err instanceof Error ? err.message : 'failed'}`,
    );
  }

  // Strategy 3: Web page scraping via Edge Function proxy
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

  // Strategy 4: npm package client-side (last resort, likely CORS-blocked)
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
