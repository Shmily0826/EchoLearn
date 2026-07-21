/**
 * Vercel Edge Function — DeepSeek AI proxy.
 *
 * Proxies chat completion requests to the DeepSeek API, keeping the
 * API key server-side so it is never exposed in the client bundle.
 * Supports SSE streaming (pipes the response body through).
 *
 * Hardening (pre-launch):
 *  - Per-IP in-memory rate limiting (best-effort: Vercel Edge instances are
 *    ephemeral/distributed, so this throttles casual abuse rather than
 *    guaranteeing a global cap. Use Vercel KV / Upstash for strict limits.)
 *  - Request body size cap.
 *  - Payload field whitelist + model whitelist + max_tokens cap, so callers
 *    cannot point the proxy at expensive models or unbounded generations.
 *  - CORS restricted to the app's known origins.
 *
 * Usage from the client:
 *   POST /api/ai  { model, messages, temperature, response_format, stream }
 */
export const config = { runtime: 'edge' };

const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';

// ── Security configuration ────────────────────────────────────

/** Max request body size (bytes). The app sends ~20KB at most. */
const MAX_BODY_BYTES = 100 * 1024; // 100 KB

/** Rate limit: max requests per IP per window. */
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 60;

/** Models the proxy is allowed to forward to. */
const ALLOWED_MODELS = ['deepseek-v4-flash', 'deepseek-chat'];

/** Hard cap on max_tokens even if the client requests more. */
const MAX_TOKENS_CAP = 8192;

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

// ── Payload sanitization (field whitelist) ────────────────────

interface SanitizedBody {
  model: string;
  messages: unknown;
  stream: boolean;
  temperature?: number;
  response_format?: { type: 'text' | 'json_object' };
  max_tokens?: number;
}

function sanitizeBody(parsed: unknown): SanitizedBody | null {
  if (typeof parsed !== 'object' || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.messages) || obj.messages.length === 0) return null;

  const out: SanitizedBody = {
    model: ALLOWED_MODELS.includes(obj.model as string)
      ? (obj.model as string)
      : ALLOWED_MODELS[0],
    messages: obj.messages,
    stream: obj.stream === true,
  };

  if (typeof obj.temperature === 'number' && Number.isFinite(obj.temperature)) {
    out.temperature = Math.min(Math.max(obj.temperature, 0), 2);
  }

  if (typeof obj.response_format === 'object' && obj.response_format !== null) {
    const rf = obj.response_format as Record<string, unknown>;
    out.response_format = { type: rf.type === 'json_object' ? 'json_object' : 'text' };
  }

  if (typeof obj.max_tokens === 'number' && Number.isFinite(obj.max_tokens)) {
    out.max_tokens = Math.min(Math.max(Math.floor(obj.max_tokens), 1), MAX_TOKENS_CAP);
  }

  return out;
}

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

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return jsonResponse({ error: 'AI service not configured' }, 500, origin);
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

    const sanitized = sanitizeBody(parsed);
    if (!sanitized) {
      return jsonResponse({ error: 'Invalid request payload' }, 400, origin);
    }

    const response = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(sanitized),
    });

    // Pipe the response body through (supports SSE streaming)
    const responseHeaders = new Headers();
    responseHeaders.set('Content-Type', response.headers.get('Content-Type') || 'application/json');
    for (const [k, v] of Object.entries(corsHeaders(origin))) {
      responseHeaders.set(k, v);
    }

    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return jsonResponse({ error: `AI proxy error: ${message}` }, 502, origin);
  }
}
