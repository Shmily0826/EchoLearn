/**
 * Word-card AI enrichment.
 *
 * On word-click we already show instant Free Dictionary data (phonetic / part of
 * speech / definitions). This module adds ONE extra LLM call that returns the
 * learner-facing enrichment the dictionary can't:
 *   { pos, meaningZh, exampleEn, exampleZh, analysis }
 * where `meaningZh` is the meaning IN CONTEXT, `exampleEn/exampleZh` is a short
 * bilingual example, and `analysis` is a 1-2 sentence 语境分析 (contextual note).
 *
 * Design (per agreed plan):
 *  - ONE DeepSeek call per (word, videoId) — NOT one per field.
 *  - Goes through the hardened /api/ai proxy, so the API key stays server-side
 *    (no key in the client bundle, CORS + rate-limit enforced at the edge).
 *  - Cached in IndexedDB keyed by `word::videoId::ctxHash` where `ctxHash` is a
 *    stable hash of the (normalized) context sentence. So each distinct sentence
 *    context gets its own analysis (no stale "first sentence wins" behavior),
 *    while identical sentences dedupe to one entry. At most LRU_LIMIT (8) context
 *    variants are kept per (word, video) to bound storage; TTL 30 days.
 *  - Gated to Chinese page mode (`lang === 'zh'`); English study mode skips the
 *    call entirely to save the (already tiny) token budget.
 *  - Any failure (network, rate-limit, bad JSON) degrades gracefully to null —
 *    the Free Dictionary data still renders, so the popup never hard-fails.
 *
 * Cost: ~0.5–0.7K tokens per call; deepseek-chat is ~$0.07 / 1M tokens, so at
 * any realistic scale this is effectively free, especially with per-(word,video)
 * caching + the zh-only gate.
 */

import { checkAiRateLimit } from './aiRateLimit';

/** Server-side DeepSeek proxy (API key never reaches the browser). */
const DEEPSEEK_ENDPOINT = '/api/ai';
const DEEPSEEK_MODEL = 'deepseek-chat';
const MAX_TOKENS = 500;
const TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

export interface WordAnalysis {
  /** Part of speech, inferred from context when possible. */
  pos?: string;
  /** Concise Chinese meaning of the word AS USED IN CONTEXT. */
  meaningZh: string;
  /** A short, natural English example sentence using the word. */
  exampleEn: string;
  /** Chinese translation of `exampleEn`. */
  exampleZh: string;
  /** 1-2 sentence contextual note (语境分析) in Chinese. */
  analysis: string;
}

// ── IndexedDB cache (per-device, survives sessions) ──────────

const DB_NAME = 'echolearn_word_analysis';
const STORE = 'analyses';

interface CacheRecord {
  key: string;
  data: WordAnalysis;
  ts: number;
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function cacheGet(key: string): Promise<WordAnalysis | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => {
        const rec = req.result as CacheRecord | undefined;
        if (rec && typeof rec.ts === 'number' && Date.now() - rec.ts < TTL_MS) {
          resolve(rec.data);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function cacheSet(
  key: string,
  data: WordAnalysis,
  word: string,
  videoId?: string,
): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const now = Date.now();
    store.put({ key, data, ts: now } as CacheRecord);

    // LRU eviction: keep at most LRU_LIMIT context variants per (word, video).
    // All variants share the prefix `word::videoId::`, so a key-range cursor
    // collects them, we sort by recency, and drop the oldest beyond the cap.
    const prefix = `${word.toLowerCase().trim()}::${videoId || 'global'}::`;
    const range = IDBKeyRange.bound(prefix, prefix + '￿');
    const entries: CacheRecord[] = [];
    const cur = store.openCursor(range);
    cur.onsuccess = () => {
      const c = cur.result;
      if (c) {
        entries.push(c.value as CacheRecord);
        c.continue();
      } else if (entries.length > LRU_LIMIT) {
        entries.sort((a, b) => a.ts - b.ts);
        for (const e of entries.slice(0, entries.length - LRU_LIMIT)) {
          store.delete(e.key);
        }
      }
    };
  } catch {
    // best-effort cache; ignore failures
  }
}

// Cap how many distinct context variants we keep per (word, video). High-frequency
// words can appear in many sentences; this bounds IndexedDB growth while still
// giving correct per-context analysis for the most recent lookups.
const LRU_LIMIT = 8;

/** Normalize a context sentence so identical sentences dedupe to the same key
 *  regardless of casing / whitespace / punctuation differences. */
function normalizeContext(ctx?: string): string {
  if (!ctx) return '';
  return ctx
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .slice(0, 300);
}

/** Stable short hash (djb2 → base36) so punctuation / length never break the key. */
function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

function cacheKey(word: string, videoId?: string, context?: string): string {
  const ctxHash = hashString(normalizeContext(context));
  return `${word.toLowerCase().trim()}::${videoId || 'global'}::${ctxHash}`;
}

// ── In-flight dedupe (avoid charging twice for concurrent identical calls) ──

const inflight = new Map<string, Promise<WordAnalysis | null>>();

// ── Prompt ──────────────────────────────────────────────────

function buildMessages(word: string, context?: string): Array<{ role: string; content: string }> {
  const system = `You are an English-learning assistant for Chinese-speaking learners.
Given an English word and (optionally) the sentence it appeared in, return ONLY valid JSON (no markdown fences, no prose outside the JSON) with these fields:
- "pos": the part of speech (e.g. noun / verb / adjective / adverb / phrase), inferred from context when possible
- "meaningZh": a concise, natural Chinese meaning of the word AS USED IN THE GIVEN CONTEXT (one short phrase, not a list)
- "exampleEn": one short, natural, grammatical English example sentence using the exact word (learner-appropriate, under 20 words)
- "exampleZh": the Chinese translation of exampleEn
- "analysis": a 1-2 sentence note in Chinese explaining how/why the word is used this way in the context (语境分析). If no context is given, explain a typical usage instead.

Rules: meanings must be accurate; exampleEn must be grammatical and use the exact word; never invent definitions.`;

  const user = context && context.trim()
    ? `Word: "${word}"\nContext sentence: "${context.trim().slice(0, 300)}"\n\nProvide the JSON analysis for this word in this context.`
    : `Word: "${word}"\n\nProvide the JSON analysis (no context sentence is available).`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

// ── Lenient JSON parse (models sometimes wrap in ```json or add prose) ──

function parseLenient(raw: string): Record<string, unknown> {
  const tryParse = (s: string): Record<string, unknown> | null => {
    try {
      return JSON.parse(s) as Record<string, unknown>;
    } catch {
      return null;
    }
  };
  const direct = tryParse(raw);
  if (direct) return direct;

  const stripped = raw
    .replace(/^```(?:json)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim();
  const strippedResult = tryParse(stripped);
  if (strippedResult) return strippedResult;

  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start !== -1 && end > start) {
    const extracted = tryParse(stripped.slice(start, end + 1));
    if (extracted) return extracted;
  }
  return {};
}

// ── Public API ──────────────────────────────────────────────

/**
 * Fetch AI enrichment for a word. Returns null on any failure or when the call
 * is skipped (English mode / rate-limited / not cached). Results are cached in
 * IndexedDB per (word, videoId).
 */
export async function getWordAnalysis(
  word: string,
  opts: { videoId?: string; context?: string; lang?: 'en' | 'zh' } = {},
): Promise<WordAnalysis | null> {
  const w = word.trim().toLowerCase();
  if (!w) return null;

  // English study mode: skip the AI call entirely (pure-English view, save tokens).
  if (opts.lang && opts.lang !== 'zh') return null;

  const key = cacheKey(w, opts.videoId, opts.context);

  // 1. Cache hit — free, instant.
  const cached = await cacheGet(key);
  if (cached) return cached;

  // 2. Dedupe concurrent identical calls (e.g. two popups for the same word).
  const existing = inflight.get(key);
  if (existing) return existing;

  // 3. Shared client-side rate limit (10/min budget with analysis + translation).
  if (!checkAiRateLimit()) return null;

  const promise = (async (): Promise<WordAnalysis | null> => {
    try {
      const response = await fetch(DEEPSEEK_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: DEEPSEEK_MODEL,
          messages: buildMessages(word, opts.context),
          temperature: 0.3,
          response_format: { type: 'json_object' },
          max_tokens: MAX_TOKENS,
          stream: false,
        }),
      });
      if (!response.ok) return null;
      const data = await response.json();
      const content: string = data?.choices?.[0]?.message?.content ?? '';
      if (!content) return null;

      const parsed = parseLenient(content);
      const result: WordAnalysis = {
        pos: typeof parsed.pos === 'string' ? parsed.pos : undefined,
        meaningZh: typeof parsed.meaningZh === 'string' ? parsed.meaningZh : '',
        exampleEn: typeof parsed.exampleEn === 'string' ? parsed.exampleEn : '',
        exampleZh: typeof parsed.exampleZh === 'string' ? parsed.exampleZh : '',
        analysis: typeof parsed.analysis === 'string' ? parsed.analysis : '',
      };

      // Only cache/show if we actually got something useful.
      if (!result.meaningZh && !result.analysis && !result.exampleEn) return null;

      void cacheSet(key, result, w, opts.videoId);
      return result;
    } catch {
      return null;
    }
  })();

  // Remove from in-flight map when settled (success or failure).
  const wrapped = promise.finally(() => inflight.delete(key));
  inflight.set(key, wrapped);
  return wrapped;
}
