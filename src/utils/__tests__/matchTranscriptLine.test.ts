import { describe, it, expect } from 'vitest';
import { matchSuggestionToLineStart } from '../matchTranscriptLine';

/**
 * The AI only ever returns sentence text, so "jump back to this moment" depends
 * entirely on aligning that text to a transcript line. These cases pin the
 * tolerance the alignment needs (quotes, line splits, stitching) and the
 * confidence it must refuse.
 */
const lines = [
  { start: 27, text: 'Good morning. How are you?' },
  { start: 31, text: "It's been great, hasn't it?" },
  { start: 35, text: "In fact, I'm leaving." },
  { start: 40, text: 'And the second is that it has put us in a place where we have no idea what is going to happen.' },
];

describe('matchSuggestionToLineStart', () => {
  it('matches an exact line', () => {
    expect(matchSuggestionToLineStart("In fact, I'm leaving.", lines)).toBe(35);
  });

  it('ignores straight-vs-curly quotes and normalised punctuation', () => {
    // The transcript uses curly apostrophes; the model returns straight ones.
    expect(matchSuggestionToLineStart("It's been great, hasn't it?", lines)).toBe(31);
  });

  it('matches when the model rejoined a sentence the subtitles split', () => {
    expect(
      matchSuggestionToLineStart('Good morning. How are you?', lines, 0.6),
    ).toBe(27);
  });

  it('matches a long line, ignoring the model dropping trailing words', () => {
    expect(
      matchSuggestionToLineStart(
        'And the second is that it has put us in a place where we have no idea',
        lines,
      ),
    ).toBe(40);
  });

  it('returns null rather than guessing when nothing is close enough', () => {
    expect(matchSuggestionToLineStart('Quantum mechanics explains the double slit experiment.', lines)).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(matchSuggestionToLineStart('', lines)).toBeNull();
    expect(matchSuggestionToLineStart('Good morning', [])).toBeNull();
  });

  it('prefers the tightest window when several reach the same coverage', () => {
    // Mirrors the real sample: the sentence is exactly this one line, and the
    // following line is unrelated. A window padded by neighbours would still
    // reach full coverage, so the tight window must win.
    const lines = [
      { start: 700, text: 'And the only way we will do it is by seeing our creative capacities' },
      { start: 706, text: 'for the richness they are and seeing our children for the hope that they are' },
    ];
    expect(
      matchSuggestionToLineStart(
        'And the only way we will do it is by seeing our creative capacities for the richness they are and seeing our children for the hope that they are',
        lines,
        0.6,
      ),
    ).toBe(700);
  });

  it('ignores a noise line as the reported start', () => {
    const withNoise = [
      { start: 10, text: '(Laughter)' },
      { start: 12, text: 'And the second is that it has put us' },
      { start: 16, text: 'in a place where we have no idea what is going to happen' },
    ];
    // Without the anchor guard this returned 10 — the laugh, not the sentence.
    expect(
      matchSuggestionToLineStart(
        'And the second is that it has put us in a place where we have no idea what is going to happen',
        withNoise,
        0.5,
      ),
    ).toBe(12);
  });

  it('returns null when even the widest window is below the threshold', () => {
    const chunked = [
      { start: 100, text: 'And the second is that it has put us' },
      { start: 104, text: 'in a place where we have no idea what is going to happen' },
    ];
    expect(
      matchSuggestionToLineStart(
        'Completely unrelated sentence about marine biology fieldwork methods',
        chunked,
        0.9,
      ),
    ).toBeNull();
  });

  it('does not match a line that only shares stopwords', () => {
    expect(matchSuggestionToLineStart('and the it is that', lines, 0.9)).toBeNull();
  });

  it('reports the sentence start, not a merged noise prefix, when given the raw blocks', () => {
    // The transcript renders *sentence* lines, and normalizeTranscriptToSentences
    // merges a standalone "(Laughter)" block into the following sentence — so that
    // rendered row starts at the laugh, and the sentence's real start is not any
    // row's start at all. StudyPage therefore aligns the timestamp against the raw
    // caption blocks; this pins why, using the real sample's timings.
    const suggestion =
      'There have been three themes running through the conference, which are relevant to what I want to talk about.';
    const renderedRows = [
      { start: 35.753, text: "In fact, I'm leaving." },
      {
        start: 37.269,
        text: `(Laughter) ${suggestion}`,
      },
    ];
    const rawBlocks = [
      { start: 35.753, text: "In fact, I'm leaving." },
      { start: 37.269, text: '(Laughter)' },
      { start: 43.096, text: suggestion },
    ];

    expect(matchSuggestionToLineStart(suggestion, renderedRows)).toBe(37.269);
    expect(matchSuggestionToLineStart(suggestion, rawBlocks)).toBe(43.096);
  });
});
