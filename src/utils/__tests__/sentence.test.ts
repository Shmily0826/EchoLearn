import { describe, it, expect } from 'vitest';
import { extractSentence } from '../sentence';

describe('extractSentence', () => {
  it('returns the sentence containing the word', () => {
    expect(extractSentence('Hello world. This is great stuff. Bye.', 'great')).toBe(
      'This is great stuff.',
    );
  });

  it('matches the word case-insensitively', () => {
    expect(extractSentence('Hello world. This is GREAT stuff. Bye.', 'great')).toBe(
      'This is GREAT stuff.',
    );
  });

  it('returns the whole text when the word is not present', () => {
    expect(extractSentence('One sentence here.', 'zebra')).toBe('One sentence here.');
  });

  it('returns the text unchanged for empty inputs', () => {
    expect(extractSentence('', 'word')).toBe('');
    expect(extractSentence('Some text.', '')).toBe('Some text.');
  });

  it('does not break on abbreviations like Dr. / U.S.', () => {
    expect(extractSentence('I met Dr. Smith yesterday. He was kind.', 'yesterday')).toBe(
      'I met Dr. Smith yesterday.',
    );
    expect(extractSentence('He lives in the U.S. now. It is big.', 'now')).toBe(
      'He lives in the U.S. now.',
    );
  });

  it('falls back to clause splitting for run-on captions without periods', () => {
    const runOn =
      'well I went to the store, bought some milk, and then I walked home slowly';
    expect(extractSentence(runOn, 'milk')).toBe('bought some milk');
  });

  it('splits on semicolons and colons when there is no sentence punctuation', () => {
    const text = 'first clause here; second clause there: and a third one stays';
    expect(extractSentence(text, 'second')).toBe('second clause there');
  });

  it('bounds the window for long fully-unpunctuated captions', () => {
    const text =
      'i think that this particular method of learning foreign languages very quickly ' +
      'and efficiently is actually quite hard for most people to keep doing every ' +
      'single day without getting tired';
    const result = extractSentence(text, 'learning');
    // Window = 6 words before .. 7 words after the match (slice 1..15).
    expect(result).toBe(
      'think that this particular method of learning foreign languages very quickly and efficiently is',
    );
    expect(result.length).toBeLessThan(text.length);
  });

  it('returns short single-clause text as-is', () => {
    expect(extractSentence('hello world', 'hello')).toBe('hello world');
  });
});
