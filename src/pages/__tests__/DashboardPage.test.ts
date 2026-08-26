import { beforeEach, describe, expect, it, vi } from 'vitest';

const { pushSessionToCloud } = vi.hoisted(() => ({
  pushSessionToCloud: vi.fn(),
}));

vi.mock('../../services/firestoreSync', () => ({ pushSessionToCloud }));

import { syncDeletedSessions } from '../../services/sessionDeletionSync';

describe('Dashboard session deletion sync', () => {
  beforeEach(() => {
    pushSessionToCloud.mockReset();
    pushSessionToCloud.mockResolvedValue(undefined);
  });

  it('pushes the session tombstone for an authenticated deletion', () => {
    syncDeletedSessions('user-a');

    expect(pushSessionToCloud).toHaveBeenCalledWith('user-a');
  });

  it('does not attempt a cloud push for Guest deletions', () => {
    syncDeletedSessions(undefined);

    expect(pushSessionToCloud).not.toHaveBeenCalled();
  });
});
