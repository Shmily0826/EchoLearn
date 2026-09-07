import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPaidProviderGuard,
  invokePaidProvider,
  resolvePaidProviderPolicy,
} from '../paid-provider-guard.mjs';
import { runArm } from './budget-ab.mjs';
import { runWindow } from './runner.mjs';

const workerResponse = {
  ok: false,
  status: 504,
  headers: { get: () => null },
  json: async () => ({ error: 'provider_timeout' }),
};

const paidResponse = {
  ok: true,
  status: 200,
  headers: { get: () => null },
  json: async () => ({ lines: [{ text: 'synthetic' }], source: 'supadata' }),
};

test('default policy blocks paid invocation before fetch', async () => {
  const policy = resolvePaidProviderPolicy({});
  const guard = createPaidProviderGuard(policy);
  let fetches = 0;

  await assert.rejects(
    () => invokePaidProvider(guard, async () => { fetches += 1; }),
    (error) => error.code === 'blocked' && /explicit opt-in/.test(error.message),
  );
  assert.equal(fetches, 0);
});

test('explicit opt-in permits only the configured number of paid calls', async () => {
  const policy = resolvePaidProviderPolicy({
    ECHOLEARN_ALLOW_PAID_PROVIDER: '1',
    ECHOLEARN_PAID_MAX_INVOCATIONS: '2',
  });
  const guard = createPaidProviderGuard(policy);
  let fetches = 0;
  const fetchImpl = async () => { fetches += 1; return paidResponse; };

  await invokePaidProvider(guard, fetchImpl);
  await invokePaidProvider(guard, fetchImpl);
  await assert.rejects(
    () => invokePaidProvider(guard, fetchImpl),
    (error) => error.code === 'cap_exceeded' && /2/.test(error.message),
  );
  assert.equal(fetches, 2);
  assert.equal(guard.invocations, 2);
});

test('missing, partial, and ambiguous paid configuration fails closed', () => {
  for (const env of [
    { ECHOLEARN_ALLOW_PAID_PROVIDER: '1' },
    { ECHOLEARN_PAID_MAX_INVOCATIONS: '2' },
    { ECHOLEARN_ALLOW_PAID_PROVIDER: 'true', ECHOLEARN_PAID_MAX_INVOCATIONS: '2' },
    { ECHOLEARN_ALLOW_PAID_PROVIDER: '1', ECHOLEARN_PAID_MAX_INVOCATIONS: '1.5' },
    { ECHOLEARN_ALLOW_PAID_PROVIDER: '1', ECHOLEARN_PAID_MAX_INVOCATIONS: ' 2' },
  ]) {
    assert.throws(() => resolvePaidProviderPolicy(env), { code: 'invalid_configuration' });
  }
});

test('zero cap is an explicit no-paid path', async () => {
  const guard = createPaidProviderGuard(resolvePaidProviderPolicy({
    ECHOLEARN_ALLOW_PAID_PROVIDER: '1',
    ECHOLEARN_PAID_MAX_INVOCATIONS: '0',
  }));
  let fetches = 0;
  await assert.rejects(() => invokePaidProvider(guard, async () => { fetches += 1; }), { code: 'cap_exceeded' });
  assert.equal(fetches, 0);
});

test('baseline runner remains Worker-only by default', async () => {
  let calls = 0;
  const { rows } = await runWindow({
    matrix: [{ videoId: 'ZbZSe6N_BXs' }],
    fetchImpl: async () => { calls += 1; return workerResponse; },
    cacheVerify: false,
    pauseMs: 0,
    sleepImpl: async () => {},
    paidProviderPolicy: { enabled: false, maxInvocations: 0 },
  });
  assert.equal(calls, 1);
  assert.deepEqual(rows.map((row) => row.layer), ['L1-worker']);
});

test('baseline runner propagates cap exhaustion and makes no next paid fetch', async () => {
  const calls = [];
  await assert.rejects(
    () => runWindow({
      matrix: [{ videoId: 'ZbZSe6N_BXs' }, { videoId: 'JGwWNGJdvx8' }],
      fetchImpl: async (url) => {
        calls.push(String(url));
        return String(url).includes('echo-learn.uk') ? paidResponse : workerResponse;
      },
      cacheVerify: false,
      pauseMs: 0,
      sleepImpl: async () => {},
      paidProviderPolicy: { enabled: true, maxInvocations: 1 },
    }),
    (error) => error.code === 'cap_exceeded' && /cap exceeded/.test(error.message),
  );
  assert.equal(calls.length, 3);
  assert.equal(calls.filter((url) => url.includes('echo-learn.uk')).length, 1);
});

test('budget runner also propagates cap exhaustion before another paid fetch', async () => {
  const calls = [];
  await assert.rejects(
    () => runArm(3000, {
      matrix: [{ videoId: 'ZbZSe6N_BXs' }, { videoId: 'JGwWNGJdvx8' }],
      fetchImpl: async (url) => {
        calls.push(String(url));
        return String(url).includes('appBase.test') ? paidResponse : workerResponse;
      },
      pauseMs: 0,
      sleepImpl: async () => {},
      workerBase: 'https://workerBase.test',
      appBase: 'https://appBase.test',
      paidProviderPolicy: { enabled: true, maxInvocations: 1 },
    }),
    (error) => error.code === 'cap_exceeded' && /cap exceeded/.test(error.message),
  );
  assert.equal(calls.length, 3);
  assert.equal(calls.filter((url) => url.includes('appBase.test')).length, 1);
});
