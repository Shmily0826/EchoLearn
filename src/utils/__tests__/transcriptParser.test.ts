import { describe, expect, it } from 'vitest';
import { parsePlainTextTranscript, parseSrtTranscript, parseTranscript, parseVttTranscript } from '../transcriptParser';

describe('local subtitle parsing', () => {
  it('parses SRT timed lines', () => {
    const lines = parseSrtTranscript('1\n00:00:01,000 --> 00:00:03,500\nHello there.\n\n2\n00:00:03,500 --> 00:00:05,000\nNext line.');
    expect(lines.map(({ start, end, text }) => ({ start, end, text }))).toEqual([
      { start: 1, end: 3.5, text: 'Hello there.' },
      { start: 3.5, end: 5, text: 'Next line.' },
    ]);
  });

  it('parses VTT cues with minute timestamps and cue settings', () => {
    const lines = parseVttTranscript('WEBVTT\n\n00:01.000 --> 00:03.500 align:start\nHello there.\n\n00:03.500 --> 00:05.000\nNext line.');
    expect(lines.map(({ start, end, text }) => ({ start, end, text }))).toEqual([
      { start: 1, end: 3.5, text: 'Hello there.' },
      { start: 3.5, end: 5, text: 'Next line.' },
    ]);
  });

  it('marks plain-text timelines as synthetic but measured formats as unmarked', () => {
    const plain = parseTranscript('First sentence. Second one! Third?');
    expect(plain.map((l) => l.timeProvenance)).toEqual(['synthetic', 'synthetic', 'synthetic']);
    expect(plain[1].start).toBe(5);

    const srt = parseSrtTranscript('1\n00:00:01,000 --> 00:00:03,500\nHello there.');
    expect(srt[0].timeProvenance).toBeUndefined();

    const timestamped = parseTranscript('0:01 Hello there.\n0:05 Next line.');
    expect(timestamped.every((l) => l.timeProvenance === undefined)).toBe(true);
  });

  it('parsePlainTextTranscript fabricates a stable idx*5 timeline', () => {
    const lines = parsePlainTextTranscript('One. Two. Three.');
    expect(lines.map((l) => [l.start, l.end, l.text])).toEqual([
      [0, 5, 'One.'],
      [5, 10, 'Two.'],
      [10, 15, 'Three.'],
    ]);
    expect(parsePlainTextTranscript('   ')).toEqual([]);
  });
});
