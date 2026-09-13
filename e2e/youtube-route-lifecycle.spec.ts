import { test, expect } from '@playwright/test';

test('pauses the local YouTube player on Study leave and stays paused on return', async ({ page }) => {
  const blocked: string[] = [];
  const allowedExternal: string[] = [];
  const allowedProductApi: string[] = [];

  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    const loopback = url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost');
    const productApi = url.pathname === '/api' || url.pathname.startsWith('/api/');
    if (!loopback || productApi) {
      blocked.push(url.href);
      await route.abort();
      return;
    }
    if (!loopback) allowedExternal.push(url.href);
    if (productApi) allowedProductApi.push(url.href);
    await route.continue();
  });

  await page.addInitScript(() => {
    const players: Array<{
      currentTime: number;
      paused: boolean;
      playCalls: number;
      pauseCalls: number;
      destroyed: boolean;
      timer?: number;
    }> = [];

    class FakePlayer {
      private state: (typeof players)[number];

      constructor(_element: HTMLElement, options: { playerVars?: { start?: number }; events?: { onReady?: (event: { target: FakePlayer }) => void } }) {
        this.state = {
          currentTime: options.playerVars?.start ?? 0,
          paused: true,
          playCalls: 0,
          pauseCalls: 0,
          destroyed: false,
        };
        players.push(this.state);
        (window as unknown as { __fakeYtPlayer?: FakePlayer }).__fakeYtPlayer = this;
        queueMicrotask(() => options.events?.onReady?.({ target: this }));
      }

      playVideo() {
        this.state.playCalls += 1;
        this.state.paused = false;
        window.clearInterval(this.state.timer);
        this.state.timer = window.setInterval(() => { this.state.currentTime += 0.1; }, 100);
      }

      pauseVideo() {
        this.state.pauseCalls += 1;
        this.state.paused = true;
        window.clearInterval(this.state.timer);
      }

      seekTo(seconds: number) {
        this.state.currentTime = seconds;
      }

      getCurrentTime() {
        return this.state.currentTime;
      }

      setPlaybackRate(_rate: number) {}

      getPlaybackRate() {
        return 1;
      }

      getPlayerState() {
        return this.state.paused ? 2 : 1;
      }

      destroy() {
        this.state.destroyed = true;
        window.clearInterval(this.state.timer);
      }
    }

    (window as unknown as {
      YT: { Player: typeof FakePlayer };
      __fakeYtPlayers: typeof players;
    }).YT = { Player: FakePlayer };
    (window as unknown as { __fakeYtPlayers: typeof players }).__fakeYtPlayers = players;

    const appendChild = Node.prototype.appendChild;
    Node.prototype.appendChild = function (node) {
      if (node instanceof HTMLScriptElement && node.src.includes('youtube.com/iframe_api')) {
        queueMicrotask(() => (window as unknown as { onYouTubeIframeAPIReady?: () => void }).onYouTubeIframeAPIReady?.());
        return node;
      }
      return appendChild.call(this, node);
    };

    localStorage.setItem('echolearn_lang', 'en');
    localStorage.setItem('echolearn-lang-chosen', '1');
    localStorage.setItem('echolearn-tour-completed-v1', '1');
    localStorage.setItem('echolearn_audio_mode', '0');
    localStorage.setItem('echolearn_playback_rate', '1');
    localStorage.setItem('echolearn_session', JSON.stringify({
      id: 'youtube-route-lifecycle',
      youtubeUrl: 'https://www.youtube.com/watch?v=local-route',
      youtubeId: 'local-route',
      platform: 'youtube',
      title: 'Local YouTube route fixture',
      transcriptLines: [{ id: 'y1', start: 12, end: 14, text: 'Local YouTube route fixture.' }],
      transcriptData: {
        rawBlocks: [{ id: 'y1', start: 12, end: 14, text: 'Local YouTube route fixture.' }],
        sentenceLines: [{ id: 'y1', start: 12, end: 14, text: 'Local YouTube route fixture.' }],
      },
      createdAt: 1,
      updatedAt: 1,
      lastPosition: 12,
      status: 'studying',
    }));
  });

  await page.goto('/');
  await page.getByRole('button', { name: /Try without login/i }).click();
  await page.getByRole('link', { name: 'Study', exact: true }).click();
  await page.waitForURL(/\/study$/);

  const visibleLine = page.locator('[data-transcript-line]:visible').filter({ hasText: 'Local YouTube route fixture.' }).first();
  await visibleLine.waitFor({ state: 'visible' });
  await expect.poll(async () => page.evaluate(() => (window as unknown as { __fakeYtPlayers: Array<unknown> }).__fakeYtPlayers.length))
    .toBe(1);

  await visibleLine.locator('span').first().click();
  await expect.poll(async () => page.evaluate(() => {
    const players = (window as unknown as { __fakeYtPlayers: Array<{ paused: boolean; playCalls: number }> }).__fakeYtPlayers;
    return { paused: players[0]?.paused, playCalls: players[0]?.playCalls };
  })).toEqual({ paused: false, playCalls: 1 });

  await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
  await page.waitForURL(/\/$/);
  await expect.poll(async () => page.evaluate(() => {
    const player = (window as unknown as { __fakeYtPlayers: Array<{ paused: boolean; pauseCalls: number }> }).__fakeYtPlayers[0];
    return { paused: player?.paused, pauseCalls: player?.pauseCalls };
  })).toEqual({ paused: true, pauseCalls: 1 });

  await page.getByRole('link', { name: 'Study', exact: true }).click();
  await page.waitForURL(/\/study$/);
  await visibleLine.waitFor({ state: 'visible' });
  await expect.poll(async () => page.evaluate(() => (window as unknown as { __fakeYtPlayers: Array<unknown> }).__fakeYtPlayers.length))
    .toBe(1);
  await expect.poll(async () => page.evaluate(() => {
    const player = (window as unknown as { __fakeYtPlayers: Array<{ paused: boolean; playCalls: number; pauseCalls: number }> }).__fakeYtPlayers[0];
    return { paused: player?.paused, playCalls: player?.playCalls, pauseCalls: player?.pauseCalls };
  })).toEqual({ paused: true, playCalls: 1, pauseCalls: 1 });

  expect(allowedExternal).toEqual([]);
  expect(allowedProductApi).toEqual([]);
  console.log('YOUTUBE_ROUTE_LIFECYCLE_EVIDENCE ' + JSON.stringify({ blocked, allowedExternal, allowedProductApi }));
});
