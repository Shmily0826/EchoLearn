import { describe, it, expect } from 'vitest';
import type { TranscriptLine } from '../../types';
import { normalizeTranscriptToSentences } from '../transcriptNormalizer';

function block(start: number, end: number, text: string): TranscriptLine {
  return { start, end, text };
}

/** Structural invariants that must hold for every normalization result. */
function expectValidLines(lines: TranscriptLine[], minTime: number, maxTime: number): void {
  expect(lines.length).toBeGreaterThan(0);
  const ids = new Set<string>();
  let prevStart = -Infinity;
  for (const line of lines) {
    expect(line.text.length).toBeGreaterThan(0);
    expect(line.start).toBeLessThanOrEqual(line.end + 1e-9);
    expect(line.start).toBeGreaterThanOrEqual(minTime - 1e-6);
    expect(line.end).toBeLessThanOrEqual(maxTime + 1e-6);
    expect(line.start).toBeGreaterThanOrEqual(prevStart - 1e-6);
    prevStart = line.start;
    if (line.id !== undefined) ids.add(line.id);
  }
  // Ids (when emitted) must be unique.
  expect(ids.size).toBe(lines.filter((l) => l.id !== undefined).length);
}

describe('normalizeTranscriptToSentences', () => {
  it('returns an empty array for empty input', () => {
    expect(normalizeTranscriptToSentences([])).toEqual([]);
  });

  it('returns an empty array when all blocks are blank', () => {
    expect(normalizeTranscriptToSentences([block(0, 1, '   ')])).toEqual([]);
  });

  it('splits two caption blocks into two sentence lines with mapped timestamps', () => {
    const result = normalizeTranscriptToSentences([
      block(0, 2000, 'Hello world.'),
      block(2000, 4000, 'How are you?'),
    ]);
    expect(result.map((l) => l.text)).toEqual(['Hello world.', 'How are you?']);
    expectValidLines(result, 0, 4000);
    expect(result[0].start).toBeCloseTo(0, 3);
    expect(result[0].end).toBeCloseTo(2000, 3);
    expect(result[1].start).toBeCloseTo(2000, 3);
    expect(result[1].end).toBeCloseTo(4000, 3);
  });

  it('merges sentence fragments that span multiple caption blocks', () => {
    // Auto-captions often cut a sentence across blocks; the normalizer must
    // rejoin them because the first block has no sentence-ending punctuation.
    const result = normalizeTranscriptToSentences([
      block(0, 1000, 'Today we are going'),
      block(1000, 2000, 'to learn something new.'),
      block(2000, 3000, 'Are you ready?'),
    ]);
    expect(result.map((l) => l.text)).toEqual([
      'Today we are going to learn something new.',
      'Are you ready?',
    ]);
    expectValidLines(result, 0, 3000);
  });

  it('does not treat abbreviation periods (Dr.) as sentence boundaries', () => {
    const result = normalizeTranscriptToSentences([
      block(0, 3000, 'Dr. Smith works here. He is nice.'),
    ]);
    expect(result.map((l) => l.text)).toEqual(['Dr. Smith works here.', 'He is nice.']);
  });

  it('does not treat name initials (J. K. Rowling) as sentence boundaries', () => {
    const result = normalizeTranscriptToSentences([
      block(0, 3000, 'J. K. Rowling wrote it. Nice.'),
    ]);
    expect(result.map((l) => l.text)).toEqual(['J. K. Rowling wrote it.', 'Nice.']);
  });

  it('does not split on decimal numbers (3.14)', () => {
    const result = normalizeTranscriptToSentences([
      block(0, 3000, 'Pi is about 3.14 rounded. Yes.'),
    ]);
    expect(result.map((l) => l.text)).toEqual(['Pi is about 3.14 rounded.', 'Yes.']);
  });

  it('does not split URLs / domain names on their dots', () => {
    const result = normalizeTranscriptToSentences([
      block(0, 3000, 'Visit training.besuper.ai today. It helps.'),
    ]);
    expect(result.map((l) => l.text)).toEqual(['Visit training.besuper.ai today.', 'It helps.']);
  });

  it('treats ellipses as one span, not several empty sentences', () => {
    const result = normalizeTranscriptToSentences([
      block(0, 3000, 'Wait... I mean it. Really.'),
    ]);
    expect(result.map((l) => l.text)).toEqual(['Wait... I mean it.', 'Really.']);
  });

  it('keeps question marks and exclamation marks as sentence ends', () => {
    const result = normalizeTranscriptToSentences([
      block(0, 4000, 'Really? Yes! Okay.'),
    ]);
    expect(result.map((l) => l.text)).toEqual(['Really?', 'Yes!', 'Okay.']);
  });

  it('further splits overly long segments on clause boundaries', () => {
    // 34 words with commas — over the 30-word threshold, so the normalizer
    // must emit more than one line and preserve all content in order.
    const longSentence =
      'First part of the sentence goes here, then the second part continues with more ' +
      'words, and a third clause keeps going with even more words, finally the last ' +
      'clause wraps it all up nicely.';
    const result = normalizeTranscriptToSentences([block(0, 5000, longSentence)]);
    expect(result.length).toBeGreaterThan(1);
    expectValidLines(result, 0, 5000);
    // Reassembling the pieces (whitespace-collapsed) must reproduce the input.
    const rejoined = result.map((l) => l.text).join(' ').replace(/\s+/g, ' ').trim();
    expect(rejoined).toBe(longSentence.replace(/\s+/g, ' ').trim());
    // Every emitted piece must be shorter than the original monster line.
    for (const line of result) {
      expect(line.text.length).toBeLessThan(longSentence.length);
    }
  });

  it('produces monotonically non-decreasing start times across a mixed transcript', () => {
    const result = normalizeTranscriptToSentences([
      block(0, 2000, 'Hello there.'),
      block(2000, 8000, 'This is a longer block. It has several sentences inside. Even more!'),
      block(8000, 9000, 'Bye now.'),
    ]);
    expectValidLines(result, 0, 9000);
    for (let i = 1; i < result.length; i++) {
      expect(result[i].start).toBeGreaterThanOrEqual(result[i - 1].start - 1e-6);
    }
  });
});
