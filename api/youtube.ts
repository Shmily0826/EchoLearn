/**
 * Vercel Edge Function — YouTube Data API v3 proxy.
 *
 * Keeps YOUTUBE_API_KEY server-side (never exposed in the client bundle).
 * Only whitelisted endpoints and query parameters are forwarded.
 *
 * Hardening (mirrors api/ai.ts pattern):
 *  - Per-IP in-memory rate limiting.
 *  - Endpoint whitelist (channels, playlistItems, search only).
 *  - Query parameter whitelist (no arbitrary params forwarded).
 *  - CORS restricted to the app's known origins.
 *
 * Usage from the client:
 *   GET /api/youtube?endpoint=channels&part=contentDetails,snippet&forHandle=@name
 *   GET /api/youtube?endpoint=playlistItems&part=snippet&playlistId=UU...&maxResults=10
 *   GET /api/youtube?endpoint=search&part=snippet&q=query&type=channel&maxResults=1
 */
export const config = { runtime: 'edge' };

import { resolveAppOrigin } from './_shared/cors.js';

const YT_BASE = 'https://www.googleapis.com/youtube/v3';

// ── Security configuration ────────────────────────────────────

/** Rate limit: max requests per IP per window. */
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;
// Ponytail: per-instance short-window throttling limits bursts; shared storage
// would be required for a global quota ceiling.
const SEARCH_RATE_LIMIT_MAX = 3;

// Response caching. Browser stays short so a just-added channel shows up;
// the shared CDN layer is what removes the repeat cost of a query everyone
// else already ran. Mirrors api/transcript.ts's split.
const BROWSER_CACHE_CONTROL = 'public, max-age=300';
const CDN_CACHE_CONTROL = 'public, s-maxage=1800, stale-while-revalidate=3600';

/** YouTube Data API endpoints this proxy is allowed to call. */
const ALLOWED_ENDPOINTS = ['channels', 'playlistItems', 'search'];

/** Query parameters the client is allowed to pass (whitelist). */
const ALLOWED_PARAMS = [
  'part', 'id', 'forHandle', 'playlistId', 'maxResults',
  'pageToken', 'q', 'type', 'key',
];

// ── In-memory rate limiter (per Edge instance) ────────────────

const buckets = new Map<string, number[]>();

function pruneBuckets(cutoff: number): void {
  if (buckets.size < 5000) return;
  for (const [ip, hits] of buckets) {
    if (hits.length === 0 || hits[hits.length - 1] <= cutoff) {
      buckets.delete(ip);
    }
  }
}

function isRateLimited(ip: string, limit = RATE_LIMIT_MAX): boolean {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  pruneBuckets(cutoff);

  let hits = buckets.get(ip);
  if (!hits) {
    hits = [];
    buckets.set(ip, hits);
  }
  // Prune old hits for this IP
  while (hits.length > 0 && hits[0] <= cutoff) hits.shift();
  if (hits.length >= limit) return true;
  hits.push(now);
  return false;
}

function getClientIp(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
}

function isSearchRateLimited(ip: string): boolean {
  return isRateLimited(`search:${ip}`, SEARCH_RATE_LIMIT_MAX);
}

// ── CORS helpers ──────────────────────────────────────────────

function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
  const allowed = resolveAppOrigin(origin);
  if (allowed) headers['Access-Control-Allow-Origin'] = allowed;
  return headers;
}

// ── Handler ───────────────────────────────────────────────────

export default async function handler(request: Request): Promise<Response> {
  const origin = request.headers.get('Origin');

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders(origin) });
  }

  // Rate limit
  const ip = getClientIp(request);
  if (isRateLimited(ip)) {
    return new Response(
      JSON.stringify({ error: 'Rate limit exceeded. Please slow down.' }),
      { status: 429, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' } },
    );
  }

  const url = new URL(request.url);
  const endpoint = url.searchParams.get('endpoint');

  // Validate endpoint
  if (!endpoint || !ALLOWED_ENDPOINTS.includes(endpoint)) {
    return new Response(
      JSON.stringify({ error: `Invalid endpoint. Allowed: ${ALLOWED_ENDPOINTS.join(', ')}` }),
      { status: 400, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' } },
    );
  }

  if (endpoint === 'search') {
    const query = url.searchParams.get('q')?.trim() ?? '';
    if (url.searchParams.get('type') !== 'channel' || url.searchParams.get('maxResults') !== '1' || query.length < 2 || query.length > 100) {
      return new Response(
        JSON.stringify({ error: 'Search is restricted to one channel result and a query of 2–100 characters.' }),
        { status: 400, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' } },
      );
    }
    if (isSearchRateLimited(ip)) {
      return new Response(
        JSON.stringify({ error: 'YouTube channel search rate limit exceeded. Please slow down.' }),
        { status: 429, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' } },
      );
    }
  }

  // Build forwarded query params (whitelist only, inject server-side key)
  const apiKey = process.env.YOUTUBE_API_KEY || '';
  if (!apiKey) {
    // `code` is the machine-readable half: the client cannot know whether the
    // server holds a key, so it reacts to being told, rather than guessing
    // from a hardcoded constant.
    return new Response(
      JSON.stringify({ error: 'YouTube API key not configured on server.', code: 'not_configured' }),
      { status: 500, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' } },
    );
  }

  const forwardParams = new URLSearchParams();
  forwardParams.set('key', apiKey);
  for (const param of ALLOWED_PARAMS) {
    if (param === 'key') continue; // server-side only
    const value = url.searchParams.get(param);
    if (value) forwardParams.set(param, value);
  }

  try {
    const ytUrl = `${YT_BASE}/${endpoint}?${forwardParams.toString()}`;
    const response = await fetch(ytUrl, {
      headers: { 'Accept': 'application/json' },
    });

    const body = await response.text();
    return new Response(body, {
      status: response.status,
      headers: {
        ...corsHeaders(origin),
        'Content-Type': 'application/json',
        'Cache-Control': response.ok ? BROWSER_CACHE_CONTROL : 'no-store',
        // Browser-only caching left the expensive case untouched: a misspelled
        // or deleted handle costs 100 quota units per caller, per device. The
        // CDN directive turns the empty/negative result into one fetch shared
        // by everyone. Needs `Vary: Origin` because the CORS header echoes a
        // specific allowlisted origin and must not be replayed to another one.
        ...(response.ok
          ? { 'Vercel-CDN-Cache-Control': CDN_CACHE_CONTROL, Vary: 'Origin' }
          : {}),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: `YouTube API proxy error: ${message}` }),
      { status: 502, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' } },
    );
  }
}
