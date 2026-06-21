import type {
  AIAnalysisResult,
  VocabularySuggestion,
  SentenceSuggestion,
  LearningTask,
} from '../types';
import { extractWordsByLevel, type CEFRLevel } from './cefrWordList';

// ── Common / stop words to exclude from vocabulary suggestions ───

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'it', 'this', 'that', 'are', 'was',
  'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
  'will', 'would', 'could', 'should', 'may', 'might', 'can', 'shall',
  'we', 'you', 'he', 'she', 'they', 'them', 'their', 'our', 'your',
  'my', 'me', 'him', 'her', 'us', 'i', 'not', 'no', 'so', 'if', 'as',
  'than', 'then', 'when', 'what', 'how', 'who', 'which', 'where', 'why',
  'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some',
  'such', 'only', 'own', 'same', 'just', 'also', 'very', 'even', 'still',
  'about', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'up', 'down', 'out', 'off', 'over', 'under', 'again', 'further', 'once',
  'here', 'there', 'any', 'because', 'going', 'get', 'got', 'make', 'like',
  'know', 'think', 'come', 'see', 'want', 'give', 'use', 'find', 'tell',
  'ask', 'work', 'seem', 'feel', 'try', 'leave', 'call', 'keep', 'let',
  'begin', 'show', 'hear', 'play', 'run', 'move', 'live', 'believe',
  'bring', 'happen', 'must', 'say', 'said', 'now', 'new', 'way', 'thing',
  'well', 'back', 'much', 'long', 'great', 'little', 'right', 'good',
  'today', 'really', 'already', 'pretty', 'maybe', 'around', 'something',
  'everything', 'nothing', 'always', 'never', 'often', 'sometimes',
]);

// ── Helpers ────────────────────────────────────────────────────

/** Extract all unique words from text, lowercased, excluding stop words. */
function extractWords(text: string): string[] {
  const raw = text.match(/\b[a-zA-Z']+\b/g) || [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const w of raw) {
    const lower = w.toLowerCase();
    if (lower.length < 4 || STOP_WORDS.has(lower) || seen.has(lower)) continue;
    seen.add(lower);
    result.push(lower);
  }
  return result;
}

/** Split text into sentences at sentence-ending punctuation. */
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10);
}

/** Mock Chinese translation (just a placeholder pattern). */
function mockCn(_en: string): string {
  return '(AI 翻译占位 — 接入真实 API 后替换)';
}

// ── Mock analysis ──────────────────────────────────────────────

/**
 * Generate a mock AIAnalysisResult from transcript text.
 * Uses CEFR-level word classification to extract vocabulary at the right difficulty.
 */
export function mockAnalyzeTranscript(
  transcriptText: string,
  minLevel: CEFRLevel = 'B1',
  maxLevel: CEFRLevel = 'C2',
): AIAnalysisResult {
  const sentences = splitSentences(transcriptText);
  const allWords = extractWords(transcriptText);

  // ── Summaries ────────────────────────────────────────────
  const wordCount = (transcriptText.match(/\b\w+\b/g) || []).length;
  const sentenceCount = sentences.length;

  const summaryEn =
    `This transcript contains approximately ${wordCount} words across ` +
    `${sentenceCount} sentences. ` +
    (sentenceCount > 5
      ? 'The speaker covers several key points with a mix of explanations and examples.'
      : 'The content is relatively brief and focused on a single topic.');

  const summaryCn =
    `本字幕约 ${wordCount} 词，共 ${sentenceCount} 句。` +
    (sentenceCount > 5
      ? '演讲者涵盖了多个要点，结合了说明和示例。'
      : '内容相对简短，集中于单一主题。');

  // ── Key takeaways (pick the longest sentences as they tend to carry more info) ─
  const sortedByLength = [...sentences].sort((a, b) => b.length - a.length);
  const keyTakeaways = sortedByLength.slice(0, 3).map((s) =>
    s.endsWith('.') || s.endsWith('!') || s.endsWith('?') ? s : s + '.',
  );

  // ── Vocabulary suggestions (CEFR-filtered) ───────────────
  const cefrWords = extractWordsByLevel(transcriptText, minLevel, maxLevel);
  const vocabSuggestions: VocabularySuggestion[] = cefrWords
    .slice(0, 8)
    .map(({ word, level, context }) => ({
      word,
      context,
      meaningCn: mockCn(word),
      reason: `${level}-level vocabulary — ${word.length >= 8 ? 'advanced' : 'intermediate'} complexity.`,
    }));

  // ── Sentence suggestions (pick sentences with interesting structure) ─
  const sentSuggestions: SentenceSuggestion[] = sortedByLength
    .filter((s) => s.length > 40 && s.length < 200)
    .slice(0, 4)
    .map((text) => {
      const clean = text.endsWith('.') || text.endsWith('!') || text.endsWith('?') ? text : text + '.';
      return {
        text: clean,
        meaningCn: mockCn(clean),
        reason:
          clean.includes(',')
            ? 'Contains useful clause structure for writing practice.'
            : 'Good example sentence for pattern drilling.',
      };
    });

  // ── Learning tasks ───────────────────────────────────────
  const learningTasks: LearningTask[] = [
    {
      task: 'Listen to the first 2 minutes without subtitles and write down key words you hear.',
      type: 'listening',
    },
    {
      task: 'Shadow-read one key takeaway sentence 3 times, matching the speaker\'s speed.',
      type: 'speaking',
    },
    {
      task: 'Write a short paragraph (3-5 sentences) summarising the main topic in your own words.',
      type: 'writing',
    },
    {
      task: 'Re-read the transcript and underline any collocations or phrasal verbs.',
      type: 'reading',
    },
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

// ── Public API (swappable) ─────────────────────────────────────

/**
 * Analyze a transcript and return learning-oriented suggestions.
 *
 * **v1**: calls `mockAnalyzeTranscript` locally with CEFR-level filtering.
 * **v2 (future)**: POST to an AI backend (OpenAI / Claude / custom endpoint).
 *
 * @param transcriptText The full transcript text
 * @param minLevel Minimum CEFR level to extract (default: 'B1')
 * @param maxLevel Maximum CEFR level to extract (default: 'C2')
 */
export async function analyzeTranscript(
  transcriptText: string,
  minLevel: CEFRLevel = 'B1',
  maxLevel: CEFRLevel = 'C2',
): Promise<AIAnalysisResult> {
  // Simulate a small network delay so the loading UI is visible
  await new Promise((r) => setTimeout(r, 600));
  return mockAnalyzeTranscript(transcriptText, minLevel, maxLevel);
}
