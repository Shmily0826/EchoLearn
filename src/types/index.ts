/** Possible states for a study session */
export type SessionStatus = 'draft' | 'studying' | 'completed';

/** Supported video platforms */
export type VideoPlatform = 'youtube' | 'bilibili';

/** A single line in the transcript */
export interface TranscriptLine {
  start: number;            // start time in seconds
  end: number;              // end time in seconds
  text: string;             // the spoken sentence
  id?: string;              // optional unique id
  translation?: string;     // optional Chinese translation
  note?: string;            // optional user note
  sourceBlockIds?: string[]; // ids of raw caption blocks that formed this line
}

/** Normalized transcript data: raw caption blocks + sentence-level lines */
export interface TranscriptData {
  rawBlocks: TranscriptLine[];
  sentenceLines: TranscriptLine[];
}

/** Result from a dictionary API lookup */
export interface DictionaryEntry {
  word: string;
  phonetic: string;
  audioUrl: string;
  partOfSpeech: string;
  definitionEn: string;
  example: string;
  synonyms: string[];
  antonyms: string[];
  provider: string;
}

/** A vocabulary item saved by the user */
export interface VocabularyItem {
  id: string;                // unique id (timestamp-based)
  word: string;              // the word itself (new entries store lemma/base form)
  lemma?: string;            // dictionary base form, e.g. "run" for original "running"
  meaningCn: string;         // Chinese meaning / translation
  context: string;           // the full sentence where the word appeared
  sourceVideoId: string;     // YouTube video ID this word was learned from
  sourceVideoTitle?: string; // human-readable video title (optional)
  addedAt: number;           // when the word was saved (unix ms)
  mastered: boolean;         // whether the user has mastered this word
  reviewCount: number;       // how many times the user reviewed this word
  lastReviewedAt: number;    // unix ms of last review (0 if never reviewed)
  nextReviewAt: number;      // unix ms of next scheduled review
  // Optional dictionary data (merged from DictionaryEntry on save)
  phonetic?: string;
  audioUrl?: string;
  partOfSpeech?: string;
  definitionEn?: string;
  example?: string;
  synonyms?: string[];
  antonyms?: string[];
  dictionaryProvider?: string;
  sourceTimestamp?: number;  // start time of the transcript line (seconds)
}

/** A key sentence saved by the user */
export interface SentenceItem {
  id: string;                // unique id (timestamp-based)
  text: string;              // the full sentence
  meaningCn: string;         // Chinese translation of the sentence
  sourceVideoId: string;     // YouTube video ID this sentence was saved from
  sourceVideoTitle?: string; // human-readable video title (optional)
  startTime: number;         // start time of the sentence in the video (seconds)
  addedAt: number;           // when the sentence was saved (unix ms)
  myOwnSentence: string;     // user's own sentence using the same pattern / structure
  mastered: boolean;         // whether the user has mastered this sentence
  reviewCount: number;       // how many times the user reviewed this sentence
  lastReviewedAt: number;    // unix ms of last review (0 if never reviewed)
  nextReviewAt: number;      // unix ms of next scheduled review
}

/** A study session tied to a video */
export interface VideoStudySession {
  id: string;                        // unique id (timestamp-based)
  youtubeUrl: string;                // the original URL the user pasted (also used for bilibili)
  youtubeId: string;                 // extracted video ID (11-char for YT, BV ID for Bilibili)
  platform?: VideoPlatform;          // defaults to 'youtube' if undefined (backward compat)
  title: string;                     // user-editable title (defaults to URL)
  transcriptLines: TranscriptLine[]; // the parsed transcript for this video (legacy)
  transcriptData?: TranscriptData;   // normalized data (rawBlocks + sentenceLines)
  aiAnalysis?: AIAnalysisResult;     // AI-generated analysis (mock or real)
  createdAt: number;                 // unix ms when session was created
  updatedAt: number;                 // unix ms when session was last modified
  status: SessionStatus;             // draft → studying → completed
}

// ── AI Analysis ────────────────────────────────────────────

/** A vocabulary word suggested by AI analysis */
export interface VocabularySuggestion {
  word: string;
  context: string;     // sentence where the word appeared
  meaningCn: string;   // mock Chinese translation
  reason: string;      // why this word is worth learning
}

/** A sentence suggested by AI analysis */
export interface SentenceSuggestion {
  text: string;
  meaningCn: string;   // mock Chinese translation
  reason: string;      // why this sentence is useful
}

/** A learning task suggested by AI */
export interface LearningTask {
  task: string;        // task description
  type: string;        // 'listening' | 'speaking' | 'writing' | 'reading'
}

/** Full result of an AI transcript analysis */
export interface AIAnalysisResult {
  summaryEn: string;
  summaryCn: string;
  keyTakeaways: string[];
  vocabularySuggestions: VocabularySuggestion[];
  sentenceSuggestions: SentenceSuggestion[];
  learningTasks: LearningTask[];
}

// ── Channel & Daily Plan ────────────────────────────────────

/** Metadata for a YouTube video fetched via the Data API. */
export interface ChannelVideo {
  videoId: string;
  title: string;
  channelId: string;
  channelTitle: string;
  publishedAt: string;   // ISO-8601 date string
  thumbnailUrl: string;
  youtubeUrl: string;
}

/** Possible states for a daily plan item. */
export type DailyPlanStatus = 'planned' | 'studying' | 'completed';

/** A single item in the user's daily study plan. */
export interface DailyPlanItem {
  id: string;                  // unique id (timestamp-based)
  date: string;                // YYYY-MM-DD
  videoId: string;             // YouTube video ID
  youtubeUrl: string;          // full YouTube URL
  title: string;               // video title from API
  channelTitle: string;        // channel name
  thumbnailUrl: string;        // video thumbnail
  status: DailyPlanStatus;     // planned → studying → completed
  createdAt: number;           // unix ms when added
}
