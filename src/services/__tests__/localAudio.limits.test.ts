// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { LOCAL_AUDIO_MAX_BYTES, LOCAL_MEDIA_MAX_BYTES, transcribeLocalAudio, validateLocalAudio, validateLocalMediaAudio } from '../localAudio';

function audioFile(size: number): File {
  return { name: 'lesson.mp3', type: 'audio/mpeg', size } as File;
}

describe('local audio size contracts', () => {
  it('accepts local-media audio above 25 MiB, including a 90 MB contract file', () => {
    expect(validateLocalMediaAudio(audioFile(LOCAL_AUDIO_MAX_BYTES + 1))).toBeNull();
    expect(validateLocalMediaAudio(audioFile(90 * 1000 * 1000))).toBeNull();
  });

  it('rejects local-media audio above 200 MiB', () => {
    expect(validateLocalMediaAudio(audioFile(LOCAL_MEDIA_MAX_BYTES + 1))).toMatchObject({
      code: 'too_large',
      message: 'Local media audio files must be 200 MiB or smaller.',
    });
  });

  it('keeps the legacy ASR upload limit at 25 MiB', async () => {
    const file = audioFile(LOCAL_AUDIO_MAX_BYTES + 1);
    expect(validateLocalAudio(file)).toMatchObject({ code: 'too_large' });
    await expect(transcribeLocalAudio(file)).rejects.toMatchObject({
      code: 'too_large',
      message: 'Audio files must be 25 MiB or smaller.',
    });
  });
});
