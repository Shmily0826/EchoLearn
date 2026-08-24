import { describe, expect, it } from 'vitest';
import type { TranscriptLine } from '../../types';
import { getActiveLineIndex } from '../transcriptSync';

const lines: TranscriptLine[] = [
  { start: 10, end: 20, text: 'A' },
  { start: 20, end: 30, text: 'B' },
  { start: 35, end: 40, text: 'C' },
];

describe('getActiveLineIndex', () => {
  it('returns -1 for an empty transcript', () => {
    expect(getActiveLineIndex([], 10)).toBe(-1);
  });

  it('returns -1 before the first subtitle', () => {
    expect(getActiveLineIndex(lines, 9.99)).toBe(-1);
  });

  it('activates a line exactly at its start', () => {
    expect(getActiveLineIndex(lines, 10)).toBe(0);
  });

  it('activates a line while the timestamp is inside it', () => {
    expect(getActiveLineIndex(lines, 15)).toBe(0);
  });

  it('treats an exact end as exclusive', () => {
    expect(getActiveLineIndex(lines, 20)).toBe(1);
  });

  it('assigns an adjacent boundary to the next line', () => {
    expect(getActiveLineIndex(lines, 30)).toBe(-1);
  });

  it('returns -1 during a gap', () => {
    expect(getActiveLineIndex(lines, 32)).toBe(-1);
  });

  it('handles a forward time jump statelessly', () => {
    expect(getActiveLineIndex(lines, 10)).toBe(0);
    expect(getActiveLineIndex(lines, 36)).toBe(2);
  });

  it('handles a backward seek statelessly', () => {
    expect(getActiveLineIndex(lines, 36)).toBe(2);
    expect(getActiveLineIndex(lines, 12)).toBe(0);
  });

  it('activates the final subtitle', () => {
    expect(getActiveLineIndex(lines, 39.999)).toBe(2);
  });

  it('returns -1 after the final subtitle', () => {
    expect(getActiveLineIndex(lines, 40)).toBe(-1);
  });
});
