import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../../../api/dictionary';

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('MW_LEARNERS_KEY', '');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('dictionary handler — Datamuse semantic payload', () => {
  it('preserves normalized English source_text beside the legacy definition', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify([{
      word: 'cat',
      defs: ['n\ta small pet animal'],
      tags: ['ipa_pron:kæt'],
    }])));

    const response = await handler(new Request('https://echo.test/api/dictionary?word=cat&target=en'));
    const body = await response.json() as {
      base_form: string;
      lemma_provenance: string;
      source: string;
      entries: Array<{ definitions: Array<{ definitions_json: { definition: string; source_text?: string } }> }>;
    };

    expect(response.status).toBe(200);
    expect(body.source).toBe('datamuse');
    expect(body.base_form).toBe('cat');
    expect(body.lemma_provenance).toBe('candidate');
    expect(body.entries[0].definitions[0].definitions_json).toMatchObject({
      definition: 'a small pet animal',
      source_text: 'a small pet animal',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('marks an MW headword as provider-confirmed only when the response supports it', async () => {
    vi.stubEnv('MW_LEARNERS_KEY', 'test-key');
    fetchMock.mockResolvedValue(new Response(JSON.stringify([{
      meta: { stems: ['running'] },
      hwi: { hw: 'run' },
      fl: 'verb',
      shortdef: ['to move quickly'],
    }])));

    const response = await handler(new Request('https://echo.test/api/dictionary?word=running&target=en'));
    const body = await response.json() as { base_form: string; lemma_provenance: string; source: string };

    expect(response.status).toBe(200);
    expect(body.source).toBe('merriam-webster');
    expect(body.base_form).toBe('run');
    expect(body.lemma_provenance).toBe('provider-confirmed');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
