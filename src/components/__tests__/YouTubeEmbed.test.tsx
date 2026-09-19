// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import React from 'react';

// Mock the YT IFrame API. The real Player replaces the container div with an
// iframe asynchronously; for the race we only need the constructor config and
// the ability to fire lifecycle events manually.
const playerInstances: MockYTPlayer[] = [];

class MockYTPlayer {
  videoId: string;
  config: { events: { onReady: () => void; onError: (e: { data: number }) => void } };
  cueVideoById = vi.fn();
  destroy = vi.fn();
  setPlaybackRate = vi.fn();
  getCurrentTime = vi.fn(() => 0);

  constructor(_el: HTMLElement, config: { videoId: string; events: MockYTPlayer['config']['events'] }) {
    this.videoId = config.videoId;
    this.config = config;
    playerInstances.push(this);
  }

  fireReady() {
    this.config.events.onReady();
  }
}

// The component keeps module-level API state (apiReady/apiLoading), so each
// test must import a fresh module instance to start from a clean slate.
async function mountWithFreshModule(props: { youtubeId: string; startTime?: number }) {
  vi.resetModules();
  const mod = await import('../YouTubeEmbed');
  const Comp = mod.default;
  YouTubeEmbed_module = Comp;
  return render(React.createElement(Comp, props));
}
let YouTubeEmbed_module: React.ComponentType<{ youtubeId: string; startTime?: number }>;

describe('YouTubeEmbed video-switch race', () => {
  beforeEach(() => {
    playerInstances.length = 0;
    (window as unknown as { YT: unknown }).YT = { Player: MockYTPlayer };
  });

  afterEach(() => {
    cleanup();
    delete (window as unknown as { YT?: unknown }).YT;
    delete (window as unknown as { onYouTubeIframeAPIReady?: unknown }).onYouTubeIframeAPIReady;
    vi.restoreAllMocks();
  });

  it('cues the newly loaded video once the player becomes ready after the switch', async () => {
    const { rerender } = await mountWithFreshModule({ youtubeId: 'sampleAAA' });

    // API ready → player is created with the initial (sample) video.
    act(() => {
      (window as unknown as { onYouTubeIframeAPIReady: () => void }).onYouTubeIframeAPIReady();
    });
    expect(playerInstances).toHaveLength(1);
    expect(playerInstances[0].videoId).toBe('sampleAAA');

    // The learner loads a different video while the player is still NOT ready.
    rerender(React.createElement(YouTubeEmbed_module, { youtubeId: 'zooBBBB' }));

    // Player finishes initializing only now. The component must notice the
    // pending video switch and cue the real video; keeping the sample video
    // would desync every seek/replay against the wrong content.
    act(() => {
      playerInstances[0].fireReady();
    });

    expect(playerInstances[0].cueVideoById).toHaveBeenCalledWith('zooBBBB');
  });


  it('Y4/Y8: re-cues the initial video exactly once at ready and never loops on a stable id', async () => {
    const { rerender } = await mountWithFreshModule({ youtubeId: 'sampleAAA' });
    act(() => {
      (window as unknown as { onYouTubeIframeAPIReady: () => void }).onYouTubeIframeAPIReady();
    });
    act(() => {
      playerInstances[0].fireReady();
    });
    // The status-aware effect re-applies the initial video once at ready; it
    // must not repeat while the id stays stable (no cue loop).
    expect(playerInstances[0].cueVideoById).toHaveBeenCalledTimes(1);
    expect(playerInstances[0].cueVideoById).toHaveBeenCalledWith('sampleAAA');
    rerender(React.createElement(YouTubeEmbed_module, { youtubeId: 'sampleAAA' }));
    expect(playerInstances[0].cueVideoById).toHaveBeenCalledTimes(1);
  });

  it('Y6: cues with the start seconds when a startTime is provided', async () => {
    await mountWithFreshModule({ youtubeId: 'sampleAAA', startTime: 30 });
    act(() => {
      (window as unknown as { onYouTubeIframeAPIReady: () => void }).onYouTubeIframeAPIReady();
    });
    expect(playerInstances[0].videoId).toBe('sampleAAA');
    act(() => {
      playerInstances[0].fireReady();
    });
    expect(playerInstances[0].cueVideoById).toHaveBeenCalledWith({ videoId: 'sampleAAA', startSeconds: 30 });
  });

  it('still cues immediately when the video changes while the player is ready', async () => {
    const { rerender } = await mountWithFreshModule({ youtubeId: 'sampleAAA' });

    act(() => {
      (window as unknown as { onYouTubeIframeAPIReady: () => void }).onYouTubeIframeAPIReady();
    });
    act(() => {
      playerInstances[0].fireReady();
    });

    rerender(React.createElement(YouTubeEmbed_module, { youtubeId: 'zooBBBB' }));
    expect(playerInstances[0].cueVideoById).toHaveBeenCalledWith('zooBBBB');
  });
});
