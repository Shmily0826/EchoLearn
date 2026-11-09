import { describe, expect, it } from 'vitest';
import { extractWordsByLevel } from '../cefrWordList';

describe('subtitle vocabulary candidates', () => {
  it('uses a listed headword for inflections and deduplicates it', () => {
    const words = extractWordsByLevel('We arranged a visit and will arrange another.', 'B1', 'B1');
    expect(words.filter(({ word }) => word === 'arrange')).toEqual([
      { word: 'arrange', level: 'B1', context: 'We arranged a visit and will arrange another.' },
    ]);
    expect(words.some(({ word }) => word === 'arrang')).toBe(false);
  });

  it('preserves listed spellings and omits guesses without a listed level', () => {
    const words = extractWordsByLevel('Laughter filled the forest. They were frobnicated.', 'A2', 'C2')
      .map(({ word }) => word);
    expect(words).toEqual(expect.arrayContaining(['laughter', 'forest']));
    for (const rejected of ['laught', 'for', 'frobnicated', 'frobnicat']) {
      expect(words).not.toContain(rejected);
    }
  });

  it('uses the sentence containing the full subtitle token as its context', () => {
    const words = extractWordsByLevel('The artwork is new. She studies art', 'A2', 'A2');
    expect(words.find(({ word }) => word === 'art')).toEqual({
      word: 'art', level: 'A2', context: 'She studies art',
    });
  });

  it('keeps the token in a bounded excerpt for unpunctuated subtitles', () => {
    const text = `${'and '.repeat(60)}we arranged the visit ${'and '.repeat(60)}`;
    const context = extractWordsByLevel(text, 'B1', 'B1').find(({ word }) => word === 'arrange')?.context;
    expect(context).toContain('we arranged the visit');
    expect(context?.length).toBeLessThan(160);
  });

  it('keeps ambiguous inflections in their subtitle form', () => {
    const words = extractWordsByLevel('She lives nearby. He leaves tomorrow.', 'A1', 'A2');
    expect(words).toEqual(expect.arrayContaining([
      { word: 'lives', level: 'A1', context: 'She lives nearby.' },
      { word: 'leaves', level: 'A2', context: 'He leaves tomorrow.' },
    ]));
    for (const rejected of ['life', 'live', 'leaf', 'leave']) {
      expect(words.some(({ word }) => word === rejected)).toBe(false);
    }
    expect(extractWordsByLevel('He leaves tomorrow.', 'A1', 'A1').some(({ word }) => word === 'leaves')).toBe(false);
  });
});
