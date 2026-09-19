export function shouldAutoSyncUser(user: { uid?: string | null; emailVerified?: boolean } | null | undefined): boolean {
  return Boolean(user?.uid && user.emailVerified);
}

/**
 * True when signing out would silently destroy unsynced local study data:
 * an unverified account (cloud sync impossible) that still has local
 * syncable data or a pending sync marker. Such a sign-out must be
 * confirmed by the learner before the destructive boundary runs.
 */
export function shouldWarnOnLogout(
  user: { uid?: string | null; emailVerified?: boolean } | null | undefined,
  hasLocalSyncableData: boolean,
  syncPending: boolean,
): boolean {
  return Boolean(user?.uid && user.emailVerified === false && (hasLocalSyncableData || syncPending));
}
