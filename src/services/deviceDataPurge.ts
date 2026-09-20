import { clearSyncMetadata } from './firestoreSync';
import { clearPat } from './syncService';
import { deleteAllLocalAudioMedia } from './localAudio';
import { clearAllLocalData } from '../utils/storage';

/**
 * Remove everything this device holds for the account: localStorage study data,
 * sync markers, the GitHub backup credential and its gist id, and every
 * persisted Local Audio Blob.
 *
 * This is the deletion contract the settings copy and README promise. The
 * narrower `clearAllLocalData()` stays what it was — the account boundary at
 * ordinary logout — because that path must keep working without touching a
 * learner's audio files or backup credential.
 *
 * Failures propagate rather than being swallowed: the caller reports a partial
 * purge instead of claiming the device is clean.
 */
export async function purgeDeviceData(): Promise<void> {
  clearAllLocalData();
  clearSyncMetadata();
  clearPat();
  await deleteAllLocalAudioMedia();
}
