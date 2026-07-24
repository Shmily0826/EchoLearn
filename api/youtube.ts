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

const YT_BASE = 'https://www.googleapis.com/youtube/v3';

// ── Security configuration ────────────────────────────────────

/** Rate limit: max requests per IP per window. */
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;

/** YouTube Data API endpoints this proxy is allowed to call. */
const ALLOWED_ENDPOINTS = ['channels', 'playlistItems', 'search'];

/** Query parameters the client is allowed to pass (whitelist). */
const ALLOWED_PARAMS = [
  'part', 'id', 'forHandle', 'playlistId', 'maxResults',
  'pageToken', 'q', 'type', 'key',
];

/** Origins allowed to call this endpoint via CORS. */
const ALLOWED_ORIGINS = [
  'https://app.echo-learn.uk',
  'https://echo-learn.uk',
  'http://localhost:5173',
  'http://localhost:4173',
  'http://127.0.0.1:5173',
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

function isRateLimited(ip: string): boolean {
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
  if (hits.length >= RATE_LIMIT_MAX) return true;
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

// ── CORS helpers ──────────────────────────────────────────────

function resolveOrigin(origin: string | null): string | null {
  if (!origin) return null;
  if (ALLOWED_ORIGINS.includes(origin)) return origin;
  if (origin.endsWith('.vercel.app')) return origin;
  return null;
}

function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
  const allowed = resolveOrigin(origin);
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

  // Build forwarded query params (whitelist only, inject server-side key)
  const apiKey = process.env.YOUTUBE_API_KEY || '';
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'YouTube API key not configured on server.' }),
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
        'Cache-Control': 'public, max-age=300', // 5 min cache for channel/video data
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
