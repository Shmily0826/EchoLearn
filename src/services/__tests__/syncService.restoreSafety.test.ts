/**
 * Cloud-restore safety.
 *
 * `loadFromCloud` ends in `restoreLocalData`, which *removes* every synced local
 * key that the backup does not carry. That makes every rejection path before the
 * restore a data-loss risk if it is ever taken in the wrong order: a rejected
 * backup must leave the device's vocabulary untouched.
 *
 * These tests pin the order (validate → then restore) rather than the wording of
 * the code, so a future refactor can change messages but not the guarantee.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const PAT_KEY = 'echolearn_github_pat';
const GIST_ID_KEY = 'echolearn_gist_id';
const VOCAB_KEY = 'echolearn_vocabulary';
const SENTENCES_KEY = 'echolearn_sentences';
const BACKUP_FILE = 'echolearn-backup.json';

const LOCAL_VOCAB = JSON.stringify([{ id: 'v1', word: 'alpha' }]);
const LOCAL_SENTENCES = JSON.stringify([{ id: 's1', text: 'a local sentence' }]);

function gistResponse(files: Record<string, { content: string }>, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ id: 'gist_1', description: 'x', updated_at: 'now', files }),
    text: async () => JSON.stringify({ files }),
  } as unknown as Response;
}

function seedDevice(): void {
  localStorage.setItem(PAT_KEY, 'ghp_test_token');
  localStorage.setItem(GIST_ID_KEY, 'gist_1');
  localStorage.setItem(VOCAB_KEY, LOCAL_VOCAB);
  localStorage.setItem(SENTENCES_KEY, LOCAL_SENTENCES);
}

function expectLocalDataIntact(): void {
  expect(localStorage.getItem(VOCAB_KEY)).toBe(LOCAL_VOCAB);
  expect(localStorage.getItem(SENTENCES_KEY)).toBe(LOCAL_SENTENCES);
}

import { loadFromCloud, saveToCloud } from '../syncService';

describe('cloud restore never trades local data for a bad backup', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('refuses a backup written by a newer schema and keeps local study data', async () => {
    seedDevice();
    const futurePayload = { version: 2, exportedAt: 1, data: { [VOCAB_KEY]: '[]' } };
    globalThis.fetch = vi.fn().mockResolvedValue(
      gistResponse({ [BACKUP_FILE]: { content: JSON.stringify(futurePayload) } }),
    );

    const result = await loadFromCloud();

    expect(result.ok).toBe(false);
    expect(result.error).toContain('格式不兼容');
    // The guard must run before restoreLocalData, which would have deleted the
    // vocabulary and sentences that this backup does not mention.
    expectLocalDataIntact();
  });

  it('refuses a gist that has no backup file in it and keeps local study data', async () => {
    seedDevice();
    globalThis.fetch = vi.fn().mockResolvedValue(gistResponse({}));

    const result = await loadFromCloud();

    expect(result.ok).toBe(false);
    expect(result.error).toContain(BACKUP_FILE);
    expectLocalDataIntact();
  });

  it('survives an unreadable backup body without touching local study data', async () => {
    seedDevice();
    globalThis.fetch = vi.fn().mockResolvedValue(
      gistResponse({ [BACKUP_FILE]: { content: '{ this is not json' } }),
    );

    const result = await loadFromCloud();

    expect(result.ok).toBe(false);
    expectLocalDataIntact();
  });

  it('forgets a deleted gist but keeps the data the learner already has', async () => {
    seedDevice();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({}),
      text: async () => 'not found',
    } as unknown as Response);

    const result = await loadFromCloud();

    expect(result.ok).toBe(false);
    expect(localStorage.getItem(GIST_ID_KEY)).toBeNull();
    expectLocalDataIntact();

    // With the stale id gone, the next save must create a fresh gist instead of
    // PATCHing an id the user already deleted on GitHub.
    const created = gistResponse({}, 201);
    (created as unknown as { json: () => Promise<unknown> }).json = async () => ({ id: 'gist_2' });
    globalThis.fetch = vi.fn().mockResolvedValue(created);

    const saved = await saveToCloud();

    expect(saved).toMatchObject({ ok: true, gistId: 'gist_2' });
    expect(localStorage.getItem(GIST_ID_KEY)).toBe('gist_2');
  });

  it('restores a compatible backup and reports what was restored', async () => {
    seedDevice();
    const backupVocab = JSON.stringify([{ id: 'v1', word: 'alpha' }, { id: 'v2', word: 'beta' }]);
    globalThis.fetch = vi.fn().mockResolvedValue(
      gistResponse({
        [BACKUP_FILE]: {
          content: JSON.stringify({
            version: 1,
            exportedAt: 1,
            data: { [VOCAB_KEY]: backupVocab, [SENTENCES_KEY]: LOCAL_SENTENCES },
          }),
        },
      }),
    );

    const result = await loadFromCloud();

    expect(result.ok).toBe(true);
    expect(result.itemCounts).toMatchObject({ 词汇: 2, 句子: 1 });
    expect(localStorage.getItem(VOCAB_KEY)).toBe(backupVocab);
  });
});
