import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DictionaryEntry } from '../../types';

// dictionaryService keeps a module-level session-miss Set, so each test gets
// a freshly imported module to keep cases independent.
type DictionaryModule = typeof import('../dictionaryService');

async function freshModule(): Promise<DictionaryModule> {
  vi.resetModules();
  return import('../dictionaryService');
}

function mockResponse(body: string, opts: { status?: number } = {}): Response {
  const status = opts.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    json: async () => JSON.parse(body),
  } as unknown as Response;
}

function backendPayload(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    ipa_uk: '/ˈkæt/',
    ipa_us: '/kæt/',
    audio_url: 'https://cdn.example/cat.mp3',
    base_form: 'cat',
    source: 'free-dictionary',
    entries: [
      {
        pos: 'noun',
        definitions: [
          { display_order: 1, definitions_json: { definition: 'a small pet animal' } },
          { display_order: 2, definitions_json: { definition: 'a feline' } },
        ],
      },
      {
        pos: 'verb',
        definitions: [
          { display_order: 1, definitions_json: { definition: 'to raise an issue' } },
        ],
      },
    ],
    ...overrides,
  });
}

function semanticBackendPayload(definition: string, status?: 'translated' | 'fallback-en'): string {
  return JSON.stringify({
    ipa_uk: '/kæt/',
    ipa_us: '/kæt/',
    audio_url: '',
    base_form: 'cat',
    source: 'merriam-webster',
    lemma_provenance: 'provider-confirmed',
    entries: [{
      pos: 'noun',
      definitions: [{
        display_order: 1,
        definitions_json: {
          definition,
          source_text: 'a small pet animal',
          ...(status ? { translation_status: status } : {}),
        },
      }],
    }],
  });
}

function freeDictPayload(): string {
  return JSON.stringify([
    {
      word: 'cat',
      phonetic: '/kæt/',
      phonetics: [{ text: '/kæt/', audio: '' }, { text: '', audio: 'https://audio.example/cat.mp3' }],
      meanings: [
        {
          partOfSpeech: 'noun',
          definitions: [
            {
              definition: 'a small domesticated feline',
              example: 'The cat slept.',
              synonyms: ['feline'],
            },
          ],
        },
      ],
    },
  ]);
}

function datamusePayload(): string {
  return JSON.stringify([{ word: 'cat', defs: ['n\ta small pet that says meow'] }]);
}

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

function callsTo(fragment: string): number {
  return fetchMock.mock.calls.filter(([u]) => String(u).includes(fragment)).length;
}

/** Route a mocked fetch call to the right fixture based on the URL. */
function route(kind: 'backend' | 'freedict' | 'datamuse' | 'all-down'): void {
  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    if (kind === 'all-down') throw new Error('network unreachable');
    if (url.includes('/api/dictionary')) {
      return kind === 'backend' ? mockResponse(backendPayload()) : mockResponse('err', { status: 502 });
    }
    if (url.includes('dictionaryapi.dev')) {
      return kind === 'freedict' ? mockResponse(freeDictPayload()) : mockResponse('[]', { status: 404 });
    }
    if (url.includes('datamuse.com')) {
      return kind === 'datamuse' ? mockResponse(datamusePayload()) : mockResponse('[]', { status: 404 });
    }
    throw new Error(`unexpected url: ${url}`);
  });
}

class MemoryStorage {
  private store = new Map<string, string>();
  get length(): number { return this.store.size; }
  clear(): void { this.store.clear(); }
  getItem(key: string): string | null { return this.store.get(key) ?? null; }
  key(index: number): string | null { return Array.from(this.store.keys())[index] ?? null; }
  removeItem(key: string): void { this.store.delete(key); }
  setItem(key: string, value: string): void { this.store.set(key, String(value)); }
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
  const memory = new MemoryStorage();
  (globalThis as unknown as { sessionStorage: Storage }).sessionStorage =
    memory as unknown as Storage;
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── Input guards ───────────────────────────────────────────────

describe('lookupWord — input guards', () => {
  it('returns null for words that clean down to nothing', async () => {
    const mod = await freshModule();
    expect(await mod.lookupWord('!!!')).toBeNull();
    expect(await mod.lookupWord('')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips all APIs for known proper nouns', async () => {
    const mod = await freshModule();
    expect(await mod.lookupWord('Google')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('strips surrounding punctuation before the backend lookup', async () => {
    route('backend');
    const mod = await freshModule();
    await mod.lookupWord('"Cat!"');
    expect(String(fetchMock.mock.calls[0][0])).toContain('word=cat');
  });
});

// ── Primary: backend /api/dictionary ───────────────────────────

describe('lookupWord — backend primary path', () => {
  it('returns a mapped entry from the backend and caches it per language', async () => {
    route('backend');
    const mod = await freshModule();

    const entry = await mod.lookupWord('cat');

    expect(entry).not.toBeNull();
    expect(entry?.phonetic).toBe('/kæt/'); // prefers US IPA
    expect(entry?.partOfSpeech).toBe('noun');
    expect(entry?.definitionEn).toBe('a small pet animal');
    expect(entry?.definitionsEn).toHaveLength(3); // all senses flattened
    expect(entry?.provider).toBe('Free Dictionary');
    expect(entry?.lemma).toBeUndefined(); // base_form === cleaned word

    // Cached — a repeat lookup issues no new request.
    await mod.lookupWord('cat');
    expect(callsTo('/api/dictionary')).toBe(1);

    // A different target language is a separate cache entry → refetches.
    await mod.lookupWord('cat', 'ja');
    expect(callsTo('/api/dictionary')).toBe(2);
  });

  it('exposes base_form as lemma when it differs from the lookup word', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/dictionary')) {
        return mockResponse(backendPayload({ base_form: 'run' }));
      }
      throw new Error(`unexpected url: ${url}`);
    });
    const mod = await freshModule();

    const entry = await mod.lookupWord('running');
    expect(entry?.lemma).toBe('run');
  });

  it('maps the legacy "unprecedent" alias to "unprecedented" server-side', async () => {
    fetchMock.mockImplementation(async (input) => {
      if (String(input).includes('/api/dictionary')) {
        return mockResponse(backendPayload());
      }
      throw new Error('unexpected url');
    });
    const mod = await freshModule();

    await mod.lookupWord('unprecedent');
    expect(String(fetchMock.mock.calls[0][0])).toContain('word=unprecedented');
  });

  it('falls through to the client-side path when the backend returns non-2xx', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/dictionary')) return mockResponse('boom', { status: 502 });
      if (url.includes('dictionaryapi.dev')) return mockResponse(freeDictPayload());
      if (url.includes('datamuse.com')) return mockResponse('[]', { status: 404 });
      throw new Error(`unexpected url: ${url}`);
    });
    const mod = await freshModule();

    const entry = await mod.lookupWord('cat');
    expect(entry?.provider).toBe('Free Dictionary API');
    expect(entry?.definitionEn).toBe('a small domesticated feline');
    expect(entry?.audioUrl).toBe('https://audio.example/cat.mp3');
  });

  it('builds and round-trips a translated DictionaryReference', async () => {
    fetchMock.mockImplementation(async (input) => {
      if (String(input).includes('/api/dictionary')) {
        return mockResponse(semanticBackendPayload('一只小宠物', 'translated'));
      }
      throw new Error(`unexpected url: ${String(input)}`);
    });
    const mod = await freshModule();

    const entry = await mod.lookupWord('cats');
    expect(entry?.reference).toEqual({
      queriedForm: 'cats',
      lemma: 'cat',
      lemmaProvenance: 'provider-confirmed',
      provider: 'Merriam-Webster',
      sourceLanguage: 'en',
      requestedLanguage: 'zh-CN',
      displayLanguage: 'zh-CN',
      translationStatus: 'translated',
      senses: [{
        pos: 'noun',
        sourceText: 'a small pet animal',
        displayText: '一只小宠物',
        translationStatus: 'translated',
      }],
    });

    fetchMock.mockClear();
    const cached = await mod.lookupWord('cats');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(cached?.reference).toEqual(entry?.reference);
  });

  it('uses explicit source semantics for an English-target backend result', async () => {
    fetchMock.mockImplementation(async (input) => {
      if (String(input).includes('/api/dictionary')) {
        return mockResponse(semanticBackendPayload('a small pet animal'));
      }
      throw new Error(`unexpected url: ${String(input)}`);
    });
    const mod = await freshModule();

    const entry = await mod.lookupWord('cat', 'en');
    expect(entry?.reference).toMatchObject({
      queriedForm: 'cat',
      provider: 'Merriam-Webster',
      sourceLanguage: 'en',
      displayLanguage: 'en',
      translationStatus: 'source',
      senses: [{
        sourceText: 'a small pet animal',
        displayText: 'a small pet animal',
        translationStatus: 'source',
      }],
    });
  });
});

// ── Fallback: Free Dictionary / Datamuse racing ────────────────

describe('lookupWord — client-side fallback path', () => {
  it('uses Datamuse when Free Dictionary has no entry', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/dictionary')) return mockResponse('down', { status: 503 });
      if (url.includes('dictionaryapi.dev')) return mockResponse('[]', { status: 404 });
      if (url.includes('datamuse.com')) return mockResponse(datamusePayload());
      throw new Error(`unexpected url: ${url}`);
    });
    const mod = await freshModule();

    const entry = await mod.lookupWord('cat');
    expect(entry?.provider).toBe('Datamuse');
    expect(entry?.partOfSpeech).toBe('noun'); // parsed from "n\t..."
    expect(entry?.definitionEn).toBe('a small pet that says meow');
    expect(entry?.reference).toMatchObject({
      queriedForm: 'cat',
      lemma: 'cat',
      lemmaProvenance: 'candidate',
      provider: 'Datamuse',
    });
  });

  it('keeps a local lemmatizer candidate non-authoritative in the Datamuse fallback', async () => {
    route('datamuse');
    const mod = await freshModule();

    const entry = await mod.lookupWord('cats');
    expect(entry?.lemma).toBe('cat');
    expect(entry?.reference).toMatchObject({
      queriedForm: 'cats',
      lemma: 'cat',
      lemmaProvenance: 'candidate',
    });
  });

  it('tries the lemmatized candidate first and reports it as lemma', async () => {
    // Backend down; Free Dictionary only knows the lemma ("cat"), not "cats".
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/dictionary')) return mockResponse('down', { status: 503 });
      if (url.includes('dictionaryapi.dev')) {
        return url.endsWith('/cats') ? mockResponse('[]', { status: 404 }) : mockResponse(freeDictPayload());
      }
      if (url.includes('datamuse.com')) return mockResponse('[]', { status: 404 });
      throw new Error(`unexpected url: ${url}`);
    });
    const mod = await freshModule();

    const entry = await mod.lookupWord('cats');
    expect(entry?.word).toBe('cat');
    expect(entry?.lemma).toBe('cat'); // candidate differed from the input word
    expect(entry?.reference).toMatchObject({
      lemma: 'cat',
      lemmaProvenance: 'dictionary-confirmed',
    });
    // The candidate loop stops at the first success — "cat" hit, so the
    // original "cats" is never tried.
    expect(callsTo('dictionaryapi.dev')).toBe(1);
  });

  it('rejects when backend and all client-side sources fail', async () => {
    route('all-down');
    const mod = await freshModule();

    await expect(mod.lookupWord('cat')).rejects.toMatchObject({
      name: 'DictionaryLookupError',
    });
  });

  it('returns null when every source confirms the word is missing', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      return mockResponse('', { status: url.includes('/api/dictionary') || url.includes('dictionaryapi.dev') || url.includes('datamuse.com') ? 404 : 500 });
    });
    const mod = await freshModule();

    await expect(mod.lookupWord('cat')).resolves.toBeNull();
  });

  it('rejects malformed backend entries instead of returning a blank entry', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/dictionary')) return mockResponse(JSON.stringify({ entries: [{}] }));
      return mockResponse('', { status: 404 });
    });
    const mod = await freshModule();

    await expect(mod.lookupWord('cat')).rejects.toMatchObject({ name: 'DictionaryLookupError' });
  });

  it('rejects malformed Free Dictionary entries instead of returning a blank entry', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/dictionary')) return mockResponse('', { status: 404 });
      if (url.includes('dictionaryapi.dev')) return mockResponse('[{}]');
      return mockResponse('', { status: 404 });
    });
    const mod = await freshModule();

    await expect(mod.lookupWord('cat')).rejects.toMatchObject({ name: 'DictionaryLookupError' });
  });

  it('reuses a fallback entry without probing the backend again', async () => {
    const cached: DictionaryEntry & { lemma?: string } = {
      word: 'cat',
      phonetic: '',
      audioUrl: '',
      partOfSpeech: 'noun',
      definitionEn: 'cached definition',
      example: '',
      synonyms: [],
      antonyms: [],
      provider: 'Datamuse',
    };
    localStorage.setItem('echolearn_dictionary_cache_v4', JSON.stringify({ 'cat:zh-cn': cached }));

    const mod = await freshModule();
    route('backend');
    const entry = await mod.lookupWord('cat');
    expect(entry?.definitionEn).toBe('a small pet animal');
    expect(callsTo('/api/dictionary')).toBe(1);
  });

  it('keeps non-English client fallback usable without durable caching', async () => {
    route('freedict');
    const mod = await freshModule();

    const entry = await mod.lookupWord('cat', 'zh-CN');
    expect(entry?.definitionTranslationStatus).toBe('fallback-en');
    expect(entry?.definitionsEn?.[0]?.translationStatus).toBe('fallback-en');
    expect(entry?.reference).toMatchObject({
      queriedForm: 'cat',
      provider: 'Free Dictionary API',
      sourceLanguage: 'en',
      requestedLanguage: 'zh-CN',
      displayLanguage: 'en',
      translationStatus: 'fallback-en',
      senses: [{
        pos: 'noun',
        sourceText: 'a small domesticated feline',
        displayText: 'a small domesticated feline',
        translationStatus: 'fallback-en',
      }],
    });

    const cached = JSON.parse(localStorage.getItem('echolearn_dictionary_cache_v5') || '{}');
    expect(cached['cat:zh-cn']).toBeUndefined();
    expect(localStorage.getItem('echolearn_dictionary_cache_v4')).toBeNull();
  });

  it('retries the backend after a non-English fallback instead of reusing it', async () => {
    let backendCalls = 0;
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/dictionary')) {
        backendCalls += 1;
        return backendCalls === 1
          ? mockResponse('down', { status: 503 })
          : mockResponse(semanticBackendPayload('一只小宠物', 'translated'));
      }
      if (url.includes('dictionaryapi.dev')) return mockResponse(freeDictPayload());
      if (url.includes('datamuse.com')) return mockResponse('[]', { status: 404 });
      throw new Error(`unexpected url: ${url}`);
    });
    const mod = await freshModule();

    const fallback = await mod.lookupWord('cat', 'zh-CN');
    expect(fallback?.reference?.translationStatus).toBe('fallback-en');
    const translated = await mod.lookupWord('cat', 'zh-CN');
    expect(translated?.reference?.translationStatus).toBe('translated');
    expect(backendCalls).toBe(2);
  });

  it('ignores a pre-existing v5 fallback cache entry as a durable hit', async () => {
    localStorage.setItem('echolearn_dictionary_cache_v5', JSON.stringify({
      'cat:zh-cn': {
        word: 'cat', phonetic: '', audioUrl: '', partOfSpeech: 'noun', definitionEn: 'old English',
        definitionTranslationStatus: 'fallback-en',
        definitionsEn: [{ pos: 'noun', definition: 'old English', translationStatus: 'fallback-en' }],
        example: '', synonyms: [], antonyms: [], provider: 'Free Dictionary API',
        reference: { translationStatus: 'fallback-en' },
      },
    }));
    route('backend');
    const mod = await freshModule();

    const entry = await mod.lookupWord('cat', 'zh-CN');
    expect(entry?.definitionEn).toBe('a small pet animal');
    expect(callsTo('/api/dictionary')).toBe(1);
    expect(JSON.parse(localStorage.getItem('echolearn_dictionary_cache_v5') || '{}')['cat:zh-cn'].definitionEn)
      .toBe('a small pet animal');
  });

  it('does not upgrade a legacy provider label without semantic provenance', async () => {
    localStorage.setItem('echolearn_dictionary_cache_v5', JSON.stringify({
      'cat:zh-cn': {
        word: 'cat', lemma: 'cat', phonetic: '', audioUrl: '', partOfSpeech: 'noun',
        definitionEn: 'cached definition', example: '', synonyms: [], antonyms: [],
        provider: 'Merriam-Webster',
      },
    }));
    const mod = await freshModule();

    const entry = await mod.lookupWord('cat');
    expect(entry?.lemma).toBe('cat');
    expect(entry?.reference).toMatchObject({
      lemma: 'cat',
      lemmaProvenance: 'query',
    });
  });

  it('keeps fallback cache entries isolated by target language', async () => {
    const cached: DictionaryEntry & { lemma?: string } = {
      word: 'cat', phonetic: '', audioUrl: '', partOfSpeech: 'noun',
      definitionEn: 'English definition', example: '', synonyms: [], antonyms: [], provider: 'Datamuse',
    };
    localStorage.setItem(
      'echolearn_dictionary_cache_v5',
      JSON.stringify({ 'cat:zh-cn': cached }),
    );

    const mod = await freshModule();
    route('backend');
    const entry = await mod.lookupWord('cat', 'ja');

    expect(entry?.definitionEn).toBe('a small pet animal');
    expect(callsTo('/api/dictionary')).toBe(1);
  });
});
