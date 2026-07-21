/**
 * Vercel Edge Function — DeepSeek AI proxy.
 *
 * Proxies chat completion requests to the DeepSeek API, keeping the
 * API key server-side so it is never exposed in the client bundle.
 * Supports SSE streaming (pipes the response body through).
 *
 * Usage from the client:
 *   POST /api/ai  { model, messages, temperature, response_format, stream }
 */
export const config = { runtime: 'edge' };

const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';

export default async function handler(request: Request): Promise<Response> {
  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return jsonResponse({ error: 'AI service not configured' }, 500);
  }

  try {
    const body = await request.text();

    const response = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body,
    });

    // Pipe the response body through (supports SSE streaming)
    const responseHeaders = new Headers();
    responseHeaders.set('Content-Type', response.headers.get('Content-Type') || 'application/json');
    for (const [k, v] of Object.entries(corsHeaders())) {
      responseHeaders.set(k, v);
    }

    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return jsonResponse({ error: `AI proxy error: ${message}` }, 502);
  }
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(),
    },
  });
}
