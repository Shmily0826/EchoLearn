import { describe, it, expect } from 'vitest';
import { parseYouTubeId, parseStartTime } from '../youtube';

describe('parseYouTubeId', () => {
  it('parses standard watch URLs', () => {
    expect(parseYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('parses watch URLs with extra parameters', () => {
    expect(parseYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=120')).toBe(
      'dQw4w9WgXcQ',
    );
    expect(parseYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabc')).toBe(
      'dQw4w9WgXcQ',
    );
  });

  it('parses youtu.be short links', () => {
    expect(parseYouTubeId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('parses embed URLs', () => {
    expect(parseYouTubeId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('returns a bare 11-character ID as-is', () => {
    expect(parseYouTubeId('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(parseYouTubeId('  dQw4w9WgXcQ  ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts the ID from share text with a leading title', () => {
    expect(parseYouTubeId('Check this out https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('returns null for empty input', () => {
    expect(parseYouTubeId('')).toBeNull();
  });

  it('returns null for plain text without a URL', () => {
    expect(parseYouTubeId('no link here')).toBeNull();
  });

  it('returns null when the video ID is not 11 characters', () => {
    expect(parseYouTubeId('https://youtu.be/short')).toBeNull();
    expect(parseYouTubeId('https://www.youtube.com/watch?v=toolong0123456789')).toBeNull();
  });

  it('returns null for non-YouTube URLs', () => {
    expect(parseYouTubeId('https://www.bilibili.com/video/BV1xx411c7mD')).toBeNull();
    expect(parseYouTubeId('https://example.com/dQw4w9WgXcQ')).toBeNull();
  });

  it('accepts IDs containing - and _ (YouTube alphabet)', () => {
    expect(parseYouTubeId('https://youtu.be/-_abc12345-')).toBe('-_abc12345-');
  });
});

describe('parseStartTime', () => {
  it('parses plain seconds', () => {
    expect(
      parseStartTime('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=120'),
    ).toBe(120);
  });

  it('parses the m/s duration format', () => {
    expect(parseStartTime('https://youtu.be/dQw4w9WgXcQ?t=1m30s')).toBe(90);
    expect(parseStartTime('https://youtu.be/dQw4w9WgXcQ?t=45s')).toBe(45);
    expect(parseStartTime('https://youtu.be/dQw4w9WgXcQ?t=2m')).toBe(120);
  });

  it('returns undefined when there is no t parameter', () => {
    expect(parseStartTime('https://youtu.be/dQw4w9WgXcQ')).toBeUndefined();
  });

  it('returns undefined for non-URL input', () => {
    expect(parseStartTime('not a url at all')).toBeUndefined();
  });

  it('returns 0 (not undefined) for a non-numeric t value — documents current behavior', () => {
    // The m/s fallback regex matches the empty string at position 0 for
    // garbage values, producing minutes=0 seconds=0. Harmless (t=0 means
    // "start at the beginning") but worth pinning down.
    expect(parseStartTime('https://youtu.be/dQw4w9WgXcQ?t=abc')).toBe(0);
  });
});
