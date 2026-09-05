import { describe, expect, it } from 'vitest';
import { transcriptSourceLabel } from '../captionSource';

const t = (key: string, vars?: Record<string, string | number>) => {
  if (key === 'study.sourceGeneric') return `Source: ${vars?.source ?? ''}`;
  if (key === 'study.sourceVpsDirect') return 'VPS direct';
  if (key === 'study.sourceYoutubeOfficial') return 'YouTube official subtitles';
  return key;
};

describe('transcriptSourceLabel', () => {
  it('renders the raw provider source exactly once', () => {
    expect(transcriptSourceLabel(t, 'youtube', { source: 'supadata' })).toBe(
      'Source: supadata',
    );
  });
});
