/**
 * Pull the first http(s) URL out of a string that may contain surrounding
 * text — e.g. Bilibili / YouTube share text copied from the app or a chat:
 *
 *   "【【Easy English】...】 https://b23.tv/nbSyQzx"
 *   "Watch this: https://youtu.be/abc123 (great!)"
 *
 * Returns the cleaned URL (trailing punctuation that is often copied along
 * with the link is stripped), or null if no URL is found.
 */
export function extractFirstUrl(input: string): string | null {
  if (!input) return null;
  const m = input.match(/https?:\/\/[^\s]+/i);
  if (!m) return null;
  let url = m[0];
  // Strip trailing punctuation that tends to get copied along with a link
  // (e.g. a closing parenthesis, full-width bracket, or comma).
  url = url.replace(/[)\]}>。，、】.,;:!?]+$/g, '');
  return url;
}
