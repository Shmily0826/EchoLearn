import { describe, expect, it } from 'vitest';

// The smoke is an executable .mjs module; its entry point is guarded so these
// tests exercise only the exported pure classifier and the env-file reader.
import {
  decideVerdict,
  readSmokeEnvFile,
  // @ts-expect-error The smoke is plain JavaScript; this import is test-only.
} from '../../../scripts/ai-seek-smoke.mjs';

/** Mirrors src/components/study/formatTime.ts: floor for both fields. */
const format = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

// The classifier must judge the labels the page rendered, so the synthetic
// `match` returns the label-relevant second directly: raw blocks and sentence
// lines answer differently, which is what makes a suggestion discriminating.
const rawLines = [{ start: 524.918, text: 'raw' }];
const sentenceLines = [{ start: 515.404, text: 'rendered' }];
const match = (text: string, lines: typeof rawLines) =>
  text === 'unmatchable' ? null : lines === rawLines ? 524.918 : 515.404;

describe('ai-seek-smoke verdict classifier', () => {
  it('passes when every discriminating suggestion matches the raw-block alignment', () => {
    const result = decideVerdict({
      cards: [{ text: 'a sentence', seek: `@${format(524.918)}` }],
      rawLines,
      sentenceLines,
      match,
      format,
    });
    expect(result.verdict).toBe('PASS');
    expect(result.discriminating).toBe(1);
    expect(result.agreesRaw).toBe(1);
    expect(result.agreesSentences).toBe(0);
  });

  it('fails when a discriminating suggestion matches the sentence-line alignment', () => {
    const result = decideVerdict({
      cards: [{ text: 'a sentence', seek: `@${format(515.404)}` }],
      rawLines,
      sentenceLines,
      match,
      format,
    });
    expect(result.verdict).toBe('FAIL');
    expect(result.agreesSentences).toBe(1);
  });

  it('fails when a discriminating suggestion matches neither alignment', () => {
    const result = decideVerdict({
      cards: [{ text: 'a sentence', seek: '@1:23' }],
      rawLines,
      sentenceLines,
      match,
      format,
    });
    expect(result.verdict).toBe('FAIL');
    expect(result.agreesRaw).toBe(0);
    expect(result.agreesSentences).toBe(0);
  });

  it('is INCONCLUSIVE — never PASS — when no suggestion can tell the alignments apart', () => {
    const identical = { start: 100, text: 'same' };
    const result = decideVerdict({
      cards: [{ text: 'a sentence', seek: `@${format(100)}` }],
      rawLines: [identical],
      sentenceLines: [identical],
      match,
      format,
    });
    expect(result.verdict).toBe('INCONCLUSIVE');
    expect(result.discriminating).toBe(0);
    expect(result.reason).toContain('can tell the two alignments apart');
  });

  it('fails when the page rendered no suggestions at all', () => {
    const result = decideVerdict({ cards: [], rawLines, sentenceLines, match, format });
    expect(result.verdict).toBe('FAIL');
    expect(result.reason).toContain('no suggestion cards');
  });

  it('ignores non-discriminating rows when a discriminating one decides the verdict', () => {
    // Card 1 cannot tell the alignments apart (both sides answer 100); card 2 can.
    // The verdict must follow card 2 and report a single discriminating row.
    const result = decideVerdict({
      cards: [
        { text: 'same-on-both', seek: `@${format(100)}` },
        { text: 'deciding', seek: `@${format(524.918)}` },
      ],
      rawLines,
      sentenceLines,
      match: (text: string, lines: typeof rawLines) =>
        text === 'same-on-both' ? 100 : lines === rawLines ? 524.918 : 515.404,
      format,
    });
    expect(result.discriminating).toBe(1);
    expect(result.agreesRaw).toBe(1);
    expect(result.verdict).toBe('PASS');
  });

  it('treats a suggestion the matcher cannot place as non-discriminating, not as a failure', () => {
    const result = decideVerdict({
      cards: [{ text: 'unmatchable', seek: null }],
      rawLines,
      sentenceLines,
      match,
      format,
    });
    expect(result.verdict).toBe('INCONCLUSIVE');
    expect(result.rows[0].rawLabel).toBeNull();
    expect(result.rows[0].discriminating).toBe(false);
  });
});

describe('ai-seek-smoke env file reader', () => {
  it('reads only the two smoke credentials and exports nothing else', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-seek-smoke-test-'));
    const file = path.join(dir, '.env.local');
    fs.writeFileSync(
      file,
      [
        '# a comment',
        'ECHOLEARN_SMOKE_EMAIL=smoke@example.invalid',
        'ECHOLEARN_SMOKE_PASSWORD="quoted secret"',
        'GEMINI_API_KEY=must-not-be-read',
        'ECHOLEARN_SMOKE_EMAIL_EXTRA=also-not-read',
      ].join('\n'),
    );
    try {
      const parsed = readSmokeEnvFile(file);
      expect(parsed).toEqual({ email: 'smoke@example.invalid', password: 'quoted secret' });
      expect(JSON.stringify(parsed)).not.toContain('must-not-be-read');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns nulls when no file is named', () => {
    expect(readSmokeEnvFile(null)).toEqual({ email: null, password: null });
  });

  it('refuses a named file that does not exist instead of silently continuing', () => {
    expect(() => readSmokeEnvFile('C:/definitely/not/here/.env.local')).toThrow(/not found/);
  });
});
