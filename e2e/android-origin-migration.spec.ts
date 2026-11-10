import { readFileSync } from 'node:fs';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const migrationScript = readFileSync(
  new URL('../android/app/src/main/assets/study-origin-migration.js', import.meta.url), 'utf8',
);
const oldOrigin = 'https://old.echolearn.invalid';
const newOrigin = 'https://new.echolearn.invalid';
const authKey = 'firebase:authUser:fixture:[DEFAULT]';
const audioSize = 700_000;

async function openOrigin(context: BrowserContext, origin: string) {
  const page = await context.newPage();
  await page.route(origin + '/**', route => route.fulfill({
    contentType: 'text/html',
    body: '<script>' + migrationScript + '</script>',
  }));
  await page.goto(origin);
  return page;
}

async function seed(page: Page, data: Record<string, unknown>, audio = false) {
  await page.evaluate(async ({ data, size }) => {
    for (const [key, value] of Object.entries(data)) localStorage.setItem(key, JSON.stringify(value));
    if (!size) return;
    const open = indexedDB.open('echolearn-local-media-v2', 1);
    await new Promise<void>((resolve, reject) => {
      open.onupgradeneeded = () => open.result.createObjectStore('media', { keyPath: 'id' });
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('media', 'readwrite');
        const bytes = new Uint8Array(size);
        bytes[0] = 23;
        bytes[bytes.length - 1] = 67;
        tx.objectStore('media').add({ id: 'audio-1', name: 'lesson.wav', type: 'audio/wav', blob: new Blob([bytes]) });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
    });
  }, { data, size: audio ? audioSize : 0 });
}

async function seedIndexedDbAccount(page: Page, uid: string) {
  await page.evaluate(({ key, uid }) => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('firebaseLocalStorageDb', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('firebaseLocalStorage', { keyPath: 'fbase_key' });
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('firebaseLocalStorage', 'readwrite');
      tx.objectStore('firebaseLocalStorage').add({ fbase_key: key, value: { uid } });
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), { key: authKey, uid });
}

async function connect(source: Page, target: Page, interruptAt?: string) {
  let settle: (value: string) => void;
  const result = new Promise<string>(resolve => { settle = resolve; });
  await source.exposeFunction('replyToTarget', async (id: string, response: string) => {
    if (!target.isClosed()) await target.evaluate(
      ({ id, response }) => Reflect.get(window, 'migrationReceiver')(id, response),
      { id, response },
    );
  });
  await source.evaluate(() => {
    // The asset uses a global lexical binding, so invoke it through page script.
    const script = document.createElement('script');
    script.textContent = 'window.MigrationChannel = { reply: window.replyToTarget }; window.migrationSource = Migration.respond;';
    document.head.append(script);
  });
  await target.exposeFunction('finishMigration', (status: string) => settle(status));
  await target.exposeFunction('requestFromSource', async (id: string, method: string, args: string) => {
    if (method === interruptAt && JSON.parse(args)[0] > 0) {
      settle('interrupted');
      return;
    }
    await source.evaluate(
      ({ id, method, args }) => { void Reflect.get(window, 'migrationSource')(id, method, JSON.parse(args)); },
      { id, method, args },
    );
  });
  await target.evaluate(() => {
    const script = document.createElement('script');
    script.textContent = 'window.MigrationChannel = { request: window.requestFromSource, complete: window.finishMigration }; window.migrationReceiver = Migration.receive; void Migration.run();';
    document.head.append(script);
  });
  return result;
}

const session = {
  id: 'lesson-1', sourceType: 'local_audio', localMediaId: 'audio-1', lastPosition: 11,
  createdAt: 100, transcriptLines: [{ start: 5, end: 10, text: 'My saved subtitle.' }],
};

test('guest upgrade retries an interrupted audio transfer and restores the lesson once', async ({ context }) => {
  let source = await openOrigin(context, oldOrigin);
  let target = await openOrigin(context, newOrigin);
  await seed(source, {
    echolearn_guest_mode: true,
    echolearn_session: session,
    echolearn_sessions_list: [{ ...session, lastPosition: 0 }],
    echolearn_vocabulary: [{ id: 'word-1' }],
    echolearn_sentences: [{ id: 'sentence-1' }],
  }, true);
  expect(await connect(source, target, 'mediaChunk')).toBe('interrupted');
  expect(await target.evaluate(() => localStorage.getItem('echolearn_session'))).toBeNull();
  await Promise.all([source.close(), target.close()]);

  source = await openOrigin(context, oldOrigin);
  target = await openOrigin(context, newOrigin);
  expect(await connect(source, target)).toBe('complete');
  expect(await target.evaluate(() => JSON.parse(localStorage.getItem('echolearn_session')!))).toEqual(session);
  const media = await target.evaluate(async () => {
    const open = indexedDB.open('echolearn-local-media-v2');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const request = db.transaction('media').objectStore('media').get('audio-1');
    const blob = await new Promise<Blob>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result.blob);
      request.onerror = () => reject(request.error);
    });
    db.close();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return { size: bytes.length, first: bytes[0], last: bytes[bytes.length - 1] };
  });
  expect(media).toEqual({ size: audioSize, first: 23, last: 67 });
  await Promise.all([source.close(), target.close()]);

  source = await openOrigin(context, oldOrigin);
  target = await openOrigin(context, newOrigin);
  await seed(target, { echolearn_vocabulary: [{ id: 'newer-local-edit' }] });
  expect(await connect(source, target)).toBe('complete');
  expect(await target.evaluate(() => JSON.parse(localStorage.getItem('echolearn_vocabulary')!)))
    .toEqual([{ id: 'newer-local-edit' }]);
});

test('same-account upgrade merges cloud-backed records and respects deletions', async ({ context }) => {
  const source = await openOrigin(context, oldOrigin);
  const target = await openOrigin(context, newOrigin);
  await seedIndexedDbAccount(source, 'same-account');
  await seed(source, {
    echolearn_vocabulary: [{ id: 'old-only' }, { id: 'shared', updatedAt: 100 }, { id: 'deleted', updatedAt: 100 }],
    echolearn_session: session,
    echolearn_sessions_list: [session],
  }, true);
  await seed(target, {
    [authKey]: { uid: 'same-account', token: 'new-session' },
    echolearn_vocabulary: [{ id: 'shared', updatedAt: 200 }, { id: 'new-only' }],
    echolearn_vocabulary_tombstones: { deleted: 100 },
    echolearn_sessions_list: [{ ...session, updatedAt: 200, lastPosition: 0, transcriptLines: [] }],
  });
  expect(await connect(source, target)).toBe('complete');
  const migrated = await target.evaluate(key => ({
    words: JSON.parse(localStorage.getItem('echolearn_vocabulary')!),
    sessions: JSON.parse(localStorage.getItem('echolearn_sessions_list')!),
    current: JSON.parse(localStorage.getItem('echolearn_session')!),
    auth: JSON.parse(localStorage.getItem(key)!),
  }), authKey);
  expect(migrated.words).toEqual([{ id: 'shared', updatedAt: 200 }, { id: 'new-only' }, { id: 'old-only' }]);
  expect(migrated.sessions).toEqual([{ ...session, updatedAt: 200, lastPosition: 0 }]);
  expect(migrated.current).toEqual({ ...session, updatedAt: 200 });
  expect(migrated.auth.token).toBe('new-session');
});

test('upgrade waits when the old and new signed-in accounts differ', async ({ context }) => {
  const source = await openOrigin(context, oldOrigin);
  const target = await openOrigin(context, newOrigin);
  await seedIndexedDbAccount(source, 'old-user');
  await seed(source, { echolearn_vocabulary: [{ id: 'private' }] });
  await seed(target, { [authKey]: { uid: 'new-user' }, echolearn_vocabulary: [{ id: 'keep' }] });
  expect(await connect(source, target)).toBe('account');
  expect(await target.evaluate(() => JSON.parse(localStorage.getItem('echolearn_vocabulary')!)))
    .toEqual([{ id: 'keep' }]);
  expect(await target.evaluate(() => localStorage.getItem('androidStudyOriginMigrationV1'))).toBeNull();
});
