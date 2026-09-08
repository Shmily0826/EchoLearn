// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import AudioPlayer from '../AudioPlayer';

vi.mock('../../i18n/I18nContext', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

describe('AudioPlayer lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('owns one native audio source per explicit AudioPlayer mount', () => {
    const { container, rerender } = render(
      <AudioPlayer src="https://worker.test/api/audio?url=video" />,
    );
    expect(container.querySelectorAll('audio')).toHaveLength(1);

    rerender(<AudioPlayer src="https://worker.test/api/audio?url=video" />);
    expect(container.querySelectorAll('audio')).toHaveLength(1);
  });

  it('cancels a pending retry when the audio player unmounts', () => {
    const { container, unmount } = render(
      <AudioPlayer src="https://worker.test/api/audio?url=video" />,
    );
    fireEvent.error(container.querySelector('audio')!);

    unmount();
    vi.advanceTimersByTime(5_000);

    expect(HTMLMediaElement.prototype.load).not.toHaveBeenCalled();
  });

  it('cancels a pending retry when the video source changes', () => {
    const { container, rerender, unmount } = render(
      <AudioPlayer key="first" src="https://worker.test/api/audio?url=first" />,
    );
    fireEvent.error(container.querySelector('audio')!);

    rerender(
      <AudioPlayer key="second" src="https://worker.test/api/audio?url=second" />,
    );
    vi.advanceTimersByTime(5_000);

    expect(HTMLMediaElement.prototype.load).not.toHaveBeenCalled();
    unmount();
  });
});
