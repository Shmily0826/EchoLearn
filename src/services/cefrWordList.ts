/**
 * CEFR-level word classification for EchoLearn.
 *
 * Words are grouped by approximate CEFR level based on frequency and complexity.
 * This is a simplified local heuristic — a real LLM-based backend would be more accurate.
 *
 * Levels:
 *   A1 – Absolute beginner (most common function words, numbers, greetings)
 *   A2 – Elementary (common everyday words, basic verbs, adjectives)
 *   B1 – Intermediate (less common words, some abstract concepts)
 *   B2 – Upper intermediate (academic, professional, nuanced vocabulary)
 *   C1 – Advanced (sophisticated, formal, literary vocabulary)
 *   C2 – Mastery (rare, archaic, highly specialised vocabulary)
 */

export type CEFRLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

export const CEFR_LEVELS: CEFRLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

// ── A1 words (absolute beginner, ~200 most common) ─────────

const A1_WORDS = new Set([
  'able', 'about', 'after', 'again', 'all', 'also', 'always', 'and', 'animal',
  'answer', 'any', 'apple', 'are', 'around', 'ask', 'at', 'away', 'baby', 'back',
  'bad', 'bag', 'ball', 'band', 'bank', 'base', 'be', 'because', 'bed', 'been',
  'before', 'begin', 'best', 'better', 'big', 'bird', 'black', 'blue', 'boat',
  'body', 'book', 'both', 'box', 'boy', 'bread', 'bring', 'brother', 'brown',
  'build', 'bus', 'but', 'buy', 'by', 'call', 'came', 'can', 'car', 'carry',
  'cat', 'change', 'child', 'children', 'city', 'class', 'clean', 'close',
  'clothes', 'cold', 'color', 'come', 'cook', 'could', 'country', 'course',
  'cut', 'dad', 'dance', 'day', 'desk', 'did', 'dinner', 'do', 'doctor', 'dog',
  'door', 'down', 'draw', 'drink', 'drive', 'each', 'ear', 'early', 'eat',
  'egg', 'eight', 'end', 'evening', 'every', 'eye', 'face', 'family', 'far',
  'fast', 'father', 'feel', 'few', 'find', 'finish', 'fire', 'first', 'fish',
  'five', 'floor', 'flower', 'fly', 'food', 'foot', 'for', 'four', 'friend',
  'from', 'front', 'full', 'fun', 'game', 'garden', 'get', 'girl', 'give',
  'glass', 'go', 'good', 'got', 'great', 'green', 'group', 'grow', 'had',
  'hair', 'half', 'hand', 'happy', 'has', 'have', 'he', 'head', 'hear', 'help',
  'her', 'here', 'high', 'him', 'his', 'home', 'hope', 'horse', 'hot', 'hour',
  'house', 'how', 'hundred', 'i', 'ice', 'if', 'in', 'into', 'is', 'it',
  'its', 'job', 'just', 'keep', 'kind', 'kitchen', 'know', 'land', 'large',
  'last', 'late', 'learn', 'leave', 'left', 'leg', 'lesson', 'let', 'letter',
  'life', 'light', 'like', 'line', 'lion', 'list', 'listen', 'little', 'live',
  'long', 'look', 'love', 'lunch', 'made', 'make', 'man', 'many', 'map',
  'may', 'me', 'meet', 'milk', 'minute', 'miss', 'money', 'month', 'more',
  'morning', 'most', 'mother', 'move', 'much', 'music', 'must', 'my', 'name',
  'near', 'need', 'never', 'new', 'next', 'night', 'nine', 'no', 'not',
  'nothing', 'now', 'number', 'of', 'off', 'often', 'old', 'on', 'one', 'only',
  'open', 'or', 'orange', 'other', 'our', 'out', 'over', 'own', 'page',
  'paper', 'parent', 'park', 'part', 'party', 'people', 'person', 'phone',
  'picture', 'piece', 'place', 'plan', 'plant', 'play', 'please', 'point',
  'poor', 'pretty', 'problem', 'pull', 'put', 'question', 'quick', 'rain',
  'read', 'red', 'remember', 'right', 'river', 'road', 'room', 'run', 'said',
  'same', 'sat', 'say', 'school', 'sea', 'see', 'sell', 'send', 'seven',
  'she', 'ship', 'shoe', 'shop', 'short', 'should', 'show', 'side', 'sing',
  'sister', 'sit', 'six', 'sleep', 'small', 'snow', 'so', 'some', 'song',
  'soon', 'sorry', 'sound', 'speak', 'stand', 'start', 'stay', 'still', 'stop',
  'story', 'street', 'student', 'study', 'sun', 'sure', 'swim', 'table',
  'take', 'talk', 'teacher', 'tell', 'ten', 'than', 'that', 'the', 'their',
  'them', 'then', 'there', 'these', 'they', 'thing', 'think', 'this', 'three',
  'time', 'to', 'today', 'together', 'tomorrow', 'tonight', 'too', 'top',
  'town', 'travel', 'tree', 'try', 'turn', 'two', 'under', 'understand',
  'up', 'us', 'use', 'very', 'visit', 'wait', 'walk', 'want', 'warm', 'wash',
  'watch', 'water', 'way', 'we', 'wear', 'weather', 'week', 'well', 'what',
  'when', 'where', 'which', 'white', 'who', 'why', 'will', 'wind', 'window',
  'with', 'without', 'woman', 'word', 'work', 'world', 'would', 'write', 'year',
  'yes', 'you', 'young', 'your',
]);

// ── A2 words (elementary, common everyday) ─────────────────

const A2_WORDS = new Set([
  'able', 'abroad', 'accept', 'accident', 'across', 'actually', 'add', 'address',
  'adult', 'adventure', 'advice', 'afraid', 'age', 'ago', 'agree', 'airport',
  'alive', 'allow', 'almost', 'alone', 'along', 'already', 'although', 'among',
  'amount', 'angry', 'another', 'anyone', 'anything', 'anyway', 'appear',
  'area', 'arm', 'army', 'arrive', 'art', 'article', 'asleep', 'attack',
  'attention', 'aunt', 'autumn', 'available', 'average', 'awake', 'award',
  'awful', 'backpack', 'bake', 'balcony', 'bath', 'beach', 'bear', 'beat',
  'beautiful', 'become', 'bedroom', 'beef', 'beer', 'behind', 'believe',
  'below', 'bench', 'beside', 'between', 'bicycle', 'bill', 'billion',
  'biology', 'birth', 'bit', 'bite', 'blank', 'blow', 'board', 'boil',
  'bone', 'boring', 'borrow', 'boss', 'bottom', 'bowl', 'brain', 'brave',
  'break', 'breakfast', 'bridge', 'bright', 'broken', 'brush', 'burn',
  'busy', 'butter', 'button', 'cage', 'cake', 'calm', 'camera', 'camp',
  'campus', 'can', 'cap', 'capital', 'care', 'careful', 'careless', 'carpet',
  'carry', 'case', 'castle', 'catch', 'cause', 'celebrate', 'centre', 'century',
  'certain', 'certainly', 'chair', 'chance', 'channel', 'cheap', 'check',
  'cheese', 'chemistry', 'chess', 'chicken', 'choice', 'choose', 'church',
  'cinema', 'circle', 'clear', 'clever', 'climb', 'clock', 'cloud', 'cloudy',
  'club', 'coach', 'coast', 'coat', 'coffee', 'coin', 'collect', 'college',
  'comfortable', 'common', 'communicate', 'company', 'compare', 'competition',
  'complain', 'complete', 'computer', 'concert', 'condition', 'confident',
  'connect', 'consider', 'continue', 'control', 'conversation', 'corner',
  'correct', 'cost', 'cotton', 'cough', 'count', 'couple', 'cousin', 'cover',
  'crazy', 'cream', 'create', 'credit', 'cross', 'crowd', 'crowded', 'cry',
  'culture', 'cup', 'cupboard', 'customer', 'cycle', 'daily', 'damage',
  'danger', 'dangerous', 'dark', 'data', 'date', 'daughter', 'dead', 'deal',
  'decide', 'decision', 'deep', 'degree', 'deliver', 'dentist', 'department',
  'describe', 'design', 'detail', 'develop', 'dictionary', 'die', 'difference',
  'different', 'difficult', 'digital', 'direction', 'dirty', 'disappear',
  'discover', 'discuss', 'discussion', 'dish', 'divide', 'double', 'doubt',
  'downstairs', 'dream', 'dress', 'dried', 'drop', 'dry', 'during', 'dust',
  'each', 'earth', 'east', 'easily', 'edge', 'education', 'effect', 'effort',
  'eight', 'either', 'elderly', 'electric', 'electricity', 'else', 'email',
  'empty', 'energy', 'engine', 'engineer', 'enjoy', 'enough', 'enter',
  'environment', 'equipment', 'escape', 'especially', 'even', 'event',
  'ever', 'everybody', 'everyone', 'everything', 'everywhere', 'exam',
  'example', 'excellent', 'except', 'exchange', 'excited', 'exciting',
  'excuse', 'exercise', 'experience', 'experiment', 'explain', 'expression',
  'extra', 'factory', 'fail', 'fair', 'fall', 'famous', 'fan', 'farm',
  'farmer', 'fashion', 'fat', 'favourite', 'fear', 'feed', 'female',
  'fetch', 'field', 'fight', 'fill', 'film', 'finally', 'finger', 'fit',
  'fix', 'flat', 'flight', 'float', 'flood', 'floor', 'flour', 'focus',
  'follow', 'forest', 'forget', 'fork', 'form', 'formal', 'forward',
  'free', 'fresh', 'fridge', 'friendly', 'frightened', 'frog', 'fruit',
  'fry', 'fuel', 'funny', 'furniture', 'future', 'garage', 'gate',
  'general', 'generous', 'gentle', 'gentleman', 'gift', 'glad', 'goal',
  'gold', 'golf', 'gone', 'government', 'grass', 'grey', 'ground',
  'guest', 'guide', 'guitar', 'gun', 'gym', 'habit', 'half', 'hall',
  'happen', 'hard', 'hardly', 'hate', 'health', 'healthy', 'heart', 'heat',
  'heavy', 'height', 'hill', 'history', 'hit', 'hobby', 'hold', 'hole',
  'holiday', 'homework', 'honest', 'horrible', 'hospital', 'hotel',
  'however', 'huge', 'human', 'hungry', 'hurry', 'hurt', 'husband',
  'idea', 'ill', 'imagine', 'immediately', 'important', 'impossible',
  'improve', 'include', 'including', 'increase', 'indeed', 'independent',
  'individual', 'industry', 'information', 'injure', 'injury', 'insect',
  'inside', 'instead', 'instrument', 'interested', 'interesting',
  'international', 'internet', 'interview', 'introduce', 'introduction',
  'invite', 'island', 'issue', 'item', 'itself', 'jacket', 'jam', 'jazz',
  'jeans', 'jewellery', 'joke', 'journalist', 'journey', 'joy', 'judge',
  'juice', 'jump', 'jumper', 'just', 'keen', 'key', 'keyboard', 'kick',
  'kid', 'kill', 'kilometre', 'king', 'kiss', 'knee', 'knife', 'knock',
  'knowledge', 'lab', 'label', 'labour', 'lack', 'lady', 'lake', 'lamp',
  'language', 'laptop', 'largely', 'later', 'latest', 'laugh', 'laughter',
  'law', 'lawyer', 'lay', 'lazy', 'lead', 'leader', 'leaf', 'league',
  'least', 'leather', 'lecture', 'lemon', 'lend', 'less', 'level',
  'library', 'lie', 'lift', 'limit', 'link', 'lip', 'liquid', 'literature',
  'litre', 'local', 'lock', 'lonely', 'lose', 'loss', 'lost', 'loud',
  'lovely', 'low', 'luck', 'lucky', 'luggage', 'machine', 'mad', 'magazine',
  'mail', 'main', 'major', 'male', 'manage', 'manager', 'manner', 'mark',
  'market', 'marriage', 'marry', 'mass', 'match', 'material', 'maths',
  'matter', 'maximum', 'maybe', 'meal', 'mean', 'meaning', 'meanwhile',
  'measure', 'meat', 'media', 'medical', 'medicine', 'medium', 'member',
  'memory', 'mention', 'menu', 'mess', 'message', 'metal', 'method',
  'middle', 'might', 'mile', 'military', 'mind', 'mine', 'mirror',
  'mix', 'mixture', 'model', 'modern', 'moment', 'moon', 'moral',
  'moreover', 'mountain', 'mouse', 'mouth', 'murder', 'museum', 'narrow',
  'nation', 'national', 'natural', 'nature', 'navy', 'nearby', 'nearly',
  'necessary', 'neck', 'negative', 'neighbour', 'neither', 'nervous',
  'network', 'news', 'newspaper', 'noise', 'noisy', 'none', 'nor',
  'normal', 'normally', 'north', 'nose', 'note', 'notice', 'novel',
  'nuclear', 'nurse', 'object', 'obvious', 'obviously', 'occasion',
  'offer', 'office', 'officer', 'official', 'oil', 'ok', 'onto',
  'opinion', 'opportunity', 'opposite', 'option', 'ordinary', 'organise',
  'organisation', 'origin', 'original', 'ourselves', 'outside', 'oven',
  'owe', 'owner', 'pack', 'package', 'pain', 'paint', 'painting', 'pair',
  'palace', 'pan', 'pants', 'park', 'particular', 'particularly', 'partner',
  'pass', 'passenger', 'passport', 'past', 'path', 'patient', 'pattern',
  'pay', 'peace', 'peaceful', 'pen', 'pencil', 'penny', 'per', 'percent',
  'perfect', 'perfectly', 'perform', 'performance', 'perhaps', 'period',
  'permanent', 'permission', 'personal', 'pet', 'petrol', 'photograph',
  'photography', 'phrase', 'physical', 'physics', 'piano', 'pick',
  'pilot', 'pin', 'pipe', 'plastic', 'plate', 'platform', 'plenty',
  'plug', 'plus', 'pocket', 'poem', 'poet', 'poetry', 'police',
  'policeman', 'policy', 'polite', 'pollution', 'pool', 'popular',
  'population', 'port', 'position', 'positive', 'possibility', 'possible',
  'possibly', 'post', 'pot', 'potato', 'pour', 'power', 'powerful',
  'practical', 'practice', 'practise', 'praise', 'pray', 'predict',
  'prefer', 'prepare', 'present', 'president', 'press', 'pressure',
  'prevent', 'previous', 'previously', 'price', 'primary', 'prince',
  'princess', 'principle', 'print', 'printer', 'prison', 'prisoner',
  'private', 'prize', 'probably', 'process', 'produce', 'product',
  'production', 'professional', 'professor', 'profit', 'program',
  'programme', 'progress', 'project', 'promise', 'promote', 'pronounce',
  'protect', 'provide', 'pub', 'public', 'publish', 'purpose', 'push',
  'quality', 'quarter', 'queen', 'queue', 'quiet', 'quietly', 'quit',
  'quite', 'quiz', 'race', 'railway', 'raise', 'range', 'rapid',
  'rare', 'rate', 'rather', 'raw', 'reach', 'react', 'reaction', 'real',
  'realise', 'reality', 'really', 'reason', 'reasonable', 'reasonably',
  'receive', 'recent', 'recently', 'recognise', 'recommend', 'record',
  'recording', 'reduce', 'refer', 'refuse', 'regard', 'region',
  'regular', 'regularly', 'regulation', 'reject', 'relate', 'related',
  'relationship', 'relative', 'relatively', 'relax', 'release',
  'relevant', 'religion', 'religious', 'rely', 'remain', 'remark',
  'remember', 'remind', 'remove', 'rent', 'repair', 'repeat', 'replace',
  'reply', 'report', 'represent', 'request', 'require', 'research',
  'reservation', 'resource', 'respect', 'respond', 'response', 'rest',
  'restaurant', 'result', 'retire', 'return', 'reveal', 'review',
  'rice', 'rich', 'ride', 'ring', 'rise', 'risk', 'robot', 'rock',
  'role', 'roll', 'roof', 'round', 'route', 'row', 'royal', 'rub',
  'rubber', 'rubbish', 'rude', 'rule', 'ruler', 'rush', 'safety',
  'sail', 'sailing', 'salad', 'salary', 'sale', 'salt', 'sand',
  'sandwich', 'satellite', 'satisfied', 'satisfy', 'sauce', 'save',
  'scale', 'scared', 'scene', 'schedule', 'scheme', 'science',
  'scientific', 'scientist', 'scissors', 'score', 'screen', 'search',
  'season', 'seat', 'second', 'secondary', 'secret', 'secretary',
  'section', 'sector', 'secure', 'security', 'seed', 'seek', 'seem',
  'sense', 'sensible', 'sentence', 'separate', 'series', 'serious',
  'seriously', 'serve', 'service', 'session', 'set', 'several',
  'severe', 'shade', 'shadow', 'shake', 'shall', 'shame', 'shape',
  'share', 'sharp', 'shave', 'sheet', 'shelf', 'shell', 'shelter',
  'shift', 'shine', 'shiny', 'ship', 'shirt', 'shock', 'shoot',
  'shopping', 'shore', 'shot', 'shout', 'shower', 'shut', 'shy',
  'sick', 'sight', 'sign', 'signal', 'signature', 'significance',
  'significant', 'significantly', 'silence', 'silent', 'silk', 'silly',
  'silver', 'similar', 'similarly', 'simple', 'simply', 'since',
  'single', 'sink', 'sir', 'site', 'situation', 'size', 'skill',
  'skin', 'skirt', 'sky', 'slave', 'sleep', 'slice', 'slightly',
  'slim', 'slow', 'slowly', 'smooth', 'snake', 'snow', 'so', 'soap',
  'soccer', 'social', 'society', 'sock', 'soft', 'software', 'soil',
  'soldier', 'solid', 'solution', 'solve', 'somebody', 'someday',
  'somehow', 'someone', 'something', 'somewhere', 'son', 'sort',
  'soul', 'source', 'south', 'southern', 'space', 'spare', 'speaker',
  'special', 'specific', 'specifically', 'speech', 'speed', 'spell',
  'spend', 'spending', 'spicy', 'spirit', 'spiritual', 'split',
  'spoken', 'spot', 'spread', 'spring', 'square', 'stable', 'stage',
  'stair', 'stamp', 'standard', 'star', 'state', 'statement', 'station',
  'statistic', 'status', 'stay', 'steal', 'steam', 'steel', 'steep',
  'step', 'stick', 'stiff', 'still', 'stock', 'stomach', 'stone',
  'store', 'storm', 'straight', 'strange', 'stranger', 'strategy',
  'stream', 'stress', 'stretch', 'strict', 'strike', 'string', 'strong',
  'strongly', 'structure', 'struggle', 'stuff', 'stupid', 'style',
  'subject', 'succeed', 'success', 'successful', 'successfully', 'sudden',
  'suddenly', 'suffer', 'sugar', 'suggest', 'suggestion', 'suit',
  'suitable', 'sum', 'summary', 'summer', 'sun', 'supermarket', 'supply',
  'support', 'suppose', 'surface', 'surgery', 'surprise', 'surprised',
  'surprising', 'surround', 'surrounding', 'survey', 'survive', 'suspect',
  'sweet', 'swim', 'swimming', 'switch', 'symbol', 'system', 'tail',
  'tale', 'talent', 'talented', 'tape', 'target', 'task', 'taste',
  'tax', 'taxi', 'tea', 'teach', 'teaching', 'team', 'technical',
  'technique', 'technology', 'telephone', 'television', 'temperature',
  'temporary', 'tend', 'term', 'terrible', 'test', 'text', 'thank',
  'theatre', 'theme', 'theory', 'therefore', 'thick', 'thief', 'thin',
  'thinking', 'third', 'thought', 'threat', 'threaten', 'throat',
  'through', 'throughout', 'throw', 'ticket', 'tidy', 'tie', 'tight',
  'till', 'tin', 'tiny', 'tip', 'tired', 'title', 'toe', 'tongue',
  'tonight', 'tool', 'tooth', 'total', 'totally', 'touch', 'tour',
  'tourism', 'tourist', 'towards', 'towel', 'tower', 'track', 'trade',
  'tradition', 'traditional', 'traffic', 'train', 'training', 'transfer',
  'transport', 'trap', 'travel', 'treat', 'treatment', 'trend', 'trick',
  'trip', 'trouble', 'trousers', 'truck', 'true', 'truly', 'trust',
  'truth', 'tube', 'tune', 'tunnel', 'type', 'typical', 'typically',
  'tyre', 'ugly', 'ultimately', 'umbrella', 'unable', 'uncle',
  'underground', 'understanding', 'unemployed', 'unemployment', 'unfair',
  'unfortunately', 'unhappy', 'uniform', 'union', 'unique', 'unit',
  'united', 'universe', 'university', 'unknown', 'unless', 'unlike',
  'unlikely', 'unnecessary', 'unpleasant', 'until', 'unusual', 'upon',
  'upper', 'upset', 'upstairs', 'urban', 'urge', 'urgent', 'useful',
  'user', 'usual', 'usually', 'vacation', 'valley', 'valuable', 'value',
  'variety', 'various', 'vehicle', 'version', 'victim', 'view', 'village',
  'violence', 'violent', 'virtual', 'virus', 'vision', 'voice', 'volume',
  'volunteer', 'vote', 'wage', 'waist', 'wake', 'wall', 'war', 'ward',
  'warn', 'warning', 'waste', 'wave', 'weak', 'weakness', 'wealth',
  'wealthy', 'weapon', 'weight', 'welcome', 'welfare', 'west', 'western',
  'wet', 'wheel', 'whereas', 'wherever', 'whether', 'while', 'whisper',
  'whole', 'wide', 'widely', 'wife', 'wild', 'win', 'wing', 'winner',
  'winter', 'wire', 'wise', 'wish', 'within', 'wonder', 'wonderful',
  'wood', 'wooden', 'wool', 'worry', 'worse', 'worst', 'worth',
  'wrap', 'writer', 'writing', 'written', 'wrong', 'yard', 'yell',
  'yesterday', 'yet', 'zone',
]);

// ── Classification function ─────────────────────────────────

/**
 * Estimate the CEFR level of a word based on local word lists and heuristics.
 *
 * - Found in A1 list → 'A1'
 * - Found in A2 list → 'A2'
 * - Otherwise, use heuristics:
 *   - Short common words → B1
 *   - Longer / abstract / Latin-origin words → B2-C2
 */
export function classifyWordCEFR(word: string): CEFRLevel {
  const lower = word.toLowerCase().replace(/[^a-z]/g, '');

  if (A1_WORDS.has(lower)) return 'A1';
  if (A2_WORDS.has(lower)) return 'A2';

  // Heuristic classification for unknown words
  const len = lower.length;

  // Suffix-based complexity signals
  const advancedSuffixes = ['tion', 'sion', 'ment', 'ness', 'ity', 'ence', 'ance', 'ism', 'ist', 'ous', 'ive', 'ible', 'able'];
  const hasAdvancedSuffix = advancedSuffixes.some((s) => lower.endsWith(s));

  if (len >= 12 || (hasAdvancedSuffix && len >= 9)) return 'C1';
  if (len >= 10 || (hasAdvancedSuffix && len >= 7)) return 'B2';
  if (len >= 7 || hasAdvancedSuffix) return 'B1';

  return 'B1'; // Default to B1 for unknown words
}

/**
 * Filter words from text that fall within the given CEFR level range.
 * Returns unique words with their estimated level and context sentence.
 */
export function extractWordsByLevel(
  text: string,
  minLevel: CEFRLevel,
  maxLevel: CEFRLevel,
): Array<{ word: string; level: CEFRLevel; context: string }> {
  const minIdx = CEFR_LEVELS.indexOf(minLevel);
  const maxIdx = CEFR_LEVELS.indexOf(maxLevel);

  // Extract all words
  const raw = text.match(/\b[a-zA-Z']+\b/g) || [];
  const seen = new Set<string>();
  const sentences = text.split(/(?<=[.!?])\s+/);

  const results: Array<{ word: string; level: CEFRLevel; context: string }> = [];

  for (const w of raw) {
    const lower = w.toLowerCase();
    if (lower.length < 3 || seen.has(lower)) continue;
    seen.add(lower);

    const level = classifyWordCEFR(lower);
    const levelIdx = CEFR_LEVELS.indexOf(level);

    if (levelIdx >= minIdx && levelIdx <= maxIdx) {
      // Find the sentence containing this word
      const ctx = sentences.find((s) => s.toLowerCase().includes(lower)) || text.slice(0, 120);
      const cleanCtx = ctx.trim();
      results.push({
        word: lower,
        level,
        context: cleanCtx.endsWith('.') || cleanCtx.endsWith('!') || cleanCtx.endsWith('?')
          ? cleanCtx
          : cleanCtx + '.',
      });
    }
  }

  // Sort by level (higher levels first — more challenging)
  results.sort((a, b) => CEFR_LEVELS.indexOf(b.level) - CEFR_LEVELS.indexOf(a.level));

  return results;
}
