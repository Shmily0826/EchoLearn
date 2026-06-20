import type { TranscriptLine } from '../types';

// ── Time helpers ─────────────────────────────────────────────

let lineIdCounter = 0;
function nextId(): string {
  return `tl_${Date.now()}_${++lineIdCounter}`;
}

/** Parse "HH:MM:SS,mmm" (SRT) or "HH:MM:SS.mmm" (VTT) into seconds. */
function parseHmsTimestamp(raw: string): number {
  const cleaned = raw.replace(',', '.');
  const parts = cleaned.split(':');
  const h = parseInt(parts[0], 10) || 0;
  const m = parseInt(parts[1], 10) || 0;
  const s = parseFloat(parts[2]) || 0;
  return h * 3600 + m * 60 + s;
}

/** Parse "M:SS" or "MM:SS" into seconds. */
function parseMmssTimestamp(raw: string): number {
  const parts = raw.split(':');
  const m = parseInt(parts[0], 10) || 0;
  const s = parseInt(parts[1], 10) || 0;
  return m * 60 + s;
}

// ── Format detection ─────────────────────────────────────────

function isSrt(text: string): boolean {
  return /\d+\s*\n\s*\d{2}:\d{2}:\d{2}[,.]/.test(text.trim());
}

function isVtt(text: string): boolean {
  return text.trim().startsWith('WEBVTT');
}

// ── Parsers ──────────────────────────────────────────────────

/**
 * Parse SRT format:
 *   1
 *   00:00:01,000 --> 00:00:05,000
 *   Text here.
 */
export function parseSrtTranscript(rawText: string): TranscriptLine[] {
  const lines: TranscriptLine[] = [];
  // Split into blocks separated by blank lines
  const blocks = rawText.trim().split(/\n\s*\n/);

  for (const block of blocks) {
    const blockLines = block.trim().split('\n').map((l) => l.trim()).filter(Boolean);
    if (blockLines.length < 2) continue;

    // Find the timestamp line (contains -->)
    let tsLineIdx = -1;
    for (let i = 0; i < blockLines.length; i++) {
      if (blockLines[i].includes('-->')) {
        tsLineIdx = i;
        break;
      }
    }
    if (tsLineIdx < 0) continue;

    const tsMatch = blockLines[tsLineIdx].match(
      /(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})/,
    );
    if (!tsMatch) continue;

    const start = parseHmsTimestamp(tsMatch[1]);
    const end = parseHmsTimestamp(tsMatch[2]);
    const text = blockLines.slice(tsLineIdx + 1).join(' ').trim();
    if (!text) continue;

    lines.push({ id: nextId(), start, end, text });
  }

  return lines;
}

/**
 * Parse VTT format:
 *   WEBVTT
 *
 *   00:00:01.000 --> 00:00:05.000
 *   Text here.
 */
export function parseVttTranscript(rawText: string): TranscriptLine[] {
  // Strip the WEBVTT header (first line + any metadata lines before first blank)
  const stripped = rawText.replace(/^WEBVTT[^\n]*\n/, '').trim();
  // VTT cue blocks are very similar to SRT — reuse the SRT parser
  return parseSrtTranscript(stripped);
}

/**
 * Parse timestamped text:
 *   A) Single-line: "0:01 Today we talk about English."
 *   B) Two-line YouTube style:
 *        0:01
 *        Today we talk about English.
 *        0:05
 *        The key is consistent exposure.
 */
export function parseTimestampedTranscript(rawText: string): TranscriptLine[] {
  const lines: TranscriptLine[] = [];
  const tsPattern = /^(\d{1,3}:\d{2}(?::\d{2})?(?:[,.]\d{1,3})?)\s+(.*)/;
  const tsOnlyPattern = /^(\d{1,3}:\d{2}(?::\d{2})?(?:[,.]\d{1,3})?)\s*$/;

  const rawLines = rawText.split('\n');

  // First pass: detect if it's single-line or two-line format
  const hasInlineTimestamps = rawLines.some((l) => tsPattern.test(l.trim()));

  if (hasInlineTimestamps) {
    // Format A: single-line "MM:SS text"
    for (const line of rawLines) {
      const match = line.trim().match(tsPattern);
      if (match) {
        const timeStr = match[1];
        const text = match[2].trim();
        const start = timeStr.includes(':') && timeStr.split(':').length === 3
          ? parseHmsTimestamp(timeStr)
          : parseMmssTimestamp(timeStr);
        if (text) {
          lines.push({ id: nextId(), start, end: start + 5, text });
        }
      }
    }
  } else {
    // Format B: two-line YouTube style
    let i = 0;
    while (i < rawLines.length) {
      const trimmed = rawLines[i].trim();
      const tsMatch = trimmed.match(tsOnlyPattern);
      if (tsMatch) {
        const timeStr = tsMatch[1];
        const start = timeStr.split(':').length === 3
          ? parseHmsTimestamp(timeStr)
          : parseMmssTimestamp(timeStr);

        // Collect text lines until next timestamp or blank
        const textParts: string[] = [];
        i++;
        while (i < rawLines.length) {
          const next = rawLines[i].trim();
          if (!next || tsOnlyPattern.test(next) || tsPattern.test(next)) break;
          textParts.push(next);
          i++;
        }
        const text = textParts.join(' ').trim();
        if (text) {
          lines.push({ id: nextId(), start, end: start + 5, text });
        }
        continue; // don't increment i again
      }
      i++;
    }
  }

  // Fix end times: use next line's start as current line's end
  for (let j = 0; j < lines.length - 1; j++) {
    lines[j].end = Math.min(lines[j].start + 10, lines[j + 1].start);
  }
  // Last line: keep start + 5

  return lines;
}

/**
 * Parse plain text — split by sentences, each gets 5 seconds.
 */
export function parsePlainTextTranscript(rawText: string): TranscriptLine[] {
  const lines: TranscriptLine[] = [];
  const text = rawText.trim();
  if (!text) return lines;

  // Split by sentences: period/exclamation/question followed by space or end
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  sentences.forEach((sentence, idx) => {
    lines.push({
      id: nextId(),
      start: idx * 5,
      end: (idx + 1) * 5,
      text: sentence,
    });
  });

  return lines;
}

// ── Auto-detect & parse ──────────────────────────────────────

/**
 * Auto-detect the transcript format and parse accordingly.
 * Supports SRT, VTT, timestamped (single/two-line), and plain text.
 */
export function parseTranscript(rawText: string): TranscriptLine[] {
  const trimmed = rawText.trim();
  if (!trimmed) return [];

  if (isVtt(trimmed)) {
    return parseVttTranscript(trimmed);
  }

  if (isSrt(trimmed)) {
    return parseSrtTranscript(trimmed);
  }

  // Check for timestamped formats (single-line or two-line)
  const lines = trimmed.split('\n').map((l) => l.trim()).filter(Boolean);
  const hasTimestamps = lines.some(
    (l) => /^\d{1,3}:\d{2}(?::\d{2})?(?:[,.]\d{1,3})?/.test(l),
  );

  if (hasTimestamps) {
    return parseTimestampedTranscript(trimmed);
  }

  return parsePlainTextTranscript(trimmed);
}
