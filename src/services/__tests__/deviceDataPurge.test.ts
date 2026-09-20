// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: string[] = [];
const indexedDBState = { blocked: false, fail: false };

vi.mock('../localAudio', () => ({
  deleteAllLocalAudioMedia: vi.fn(() => {
    calls.push('indexedDB');
    if (indexedDBState.fail) return Promise.reject(new Error('could not delete the media database'));
    return Promise.resolve();
  }),
}));
vi.mock('../firestoreSync', () => ({ clearSyncMetadata: vi.fn(() => calls.push('syncMetadata')) }));

import { purgeDeviceData } from '../deviceDataPurge';
import { clearAllLocalData } from '../../utils/storage';

describe('purgeDeviceData — the account-deletion cleanup boundary', () => {
  beforeEach(() => {
    calls.length = 0;
    indexedDBState.fail = false;
    localStorage.clear();
    localStorage.setItem('echolearn_vocabulary', JSON.stringify([{ id: 'a' }]));
    localStorage.setItem('echolearn_session', JSON.stringify({ id: 's' }));
    localStorage.setItem('echolearn_github_pat', 'ghp_secret_should_not_survive');
    localStorage.setItem('echolearn_gist_id', 'gist-1');
    localStorage.setItem('echolearn_last_sync', '123');
    localStorage.setItem('echolearn_firebase_last_sync', '123');
    localStorage.setItem('echolearn_lang', 'en');
  });

  it('clears study data, sync markers and the GitHub credential, and drops the audio database', async () => {
    await purgeDeviceData();
    expect(localStorage.getItem('echolearn_vocabulary')).toBeNull();
    expect(localStorage.getItem('echolearn_session')).toBeNull();
    // The GitHub backup credential and its gist metadata are cleared by the real
    // clearPat(); the Firestore sync markers are cleared by clearSyncMetadata,
    // which is the mocked boundary below.
    expect(localStorage.getItem('echolearn_github_pat')).toBeNull();
    expect(localStorage.getItem('echolearn_gist_id')).toBeNull();
    expect(localStorage.getItem('echolearn_last_sync')).toBeNull();
    // Device preference is not learning data and must survive a purge.
    expect(localStorage.getItem('echolearn_lang')).toBe('en');
    // The two mocked boundaries are recorded; the real clearPat() is asserted
    // through localStorage above rather than through a call spy.
    expect(calls).toEqual(['syncMetadata', 'indexedDB']);
  });

  it('rejects when the audio database cannot be deleted instead of reporting a clean device', async () => {
    indexedDBState.fail = true;
    await expect(purgeDeviceData()).rejects.toThrow('could not delete the media database');
  });

  it('leaves ordinary logout semantics alone: clearAllLocalData does not touch IndexedDB or the PAT', () => {
    clearAllLocalData();
    expect(localStorage.getItem('echolearn_vocabulary')).toBeNull();
    expect(localStorage.getItem('echolearn_github_pat')).toBe('ghp_secret_should_not_survive');
    expect(calls).toEqual([]);
  });
});
