import type { TranscriptLine } from '../types';

// ── ID generation ──────────────────────────────────────────────

let sentenceIdCounter = 0;
function nextSentenceId(): string {
  return `sl_${Date.now()}_${++sentenceIdCounter}`;
}

// ── Abbreviation protection ────────────────────────────────────

/**
 * Common English abbreviations whose trailing period should NOT
 * be treated as a sentence boundary.
 * Stored in lowercase for case-insensitive comparison.
 */
const ABBREVIATIONS = new Set([
  // Titles
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'rev', 'st',
  // Latin / academic
  'eg', 'ie', 'etc', 'vs', 'al', 'approx', 'dept', 'est', 'vol',
  // Geographic / institutional
  'us', 'uk', 'inc', 'corp', 'ltd', 'co',
  // Time / measurement
  'no', 'nos', 'fig', 'eq',
]);

/**
 * Determine whether a period at `pos` in `text` is a real sentence ending.
 *
 * Filters out:
 *   - Known abbreviations (Mr., Dr., etc.)
 *   - Single uppercase letter initials (J., A.)
 *   - Ellipsis patterns (...)
 *   - Decimal numbers (2.7, 3.14)
 *   - Short all-letter words followed by lowercase (e.g. "ai. daily")
 *   - Periods inside closing quotes followed by continuation
 */
function isSentenceEnd(text: string, pos: number): boolean {
  const char = text[pos];
  if (char !== '.') return true; // ! and ? are always sentence-ending

  // ── Period-specific heuristics ─────────────────────────────

  // Ellipsis: consecutive dots
  if (pos > 0 && text[pos - 1] === '.') return false;
  if (pos < text.length - 1 && text[pos + 1] === '.') return false;

  // Decimal number: digit.digit (e.g. "2.7", "3.14")
  if (pos > 0 && /\d/.test(text[pos - 1])) {
    if (pos + 1 < text.length && /\d/.test(text[pos + 1])) {
      return false;
    }
    // digit. followed by closing quote then digit
    // e.g. "...Kimi K 2.'7 code..." where quote wraps the decimal
    const closingQuotes = /['\u2019"\u201D)\]]/;
    if (
      pos + 1 < text.length &&
      closingQuotes.test(text[pos + 1])
    ) {
      // Look past the quote (and optional space) for a digit
      let afterQuote = pos + 2;
      while (afterQuote < text.length && /\s/.test(text[afterQuote])) afterQuote++;
      if (afterQuote < text.length && /\d/.test(text[afterQuote])) {
        return false; // e.g. "2.'7" → version number split by quote
      }
    }
  }

  // Extract the word immediately before the period
  let wordStart = pos - 1;
  while (wordStart >= 0 && /[\w]/.test(text[wordStart])) wordStart--;
  wordStart++;
  const wordBefore = text.slice(wordStart, pos);

  // Known abbreviation (case-insensitive)
  if (wordBefore.length > 0 && ABBREVIATIONS.has(wordBefore.toLowerCase())) {
    return false;
  }

  // Single uppercase letter initial (e.g. "J. K. Rowling")
  if (wordBefore.length === 1 && /[A-Z]/.test(wordBefore)) {
    return false;
  }

  // Short word (1-3 all-letter chars) followed by lowercase or digit
  // → likely a domain fragment, lowercase abbreviation, or continuation
  //   e.g. "ai. daily", "e. g.", "vol. 3"
  if (
    wordBefore.length > 0 &&
    wordBefore.length <= 3 &&
    /^[a-zA-Z]+$/.test(wordBefore)
  ) {
    const afterIdx = pos + 1;
    if (afterIdx < text.length) {
      const nextChar = text[afterIdx];
      if (/\s/.test(nextChar)) {
        // Look past whitespace for the next real character
        let lookIdx = afterIdx;
        while (lookIdx < text.length && /\s/.test(text[lookIdx])) lookIdx++;
        if (lookIdx < text.length && /[a-z0-9]/.test(text[lookIdx])) {
          return false; // continuation, not a new sentence
        }
      }
    }
  }

  // Period followed by closing quote then lowercase/digit
  // → likely version number or continuation inside quotes
  //   e.g. "'Kimi K 2.'7 code" or "wrote 'hello.' and then"
  const closingQuotes = /['\u2019"\u201D)\]]/;
  if (pos + 1 < text.length && closingQuotes.test(text[pos + 1])) {
    let afterQuote = pos + 2;
    while (afterQuote < text.length && /\s/.test(text[afterQuote])) afterQuote++;
    if (afterQuote < text.length && /[a-z0-9]/.test(text[afterQuote])) {
      return false; // continuation after quoted text
    }
  }

  return true;
}

// ── Main normalizer ────────────────────────────────────────────

/**
 * Normalize raw SRT/VTT caption blocks into sentence-level transcript lines.
 *
 * Algorithm (char-level time mapping):
 *   1. Concatenate all block text, inserting spaces between blocks.
 *   2. Build a parallel `charTimes[]` array mapping every character position
 *      to a timestamp via proportional interpolation within each block's
 *      [start, end] range.
 *   3. Scan the concatenated text for real sentence-ending punctuation,
 *      filtering out abbreviations, initials, and domain fragments.
 *   4. Split into sentence lines, looking up each sentence's start/end
 *      time from the char-times map.
 *
 * @param rawBlocks - Parsed SRT/VTT/timestamped caption blocks
 * @returns Sentence-level TranscriptLine array
 */
export function normalizeTranscriptToSentences(
  rawBlocks: TranscriptLine[],
): TranscriptLine[] {
  if (rawBlocks.length === 0) return [];

  // ── Step 1: Concatenate all text ─────────────────────────────
  const textParts: string[] = [];
  const blockSpans: { textOffset: number; len: number; idx: number }[] = [];
  const separatorPositions: number[] = []; // positions of inter-block spaces
  let offset = 0;

  for (let i = 0; i < rawBlocks.length; i++) {
    const text = rawBlocks[i].text.trim();
    if (!text) continue;

    if (textParts.length > 0) {
      separatorPositions.push(offset);
      textParts.push(' ');
      offset += 1;
    }

    blockSpans.push({ textOffset: offset, len: text.length, idx: i });
    textParts.push(text);
    offset += text.length;
  }

  const fullText = textParts.join('');
  if (!fullText.trim()) return [];

  // ── Step 2: Build character → time map ───────────────────────
  const charTimes = new Float64Array(fullText.length);

  for (const span of blockSpans) {
    const block = rawBlocks[span.idx];
    const bStart = block.start;
    const bEnd = block.end;
    const dur = bEnd - bStart;

    for (let ci = 0; ci < span.len; ci++) {
      const charPos = span.textOffset + ci;
      if (span.len > 1) {
        charTimes[charPos] = bStart + (ci / (span.len - 1)) * dur;
      } else {
        charTimes[charPos] = bStart;
      }
    }
  }

  // Fill inter-block separator spaces with the next block's start time
  for (let si = 0; si < separatorPositions.length; si++) {
    const sepPos = separatorPositions[si];
    // The next block span is always at index si + 1 in blockSpans
    if (si + 1 < blockSpans.length) {
      charTimes[sepPos] = rawBlocks[blockSpans[si + 1].idx].start;
    } else {
      // Fallback: use the end of the previous block
      charTimes[sepPos] = rawBlocks[blockSpans[si].idx].end;
    }
  }

  /** Look up the timestamp for a character position. */
  function timeAt(pos: number): number {
    if (fullText.length === 0) return 0;
    const idx = Math.max(0, Math.min(pos, fullText.length - 1));
    return charTimes[idx];
  }

  // ── Step 3: URL/domain protection ────────────────────────────
  // Periods inside URLs and domain names must not be treated as sentence ends.
  // e.g. "training.besuper.ai." → only the trailing "." is a sentence end.
  const protectedDots = new Set<number>();
  const urlPattern =
    /(?:https?:\/\/|www\.)[\w.-]+|(?:[\w-]+\.)+[\w-]{2,}/g;
  let urlMatch: RegExpExecArray | null;
  while ((urlMatch = urlPattern.exec(fullText)) !== null) {
    for (let ci = 0; ci < urlMatch[0].length; ci++) {
      if (urlMatch[0][ci] === '.') {
        protectedDots.add(urlMatch.index + ci);
      }
    }
  }

  // ── Step 4: Find sentence-ending punctuation positions ───────
  const sentenceEnds: number[] = [];
  const dotRegex = /[.!?]/g;
  let match: RegExpExecArray | null;

  while ((match = dotRegex.exec(fullText)) !== null) {
    // Skip periods that are inside a URL / domain name
    if (protectedDots.has(match.index)) continue;
    if (isSentenceEnd(fullText, match.index)) {
      sentenceEnds.push(match.index);
    }
  }

  // ── Step 4: Build sentence lines with proportional timestamps ─
  const result: TranscriptLine[] = [];
  let startIdx = 0;

  for (const endIdx of sentenceEnds) {
    const text = fullText.slice(startIdx, endIdx + 1).replace(/\s+/g, ' ').trim();
    if (text) {
      result.push({
        id: nextSentenceId(),
        start: timeAt(startIdx),
        end: timeAt(endIdx),
        text,
      });
    }
    startIdx = endIdx + 1;
  }

  // Flush remaining text after the last sentence-ending punctuation
  const remainder = fullText.slice(startIdx).replace(/\s+/g, ' ').trim();
  if (remainder) {
    const rStart = timeAt(startIdx);
    const lastCharPos = Math.min(
      startIdx + remainder.length - 1,
      fullText.length - 1,
    );
    let rEnd = timeAt(lastCharPos);
    // Ensure the remainder has a non-zero duration if possible
    if (rEnd <= rStart) {
      rEnd = Math.max(
        rStart + Math.max(remainder.split(/\s+/).length * 0.4, 1),
        rStart + 1,
      );
    }
    result.push({
      id: nextSentenceId(),
      start: rStart,
      end: rEnd,
      text: remainder,
    });
  }

  return result;
}
