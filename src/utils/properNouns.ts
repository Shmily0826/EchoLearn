/**
 * Tokens that are clicked like words but should not be looked up.
 *
 * The original premise - "the free dictionaries will never define these" - is
 * not true. Every entry in the previous version of this list answered 200 on
 * `/api/dictionary` except `tbh` and `kmh`. What the measurement actually
 * showed is worse than no answer: the provider defines a *different word* than
 * the one the learner clicked.
 *
 *   china  -> "a hard white material made of baked clay"
 *   trump  -> "a card from the suit chosen as most valuable"
 *   musk   -> "a strong-smelling substance used in perfume"
 *   facebook -> "a reference book containing photographs"   (Datamuse)
 *   uber    -> "Very; super."                              (Datamuse)
 *   idk     -> a biography of the rapper IDK               (Datamuse)
 *   btw     -> "Baoding Tianwei Baobian Electric Co., Ltd." (Datamuse)
 *   omg     -> "Initialism of Object Management Group"
 *   rn      -> "registered nurse"          (in a chat transcript: right now)
 *
 * So the rule is not "brand vs word", it is **would the returned gloss name the
 * thing the learner clicked?** Units, initialisms and ordinary abbreviations
 * pass that test and have been removed from this set (`ai`, `app`, `tech`,
 * `gps`, `mph`, `km`, `fyi`, `asap`, `lol`, ...); names, brands, and chat
 * shorthand whose only answer is provider noise stay.
 *
 * `lookupWord` short-circuits on this set, and the popups use it to show
 * "this looks like a name, brand, or abbreviation" instead of an error.
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
  // Chat shorthand whose only available answer is a different word or noise
  'omg', 'btw', 'idk', 'tbh', 'rn', 'smh', 'wtf', 'brb', 'imo', 'yolo',
  // Units that no tier defines at all
  'kmh',
  // Proper names commonly seen in videos
  'trump', 'biden', 'elon', 'musk', 'obama',
]);

/** True if the (cleaned) word is a known brand / abbreviation / proper noun. */
export function isKnownProperNoun(word: string): boolean {
  const cleaned = word.replace(/^[^\w]+|[^\w]+$/g, '').toLowerCase();
  return KNOWN_PROPER_NOUNS.has(cleaned);
}
