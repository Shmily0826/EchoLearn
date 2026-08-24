import type { TranscriptLine } from '../types';

/**
 * Return the transcript line active at a media timestamp.
 *
 * Transcript timestamps are seconds. Starts are inclusive and ends are
 * exclusive, so an exact boundary belongs to the following line. Gaps and
 * timestamps outside the transcript return -1. The existing line order is
 * preserved; callers provide the normalized display order.
 */
export function getActiveLineIndex(
  lines: TranscriptLine[],
  currentTime: number,
): number {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (currentTime >= line.start && currentTime < line.end) return i;
  }
  return -1;
}
