import { beforeEach, describe, expect, it } from 'vitest';
import {
  CAPTION_DIAGNOSTICS_STORAGE_KEY,
  loadCaptionDiagnostics,
  mergeCaptionDiagnostics,
  normalizeCaptionDiagnostics,
  recordCaptionDiagnostics,
} from '../captionDiagnostics';

beforeEach(() => {
  localStorage.clear();
});

describe('caption diagnostics aggregate', () => {
  it('does not count a request when Supadata was not attempted', () => {
    expect(recordCaptionDiagnostics({
      supadata: { attempted: false, outcome: 'not_attempted' },
    }, 100)).toEqual(loadCaptionDiagnostics());
    expect(localStorage.getItem(CAPTION_DIAGNOSTICS_STORAGE_KEY)).toBeNull();
  });

  it('counts attempts and classifies outcomes with a one-request credit estimate', () => {
    recordCaptionDiagnostics({ supadata: { attempted: true, outcome: 'success' } }, 100);
    recordCaptionDiagnostics({ supadata: { attempted: true, outcome: 'unavailable' } }, 200);
    recordCaptionDiagnostics({ supadata: { attempted: true, outcome: 'timeout' } }, 300);
    recordCaptionDiagnostics({ supadata: { attempted: true, outcome: 'failure' } }, 400);

    expect(loadCaptionDiagnostics()).toEqual({
      version: 1,
      supadataAttempts: 4,
      supadataSuccesses: 1,
      supadataUnavailable: 1,
      supadataTimeouts: 1,
      supadataFailures: 1,
      estimatedCredits: 4,
      updatedAt: 400,
    });
  });

  it('keeps an earlier attempt when a later provider supplies the captions', () => {
    expect(mergeCaptionDiagnostics(
      { supadata: { attempted: true, outcome: 'unavailable' } },
      undefined,
    )).toEqual({ supadata: { attempted: true, outcome: 'unavailable' } });
    expect(mergeCaptionDiagnostics(
      { supadata: { attempted: false, outcome: 'not_attempted' } },
      { supadata: { attempted: true, outcome: 'failure' } },
    )).toEqual({ supadata: { attempted: true, outcome: 'failure' } });
  });

  it('normalizes malformed diagnostics without accepting unknown outcomes', () => {
    expect(normalizeCaptionDiagnostics({
      supadata: { attempted: true, outcome: 'not-a-real-outcome' },
    })).toEqual({ supadata: { attempted: true, outcome: 'failure' } });
    expect(normalizeCaptionDiagnostics({ supadata: 'secret' })).toBeUndefined();
  });
});
