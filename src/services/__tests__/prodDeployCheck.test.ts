import { describe, expect, it } from 'vitest';

// The checker is an executable .mjs module; its entry point is guarded so these
// tests exercise only the exported pure decision logic and HEAD reader.
import {
  compareDeployment,
  readLocalHead,
  // @ts-expect-error The checker is plain JavaScript; this import is test-only.
} from '../../../scripts/prod-deploy-check.mjs';

const SHA = '1434b5a0dc80751c332aa19bd7f57e1d3f4ed01d';

const deployment = (id: number, sha: string, createdAt = '2026-09-18T04:17:33Z') => ({ id, sha, created_at: createdAt });
const success = (id: number) => ({ [id]: [{ state: 'success' }] });

describe('prod-deploy-check deployment comparison', () => {
  it('passes when the expected commit is the newest Production deployment and built', () => {
    const result = compareDeployment({
      deployments: [deployment(1, SHA)],
      expectSha: SHA,
      statusesByDeployment: success(1),
    });
    expect(result.verdict).toBe('PASS');
    expect(result.matched).toBe(true);
    expect(result.latestState).toBe('success');
  });

  it('fails when a different commit is deployed', () => {
    const result = compareDeployment({
      deployments: [deployment(2, 'a'.repeat(40))],
      expectSha: SHA,
      statusesByDeployment: success(2),
    });
    expect(result.verdict).toBe('FAIL');
    expect(result.matched).toBe(false);
    expect(result.reason).toContain('newest Production deployment');
  });

  it('fails when the expected commit is deployed but Vercel has not reported success', () => {
    const result = compareDeployment({
      deployments: [deployment(3, SHA)],
      expectSha: SHA,
      statusesByDeployment: { 3: [{ state: 'pending' }] },
    });
    expect(result.verdict).toBe('FAIL');
    expect(result.matched).toBe(true);
    expect(result.reason).toContain('pending');
  });

  it('fails when no Production deployment is recorded at all', () => {
    const result = compareDeployment({ deployments: [], expectSha: SHA });
    expect(result.verdict).toBe('FAIL');
    expect(result.reason).toContain('no Production deployment');
  });

  it('is UNKNOWN, not PASS, when there is nothing to compare against', () => {
    const result = compareDeployment({ deployments: [deployment(4, SHA)], expectSha: null });
    expect(result.verdict).toBe('UNKNOWN');
    expect(result.reason).toContain('no commit to compare');
  });

  it('matches short and full SHAs in either direction', () => {
    const short = SHA.slice(0, 7);
    expect(
      compareDeployment({ deployments: [deployment(5, SHA)], expectSha: short, statusesByDeployment: success(5) }).verdict,
    ).toBe('PASS');
    expect(
      compareDeployment({ deployments: [deployment(6, short)], expectSha: SHA, statusesByDeployment: success(6) }).verdict,
    ).toBe('PASS');
  });

  it('treats a deployment with no status yet as unknown, never as success', () => {
    const result = compareDeployment({ deployments: [deployment(7, SHA)], expectSha: SHA });
    expect(result.latestState).toBe('unknown');
    expect(result.verdict).toBe('FAIL');
  });
});

describe('prod-deploy-check local HEAD reader', () => {
  it('returns either null (no git) or a full commit SHA — never a partial or thrown error', () => {
    const head = readLocalHead();
    expect(head === null || /^[0-9a-f]{40}$/.test(head)).toBe(true);
  });
});
