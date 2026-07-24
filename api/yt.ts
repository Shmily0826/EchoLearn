/**
 * Vercel Edge Function — YouTube CORS proxy.
 *
 * Usage from the client:
 *   GET /api/yt?url=<encoded-youtube-url>
 *   The function strips the origin/referer and forwards the request to YouTube,
 *   then returns the response, effectively bypassing browser CORS.
 *
 * For InnerTube POST requests, the client should pass:
 *   X-YouTube-Client-Name: <client name, e.g. "WEB" or "ANDROID">
 *   X-YouTube-Client-Version: <version string>
 * so the function can set matching headers for YouTube.
 */
export const config = { runtime: 'edge' };

// Desktop browser UA for page scraping (GET requests)
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

// Android client UA for InnerTube API (POST requests)
const ANDROID_UA =
  'com.google.android.youtube/20.10.38 (Linux; U; Android 14)';

// Consent cookie to bypass YouTube's consent/bot wall
const CONSENT_COOKIE = 'CONSENT=PENDING+987; SOCS=CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjMwODI5LjA3X3AxGgJlbiACGgYIgJnSmgY';

// ── Per-IP rate limiter (per Edge instance, best-effort) ──────
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;
const rateBuckets = new Map<string, number[]>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  if (rateBuckets.size >= 5000) {
    for (const [k, v] of rateBuckets) {
      if (v.length === 0 || v[v.length - 1] <= cutoff) rateBuckets.delete(k);
    }
  }
  let hits = rateBuckets.get(ip);
  if (!hits) { hits = []; rateBuckets.set(ip, hits); }
  while (hits.length > 0 && hits[0] <= cutoff) hits.shift();
  if (hits.length >= RATE_LIMIT_MAX) return true;
  hits.push(now);
  return false;
}

function getClientIp(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip') || 'unknown';
}

export default async function handler(request: Request): Promise<Response> {
  const origin = request.headers.get('Origin');

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(origin),
    });
  }

  // Rate limit per IP
  const ip = getClientIp(request);
  if (isRateLimited(ip)) {
    return new Response('Rate limit exceeded', {
      status: 429,
      headers: corsHeaders(origin),
    });
  }

  const url = new URL(request.url);
  const targetUrl = url.searchParams.get('url');

  if (!targetUrl) {
    return new Response('Missing ?url= parameter', { status: 400 });
  }

  try {
    const target = new URL(targetUrl);

    // Only allow YouTube and Google video domains (exact match to prevent
    // SSRF bypass via lookalike hosts like youtube.com.evil.com)
    if (!isAllowedHost(target.hostname)) {
      return new Response('Only YouTube URLs are allowed', { status: 403 });
    }

    const isPost = request.method === 'POST';

    // Build forwarded headers
    const headers = new Headers();

    if (isPost) {
      // InnerTube API — use Android or client-specified UA
      const clientName = request.headers.get('X-YouTube-Client-Name');
      const clientVer = request.headers.get('X-YouTube-Client-Version');
      if (clientName === 'WEB') {
        // WEB client: use desktop browser UA
        headers.set('User-Agent', BROWSER_UA);
        headers.set('X-YouTube-Client-Name', '1'); // WEB = 1
        headers.set('X-YouTube-Client-Version', clientVer || '2.20241201.00.00');
      } else if (clientName && clientVer) {
        // ANDROID or other client
        headers.set('User-Agent', `com.google.android.youtube/${clientVer} (Linux; U; Android 14)`);
        headers.set('X-YouTube-Client-Name', clientName === 'ANDROID' ? '3' : clientName);
        headers.set('X-YouTube-Client-Version', clientVer);
      } else {
        headers.set('User-Agent', ANDROID_UA);
      }
    } else {
      // Page scraping — use desktop browser UA
      headers.set('User-Agent', BROWSER_UA);
    }

    headers.set('Accept', request.headers.get('Accept') || (isPost ? 'application/json' : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'));
    headers.set('Accept-Language', 'en-US,en;q=0.9');
    headers.set('Cookie', CONSENT_COOKIE);

    // Forward Content-Type for POST
    const contentType = request.headers.get('Content-Type');
    if (contentType) {
      headers.set('Content-Type', contentType);
    }

    const init: RequestInit = {
      method: request.method,
      headers,
      redirect: 'follow',
    };

    // Forward body for POST/PUT/PATCH
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = await request.arrayBuffer();
    }

    const response = await fetch(targetUrl, init);

    // Build response with CORS headers
    const responseHeaders = new Headers(response.headers);
    for (const [k, v] of Object.entries(corsHeaders(origin))) {
      responseHeaders.set(k, v);
    }
    // Remove restrictive headers from YouTube
    responseHeaders.delete('x-frame-options');
    responseHeaders.delete('content-security-policy');

    const body = await response.arrayBuffer();
    return new Response(body, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(`Proxy error: ${message}`, { status: 502 });
  }
}

// Domains the proxy is allowed to forward to.
const ALLOWED_TARGET_DOMAINS = ['youtube.com', 'googlevideo.com', 'googleapis.com'];

/** Exact match or subdomain match (e.g. www.youtube.com) — prevents lookalike bypass. */
function isAllowedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return ALLOWED_TARGET_DOMAINS.some(
    (domain) => host === domain || host.endsWith('.' + domain),
  );
}

// Origins allowed to call this endpoint via CORS.
const ALLOWED_ORIGINS = [
  'https://app.echo-learn.uk',
  'https://echo-learn.uk',
  'http://localhost:5173',
  'http://localhost:4173',
  'http://127.0.0.1:5173',
];

function resolveOrigin(origin: string | null): string | null {
  if (!origin) return null;
  if (ALLOWED_ORIGINS.includes(origin)) return origin;
  if (origin.endsWith('.vercel.app')) return origin; // Vercel preview deployments
  return null;
}

function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-YouTube-Client-Name, X-YouTube-Client-Version',
    'Access-Control-Max-Age': '86400',
  };
  const allowed = resolveOrigin(origin);
  if (allowed) headers['Access-Control-Allow-Origin'] = allowed;
  return headers;
}
