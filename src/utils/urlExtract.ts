/**
 * Pull the (last) http(s) URL out of a string that may contain surrounding
 * text and/or several URLs — e.g. Bilibili / YouTube share text copied from
 * the app or a chat, or a re-pasted link where the previous URL is still in
 * the box: "https://old.video/x  https://new.video/y".
 *
 *   "【【Easy English】...】 https://b23.tv/nbSyQzx"  → last (only) URL
 *   "Watch this: https://youtu.be/abc123 (great!)"     → last (only) URL
 *
 * When multiple URLs are present we return the LAST one. The common failure
 * mode is the user pasting a new link without first clearing the input box
 * (the old link remains), and they expect the NEW link to win — so the
 * re-loaded video actually changes instead of silently reloading the old one.
 *
 * Returns the cleaned URL (trailing punctuation that is often copied along
 * with the link is stripped), or null if no URL is found.
 */
export function extractUrl(input: string): string | null {
  if (!input) return null;
  const matches = input.match(/https?:\/\/[^\s]+/gi);
  if (!matches || matches.length === 0) return null;
  let url = matches[matches.length - 1];
  // Strip trailing punctuation that tends to get copied along with a link
  // (e.g. a closing parenthesis, full-width bracket, or comma).
  url = url.replace(/[)\]}>。，、】.,;:!?]+$/g, '');
  return url;
}
