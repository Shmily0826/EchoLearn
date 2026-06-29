/**
 * Cloudflare Worker — YouTube transcript proxy.
 *
 * Runs on Cloudflare's edge network with diverse IP ranges,
 * bypassing YouTube's datacenter IP blocking that affects Vercel.
 *
 * Endpoints:
 *   GET /api/transcript?videoId=<id>&lang=<en>
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

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

// ── Main handler ──────────────────────────────────────────────

export default {
  async fetch(request) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    try {
      if (url.pathname === '/api/transcript') {
        return await handleTranscript(url);
      }
      if (url.pathname === '/api/yt') {
        return await handleProxy(request, url);
      }
      return jsonResponse({ error: 'Unknown endpoint' }, 404);
    } catch (err) {
      console.error('Worker error:', err);
      return jsonResponse(
        { error: err.message || 'Internal error' },
        500,
      );
    }
  },
};

// ── /api/transcript — Fetch YouTube transcript ────────────────

async function handleTranscript(url) {
  const videoId = url.searchParams.get('videoId');
  const lang = url.searchParams.get('lang') || 'en';
  const debug = url.searchParams.get('debug') === '1';

  if (!videoId) {
    return jsonResponse({ error: 'Missing videoId parameter' }, 400);
  }

  const debugLog = [];
  const log = debug ? (msg) => debugLog.push(msg) : (msg) => console.log(msg);

  // Strategy 1: InnerTube player API (multi-client)
  const innerTubeResult = await fetchViaInnerTube(videoId, lang, log);
  if (innerTubeResult) {
    if (debug) innerTubeResult._debug = debugLog;
    return jsonResponse(innerTubeResult);
  }

  // Strategy 2: Web page scraping
  const webResult = await fetchViaWebPage(videoId, lang, log);
  if (webResult) {
    if (debug) webResult._debug = debugLog;
    return jsonResponse(webResult);
  }

  // Strategy 3: Invidious API (third-party YouTube frontends)
  const invidiousResult = await fetchViaInvidious(videoId, lang, log);
  if (invidiousResult) {
    if (debug) invidiousResult._debug = debugLog;
    return jsonResponse(invidiousResult);
  }

  // Strategy 4: Piped API
  const pipedResult = await fetchViaPiped(videoId, lang, log);
  if (pipedResult) {
    if (debug) pipedResult._debug = debugLog;
    return jsonResponse(pipedResult);
  }

  const response = { error: 'No transcript available for this video' };
  if (debug) response._debug = debugLog;
  return jsonResponse(response, 404);
}

// ── InnerTube player API strategy (multi-client) ─────────────

/**
 * Fetch with a timeout to avoid hanging on dead instances.
 */
async function fetchWithTimeout(url, init = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchViaInnerTube(videoId, lang, log = console.log) {
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

      const resp = await fetch(apiUrl, {
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
      });

      if (!resp.ok) {
        log(`InnerTube ${client.name}: HTTP ${resp.status}`);
        continue;
      }

      const data = await resp.json();
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
      const result = await fetchFromTracks(tracks, lang);
      if (result) return result;
    } catch (err) {
      log(`InnerTube ${client.name} error: ${err.message}`);
    }
  }

  return null;
}

// ── Web page scraping strategy ────────────────────────────────

async function fetchViaWebPage(videoId, lang, log = console.log) {
  try {
    const pageUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const resp = await fetch(pageUrl, {
      headers: {
        'User-Agent': BROWSER_UA,
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml',
        'Cookie': CONSENT_COOKIE,
      },
    });

    if (!resp.ok) {
      log(`Web page: HTTP ${resp.status}`);
      return null;
    }

    const html = await resp.text();
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
        const result = await fetchFromTracks(tracks, lang);
        if (result) return result;
      } catch (e) {
        log(`Web page: JSON parse failed: ${e.message}`);
      }
    }

    log('Web page: could not extract player response');
    return null;
  } catch (err) {
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

async function fetchFromTracks(tracks, lang) {
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

      const resp = await fetch(captionUrl, {
        headers: {
          'User-Agent': BROWSER_UA,
          'Accept-Language': lang,
          'Cookie': CONSENT_COOKIE,
        },
      });

      if (!resp.ok) continue;
      const text = await resp.text();

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
    if (
      !target.hostname.includes('youtube.com') &&
      !target.hostname.includes('googlevideo.com') &&
      !target.hostname.includes('googleapis.com')
    ) {
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
    for (const [k, v] of Object.entries(CORS_HEADERS)) {
      responseHeaders.set(k, v);
    }
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

async function fetchViaInvidious(videoId, lang, log = console.log) {
  for (const instance of INVIDIOUS_INSTANCES) {
    try {
      // Invidious API: GET /api/v1/captions/:id
      const captionsUrl = `${instance}/api/v1/captions/${videoId}`;
      const resp = await fetchWithTimeout(captionsUrl, {
        headers: { 'User-Agent': BROWSER_UA, 'Accept': 'application/json' },
      }, 8000);

      if (!resp.ok) {
        log(`Invidious (${new URL(instance).hostname}): HTTP ${resp.status}`);
        continue;
      }

      const data = await resp.json().catch(() => null);
      if (!data) {
        log(`Invidious (${new URL(instance).hostname}): invalid JSON response`);
        continue;
      }

      const captions = data.captions;
      if (!Array.isArray(captions) || captions.length === 0) {
        log(`Invidious (${new URL(instance).hostname}): no captions`);
        continue;
      }

      log(`Invidious (${new URL(instance).hostname}): ${captions.length} caption(s) available`);

      // Find matching language track
      const track = captions.find(c => c.languageCode === lang && c.kind !== 'asr')
        || captions.find(c => c.languageCode === lang && c.kind === 'asr')
        || captions.find(c => c.languageCode === lang)
        || captions[0];

      // Fetch the actual caption content via Invidious proxy
      // Invidious returns caption URLs relative to the instance
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

          const captionResp = await fetch(tryUrl, {
            headers: { 'User-Agent': BROWSER_UA, 'Accept': '*/*' },
          });

          if (!captionResp.ok) continue;
          const captionText = await captionResp.text();

          if (captionText.length === 0) {
            log(`Invidious (${new URL(instance).hostname}): empty caption (${fmt || 'default'})`);
            continue;
          }

          const lines = parseCaptionData(captionText);
          if (lines.length > 0) {
            log(`Invidious (${new URL(instance).hostname}): got ${lines.length} lines (${fmt || 'default'})`);
            return {
              lines,
              language: track.languageCode || lang,
              isAutoGenerated: track.kind === 'asr',
            };
          }
        } catch {
          continue;
        }
      }

      log(`Invidious (${new URL(instance).hostname}): all formats returned empty`);
    } catch (err) {
      log(`Invidious (${new URL(instance).hostname}): ${err.message}`);
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

async function fetchViaPiped(videoId, lang, log = console.log) {
  for (const instance of PIPED_INSTANCES) {
    try {
      const resp = await fetchWithTimeout(`${instance}/streams/${videoId}`, {
        headers: { 'User-Agent': BROWSER_UA, 'Accept': 'application/json' },
      }, 8000);

      if (!resp.ok) {
        log(`Piped (${new URL(instance).hostname}): HTTP ${resp.status}`);
        continue;
      }

      const data = await resp.json();
      const subtitles = data.subtitles;
      if (!Array.isArray(subtitles) || subtitles.length === 0) {
        log(`Piped (${new URL(instance).hostname}): no subtitles`);
        continue;
      }

      log(`Piped (${new URL(instance).hostname}): ${subtitles.length} subtitle(s)`);

      // Find matching language
      const sub = subtitles.find(s => s.code === lang && !s.autoGenerated)
        || subtitles.find(s => s.code === lang && s.autoGenerated)
        || subtitles.find(s => s.code === lang)
        || subtitles[0];

      // Piped provides subtitle URLs that return VTT or other formats
      if (!sub.url) {
        log(`Piped: no URL for subtitle`);
        continue;
      }

      const subResp = await fetch(sub.url, {
        headers: { 'User-Agent': BROWSER_UA, 'Accept': '*/*' },
      });

      if (!subResp.ok) continue;
      const subText = await subResp.text();

      // Try parsing as VTT, XML, or JSON3
      let lines = parseCaptionData(subText);

      // If standard parsing fails, try VTT-specific parsing
      if (lines.length === 0 && subText.includes('WEBVTT')) {
        lines = parseVTT(subText);
      }

      if (lines.length > 0) {
        log(`Piped (${new URL(instance).hostname}): got ${lines.length} lines`);
        return {
          lines,
          language: sub.code || lang,
          isAutoGenerated: !!sub.autoGenerated,
        };
      }
    } catch (err) {
      log(`Piped (${new URL(instance).hostname}): ${err.message}`);
    }
  }

  return null;
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

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  });
}
