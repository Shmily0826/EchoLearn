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

/**
 * Calls the unofficial Google translate endpoint and extracts the translated
 * text. Response shape: [ [ [translatedChunk, originalChunk, ...], ... ], ... ].
 * We join the first element of every inner segment.
 */
export async function translateWithGoogle(
  text: string,
  source: string,
  target: string,
): Promise<string> {
  const url =
    `${GOOGLE_TRANSLATE_URL}` +
    `?client=gtx` +
    `&sl=${encodeURIComponent(source)}` +
    `&tl=${encodeURIComponent(target)}` +
    `&dt=t` +
    `&q=${encodeURIComponent(text)}`;

  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; EchoLearn/1.0)' },
  });
  if (!res.ok) throw new Error(`Google translate HTTP ${res.status}`);

  const data: unknown = await res.json();
  const segments: unknown[] =
    Array.isArray(data) && Array.isArray(data[0]) ? (data[0] as unknown[]) : [];
  const translated = segments
    .map((seg) => (Array.isArray(seg) ? String(seg[0] ?? '') : ''))
    .join('');
  return translated.trim();
}
