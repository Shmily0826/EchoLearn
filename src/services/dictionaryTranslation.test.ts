import { afterEach, describe, expect, it, vi } from 'vitest';
import { translateDictionaryDefinition } from '../../api/_shared/dictionaryTranslation';
import { translateWithGoogle } from '../../api/_shared/translate';

function response(payload: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => payload } as Response;
}

describe('Google GTX observability and dictionary degradation', () => {
  afterEach(() => vi.restoreAllMocks());

  it('logs a successful translation without user content', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      response([[['translated']]]),
    );
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const sentinel = 'SENTINEL_USER_CONTENT';

    await expect(translateWithGoogle(sentinel, 'en', 'zh-CN', { operation: 'translate' }))
      .resolves.toBe('translated');

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(info).toHaveBeenCalledWith(expect.stringContaining('"outcome":"success"'));
    expect(info.mock.calls.flat().join(' ')).not.toContain(sentinel);
  });

  it('logs non-OK status and preserves rejection', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(null, false, 503));
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});

    await expect(translateWithGoogle('text', 'en', 'zh-CN', { operation: 'translate' }))
      .rejects.toThrow('Google translate HTTP 503');
    expect(info).toHaveBeenCalledWith(expect.stringContaining('"outcome":"http-error"'));
    expect(info).toHaveBeenCalledWith(expect.stringContaining('"statusClass":"5xx"'));
  });

  it('logs deterministic timeout and exception outcomes', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
      new DOMException('timed out', 'TimeoutError'),
    ).mockRejectedValueOnce(new Error('network down'));

    await expect(translateWithGoogle('text', 'en', 'zh-CN', { operation: 'translate' }))
      .rejects.toThrow();
    await expect(translateWithGoogle('text', 'en', 'zh-CN', { operation: 'translate' }))
      .rejects.toThrow('network down');

    expect(info).toHaveBeenCalledWith(expect.stringContaining('"outcome":"timeout"'));
    expect(info).toHaveBeenCalledWith(expect.stringContaining('"outcome":"exception"'));
  });

  it('marks successful Chinese definitions as translated', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response([[['中文释义']]]));

    await expect(translateDictionaryDefinition('English definition', 'zh-CN'))
      .resolves.toEqual({ text: '中文释义', status: 'translated' });
  });

  it('marks English definition fallback when Chinese translation fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));

    await expect(translateDictionaryDefinition('English definition', 'zh-CN'))
      .resolves.toEqual({ text: 'English definition', status: 'fallback-en' });
  });

  it('leaves English target definitions unchanged without translation', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    await expect(translateDictionaryDefinition('English definition', 'en'))
      .resolves.toEqual({ text: 'English definition' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
