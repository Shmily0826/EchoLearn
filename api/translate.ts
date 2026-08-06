/**
 * Vercel Edge Function — Google Translate (gtx) proxy.
 *
 * Provides fast, keyless single-word / short-phrase translation for the
 * transcript inline popup. This is the "fast layer"; the client falls back to
 * DeepSeek (via /api/ai) when this returns an empty translation.
 *
 * NOTE: translate.googleapis.com/translate_a/single is an *unofficial* endpoint.
 * It is widely used but is not a supported API and may change or rate-limit.
 * The DeepSeek fallback in translationService keeps the UX from hard-failing.
 *
 * Usage from the client:
 *   POST /api/translate  { text, source='en', target='zh-CN' }
 *   -> { translation: string }   (empty string on failure / unsupported input)
 */

export const config = { runtime: 'edge' };

import { translateWithGoogle } from './_shared/translate';

// ── Security configuration ────────────────────────────────────

/** Max request body size (bytes). We only ever send a word / short phrase. */
const MAX_BODY_BYTES = 10 * 1024; // 10 KB

/** Guard against absurdly long inputs being proxied to Google. */
const MAX_TEXT_LEN = 500;

/** Rate limit: max requests per IP per window. Translation is cheap. */
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 120;

/** Origins allowed to call this endpoint via CORS. */
const ALLOWED_ORIGINS = [
  'https://app.echo-learn.uk',
  'https://echo-learn.uk',
  'http://localhost:5173',
  'http://localhost:4173',
  'http://127.0.0.1:5173',
];

// ── In-memory rate limiter (per Edge instance, best-effort) ──

const buckets = new Map<string, number[]>();

function pruneBuckets(cutoff: number): void {
  // Keep the map from growing unbounded across many client IPs.
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
  let hits = buckets.get(ip);
  if (!hits) {
    hits = [];
    buckets.set(ip, hits);
  }
  while (hits.length > 0 && hits[0] <= cutoff) hits.shift();
  pruneBuckets(cutoff);
  if (hits.length >= RATE_LIMIT_MAX) return true;
  hits.push(now);
  return false;
}

function getClientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return request.headers.get('x-real-ip') || 'unknown';
}

// ── CORS ──────────────────────────────────────────────────────

function resolveOrigin(origin: string | null): string | null {
  if (!origin) return null;
  if (ALLOWED_ORIGINS.includes(origin)) return origin;
  // Allow Vercel preview deployments for testing.
  if (origin.endsWith('.vercel.app')) return origin;
  return null;
}

function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
  const allowed = resolveOrigin(origin);
  if (allowed) headers['Access-Control-Allow-Origin'] = allowed;
  return headers;
}

function jsonResponse(data: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(origin),
    },
  });
}

// ── Google gtx call ───────────────────────────────────────────
// translateWithGoogle is imported from ./_shared/translate (shared with /api/dictionary).

// ── Handler ───────────────────────────────────────────────────

export default async function handler(request: Request): Promise<Response> {
  const origin = request.headers.get('Origin');

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, origin);
  }

  // Rate limit by client IP
  if (isRateLimited(getClientIp(request))) {
    return jsonResponse({ error: 'Too many requests, please slow down' }, 429, origin);
  }

  // Reject obviously oversized bodies before reading them.
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (declaredLength > MAX_BODY_BYTES) {
    return jsonResponse({ error: 'Request body too large' }, 413, origin);
  }

  try {
    const bodyText = await request.text();
    if (bodyText.length > MAX_BODY_BYTES) {
      return jsonResponse({ error: 'Request body too large' }, 413, origin);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      return jsonResponse({ error: 'Invalid JSON body' }, 400, origin);
    }

    const obj = parsed as Record<string, unknown>;
    const text = typeof obj.text === 'string' ? (obj.text as string).trim() : '';
    // Empty / missing / too-long input → nothing to translate.
    if (!text || text.length > MAX_TEXT_LEN) {
      return jsonResponse({ translation: '' }, 200, origin);
    }
    const source = typeof obj.source === 'string' && obj.source ? (obj.source as string) : 'en';
    const target = typeof obj.target === 'string' && obj.target ? (obj.target as string) : 'zh-CN';

    // Fast layer. Any failure → empty string so the client falls back to DeepSeek.
    let translation = '';
    try {
      translation = await translateWithGoogle(text, source, target);
    } catch {
      translation = '';
    }
    return jsonResponse({ translation }, 200, origin);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return jsonResponse({ error: `translate proxy error: ${message}` }, 502, origin);
  }
}
