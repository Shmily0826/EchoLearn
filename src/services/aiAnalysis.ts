import type {
  AIAnalysisResult,
  VocabularySuggestion,
  SentenceSuggestion,
} from '../types';
import { extractWordsByLevel, type CEFRLevel } from './cefrWordList';
import { t, type Lang } from '../i18n/translations';
import { checkAiRateLimit, rateLimitWaitSeconds } from './aiRateLimit';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';

// ── Local-analysis "no translation" sentinel ──────────────────
// When the live DeepSeek call fails we fall back to a local analysis and stamp
// vocabulary/sentence suggestions with this placeholder meaning. It MUST stay in
// sync with the i18n key `ai.localNoTranslation` (same strings, both languages).
// Exposing it as a constant lets the rest of the app recognise the placeholder
// and re-translate it on a later (secondary) lookup.
export const LOCAL_NO_TRANSLATION_EN = '(Local analysis — no translation)';
export const LOCAL_NO_TRANSLATION_ZH = '(本地分析 — 无翻译)';

/** True when `value` is empty OR the local-no-translation placeholder. */
export function isLocalNoTranslation(value: string | undefined | null): boolean {
  if (!value) return true;
  return value === LOCAL_NO_TRANSLATION_EN || value === LOCAL_NO_TRANSLATION_ZH;
}

// ── DeepSeek API config ──────────────────────────────────────

/** Requests go through the server-side proxy at /api/ai (API key stays server-side). */
const DEEPSEEK_ENDPOINT = '/api/ai';
// NOTE: previously 'deepseek-v4-flash', but that is a REASONING model — it returns
// a large reasoning_content block that we discard, wastes tokens, is slow (~50s),
// and is more prone to truncating the JSON on long transcripts. 'deepseek-chat' is
// the non-reasoning chat model: faster, cheaper, and produces cleaner JSON.
const DEEPSEEK_MODEL = 'deepseek-chat';

/** Max characters of transcript to send (keeps tokens reasonable). */
const MAX_TRANSCRIPT_CHARS = 12000;

// ── Helpers ────────────────────────────────────────────────────

/**
 * Smart truncation: sample evenly from beginning, middle, and end
 * so the AI sees content from across the entire video, not just the start.
 */
function smartTruncate(text: string, max = MAX_TRANSCRIPT_CHARS): string {
  if (text.length <= max) return text;
  const third = Math.floor(max / 3);
  const head = text.slice(0, third);
  const midStart = Math.floor((text.length - third) / 2);
  const mid = text.slice(midStart, midStart + third);
  const tail = text.slice(text.length - third);
  return head + '\n...[middle]...\n' + mid + '\n...[later]...\n' + tail;
}

// ── AI result cache (Firestore, shared across users) ──────────
//
// Popular videos get analyzed by many users. Caching the DeepSeek result
// keyed by a hash of (levels + lang + counts + transcript) means only the
// FIRST user pays for the AI call; everyone else reads the cached result.
// This cuts the dominant cost of running EchoLearn at scale.
//
// - Keyed on the transcript text, so identical transcripts (same video, or a
//   manually pasted transcript) share a cache entry across all users.
// - Stored in a public-read Firestore collection (content is non-PII AI output
//   of public transcripts). Writes require an authenticated user.

const AI_CACHE_COLLECTION = 'aiAnalyses';
const AI_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function getCachedAnalysis(cacheKey: string): Promise<AIAnalysisResult | null> {
  try {
    const snap = await getDoc(doc(db, AI_CACHE_COLLECTION, cacheKey));
    if (!snap.exists()) return null;
    const data = snap.data() as { content?: string; createdAt?: number };
    if (!data.content) return null;
    if (typeof data.createdAt === 'number' && Date.now() - data.createdAt > AI_CACHE_TTL_MS) {
      return null; // expired
    }
    return JSON.parse(data.content) as AIAnalysisResult;
  } catch {
    return null; // cache read failure → treat as miss
  }
}

async function setCachedAnalysis(cacheKey: string, result: AIAnalysisResult): Promise<void> {
  try {
    await setDoc(doc(db, AI_CACHE_COLLECTION, cacheKey), {
      content: JSON.stringify(result),
      createdAt: Date.now(),
      serverCreatedAt: serverTimestamp(),
    });
  } catch {
    // best-effort; ignore cache write failures
  }
}

// ── System prompt ─────────────────────────────────────────────

function buildSystemPrompt(): string {
  return `You are an expert English-language learning assistant with deep knowledge of CEFR proficiency levels.
Your job is to analyze YouTube video transcripts and produce structured learning materials for a Chinese-speaking English learner.

Rules:
1. All Chinese translations (meaningCn) must be natural, accurate, and concise.
2. Vocabulary words must be actual words found in the transcript — never invent words.
3. Sentences must be exact quotes from the transcript — never fabricate.
4. Always respond with valid JSON only — no markdown fences, no explanation outside JSON.

CEFR Level Calibration — follow strictly:
- A1: Basic function words, greetings, numbers (the, is, have, go, good, big)
- A2: Common everyday words, basic verbs (beautiful, remember, important, decide, kitchen)
- B1: Less common words, some abstract concepts, phrasal verbs (struggle, overcome, eventually, rely on, meanwhile)
- B2: Academic, professional, nuanced vocabulary (substantial, controversy, implement, perceive, inevitable)
- C1: Sophisticated, formal, literary vocabulary (ubiquitous, juxtaposition, pragmatic, exacerbate)
- C2: Rare, archaic, highly specialised vocabulary (esoteric, obfuscate, paradigmatic)`;
}

function buildUserPrompt(
  transcript: string,
  minLevel: CEFRLevel,
  maxLevel: CEFRLevel,
  vocabCount: number,
  sentenceCount: number,
  lang: 'en' | 'zh' = 'zh',
  candidates?: Array<{ word: string; level: CEFRLevel; context: string }>,
): string {
  const grammarInstruction = lang === 'zh'
    ? '用中文简要解析该句的语法结构、重点短语或表达技巧（2-3句话）'
    : 'Briefly analyze the grammar structure, key phrases, or expression techniques of this sentence in English (2-3 sentences)';

  const grammarFieldDesc = lang === 'zh'
    ? '用中文写语法解析'
    : 'write grammar analysis in English';

  // Two-stage: when candidates exist, vocab section references them directly (saves tokens)
  const vocabSection = candidates && candidates.length > 0
    ? `- "vocabularySuggestions": Pick the best ${vocabCount} words from the CANDIDATE LIST below.
  For each: "word" = lemma as given, "context" = sentence from candidate (or better one from transcript), "meaningCn" = precise translation, "reason" = why worth learning.
  **Distribute EVENLY across ${minLevel}–${maxLevel}** — do NOT cluster at the highest level.
  You may add 1-2 words NOT in the list if you spot important ones missed locally.
  If fewer than ${vocabCount} candidates exist, return all and set "note".

  CANDIDATE LIST (word | level | context):
${candidates.slice(0, 40).map((c) => `  ${c.word} | ${c.level} | "${c.context.slice(0, 90)}"`).join('\n')}`
    : `- "vocabularySuggestions": up to ${vocabCount} words at CEFR ${minLevel}–${maxLevel} from the transcript.
  Each: lemma + context + meaningCn + reason. Distribute EVENLY across levels.`;

  return `Analyze this English video transcript for a ${lang === 'zh' ? 'Chinese-speaking' : 'non-native'} English learner.

Return JSON:
{
  "summaryEn": "2-3 sentence summary",
${lang === 'zh' ? '  "summaryCn": "2-3句中文摘要",\n' : ''}  "keyTakeaways": ["point1", "point2", "point3"],
  "vocabularySuggestions": [{"word":"","context":"","meaningCn":"","reason":""}],
  "sentenceSuggestions": [{"text":"","meaningCn":"","reason":"","grammarNotes":""}],
  "note": "optional"
}

Requirements:
${vocabSection}
- "sentenceSuggestions": exactly ${sentenceCount} exact quotes with useful grammar/expressions.
  "grammarNotes": ${grammarInstruction}. ${grammarFieldDesc}. Pick from different parts.
- "keyTakeaways": exactly 3 points in English.
- "note": omit unless fewer words than requested.

Transcript:
---
${transcript}
---`;
}

// ── DeepSeek API call (with SSE streaming) ───────────────────

async function callDeepSeek(
  transcriptText: string,
  minLevel: CEFRLevel,
  maxLevel: CEFRLevel,
  vocabCount: number,
  sentenceCount: number,
  onChunk?: (chunk: string) => void,
  lang: 'en' | 'zh' = 'zh',
): Promise<AIAnalysisResult> {
  // Stage 1: local CEFR extraction (free, no API tokens)
  const candidates = extractWordsByLevel(transcriptText, minLevel, maxLevel);

  // Stage 2: smart-truncate transcript (for summary + sentences context)
  const transcript = smartTruncate(transcriptText);
  const useStreaming = !!onChunk;

  const response = await fetch(DEEPSEEK_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        {
          role: 'user',
          content: buildUserPrompt(transcript, minLevel, maxLevel, vocabCount, sentenceCount, lang, candidates),
        },
      ],
      temperature: 0.4,
      response_format: { type: 'json_object' },
      max_tokens: 4096,
      stream: useStreaming,
    }),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new Error(`DeepSeek API error ${response.status}: ${errBody.slice(0, 200)}`);
  }

  let content: string;

  if (useStreaming && response.body) {
    // ── SSE streaming: read chunks and forward to callback ──
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let accumulated = '';
    // Buffer for SSE lines that span across two network chunks. Without this,
    // a `data:` line split on a chunk boundary is dropped (its tail is never
    // parsed), which silently truncates the model output mid-word.
    let lineBuffer = '';

    while (true) {
      const { done, value } = await reader.read();
      const raw = decoder.decode(value, { stream: !done });
      lineBuffer += raw;

      let nlIndex: number;
      while ((nlIndex = lineBuffer.indexOf('\n')) !== -1) {
        const line = lineBuffer.slice(0, nlIndex);
        lineBuffer = lineBuffer.slice(nlIndex + 1);
        if (!line.startsWith('data: ')) continue;
        const dataStr = line.slice(6).trim();
        if (dataStr === '[DONE]') continue;
        try {
          const json = JSON.parse(dataStr) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) {
            accumulated += delta;
            onChunk(delta);
          }
        } catch {
          // skip malformed SSE chunks
        }
      }

      if (done) {
        // Flush any remaining partial line (no trailing newline).
        const tail = lineBuffer.trim();
        if (tail.startsWith('data: ')) {
          const dataStr = tail.slice(6).trim();
          if (dataStr && dataStr !== '[DONE]') {
            try {
              const json = JSON.parse(dataStr) as {
                choices?: Array<{ delta?: { content?: string } }>;
              };
              const delta = json.choices?.[0]?.delta?.content;
              if (delta) {
                accumulated += delta;
                onChunk(delta);
              }
            } catch {
              // ignore incomplete final chunk
            }
          }
        }
        break;
      }
    }

    content = accumulated;
  } else {
    // ── Non-streaming: read full response at once ──────────
    const data = await response.json();
    content = data?.choices?.[0]?.message?.content as string;
  }

  if (!content) {
    throw new Error('Empty response from DeepSeek');
  }

  // Parse and validate the JSON response. Models can return imperfect JSON:
  // wrapped in markdown code fences, followed by trailing prose, or containing
  // unescaped control characters inside string values. We recover from all.
  const parsed = parseJsonLenient(content);
  return validateResult(parsed);
}

/**
 * Parse JSON from an LLM response that may be imperfect. Recovery steps:
 *   1. try the raw string as-is
 *   2. strip markdown code fences (```json … ```)
 *   3. extract the outermost balanced {…} / […] and sanitize control chars
 * If everything fails, throw with a short head of the raw response so the
 * caller can surface it in the fallback banner for debugging.
 */
function parseJsonLenient(raw: string): Record<string, unknown> {
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

  const extracted = extractBalancedJson(stripped);
  if (extracted) {
    const sanitized = sanitizeControlCharsInJsonStrings(extracted);
    const extractedResult = tryParse(sanitized);
    if (extractedResult) return extractedResult;
  }

  const head = raw.replace(/\s+/g, ' ').slice(0, 160);
  throw new Error(`Could not parse DeepSeek JSON. Head: ${head}`);
}

/** Pull the first balanced {...} or [...] substring out of a string. */
function extractBalancedJson(input: string): string | null {
  const firstObj = input.indexOf('{');
  const firstArr = input.indexOf('[');
  let start = -1;
  let closeChar = '}';
  if (firstObj === -1 && firstArr === -1) return null;
  if (firstObj === -1) {
    start = firstArr;
    closeChar = ']';
  } else if (firstArr === -1) {
    start = firstObj;
  } else if (firstArr < firstObj) {
    start = firstArr;
    closeChar = ']';
  } else {
    start = firstObj;
  }
  const end = input.lastIndexOf(closeChar);
  if (end <= start) return null;
  return input.slice(start, end + 1);
}

/** Escape literal control characters that appear inside JSON string literals. */
function sanitizeControlCharsInJsonStrings(input: string): string {
  let out = '';
  let inString = false;
  let escape = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const code = ch.charCodeAt(0);
    if (escape) {
      out += ch;
      escape = false;
      continue;
    }
    if (ch === '\\') {
      out += ch;
      escape = true;
      continue;
    }
    if (ch === '"') {
      out += ch;
      inString = !inString;
      continue;
    }
    if (inString && code >= 0x00 && code <= 0x1f) {
      switch (ch) {
        case '\b':
          out += '\\b';
          break;
        case '\f':
          out += '\\f';
          break;
        case '\n':
          out += '\\n';
          break;
        case '\r':
          out += '\\r';
          break;
        case '\t':
          out += '\\t';
          break;
        default:
          out += '\\u' + code.toString(16).padStart(4, '0');
      }
    } else {
      out += ch;
    }
  }
  return out;
}

/** Strip surrounding quotes/apostrophes and trim a word. */
function cleanWord(w: string): string {
  let s = String(w).trim();
  // Strip matched surrounding quotes: 'word', "word", "word", 'word'
  while (s.length >= 2 && (
    (s[0] === "'" && s[s.length - 1] === "'") ||
    (s[0] === '"' && s[s.length - 1] === '"') ||
    (s[0] === '\u2018' && s[s.length - 1] === '\u2019') ||
    (s[0] === '\u201C' && s[s.length - 1] === '\u201D')
  )) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

/** Trim and strip outer quotes from sentence text. */
function cleanSentence(s: string): string {
  let t = String(s).trim();
  // Strip matched outer quotes
  if (t.length >= 2 && (
    (t[0] === '"' && t[t.length - 1] === '"') ||
    (t[0] === '\u201C' && t[t.length - 1] === '\u201D')
  )) {
    t = t.slice(1, -1).trim();
  }
  return t;
}

/** Validate and map raw JSON to AIAnalysisResult. */
function validateResult(parsed: Record<string, unknown>): AIAnalysisResult {
  return {
    summaryEn: String(parsed.summaryEn ?? ''),
    summaryCn: String(parsed.summaryCn ?? ''),
    keyTakeaways: Array.isArray(parsed.keyTakeaways)
      ? (parsed.keyTakeaways as string[]).map(String)
      : [],
    vocabularySuggestions: Array.isArray(parsed.vocabularySuggestions)
      ? (parsed.vocabularySuggestions as VocabularySuggestion[])
          .filter((v) => v.word && v.context)
          .map((v) => ({
            word: cleanWord(v.word),
            context: cleanSentence(v.context),
            meaningCn: String(v.meaningCn ?? ''),
            reason: String(v.reason ?? ''),
          }))
          .filter((v) => v.word.length > 0)
      : [],
    sentenceSuggestions: Array.isArray(parsed.sentenceSuggestions)
      ? (parsed.sentenceSuggestions as SentenceSuggestion[])
          .filter((s) => s.text)
          .map((s) => ({
            text: cleanSentence(s.text),
            meaningCn: String(s.meaningCn ?? ''),
            reason: String(s.reason ?? ''),
            grammarNotes: s.grammarNotes ? String(s.grammarNotes) : undefined,
          }))
      : [],
    learningTasks: [],
    note: parsed.note ? String(parsed.note) : undefined,
  };
}

// ── Fallback: local CEFR-based analysis ──────────────────────

function localFallback(
  transcriptText: string,
  minLevel: CEFRLevel,
  maxLevel: CEFRLevel,
  vocabCount: number,
  sentenceCount: number,
  lang: Lang = 'zh',
): AIAnalysisResult {
  const sentences = transcriptText
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10);

  const wordCount = (transcriptText.match(/\b\w+\b/g) || []).length;

  const summaryEn = t('ai.localSummary', 'en', { wordCount, sentenceCount: sentences.length });
  const summaryCn = t('ai.localSummary', 'zh', { wordCount, sentenceCount: sentences.length });

  const sortedByLength = [...sentences].sort((a, b) => b.length - a.length);
  const keyTakeaways = sortedByLength.slice(0, 3).map((s) =>
    s.endsWith('.') || s.endsWith('!') || s.endsWith('?') ? s : s + '.',
  );

  const noTranslation = lang === 'zh' ? LOCAL_NO_TRANSLATION_ZH : LOCAL_NO_TRANSLATION_EN;
  const cefrWords = extractWordsByLevel(transcriptText, minLevel, maxLevel);
  const vocabSuggestions: VocabularySuggestion[] = cefrWords
    .slice(0, vocabCount)
    .map(({ word, level, context }) => ({
      word,
      context,
      meaningCn: noTranslation,
      reason: t('ai.localReasonVocab', lang, { level }),
    }));

  const sentSuggestions: SentenceSuggestion[] = sortedByLength
    .filter((s) => s.length > 40 && s.length < 200)
    .slice(0, sentenceCount)
    .map((text) => {
      const clean = text.endsWith('.') || text.endsWith('!') || text.endsWith('?') ? text : text + '.';
      return {
        text: clean,
        meaningCn: noTranslation,
        reason: clean.includes(',')
          ? t('ai.localReasonClause', lang)
          : t('ai.localReasonExample', lang),
      };
    });

  return {
    summaryEn,
    summaryCn,
    keyTakeaways,
    vocabularySuggestions: vocabSuggestions,
    sentenceSuggestions: sentSuggestions,
    learningTasks: [],
  };
}

// ── Public API ───────────────────────────────────────────────

/**
 * Analyze a transcript using DeepSeek V4 Flash (with local fallback).
 *
 * @param transcriptText  Full transcript text
 * @param minLevel        Minimum CEFR level (default 'B1')
 * @param maxLevel        Maximum CEFR level (default 'C2')
 * @param vocabCount      Number of vocabulary suggestions to request (default 8)
 * @param sentenceCount   Number of sentence suggestions to request (default 4)
 * @param onChunk         Optional streaming callback — receives each text chunk as it arrives
 */
export async function analyzeTranscript(
  transcriptText: string,
  minLevel: CEFRLevel = 'B1',
  maxLevel: CEFRLevel = 'C2',
  vocabCount = 8,
  sentenceCount = 4,
  onChunk?: (chunk: string) => void,
  lang: 'en' | 'zh' = 'zh',
): Promise<AIAnalysisResult> {
  // Clamp parameters to sane ranges (prevent abuse like vocabCount=1000)
  vocabCount = Math.max(1, Math.min(vocabCount, 30));
  sentenceCount = Math.max(1, Math.min(sentenceCount, 20));

  // ── Shared result cache ───────────────────────────────────
  // Hash the inputs so identical (video/transcript + settings) analyses
  // share one cached DeepSeek result across all users.
  let cacheKey: string | undefined;
  let cached: AIAnalysisResult | null = null;
  try {
    cacheKey = await sha256Hex(
      `${minLevel}|${maxLevel}|${lang}|${vocabCount}|${sentenceCount}|${transcriptText}`,
    );
    cached = await getCachedAnalysis(cacheKey);
  } catch {
    // cache read failed → fall through to live call
  }
  if (cached) {
    console.log('[aiAnalysis] cache HIT', (cacheKey ?? '').slice(0, 8));
    return cached;
  }

  // Client-side rate limit: 10 AI calls per minute (shared with translation)
  if (!checkAiRateLimit()) {
    const wait = rateLimitWaitSeconds();
    throw new Error(
      lang === 'zh'
        ? `AI 使用过于频繁，请 ${wait} 秒后再试。`
        : `Too many AI requests. Please wait ${wait}s and try again.`,
    );
  }

  try {
    const result = await callDeepSeek(transcriptText, minLevel, maxLevel, vocabCount, sentenceCount, onChunk, lang);
    // Store successful DeepSeek result for future users (best-effort).
    if (cacheKey) void setCachedAnalysis(cacheKey, result);
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[aiAnalysis] DeepSeek API failed, falling back to local analysis:', err);
    const fallback = localFallback(transcriptText, minLevel, maxLevel, vocabCount, sentenceCount, lang);
    // Surface the real error so the user can see WHY it failed (not just a
    // generic banner). The production build strips console.*, so the UI must
    // carry the message explicitly. Include the model name so we can tell
    // whether a stale cached bundle is still sending the old model.
    return { ...fallback, error: `[${DEEPSEEK_MODEL}] ${msg.slice(0, 460)}` };
  }
}
