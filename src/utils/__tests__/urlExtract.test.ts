import { describe, it, expect } from 'vitest';
import { extractUrl } from '../urlExtract';

describe('extractUrl', () => {
  it('returns null for empty or whitespace-only input', () => {
    expect(extractUrl('')).toBeNull();
    expect(extractUrl('   ')).toBeNull();
  });

  it('returns null when the input contains no URL', () => {
    expect(extractUrl('just some plain text')).toBeNull();
    expect(extractUrl('看我这个视频超好看')).toBeNull();
    expect(extractUrl('b23.tv/nbSyQzx')).toBeNull(); // scheme-less text is not matched
  });

  it('extracts a single http(s) URL', () => {
    expect(extractUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    );
    expect(extractUrl('http://example.com/page')).toBe('http://example.com/page');
  });

  it('extracts the URL out of Bilibili share text with a leading title', () => {
    const shareText = '【【Easy English】Ep.1 日常口语】 https://b23.tv/nbSyQzx';
    expect(extractUrl(shareText)).toBe('https://b23.tv/nbSyQzx');
  });

  it('extracts the URL out of English share text with trailing comment', () => {
    expect(extractUrl('Watch this: https://youtu.be/abc123 (great!)')).toBe(
      'https://youtu.be/abc123',
    );
  });

  it('returns the LAST URL when several are present (re-paste without clearing)', () => {
    expect(extractUrl('https://old.video/x https://new.video/y')).toBe('https://new.video/y');
    expect(
      extractUrl('first https://youtu.be/aaaaaaaaaaa then https://youtu.be/bbbbbbbbbbb'),
    ).toBe('https://youtu.be/bbbbbbbbbbb');
  });

  it('strips trailing ASCII/CJK punctuation that gets copied along with the link', () => {
    expect(extractUrl('link: https://example.com/a.')).toBe('https://example.com/a');
    expect(extractUrl('link: https://example.com/a,')).toBe('https://example.com/a');
    expect(extractUrl('link (https://b23.tv/x)')).toBe('https://b23.tv/x');
    expect(extractUrl('link: https://example.com/a.。，')).toBe('https://example.com/a');
  });

  it('does NOT strip the full-width closing paren ）— documented limitation', () => {
    // The strip class covers ASCII ) and CJK 。】 etc., but not the
    // full-width ）. A URL wrapped in Chinese parentheses keeps the trailing
    // ）. Pinned so a future fix updates this intentionally.
    expect(extractUrl('link（https://b23.tv/x）')).toBe('https://b23.tv/x）');
  });

  it('skips stripping entirely when ANY trailing char is outside the class — documented limitation', () => {
    // The strip regex is anchored at $ and requires every trailing char to
    // be in the class. A full-width semicolon ；(not in the class) at the end
    // blocks the whole strip, leaving even the ASCII '.' attached.
    expect(extractUrl('link: https://example.com/a.；')).toBe('https://example.com/a.；');
  });

  it('keeps query strings and fragments intact', () => {
    expect(extractUrl('go https://www.youtube.com/watch?v=abc&t=30s#top')).toBe(
      'https://www.youtube.com/watch?v=abc&t=30s#top',
    );
  });

  it('matching is case-insensitive for the scheme', () => {
    expect(extractUrl('see HTTPS://Example.COM/A')).toBe('HTTPS://Example.COM/A');
  });
});
