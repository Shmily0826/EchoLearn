/**
 * Server-side Bilibili fallback proxy.
 *
 * The CF Worker remains the primary client path. This Node function keeps the
 * VPS key server-side and can proxy short-link resolution, transcripts, and
 * audio when the Worker is unavailable.
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

function isBilibiliHost(hostname: string): boolean {
  return ['b23.tv', 'www.bilibili.com', 'm.bilibili.com', 'bilibili.com'].includes(hostname);
}

function getQueryString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any): Promise<void> {
  const origin = resolveOrigin(req.headers?.origin as string | undefined);
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const info = req.query?.info === '1';
  const audio = req.query?.audio === '1';
  const bvid = getQueryString(req.query?.bvid);
  const lang = getQueryString(req.query?.lang) || 'zh-CN';
  const part = getQueryString(req.query?.p);
  const sourceUrl = getQueryString(req.query?.url);

  let upstreamPath: string;
  let timeoutMs = 180_000;

  if (info) {
    if (!sourceUrl || sourceUrl.length > 2048) {
      res.status(400).json({ error: 'Missing or invalid Bilibili URL' });
      return;
    }
    try {
      const parsed = new URL(sourceUrl);
      if (!isBilibiliHost(parsed.hostname)) throw new Error('unsupported host');
    } catch {
      res.status(400).json({ error: 'Invalid Bilibili URL' });
      return;
    }
    upstreamPath = `/api/info?url=${encodeURIComponent(sourceUrl)}`;
    timeoutMs = 30_000;
  } else if (audio) {
    if (!sourceUrl || sourceUrl.length > 2048) {
      res.status(400).json({ error: 'Missing or invalid Bilibili URL' });
      return;
    }
    try {
      const parsed = new URL(sourceUrl);
      if (!isBilibiliHost(parsed.hostname)) throw new Error('unsupported host');
    } catch {
      res.status(400).json({ error: 'Invalid Bilibili URL' });
      return;
    }
    upstreamPath = `/api/audio?url=${encodeURIComponent(sourceUrl)}`;
  } else {
    if (!bvid || !/^BV[a-zA-Z0-9]{10}$/i.test(bvid)) {
      res.status(400).json({ error: 'Missing or invalid Bilibili video ID' });
      return;
    }
    if (part && !/^\d{1,4}$/.test(part)) {
      res.status(400).json({ error: 'Invalid Bilibili part number' });
      return;
    }
    // The VPS exposes Bilibili caption retrieval through its generic
    // /api/transcript route; it has no /api/bilibili endpoint. Keep this
    // fallback caption-only so a Worker failure never starts paid ASR.
    const canonicalUrl = `https://www.bilibili.com/video/${encodeURIComponent(bvid)}${part ? `?p=${encodeURIComponent(part)}` : ''}`;
    upstreamPath = `/api/transcript?url=${encodeURIComponent(canonicalUrl)}&lang=${encodeURIComponent(lang)}`;
  }

  const apiKey = process.env.YTDLP_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: 'Bilibili VPS fallback is not configured' });
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = { 'X-API-Key': apiKey };
    const range = req.headers?.range as string | undefined;
    if (range) headers.Range = range;
    const upstream = await fetch(`${VPS_API_URL}${upstreamPath}`, {
      headers,
      signal: controller.signal,
    });

    res.status(upstream.status);
    const contentType = upstream.headers.get('content-type');
    const contentLength = upstream.headers.get('content-length');
    const contentRange = upstream.headers.get('content-range');
    if (contentType) res.setHeader('Content-Type', contentType);
    if (contentLength) res.setHeader('Content-Length', contentLength);
    if (contentRange) res.setHeader('Content-Range', contentRange);
    if (audio) res.setHeader('Accept-Ranges', 'bytes');

    if (audio) {
      const body = await upstream.arrayBuffer();
      res.send(Buffer.from(body));
    } else {
      res.send(await upstream.text());
    }
  } catch (err) {
    const message = err instanceof Error && err.name === 'AbortError'
      ? 'Bilibili VPS request timed out'
      : 'Bilibili VPS fallback unavailable';
    res.status(502).json({ error: message });
  } finally {
    clearTimeout(timer);
  }
}
