/**
 * Server-side Bilibili resolver fallback.
 *
 * The CF Worker remains the primary path. This endpoint is only used when the
 * Worker cannot resolve a b23.tv short link, so the VPS key stays server-side.
 */

export const config = { runtime: 'nodejs' };

const VPS_API_URL = 'https://yt-api.echo-learn.uk';
const ALLOWED_ORIGINS = [
  'https://app.echo-learn.uk',
  'https://echo-learn.uk',
  'http://localhost:5173',
  'http://localhost:4173',
  'http://127.0.0.1:5173',
];

function resolveOrigin(origin: string | undefined): string | null {
  if (!origin) return null;
  if (ALLOWED_ORIGINS.includes(origin) || origin.endsWith('.vercel.app')) return origin;
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any): Promise<void> {
  const origin = resolveOrigin(req.headers?.origin as string | undefined);
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const sourceUrl = req.query?.url;
  const info = req.query?.info;
  if (typeof sourceUrl !== 'string' || sourceUrl.length > 2048) {
    res.status(400).json({ error: 'Missing or invalid Bilibili URL' });
    return;
  }
  if (info !== '1') {
    res.status(400).json({ error: 'Only short-link info resolution is supported' });
    return;
  }

  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    res.status(400).json({ error: 'Invalid Bilibili URL' });
    return;
  }
  if (!['b23.tv', 'www.bilibili.com', 'm.bilibili.com', 'bilibili.com'].includes(parsed.hostname)) {
    res.status(400).json({ error: 'Unsupported URL host' });
    return;
  }

  const apiKey = process.env.YTDLP_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: 'Bilibili resolver is not configured' });
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const upstream = await fetch(
      `${VPS_API_URL}/api/info?url=${encodeURIComponent(sourceUrl)}`,
      { headers: { 'X-API-Key': apiKey }, signal: controller.signal },
    );
    const body = await upstream.text();
    res.status(upstream.status);
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
    res.send(body);
  } catch (err) {
    const message = err instanceof Error && err.name === 'AbortError'
      ? 'Bilibili resolver timed out'
      : 'Bilibili resolver unavailable';
    res.status(502).json({ error: message });
  } finally {
    clearTimeout(timer);
  }
}
