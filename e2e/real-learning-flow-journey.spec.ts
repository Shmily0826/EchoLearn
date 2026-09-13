import { test, expect, type Page } from '@playwright/test';
import { enterGuestMode } from './helpers/guestMode';

/**
 * REAL_LEARNING_FLOW_V1 — one coherent guest learning journey.
 *
 * A fresh guest enters Study with a deterministic local session fixture,
 * understands a word through the dictionary popup, saves the word and a
 * sentence, listens with deterministic local audio, replays an earlier
 * line, leaves Study mid-playback (audio must stop), inspects the saved
 * word and sentence in Vocabulary / Sentences, and returns to Study with
 * the context intact.
 *
 * Network contract for the whole journey:
 *   /api/dictionary → local fixture   (allowed)
 *   extracted audio   → local blob    (allowed)
 *   everything else   → recorded + aborted
 *   /api/ai attempts  → MUST be 0     (hard guest cost boundary)
 */

const FIXTURE_LINES = [
  { id: 'b1', start: 27, end: 29, text: 'Good morning. How are you?' },
  { id: 'b2', start: 29, end: 31, text: '(Audience) Good.' },
  { id: 'b3', start: 31, end: 33, text: "It's been great, hasn't it?" },
  { id: 'b4', start: 33, end: 36, text: "I've been blown away by the whole thing." },
  { id: 'b5', start: 36, end: 38, text: "In fact, I'm leaving." },
];

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
  }));
}

test('guest learning journey: study → understand → save → listen → leave → inspect → return', async ({ page }) => {
  test.setTimeout(180_000);

  // ── Request-level evidence, installed before the first navigation ──
  let apiAiAttempts = 0;
  const externalHosts = new Set<string>();
  const unexpectedProductApi: string[] = [];
  const allRequests: string[] = [];

  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    allRequests.push(url.host + url.pathname);
    const loopback = url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost');
    if (!loopback) {
      externalHosts.add(url.host);
      await route.abort();
      return;
    }
    if (url.pathname === '/api/ai' || url.pathname.startsWith('/api/ai/')) {
      apiAiAttempts += 1;
      await route.abort();
      return;
    }
    if (url.pathname.startsWith('/api/dictionary')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ipa_uk: '/ɡʊd/',
          ipa_us: '/ɡʊd/',
          audio_url: '',
          base_form: 'good',
          source: 'free-dictionary',
          entries: [{
            pos: 'adjective',
            definitions: [{ display_order: 1, definitions_json: { definition: 'of high quality' } }],
          }],
        }),
      });
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      unexpectedProductApi.push(url.pathname);
      await route.abort();
      return;
    }
    await route.continue();
  });

  // Deterministic local audio: media element sources point at a local blob.
  await page.addInitScript(({ wav, lines }) => {
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

    localStorage.setItem('echolearn_lang', 'en');
    localStorage.setItem('echolearn-lang-chosen', '1');
    localStorage.setItem('echolearn-tour-completed-v1', '1');
    localStorage.setItem('echolearn_audio_mode', '0');
    localStorage.setItem('echolearn_playback_rate', '1');
    localStorage.removeItem('echolearn_vocabulary');
    localStorage.removeItem('echolearn_sentences');
    localStorage.setItem('echolearn_session', JSON.stringify({
      id: 'e2e-real-learning-flow',
      youtubeUrl: 'https://www.bilibili.com/video/BV1realflow',
      youtubeId: 'BV1realflow',
      platform: 'bilibili',
      title: 'Real learning flow fixture',
      transcriptLines: lines,
      transcriptData: { rawBlocks: lines, sentenceLines: lines },
      createdAt: 1,
      updatedAt: 1,
      lastPosition: 27,
      status: 'studying',
    }));
  }, { wav: Array.from(silentWav()), lines: FIXTURE_LINES });

  const visibleLines = page.locator('[data-transcript-line]:visible');
  const activeLine = (text: string) => page.locator('[data-transcript-line].bg-indigo-50')
    .filter({ hasText: text }).filter({ visible: true }).first();
  const clickLine = async (text: string) =>
    visibleLines.filter({ hasText: text }).first().locator('span').first().click();

  // ── A. Enter learning ─────────────────────────────────────────
  await page.goto('/');
  await enterGuestMode(page);
  await page.getByRole('link', { name: 'Study', exact: true }).click();
  await expect(page).toHaveURL(/\/study$/);
  // Semantic landmark: the transcript itself is visibly rendered.
  await visibleLines.filter({ hasText: 'Good morning' }).first().waitFor({ state: 'visible', timeout: 15_000 });
  // No misleading blocking state: the loading/error card must not own the page.
  await expect(page.getByText(/Fetching captions/i)).toHaveCount(0);

  // ── B. Understand a word ──────────────────────────────────────
  await page.getByRole('button', { name: 'Look up Good', exact: true }).filter({ visible: true }).first().click();
  const saveButton = page.locator('#tour-transcript-save-word');
  await expect(saveButton).toBeVisible();
  // The popup must make the word understandable, not merely exist.
  await expect(page.locator('text=of high quality').first()).toBeVisible();

  // ── C. Save vocabulary (guest hard boundary: /api/ai = 0) ────
  await saveButton.click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved to Vocabulary' })).toBeVisible();
  await expect(saveButton).toBeHidden({ timeout: 45_000 });
  // The word now renders with the saved highlight in the transcript.
  await expect(
    page.locator('span.bg-amber-100, span[class*="bg-amber-100"]').filter({ hasText: /^good$/i }).filter({ visible: true }).first(),
  ).toBeVisible({ timeout: 10_000 });

  // ── D. Save sentence ──────────────────────────────────────────
  const firstLineBookmark = visibleLines.filter({ hasText: 'Good morning' }).first()
    .locator('#tour-transcript-save-sentence');
  await firstLineBookmark.click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved to Sentences' })).toBeVisible();
  await expect(firstLineBookmark).toHaveAttribute('aria-label', 'Remove bookmark', { timeout: 10_000 });

  // ── E. Listening / replay ─────────────────────────────────────
  await page.getByRole('button', { name: 'Audio mode', exact: true }).click();
  await page.locator('audio').waitFor({ state: 'attached', timeout: 10_000 });
  await page.waitForFunction(() => {
    const audio = document.querySelector('audio');
    return !!audio && audio.readyState >= 1 && audio.duration === 60;
  });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(() => (document.querySelector('audio')?.currentTime ?? 0) >= 27.5);
  await activeLine('Good morning').waitFor({ state: 'visible', timeout: 5_000 });

  // Pause: position must stop advancing.
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect.poll(async () => (await audioState(page)).paused, { timeout: 10_000 }).toBe(true);
  const pausedState = await audioState(page);
  let pausedSamples = 0;
  let lastPausedPosition = pausedState.currentTime;
  await expect.poll(async () => {
    const state = await audioState(page);
    const stable = state.paused && pausedSamples > 0 && Math.abs(state.currentTime - lastPausedPosition) < 0.05;
    lastPausedPosition = state.currentTime;
    pausedSamples += 1;
    return stable;
  }, { timeout: 10_000 }).toBe(true);

  // Replay an earlier line while paused: seek + active line must agree.
  await clickLine('Good morning');
  await expect.poll(async () => (await audioState(page)).currentTime, { timeout: 10_000 })
    .toBeLessThan(pausedState.currentTime);
  const replayPosition = await audioState(page);
  await expect.poll(async () => (await audioState(page)).paused, { timeout: 10_000 }).toBe(false);
  await activeLine('Good morning').waitFor({ state: 'visible', timeout: 5_000 });
  await expect.poll(async () => (await audioState(page)).currentTime, { timeout: 10_000 })
    .toBeGreaterThan(replayPosition.currentTime + 0.05);

  // ── F. Leave Study mid-playback ───────────────────────────────
  const beforeLeave = await audioState(page);
  expect(beforeLeave.paused).toBe(false);
  await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
  await page.waitForURL(/\/$/);
  await expect.poll(async () => (await audioState(page)).paused, { timeout: 10_000 }).toBe(true);
  let awaySamples = 0;
  let lastAwayPosition = beforeLeave.currentTime;
  await expect.poll(async () => {
    const state = await audioState(page);
    const stable = state.paused && awaySamples > 0 && Math.abs(state.currentTime - lastAwayPosition) < 0.05;
    lastAwayPosition = state.currentTime;
    awaySamples += 1;
    return stable;
  }, { timeout: 10_000 }).toBe(true);

  // ── G. Saved material ─────────────────────────────────────────
  await page.getByRole('link', { name: 'Vocabulary', exact: true }).click();
  await expect(page.getByText('1 words')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/^good\b/i).filter({ visible: true }).first()).toBeVisible();

  await page.getByRole('link', { name: 'Sentences', exact: true }).click();
  await expect(
    page.getByText('Good morning. How are you?').filter({ visible: true }).first(),
  ).toBeVisible({ timeout: 10_000 });

  // ── H. Return to Study ────────────────────────────────────────
  await page.getByRole('link', { name: 'Study', exact: true }).click();
  await expect(page).toHaveURL(/\/study$/);
  await visibleLines.filter({ hasText: 'Good morning' }).first().waitFor({ state: 'visible', timeout: 15_000 });
  // Saved actions did not destroy the learning context: the sentence stays
  // bookmarked and the word stays highlighted after the round trip.
  await expect(
    visibleLines.filter({ hasText: 'Good morning' }).first().locator('#tour-transcript-save-sentence'),
  ).toHaveAttribute('aria-label', 'Remove bookmark', { timeout: 10_000 });
  await expect(
    page.locator('span.bg-amber-100, span[class*="bg-amber-100"]').filter({ hasText: /^good$/i }).filter({ visible: true }).first(),
  ).toBeVisible();
  // Audio remains in a safe state (paused, near the paused position).
  await page.locator('audio').waitFor({ state: 'attached', timeout: 10_000 });
  const afterReturn = await audioState(page);
  expect(afterReturn.paused).toBe(true);

  // ── Network invariants for the whole journey ──────────────────
    // Exclude Vite dev-server source modules (e.g. /src/services/studyAsrRecovery.ts)
    // — only real network endpoints count as provider attempts.
    const networkEndpoints = allRequests.filter((u) => !/\/src\//.test(u));
    const evidence = {
      apiAiAttempts,
      unexpectedProductApi,
      externalHosts: [...externalHosts],
      supadataAttempts: networkEndpoints.filter((u) => u.includes('supadata')).length,
      asrAttempts: networkEndpoints.filter((u) => /asr|whisper|groq/i.test(u)).length,
      deepSeekAttempts: networkEndpoints.filter((u) => u.includes('deepseek')).length,
    };
  console.log('REAL_LEARNING_FLOW_EVIDENCE ' + JSON.stringify(evidence));

  expect(apiAiAttempts).toBe(0);
  expect(unexpectedProductApi).toEqual([]);
  expect(evidence.supadataAttempts).toBe(0);
  expect(evidence.asrAttempts).toBe(0);
  expect(evidence.deepSeekAttempts).toBe(0);
  // No real provider or paid endpoint was ever contacted. Non-provider
  // external attempts (e.g. Firebase) may occur in guest mode; they are
  // aborted before any bytes leave and are reported in the evidence.
  const providerHostPattern = /deepseek|supadata|groq|openai|whisper|workers\.dev/i;
  const providerHosts = [...externalHosts].filter((host) => providerHostPattern.test(host));
  expect(providerHosts).toEqual([]);
});
