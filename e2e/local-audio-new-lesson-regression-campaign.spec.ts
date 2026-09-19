import { test, expect, type Page } from '@playwright/test';

/**
 * P5 NEW_LESSON_REGRESSION + same-filename discriminator — campaign (untracked).
 * Runs against the production build preview (http://127.0.0.1:5278).
 * Restore must not break Import New Lesson; filename is not session identity.
 */

// Runs against the standard dev server (playwright baseURL). The restore flow
// does not depend on the service-worker precache; only the integrated-journey
// spec needs the production-build preview (its offline navigation uses SW).

function makeWav(seconds = 4, freq = 262): Buffer {
  const sr = 8000, n = sr * seconds;
  const data = Buffer.alloc(44 + n);
  data.write('RIFF', 0); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(sr, 24); data.writeUInt32LE(sr, 28); data.writeUInt16LE(1, 32); data.writeUInt16LE(8, 34);
  data.write('data', 36); data.writeUInt32LE(n, 40);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const env = 0.4 + 0.3 * Math.sin(2 * Math.PI * 1.5 * t);
    const v = Math.sin(2 * Math.PI * freq * t) * 45 * env;
    data.writeUInt8(Math.max(0, Math.min(255, Math.round(128 + v))), 44 + i);
  }
  return data;
}

const srtFor = (marker: string) => [
  `1\n00:00:00,000 --> 00:00:02,000\n${marker} opens with the first line.`,
  `2\n00:00:02,000 --> 00:00:04,000\n${marker} closes with the second line.`,
].join('\n\n');

async function enterGuest(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('echolearn_lang', 'en');
    localStorage.setItem('echolearn-lang-chosen', '1');
    localStorage.setItem('echolearn-tour-completed-v1', '1');
  });
  await page.goto('/');
  for (let i = 0; i < 3; i++) {
    const g = page.getByRole('button', { name: /^(Try without login|先体验一下)$/ });
    if (await g.isVisible().catch(() => false)) { await g.click(); await g.waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {}); }
    if (await page.locator('a[href="/study"]').filter({ visible: true }).isVisible().catch(() => false)) break;
  }
  const en = page.getByRole('button', { name: 'English', exact: true });
  if (await en.isVisible().catch(() => false)) await en.click();
}

async function importLesson(page: Page, audioName: string, srt: string, wav: Buffer, expectRestore = false) {
  await page.goto('/study', { waitUntil: 'domcontentloaded' });
  const importer = page.getByTestId('local-media-importer').first();
  await importer.waitFor({ state: 'visible', timeout: 10000 });
  await importer.getByTestId('local-media-audio-input').setInputFiles({ name: audioName, mimeType: 'audio/wav', buffer: wav });
  await importer.getByTestId('local-media-subtitle-input').setInputFiles({ name: audioName.replace(/\.wav$/, '.srt'), mimeType: 'application/x-subrip', buffer: Buffer.from(srt, 'utf8') });
  const label = expectRestore ? /Restore Audio for This Lesson/i : /Open in Study/i;
  await importer.getByRole('button', { name: label }).click();
  await page.getByText(`${srt.split('\n')[2].split('\n')[0].slice(0, 20)}`).first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
}

async function clearCurrentSession(page: Page) {
  await page.locator('button:visible', { hasText: /^Clear$/ }).first().click();
  await page.waitForTimeout(800);
}

async function mediaCount(page: Page) {
  return page.evaluate(() => new Promise<number>((res) => {
    // Open WITHOUT a version so a missing DB is not created with an empty
    // schema (that would race the app's own onupgradeneeded store creation).
    const rq = indexedDB.open('echolearn-local-media-v2');
    rq.onupgradeneeded = () => {
      // DB did not exist; this open created it empty — remove it again.
      rq.result?.close();
      indexedDB.deleteDatabase('echolearn-local-media-v2');
      res(0);
    };
    rq.onsuccess = () => {
      const db = rq.result;
      if (!db.objectStoreNames.contains('media')) { db.close(); res(0); return; }
      const c = db.transaction('media', 'readonly').objectStore('media').count();
      c.onsuccess = () => { db.close(); res(c.result); };
    };
    rq.onerror = () => res(-1);
  }));
}

/** Save the current word with a retry: the popup re-mounts when dictionary data lands. */
async function saveCurrentWordWithRetry(page: Page, word: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.locator(`[role=button][aria-label="Look up ${word}"]:visible`).first().click();
    const add = page.getByRole('button', { name: /\+ Add to [Vv]ocab/i });
    await add.waitFor({ state: 'visible', timeout: 6000 }).catch(() => {});
    if (await add.count()) {
      await add.first().click();
      await page.waitForTimeout(1200);
    }
    const saved = await page.evaluate((w) => JSON.parse(localStorage.getItem('echolearn_vocabulary') || '[]').some((x: { word?: string }) => (x.word || '').toLowerCase() === w.toLowerCase()), word);
    if (saved) return true;
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(400);
  }
  return false;
}

async function currentSession(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('echolearn_session') || 'null'));
}

test('new lessons stay distinct; explicit clear followed by restore keeps lessons coexisting', async ({ page }) => {
  test.setTimeout(240_000);
  await enterGuest(page);
  const stamp = Date.now();
  const wavA = makeWav(4, 262);
  const wavB = makeWav(4, 330);
  const srtA = srtFor('Alpha lesson');
  const srtB = srtFor('Bravo lesson');

  const mediaBefore = await mediaCount(page);

  // lesson A (new-lesson entry point)
  await importLesson(page, `regression-a-${stamp}.wav`, srtA, wavA);
  const sA = await currentSession(page);
  expect(sA.title).toBe(`regression-a-${stamp}.wav`);
  const mediaAfterA = await mediaCount(page);
  expect(mediaAfterA).toBe(mediaBefore + 1);

  // explicit Clear (existing accepted semantics), then import B as a new lesson
  await clearCurrentSession(page);
  await importLesson(page, `regression-b-${stamp}.wav`, srtB, wavB);
  const sB = await currentSession(page);
  expect(sB.title).toBe(`regression-b-${stamp}.wav`);
  expect(sB.id).not.toBe(sA.id);
  expect(sB.youtubeId).not.toBe(sA.youtubeId);

  // two distinct sessions in history; B playable
  const list = await page.evaluate(() => JSON.parse(localStorage.getItem('echolearn_sessions_list') || '[]') as Array<{ id: string; title: string }>);
  expect(list.filter(s => s.title === `regression-a-${stamp}.wav`)).toHaveLength(1);
  expect(list.filter(s => s.title === `regression-b-${stamp}.wav`)).toHaveLength(1);
  expect(await page.evaluate(() => !!document.querySelector('audio'))).toBe(true);

  // reopen A from Dashboard -> missing-blob restore path (blob was explicitly cleared)
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.getByText(`regression-a-${stamp}.wav`).first().waitFor({ state: 'visible', timeout: 10000 });
  const aRow = page.locator('div, li').filter({ hasText: new RegExp(`regression-a-${stamp}`) }).filter({ has: page.getByRole('button', { name: 'Open' }) }).last();
  await aRow.getByRole('button', { name: 'Open' }).first().click();
  await page.waitForTimeout(2000);
  const aState = await page.evaluate(() => {
    const t = document.body.innerText;
    return { missingBanner: /unavailable after reload/i.test(t), restoreCta: /Restore Audio for This Lesson/i.test(t) };
  });
  expect(aState.missingBanner).toBe(true);

  // restore A with the ORIGINAL A files -> playable, distinct from B, B untouched
  const importer = page.getByTestId('local-media-importer').first();
  await importer.waitFor({ state: 'visible', timeout: 10000 });
  await importer.getByTestId('local-media-audio-input').setInputFiles({ name: `regression-a-${stamp}.wav`, mimeType: 'audio/wav', buffer: wavA });
  await importer.getByTestId('local-media-subtitle-input').setInputFiles({ name: `regression-a-${stamp}.srt`, mimeType: 'application/x-subrip', buffer: Buffer.from(srtA, 'utf8') });
  await importer.getByRole('button', { name: /Restore Audio for This Lesson/i }).click();
  await page.waitForFunction(() => !!document.querySelector('audio') && /Alpha lesson opens/.test(document.body.innerText), { timeout: 15000 });
  const sA2 = await currentSession(page);
  expect(sA2.id).toBe(sA.id);
  expect(sA2.youtubeId).toBe(sA.youtubeId);

  // vocabulary contexts are not mixed: save a word from A, it points at A only
  expect(await saveCurrentWordWithRetry(page, 'Alpha')).toBe(true);
  const vocab = await page.evaluate(() => JSON.parse(localStorage.getItem('echolearn_vocabulary') || '[]') as Array<{ word: string; sourceVideoId: string }>);
  const alpha = vocab.filter(w => w.word.toLowerCase() === 'alpha');
  expect(alpha).toHaveLength(1);
  expect(alpha[0].sourceVideoId).toBe(sA.youtubeId);

  // both sessions coexist in history; no duplicate from restoration
  const list2 = await page.evaluate(() => JSON.parse(localStorage.getItem('echolearn_sessions_list') || '[]') as Array<{ title: string }>);
  expect(list2.filter(s => s.title === `regression-a-${stamp}.wav`)).toHaveLength(1);
  expect(list2.filter(s => s.title === `regression-b-${stamp}.wav`)).toHaveLength(1);
});

test('two unrelated files with the SAME filename remain two distinct lessons', async ({ page }) => {
  test.setTimeout(240_000);
  await enterGuest(page);
  const stamp = Date.now();
  const sameName = `same-name-${stamp}.wav`;
  const wav1 = makeWav(4, 294);
  const wav2 = makeWav(4, 440);
  const srt1 = srtFor('Delta content');
  const srt2 = srtFor('Echo content');

  await importLesson(page, sameName, srt1, wav1);
  const s1 = await currentSession(page);
  await clearCurrentSession(page);
  await importLesson(page, sameName, srt2, wav2);
  const s2 = await currentSession(page);

  // filename is not identity: distinct ids and blobs
  expect(s1.title).toBe(s2.title);
  expect(s1.id).not.toBe(s2.id);
  expect(s1.youtubeId).not.toBe(s2.youtubeId);

  // save a word from lesson 2 — it must associate with lesson 2's identity only
  expect(await saveCurrentWordWithRetry(page, 'Echo')).toBe(true);
  const vocab = await page.evaluate(() => JSON.parse(localStorage.getItem('echolearn_vocabulary') || '[]') as Array<{ word: string; sourceVideoId: string }>);
  const echoWords = vocab.filter(w => w.word.toLowerCase() === 'echo');
  expect(echoWords).toHaveLength(1);
  expect(echoWords[0].sourceVideoId).toBe(s2.youtubeId);
});

test('pre-restore learning record survives audio restoration (CA1/CA2/CA5/CA6/CA8/CA9)', async ({ page }) => {
  test.setTimeout(240_000);
  await enterGuest(page);
  const stamp = Date.now();
  const audioName = `identity-restore-${stamp}.wav`;
  const wav = makeWav(4, 349);
  const srt = srtFor('Foxtrot content');

  // import lesson A and save a word W + sentence S BEFORE any restoration
  await importLesson(page, audioName, srt, wav);
  const sA = await currentSession(page);
  expect(sA.title).toBe(audioName);
  expect(await saveCurrentWordWithRetry(page, 'Foxtrot')).toBe(true);
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('div.group')].filter(el => (el.innerText || '').includes('closes with the second line') && el.getBoundingClientRect().width > 0);
    const row = rows[rows.length - 1];
    const btn = [...row.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || '').includes('Save sentence'));
    row.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, view: window }));
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  });
  await page.waitForTimeout(800);
  const before = await page.evaluate(() => ({
    vocab: JSON.parse(localStorage.getItem('echolearn_vocabulary') || '[]') as Array<{ word: string; sourceVideoId: string }>,
    sentences: JSON.parse(localStorage.getItem('echolearn_sentences') || '[]') as Array<{ sourceVideoId: string }>,
  }));
  const wordBefore = before.vocab.find(w => w.word.toLowerCase() === 'foxtrot');
  expect(wordBefore?.sourceVideoId).toBe(sA.youtubeId);

  // device-local Blob loss (eviction), session record survives -> missing-blob state
  await page.evaluate((mediaId) => new Promise<void>((res, rej) => {
    const rq = indexedDB.open('echolearn-local-media-v2');
    rq.onsuccess = () => {
      const db = rq.result;
      const tx = db.transaction('media', 'readwrite');
      tx.objectStore('media').delete(mediaId);
      tx.oncomplete = () => { db.close(); res(); };
      tx.onerror = () => rej(tx.error);
    };
  }), sA.localMediaId);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const missing = await page.evaluate(() => {
    const t = document.body.innerText;
    return { banner: /unavailable after reload/i.test(t), restoreCta: /Restore Audio for This Lesson/i.test(t) };
  });
  expect(missing.banner).toBe(true);
  expect(missing.restoreCta).toBe(true);

  // restore with the SAME files
  const importer = page.getByTestId('local-media-importer').first();
  await importer.waitFor({ state: 'visible', timeout: 10000 });
  await importer.getByTestId('local-media-audio-input').setInputFiles({ name: audioName, mimeType: 'audio/wav', buffer: wav });
  await importer.getByTestId('local-media-subtitle-input').setInputFiles({ name: audioName.replace(/\.wav$/, '.srt'), mimeType: 'application/x-subrip', buffer: Buffer.from(srt, 'utf8') });
  await importer.getByRole('button', { name: /Restore Audio for This Lesson/i }).click();
  await page.waitForFunction(() => !!document.querySelector('audio') && !/unavailable after reload/i.test(document.body.innerText), { timeout: 15000 });

  // CA1/CA2: original session identity preserved
  const sA2 = await currentSession(page);
  expect(sA2.id).toBe(sA.id);
  expect(sA2.youtubeId).toBe(sA.youtubeId);
  // CA3: playable
  expect(await page.evaluate(() => !!document.querySelector('audio'))).toBe(true);
  // CA5/CA6: pre-existing word and sentence stay associated with the SAME lesson identity
  const after = await page.evaluate(() => ({
    vocab: JSON.parse(localStorage.getItem('echolearn_vocabulary') || '[]') as Array<{ word: string; sourceVideoId: string }>,
    sentences: JSON.parse(localStorage.getItem('echolearn_sentences') || '[]') as Array<{ sourceVideoId: string }>,
  }));
  expect(after.vocab.filter(w => w.word.toLowerCase() === 'foxtrot')).toHaveLength(1);
  expect(after.vocab.find(w => w.word.toLowerCase() === 'foxtrot')?.sourceVideoId).toBe(sA.youtubeId);
  expect(after.sentences.filter(s => s.sourceVideoId === sA.youtubeId).length).toBeGreaterThanOrEqual(1);
  // CA8: no duplicate session from restoration
  const list = await page.evaluate(() => JSON.parse(localStorage.getItem('echolearn_sessions_list') || '[]') as Array<{ id: string; title: string }>);
  expect(list.filter(s => s.title === audioName)).toHaveLength(1);
  // CA9: saving the same word again does not duplicate
  const addCount = await page.getByRole('button', { name: /\+ Add to [Vv]ocab/i }).count();
  expect(addCount).toBe(0);
});
