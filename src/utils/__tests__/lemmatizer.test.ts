import { describe, it, expect } from 'vitest';
import { lemmatize, sameLemma } from '../lemmatizer';

// Probe: pin down real outputs for a representative word set so the
// expectations below always document actual behavior.
describe('lemmatize — irregular forms', () => {
  it.each([
    ['went', 'go'],
    ['gone', 'go'],
    ['running', 'run'],
    ['ran', 'run'],
    ['children', 'child'],
    ['better', 'good'],
    ['were', 'be'],
    ['been', 'be'],
    ['had', 'have'],
    ['did', 'do'],
    ['made', 'make'],
    ['took', 'take'],
    ['brought', 'bring'],
    ['bought', 'buy'],
    ['taught', 'teach'],
    ['written', 'write'],
  ])('lemmatize(%s) → %s', (input, expected) => {
    expect(lemmatize(input)).toBe(expected);
  });

  it('keeps "was" as-is by design (DO_NOT_LEMMATIZE set)', () => {
    // 'was' is in the do-not-lemmatize set so it is never rewritten when it
    // is the query word itself — a deliberate tradeoff, even though it means
    // sameLemma('was', 'is') is false although both are forms of "be".
    expect(lemmatize('was')).toBe('was');
  });

  it('keeps "thought" as-is by design (BASE_ER_WORDS noun guard)', () => {
    // 'thought' doubles as a common noun, so the -er base-word guard fires
    // before the irregular-verb table. Its inflected forms still lemmatize:
    expect(lemmatize('thought')).toBe('thought');
    expect(lemmatize('thinks')).toBe('think');
    expect(lemmatize('thinking')).toBe('think');
  });
});

describe('lemmatize — regular inflections', () => {
  it.each([
    ['cats', 'cat'],
    ['walked', 'walk'],
    ['watches', 'watch'],
    ['cities', 'city'],
    ['carried', 'carry'],
    ['liked', 'like'],
    ['faster', 'fast'],
    ['happier', 'happy'],
  ])('lemmatize(%s) → %s', (input, expected) => {
    expect(lemmatize(input)).toBe(expected);
  });
});

describe('lemmatize — documented defect regressions', () => {
  it('keeps noun/adjective -ing forms as their normalized word stem', () => {
    expect(lemmatize('morning')).toBe('morning');
    expect(lemmatize('walking')).toBe('walk');
    expect(lemmatize('looking')).toBe('look');
  });

  it('restores trailing -e only for justified regular -ing verbs', () => {
    expect(lemmatize('liking')).toBe('like');
    expect(lemmatize('dancing')).toBe('dance');
    expect(lemmatize('going')).toBe('go');
    expect(lemmatize('making')).toBe('make');
  });

  it('removes doubled consonants from regular past and comparative forms', () => {
    expect(lemmatize('stopped')).toBe('stop');
    expect(lemmatize('bigger')).toBe('big');
  });

  it('restores silent -e for known comparatives without changing e-less forms', () => {
    expect(lemmatize('nicer')).toBe('nice');
    expect(lemmatize('larger')).toBe('large');
    expect(lemmatize('faster')).toBe('fast');
  });
});

describe('lemmatize — normalization and guard rails', () => {
  it('lowercases and trims input', () => {
    expect(lemmatize('  RUNNING  ')).toBe('run');
    expect(lemmatize('Went')).toBe('go');
  });

  it('returns very short words as-is (lowercased)', () => {
    expect(lemmatize('is')).toBe('is');
    expect(lemmatize('am')).toBe('am');
    expect(lemmatize('Go')).toBe('go');
  });

  it('returns words starting with a digit as-is', () => {
    expect(lemmatize('2nd')).toBe('2nd');
    expect(lemmatize('1984')).toBe('1984');
  });

  it('does not lemmatize base -er nouns like water/mother as comparatives', () => {
    expect(lemmatize('water')).toBe('water');
    expect(lemmatize('mother')).toBe('mother');
  });

  it('returns unknown words unchanged', () => {
    expect(lemmatize('xylophone')).toBe('xylophone');
  });
});

describe('lemmatize — contractions', () => {
  it.each([
    ["don't", 'do'],
    ["doesn't", 'do'],
    ["won't", 'will'],
    ["can't", 'can'],
    ["aren't", 'be'],
    ["it's", 'it'],
    ["that's", 'that'],
    ["they're", 'they'],
    ["let's", 'let'],
    ["i've", 'have'],
  ])('lemmatize(%s) → %s', (input, expected) => {
    expect(lemmatize(input)).toBe(expected);
  });

  it('falls back to stripping everything after the apostrophe for unknown contractions', () => {
    expect(lemmatize("gov't")).toBe('gov');
  });
});

describe('sameLemma', () => {
  it('matches inflected forms of the same word', () => {
    expect(sameLemma('went', 'go')).toBe(true);
    expect(sameLemma('running', 'ran')).toBe(true);
    expect(sameLemma('cats', 'cat')).toBe(true);
    expect(sameLemma('Children', 'child')).toBe(true);
  });

  it('rejects different words', () => {
    expect(sameLemma('dog', 'cat')).toBe(false);
    expect(sameLemma('running', 'walker')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(sameLemma('WENT', 'going')).toBe(true);
  });
});
