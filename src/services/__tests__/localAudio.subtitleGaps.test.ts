// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { LocalAudioError, parseLocalSubtitle } from '../localAudio';

// Gap coverage for the V2 local-media subtitle gate: the browser E2E
// (e2e/local-audio.spec.ts) pins the malformed-alert path for garbage text;
// these tests pin the empty-VTT and mixed-quality SRT behaviors that the
// browser suite does not exercise.
describe('parseLocalSubtitle recovery matrix', () => {
  it('rejects a VTT that has a header but zero cues', async () => {
    const file = new File(['WEBVTT\n\n'], 'empty.vtt', { type: 'text/vtt' });
    await expect(parseLocalSubtitle(file)).rejects.toMatchObject({
      code: 'invalid_subtitle',
      message: 'This subtitle file is malformed or has no timed lines.',
    });
  });

  it('imports the parseable cues from a partially malformed SRT (best effort)', async () => {
    const mixed = [
      '1',
      '00:00:00,500 --> 00:00:01,500',
      'Good part one.',
      '',
      'garbage block without a timestamp line',
      '',
      '2',
      '00:00:02,000 --> 00:00:03,000',
      'Good part two.',
      '',
      'X',
      '00:00:xx --> broken',
      'Bad timestamp block.',
    ].join('\n');
    const file = new File([mixed], 'partial.srt', { type: 'application/x-subrip' });
    const lines = await parseLocalSubtitle(file);
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.text)).toEqual(['Good part one.', 'Good part two.']);
    expect(lines[0]).toMatchObject({ start: 0.5, end: 1.5 });
  });

  it('rejects non-subtitle extensions before reading content', async () => {
    const file = new File(['anything'], 'notes.txt', { type: 'text/plain' });
    const err = await parseLocalSubtitle(file).catch((e) => e);
    expect(err).toBeInstanceOf(LocalAudioError);
    expect((err as LocalAudioError).code).toBe('unsupported_subtitle');
  });
});
