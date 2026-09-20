import type { Page } from '@playwright/test';

/**
 * Serve `/api/dictionary` locally and refuse the public fallback providers.
 *
 * Under plain `vite dev` there is no `/api/dictionary` handler, so
 * `dictionaryService` falls through to api.dictionaryapi.dev / api.datamuse.com.
 * The word-lookup popup re-mounts each time data lands, and a spec that clicks
 * inside it then waits forever for the button to become stable — the failure only
 * appeared when the suite was under load, which is how two campaign specs came to
 * hang on "+ Add to Vocab". Specs that touch the lookup popup own this stub so CI
 * measures the app instead of third-party latency.
 */
export async function mockDictionaryApi(page: Page): Promise<void> {
  await page.route('**/api/dictionary*', (route) => {
    const word = new URL(route.request().url()).searchParams.get('word') ?? '';
    const sense = `${word} (E2E stub sense)`;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ipa_uk: '',
        ipa_us: '',
        audio_url: '',
        base_form: word,
        source: 'e2e-stub',
        lemma_provenance: 'provider-confirmed',
        entries: [{
          pos: 'verb',
          definitions: [{
            display_order: 0,
            definitions_json: { definition: sense, source_text: sense },
          }],
        }],
      }),
    });
  });
  await page.route('https://api.dictionaryapi.dev/**', (route) => route.abort());
  await page.route('https://api.datamuse.com/**', (route) => route.abort());
}
