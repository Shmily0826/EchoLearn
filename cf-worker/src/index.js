/**
 * Cloudflare Worker — YouTube transcript proxy.
 *
 * Runs on Cloudflare's edge network with diverse IP ranges,
 * bypassing YouTube's datacenter IP blocking that affects Vercel.
 *
 * Endpoints:
 *   GET /api/transcript?videoId=<id>&lang=<en>
 *   GET /api/transcript?url=<encoded-url>&lang=<en>  (generic yt-dlp URL)
 *   GET /api/bilibili?bvid=<id>&lang=<zh-CN>&info=1  (Bilibili transcript / metadata)
 *   GET /api/audio?url=<encoded-url>  (extracted playback audio, no video — "audio mode")
 *   POST /api/yt?url=<encoded-url>  (CORS proxy for YouTube requests)
 */

// ── Configuration ─────────────────────────────────────────────

const CONSENT_COOKIE =
  'CONSENT=PENDING+987; SOCS=CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjMwODI5LjA3X3AxGgJlbiACGgYIgJnSmgY';

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const ANDROID_UA =
  'com.google.android.youtube/20.10.38 (Linux; U; Android 14)';

const IOS_UA =
  'com.google.ios.youtube/20.10.3 (iPhone; CPU iPhone OS 17_4 like Mac OS X)';

const INNERTUBE_API_URL =
  'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';

const CORS_METHODS = 'GET, POST, OPTIONS';
const TRACE_HEADER = 'X-EchoLearn-Trace-Id';
const CAPTION_DEADLINE_MS = 11000;

function createTraceId() {
  return typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : `trace-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function traceLog(event, fields) {
  console.log(JSON.stringify({ service: 'cf-worker-transcript', event, ...fields }));
}

/** Resolve a provider within a bounded window without leaving a live timer. */
function boundedProviderCall(providerPromise, timeoutMs, onTimeout) {
  let timer;
  return new Promise((resolve) => {
    timer = setTimeout(() => {
      onTimeout();
      resolve(null);
    }, timeoutMs);
    providerPromise.then((value) => {
      clearTimeout(timer);
      resolve(value);
    }, () => {
      clearTimeout(timer);
      resolve(null);
    });
  });
}

function createCaptionContext(timeoutMs = CAPTION_DEADLINE_MS) {
  const controller = new AbortController();
  const deadlineAt = Date.now() + timeoutMs;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    controller,
    signal: controller.signal,
    deadlineAt,
    remainingBudget() { return Math.max(0, deadlineAt - Date.now()); },
    expired() { return Date.now() >= deadlineAt || controller.signal.aborted; },
    dispose() { clearTimeout(timer); },
  };
}

function createProviderContext(parent, timeoutMs) {
  requireCaptionBudget(parent);
  const controller = new AbortController();
  const deadlineAt = Math.min(parent.deadlineAt, Date.now() + timeoutMs);
  const onAbort = () => controller.abort();
  parent.signal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), Math.max(1, deadlineAt - Date.now()));
  return {
    controller,
    signal: controller.signal,
    deadlineAt,
    remainingBudget() { return Math.max(0, deadlineAt - Date.now()); },
    expired() { return Date.now() >= deadlineAt || controller.signal.aborted; },
    dispose() {
      clearTimeout(timer);
      parent.signal.removeEventListener('abort', onAbort);
    },
  };
}

class CaptionDeadlineError extends Error {
  constructor() {
    super('Caption provider deadline exceeded');
    this.name = 'CaptionDeadlineError';
    this.code = 'provider_timeout';
  }
}

function requireCaptionBudget(context) {
  if (context?.expired()) throw new CaptionDeadlineError();
  return context;
}

function providerTimeout(timeoutMs, context) {
  requireCaptionBudget(context);
  return Math.max(1, Math.min(timeoutMs, context?.remainingBudget?.() ?? timeoutMs));
}

// This is configuration/routability capability only; it is not a health check.
function asrRecovery(env) {
  return env && (env.YTDLP_API_URL || env.GROQ_API_KEY)
    ? { canAsr: true, requiresExplicitOptIn: true }
    : undefined;
}

function transcriptErrorResponse(payload, status, env, options = {}) {
  const recovery = options.includeRecovery ? asrRecovery(env) : undefined;
  const headers = options.headers || {};
  return jsonResponse(
    recovery ? { ...payload, recovery } : payload,
    status,
    headers,
  );
}

async function readResponseBody(response, method, context) {
  if (!context) return response[method]();
  requireCaptionBudget(context);
  const remaining = context.remainingBudget();
  if (remaining <= 0) throw new CaptionDeadlineError();
  let timer;
  try {
    return await Promise.race([
      response[method](),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          context.controller.abort();
          reject(new CaptionDeadlineError());
        }, remaining);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// Domains the /api/yt proxy is allowed to forward to.
const ALLOWED_TARGET_DOMAINS = ['youtube.com', 'googlevideo.com', 'googleapis.com'];

/** Exact match or subdomain match (e.g. www.youtube.com) — prevents lookalike bypass. */
function isAllowedHost(hostname) {
  const host = hostname.toLowerCase();
  return ALLOWED_TARGET_DOMAINS.some(
    (domain) => host === domain || host.endsWith('.' + domain),
  );
}

// Origins allowed to call this worker via CORS.
const ALLOWED_ORIGINS = [
  'https://app.echo-learn.uk',
  'https://echo-learn.uk',
  'http://localhost:5173',
  'http://localhost:4173',
  'http://127.0.0.1:5173',
];

function resolveOrigin(origin) {
  if (!origin) return null;
  if (ALLOWED_ORIGINS.includes(origin)) return origin;
  if (origin.endsWith('.vercel.app')) return origin; // Vercel preview deployments
  return null;
}

function corsHeaders(origin) {
  const headers = {
    'Access-Control-Allow-Methods': CORS_METHODS,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Access-Control-Expose-Headers': TRACE_HEADER,
  };
  const allowed = resolveOrigin(origin);
  if (allowed) headers['Access-Control-Allow-Origin'] = allowed;
  return headers;
}

/** Apply restricted CORS headers to a response at the single exit point. */
function withCors(response, origin) {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(corsHeaders(origin))) {
    headers.set(k, v);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// ── Per-IP rate limiting (best-effort, per Cloudflare isolate) ──
// Protects the paid Whisper/Groq fallback from scripted abuse. Isolates are
// short-lived, so this throttles sustained single-IP abuse rather than
// guaranteeing a global cap. For strict global limits, add a Cloudflare
// Rate Limiting binding or dashboard rule.

const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 30; // requests per IP per window
const rateBuckets = new Map(); // ip -> [timestamps]

function isRateLimited(ip) {
  if (!ip) return false;
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  let hits = rateBuckets.get(ip);
  if (!hits) {
    hits = [];
    rateBuckets.set(ip, hits);
  }
  while (hits.length > 0 && hits[0] <= cutoff) hits.shift();
  // Keep the map from growing unbounded across many client IPs.
  if (rateBuckets.size > 5000) {
    for (const [key, val] of rateBuckets) {
      if (val.length === 0 || val[val.length - 1] <= cutoff) rateBuckets.delete(key);
    }
  }
  if (hits.length >= RATE_LIMIT_MAX) return true;
  hits.push(now);
  return false;
}

// ── Instance health tracker (per-isolate, best-effort) ─────────
// Dead instances are skipped for a cooldown period, avoiding repeated
// 8-second timeouts on known-dead hosts. Within a single isolate's
// lifetime this dramatically speeds up the cascade.

const HEALTH_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes before retrying a dead instance
const instanceHealth = new Map(); // url -> { alive: boolean, lastCheck: number }

function recordSuccess(url) {
  instanceHealth.set(url, { alive: true, lastCheck: Date.now() });
}

function recordFailure(url) {
  instanceHealth.set(url, { alive: false, lastCheck: Date.now() });
}

/**
 * Filter and sort instances: alive first, then unknown, then dead
 * (whose cooldown has expired). Dead instances within cooldown are skipped.
 */
function getAliveInstances(instances) {
  const now = Date.now();
  const alive = [];
  const unknown = [];
  const retryable = [];

  for (const url of instances) {
    const h = instanceHealth.get(url);
    if (!h) {
      unknown.push(url);
    } else if (h.alive) {
      alive.push(url);
    } else if (now - h.lastCheck >= HEALTH_COOLDOWN_MS) {
      retryable.push(url); // cooldown expired, worth retrying
    }
    // else: dead and still in cooldown — skip
  }

  return [...alive, ...unknown, ...retryable];
}

// ── Main handler ──────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return withCors(new Response(null, { status: 204 }), origin);
    }

    // Per-IP rate limiting (best-effort, per isolate)
    const ip = request.headers.get('cf-connecting-ip') || '';
    if (isRateLimited(ip)) {
      return withCors(
        jsonResponse({ error: 'Too many requests, please slow down' }, 429),
        origin,
      );
    }

    const url = new URL(request.url);

    try {
      let response;
      if (url.pathname === '/api/transcript') {
        response = await handleTranscript(url, env, createTraceId());
      } else if (url.pathname === '/api/bilibili') {
        response = await handleBilibili(url, env);
      } else if (url.pathname === '/api/audio') {
        response = await handleAudio(request, env);
      } else if (url.pathname === '/api/info') {
        response = await handleInfo(url, env);
      } else if (url.pathname === '/api/yt') {
        response = await handleProxy(request, url);
      } else if (url.pathname === '/api/health') {
        response = handleHealthCheck();
      } else {
        response = jsonResponse({ error: 'Unknown endpoint' }, 404);
      }
      return withCors(response, origin);
    } catch (err) {
      console.error('Worker error:', err);
      return withCors(
        jsonResponse({ error: err.message || 'Internal error' }, 500),
        origin,
      );
    }
  },
};

// ── /api/transcript — Fetch YouTube transcript ────────────────

async function handleTranscript(url, env, traceId) {
  const videoId = url.searchParams.get('videoId');
  const lang = url.searchParams.get('lang') || 'en';
  const allowAsr = url.searchParams.get('allowAsr') === '1';
  // Debug logs are off by default in production. To re-enable for troubleshooting,
  // set the ALLOW_DEBUG=1 environment variable (e.g. `npx wrangler secret put ALLOW_DEBUG`).
  const debug = url.searchParams.get('debug') === '1' && env.ALLOW_DEBUG === '1';

  if (!videoId) {
    return jsonResponse({ error: 'Missing videoId parameter' }, 400, { [TRACE_HEADER]: traceId });
  }
  traceLog('request_start', { traceId, videoId, lang });

  const debugLog = [];
  const log = debug ? (msg) => debugLog.push(msg) : (msg) => console.log(msg);

  // Explicit ASR is an opt-in route, not a slower caption request. Keeping it
  // before the caption context guarantees one intentional ASR branch and avoids
  // spending the caption deadline before the paid/slow operation starts.
  if (allowAsr) {
    if (env && env.YTDLP_API_URL) {
      const asrDiagnostics = {};
      const vpsAsr = await Promise.race([
        fetchViaVpsAsr(
          `https://www.youtube.com/watch?v=${videoId}`,
          env,
          log,
          asrDiagnostics,
          traceId,
        ),
        new Promise((resolve) => setTimeout(() => {
          asrDiagnostics.code = 'provider_timeout';
          resolve(null);
        }, 75000)),
      ]);
      if (vpsAsr) {
        if (debug) vpsAsr._debug = debugLog;
        traceLog('request_finish', { traceId, videoId, provider: 'vps-asr', status: 200, lineCount: vpsAsr.lines?.length || 0 });
        return jsonResponse(vpsAsr, 200, { [TRACE_HEADER]: traceId });
      }
      if (asrDiagnostics.code === 'provider_timeout') {
        traceLog('request_finish', { traceId, videoId, provider: 'vps-asr', status: 504, error: 'provider_timeout' });
        return transcriptErrorResponse({ error: 'provider_timeout', message: 'Transcript provider timed out.' }, 504, env, { includeRecovery: true, headers: { [TRACE_HEADER]: traceId } });
      }
      if (asrDiagnostics.code === 'youtube_acquisition_blocked') {
        const response = { error: 'youtube_acquisition_blocked', message: 'YouTube audio acquisition is currently blocked.' };
        if (debug) response._debug = debugLog;
        traceLog('request_finish', { traceId, videoId, provider: 'vps-asr', status: 403, error: response.error });
        return transcriptErrorResponse(response, 403, env, { headers: { [TRACE_HEADER]: traceId } });
      }
      log('VPS ASR fallback returned nothing');
    } else if (env && env.GROQ_API_KEY) {
      const whisperResult = await fetchViaWhisper(videoId, lang, env, log);
      if (whisperResult) {
        if (debug) whisperResult._debug = debugLog;
        traceLog('request_finish', { traceId, videoId, provider: 'worker-whisper', status: 200, lineCount: whisperResult.lines?.length || 0 });
        return jsonResponse(whisperResult, 200, { [TRACE_HEADER]: traceId });
      }
      log('Whisper fallback failed');
    }
    const response = { error: 'captions_not_found', message: 'No transcript could be generated from audio.' };
    if (debug) response._debug = debugLog;
    traceLog('request_finish', { traceId, videoId, provider: 'asr', status: 404, error: response.error });
    return transcriptErrorResponse(response, 404, env, { headers: { [TRACE_HEADER]: traceId } });
  }

  const captionContext = createCaptionContext();

  // Strategy 0: yt-dlp service on a VPS (client-signature rotation bypasses
  // YouTube's datacenter-IP bot check). Most robust server-side path; only
  // active when YTDLP_API_URL is configured. Requires no residential proxy for
  // the caption path, so other users get transcripts without the developer's
  // PC being online.
  let captionProviderTimedOut = false;
  try {
  if (env && env.YTDLP_API_URL) {
    const vpsContext = createProviderContext(captionContext, 5000);
    const ytdlpResult = await boundedProviderCall(
      fetchViaYtDlp(videoId, lang, env, log, null, traceId, vpsContext),
      providerTimeout(5000, captionContext),
      () => {
        captionProviderTimedOut = true;
        vpsContext.controller.abort();
      },
    );
    vpsContext.dispose();
    if (ytdlpResult) {
      if (debug) ytdlpResult._debug = debugLog;
      traceLog('request_finish', { traceId, videoId, provider: 'vps-transcript', status: 200, lineCount: ytdlpResult.lines?.length || 0 });
      return jsonResponse(ytdlpResult, 200, { [TRACE_HEADER]: traceId });
    }
    log('yt-dlp service returned no transcript — falling through to other strategies');
  }

  // Strategy 1: InnerTube player API (multi-client)
  const innerTubeResult = await fetchViaInnerTube(videoId, lang, env, log, captionContext);
  if (innerTubeResult) {
    if (debug) innerTubeResult._debug = debugLog;
    traceLog('request_finish', { traceId, videoId, provider: 'innertube', status: 200 });
    return jsonResponse(innerTubeResult, 200, { [TRACE_HEADER]: traceId });
  }

  // Strategy 2: Web page scraping
  const webResult = await fetchViaWebPage(videoId, lang, env, log, captionContext);
  if (webResult) {
    if (debug) webResult._debug = debugLog;
    traceLog('request_finish', { traceId, videoId, provider: 'web', status: 200 });
    return jsonResponse(webResult, 200, { [TRACE_HEADER]: traceId });
  }

  // Strategy 3: Invidious API (third-party YouTube frontends)
  const invidiousResult = await fetchViaInvidious(videoId, lang, log, captionContext);
  if (invidiousResult) {
    if (debug) invidiousResult._debug = debugLog;
    traceLog('request_finish', { traceId, videoId, provider: 'invidious', status: 200 });
    return jsonResponse(invidiousResult, 200, { [TRACE_HEADER]: traceId });
  }

  // Strategy 4: Piped API
  const pipedResult = await fetchViaPiped(videoId, lang, log, captionContext);
  if (pipedResult) {
    if (debug) pipedResult._debug = debugLog;
    traceLog('request_finish', { traceId, videoId, provider: 'piped', status: 200 });
    return jsonResponse(pipedResult, 200, { [TRACE_HEADER]: traceId });
  }
  } catch (err) {
    if (err instanceof CaptionDeadlineError) {
      traceLog('request_finish', { traceId, videoId, provider: 'caption-cascade', status: 504, error: 'provider_timeout', deadlineAt: captionContext.deadlineAt });
      return transcriptErrorResponse({ error: 'provider_timeout', message: 'Caption providers timed out.' }, 504, env, { includeRecovery: true, headers: { [TRACE_HEADER]: traceId } });
    }
    throw err;
  } finally {
    captionContext.dispose();
  }

  // Caption-only deadline is also the boundary before any generation path.
  if (captionContext.expired()) {
    traceLog('request_finish', { traceId, videoId, provider: 'caption-cascade', status: 504, error: 'provider_timeout', deadlineAt: captionContext.deadlineAt });
    return transcriptErrorResponse({ error: 'provider_timeout', message: 'Caption providers timed out.' }, 504, env, { includeRecovery: true, headers: { [TRACE_HEADER]: traceId } });
  }

  // VPS ASR availability is represented by YTDLP_API_URL, while Worker
  // Whisper availability is represented by GROQ_API_KEY. Explicit allowAsr=1
  // is still required before either generation path can run.
  const asrAvailable = !!(env && (env.YTDLP_API_URL || env.GROQ_API_KEY));
  const error = captionProviderTimedOut
    ? { error: 'provider_timeout', message: 'Caption providers timed out.' }
    : asrAvailable
      ? { error: 'asr_required', message: 'Caption providers could not provide a transcript; explicit ASR opt-in is required.' }
      : { error: 'captions_not_found', message: 'No caption transcript is available for this video.' };
  const response = error;
  if (debug) response._debug = debugLog;
  const status = response.error === 'asr_required' ? 409 : response.error === 'provider_timeout' ? 504 : 404;
  traceLog('request_finish', { traceId, videoId, provider: 'none', status, error: response.error });
  return transcriptErrorResponse(response, status, env, { includeRecovery: response.error === 'asr_required', headers: { [TRACE_HEADER]: traceId } });
}

// ── /api/bilibili — Fetch Bilibili transcript / metadata ──────────

async function handleBilibili(url, env) {
  const bvid = url.searchParams.get('bvid');
  const lang = url.searchParams.get('lang') || 'zh-CN';
  const info = url.searchParams.get('info') === '1';
  const part = url.searchParams.get('p');

  if (!bvid) {
    return jsonResponse({ error: 'Missing bvid parameter' }, 400);
  }

  let bilibiliUrl = `https://www.bilibili.com/video/${encodeURIComponent(bvid)}`;
  // Bilibili multi-part (分p) videos: forward the part selector so the VPS
  // yt-dlp downloads the requested part instead of always part 1.
  if (part) bilibiliUrl += `?p=${encodeURIComponent(part)}`;

  if (info) {
    // Bilibili answers Cloudflare Worker egress IPs with HTTP 412, so ask the
    // VPS (normal datacenter IP, not blocked) first and only fall back to a
    // direct call — with browser-ish headers — if the VPS is unavailable.
    if (env.YTDLP_API_URL) {
      try {
        const base = env.YTDLP_API_URL.replace(/\/+$/, '');
        const headers = {};
        if (env.YTDLP_API_KEY) headers['X-Api-Key'] = env.YTDLP_API_KEY;
        const resp = await fetchWithTimeout(
          `${base}/api/info?url=${encodeURIComponent(bilibiliUrl)}`,
          { headers },
          30000
        );
        if (resp.ok) return jsonResponse(await resp.json());
      } catch (_) {
        /* fall through to the direct call below */
      }
    }

    const apiUrl = `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`;
    try {
      const resp = await fetchWithTimeout(
        apiUrl,
        {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            Referer: 'https://www.bilibili.com/',
            Origin: 'https://www.bilibili.com',
            'Accept-Language': 'zh-CN,zh;q=0.9',
          },
        },
        10000
      );
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      if (data?.code !== 0) throw new Error(data?.message || 'Bilibili API error');
      const pages = data.data?.pages || [];
      return jsonResponse({
        title: data.data?.title || '',
        ownerName: data.data?.owner?.name || '',
        partCount: data.data?.videos || pages.length || 0,
        parts: pages.map((p) => ({ index: p.page, title: p.part || '' })),
      });
    } catch (err) {
      return jsonResponse({ error: err.message }, 502);
    }
  }

  if (!env.YTDLP_API_URL) {
    return jsonResponse({ error: 'Bilibili transcript proxy not configured' }, 503);
  }

  // Bilibili's watch page returns HTTP 412 from VPS/datacenter IPs, while the
  // public view/playurl APIs and their CDN audio work normally.  Go straight
  // to the VPS API-direct ASR path first; it resolves cid -> playurl -> CDN
  // audio and never asks yt-dlp to open www.bilibili.com/video/....
  const asrDiag = {};
  const asr = await fetchViaVpsAsr(bilibiliUrl, env, console.log, asrDiag);
  if (asr) return jsonResponse(asr);

  // Keep native subtitle extraction as a fallback for videos where ASR is
  // unavailable (for example a temporary Groq quota or duration failure).
  const result = await fetchViaYtDlp(null, lang, env, console.log, bilibiliUrl);
  if (result) return jsonResponse(result);

  return jsonResponse(
    {
      error: 'No transcript available for this Bilibili video',
      hint: 'Subtitle tracks are login-gated and Whisper transcription did not succeed.',
      asrError: asrDiag.message || 'No diagnostic returned by VPS',
    },
    404
  );
}

/**
 * Resolve a Bilibili URL (incl. b23.tv short links) to metadata via the VPS.
 *
 * The VPS /api/info now requires the API key, and that key must never ship in
 * the browser bundle — so the Worker holds it and proxies the request. The
 * frontend calls THIS endpoint (not the VPS directly) to resolve b23.tv links
 * to a BV id.
 */
async function handleInfo(url, env) {
  const target = url.searchParams.get('url');
  if (!target) {
    return jsonResponse({ error: 'Missing url parameter' }, 400);
  }
  if (!env.YTDLP_API_URL) {
    return jsonResponse({ error: 'VPS not configured' }, 503);
  }

  const base = env.YTDLP_API_URL.replace(/\/+$/, '');
  const headers = {};
  if (env.YTDLP_API_KEY) headers['X-Api-Key'] = env.YTDLP_API_KEY;

  try {
    const resp = await fetchWithTimeout(
      `${base}/api/info?url=${encodeURIComponent(target)}`,
      { headers },
      30000,
    );
    if (!resp.ok) {
      return jsonResponse({ error: `VPS returned ${resp.status}` }, resp.status);
    }
    return jsonResponse(await resp.json());
  } catch (err) {
    return jsonResponse({ error: err.message || 'VPS request failed' }, 502);
  }
}

/**
 * Transcribe audio through the VPS /api/asr endpoint (yt-dlp + Groq Whisper).
 *
 * Preferred over the Worker-side Whisper strategy because the VPS pulls audio
 * with yt-dlp directly instead of relying on public Piped/Invidious instances.
 */
async function fetchViaVpsAsr(targetUrl, env, log = console.log, diagnostics = null, traceId = null) {
  if (!env.YTDLP_API_URL) return null;

  const base = env.YTDLP_API_URL.replace(/\/+$/, '');
  const endpoint = `${base}/api/asr?url=${encodeURIComponent(targetUrl)}`;
  const headers = {};
  if (env.YTDLP_API_KEY) headers['X-Api-Key'] = env.YTDLP_API_KEY;
  if (traceId) headers[TRACE_HEADER] = traceId;
  traceId && traceLog('vps_asr_start', { traceId, target: 'youtube', provider: 'vps-asr' });

  try {
    // Download + transcode + transcribe runs synchronously on the VPS; a
    // 30 min video takes well under a minute but the ceiling is generous.
    const resp = await fetchWithTimeout(endpoint, { headers }, 240000);
    if (!resp.ok) {
      const detail = await resp.text();
      let payload = null;
      try { payload = JSON.parse(detail); } catch { /* keep generic diagnostics */ }
      const code = payload?.detail?.code || payload?.error;
      if (code === 'youtube_acquisition_blocked') {
        diagnostics && (diagnostics.code = code);
        traceId && traceLog('vps_asr_result', { traceId, status: resp.status, usable: false, error: code });
        log('VPS ASR reported a bounded YouTube acquisition limitation');
        return null;
      }
      const message = `VPS ASR HTTP ${resp.status}`;
      diagnostics && (diagnostics.message = message);
      traceId && traceLog('vps_asr_result', { traceId, status: resp.status, usable: false });
      log(message);
      return null;
    }
    const data = await resp.json();
    if (!Array.isArray(data?.lines) || data.lines.length === 0) {
      diagnostics && (diagnostics.message = 'VPS ASR returned an empty transcript');
      log('VPS ASR: empty transcript');
      return null;
    }
    traceId && traceLog('vps_asr_result', { traceId, status: resp.status, usable: true, lineCount: data.lines.length });
    log(`VPS ASR: got ${data.lines.length} segments (${data.language})`);
    return data;
  } catch (err) {
    const message = `VPS ASR request failed: ${err.message}`;
    diagnostics && (diagnostics.message = message);
    traceId && traceLog('vps_asr_error', { traceId, error: err?.name === 'AbortError' ? 'timeout' : 'network_or_parse' });
    log(message);
    return null;
  }
}

// ── /api/audio — Serve playback audio (video dropped) ──────────
//
// Powers the app's "audio mode" toggle. The browser plays the extracted
// audio through a native <audio> element — real currentTime, no iframe, no
// black-screen on control, no dead buttons — while the transcript scrolls in
// sync exactly like the YouTube player. The VPS downloads + transcodes the
// audio to a listenable 64 kbps mono mp3 on first request and caches it
// (disk + browser + edge), so repeats are instant.
//
// Bump AUDIO_CACHE_VER whenever the audio codec/bitrate changes so stale
// edge-cached variants are never served (e.g. the 128k-stereo → 64k-mono cut).
const AUDIO_CACHE_VER = '3';

async function handleAudio(request, env) {
  if (!env.YTDLP_API_URL) {
    return jsonResponse({ error: 'Audio service not configured' }, 503);
  }
  const url = new URL(request.url);
  const target = url.searchParams.get('url');
  if (!target) {
    return jsonResponse({ error: 'Missing url parameter' }, 400);
  }

  const base = env.YTDLP_API_URL.replace(/\/+$/, '');
  const vpsUrl = `${base}/api/audio?url=${encodeURIComponent(target)}`;
  const fwd = {};
  if (env.YTDLP_API_KEY) fwd['X-Api-Key'] = env.YTDLP_API_KEY;

  // ── Edge cache (Cloudflare Cache API) ─────────────────────────────
  // Caches the extracted mp3 at the edge so a SECOND user / different device
  // gets it instantly without re-extracting on the VPS. The key is pinned to
  // AUDIO_CACHE_VER and stripped of volatile client headers (Range/Accept/UA)
  // so a range request and a full request share one cached entry. Bumping
  // AUDIO_CACHE_VER invalidates stale (e.g. 0-byte) cached bodies everywhere.
  const cache = caches.default;
  const cacheKeyUrl = new URL(url.toString());
  cacheKeyUrl.searchParams.set('ec_ver', AUDIO_CACHE_VER);
  const cacheKey = new Request(cacheKeyUrl.toString());

  let buf = null;
  let originHeaders = null;
  let status = 200;
  let statusText = 'OK';

  let cached = null;
  try {
    cached = await cache.match(cacheKey);
  } catch (_) {
    /* cache unavailable — fall through to origin */
  }
  if (cached) {
    buf = await cached.arrayBuffer();
    originHeaders = cached.headers;
    status = cached.status;
    statusText = cached.statusText;
  } else {
    try {
      // First request triggers a download + transcode on the VPS; Bilibili routes
      // through a flaky proxy and may take up to ~1–2 min. The VPS bounds its own
      // work to fit under this window, so stream the result straight through.
      const resp = await fetchWithTimeout(vpsUrl, { headers: fwd }, 240000);
      if (!resp.ok) {
        const detail = await resp.text().catch(() => '');
        return jsonResponse(
          {
            error: `Audio extraction failed (VPS ${resp.status})`,
            detail: detail.slice(0, 300),
          },
          resp.status === 404 ? 404 : 502,
        );
      }
      // Read the body ONCE into a buffer so BOTH the cached response and the
      // returned (possibly range-sliced) response are built from it. Using
      // resp.clone() + resp.body shares one stream → cache drains it → 0-byte.
      buf = await resp.arrayBuffer();
      originHeaders = resp.headers;
      status = resp.status;
      statusText = resp.statusText;
      const ct = resp.headers.get('content-type') || '';
      // Only cache real, successful, non-empty audio.
      if (ct.includes('audio') && buf.byteLength > 0) {
        try {
          await cache.put(
            cacheKey,
            new Response(buf, {
              status,
              statusText,
              headers: new Headers(resp.headers),
            }),
          );
        } catch (_) {
          /* cache put failed — still return the audio */
        }
      }
    } catch (err) {
      return jsonResponse({ error: `Audio request failed: ${err.message}` }, 502);
    }
  }

  if (!buf || buf.byteLength === 0) {
    return jsonResponse({ error: 'Audio extraction returned empty body' }, 502);
  }

  const total = buf.byteLength;
  const ct = originHeaders?.get('content-type') || 'audio/mpeg';

  // Honour Range requests — iOS/Android Safari REQUIRE a 206 + Accept-Ranges
  // for <audio>/<video>, otherwise they refuse to load the media ("failed").
  const out = new Headers();
  out.set('Content-Type', ct);
  out.set('Accept-Ranges', 'bytes');
  out.set('Cache-Control', 'no-transform');
  out.set('X-Cache', cached ? 'HIT' : 'MISS');

  const range = request.headers.get('Range');
  const m = range && range.match(/bytes=(\d*)-(\d*)/);
  if (m && total > 0) {
    const start = m[1] ? parseInt(m[1], 10) : 0;
    const end = m[2] ? parseInt(m[2], 10) : total - 1;
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= total) {
      out.set('Content-Range', `bytes */${total}`);
      return new Response(null, { status: 416, headers: out });
    }
    const slice = buf.slice(start, end + 1);
    out.set('Content-Range', `bytes ${start}-${end}/${total}`);
    out.set('Content-Length', String(slice.byteLength));
    return new Response(slice, { status: 206, statusText: 'Partial Content', headers: out });
  }

  out.set('Content-Length', String(total));
  return new Response(buf, { status, statusText, headers: out });
}

// ── InnerTube player API strategy (multi-client) ─────────────

/**
 * Fetch with a timeout to avoid hanging on dead instances.
 */
async function fetchWithTimeout(url, init = {}, timeoutMs = 8000, context = null) {
  const effectiveTimeout = providerTimeout(timeoutMs, context);
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  context?.signal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), effectiveTimeout);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    context?.signal.removeEventListener('abort', onAbort);
  }
}

/**
 * Fetch through a SaaS scraping-API gateway (ScrapingBee / ZenRows) when one is
 * configured via env.SCRAPE_API_KEY. This lets the Worker reach YouTube/Google
 * from a *residential* IP without running a separate relay server — Cloudflare
 * Workers cannot use raw HTTP CONNECT proxies, but these gateways are plain
 * HTTPS endpoints the Worker can call directly.
 *
 * Only GET requests to YouTube/Google hosts are routed (POST bodies like
 * InnerTube can't be forwarded through GET-based gateways, and large binary
 * downloads like googlevideo audio are expensive — those fall through to a
 * normal fetch). When no key is set, this is a transparent pass-through.
 */
async function proxiedFetch(url, init = {}, timeoutMs = 15000, env = {}, log = console.log, context = null) {
  const key = env && env.SCRAPE_API_KEY;
  if (key) {
    const method = (init.method || 'GET').toUpperCase();
    if (method === 'GET') {
      const u = new URL(url);
      const host = u.hostname;
      const isYoutubeish =
        host.endsWith('youtube.com') ||
        host.endsWith('youtu.be') ||
        host.endsWith('google.com') ||
        host.endsWith('googleapis.com') ||
        host.endsWith('ggpht.com') ||
        host.endsWith('ytimg.com');
      if (isYoutubeish) {
        const provider = (env.SCRAPE_API_PROVIDER || 'scrapingbee').toLowerCase();
        if (provider === 'zenrows') {
          const gw = new URL('https://api.zenrows.com/v1/');
          gw.searchParams.set('apikey', key);
          gw.searchParams.set('url', url);
          gw.searchParams.set('js_render', 'true');
          gw.searchParams.set('premium_proxy', 'true');
          gw.searchParams.set('proxy_country', 'us');
          log(`[scrape:zenrows→${host}]`);
          return doScrapeFetch(gw.toString(), timeoutMs, log, context);
        } else {
          const gw = new URL('https://app.scrapingbee.com/api/v1');
          gw.searchParams.set('api_key', key);
          gw.searchParams.set('url', url);
          gw.searchParams.set('render_js', 'true');
          gw.searchParams.set('premium_proxy', 'true');
          gw.searchParams.set('country_code', 'us');
          gw.searchParams.set('timeout', String(Math.min(timeoutMs, 60000)));
          log(`[scrape:scrapingbee→${host}]`);
          return doScrapeFetch(gw.toString(), timeoutMs, log, context);
        }
      }
    }
  }
  return fetchWithTimeout(url, init, timeoutMs, context);
}

/**
 * Perform a scraping-API gateway fetch and log the outcome (status + a short
 * body snippet) so debug traces show whether the gateway itself succeeded.
 */
async function doScrapeFetch(gwUrl, timeoutMs, log = console.log, context = null) {
  try {
    const resp = await fetchWithTimeout(gwUrl, {}, timeoutMs, context);
    let snippet = '';
    try {
      const buf = await readResponseBody(resp.clone(), 'text', context);
      snippet = buf.slice(0, 200).replace(/\s+/g, ' ');
    } catch (_) {
      /* ignore */
    }
    log(`[scrape] HTTP ${resp.status} (${snippet ? snippet + '…' : 'no body'})`);
    return resp;
  } catch (err) {
    log(`[scrape] fetch error: ${err.message}`);
    throw err;
  }
}

async function fetchViaInnerTube(videoId, lang, env, log = console.log, context = null) {
  requireCaptionBudget(context);
  // Try ANDROID first (most reliable for captions), then IOS, then WEB, then TV
  const clients = [
    {
      name: 'ANDROID',
      clientVersion: '20.10.38',
      userAgent: ANDROID_UA,
      apiKey: 'AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w',
    },
    {
      name: 'IOS',
      clientVersion: '20.10.3',
      userAgent: IOS_UA,
      apiKey: 'AIzaSyB-63vPrdThhKuerbB2N_l7Kwwcxj6yUAc',
    },
    {
      name: 'WEB',
      clientVersion: '2.20241201.00.00',
      userAgent: BROWSER_UA,
    },
    {
      name: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER',
      clientVersion: '2.0',
      userAgent: 'Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.5) AppleWebKit/537.36 (KHTML, like Gecko) 94.0.4606.31/6.5 TV Safari/537.36',
    },
  ];

  for (const client of clients) {
    try {
      const clientContext = {
        clientName: client.name,
        clientVersion: client.clientVersion,
        hl: lang,
      };

      // WEB client needs userAgent in context
      if (client.name === 'WEB') {
        clientContext.userAgent = BROWSER_UA;
      }

      const apiUrl = client.apiKey
        ? `${INNERTUBE_API_URL}&key=${client.apiKey}`
        : INNERTUBE_API_URL;

      const resp = await fetchWithTimeout(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': client.userAgent,
          'Cookie': CONSENT_COOKIE,
          ...(client.apiKey && {
            'X-Goog-Api-Key': client.apiKey,
          }),
          ...(client.name === 'WEB' && {
            'X-YouTube-Client-Name': '1',
            'X-YouTube-Client-Version': client.clientVersion,
          }),
        },
        body: JSON.stringify({
          context: { client: clientContext },
          videoId,
          contentCheckOk: true,
          racyCheckOk: true,
        }),
      }, 8000, context);

      if (!resp.ok) {
        log(`InnerTube ${client.name}: HTTP ${resp.status}`);
        continue;
      }

      const data = await readResponseBody(resp, 'json', context);
      const status = data?.playabilityStatus?.status;

      if (status === 'LOGIN_REQUIRED') {
        log(`InnerTube ${client.name}: LOGIN_REQUIRED — ${data?.playabilityStatus?.reason}`);
        continue;
      }

      if (status !== 'OK') {
        log(`InnerTube ${client.name}: ${status} — ${data?.playabilityStatus?.reason}`);
        continue;
      }

      const tracks =
        data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (!Array.isArray(tracks) || tracks.length === 0) {
        log(`InnerTube ${client.name}: OK but no caption tracks`);
        continue;
      }

      log(`InnerTube ${client.name}: found ${tracks.length} caption track(s)`);
      const result = await fetchFromTracks(tracks, lang, env, log, context);
      if (result) return result;
    } catch (err) {
      if (err instanceof CaptionDeadlineError) throw err;
      log(`InnerTube ${client.name} error: ${err.message}`);
    }
  }

  return null;
}

// ── InnerTube player API via GET (routed through scraping gateway) ──
// When a scraping-API key is configured, route a plain GET to the InnerTube
// player endpoint through the residential gateway. This returns the FULL
// caption track list (more reliable than scraping the JS-rendered watch
// page) from a residential IP, bypassing YouTube's datacenter-IP bot check.

async function fetchViaInnerTubeGet(videoId, lang, env, log = console.log, context = null) {
  if (!(env && env.SCRAPE_API_KEY)) return null;
  requireCaptionBudget(context);
  const key = 'AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w';
  const url = `https://www.youtube.com/youtubei/v1/player?videoId=${videoId}&key=${key}&prettyPrint=false`;
  try {
    const resp = await proxiedFetch(
      url,
      {
        headers: {
          'User-Agent': BROWSER_UA,
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': key,
        },
      },
      providerTimeout(30000, context),
      env,
      log,
      context,
    );
    if (!resp.ok) {
      log(`InnerTube-GET: HTTP ${resp.status}`);
      return null;
    }
    const data = await readResponseBody(resp, 'json', context);
    const status = data?.playabilityStatus?.status;
    if (status !== 'OK') {
      log(`InnerTube-GET: ${status} — ${data?.playabilityStatus?.reason}`);
      return null;
    }
    const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!Array.isArray(tracks) || tracks.length === 0) {
      log('InnerTube-GET: OK but no caption tracks');
      return null;
    }
    log(`InnerTube-GET: found ${tracks.length} caption track(s)`);
    return fetchFromTracks(tracks, lang, env, log, context);
  } catch (err) {
    if (err instanceof CaptionDeadlineError) throw err;
    log(`InnerTube-GET error: ${err.message}`);
    return null;
  }
}

// ── Web page scraping strategy ────────────────────────────────

async function fetchViaWebPage(videoId, lang, env, log = console.log, context = null) {
  try {
    requireCaptionBudget(context);
    const pageUrl = `https://www.youtube.com/watch?v=${videoId}&bpctr=9999&has_verified=1`;
    const resp = await proxiedFetch(pageUrl, {
      headers: {
        'User-Agent': BROWSER_UA,
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml',
        'Cookie': CONSENT_COOKIE,
      },
    }, providerTimeout(45000, context), env, log, context);

    if (!resp.ok) {
      log(`Web page: HTTP ${resp.status}`);
      return null;
    }

    const html = await readResponseBody(resp, 'text', context);
    log(`Web page: ${html.length} bytes`);

    // Check if this is a CAPTCHA/bot challenge page (not just the word appearing in JS code)
    // A real CAPTCHA page is typically small (< 50KB) and has specific markers
    const isCaptchaPage =
      html.includes('class="g-recaptcha"') ||
      html.includes('id="captcha-form"') ||
      html.includes('<title>Sorry') ||
      (html.includes('unusual traffic') && html.length < 100000);

    if (isCaptchaPage) {
      log('Web page: CAPTCHA/bot challenge page detected');
      return null;
    }

    // Check page title to understand what we got
    const titleMatch = html.match(/<title>(.*?)<\/title>/);
    log(`Web page title: "${titleMatch ? titleMatch[1] : 'N/A'}"`);

    // Extract ytInitialPlayerResponse using proper JSON parsing
    const patterns = [
      'var ytInitialPlayerResponse = ',
      'ytInitialPlayerResponse = ',
    ];

    for (const token of patterns) {
      const idx = html.indexOf(token);
      if (idx < 0) {
        log(`Web page: pattern "${token.substring(0, 30)}..." not found`);
        continue;
      }

      log(`Web page: found pattern at index ${idx}`);
      const jsonStart = idx + token.length;
      // Find the opening brace
      if (html[jsonStart] !== '{') {
        log(`Web page: no opening brace at jsonStart (got '${html[jsonStart]}')`);
        continue;
      }

      const jsonStr = extractJsonObject(html, jsonStart);
      if (!jsonStr) {
        log('Web page: JSON extraction returned null');
        continue;
      }

      log(`Web page: extracted JSON (${jsonStr.length} chars)`);

      try {
        const playerResponse = JSON.parse(jsonStr);
        log(`Web page: JSON parsed successfully`);

        // Check playability
        const playability = playerResponse?.playabilityStatus;
        if (playability?.status !== 'OK') {
          log(`Web page: playability=${playability?.status} — ${playability?.reason}`);
        }

        const tracks =
          playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        if (!Array.isArray(tracks) || tracks.length === 0) {
          log('Web page: player response has no caption tracks');
          // Check if captions field exists at all
          const hasCaptions = !!playerResponse?.captions;
          log(`Web page: captions field exists=${hasCaptions}`);
          continue;
        }

        log(`Web page: found ${tracks.length} caption track(s)`);
        const result = await fetchFromTracks(tracks, lang, env, log, context);
        if (result) return result;
      } catch (e) {
        log(`Web page: JSON parse failed: ${e.message}`);
      }
    }

    log('Web page: could not extract player response');
    return null;
  } catch (err) {
    if (err instanceof CaptionDeadlineError) throw err;
    log(`Web page error: ${err.message}`);
    return null;
  }
}

/**
 * Extract a complete JSON object from a string, properly handling
 * string literals, escape sequences, and nested objects.
 */
function extractJsonObject(src, startIdx) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startIdx; i < src.length; i++) {
    const ch = src[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (inString) {
      if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return src.slice(startIdx, i + 1);
      }
    }
  }

  return null;
}

// ── Fetch and parse caption tracks ────────────────────────────

async function fetchFromTracks(tracks, lang, env, log = console.log, context = null) {
  requireCaptionBudget(context);
  // Select best track for the requested language
  const manual = tracks.find((t) => t.languageCode === lang && t.kind !== 'asr');
  const auto = tracks.find((t) => t.languageCode === lang && t.kind === 'asr');
  const anyLang = tracks.find((t) => t.languageCode === lang);
  const track = manual || auto || anyLang || tracks[0];

  const trackLang = track.languageCode || lang;
  const isAutoGenerated = track.kind === 'asr';

  // Try json3 first (most common from InnerTube), then default, then srv3
  for (const fmt of ['json3', undefined, 'srv3']) {
    try {
      let captionUrl = track.baseUrl;
      if (fmt && !captionUrl.includes('fmt=')) {
        captionUrl += (captionUrl.includes('?') ? '&' : '?') + `fmt=${fmt}`;
      }

      // Try a direct fetch first (timedtext is usually far less protected than
      // the watch page); fall back to the scraping gateway only if that fails.
      const capHeaders = {
        'User-Agent': BROWSER_UA,
        'Accept-Language': lang,
        'Cookie': CONSENT_COOKIE,
        'Referer': 'https://www.youtube.com/',
        'Origin': 'https://www.youtube.com',
      };
      let resp = await fetchWithTimeout(captionUrl, { headers: capHeaders }, 20000, context);
      let directBodyLen = 0;
      try {
        const probe = await readResponseBody(resp.clone(), 'text', context);
        directBodyLen = probe.length;
      } catch (_) {
        /* ignore */
      }
      if (!resp.ok || directBodyLen < 20) {
        log(
          `Caption direct fetch ${resp.status} len=${directBodyLen}, trying scrape gateway`,
        );
        resp = await proxiedFetch(captionUrl, { headers: capHeaders }, 30000, env, log, context);
      }

      if (!resp.ok) continue;
      const text = await readResponseBody(resp, 'text', context);

      const lines = parseCaptionData(text);
      if (lines.length > 0) {
        console.log(`Caption fetch (${fmt || 'default'}): ${lines.length} lines`);
        return {
          lines,
          language: trackLang,
          isAutoGenerated,
        };
      }
    } catch (err) {
      if (err instanceof CaptionDeadlineError) throw err;
      console.warn(`Caption fetch (${fmt || 'default'}) failed:`, err.message);
      continue;
    }
  }

  return null;
}

// ── Caption parsing ───────────────────────────────────────────

function parseCaptionData(data) {
  // Try JSON3 format
  if (data.trimStart().startsWith('{')) {
    try {
      const json = JSON.parse(data);
      const lines = parseJson3(json);
      if (lines.length > 0) return lines;
    } catch {
      // not JSON
    }
  }

  // Try VTT format
  if (data.includes('WEBVTT')) {
    const lines = parseVTT(data);
    if (lines.length > 0) return lines;
  }

  // Try XML formats
  return parseXml(data);
}

function parseJson3(json) {
  const events = json.events || [];
  const lines = [];
  let id = 0;
  for (const event of events) {
    const text = (event.segs || []).map((s) => s.utf8).join('').trim();
    if (!text || text === '\n') continue;
    lines.push({
      id: `yt_${++id}`,
      start: event.tStartMs / 1000,
      end: (event.tStartMs + event.dDurationMs) / 1000,
      text,
    });
  }
  return lines;
}

function parseXml(xml) {
  const lines = [];
  let id = 0;
  let match;

  // srv3 format: <p t="ms" d="ms"><s>word</s>...</p>
  const pRegex = /<p\s+t="(\d+)"\s+d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;
  while ((match = pRegex.exec(xml)) !== null) {
    const startMs = parseInt(match[1], 10);
    const durMs = parseInt(match[2], 10);
    const inner = match[3];
    let text = '';
    const sRegex = /<s[^>]*>([^<]*)<\/s>/g;
    let sMatch;
    while ((sMatch = sRegex.exec(inner)) !== null) {
      text += sMatch[1];
    }
    if (!text) text = inner.replace(/<[^>]+>/g, '');
    text = decodeEntities(text).trim();
    if (text) {
      lines.push({
        id: `yt_${++id}`,
        start: startMs / 1000,
        end: (startMs + durMs) / 1000,
        text,
      });
    }
  }
  if (lines.length > 0) return lines;

  // Classic format: <text start="s" dur="s">content</text>
  const classicRegex =
    /<text\s+start="([\d.]+)"\s+dur="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g;
  while ((match = classicRegex.exec(xml)) !== null) {
    const start = parseFloat(match[1]);
    const dur = parseFloat(match[2]);
    const text = decodeEntities(match[3]).replace(/\n/g, ' ').trim();
    if (text) {
      lines.push({
        id: `yt_${++id}`,
        start,
        end: start + dur,
        text,
      });
    }
  }
  return lines;
}

function decodeEntities(str) {
  return str
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\\u0026/g, '&')
    .replace(/\\"/g, '"');
}

// ── /api/yt — CORS proxy for YouTube requests ────────────────

async function handleProxy(request, url) {
  const targetUrl = url.searchParams.get('url');
  if (!targetUrl) {
    return jsonResponse({ error: 'Missing ?url= parameter' }, 400);
  }

  try {
    const target = new URL(targetUrl);
    if (!isAllowedHost(target.hostname)) {
      return jsonResponse({ error: 'Only YouTube URLs allowed' }, 403);
    }

    const isPost = request.method === 'POST';
    const headers = new Headers();

    if (isPost) {
      headers.set('User-Agent', ANDROID_UA);
    } else {
      headers.set('User-Agent', BROWSER_UA);
    }
    headers.set('Accept', isPost ? 'application/json' : 'text/html,*/*');
    headers.set('Accept-Language', 'en-US,en;q=0.9');
    headers.set('Cookie', CONSENT_COOKIE);

    const contentType = request.headers.get('Content-Type');
    if (contentType) headers.set('Content-Type', contentType);

    const init = {
      method: request.method,
      headers,
      redirect: 'follow',
    };

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = await request.arrayBuffer();
    }

    const response = await fetch(targetUrl, init);

    const responseHeaders = new Headers(response.headers);
    responseHeaders.delete('x-frame-options');
    responseHeaders.delete('content-security-policy');

    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch (err) {
    return jsonResponse({ error: `Proxy error: ${err.message}` }, 502);
  }
}

// ── Invidious API strategy ────────────────────────────────────

/**
 * Use public Invidious instances to fetch transcripts.
 * Invidious instances proxy YouTube and may have different IP reputation.
 */
const INVIDIOUS_INSTANCES = [
  'https://inv.nadeko.net',
  'https://invidious.f5.si',
  'https://yt.chocolatemoo53.com',
  'https://inv.thepixora.com',
  'https://invidious.nerdvpn.de',
  'https://invidious.privacydev.net',
  'https://yt.artemislena.eu',
  'https://vid.puffyan.us',
  'https://invidious.io.lol',
  'https://yewtu.be',
];

async function fetchViaInvidious(videoId, lang, log = console.log, context = null) {
  requireCaptionBudget(context);
  const instances = getAliveInstances(INVIDIOUS_INSTANCES);
  if (instances.length === 0) {
    log('Invidious: all instances in cooldown, skipping');
    return null;
  }

  for (const instance of instances) {
    requireCaptionBudget(context);
    const hostname = new URL(instance).hostname;
    try {
      // Invidious API: GET /api/v1/captions/:id
      const captionsUrl = `${instance}/api/v1/captions/${videoId}`;
      const resp = await fetchWithTimeout(captionsUrl, {
        headers: { 'User-Agent': BROWSER_UA, 'Accept': 'application/json' },
      }, providerTimeout(8000, context), context);

      if (!resp.ok) {
        log(`Invidious (${hostname}): HTTP ${resp.status}`);
        recordFailure(instance);
        continue;
      }

      const data = await readResponseBody(resp, 'json', context).catch((err) => {
        if (err instanceof CaptionDeadlineError) throw err;
        return null;
      });
      if (!data) {
        log(`Invidious (${hostname}): invalid JSON response`);
        recordFailure(instance);
        continue;
      }

      const captions = data.captions;
      if (!Array.isArray(captions) || captions.length === 0) {
        log(`Invidious (${hostname}): no captions`);
        recordFailure(instance);
        continue;
      }

      log(`Invidious (${hostname}): ${captions.length} caption(s) available`);

      // Find matching language track
      const track = captions.find(c => c.languageCode === lang && c.kind !== 'asr')
        || captions.find(c => c.languageCode === lang && c.kind === 'asr')
        || captions.find(c => c.languageCode === lang)
        || captions[0];

      // Fetch the actual caption content via Invidious proxy
      let captionUrl;
      if (track.url.startsWith('http')) {
        captionUrl = track.url;
      } else {
        captionUrl = `${instance}${track.url.startsWith('/') ? '' : '/'}${track.url}`;
      }

      // Try multiple format approaches
      for (const fmt of [null, 'vtt', 'xml']) {
        try {
          let tryUrl = captionUrl;
          if (fmt && !tryUrl.includes('format=')) {
            tryUrl += (tryUrl.includes('?') ? '&' : '?') + `format=${fmt}`;
          }

          const captionResp = await fetchWithTimeout(tryUrl, {
            headers: { 'User-Agent': BROWSER_UA, 'Accept': '*/*' },
          }, 8000, context);

          if (!captionResp.ok) continue;
          const captionText = await readResponseBody(captionResp, 'text', context);

          if (captionText.length === 0) {
            log(`Invidious (${hostname}): empty caption (${fmt || 'default'})`);
            continue;
          }

          const lines = parseCaptionData(captionText);
          if (lines.length > 0) {
            log(`Invidious (${hostname}): got ${lines.length} lines (${fmt || 'default'})`);
            recordSuccess(instance);
            return {
              lines,
              language: track.languageCode || lang,
              isAutoGenerated: track.kind === 'asr',
            };
          }
        } catch (err) {
          if (err instanceof CaptionDeadlineError) throw err;
          continue;
        }
      }

      log(`Invidious (${hostname}): all formats returned empty`);
      recordFailure(instance);
    } catch (err) {
      if (err instanceof CaptionDeadlineError) throw err;
      log(`Invidious (${hostname}): ${err.message}`);
      recordFailure(instance);
    }
  }

  return null;
}

// ── Piped API strategy ────────────────────────────────────────

/**
 * Use Piped instances (another YouTube frontend) to fetch subtitles.
 * Piped API: GET /streams/:videoId returns video info including subtitles.
 */
const PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://piped-api.lunar.icu',
  'https://api.piped.yt',
  'https://pipedapi.r4fo.com',
  'https://piped.adminforge.de',
  'https://api.piped.privacydev.net',
];

async function fetchViaPiped(videoId, lang, log = console.log, context = null) {
  requireCaptionBudget(context);
  const instances = getAliveInstances(PIPED_INSTANCES);
  if (instances.length === 0) {
    log('Piped: all instances in cooldown, skipping');
    return null;
  }

  for (const instance of instances) {
    requireCaptionBudget(context);
    const hostname = new URL(instance).hostname;
    try {
      const resp = await fetchWithTimeout(`${instance}/streams/${videoId}`, {
        headers: { 'User-Agent': BROWSER_UA, 'Accept': 'application/json' },
      }, providerTimeout(8000, context), context);

      if (!resp.ok) {
        log(`Piped (${hostname}): HTTP ${resp.status}`);
        recordFailure(instance);
        continue;
      }

      const data = await readResponseBody(resp, 'json', context);
      const subtitles = data.subtitles;
      if (!Array.isArray(subtitles) || subtitles.length === 0) {
        log(`Piped (${hostname}): no subtitles`);
        recordFailure(instance);
        continue;
      }

      log(`Piped (${hostname}): ${subtitles.length} subtitle(s)`);

      // Find matching language
      const sub = subtitles.find(s => s.code === lang && !s.autoGenerated)
        || subtitles.find(s => s.code === lang && s.autoGenerated)
        || subtitles.find(s => s.code === lang)
        || subtitles[0];

      if (!sub.url) {
        log(`Piped (${hostname}): no URL for subtitle`);
        recordFailure(instance);
        continue;
      }

      const subResp = await fetchWithTimeout(sub.url, {
        headers: { 'User-Agent': BROWSER_UA, 'Accept': '*/*' },
      }, 8000, context);

      if (!subResp.ok) {
        recordFailure(instance);
        continue;
      }
      const subText = await readResponseBody(subResp, 'text', context);

      let lines = parseCaptionData(subText);
      if (lines.length === 0 && subText.includes('WEBVTT')) {
        lines = parseVTT(subText);
      }

      if (lines.length > 0) {
        log(`Piped (${hostname}): got ${lines.length} lines`);
        recordSuccess(instance);
        return {
          lines,
          language: sub.code || lang,
          isAutoGenerated: !!sub.autoGenerated,
        };
      }

      recordFailure(instance);
    } catch (err) {
      if (err instanceof CaptionDeadlineError) throw err;
      log(`Piped (${hostname}): ${err.message}`);
      recordFailure(instance);
    }
  }

  return null;
}

// ── Whisper ASR strategy (Groq API) ───────────────────────────

/**
 * Last-resort strategy: extract audio from the video and transcribe
 * using Groq's Whisper API (free tier, whisper-large-v3-turbo).
 *
 * Audio sources (tried in order):
 *   1. Piped instances' audioStreams
 *   2. InnerTube adaptiveFormats (ANDROID client)
 * Groq accepts up to 25 MB audio files.
 */
async function fetchViaWhisper(videoId, lang, env, log = console.log) {
  if (!env || !env.GROQ_API_KEY) {
    log('Whisper: no GROQ_API_KEY configured, skipping');
    return null;
  }

  // Step 1a: Try getting audio URL from Piped instances (respect health cooldown)
  let audioUrl = null;
  let audioSource = null;
  const alivePiped = getAliveInstances(PIPED_INSTANCES);
  if (alivePiped.length === 0) {
    log('Whisper: all Piped instances in cooldown, skipping');
  }
  for (const instance of alivePiped) {
    try {
      const resp = await fetchWithTimeout(`${instance}/streams/${videoId}`, {
        headers: { 'User-Agent': BROWSER_UA, 'Accept': 'application/json' },
      }, 8000);

      if (!resp.ok) {
        log(`Whisper: Piped (${new URL(instance).hostname}): HTTP ${resp.status}`);
        recordFailure(instance);
        continue;
      }
      const data = await resp.json();

      const streams = data.audioStreams;
      if (!Array.isArray(streams) || streams.length === 0) {
        log(`Whisper: Piped (${new URL(instance).hostname}): no audioStreams`);
        recordFailure(instance);
        continue;
      }

      // Pick lowest bitrate to stay under Groq's 25 MB limit
      const sorted = [...streams].sort((a, b) => (a.bitrate || 0) - (b.bitrate || 0));
      audioUrl = sorted[0].url;
      audioSource = `Piped (${new URL(instance).hostname})`;
      log(`Whisper: audio URL from ${audioSource}, ${sorted.length} stream(s)`);
      recordSuccess(instance);
      break;
    } catch (err) {
      log(`Whisper: Piped (${new URL(instance).hostname}): ${err.message}`);
      recordFailure(instance);
    }
  }

  // Step 1b: Fallback — get audio URL from InnerTube adaptiveFormats
  if (!audioUrl) {
    log('Whisper: Piped failed, trying InnerTube adaptiveFormats');
    try {
      const resp = await fetchWithTimeout(
        `${INNERTUBE_API_URL}&key=AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': ANDROID_UA,
            'Cookie': CONSENT_COOKIE,
            'X-Goog-Api-Key': 'AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w',
          },
          body: JSON.stringify({
            context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38', hl: lang } },
            videoId,
            contentCheckOk: true,
            racyCheckOk: true,
          }),
        },
        10000,
      );

      if (resp.ok) {
        const data = await resp.json();
        const formats = data?.streamingData?.adaptiveFormats;
        if (Array.isArray(formats)) {
          // Filter audio-only streams, pick lowest bitrate
          const audioFormats = formats
            .filter((f) => f.mimeType && f.mimeType.startsWith('audio/') && f.url)
            .sort((a, b) => (a.bitrate || 0) - (b.bitrate || 0));
          if (audioFormats.length > 0) {
            audioUrl = audioFormats[0].url;
            audioSource = 'InnerTube adaptiveFormats';
            log(`Whisper: audio URL from ${audioSource} (${audioFormats.length} audio stream(s))`);
          }
        }
      } else {
        log(`Whisper: InnerTube HTTP ${resp.status}`);
      }
    } catch (err) {
      log(`Whisper: InnerTube adaptiveFormats failed: ${err.message}`);
    }
  }

  // Step 1c: Second fallback — get audio URL from Invidious instances.
  // Invidious proxies media through its own infrastructure, so it can work
  // when Piped/InnerTube are blocked by YouTube's datacenter IP restrictions.
  if (!audioUrl) {
    log('Whisper: InnerTube failed, trying Invidious for audio URL');
    const aliveInvidious = getAliveInstances(INVIDIOUS_INSTANCES);
    if (aliveInvidious.length === 0) {
      log('Whisper: all Invidious instances in cooldown, skipping');
    }
    for (const instance of aliveInvidious) {
      try {
        const resp = await fetchWithTimeout(`${instance}/api/v1/videos/${videoId}`, {
          headers: { 'User-Agent': BROWSER_UA, 'Accept': 'application/json' },
        }, 8000);

        if (!resp.ok) {
          log(`Whisper: Invidious (${new URL(instance).hostname}): HTTP ${resp.status}`);
          recordFailure(instance);
          continue;
        }

        const data = await resp.json().catch(() => null);
        if (!data) {
          log(`Whisper: Invidious (${new URL(instance).hostname}): invalid JSON`);
          recordFailure(instance);
          continue;
        }

        // adaptiveFormats contains separate audio/video streams
        const formats = data.adaptiveFormats || data.formatStreams;
        if (!Array.isArray(formats) || formats.length === 0) {
          log(`Whisper: Invidious (${new URL(instance).hostname}): no adaptiveFormats`);
          recordFailure(instance);
          continue;
        }

        const audioFormats = formats
          .filter((f) => f.type && f.type.startsWith('audio/') && f.url)
          .sort((a, b) => (a.bitrate || 0) - (b.bitrate || 0));

        if (audioFormats.length === 0) {
          log(`Whisper: Invidious (${new URL(instance).hostname}): no audio streams`);
          recordFailure(instance);
          continue;
        }

        let url = audioFormats[0].url;
        // Some instances return relative URLs
        if (url && !url.startsWith('http')) {
          url = `${instance}${url.startsWith('/') ? '' : '/'}${url}`;
        }
        audioUrl = url;
        audioSource = `Invidious (${new URL(instance).hostname})`;
        log(`Whisper: audio URL from ${audioSource} (${audioFormats.length} audio stream(s))`);
        recordSuccess(instance);
        break;
      } catch (err) {
        log(`Whisper: Invidious (${new URL(instance).hostname}): ${err.message}`);
        recordFailure(instance);
      }
    }
  }

  if (!audioUrl) {
    log('Whisper: could not obtain audio URL from any source');
    return null;
  }

  // Step 2: Download audio
  let audioBuffer;
  try {
    const audioResp = await fetchWithTimeout(audioUrl, {
      headers: { 'User-Agent': BROWSER_UA },
    }, 30000);

    if (!audioResp.ok) {
      log(`Whisper: audio download HTTP ${audioResp.status}`);
      return null;
    }

    audioBuffer = await audioResp.arrayBuffer();

    // Groq limit is 25 MB
    if (audioBuffer.byteLength > 25 * 1024 * 1024) {
      log(`Whisper: audio too large (${(audioBuffer.byteLength / 1024 / 1024).toFixed(1)} MB)`);
      return null;
    }

    log(`Whisper: downloaded ${(audioBuffer.byteLength / 1024 / 1024).toFixed(1)} MB audio`);
  } catch (err) {
    log(`Whisper: audio download failed: ${err.message}`);
    return null;
  }

  // Step 3: Send to Groq Whisper API
  try {
    const formData = new FormData();
    formData.append('file', new File([audioBuffer], 'audio.mp3', { type: 'audio/mpeg' }));
    formData.append('model', 'whisper-large-v3-turbo');
    formData.append('response_format', 'verbose_json');
    // Pass language hint to improve accuracy (Whisper uses ISO 639-1 codes)
    const whisperLang = lang === 'zh' ? 'zh' : lang === 'ja' ? 'ja' : lang === 'ko' ? 'ko' : 'en';
    formData.append('language', whisperLang);

    const groqResp = await fetchWithTimeout('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.GROQ_API_KEY}`,
      },
      body: formData,
    }, 120000); // 2 min timeout for long videos

    if (!groqResp.ok) {
      const errText = await groqResp.text();
      log(`Whisper: Groq API HTTP ${groqResp.status}: ${errText.substring(0, 200)}`);
      return null;
    }

    const result = await groqResp.json();
    const segments = result.segments;

    if (!Array.isArray(segments) || segments.length === 0) {
      log('Whisper: no segments in response');
      // Try falling back to the full text if segments aren't available
      if (result.text && result.text.trim()) {
        log(`Whisper: using full text fallback (${result.text.length} chars)`);
        return {
          lines: [{
            id: 'yt_1',
            start: 0,
            end: 999,
            text: result.text.trim(),
          }],
          language: lang,
          isAutoGenerated: true,
        };
      }
      return null;
    }

    const lines = segments.map((seg, i) => ({
      id: `yt_${i + 1}`,
      start: Math.round(seg.start * 100) / 100,
      end: Math.round(seg.end * 100) / 100,
      text: seg.text.trim(),
    }));

    log(`Whisper: got ${lines.length} segments via Groq`);
    return {
      lines,
      language: lang,
      isAutoGenerated: true,
    };
  } catch (err) {
    log(`Whisper: Groq API failed: ${err.message}`);
    return null;
  }
}

/**
 * Parse WebVTT format subtitles.
 */
function parseVTT(text) {
  const lines = [];
  let id = 0;
  const blocks = text.split(/\n\n+/);

  for (const block of blocks) {
    const lines_in_block = block.trim().split('\n');
    // Find the timestamp line (format: HH:MM:SS.mmm --> HH:MM:SS.mmm)
    for (let i = 0; i < lines_in_block.length; i++) {
      const timeMatch = lines_in_block[i].match(
        /(\d{1,2}:?\d{2}:\d{2}[\.,]\d{3})\s*-->\s*(\d{1,2}:?\d{2}:\d{2}[\.,]\d{3})/
      );
      if (timeMatch) {
        const start = parseVTTTime(timeMatch[1]);
        const end = parseVTTTime(timeMatch[2]);
        const content = lines_in_block.slice(i + 1).join('\n').trim();
        if (content) {
          lines.push({
            id: `yt_${++id}`,
            start,
            end,
            text: content.replace(/<[^>]+>/g, ''), // Strip VTT tags
          });
        }
        break;
      }
    }
  }

  return lines;
}

function parseVTTTime(str) {
  const parts = str.replace(',', '.').split(':');
  if (parts.length === 3) {
    return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
  }
  if (parts.length === 2) {
    return parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
  }
  return parseFloat(str);
}

// ── Helpers ───────────────────────────────────────────────────

/** Returns current instance health status for monitoring / cron warm-up. */
function handleHealthCheck() {
  const now = Date.now();
  const status = (url) => {
    const h = instanceHealth.get(url);
    if (!h) return 'unknown';
    if (h.alive) return 'alive';
    if (now - h.lastCheck >= HEALTH_COOLDOWN_MS) return 'cooldown-expired';
    return `dead (${Math.ceil((HEALTH_COOLDOWN_MS - (now - h.lastCheck)) / 60000)}m left)`;
  };

  return jsonResponse({
    invidious: INVIDIOUS_INSTANCES.map((u) => ({ url: u, status: status(u) })),
    piped: PIPED_INSTANCES.map((u) => ({ url: u, status: status(u) })),
    aliveInvidious: getAliveInstances(INVIDIOUS_INSTANCES).length,
    alivePiped: getAliveInstances(PIPED_INSTANCES).length,
  });
}

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
  });
}

// ── yt-dlp VPS service strategy ─────────────────────────────────

/**
 * Call the self-hosted yt-dlp transcript service (see /vps-ytdlp).
 * The service returns the same { lines, language, isAutoGenerated } shape the
 * frontend expects, so we pass it straight through.
 */
async function fetchViaYtDlp(videoId, lang, env, log, targetUrl = null, traceId = null, context = null) {
  const base = env.YTDLP_API_URL.replace(/\/+$/, '');
  const qs = targetUrl
    ? `url=${encodeURIComponent(targetUrl)}&lang=${encodeURIComponent(lang)}`
    : `videoId=${encodeURIComponent(videoId)}&lang=${encodeURIComponent(lang)}`;
  const url = `${base}/api/transcript?${qs}`;
  const headers = {};
  if (env.YTDLP_API_KEY) headers['X-Api-Key'] = env.YTDLP_API_KEY;
  if (traceId) headers[TRACE_HEADER] = traceId;
  traceId && traceLog('vps_transcript_start', { traceId, videoId });

  try {
    // Bilibili extraction must route through the flaky residential proxy and can
    // run ~60s; give it headroom so a slow-but-valid fetch isn't cut at the edge.
    const resp = await fetchWithTimeout(url, { headers }, targetUrl ? 90000 : 15000, context);
    if (resp.status === 404) {
      log('yt-dlp: 404 No transcript available');
      traceId && traceLog('vps_transcript_result', { traceId, videoId, status: resp.status, usable: false });
      return null;
    }
    if (resp.status === 401) {
      log('yt-dlp: 401 unauthorized (check YTDLP_API_KEY)');
      traceId && traceLog('vps_transcript_result', { traceId, videoId, status: resp.status, usable: false });
      return null;
    }
    if (!resp.ok) {
      log(`yt-dlp: HTTP ${resp.status}`);
      traceId && traceLog('vps_transcript_result', { traceId, videoId, status: resp.status, usable: false });
      return null;
    }
    const data = await readResponseBody(resp, 'json', context);
    if (data && Array.isArray(data.lines) && data.lines.length > 0) {
      log(`yt-dlp: got ${data.lines.length} lines (${data.language})`);
      return {
        lines: data.lines,
        language: data.language || lang,
        isAutoGenerated: !!data.isAutoGenerated,
      };
    }
    return null;
  } catch (err) {
    if (err instanceof CaptionDeadlineError) throw err;
    log(`yt-dlp fetch error: ${err.message}`);
    return null;
  }
}

// Narrow named exports keep the Worker runtime contract unchanged while
// allowing deterministic unit tests to exercise the deadline primitives and
// request handler without a deployed Worker.
export {
  CAPTION_DEADLINE_MS,
  CaptionDeadlineError,
  asrRecovery,
  createCaptionContext,
  createProviderContext,
  handleTranscript,
  readResponseBody,
};
