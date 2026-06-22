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

export default async function handler(request: Request): Promise<Response> {
  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(),
    });
  }

  const url = new URL(request.url);
  const targetUrl = url.searchParams.get('url');

  if (!targetUrl) {
    return new Response('Missing ?url= parameter', { status: 400 });
  }

  try {
    const target = new URL(targetUrl);

    // Only allow YouTube and Google video domains
    if (
      !target.hostname.includes('youtube.com') &&
      !target.hostname.includes('googlevideo.com') &&
      !target.hostname.includes('googleapis.com')
    ) {
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
    for (const [k, v] of Object.entries(corsHeaders())) {
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

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-YouTube-Client-Name, X-YouTube-Client-Version',
    'Access-Control-Max-Age': '86400',
  };
}
