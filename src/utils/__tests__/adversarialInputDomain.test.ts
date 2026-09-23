import { describe, expect, it } from 'vitest';
import { lemmatize } from '../lemmatizer';
import { extractSentence } from '../sentence';
import { parseSrtTranscript, parseVttTranscript } from '../transcriptParser';

/**
 * Input-domain invariants for the three functions that run on learner-supplied
 * text on every render of a transcript.
 *
 * Why this file exists: a subtitle containing the word "constructor" crashed the
 * whole Study route for three months (`ECHO-20260922-PROTOTYPE-KEY-CRASH-P0`)
 * because `lemmatize` returned the Object *function* for it, and every example
 * test in the repository fed these functions ordinary English words. The lesson
 * is not "add a case for constructor" — it is that these functions need a stated
 * contract over an adversarial input domain, derived so nobody has to think of
 * the next bad value.
 *
 * These assertions pin behavior that was measured, not behavior that seemed
 * plausible: see the dated section of TEST_REPORT.md for the probe that produced
 * the domain and the observed results.
 */

// Derived from the platform, so any member added to Object.prototype in a future
// engine is covered here without anyone writing a case.
const PROTOTYPE_MEMBERS = Object.getOwnPropertyNames(Object.prototype);

const ADVERSARIAL_TOKENS = [
  '', ' ', '\t', '\n', '　', '​',
  'a', 'ab', 'abc', 'x'.repeat(300),
  '0', '12345', '3.14', '-1', '1e999', 'NaN', 'Infinity',
  'null', 'undefined', 'true', 'false', 'NaN',
  "don't", "rock'n'roll', '", "'", "''",
  'a-b', 'a_b', 'a.b', 'a1', '%s', '{{x}}', '${}', '</script>',
  '😀', '\ud83d', '👨‍👩‍',
  '你好', 'こんにちは', '한국어', 'עברית', 'العربية',
  'İ', 'ı', 'ﬁ', 'Ǆ', 'Ś',
];

const ALL_TOKENS = [...PROTOTYPE_MEMBERS, ...ADVERSARIAL_TOKENS];

describe('lemmatize — total over the token domain', () => {
  it.each(ALL_TOKENS.map((token) => [token]))('returns a string for %o', (token) => {
    const result = lemmatize(token);
    expect(typeof result).toBe('string');
  });

  it.each(ALL_TOKENS.map((token) => [token]))('survives the real caller shape .toLowerCase() for %o', (token) => {
    // This is literally what TranscriptViewer/MobileTranscriptPanel do per
    // transcript token, and what threw in Production.
    expect(() => lemmatize(token).toLowerCase()).not.toThrow();
  });
});

describe('extractSentence — total over its two learner-text arguments', () => {
  const CONTEXTS = [
    '', '   ', 'No punctuation run on and on', 'Two sentences. With a period!',
    'Every class gets a constructor.', '你好，这是一个句子。', 'Mixed 中文 and English.',
    'U.S. teams e.g. Inc. stop early.', '\ud83d', '😀😀😀',
  ];

  for (const context of CONTEXTS) {
    for (const word of ['constructor', '__proto__', '', 'the', '你好', '😀', "don't"]) {
      it(`returns a string for context=${JSON.stringify(context.slice(0, 18))} word=${JSON.stringify(word)}`, () => {
        expect(typeof extractSentence(context, word)).toBe('string');
      });
    }
  }
});

describe('subtitle parsers — never throw, never emit a non-string or a non-finite moment', () => {
  const DOCUMENTS: Array<[string, string]> = [
    ['empty', ''],
    ['whitespace only', '   \n\t  '],
    ['BOM and CRLF', '﻿1\r\n00:00:00,000 --> 00:00:02,000\r\nhello\r\n'],
    ['no cues at all', 'just some prose with no timings'],
    ['negative seconds', '1\n00:00:-05,000 --> 00:00:02,000\nneg\n'],
    ['reversed range', '1\n00:00:09,000 --> 00:00:02,000\nbackwards\n'],
    ['absurd timestamps', '1\n999999:99:99,999 --> 999999:99:99,999\nhuge\n'],
    ['non-numeric timestamps', '1\nab:cd:ef,gg --> hh:ii:jj,kk\nnot a time\n'],
    ['CJK cue', '1\n00:00:01,000 --> 00:00:02,000\n你好世界\n'],
    ['RTL and emoji cue', '1\n00:00:01,000 --> 00:00:02,000\nעברית 😀 العربية\n'],
    ['lone surrogate cue', '1\n00:00:01,000 --> 00:00:02,000\n\ud83d orphan\n'],
    ['unclosed final cue', '1\n00:00:01,000 --> 00:00:02,000'],
    ['blank line runs', '\n\n\n1\n\n\n00:00:01,000 --> 00:00:02,000\n\nok\n\n'],
    ['prototype-key word', '1\n00:00:01,000 --> 00:00:02,000\nEvery class gets a constructor.\n'],
  ];

  const parsers = [
    ['SRT', parseSrtTranscript],
    ['VTT', parseVttTranscript],
  ] as const;

  for (const [docName, doc] of DOCUMENTS) {
    for (const [parserName, parse] of parsers) {
      it(`${parserName} handles ${docName} without throwing and returns well-shaped lines`, () => {
        let lines: ReturnType<typeof parseSrtTranscript>;
        expect(() => { lines = parse(doc); }).not.toThrow();
        for (const line of lines!) {
          expect(typeof line.text).toBe('string');
          expect(Number.isFinite(line.start)).toBe(true);
          expect(Number.isFinite(line.end)).toBe(true);
        }
      });
    }
  }
});
