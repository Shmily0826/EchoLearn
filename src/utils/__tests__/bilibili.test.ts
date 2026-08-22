import { describe, it, expect } from 'vitest';
import {
  detectPlatform,
  parseBilibiliId,
  parseBilibiliStartTime,
  parseBilibiliPage,
  buildBilibiliUrl,
} from '../bilibili';

describe('detectPlatform', () => {
  it('detects bilibili.com URLs', () => {
    expect(detectPlatform('https://www.bilibili.com/video/BV1xx411c7mD')).toBe('bilibili');
    expect(detectPlatform('https://m.bilibili.com/video/BV1xx411c7mD')).toBe('bilibili');
  });

  it('detects b23.tv short links', () => {
    expect(detectPlatform('https://b23.tv/nbSyQzx')).toBe('bilibili');
  });

  it('detects a plain BV ID', () => {
    expect(detectPlatform('BV1xx411c7mD')).toBe('bilibili');
  });

  it('detects YouTube URLs and plain 11-char IDs', () => {
    expect(detectPlatform('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('youtube');
    expect(detectPlatform('https://youtu.be/dQw4w9WgXcQ')).toBe('youtube');
    expect(detectPlatform('dQw4w9WgXcQ')).toBe('youtube');
  });

  it('returns null for unknown platforms and empty input', () => {
    expect(detectPlatform('')).toBeNull();
    expect(detectPlatform('https://vimeo.com/12345')).toBeNull();
    expect(detectPlatform('some random words')).toBeNull();
  });
});

describe('parseBilibiliId', () => {
  it('parses the BV ID from a standard desktop URL', () => {
    expect(parseBilibiliId('https://www.bilibili.com/video/BV1xx411c7mD')).toBe('BV1xx411c7mD');
  });

  it('parses the BV ID from URLs with query parameters', () => {
    expect(parseBilibiliId('https://www.bilibili.com/video/BV1xx411c7mD/?t=120')).toBe(
      'BV1xx411c7mD',
    );
    expect(parseBilibiliId('https://www.bilibili.com/video/BV1xx411c7mD?p=1')).toBe(
      'BV1xx411c7mD',
    );
  });

  it('parses the BV ID from mobile URLs', () => {
    expect(parseBilibiliId('https://m.bilibili.com/video/BV1xx411c7mD')).toBe('BV1xx411c7mD');
  });

  it('returns a plain BV ID as-is', () => {
    expect(parseBilibiliId('BV1xx411c7mD')).toBe('BV1xx411c7mD');
  });

  it('parses a b23.tv link that embeds the BV ID directly', () => {
    expect(parseBilibiliId('https://b23.tv/BV1xx411c7mD')).toBe('BV1xx411c7mD');
  });

  it('returns the full URL for b23.tv short codes (resolved server-side)', () => {
    expect(parseBilibiliId('https://b23.tv/nbSyQzx')).toBe('https://b23.tv/nbSyQzx');
  });

  it('extracts the URL from share text before parsing', () => {
    const shareText = '【【Easy English】Ep.1】 https://b23.tv/BV1xx411c7mD';
    expect(parseBilibiliId(shareText)).toBe('BV1xx411c7mD');
  });

  it('returns null for empty input', () => {
    expect(parseBilibiliId('')).toBeNull();
  });

  it('returns null for non-bilibili input', () => {
    expect(parseBilibiliId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(parseBilibiliId('just some text')).toBeNull();
  });

  it('returns null for a plain BV ID of the wrong length', () => {
    expect(parseBilibiliId('BV1xx411c7m')).toBeNull(); // 9 chars after BV
  });

  it('leniently truncates over-long BV strings inside URLs — documented behavior', () => {
    // The path regex is not end-anchored, so an 11-char "BV" string in a URL
    // yields its first 10 chars instead of null. Pinned so a future
    // tightening of the regex updates this intentionally.
    expect(parseBilibiliId('https://www.bilibili.com/video/BV1xx411c7mDX')).toBe('BV1xx411c7mD');
  });
});

describe('parseBilibiliStartTime', () => {
  it('parses the t parameter (seconds)', () => {
    expect(parseBilibiliStartTime('https://www.bilibili.com/video/BV1xx411c7mD?t=120')).toBe(120);
  });

  it('parses the start_progress parameter', () => {
    expect(
      parseBilibiliStartTime('https://www.bilibili.com/video/BV1xx411c7mD?start_progress=90'),
    ).toBe(90);
  });

  it('prefers t over start_progress when both exist', () => {
    expect(
      parseBilibiliStartTime('https://www.bilibili.com/video/BV1xx411c7mD?t=10&start_progress=90'),
    ).toBe(10);
  });

  it('returns undefined without a time parameter', () => {
    expect(parseBilibiliStartTime('https://www.bilibili.com/video/BV1xx411c7mD')).toBeUndefined();
  });

  it('returns undefined for non-numeric or non-URL input', () => {
    expect(parseBilibiliStartTime('https://www.bilibili.com/video/BV1xx411c7mD?t=abc')).toBeUndefined();
    expect(parseBilibiliStartTime('not a url')).toBeUndefined();
  });
});

describe('parseBilibiliPage', () => {
  it('parses a valid page number', () => {
    expect(parseBilibiliPage('https://www.bilibili.com/video/BV1xx411c7mD?p=2')).toBe(2);
  });

  it('defaults to undefined for p=1-style absent marker is 1 when present', () => {
    expect(parseBilibiliPage('https://www.bilibili.com/video/BV1xx411c7mD?p=1')).toBe(1);
  });

  it('returns undefined for p=0, non-numeric p, or no p', () => {
    expect(parseBilibiliPage('https://www.bilibili.com/video/BV1xx411c7mD?p=0')).toBeUndefined();
    expect(parseBilibiliPage('https://www.bilibili.com/video/BV1xx411c7mD?p=abc')).toBeUndefined();
    expect(parseBilibiliPage('https://www.bilibili.com/video/BV1xx411c7mD')).toBeUndefined();
  });

  it('returns undefined for non-URL input', () => {
    expect(parseBilibiliPage('not a url')).toBeUndefined();
  });
});

describe('buildBilibiliUrl', () => {
  it('builds the canonical desktop URL', () => {
    expect(buildBilibiliUrl('BV1xx411c7mD')).toBe('https://www.bilibili.com/video/BV1xx411c7mD');
  });
});
