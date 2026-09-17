/**
 * Align an AI-suggested key sentence back to the transcript line it came from.
 *
 * The model only ever sees transcript text, so a suggested sentence arrives as
 * text rather than a timestamp. Asking it to report seconds would be a guess;
 * matching it back to the line it was taken from gives the learner the real
 * moment in the video.
 *
 * Matching is deliberately tolerant, because the two sides are never byte-equal:
 * the model normalises curly quotes and flattens subtitle line breaks, and the
 * rubric run in `scripts/ai-quality-rubric.mjs` proved it also sometimes stitches
 * two neighbouring utterances together. So we score by shared word stream and
 * only accept a confident winner.
 *
 * Crucially we score **_windows_** of consecutive lines, not single lines. A
 * caption line is a display fragment, not a sentence: the sample video splits
 * "There have been three themes\nrunning through the conference," from
 * "which are relevant\nto what I want to talk about." The model quotes the
 * joined sentence, so single-line scoring missed 2 of the 4 real suggested
 * sentences in `e2e/fixtures/ai-analysis.sample.json`, while joining just those
 * two lines scores 1.00.
 */
const DEFAULT_THRESHOLD = 0.6;

/** How many consecutive caption lines a suggested sentence may span. */
const MAX_WINDOW = 4;

/**
 * Non-speech caption lines. They carry no content words, so starting a window
 * on one only shifts the reported timestamp away from the sentence — in the
 * real sample, `(Laughter)` at 37.269 ties the correct answer at 43.096 purely
 * because the window extends into the same following lines.
 */
const NOISE_LINE = /^\s*[([]\s*(laughter|music|applause|audience|inaudible|silence)[^)\]]*[)\]]\s*[.!?]*\s*$/i;

/** True when a line has no word worth anchoring a match on. */
function isAnchorlessLine(text: string): boolean {
  if (NOISE_LINE.test(text)) return true;
  return tokenize(text).every((word) => STOPWORDS.has(word));
}

/** Words only: punctuation, case and quotes are noise on both sides. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Function words carry no evidence that a suggestion came from a given line. */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'by',
  'for', 'with', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'am', 'do', 'does', 'did', 'have', 'has', 'had', 'it', 'its', 'this', 'that',
  'these', 'those', 'i', 'you', 'he', 'she', 'we', 'they', 'me', 'him', 'her',
  'us', 'them', 'my', 'your', 'his', 'their', 'our', 'so', 'if', 'than',
  'then', 'there', 'here', 'not', 'no', 'yes', 'will', 'would', 'can', 'could',
  'should', 'shall', 'may', 'might', 'must', 'just', 'up', 'out', 'about',
]);

/**
 * Find the transcript line that best contains `text`.
 *
 * @param text       The AI's suggested sentence.
 * @param lines      Transcript lines in playback order (needs `start` + `text`).
 * @param threshold  Minimum share of the suggestion's words that must appear in
 *                   a window of consecutive lines. 0.6 tolerates the model's
 *                   paraphrasing while still rejecting unrelated content.
 * @returns The matched window's first line `start` in seconds, or `null` when
 *          nothing is confident enough — callers must keep a no-timestamp
 *          fallback.
 */
export function matchSuggestionToLineStart<T extends { start: number; text: string }>(
  text: string,
  lines: T[],
  threshold = DEFAULT_THRESHOLD,
): number | null {
  const target = tokenize(text);
  if (target.length === 0 || lines.length === 0) return null;

  // A very short suggestion is almost all stopwords ("and the it is that"), and
  // overlap alone would let any long line claim it. Require some substance.
  if (target.every((word) => STOPWORDS.has(word))) return null;

  let bestFrom = -1;
  let bestStart = 0;
  let bestHits = -1;
  let bestWindow = 0;

  for (let from = 0; from < lines.length; from += 1) {
    // Anchor the window on a line that actually says something; otherwise a
    // leading "(Laughter)" would be reported as the moment of the sentence.
    if (isAnchorlessLine(lines[from].text)) continue;

    const windowTokens = new Set<string>();
    for (let size = 1; size <= MAX_WINDOW && from + size <= lines.length; size += 1) {
      const line = lines[from + size - 1];
      for (const token of tokenize(line.text)) windowTokens.add(token);
      if (windowTokens.size === 0) continue;

      let hits = 0;
      let informativeHits = 0;
      for (const word of target) {
        const matched =
          windowTokens.has(word) ||
          windowTokens.has(word.replace(/s$/, '')) ||
          // Captions split mid-phrase, so singular/plural often differs.
          windowTokens.has(`${word}s`);
        if (!matched) continue;
        hits += 1;
        if (!STOPWORDS.has(word)) informativeHits += 1;
      }

      // Both a share floor and a substance floor: the first tolerates the model
      // paraphrasing, the second stops a long window from absorbing a
      // stopword-only suggestion by sheer length.
      if (hits / target.length < threshold || informativeHits < 2) continue;

      // Rank by how much of the suggestion the window accounts for (`hits`),
      // then by the tightest window. Both orderings matter, and the sample video
      // proves why: the correct answer at 43.096 needs exactly two lines, but
      // windows starting at "In fact, I'm leaving." (35.753) or at a bare
      // "(Laughter)" (37.269) reach the same coverage by extending further into
      // the same text. Ranking by coverage alone reported the wrong moment;
      // preferring the tightest window reports the sentence's actual start.
      const better =
        hits > bestHits ||
        (hits === bestHits && (size < bestWindow || (size === bestWindow && from < bestFrom)));
      if (!better) continue;
      bestFrom = from;
      bestStart = lines[from].start;
      bestHits = hits;
      bestWindow = size;
    }
  }

  return bestFrom === -1 ? null : bestStart;
}
