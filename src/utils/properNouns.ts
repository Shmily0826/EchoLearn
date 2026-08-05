/**
 * Known brand names, platforms, abbreviations, and proper nouns that the free
 * dictionaries (Free Dictionary API / Datamuse) will never define.
 *
 * Used by `lookupWord` to short-circuit dictionary API calls for these tokens
 * (saving requests), and by the popups to show a friendlier "no entry" message
 * instead of the generic "Dictionary entry not found".
 *
 * Keep this conservative: only add tokens that are NOT ordinary English words,
 * otherwise legitimate lookups would be blocked.
 */
export const KNOWN_PROPER_NOUNS = new Set<string>([
  // Platforms / brands
  'youtube', 'netflix', 'google', 'facebook', 'instagram', 'twitter',
  'tiktok', 'amazon', 'apple', 'microsoft', 'tesla', 'spotify', 'discord',
  'whatsapp', 'zoom', 'uber', 'airbnb', 'reddit', 'linkedin', 'snapchat',
  'paypal', 'tumblr', 'pinterest', 'twitch',
  // Countries / cities / nationalities
  'china', 'japan', 'london', 'paris', 'tokyo', 'america', 'britain',
  'england', 'australia', 'canada', 'germany', 'france', 'india', 'brazil',
  // Common abbreviations / internet slang (not dictionary words)
  'lol', 'lmao', 'omg', 'btw', 'fyi', 'asap', 'idk', 'tbh', 'rn', 'smh',
  'wtf', 'brb', 'imo', 'smh', 'yolo', 'dm', 'pm',
  // Units / tech acronyms
  'km', 'cm', 'mm', 'kg', 'gb', 'mb', 'kb', 'mph', 'kmh', 'gps', 'wifi',
  'app', 'tech', 'ai',
  // A few proper names commonly seen in videos
  'trump', 'biden', 'elon', 'musk', 'obama',
]);

/** True if the (cleaned) word is a known brand / abbreviation / proper noun. */
export function isKnownProperNoun(word: string): boolean {
  const cleaned = word.replace(/^[^\w]+|[^\w]+$/g, '').toLowerCase();
  return KNOWN_PROPER_NOUNS.has(cleaned);
}
