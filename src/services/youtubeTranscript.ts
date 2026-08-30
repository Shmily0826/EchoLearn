/**
 * YouTube transcript auto-fetch service.
 *
 * Multi-strategy approach:
 *   1. Explicitly configured local proxy (when available)
 *   2. Server-side transcript services (CF Worker → Vercel/VPS)
 *   3. Official YouTube InnerTube/page paths via the app proxy
 *   4. youtube-transcript npm package — final fallback
 *
 * In dev mode, requests go through Vite's proxy to bypass CORS.
 * In production, all YouTube requests are routed through the Vercel Edge Function
 * at /api/yt, which adds proper headers (User-Agent, CONSENT cookie) to avoid
 * YouTube bot detection.
 */

import type { TranscriptLine } from '../types';
import { fetchWithTimeout } from '../utils/resilientFetch';

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
            { cause: err },
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

// ── Strategy 0: Explicit local proxy (uses your residential IP) ─

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
  // Skip if proxy recently failed — avoid wasting time
  if (wasLocalProxyRecentlyFailed()) {
    return null;
  }

  const baseUrl = getLocalProxyUrl();
  if (!baseUrl) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000); // 4s timeout
    const res = await fetch(
      `${baseUrl}/api/transcript?videoId=${encodeURIComponent(videoId)}&lang=${encodeURIComponent(lang)}`,
      { signal: controller.signal },
    );
    clearTimeout(timeout);

    if (res.ok) {
      const data = (await res.json()) as TranscriptFetchResult & { source?: string };
      if (data.lines && data.lines.length > 0) {
        clearLocalProxyFailure(); // proxy is working, clear any cached failure
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
    if (err instanceof Error && err.name === 'AbortError') {
      markLocalProxyFailed(); // proxy not running, skip for next 5 minutes
    } else if (err instanceof Error) {
      console.warn(
        '[EchoLearn] Local proxy error:',
        err.message,
      );
    }
  }

  return null;
}

// ── Strategy 1: Server-side transcript API (CF Worker + Vercel) ──

/**
 * Cloudflare Worker URL for server-side transcript fetching.
 * CF IPs generally have better reputation with YouTube than Vercel/datacenter IPs.
 */
export const CF_WORKER_URL = 'https://yt-transcript-proxy.rng2018520.workers.dev';

/**
 * Cache local proxy failure so we skip it for 5 minutes after a failure.
 * This avoids wasting 4 seconds on every fetch when the proxy isn't running.
 */
const LOCAL_PROXY_FAIL_KEY = 'echolearn_proxy_fail_at';
const LOCAL_PROXY_SKIP_MS = 5 * 60 * 1000; // 5 minutes

function wasLocalProxyRecentlyFailed(): boolean {
  const failAt = localStorage.getItem(LOCAL_PROXY_FAIL_KEY);
  if (!failAt) return false;
  return Date.now() - Number(failAt) < LOCAL_PROXY_SKIP_MS;
}

function markLocalProxyFailed(): void {
  localStorage.setItem(LOCAL_PROXY_FAIL_KEY, String(Date.now()));
}

function clearLocalProxyFailure(): void {
  localStorage.removeItem(LOCAL_PROXY_FAIL_KEY);
}

export const YOUTUBE_ACQUISITION_BLOCKED = 'youtube_acquisition_blocked';
export const TRANSCRIPT_ERROR_CODES = {
  CAPTIONS_NOT_FOUND: 'captions_not_found',
  ACQUISITION_BLOCKED: YOUTUBE_ACQUISITION_BLOCKED,
  PROVIDER_TIMEOUT: 'provider_timeout',
  TRANSCRIPT_DISABLED: 'transcript_disabled',
  ASR_REQUIRED: 'asr_required',
} as const;

export type TranscriptErrorCode =
  (typeof TRANSCRIPT_ERROR_CODES)[keyof typeof TRANSCRIPT_ERROR_CODES];

export interface TranscriptRecovery {
  canAsr: boolean;
  requiresExplicitOptIn: boolean;
}

export class YouTubeTranscriptError extends Error {
  readonly code: TranscriptErrorCode;
  readonly recovery?: TranscriptRecovery;

  constructor(code: TranscriptErrorCode, message?: string, recovery?: TranscriptRecovery) {
    super(message ?? code);
    this.name = 'YouTubeTranscriptError';
    this.code = code;
    this.recovery = recovery;
  }
}

export class YouTubeAcquisitionBlockedError extends Error {
  readonly code = YOUTUBE_ACQUISITION_BLOCKED;

  constructor() {
    super(YOUTUBE_ACQUISITION_BLOCKED);
    this.name = 'YouTubeAcquisitionBlockedError';
  }
}

/**
 * Calls server-side transcript APIs.
 * Tries the CF Worker first, then the same-origin Vercel function. The Vercel
 * function keeps YTDLP_API_KEY server-side and falls through to its existing
 * youtube-transcript implementation if the VPS is unavailable.
 */
export async function fetchYouTubeServerTranscript(
  videoId: string,
  lang: string,
  onFailure?: (detail: string) => void,
  options: { allowAsr?: boolean } = {},
): Promise<TranscriptFetchResult | null> {
  const asrParam = options.allowAsr ? '&allowAsr=1' : '';
  const workerUrl = `${CF_WORKER_URL}/api/transcript?videoId=${encodeURIComponent(videoId)}&lang=${encodeURIComponent(lang)}${asrParam}`;
  // Vercel's endpoint is a caption fallback; allowAsr is a Worker-only
  // generation opt-in and carries no meaning on this route.
  const vercelUrl = `/api/transcript?videoId=${encodeURIComponent(videoId)}&lang=${encodeURIComponent(lang)}`;
  // Caption acquisition is a fast path. A server response that says the
  // provider timed out/was blocked/not-found is authoritative for this flow;
  // only transport and generic 5xx failures justify trying the other server.
  // Caption-only requests stay fast. Explicit ASR includes the Worker VPS
  // budget (75s) plus a small transport buffer, but remains bounded.
  const WORKER_TIMEOUT_MS = options.allowAsr ? 90000 : 12000;
  const VERCEL_TIMEOUT_MS = 8000;
  const endpoints = [
    { url: workerUrl, label: 'CF Worker', timeoutMs: WORKER_TIMEOUT_MS },
    {
      url: vercelUrl,
      label: 'Vercel server API',
      timeoutMs: VERCEL_TIMEOUT_MS,
    },
  ].slice(0, options.allowAsr ? 1 : 2);

  for (let index = 0; index < endpoints.length; index++) {
    const endpoint = endpoints[index];
    try {
      const res = await fetchWithTimeout(endpoint.url, { timeoutMs: endpoint.timeoutMs });
      if (res.ok) {
        const data = (await res.json()) as TranscriptFetchResult;
        if (Array.isArray(data.lines) && data.lines.length > 0) {
          if (endpoint.label !== 'CF Worker') data.source = data.source || 'vps';
          console.log(
            `[EchoLearn] ${endpoint.label}: got ${data.lines.length} lines (${data.language})`,
          );
          return data;
        }
        console.warn(`[EchoLearn] ${endpoint.label}: empty or unusable transcript`);
      } else {
        const body = await res.text().catch(() => '');
        let payload: { error?: unknown; code?: unknown; message?: unknown; detail?: { code?: unknown }; recovery?: unknown } | undefined;
        try {
          payload = JSON.parse(body) as { error?: unknown; code?: unknown; message?: unknown; detail?: { code?: unknown } };
        } catch {
          // Keep the existing diagnostic path for non-JSON upstream failures.
        }
        const code = payload?.code ?? payload?.detail?.code ?? payload?.error
          ?? (res.status === 408 || res.status === 504 ? TRANSCRIPT_ERROR_CODES.PROVIDER_TIMEOUT : undefined);
        if (Object.values(TRANSCRIPT_ERROR_CODES).includes(code as TranscriptErrorCode)) {
          if (code === YOUTUBE_ACQUISITION_BLOCKED) throw new YouTubeAcquisitionBlockedError();
          // Only the Worker owns an explicit ASR route. Vercel is a caption
          // fallback and must not advertise recovery metadata even if an
          // upstream payload happens to contain it.
          const recovery = endpoint.label === 'CF Worker' ? payload?.recovery : undefined;
          const structuredRecovery = recovery && typeof recovery === 'object'
            && (recovery as { canAsr?: unknown }).canAsr === true
            && (recovery as { requiresExplicitOptIn?: unknown }).requiresExplicitOptIn === true
            ? { canAsr: true, requiresExplicitOptIn: true }
            : undefined;
          throw new YouTubeTranscriptError(code as TranscriptErrorCode, String(payload?.message ?? code), structuredRecovery);
        }
        const detail = `${endpoint.label} HTTP ${res.status}${body ? `: ${body.substring(0, 200)}` : ''}`;
        console.warn(`[EchoLearn] ${endpoint.label} error:`, detail);
        onFailure?.(detail);
      }
    } catch (err) {
      if (err instanceof YouTubeAcquisitionBlockedError) throw err;
      if (err instanceof YouTubeTranscriptError) throw err;
      const detail = `${endpoint.label} request failed: ${err instanceof Error ? err.message : 'unknown error'}`;
      console.warn(`[EchoLearn] ${detail}`);
      onFailure?.(detail);
      // A client timeout is a provider timeout, not evidence that the Vercel
      // endpoint can help; calling it would repeat the same VPS bottleneck.
      if (index === 0 && err instanceof Error && err.name === 'AbortError') {
        throw new YouTubeTranscriptError(TRANSCRIPT_ERROR_CODES.PROVIDER_TIMEOUT, 'Transcript provider timed out');
      }
      if (options.allowAsr && index === 0) {
        throw err;
      }
    }
  }

  return null;
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
  /** Set by the CF Worker / VPS when the transcript was produced by Whisper
   *  (no native subtitles). May be undefined for client-side fallback paths. */
  source?: string;
}

/**
 * Fetch the transcript/captions for a YouTube video.
 *
 * Tries multiple strategies in order:
 *   0. Local proxy (residential IP — skipped if failed within 5 min)
 *   1. InnerTube API (ANDROID/WEB clients) via Edge Function proxy
 *   2. YouTube page HTML scraping via Edge Function proxy
 *   3. Server-side API: CF Worker (→ VPS yt-dlp) first, then Vercel fallback
 *      (Worker fallbacks = InnerTube/Web/Invidious/Piped/Whisper)
 *   4. youtube-transcript npm package (client-side, last resort)
 *
 * @param videoId  The 11-character YouTube video ID
 * @param lang     Preferred language code (default: 'en')
 */
async function _fetchYouTubeTranscriptImpl(
  videoId: string,
  lang = 'en',
  options: { allowAsr?: boolean } = {},
): Promise<TranscriptFetchResult> {
  const errors: string[] = [];

  // Strategy 0: Explicit local proxy (opt-in; no production default probe).
  if (getLocalProxyUrl()) {
    try {
      const localResult = await fetchViaLocalProxy(videoId, lang);
      if (localResult) return localResult;
      errors.push('Local proxy returned no captions');
    } catch (err) {
      errors.push(
        `Local proxy: ${err instanceof Error ? err.message : 'failed'}`,
      );
    }
  }

  // Strategy 1: Server-side transcript API (CF Worker → Vercel fallback).
  // This is the default production path and keeps VPS credentials server-side.
  try {
    const serverFailures: string[] = [];
    const serverResult = await fetchYouTubeServerTranscript(videoId, lang, (detail) => {
      serverFailures.push(detail);
    }, options);
    if (serverResult) return serverResult;
    if (options.allowAsr) {
      throw new Error('Explicit ASR request returned no transcript');
    }
    errors.push(
      serverFailures.length > 0
        ? `Server API: ${serverFailures.join('; ')}`
        : 'Server API (CF Worker + Vercel) returned no usable transcript',
    );
  } catch (err) {
    if (err instanceof YouTubeAcquisitionBlockedError) throw err;
    if (err instanceof YouTubeTranscriptError) throw err;
    if (options.allowAsr) throw err;
    errors.push(
      `Server API: ${err instanceof Error ? err.message : 'failed'}`,
    );
  }

  // Strategy 2: InnerTube API via Edge Function proxy.
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
    `Unable to fetch captions for this video.\n\n` +
      `Tried ${errors.length} methods:\n` +
      errors.map((e, i) => `  ${i + 1}. ${e}`).join('\n') +
      `\n\nCaption metadata may exist even when a provider cannot retrieve the ` +
      `timed-text content. YouTube may also be temporarily blocking requests ` +
      `from the current network.\n` +
      `You can upload a subtitle file (SRT/VTT) manually.`,
  );
}

// In-flight promise cache: coalesce concurrent calls for the same
// videoId+lang into a single network cascade, so the transcript is never
// fetched more than once at a time (e.g. when the mount effect and the
// navigation effect both fire, or under React StrictMode double-invocation).
// The entry is dropped once settled, so an explicit Reload always re-fetches.
const _transcriptFetchCache = new Map<string, Promise<TranscriptFetchResult>>();

export async function fetchYouTubeTranscript(
  videoId: string,
  lang = 'en',
  options: { allowAsr?: boolean } = {},
): Promise<TranscriptFetchResult> {
  const key = `${videoId}:${lang}:${options.allowAsr ? 'asr' : 'captions'}`;
  const cached = _transcriptFetchCache.get(key);
  if (cached) return cached;
  const p = _fetchYouTubeTranscriptImpl(videoId, lang, options);
  _transcriptFetchCache.set(key, p);
  p.finally(() => {
    if (_transcriptFetchCache.get(key) === p) _transcriptFetchCache.delete(key);
  }).catch(() => {});
  return p;
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
