/**
 * Shared keyless Google Translate (gtx) helper.
 *
 * Used by both /api/translate and /api/dictionary so the translation logic
 * lives in exactly one place. Kept as a standalone module so edge functions
 * under /api can import it without duplicating the endpoint logic.
 *
 * NOTE: translate.googleapis.com/translate_a/single is an *unofficial* endpoint.
 * It is widely used but is not a supported API and may change or rate-limit.
 */

const GOOGLE_TRANSLATE_URL = 'https://translate.googleapis.com/translate_a/single';

type TranslateOptions = { operation?: string };

function logOutcome(
  operation: string,
  outcome: string,
  status?: number,
): void {
  console.info(JSON.stringify({
    provider: 'google-gtx',
    operation,
    outcome,
    ...(status === undefined ? {} : { status, statusClass: `${Math.floor(status / 100)}xx` }),
  }));
}

/**
 * Calls the unofficial Google translate endpoint and extracts the translated
 * text. Response shape: [ [ [translatedChunk, originalChunk, ...], ... ], ... ].
 * We join the first element of every inner segment.
 */
export async function translateWithGoogle(
  text: string,
  source: string,
  target: string,
  options: TranslateOptions = {},
): Promise<string> {
  const operation = options.operation || 'translate';
  const url =
    `${GOOGLE_TRANSLATE_URL}` +
    `?client=gtx` +
    `&sl=${encodeURIComponent(source)}` +
    `&tl=${encodeURIComponent(target)}` +
    `&dt=t` +
    `&q=${encodeURIComponent(text)}`;

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; EchoLearn/1.0)' },
      // Unofficial endpoint can stall; never let a slow translate block the
      // whole lookup. Callers already fall back to the original English text
      // on rejection, so a timeout just means "show it untranslated".
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) {
      logOutcome(operation, 'http-error', res.status);
      throw new Error(`Google translate HTTP ${res.status}`);
    }

    const data: unknown = await res.json();
    if (!Array.isArray(data) || !Array.isArray(data[0])) {
      logOutcome(operation, 'malformed');
      return '';
    }
    const segments = data[0] as unknown[];
    const translated = segments
      .map((seg) => (Array.isArray(seg) ? String(seg[0] ?? '') : ''))
      .join('')
      .trim();
    if (!translated) {
      logOutcome(operation, 'empty');
      return '';
    }
    logOutcome(operation, 'success');
    return translated;
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      logOutcome(operation, 'timeout');
    } else if (!(error instanceof Error && error.message.startsWith('Google translate HTTP '))) {
      logOutcome(operation, 'exception');
    }
    throw error;
  }
}
