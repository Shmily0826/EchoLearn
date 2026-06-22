/**
 * Vercel Serverless Function — YouTube CORS proxy.
 *
 * Usage from the client:
 *   GET /api/yt?url=<encoded-youtube-url>
 *   The function strips the origin/referer and forwards the request to YouTube,
 *   then returns the response, effectively bypassing browser CORS.
 */
export const config = { runtime: 'edge' };

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

    // Only allow YouTube domains
    if (!target.hostname.includes('youtube.com') && !target.hostname.includes('googlevideo.com')) {
      return new Response('Only YouTube URLs are allowed', { status: 403 });
    }

    // Build forwarded headers
    const headers = new Headers();
    headers.set('User-Agent',
      'com.google.android.youtube/20.10.38 (Linux; U; Android 14)',
    );
    headers.set('Accept', request.headers.get('Accept') || '*/*');
    headers.set('Accept-Language', 'en-US,en;q=0.9');

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
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}
