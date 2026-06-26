import type {
  AIAnalysisResult,
  VocabularySuggestion,
  SentenceSuggestion,
  LearningTask,
} from '../types';
import { extractWordsByLevel, type CEFRLevel } from './cefrWordList';

// ── DeepSeek API config ──────────────────────────────────────

const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/chat/completions';
const DEEPSEEK_MODEL = 'deepseek-v4-flash';

/** Max characters of transcript to send (keeps tokens reasonable). */
const MAX_TRANSCRIPT_CHARS = 15000;

// ── Helpers ────────────────────────────────────────────────────

function truncateText(text: string, max = MAX_TRANSCRIPT_CHARS): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + '\n...[truncated]';
}

// ── System prompt ─────────────────────────────────────────────

function buildSystemPrompt(): string {
  return `You are an expert English-language learning assistant with deep knowledge of CEFR proficiency levels.
Your job is to analyze YouTube video transcripts and produce structured learning materials for a Chinese-speaking English learner.

Rules:
1. All Chinese translations (meaningCn) must be natural, accurate, and concise.
2. Vocabulary words must be actual words found in the transcript — never invent words.
3. Sentences must be exact quotes from the transcript — never fabricate.
4. Learning tasks should be specific, actionable, and reference actual content from the transcript.
5. Always respond with valid JSON only — no markdown fences, no explanation outside JSON.

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
): string {
  return `You are analyzing an English video transcript for a Chinese-speaking English learner.

IMPORTANT WORKFLOW: First, read and understand the ENTIRE transcript thoroughly. Only after you have a complete understanding of the content, select the best vocabulary and sentences that match the requirements below. Do NOT stop reading early or pick items only from the beginning.

Return a JSON object with this exact schema:

{
  "summaryEn": "2-3 sentence English summary of the content",
  "summaryCn": "同样内容的2-3句中文摘要",
  "keyTakeaways": ["takeaway 1", "takeaway 2", "takeaway 3"],
  "vocabularySuggestions": [
    {
      "word": "the word (base form / lemma)",
      "context": "the exact sentence from transcript where this word appears",
      "meaningCn": "准确的中文释义",
      "reason": "brief reason why this word is worth learning at this level"
    }
  ],
  "sentenceSuggestions": [
    {
      "text": "exact sentence from transcript",
      "meaningCn": "准确的中文翻译",
      "reason": "why this sentence is useful for learning",
      "grammarNotes": "用中文简要解析该句的语法结构、重点短语或表达技巧（2-3句话）"
    }
  ],
  "learningTasks": [
    { "task": "specific actionable task", "type": "listening" }
  ],
  "note": "optional — only include this field if you could not find enough words at the requested CEFR level"
}

Requirements:
- "vocabularySuggestions": up to ${vocabCount} words STRICTLY at CEFR level ${minLevel}–${maxLevel}.
  CRITICAL word selection rules:
  1. SKIP all basic/common words (e.g. make, take, give, come, think, know, want, need, use, find, tell, ask, work, seem, feel, try, leave, call, good, great, big, small, new, old, long, high, different). These are A1-A2 level and the learner already knows them.
  2. Choose words that a learner at ${minLevel}–${maxLevel} level would find CHALLENGING — words they likely cannot use confidently in their own writing or speech.
  3. Prefer topic-specific vocabulary (domain terms, academic words, nuanced expressions) over generic high-frequency words.
  4. Spread your selection across the ENTIRE transcript — do not only pick words from the beginning. Include words from the middle and end sections too.
  5. Each "word" must be the dictionary base form (lemma) — e.g. "running" → "run", "went" → "go", "children" → "child".
  6. "meaningCn" must be the precise Chinese meaning of the word itself (not a sentence translation).
  7. If fewer than ${vocabCount} words at the ${minLevel}–${maxLevel} level exist in the transcript, return ALL qualifying words you can find (do NOT pad with easier words). Set "note" to explain: e.g. "该字幕中 ${minLevel}–${maxLevel} 级别词汇有限，共找到 N 个符合条件的词。"
- "sentenceSuggestions": exactly ${sentenceCount} sentences that showcase useful grammar, collocations, or expressions.
  - Each "text" must be an exact quote.
  - "grammarNotes" must be a brief Chinese analysis of the sentence: identify key grammar structures (e.g. 虚拟语气, 定语从句, 被动语态), useful collocations, or expression techniques. Keep it to 2-3 sentences.
  - Prefer sentences from different parts of the transcript.
- "learningTasks": exactly 4 tasks, one each for types: "listening", "speaking", "writing", "reading". Reference specific content from the transcript.
- "keyTakeaways": exactly 3 key points in English.
- "note": omit this field entirely if you found enough words. Only include it when the vocabulary count is less than requested.

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
): Promise<AIAnalysisResult> {
  const apiKey = import.meta.env.VITE_DEEPSEEK_API_KEY as string | undefined;
  if (!apiKey) {
    throw new Error('VITE_DEEPSEEK_API_KEY is not set');
  }

  const transcript = truncateText(transcriptText);
  const useStreaming = !!onChunk;

  const response = await fetch(DEEPSEEK_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        {
          role: 'user',
          content: buildUserPrompt(transcript, minLevel, maxLevel, vocabCount, sentenceCount),
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
            word: String(v.word),
            context: String(v.context),
            meaningCn: String(v.meaningCn ?? ''),
            reason: String(v.reason ?? ''),
          }))
      : [],
    sentenceSuggestions: Array.isArray(parsed.sentenceSuggestions)
      ? (parsed.sentenceSuggestions as SentenceSuggestion[])
          .filter((s) => s.text)
          .map((s) => ({
            text: String(s.text),
            meaningCn: String(s.meaningCn ?? ''),
            reason: String(s.reason ?? ''),
            grammarNotes: s.grammarNotes ? String(s.grammarNotes) : undefined,
          }))
      : [],
    learningTasks: Array.isArray(parsed.learningTasks)
      ? (parsed.learningTasks as LearningTask[])
          .filter((t) => t.task && t.type)
          .map((t) => ({
            task: String(t.task),
            type: String(t.type),
          }))
      : [],
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
): AIAnalysisResult {
  const sentences = transcriptText
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10);

  const wordCount = (transcriptText.match(/\b\w+\b/g) || []).length;

  const summaryEn = `This transcript contains approximately ${wordCount} words across ${sentences.length} sentences. (AI API unavailable — showing local analysis.)`;
  const summaryCn = `本字幕约 ${wordCount} 词，共 ${sentences.length} 句。（AI 服务不可用，显示本地分析结果。）`;

  const sortedByLength = [...sentences].sort((a, b) => b.length - a.length);
  const keyTakeaways = sortedByLength.slice(0, 3).map((s) =>
    s.endsWith('.') || s.endsWith('!') || s.endsWith('?') ? s : s + '.',
  );

  const cefrWords = extractWordsByLevel(transcriptText, minLevel, maxLevel);
  const vocabSuggestions: VocabularySuggestion[] = cefrWords
    .slice(0, vocabCount)
    .map(({ word, level, context }) => ({
      word,
      context,
      meaningCn: '(本地分析 — 无翻译)',
      reason: `${level}-level vocabulary.`,
    }));

  const sentSuggestions: SentenceSuggestion[] = sortedByLength
    .filter((s) => s.length > 40 && s.length < 200)
    .slice(0, sentenceCount)
    .map((text) => {
      const clean = text.endsWith('.') || text.endsWith('!') || text.endsWith('?') ? text : text + '.';
      return {
        text: clean,
        meaningCn: '(本地分析 — 无翻译)',
        reason: clean.includes(',')
          ? 'Contains useful clause structure.'
          : 'Good example sentence.',
      };
    });

  const learningTasks: LearningTask[] = [
    { task: 'Listen to the first 2 minutes without subtitles and write down key words.', type: 'listening' },
    { task: 'Shadow-read one key takeaway sentence 3 times.', type: 'speaking' },
    { task: 'Write a short paragraph (3-5 sentences) summarising the topic.', type: 'writing' },
    { task: 'Re-read the transcript and underline collocations or phrasal verbs.', type: 'reading' },
  ];

  return {
    summaryEn,
    summaryCn,
    keyTakeaways,
    vocabularySuggestions: vocabSuggestions,
    sentenceSuggestions: sentSuggestions,
    learningTasks,
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
): Promise<AIAnalysisResult> {
  try {
    return await callDeepSeek(transcriptText, minLevel, maxLevel, vocabCount, sentenceCount, onChunk);
  } catch (err) {
    console.warn('[aiAnalysis] DeepSeek API failed, falling back to local analysis:', err);
    return localFallback(transcriptText, minLevel, maxLevel, vocabCount, sentenceCount);
  }
}
