import { test, expect, type Page } from '@playwright/test';

function silentWav(seconds = 60): Buffer {
  const sampleRate = 8000;
  const dataSize = sampleRate * seconds * 2;
  const wav = Buffer.alloc(44 + dataSize);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write('WAVE', 8);
  wav.write('fmt ', 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(dataSize, 40);
  return wav;
}

async function audioState(page: Page) {
  return page.locator('audio').evaluate((audio) => ({
    currentTime: audio.currentTime,
    paused: audio.paused,
    duration: audio.duration,
    src: audio.currentSrc,
  }));
}

test('pauses local audio when leaving Study and stays paused on return', async ({ page }) => {
  const requests: string[] = [];
  const blocked: Array<{ url: string; reason: string }> = [];
  page.on('request', (request) => requests.push(request.url()));

  // Guard every request before the first navigation: only local app assets pass.
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    const loopback = url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost');
    const productApi = url.pathname === '/api' || url.pathname.startsWith('/api/');
    if (!loopback || productApi) {
      blocked.push({ url: url.href, reason: !loopback ? 'non-loopback' : 'product-api' });
      await route.abort();
      return;
    }
    await route.continue();
  });

  await page.addInitScript(({ wav }) => {
    const blobUrl = URL.createObjectURL(new Blob([Uint8Array.from(wav)], { type: 'audio/wav' }));
    const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
    if (!descriptor?.get || !descriptor.set) throw new Error('HTMLMediaElement.src unavailable');
    const localize = (value: string) => {
      const text = String(value);
      return text.includes('/api/audio') || text.includes('/api/bilibili') ? blobUrl : value;
    };
    Object.defineProperty(HTMLMediaElement.prototype, 'src', {
      configurable: descriptor.configurable,
      enumerable: descriptor.enumerable,
      get: descriptor.get,
      set(value) { descriptor.set!.call(this, localize(value)); },
    });
    const nativeSetAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
      if (this instanceof HTMLMediaElement && name.toLowerCase() === 'src') {
        return nativeSetAttribute.call(this, name, localize(value));
      }
      return nativeSetAttribute.call(this, name, value);
    };

    const lines = [
      { id: 'b1', start: 27, end: 29, text: 'Good morning. How are you?' },
      { id: 'b2', start: 29, end: 31, text: '(Audience) Good.' },
      { id: 'b3', start: 31, end: 33, text: "It's been great, hasn't it?" },
    ];
    localStorage.setItem('echolearn-tour-completed-v1', '1');
    localStorage.setItem('echolearn_lang', 'en');
    localStorage.setItem('echolearn-lang-chosen', '1');
    localStorage.setItem('echolearn_audio_mode', '0');
    localStorage.setItem('echolearn_playback_rate', '1');
    localStorage.setItem('echolearn_session', JSON.stringify({
      id: 'local-audio-route-lifecycle',
      youtubeUrl: 'https://www.bilibili.com/video/BV1local',
      youtubeId: 'BV1local',
      platform: 'bilibili',
      title: 'Local route lifecycle fixture',
      transcriptLines: lines,
      transcriptData: { rawBlocks: lines, sentenceLines: lines },
      createdAt: 1,
      updatedAt: 1,
      lastPosition: 27,
      status: 'studying',
    }));
  }, { wav: Array.from(silentWav()) });

  const visibleLines = page.locator('[data-transcript-line]:visible');
  const activeLine = (text: string) => page.locator('[data-transcript-line].bg-indigo-50')
    .filter({ hasText: text }).filter({ visible: true }).first();
  const clickLine = async (text: string) => visibleLines.filter({ hasText: text }).first().locator('span').first().click();

  await page.goto('/');
  await page.getByRole('button', { name: /Try without login/i }).click();
  await page.getByRole('link', { name: 'Study', exact: true }).click();
  await page.waitForURL('**/study');
  await visibleLines.filter({ hasText: 'Good morning' }).first().waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Audio mode', exact: true }).click();
  await page.locator('audio').waitFor({ state: 'attached' });
  await page.waitForFunction(() => {
    const audio = document.querySelector('audio');
    return !!audio && audio.readyState >= 1 && audio.duration === 60;
  });

  const enabled = await audioState(page);
  expect(enabled.src).toMatch(/^blob:/);

  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(() => (document.querySelector('audio')?.currentTime ?? 0) >= 27.5);
  await activeLine('Good morning').waitFor({ state: 'visible' });

  await clickLine('Audience');
  const seekReplayImmediate = await audioState(page);
  await activeLine('Audience').waitFor({ state: 'visible', timeout: 500 });
  const seekReplayAfter = await audioState(page);
  expect(seekReplayImmediate.currentTime).toBeGreaterThanOrEqual(29);
  expect(seekReplayImmediate.currentTime).toBeLessThan(29.2);
  if (seekReplayAfter.paused) await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(() => (document.querySelector('audio')?.currentTime ?? 0) >= 29.3);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect.poll(async () => (await audioState(page)).paused).toBe(true);

  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(() => (document.querySelector('audio')?.currentTime ?? 0) >= 29.5);
  const beforeLeave = await audioState(page);
  expect(beforeLeave.paused).toBe(false);

  await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
  await page.waitForURL('**/');
  await page.waitForTimeout(500);
  const whileAway = await audioState(page);
  expect(whileAway.paused).toBe(true);
  expect(Math.abs(whileAway.currentTime - beforeLeave.currentTime)).toBeLessThan(0.15);

  await page.getByRole('link', { name: 'Study', exact: true }).click();
  await page.waitForURL('**/study');
  await activeLine('Audience').waitFor({ state: 'visible' });
  const afterReturn = await audioState(page);
  expect(afterReturn.paused).toBe(true);
  expect(Math.abs(afterReturn.currentTime - whileAway.currentTime)).toBeLessThan(0.15);

  const audioRequests = requests.filter((url) => /\/api\/audio(?:[/?]|$)/.test(url));
  const bilibiliRequests = requests.filter((url) => /\/api\/bilibili(?:[/?]|$)/.test(url));
  expect(audioRequests).toHaveLength(0);
  expect(bilibiliRequests).toHaveLength(0);
  expect(blocked.every(({ reason }) => reason === 'non-loopback' || reason === 'product-api')).toBe(true);
  console.log(JSON.stringify({ enabled, seekReplayImmediate, seekReplayAfter, beforeLeave, whileAway, afterReturn, audioRequests, bilibiliRequests, blocked }));
});
