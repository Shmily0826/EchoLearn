/**
 * Word-card AI enrichment.
 *
 * The popup is built on top of this module: it must always resolve to either a
 * usable analysis or `null`. Two behaviours are load-bearing for the learner:
 *
 *  1. English study mode never reaches the network (the English view is
 *     deliberately Chinese-free and the token budget is shared with translation).
 *  2. Every failure shape — HTTP error, offline, unusable JSON — degrades to
 *     `null` so the free-dictionary data underneath still renders. A throw here
 *     would take the whole word popup down.
 *
 * The cache is IndexedDB-backed and `indexedDB` is undefined under the node test
 * environment, so these tests exercise the network path rather than the cache.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { aiAuthHeaders, rateLimit } = vi.hoisted(() => ({
  aiAuthHeaders: vi.fn(async () => ({ Authorization: 'Bearer test-token' })),
  rateLimit: vi.fn(() => true),
}));
vi.mock('../apiAuth', () => ({ aiAuthHeaders }));
vi.mock('../aiRateLimit', () => ({ checkAiRateLimit: rateLimit }));

import { getWordAnalysis } from '../wordAnalysisService';

function proxyReply(content: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ choices: [{ message: { content } }] }),
  } as unknown as Response;
}

const ANALYSIS = {
  pos: 'noun',
  meaningZh: '银行（河岸）',
  exampleEn: 'We sat on the bank of the river.',
  exampleZh: '我们坐在河岸上。',
  analysis: '这里 bank 指河岸，而不是金融机构。',
};

describe('word analysis enrichment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rateLimit.mockReturnValue(true);
    aiAuthHeaders.mockResolvedValue({ Authorization: 'Bearer test-token' });
  });

  it('does not call the AI proxy at all in English study mode', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const result = await getWordAnalysis('bank', { videoId: 'vid_1', context: 'on the bank', lang: 'en' });

    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends the context sentence so the meaning is the contextual one', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(proxyReply(JSON.stringify(ANALYSIS)));

    await getWordAnalysis('bank', { videoId: 'vid_1', context: 'We sat on the bank of the river.' });

    const body = JSON.parse(String((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body));
    const prompt = body.messages.map((m: { content: string }) => m.content).join('\n');
    expect(prompt).toContain('bank');
    expect(prompt).toContain('We sat on the bank of the river.');
  });

  it('accepts an analysis wrapped in a markdown code fence', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(proxyReply('```json\n' + JSON.stringify(ANALYSIS) + '\n```'));

    const result = await getWordAnalysis('bank', { videoId: 'vid_2' });

    expect(result).toMatchObject({ meaningZh: ANALYSIS.meaningZh, exampleEn: ANALYSIS.exampleEn });
  });

  it('resolves to null instead of throwing when the proxy returns an error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(proxyReply('', 502));

    await expect(getWordAnalysis('bank', { videoId: 'vid_3' })).resolves.toBeNull();
  });

  it('resolves to null instead of throwing when the device is offline', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(getWordAnalysis('bank', { videoId: 'vid_4' })).resolves.toBeNull();
  });

  it('drops a response that parses but carries no usable field', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(proxyReply('{"pos":"noun"}'));

    await expect(getWordAnalysis('bank', { videoId: 'vid_5' })).resolves.toBeNull();
  });

  it('skips the call when the shared AI budget is exhausted', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;
    rateLimit.mockReturnValue(false);

    const result = await getWordAnalysis('bank', { videoId: 'vid_6' });

    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
