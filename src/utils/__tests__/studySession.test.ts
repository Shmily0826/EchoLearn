import { describe, expect, it } from 'vitest';
import {
  attachTranscriptToSession,
  createFreshStudySession,
  normalizeStudyUrl,
} from '../studySession';
import type { TranscriptLine, VideoStudySession } from '../../types';

const baseInput = {
  id: 'session_fixed',
  now: 1_700_000_000_000,
  videoId: 'abc12345678',
  url: 'Watch this https://www.youtube.com/watch?v=abc12345678',
  platform: 'youtube' as const,
};

describe('study session helpers', () => {
  it('normalizes share text to the embedded URL', () => {
    expect(normalizeStudyUrl('Title https://youtu.be/abc12345678?t=30')).toBe(
      'https://youtu.be/abc12345678?t=30',
    );
  });

  it('creates a fresh YouTube session with stable identity and timestamps', () => {
    const session = createFreshStudySession(baseInput);
    expect(session).toMatchObject({
      id: 'session_fixed', youtubeId: 'abc12345678', platform: 'youtube',
      createdAt: baseInput.now, updatedAt: baseInput.now, status: 'studying', lastPosition: 0,
    });
    expect(session.transcriptLines).toEqual([]);
    expect(session.transcriptData).toEqual({ rawBlocks: [], sentenceLines: [] });
  });

  it('creates a Bilibili session while preserving the selected page', () => {
    const session = createFreshStudySession({
      ...baseInput,
      videoId: 'BV1xx411c7mD',
      url: 'https://www.bilibili.com/video/BV1xx411c7mD?p=3',
      platform: 'bilibili',
      biliPage: 3,
    });
    expect(session.platform).toBe('bilibili');
    expect(session.biliPage).toBe(3);
    expect(session.youtubeUrl).toContain('?p=3');
  });

  it('attaches raw and sentence-level transcript data without mutating the session or inputs', () => {
    const session = createFreshStudySession(baseInput);
    const rawBlocks: TranscriptLine[] = [{ start: 0, end: 1, text: 'Raw' }];
    const sentenceLines: TranscriptLine[] = [{ start: 0, end: 1, text: 'Sentence' }];
    const original = JSON.parse(JSON.stringify(session)) as VideoStudySession;

    const updated = attachTranscriptToSession(session, rawBlocks, sentenceLines, 1_700_000_001_000);

    expect(updated.transcriptLines).toEqual(rawBlocks);
    expect(updated.transcriptData).toEqual({ rawBlocks, sentenceLines });
    expect(updated.updatedAt).toBe(1_700_000_001_000);
    expect(session).toEqual(original);
    expect(updated).not.toBe(session);
    expect(updated.transcriptLines).not.toBe(rawBlocks);
    expect(updated.transcriptData?.sentenceLines).not.toBe(sentenceLines);
  });

  it('does not mutate a session when preserving optional status and position fields', () => {
    const session: VideoStudySession = {
      ...createFreshStudySession(baseInput),
      status: 'completed',
      lastPosition: 42,
    };
    const updated = attachTranscriptToSession(session, [], [], 99);
    expect(updated.status).toBe('completed');
    expect(updated.lastPosition).toBe(42);
    expect(session.updatedAt).toBe(baseInput.now);
  });
});
