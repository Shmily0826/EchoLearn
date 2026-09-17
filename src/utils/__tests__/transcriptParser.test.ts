import { describe, expect, it } from 'vitest';
import { parseSrtTranscript, parseVttTranscript } from '../transcriptParser';

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
});
