/**
 * Lightweight English lemmatizer.
 *
 * Combines an irregular-forms lookup table (~250 entries) with rule-based
 * suffix stripping for regular nouns, verbs, and adjectives.
 *
 * Designed for EchoLearn PWA — keeps bundle <5 KB while covering the
 * most common inflected forms an English learner encounters.
 */

// ── Irregular forms: inflected → lemma ─────────────────────────────
// Covers irregular verbs, nouns, adjectives, and a few determiners.

const IRREGULARS: Record<string, string> = {
  // ── be ──
  am: 'be', is: 'be', are: 'be', was: 'be', were: 'be', been: 'be', being: 'be',
  // ── have ──
  has: 'have', had: 'have', having: 'have',
  // ── do ──
  does: 'do', did: 'do', doing: 'do', done: 'do',
  // ── go ──
  goes: 'go', went: 'go', going: 'go', gone: 'go',
  // ── say ──
  says: 'say', said: 'say', saying: 'say',
  // ── see ──
  sees: 'see', saw: 'see', seen: 'see', seeing: 'see',
  // ── come ──
  comes: 'come', came: 'come', coming: 'come',
  // ── get ──
  gets: 'get', got: 'get', gotten: 'get', getting: 'get',
  // ── make ──
  makes: 'make', made: 'make', making: 'make',
  // ── take ──
  takes: 'take', took: 'take', taken: 'take', taking: 'take',
  // ── know ──
  knows: 'know', knew: 'know', known: 'know', knowing: 'know',
  // ── think ──
  thinks: 'think', thought: 'think', thinking: 'think',
  // ── give ──
  gives: 'give', gave: 'give', given: 'give', giving: 'give',
  // ── find ──
  finds: 'find', found: 'find', finding: 'find',
  // ── tell ──
  tells: 'tell', told: 'tell', telling: 'tell',
  // ── put ──
  puts: 'put', putting: 'put',
  // ── mean ──
  means: 'mean', meant: 'mean', meaning: 'mean',
  // ── become ──
  becomes: 'become', became: 'become', becoming: 'become',
  // ── leave ──
  leaves: 'leave', left: 'leave', leaving: 'leave',
  // ── feel ──
  feels: 'feel', felt: 'feel', feeling: 'feel',
  // ── bring ──
  brings: 'bring', brought: 'bring', bringing: 'bring',
  // ── begin ──
  begins: 'begin', began: 'begin', begun: 'begin', beginning: 'begin',
  // ── keep ──
  keeps: 'keep', kept: 'keep', keeping: 'keep',
  // ── hold ──
  holds: 'hold', held: 'hold', holding: 'hold',
  // ── write ──
  writes: 'write', wrote: 'write', written: 'write', writing: 'write',
  // ── stand ──
  stands: 'stand', stood: 'stand', standing: 'stand',
  // ── hear ──
  hears: 'hear', heard: 'hear', hearing: 'hear',
  // ── let ──
  lets: 'let', letting: 'let',
  // ── set ──
  sets: 'set', setting: 'set',
  // ── meet ──
  meets: 'meet', met: 'meet', meeting: 'meet',
  // ── run ──
  runs: 'run', ran: 'run', running: 'run',
  // ── pay ──
  pays: 'pay', paid: 'pay', paying: 'pay',
  // ── send ──
  sends: 'send', sent: 'send', sending: 'send',
  // ── build ──
  builds: 'build', built: 'build', building: 'build',
  // ── fall ──
  falls: 'fall', fell: 'fall', fallen: 'fall', falling: 'fall',
  // ── cut ──
  cuts: 'cut', cutting: 'cut',
  // ── buy ──
  buys: 'buy', bought: 'buy', buying: 'buy',
  // ── speak ──
  speaks: 'speak', spoke: 'speak', spoken: 'speak', speaking: 'speak',
  // ── lie (recline) ──
  lies: 'lie', lay: 'lie', lain: 'lie', lying: 'lie',
  // ── lead ──
  leads: 'lead', led: 'lead', leading: 'lead',
  // ── sit ──
  sits: 'sit', sat: 'sit', sitting: 'sit',
  // ── win ──
  wins: 'win', won: 'win', winning: 'win',
  // ── grow ──
  grows: 'grow', grew: 'grow', grown: 'grow', growing: 'grow',
  // ── lose ──
  loses: 'lose', lost: 'lose', losing: 'lose',
  // ── read ──
  reads: 'read', reading: 'read',
  // ── spend ──
  spends: 'spend', spent: 'spend', spending: 'spend',
  // ── understand ──
  understands: 'understand', understood: 'understand', understanding: 'understand',
  // ── catch ──
  catches: 'catch', caught: 'catch', catching: 'catch',
  // ── teach ──
  teaches: 'teach', taught: 'teach', teaching: 'teach',
  // ── break ──
  breaks: 'break', broke: 'break', broken: 'break', breaking: 'break',
  // ── choose ──
  chooses: 'choose', chose: 'choose', chosen: 'choose', choosing: 'choose',
  // ── drive ──
  drives: 'drive', drove: 'drive', driven: 'drive', driving: 'drive',
  // ── eat ──
  eats: 'eat', ate: 'eat', eaten: 'eat', eating: 'eat',
  // ── drink ──
  drinks: 'drink', drank: 'drink', drunk: 'drink', drinking: 'drink',
  // ── fly ──
  flies: 'fly', flew: 'fly', flown: 'fly', flying: 'fly',
  // ── forget ──
  forgets: 'forget', forgot: 'forget', forgotten: 'forget', forgetting: 'forget',
  // ── sing ──
  sings: 'sing', sang: 'sing', sung: 'sing', singing: 'sing',
  // ── swim ──
  swims: 'swim', swam: 'swim', swum: 'swim', swimming: 'swim',
  // ── throw ──
  throws: 'throw', threw: 'throw', thrown: 'throw', throwing: 'throw',
  // ── draw ──
  draws: 'draw', drew: 'draw', drawn: 'draw', drawing: 'draw',
  // ── wear ──
  wears: 'wear', wore: 'wear', worn: 'wear', wearing: 'wear',
  // ── hide ──
  hides: 'hide', hid: 'hide', hidden: 'hide', hiding: 'hide',
  // ── shake ──
  shakes: 'shake', shook: 'shake', shaken: 'shake', shaking: 'shake',
  // ── rise ──
  rises: 'rise', rose: 'rise', risen: 'rise', rising: 'rise',
  // ── freeze ──
  freezes: 'freeze', froze: 'freeze', frozen: 'freeze', freezing: 'freeze',
  // ── wake ──
  wakes: 'wake', woke: 'wake', woken: 'wake', waking: 'wake',
  // ── ride ──
  rides: 'ride', rode: 'ride', ridden: 'ride', riding: 'ride',
  // ── blow ──
  blows: 'blow', blew: 'blow', blown: 'blow', blowing: 'blow',
  // ── tear ──
  tears: 'tear', tore: 'tear', torn: 'tear', tearing: 'tear',
  // ── steal ──
  steals: 'steal', stole: 'steal', stolen: 'steal', stealing: 'steal',
  // ── ring ──
  rings: 'ring', rang: 'ring', rung: 'ring', ringing: 'ring',
  // ── sink ──
  sinks: 'sink', sank: 'sink', sunk: 'sink', sinking: 'sink',
  // ── stick ──
  sticks: 'stick', stuck: 'stick', sticking: 'stick',
  // ── strike ──
  strikes: 'strike', struck: 'strike', stricken: 'strike', striking: 'strike',
  // ── bite ──
  bites: 'bite', bit: 'bite', bitten: 'bite', biting: 'bite',
  // ── bleed ──
  bleeds: 'bleed', bled: 'bleed', bleeding: 'bleed',
  // ── breed ──
  breeds: 'breed', bred: 'breed', breeding: 'breed',
  // ── deal ──
  deals: 'deal', dealt: 'deal', dealing: 'deal',
  // ── dig ──
  digs: 'dig', dug: 'dig', digging: 'dig',
  // ── feed ──
  feeds: 'feed', fed: 'feed', feeding: 'feed',
  // ── fight ──
  fights: 'fight', fought: 'fight', fighting: 'fight',
  // ── hang ──
  hangs: 'hang', hung: 'hang', hanging: 'hang',
  // ── hurt ──
  hurts: 'hurt', hurting: 'hurt',
  // ── lay ──
  lays: 'lay', laid: 'lay', laying: 'lay',
  // ── learn ──
  learns: 'learn', learnt: 'learn', learning: 'learn',
  // ── lend ──
  lends: 'lend', lent: 'lend', lending: 'lend',
  // ── light ──
  lights: 'light', lit: 'light', lighting: 'light',
  // ── sell ──
  sells: 'sell', sold: 'sell', selling: 'sell',
  // ── shine ──
  shines: 'shine', shone: 'shine', shining: 'shine',
  // ── shoot ──
  shoots: 'shoot', shot: 'shoot', shooting: 'shoot',
  // ── show ──
  shows: 'show', showed: 'show', shown: 'show', showing: 'show',
  // ── shut ──
  shuts: 'shut', shutting: 'shut',
  // ── slide ──
  slides: 'slide', slid: 'slide', sliding: 'slide',
  // ── spin ──
  spins: 'spin', spun: 'spin', spinning: 'spin',
  // ── spit ──
  spits: 'spit', spat: 'spit', spitting: 'spit',
  // ── spread ──
  spreads: 'spread', spreading: 'spread',
  // ── spring ──
  springs: 'spring', sprang: 'spring', sprung: 'spring', springing: 'spring',
  // ── sweep ──
  sweeps: 'sweep', swept: 'sweep', sweeping: 'sweep',
  // ── swing ──
  swings: 'swing', swung: 'swing', swinging: 'swing',
  // ── weave ──
  weaves: 'weave', wove: 'weave', woven: 'weave', weaving: 'weave',
  // ── wind ──
  winds: 'wind', wound: 'wind', winding: 'wind',

  // ── Irregular nouns ──
  men: 'man', women: 'woman', children: 'child',
  feet: 'foot', teeth: 'tooth', mice: 'mouse',
  geese: 'goose', people: 'person', oxen: 'ox',
  lice: 'louse', dice: 'die',
  // -ves plurals
  lives: 'life', knives: 'knife', wives: 'wife',
  leaves: 'leaf', halves: 'half', selves: 'self',
  shelves: 'shelf', calves: 'calf', loaves: 'loaf',
  thieves: 'thief', elves: 'elf', dwarves: 'dwarf',
  wolves: 'wolf', hooves: 'hoof', scarves: 'scarf',

  // ── Irregular adjectives / adverbs ──
  better: 'good', best: 'good',
  worse: 'bad', worst: 'bad',
  more: 'much', most: 'much',
  less: 'little', least: 'little',
  farther: 'far', farthest: 'far',
  further: 'far', furthest: 'far',
  older: 'old', oldest: 'old',
  elder: 'old', eldest: 'old',

  // ── Determiners / quantifiers ──
  these: 'this', those: 'that',
};

// Words that should NEVER be lemmatized (common short words, proper nouns markers, etc.)
const DO_NOT_LEMMATIZE = new Set([
  'is', 'am', 'are',    // keep as-is when they're the query word itself
  'us', 'he', 'me', 'we', 'be', 'do', 'go', 'no', 'so', 'if', 'in', 'on', 'at', 'to', 'of',
  'up', 'as', 'by', 'or', 'an', 'my', 'oh', 'hi',
  'bus', 'plus', 'thus', 'lens', 'news', 'bias', 'gas', 'this',
  'yes', 'his', 'its', 'has', 'was',
]);

// ── Suffix rules ────────────────────────────────────────────────────

/** Consonant-vowel-consonant pattern check for doubling rules. */
function hasCVCEnding(word: string): boolean {
  if (word.length < 3) return false;
  const vowels = 'aeiou';
  const c1 = word[word.length - 3];
  const v = word[word.length - 2];
  const c2 = word[word.length - 1];
  return (
    !vowels.includes(c1) &&
    vowels.includes(v) &&
    !vowels.includes(c2) &&
    c2 !== 'w' && c2 !== 'x' && c2 !== 'y'  // don't double after w, x, y
  );
}

/** Try to strip common noun plural suffixes. Returns null if no rule applies. */
function tryNounPlural(word: string): string | null {
  // -ies → -y (cities → city, babies → baby)
  if (word.endsWith('ies') && word.length > 4) {
    return word.slice(0, -3) + 'y';
  }
  // -ves → -f or -fe (wolves → wolf, knives → knife)
  if (word.endsWith('ves') && word.length > 4) {
    // Try -fe first (more common: knife, wife, life)
    return word.slice(0, -3) + 'f';
  }
  // -ses/-ches/-shes/-xes/-zes → remove -es
  if (
    word.endsWith('ches') || word.endsWith('shes') ||
    word.endsWith('sses') || word.endsWith('xes') ||
    word.endsWith('zes')
  ) {
    return word.slice(0, -2);
  }
  // -oes → -o (potatoes → potato, tomatoes → tomato)
  if (word.endsWith('oes') && word.length > 4) {
    return word.slice(0, -2);
  }
  // -s (but not -ss, -us, -is)
  if (word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('us') && !word.endsWith('is') && word.length > 3) {
    return word.slice(0, -1);
  }
  return null;
}

/** Try to strip common verb suffixes. Returns null if no rule applies. */
function tryVerbForm(word: string): string | null {
  // -ied → -y (carried → carry, studied → study)
  if (word.endsWith('ied') && word.length > 4) {
    return word.slice(0, -3) + 'y';
  }
  // -ied → -ie (died → die, lied → lie) — less common, try if above doesn't make sense
  // We handle this via irregular table for common cases

  // -ing forms
  if (word.endsWith('ing') && word.length > 4) {
    const stem = word.slice(0, -3);
    // running → run (double consonant)
    if (stem.length >= 2 && stem[stem.length - 1] === stem[stem.length - 2] && hasCVCEnding(stem)) {
      return stem.slice(0, -1);
    }
    // making → make (add -e)
    if (stem.length >= 2 && !stem.endsWith('e')) {
      const withE = stem + 'e';
      // Check if the stem + e looks like a real word (heuristic: not ending in double consonant)
      if (!hasCVCEnding(stem)) {
        return stem + 'e';
      }
    }
    // playing → play, going → go (just remove -ing)
    if (stem.length >= 2) {
      return stem;
    }
  }

  // -ed forms (regular past tense)
  if (word.endsWith('ed') && word.length > 3) {
    const stem = word.slice(0, -2);
    // stopped → stop (double consonant)
    if (stem.length >= 2 && stem[stem.length - 1] === stem[stem.length - 2] && hasCVCEnding(stem)) {
      return stem.slice(0, -1);
    }
    // liked → like (stem ends with e-like pattern)
    if (stem.length >= 2) {
      // Try stem + e first if stem doesn't end in a vowel
      const lastChar = stem[stem.length - 1];
      if (!'aeiou'.includes(lastChar) && lastChar !== 'e') {
        return stem + 'e';
      }
      return stem;
    }
  }

  // -es (verb 3rd person singular) — tries → try, goes → go (goes is in irregular table)
  if (word.endsWith('es') && word.length > 3) {
    // -ies → -y
    if (word.endsWith('ies') && word.length > 4) {
      return word.slice(0, -3) + 'y';
    }
    // -ches/-shes/-sses/-xes/-zes → remove -es
    if (
      word.endsWith('ches') || word.endsWith('shes') ||
      word.endsWith('sses') || word.endsWith('xes') ||
      word.endsWith('zes')
    ) {
      return word.slice(0, -2);
    }
    // -oes → -o
    if (word.endsWith('oes') && word.length > 4) {
      return word.slice(0, -2);
    }
  }

  // -s (verb 3rd person singular, simple)
  if (word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('us') && word.length > 3) {
    return word.slice(0, -1);
  }

  return null;
}

/** Try to strip comparative / superlative adjective suffixes. */
function tryAdjectiveForm(word: string): string | null {
  // -iest → -y (happiest → happy)
  if (word.endsWith('iest') && word.length > 5) {
    return word.slice(0, -4) + 'y';
  }
  // -ier → -y (happier → happy)
  if (word.endsWith('ier') && word.length > 4) {
    return word.slice(0, -3) + 'y';
  }
  // -est (biggest → big, nicest → nice)
  if (word.endsWith('est') && word.length > 4) {
    const stem = word.slice(0, -3);
    if (stem.length >= 2 && stem[stem.length - 1] === stem[stem.length - 2] && hasCVCEnding(stem)) {
      return stem.slice(0, -1);
    }
    if (stem.length >= 2) {
      const lastChar = stem[stem.length - 1];
      if (!'aeiou'.includes(lastChar) && lastChar !== 'e') {
        return stem + 'e';
      }
      return stem;
    }
  }
  // -er (bigger → big, nicer → nice)
  if (word.endsWith('er') && word.length > 3) {
    const stem = word.slice(0, -2);
    if (stem.length >= 2 && stem[stem.length - 1] === stem[stem.length - 2] && hasCVCEnding(stem)) {
      return stem.slice(0, -1);
    }
    if (stem.length >= 2) {
      const lastChar = stem[stem.length - 1];
      if (!'aeiou'.includes(lastChar) && lastChar !== 'e') {
        return stem + 'e';
      }
      return stem;
    }
  }
  return null;
}

// ── Main function ───────────────────────────────────────────────────

/**
 * Return the dictionary base form (lemma) of an English word.
 *
 * Strategy:
 * 1. Check irregular forms table (most reliable for common irregulars)
 * 2. Apply rule-based suffix stripping for regular inflections
 * 3. Fall back to the input word itself if no rule applies
 *
 * @param word  The word to lemmatize (will be lowercased internally)
 * @returns     The lemma (base form) of the word
 *
 * @example
 *   lemmatize('running')   // → 'run'
 *   lemmatize('went')      // → 'go'
 *   lemmatize('children')  // → 'child'
 *   lemmatize('better')    // → 'good'
 *   lemmatize('happily')   // → 'happily'  (adverbs not handled — returned as-is)
 */
export function lemmatize(word: string): string {
  // Normalize
  const lower = word.toLowerCase().trim();

  // Skip short words, numbers, and words in the do-not-lemmatize set
  if (lower.length <= 2 || /^\d/.test(lower) || DO_NOT_LEMMATIZE.has(lower)) {
    return lower;
  }

  // 1. Irregular forms (highest priority)
  if (IRREGULARS[lower]) {
    return IRREGULARS[lower];
  }

  // 2. Try rule-based suffix stripping
  // We try all three (noun, verb, adjective) and pick the shortest valid result,
  // since we don't know the POS. Shortest usually = correct lemma.
  const candidates: string[] = [];

  const nounResult = tryNounPlural(lower);
  if (nounResult && nounResult.length >= 3) candidates.push(nounResult);

  const verbResult = tryVerbForm(lower);
  if (verbResult && verbResult.length >= 2) candidates.push(verbResult);

  const adjResult = tryAdjectiveForm(lower);
  if (adjResult && adjResult.length >= 3) candidates.push(adjResult);

  if (candidates.length > 0) {
    // Pick the shortest candidate (most reduced form)
    candidates.sort((a, b) => a.length - b.length);
    const best = candidates[0];
    // Safety: don't return a lemma longer than or equal to the input
    if (best.length < lower.length) {
      return best;
    }
  }

  // 3. No rule applied — return as-is
  return lower;
}

/**
 * Check if two words are the same lemma (base form).
 * Useful for deduplication and highlighting.
 */
export function sameLemma(a: string, b: string): boolean {
  return lemmatize(a) === lemmatize(b);
}
