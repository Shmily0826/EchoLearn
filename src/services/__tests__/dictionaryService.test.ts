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
    // The candidate loop stops at the first success — "cat" hit, so the
    // original "cats" is never tried.
    expect(callsTo('dictionaryapi.dev')).toBe(1);
  });

  it('returns null when backend and all client-side sources fail', async () => {
    route('all-down');
    const mod = await freshModule();

    expect(await mod.lookupWord('cat')).toBeNull();
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
    localStorage.setItem('echolearn_dictionary_cache_v4', JSON.stringify({ cat: cached }));

    const mod = await freshModule();
    const entry = await mod.lookupWord('cat');
    expect(entry?.definitionEn).toBe('cached definition');
    expect(callsTo('/api/dictionary')).toBe(0);
    expect(callsTo('dictionaryapi.dev')).toBe(0); // client sources NOT re-hit
    expect(callsTo('datamuse.com')).toBe(0);
  });

  it('keeps fallback cache entries isolated by target language', async () => {
    const cached: DictionaryEntry & { lemma?: string } = {
      word: 'cat', phonetic: '', audioUrl: '', partOfSpeech: 'noun',
      definitionEn: 'English definition', example: '', synonyms: [], antonyms: [], provider: 'Datamuse',
    };
    localStorage.setItem(
      'echolearn_dictionary_cache_v4',
      JSON.stringify({ 'cat:zh-cn': cached }),
    );

    const mod = await freshModule();
    route('backend');
    const entry = await mod.lookupWord('cat', 'ja');

    expect(entry?.definitionEn).toBe('a small pet animal');
    expect(callsTo('/api/dictionary')).toBe(1);
  });
});
