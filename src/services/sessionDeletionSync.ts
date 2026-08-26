import { pushSessionToCloud } from './firestoreSync';

/** Push session deletions so stale devices receive the tombstone. */
export function syncDeletedSessions(uid: string | undefined): void {
  if (uid) pushSessionToCloud(uid).catch(() => { /* silent */ });
}
