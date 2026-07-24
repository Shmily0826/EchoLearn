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

// ── DeepSeek API config ──────────────────────────────────────

/** Requests go through the server-side proxy at /api/ai (API key stays server-side). */
const DEEPSEEK_ENDPOINT = '/api/ai';
const DEEPSEEK_MODEL = 'deepseek-v4-flash';

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

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const raw = decoder.decode(value, { stream: true });
      const lines = raw.split('\n');
      for (const line of lines) {
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

  // Parse and validate the JSON response
  const parsed = JSON.parse(content) as Record<string, unknown>;
  return validateResult(parsed);
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

  const noTranslation = t('ai.localNoTranslation', lang);
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
    console.warn('[aiAnalysis] DeepSeek API failed, falling back to local analysis:', err);
    return localFallback(transcriptText, minLevel, maxLevel, vocabCount, sentenceCount, lang);
  }
}
