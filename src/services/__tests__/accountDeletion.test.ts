// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { AccountDeletionError, deleteAccountSafely, type DeletionFailure } from '../accountDeletion';

const user = { uid: 'user-a', email: 'a@example.test', emailVerified: true } as never;

type Step = 'reauthenticate' | 'deleteCloudData' | 'removeAccount' | 'purgeDeviceData';

/**
 * The contract under test is the ORDER, not the parts. Every step is a recording
 * spy; an override only decides which step throws, so a failing step can never
 * be recorded as having run when it did not. `calls` is the evidence.
 */
function deps(failing: Partial<Record<Step, Error>> = {}) {
  const calls: Step[] = [];
  const spy = (name: Step) => vi.fn(async () => {
    calls.push(name);
    if (failing[name]) throw failing[name];
  });
  return {
    calls,
    dependencies: {
      user,
      reauthenticate: spy('reauthenticate'),
      deleteCloudData: spy('deleteCloudData'),
      removeAccount: spy('removeAccount'),
      purgeDeviceData: spy('purgeDeviceData'),
    },
  };
}

async function outcome(run: () => Promise<void>): Promise<DeletionFailure | 'no-error'> {
  try {
    await run();
    return 'no-error';
  } catch (error) {
    return error instanceof AccountDeletionError ? error.failure : 'no-error';
  }
}

describe('deleteAccountSafely — failure ordering', () => {
  it('deletes in the only safe order: identity, cloud, account, device', async () => {
    const { calls, dependencies } = deps();
    await expect(deleteAccountSafely(dependencies)).resolves.toBeUndefined();
    expect(calls).toEqual(['reauthenticate', 'deleteCloudData', 'removeAccount', 'purgeDeviceData']);
  });

  it('AD1: a rejected proof of identity destroys nothing at all', async () => {
    const { calls, dependencies } = deps({ reauthenticate: new Error('auth/invalid-credential') });
    await expect(deleteAccountSafely(dependencies)).rejects.toMatchObject({ failure: 'reauth-failed' });
    expect(calls).toEqual(['reauthenticate']);
  });

  it('AD1: a cancelled reauthentication popup destroys nothing and says it was cancelled', async () => {
    const { calls, dependencies } = deps({ reauthenticate: new Error('auth/popup-closed-by-user') });
    await expect(deleteAccountSafely(dependencies)).rejects.toMatchObject({ failure: 'reauth-cancelled' });
    expect(calls).toEqual(['reauthenticate']);
  });

  it('AD1: an email account without a password stops before any deletion (reauth-required)', async () => {
    const { calls, dependencies } = deps({ reauthenticate: new AccountDeletionError('reauth-required') });
    await expect(deleteAccountSafely(dependencies)).rejects.toMatchObject({ failure: 'reauth-required' });
    expect(calls).toEqual(['reauthenticate']);
  });

  it('A3: a failed cloud cleanup is surfaced, not swallowed, and the account survives', async () => {
    const { calls, dependencies } = deps({ deleteCloudData: new Error('permission-denied') });
    await expect(deleteAccountSafely(dependencies)).rejects.toMatchObject({ failure: 'cloud-cleanup-failed' });
    expect(calls).toEqual(['reauthenticate', 'deleteCloudData']);
  });

  it('AD4: the only-copy refusal is its own outcome, not a generic retry message', async () => {
    const { calls, dependencies } = deps({ deleteCloudData: new Error('no-local-copy') });
    await expect(deleteAccountSafely(dependencies)).rejects.toMatchObject({ failure: 'no-local-copy' });
    expect(calls).toEqual(['reauthenticate', 'deleteCloudData']);
  });

  it('AD4: if the account deletion still fails, the device purge has not run, so local data survives', async () => {
    const { calls, dependencies } = deps({ removeAccount: new Error('auth/requires-recent-login') });
    await expect(deleteAccountSafely(dependencies)).rejects.toMatchObject({ failure: 'account-delete-failed' });
    expect(calls).toEqual(['reauthenticate', 'deleteCloudData', 'removeAccount']);
    expect(calls).not.toContain('purgeDeviceData');
  });

  it('AD4: a device purge that fails after the account is gone is reported, not hidden', async () => {
    const { calls, dependencies } = deps({ purgeDeviceData: new Error('IndexedDB blocked') });
    const result = await outcome(() => deleteAccountSafely(dependencies));
    expect(result).toBe('device-purge-failed');
    expect(calls).toEqual(['reauthenticate', 'deleteCloudData', 'removeAccount', 'purgeDeviceData']);
  });
});
