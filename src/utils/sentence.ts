/**
 * Extract the single sentence (or clause) containing `word` from a longer block
 * of text. Falls back to the whole text only when no boundary can be found.
 *
 * Robust against the two real-world failure modes seen in YouTube captions:
 *  1. Missing terminal punctuation — auto-captions are often run-on text with no
 *     periods, so the naive /[^.!?]+[.!?]+/ regex returns the ENTIRE line. We
 *     fall back to splitting on commas / semicolons / colons (clauses), which is
 *     still far shorter than the whole paragraph.
 *  2. Abbreviations — "U.S.", "e.g.", "Mr.", "Inc." etc. would otherwise create
 *     false sentence breaks. We only treat a trailing "X." as an abbreviation
 *     when X is a single letter (U.S., I.B.M., e.g., i.e., ...) or one of a
 *     known abbreviation set.
 */
const ABBREV = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc', 'eg', 'ie',
  'inc', 'corp', 'ltd', 'vol', 'approx', 'fig', 'eq', 'ft', 'mt', 'ave', 'blvd',
  'rd', 'capt', 'gen', 'sgt', 'col', 'maj', 'rev', 'sen', 'rep', 'gov', 'pres',
  'dept', 'est', 'univ', 'assn', 'bros', 'natl', 'intl', 'tech', 'priv', 'pub',
  'abbr', 'min', 'max', 'temp', 'ph', 'chem', 'bio', 'phys', 'psy', 'soc',
  'econ', 'eng', 'sci', 'math', 'hist', 'geog', 'lang', 'lit', 'mus', 'comp',
  'govt',
]);

function isAbbreviation(word: string): boolean {
  if (!word) return false;
  if (word.length === 1) return true; // U.S., I.B.M., a.m., e.g., i.e., ...
  return ABBREV.has(word.toLowerCase());
}

/** Split text into sentences, not breaking on abbreviation periods. */
function splitSentences(text: string): string[] {
  const raw = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
  const out: string[] = [];
  let buf = '';
  for (const tok of raw) {
    const m = buf.match(/(\b[A-Za-z]+)\.\s*$/);
    if (buf && m && isAbbreviation(m[1])) {
      buf += tok; // continuation of an abbreviation like "U.S."
      continue;
    }
    if (buf) out.push(buf);
    buf = tok;
  }
  if (buf) out.push(buf);
  return out.map((s) => s.trim()).filter(Boolean);
}

function splitClauses(text: string): string[] {
  return text.split(/[,:;]/).map((s) => s.trim()).filter(Boolean);
}

/**
 * Return the sentence (or clause) containing `word`. If the word isn't present,
 * or no boundary can be found, returns the original text.
 */
export function extractSentence(text: string, word: string): string {
  if (!text || !word) return text;
  const w = word.toLowerCase();
  if (!text.toLowerCase().includes(w)) return text;

  const sentences = splitSentences(text);
  if (sentences.length > 1) {
    const hit = sentences.find((s) => s.toLowerCase().includes(w));
    if (hit) return hit;
  }

  // Run-on caption (no usable sentence punctuation): fall back to clauses.
  const clauses = splitClauses(text);
  if (clauses.length > 1) {
    const hit = clauses.find((c) => c.toLowerCase().includes(w));
    if (hit) return hit;
  }

  // Still no boundary (rare, fully unpunctuated long caption): bound the length
  // by taking a window of words around the matched word so we never return a
  // whole paragraph.
  if (text.length > 70) {
    const words = text.split(/\s+/);
    const idx = words.findIndex((wd) => wd.toLowerCase().includes(w));
    if (idx >= 0) {
      const start = Math.max(0, idx - 6);
      const end = Math.min(words.length, idx + 8);
      const slice = words.slice(start, end).join(' ').trim();
      if (slice) return slice;
    }
  }

  return text;
}
