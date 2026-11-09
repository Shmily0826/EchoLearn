import { extractWordsByLevel, type CEFRLevel } from './cefrWordList.ts';

export const ANALYSIS_MODEL = 'deepseek-v4-flash';

export async function analysisCacheKey(
  transcript: string,
  minLevel: CEFRLevel,
  maxLevel: CEFRLevel,
  vocabCount: number,
  sentenceCount: number,
  lang: 'en' | 'zh',
): Promise<string> {
  const input = `vocab-v2|${minLevel}|${maxLevel}|${lang}|${vocabCount}|${sentenceCount}|${transcript}`;
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

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

function buildSystemPrompt(): string {
  return `You are an expert English-language learning assistant with deep knowledge of CEFR proficiency levels.
Your job is to analyze YouTube video transcripts and produce structured learning materials for a Chinese-speaking English learner.

Rules:
1. All Chinese translations (meaningCn) must be natural, accurate, and concise.
2. Vocabulary suggestions must use the supplied candidate spellings, which may be dictionary forms of transcript words.
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
  lang: 'en' | 'zh',
  candidates: ReturnType<typeof extractWordsByLevel>,
): string {
  const grammarInstruction = lang === 'zh'
    ? '用中文简要解析该句的语法结构、重点短语或表达技巧（2-3句话）'
    : 'Briefly analyze the grammar structure, key phrases, or expression techniques of this sentence in English (2-3 sentences)';

  const grammarFieldDesc = lang === 'zh'
    ? '用中文写语法解析'
    : 'write grammar analysis in English';

  const vocabSection = candidates.length > 0
    ? `- "vocabularySuggestions": Choose up to ${vocabCount} words from the CANDIDATE LIST below.
  For each: "word" = candidate spelling as given, "context" = context from candidate, "meaningCn" = precise translation, "reason" = why worth learning.
  Spread choices across the available ${minLevel}–${maxLevel} levels. Return fewer and set "note" if there aren't enough suitable candidates.

  CANDIDATE LIST (word | level | context):
${candidates.map((c) => `  ${c.word} | ${c.level} | "${c.context}"`).join('\n')}`
    : `- "vocabularySuggestions": Return an empty array and explain in "note" that there are no candidates in ${minLevel}–${maxLevel}.`;

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

/** Strip surrounding quotes/apostrophes and trim a word. */
export function analysisWordKey(w: string): string {
  let s = w.trim();
  while (s.length >= 2 && (
    (s[0] === "'" && s[s.length - 1] === "'") ||
    (s[0] === '"' && s[s.length - 1] === '"') ||
    (s[0] === '\u2018' && s[s.length - 1] === '\u2019') ||
    (s[0] === '\u201C' && s[s.length - 1] === '\u201D')
  )) {
    s = s.slice(1, -1).trim();
  }
  return s.toLowerCase();
}

export function buildAnalysisRequest(
  transcript: string,
  minLevel: CEFRLevel,
  maxLevel: CEFRLevel,
  vocabCount: number,
  sentenceCount: number,
  lang: 'en' | 'zh',
  stream: boolean,
) {
  const candidates = extractWordsByLevel(transcript, minLevel, maxLevel).slice(0, 40);
  const promptTranscript = smartTruncate(transcript);
  return {
    candidates,
    promptTranscript,
    body: {
      model: ANALYSIS_MODEL,
      thinking: { type: 'disabled' },
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        {
          role: 'user',
          content: buildUserPrompt(promptTranscript, minLevel, maxLevel, vocabCount, sentenceCount, lang, candidates),
        },
      ],
      temperature: 0.4,
      response_format: { type: 'json_object' },
      max_tokens: 4096,
      stream,
    },
  };
}
