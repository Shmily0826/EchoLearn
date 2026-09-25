// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deleteAllLocalAudioMedia,
  deleteLocalAudioMedia,
  getLocalAudioUrl,
  registerLocalAudio,
} from '../localAudio';

function stubMediaApis(abortDelete = false) {
  let nextUrl = 0;
  const createObjectURL = vi.fn(() => `blob:local-${++nextUrl}`);
  const revokeObjectURL = vi.fn();
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL } as unknown as typeof URL);

  const db = {
    close: vi.fn(),
    transaction: vi.fn(() => {
      const transaction: Record<string, unknown> = {};
      transaction.objectStore = () => ({
        delete: () => {
          const request: Record<string, unknown> = {};
          queueMicrotask(() => {
            (request.onsuccess as (() => void) | undefined)?.();
            const terminalEvent = abortDelete ? 'onabort' : 'oncomplete';
            (transaction[terminalEvent] as (() => void) | undefined)?.();
          });
          return request;
        },
      });
      return transaction;
    }),
  };
  const indexedDB = {
    open: () => {
      const request: Record<string, unknown> = { result: db };
      queueMicrotask(() => (request.onsuccess as (() => void) | undefined)?.());
      return request;
    },
    deleteDatabase: () => {
      const request: Record<string, unknown> = {};
      queueMicrotask(() => (request.onsuccess as (() => void) | undefined)?.());
      return request;
    },
  };
  vi.stubGlobal('indexedDB', indexedDB as unknown as IDBFactory);
  return { revokeObjectURL };
}

afterEach(async () => {
  await deleteAllLocalAudioMedia();
  vi.unstubAllGlobals();
});

describe('local audio object URLs', () => {
  it('releases a session URL when its stored audio is deleted', async () => {
    const { revokeObjectURL } = stubMediaApis();
    const url = registerLocalAudio('session-audio', new Blob(['audio']));

    await deleteLocalAudioMedia('session-audio');

    expect(revokeObjectURL).toHaveBeenCalledWith(url);
    expect(getLocalAudioUrl('session-audio')).toBeNull();
  });

  it('retains the URL when the delete transaction aborts after request success', async () => {
    const { revokeObjectURL } = stubMediaApis(true);
    const url = registerLocalAudio('session-audio', new Blob(['audio']));

    await expect(deleteLocalAudioMedia('session-audio')).rejects.toThrow();

    expect(revokeObjectURL).not.toHaveBeenCalled();
    expect(getLocalAudioUrl('session-audio')).toBe(url);
  });

  it('releases every URL after all local audio storage is deleted', async () => {
    const { revokeObjectURL } = stubMediaApis();
    const urls = [
      registerLocalAudio('one', new Blob(['one'])),
      registerLocalAudio('two', new Blob(['two'])),
    ];

    await deleteAllLocalAudioMedia();

    expect(revokeObjectURL.mock.calls.map(([url]) => url)).toEqual(urls);
    expect(getLocalAudioUrl('one')).toBeNull();
    expect(getLocalAudioUrl('two')).toBeNull();
  });
});
