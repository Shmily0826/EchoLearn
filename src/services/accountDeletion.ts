import type { User } from 'firebase/auth';

/**
 * Account deletion, sequenced so that no step can destroy the next thing it
 * depends on.
 *
 * The order is the whole point. Firebase requires a recent sign-in before
 * `deleteUser`, and that error can only be discovered by attempting it — so
 * reauthentication happens first, while nothing has been destroyed. Cloud
 * cleanup follows and must fully succeed before anything local is touched,
 * because once the Auth account is gone the client can no longer authorise
 * itself against its own Firestore documents. The device purge is last: it is
 * the only step that is both idempotent and re-runnable after a failure.
 *
 * The one non-atomic boundary is Firebase itself: if the cloud cleanup succeeds
 * and `deleteUser` then fails, the account is still alive and its local data is
 * fully intact, so the learner can retry and re-sync. Deleting the account
 * before the data would instead leave data that no client can ever reach again.
 */

export type DeletionFailure =
  /** An email/password account must supply its password before anything runs. */
  | 'reauth-required'
  /** The learner cancelled, or the provider rejected, the proof of identity. */
  | 'reauth-cancelled'
  /** Identity could not be re-confirmed, so nothing was deleted. */
  | 'reauth-failed'
  /** Some cloud document could not be removed; nothing local was touched. */
  | 'cloud-cleanup-failed'
  /**
   * Refused outright: this device holds no copy of the cloud learning data, so
   * deleting the cloud documents could be the only copy's end. Export first, or
   * delete from the device that has the data.
   */
  | 'no-local-copy'
  /** The account survived; local data is intact and the operation can be retried. */
  | 'account-delete-failed'
  /** The account is gone but some device-local storage could not be cleared. */
  | 'device-purge-failed';

export class AccountDeletionError extends Error {
  readonly failure: DeletionFailure;
  readonly cause?: unknown;

  constructor(failure: DeletionFailure, cause?: unknown) {
    super(`account-deletion/${failure}`, cause === undefined ? undefined : { cause });
    this.name = 'AccountDeletionError';
    this.failure = failure;
    this.cause = cause;
  }
}

export interface DeletionDependencies {
  user: User;
  reauthenticate: (user: User) => Promise<void>;
  deleteCloudData: (uid: string) => Promise<void>;
  removeAccount: (user: User) => Promise<void>;
  purgeDeviceData: () => Promise<void>;
}

export async function deleteAccountSafely(deps: DeletionDependencies): Promise<void> {
  const { user, reauthenticate, deleteCloudData, removeAccount, purgeDeviceData } = deps;

  try {
    await reauthenticate(user);
  } catch (error) {
    // Pass the sequencer's own signal through untouched: `reauth-required` is a
    // request to the UI for a password, not a failure to be relabelled.
    if (error instanceof AccountDeletionError) throw error;
    throw new AccountDeletionError(codeForReauthFailure(error) ?? 'reauth-failed', error);
  }

  try {
    await deleteCloudData(user.uid);
  } catch (error) {
    if (error instanceof Error && error.message === 'no-local-copy') {
      // Not a retryable cleanup failure: the cloud holds the only copy, so
      // deleting it here could destroy data with nothing to fall back on.
      throw new AccountDeletionError('no-local-copy', error);
    }
    throw new AccountDeletionError('cloud-cleanup-failed', error);
  }

  try {
    await removeAccount(user);
  } catch (error) {
    throw new AccountDeletionError('account-delete-failed', error);
  }

  try {
    await purgeDeviceData();
  } catch (error) {
    throw new AccountDeletionError('device-purge-failed', error);
  }
}

/** Firebase reports a cancelled popup differently from a rejected credential. */
function codeForReauthFailure(error: unknown): DeletionFailure | null {
  const message = error instanceof Error ? error.message : '';
  if (/popup-closed-by-user|cancelled|user-canceled|not-allowed|web-context-closed|redirect-cancelled/i.test(message)) {
    return 'reauth-cancelled';
  }
  return null;
}
