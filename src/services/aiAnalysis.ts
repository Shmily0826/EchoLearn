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
const MAX_TRANSCRIPT_CHARS = 8000;

// ── Helpers ────────────────────────────────────────────────────

/** Truncate transcript to a reasonable length for the API call. */
function truncateText(text: string, max = MAX_TRANSCRIPT_CHARS): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + '\n...[truncated]';
}

// ── System prompt ─────────────────────────────────────────────

function buildSystemPrompt(): string {
  return `You are an expert English-language learning assistant.
Your job is to analyze YouTube video transcripts and produce structured learning materials for a Chinese-speaking English learner.

Rules:
1. All Chinese translations (meaningCn) must be natural, accurate, and concise.
2. Vocabulary words must be actual words found in the transcript — never invent words.
3. Sentences must be exact quotes from the transcript — never fabricate.
4. Learning tasks should be specific, actionable, and reference actual content from the transcript.
5. Always respond with valid JSON only — no markdown fences, no explanation outside JSON.`;
}

function buildUserPrompt(transcript: string, minLevel: CEFRLevel, maxLevel: CEFRLevel): string {
  return `Analyze the following English transcript and return a JSON object with this exact schema:

{
  "summaryEn": "2-3 sentence English summary of the content",
  "summaryCn": "同样内容的2-3句中文摘要",
  "keyTakeaways": ["takeaway 1", "takeaway 2", "takeaway 3"],
  "vocabularySuggestions": [
    {
      "word": "the word",
      "context": "the exact sentence from transcript where this word appears",
      "meaningCn": "准确的中文释义",
      "reason": "brief reason why this word is worth learning at this level"
    }
  ],
  "sentenceSuggestions": [
    {
      "text": "exact sentence from transcript",
      "meaningCn": "准确的中文翻译",
      "reason": "why this sentence is useful for learning"
    }
  ],
  "learningTasks": [
    { "task": "specific actionable task", "type": "listening" }
  ]
}

Requirements:
- "vocabularySuggestions": exactly 8 words at CEFR level ${minLevel}–${maxLevel}. Focus on words a learner at this level might not know. Each "word" must appear in the transcript.
- "sentenceSuggestions": exactly 4 sentences that showcase useful grammar, collocations, or expressions. Each "text" must be an exact quote.
- "learningTasks": exactly 4 tasks, one each for types: "listening", "speaking", "writing", "reading". Reference specific content from the transcript.
- "keyTakeaways": exactly 3 key points in English.

Transcript:
---
${transcript}
---`;
}

// ── DeepSeek API call ────────────────────────────────────────

async function callDeepSeek(
  transcriptText: string,
  minLevel: CEFRLevel,
  maxLevel: CEFRLevel,
): Promise<AIAnalysisResult> {
  const apiKey = import.meta.env.VITE_DEEPSEEK_API_KEY as string | undefined;
  if (!apiKey) {
    throw new Error('VITE_DEEPSEEK_API_KEY is not set');
  }

  const transcript = truncateText(transcriptText);

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
        { role: 'user', content: buildUserPrompt(transcript, minLevel, maxLevel) },
      ],
      temperature: 0.4,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new Error(`DeepSeek API error ${response.status}: ${errBody.slice(0, 200)}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content as string | undefined;
  if (!content) {
    throw new Error('Empty response from DeepSeek');
  }

  // Parse the JSON response
  const parsed = JSON.parse(content) as Record<string, unknown>;

  // Validate and map to AIAnalysisResult
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
  };
}

// ── Fallback: local CEFR-based analysis ──────────────────────

/**
 * Local fallback when DeepSeek API is unavailable.
 * Uses CEFR word lists + heuristics. Translations will be placeholder text.
 */
function localFallback(
  transcriptText: string,
  minLevel: CEFRLevel,
  maxLevel: CEFRLevel,
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
    .slice(0, 8)
    .map(({ word, level, context }) => ({
      word,
      context,
      meaningCn: '(本地分析 — 无翻译)',
      reason: `${level}-level vocabulary.`,
    }));

  const sentSuggestions: SentenceSuggestion[] = sortedByLength
    .filter((s) => s.length > 40 && s.length < 200)
    .slice(0, 4)
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
 * Flow:
 *   1. Build a structured prompt asking for JSON matching AIAnalysisResult
 *   2. Call DeepSeek API (deepseek-v4-flash, OpenAI-compatible endpoint)
 *   3. Parse + validate the JSON response
 *   4. If anything fails, fall back to local CEFR-based heuristic analysis
 *
 * @param transcriptText Full transcript text
 * @param minLevel Minimum CEFR level for vocabulary (default 'B1')
 * @param maxLevel Maximum CEFR level for vocabulary (default 'C2')
 */
export async function analyzeTranscript(
  transcriptText: string,
  minLevel: CEFRLevel = 'B1',
  maxLevel: CEFRLevel = 'C2',
): Promise<AIAnalysisResult> {
  try {
    return await callDeepSeek(transcriptText, minLevel, maxLevel);
  } catch (err) {
    console.warn('[aiAnalysis] DeepSeek API failed, falling back to local analysis:', err);
    return localFallback(transcriptText, minLevel, maxLevel);
  }
}
