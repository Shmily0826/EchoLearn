import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateStageOutcomes,
  attributionVerdict,
  probeWorkerAttribution,
  runAttributionWindow,
  shapeAttributionRow,
} from './worker-attribution.mjs';
import { BASELINE_MATRIX } from './matrix.mjs';

test('classifyStageMessage coverage via shapeAttributionRow', () => {
  const row = shapeAttributionRow({
    videoId: 'ZbZSe6N_BXs',
    status: 409,
    typedCode: 'asr_required',
    latencyMs: 11200,
    debugMessages: [
      'InnerTube ANDROID: LOGIN_REQUIRED — Sign in to confirm you are not a bot',
      'InnerTube IOS: HTTP 403',
      'InnerTube WEB: OK but no caption tracks',
      'InnerTube TVHTML5_SIMPLY_EMBEDDED_PLAYER: found 2 caption track(s)',
      'Web page: CAPTCHA/bot challenge page detected',
      'Invidious: all instances in cooldown, skipping',
      'Piped (piped.example): HTTP 502',
      'Piped (piped2.example): no subtitles',
      'something unanticipated',
    ],
  });
  const outcomes = row.stages.map((stage) => `${stage.stage}:${stage.outcome}`);
  assert.deepEqual(outcomes, [
    'innertube:login_required',
    'innertube:http_error',
    'innertube:no_tracks',
    'innertube:success',
    'webpage:captcha',
    'invidious:cooldown_skipped',
    'piped:http_error',
    'piped:no_tracks',
    'unknown:other',
  ]);
  assert.equal(row.stages[0].instance, 'ANDROID');
  assert.equal(row.stages[5].instance, undefined);
  assert.equal(row.latencyBucket, '8s_15s');
});

test('shapeAttributionRow rejects malformed videoId and unknown typed codes', () => {
  assert.throws(() => shapeAttributionRow({ videoId: 'nope' }), /11-character/);
  const row = shapeAttributionRow({ videoId: 'ZbZSe6N_BXs', typedCode: 'brand_new_code' });
  assert.equal(row.typedCode, 'untyped');
});

test('aggregateStageOutcomes tallies per stage x outcome', () => {
  const rows = [
    shapeAttributionRow({ videoId: 'ZbZSe6N_BXs', typedCode: 'asr_required', debugMessages: ['InnerTube ANDROID: LOGIN_REQUIRED — x', 'InnerTube WEB: OK but no caption tracks'] }),
    shapeAttributionRow({ videoId: 'JGwWNGJdvx8', typedCode: 'asr_required', debugMessages: ['InnerTube ANDROID: LOGIN_REQUIRED — y'] }),
  ];
  const tally = aggregateStageOutcomes(rows);
  assert.equal(tally['innertube:ANDROID'].login_required, 2);
  assert.equal(tally['innertube:WEB'].no_tracks, 1);
});

test('attributionVerdict reports code distribution and stage table', () => {
  const rows = [
    shapeAttributionRow({ videoId: 'ZbZSe6N_BXs', typedCode: 'provider_timeout', debugMessages: [] }),
    shapeAttributionRow({ videoId: 'JGwWNGJdvx8', typedCode: 'asr_required', debugMessages: [] }),
  ];
  const verdict = attributionVerdict(rows);
  assert.equal(verdict.videos, 2);
  assert.equal(verdict.byCode.provider_timeout, 1);
  assert.equal(verdict.byCode.asr_required, 1);
});

test('probeWorkerAttribution parses debug payload and never sends allowAsr', async () => {
  let capturedUrl = '';
  const fetchImpl = async (url) => {
    capturedUrl = url;
    return {
      ok: false,
      status: 409,
      headers: { get: () => null },
      json: async () => ({ error: 'asr_required', _debug: ['InnerTube ANDROID: LOGIN_REQUIRED — x'] }),
    };
  };
  const row = await probeWorkerAttribution('ZbZSe6N_BXs', { fetchImpl });
  assert.equal(capturedUrl.includes('allowAsr'), false);
  assert.equal(capturedUrl.includes('debug=1'), true);
  assert.equal(row.typedCode, 'asr_required');
  assert.equal(row.stages[0].outcome, 'login_required');

  const networkRow = await probeWorkerAttribution('ZbZSe6N_BXs', {
    fetchImpl: async () => { throw new Error('ECONNREFUSED'); },
  });
  assert.equal(networkRow.typedCode, 'network_error');
  assert.equal(networkRow.stages.length, 0);
});

test('runAttributionWindow is one-shot per video across the frozen matrix', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return {
      ok: false,
      status: 504,
      headers: { get: () => null },
      json: async () => ({ error: 'provider_timeout', _debug: ['Web page: CAPTCHA/bot challenge page detected'] }),
    };
  };
  const { rows, verdict } = await runAttributionWindow({
    matrix: BASELINE_MATRIX.slice(0, 3),
    fetchImpl,
    pauseMs: 0,
    sleepImpl: async () => {},
  });
  assert.equal(calls, 3);
  assert.equal(rows.length, 3);
  assert.equal(verdict.byCode.provider_timeout, 3);
  assert.equal(verdict.stageOutcomes.webpage.captcha, 3);
});
