/**
 * CEFR-level word classification for EchoLearn.
 *
 * Words are grouped by approximate CEFR level based on frequency and complexity.
 * This is a simplified local heuristic — a real LLM-based backend would be more accurate,
 * but the local list is the *primary* signal (it feeds the candidate list to the AI and
 * powers the offline fallback), so it is kept fairly complete.
 *
 * Levels:
 *   A1 – Absolute beginner (most common function words, numbers, greetings)
 *   A2 – Elementary (common everyday words, basic verbs, adjectives)
 *   B1 – Intermediate (less common words, some abstract concepts, phrasal verbs)
 *   B2 – Upper intermediate (academic, professional, nuanced vocabulary)
 *   C1 – Advanced (sophisticated, formal, literary vocabulary)
 *   C2 – Mastery (rare, archaic, highly specialised vocabulary)
 */

import { lemmatize } from '../utils/lemmatizer';

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

// ── B1 words (intermediate — less common, some abstract, phrasal verbs) ──

const B1_WORDS = new Set([
  'abandon', 'ability', 'absence', 'academy', 'accomplish', 'accordance', 'account',
  'accurate', 'achieve', 'acquire', 'adapt', 'adequate', 'adjust', 'admire',
  'admit', 'adopt', 'advance', 'advantage', 'adventure', 'advice', 'advise',
  'affair', 'affect', 'afford', 'agency', 'agenda', 'alike', 'alive', 'ancient',
  'annoy', 'anxiety', 'anxious', 'apart', 'apologise', 'apparent', 'appeal',
  'apply', 'appreciate', 'approach', 'appropriate', 'approve', 'argue', 'arise',
  'aspect', 'assess', 'assist', 'assume', 'assure', 'attach', 'attack', 'attract',
  'audience', 'author', 'automatic', 'available', 'avoid', 'aware', 'awful',
  'backbone', 'background', 'balance', 'ban', 'barrier', 'basis', 'behalf',
  'behave', 'belief', 'belong', 'beneath', 'benefit', 'besides', 'beyond',
  'blame', 'boiling', 'boundary', 'branch', 'brand', 'breach', 'brief', 'broad',
  'broken', 'bucket', 'budget', 'bump', 'burden', 'bureau', 'burn', 'cabin',
  'calculate', 'campaign', 'cancel', 'cancer', 'candidate', 'capture', 'carbon',
  'career', 'cargo', 'carrier', 'casual', 'cattle', 'cease', 'celebrity',
  'ceremony', 'challenge', 'chamber', 'chaos', 'characteristic', 'charm',
  'chart', 'chase', 'cheap', 'cheer', 'chief', 'childish', 'chorus', 'clash',
  'classic', 'climate', 'clinic', 'club', 'clue', 'collapse', 'colleague',
  'combat', 'comedy', 'command', 'comment', 'commit', 'commodity', 'community',
  'commute', 'compact', 'compare', 'compete', 'complaint', 'complex', 'compose',
  'comprehensive', 'comprise', 'compute', 'conceal', 'conclude', 'conduct',
  'conference', 'confident', 'confirm', 'confuse', 'conscious', 'consent',
  'consequence', 'consist', 'constant', 'constitute', 'construct', 'consult',
  'consume', 'contact', 'contain', 'contest', 'context', 'contract', 'contrast',
  'contribute', 'convert', 'convince', 'coordinate', 'cope', 'copyright',
  'corporate', 'correspond', 'costly', 'council', 'counsel', 'county', 'crash',
  'creative', 'credit', 'crisis', 'critic', 'crucial', 'crush', 'currency',
  'customer', 'cutoff', 'cycle', 'damage', 'dangerous', 'deadline', 'debate',
  'debt', 'decade', 'decline', 'decorate', 'decrease', 'defeat', 'defend',
  'define', 'definite', 'delegate', 'deliberate', 'deliver', 'demand',
  'democracy', 'demonstrate', 'dense', 'deny', 'depend', 'deprive', 'derive',
  'describe', 'desert', 'desire', 'detect', 'device', 'devote', 'differ',
  'digest', 'dilemma', 'diploma', 'discipline', 'disclose', 'discount',
  'discourage', 'dismiss', 'disorder', 'display', 'dispute', 'distant',
  'distinct', 'distribute', 'disturb', 'diverse', 'dive', 'domain', 'domestic',
  'dominate', 'doubt', 'drama', 'drought', 'duration', 'dynamic', 'eager',
  'earn', 'ease', 'echo', 'economic', 'edition', 'elderly', 'election',
  'element', 'embarrass', 'emerge', 'emotion', 'emphasize', 'employ', 'enable',
  'encounter', 'endure', 'engage', 'enhance', 'enormous', 'ensure', 'entail',
  'enterprise', 'entertain', 'entitle', 'entirely', 'entity', 'episode',
  'equivalent', 'essential', 'establish', 'estate', 'evaluate', 'evident',
  'exaggerate', 'examine', 'exceed', 'exception', 'excess', 'exchange',
  'exclude', 'exhibit', 'expand', 'expense', 'exploit', 'explore', 'export',
  'expose', 'express', 'extend', 'extent', 'external', 'extraordinary',
  'extreme', 'fabric', 'facility', 'factor', 'fade', 'faint', 'faithful',
  'false', 'familiar', 'fancy', 'fare', 'fascinate', 'fatal', 'fault', 'favor',
  'feature', 'fee', 'fellow', 'fence', 'festival', 'fierce', 'figure', 'file',
  'finance', 'firm', 'flame', 'flash', 'flesh', 'forbid', 'force', 'forecast',
  'forge', 'former', 'fortunate', 'forum', 'foundation', 'fragile', 'framework',
  'franchise', 'fraud', 'friction', 'freeze', 'frequent', 'fulfill', 'fund',
  'fundamental', 'funeral', 'furnish', 'further', 'gadget', 'gallery', 'gas',
  'gather', 'gender', 'genuine', 'gesture', 'giant', 'glance', 'glimpse',
  'global', 'gloomy', 'goal', 'goods', 'govern', 'grab', 'graduate', 'grand',
  'grant', 'grateful', 'gravity', 'grease', 'greet', 'grim', 'grip', 'gross',
  'guarantee', 'guard', 'guess', 'guidance', 'guideline', 'guilty', 'handle',
  'harvest', 'heading', 'heap', 'hedge', 'heroic', 'highlight', 'hike', 'hint',
  'hire', 'historic', 'hollow', 'horror', 'host', 'household', 'housing',
  'hum', 'humble', 'hunt', 'ideal', 'identify', 'idle', 'ignore', 'illegal',
  'illusion', 'image', 'immigrant', 'impact', 'imply', 'import', 'impose',
  'incentive', 'incident', 'income', 'index', 'infer', 'inferior', 'influence',
  'inhabit', 'inherit', 'initial', 'inject', 'injure', 'inner', 'innocent',
  'inquire', 'inspect', 'install', 'instance', 'instinct', 'instruct', 'insult',
  'intellectual', 'intend', 'intense', 'interact', 'interior', 'internal',
  'interpret', 'interrupt', 'interval', 'intimate', 'invent', 'invest',
  'involve', 'isolate', 'jealous', 'joint', 'journal', 'judge', 'junior',
  'jury', 'justify', 'keen', 'kneel', 'knit', 'label', 'labor', 'lance',
  'landscape', 'lane', 'launch', 'layer', 'lean', 'leap', 'lease', 'lecture',
  'legal', 'legend', 'leisure', 'length', 'liberal', 'license', 'likely',
  'link', 'liquid', 'living', 'loan', 'locate', 'lodge', 'logic', 'loose',
  'loyal', 'luxury', 'magnetic', 'magnificent', 'maintain', 'majority', 'manner',
  'margin', 'marine', 'mask', 'massive', 'mature', 'maximum', 'meaningful',
  'means', 'medium', 'melt', 'mention', 'minimal', 'minimum', 'minister',
  'minor', 'minority', 'miracle', 'mislead', 'mission', 'mistake', 'mixture',
  'moderate', 'modest', 'modify', 'moist', 'monitor', 'monthly', 'motive',
  'mount', 'multiple', 'muscle', 'mutual', 'myth', 'narrow', 'native',
  'nearby', 'neglect', 'negotiate', 'neutral', 'nevertheless', 'noble', 'nod',
  'notice', 'notion', 'numb', 'oblige', 'observe', 'obstacle', 'obtain',
  'obvious', 'occupy', 'occur', 'offense', 'offset', 'online', 'opaque',
  'operate', 'oppose', 'optimal', 'optional', 'orbit', 'order', 'ordinary',
  'organize', 'overcome', 'overlook', 'owe', 'oxygen', 'painful', 'panel',
  'panic', 'parliament', 'partial', 'participate', 'particular', 'passage',
  'passion', 'passive', 'patch', 'patient', 'pause', 'payment', 'penalty',
  'pension', 'perceive', 'perform', 'permit', 'perspective', 'phase',
  'phenomenon', 'philosophy', 'photocopy', 'phrase', 'physical', 'pitch',
  'plain', 'planet', 'plunge', 'poison', 'pole', 'polish', 'pollute', 'portion',
  'pose', 'positive', 'possess', 'poverty', 'precise', 'predict', 'prejudice',
  'preserve', 'pretend', 'previous', 'primary', 'prime', 'primitive',
  'principal', 'priority', 'prison', 'probable', 'procedure', 'proceed',
  'process', 'profession', 'profile', 'profit', 'program', 'project', 'promote',
  'prompt', 'proof', 'proper', 'propose', 'prospect', 'provoke', 'publish',
  'pulse', 'pump', 'punctual', 'punish', 'purchase', 'pure', 'pursue', 'puzzle',
  'qualify', 'quality', 'quantity', 'quote', 'radical', 'rail', 'rank', 'rapid',
  'ratio', 'react', 'ready', 'realize', 'recall', 'recover', 'reduce', 'refer',
  'reflect', 'reform', 'refuse', 'regard', 'region', 'register', 'regret',
  'regular', 'reject', 'relate', 'relax', 'release', 'relevant', 'relief',
  'rely', 'remain', 'remark', 'remedy', 'render', 'replace', 'request',
  'require', 'rescue', 'reserve', 'resolve', 'respect', 'respond', 'restore',
  'restrict', 'resume', 'retail', 'retain', 'retire', 'retreat', 'reveal',
  'reverse', 'revise', 'reward', 'rhythm', 'rigid', 'rival', 'roar', 'rob',
  'rough', 'route', 'royal', 'ruin', 'rule', 'rural', 'sacred', 'sacrifice',
  'sail', 'sake', 'salary', 'sample', 'sanction', 'satisfy', 'scan', 'scarce',
  'scatter', 'scholar', 'scope', 'score', 'scratch', 'secure', 'seek', 'seize',
  'select', 'senior', 'sense', 'sequence', 'series', 'serve', 'settle',
  'severe', 'shallow', 'shelf', 'shift', 'shine', 'shrink', 'signal', 'silent',
  'similar', 'since', 'sing', 'sink', 'site', 'situation', 'skill', 'slap',
  'slight', 'slip', 'slope', 'slot', 'smart', 'smell', 'smile', 'smoke',
  'soak', 'soar', 'social', 'society', 'sole', 'solve', 'sophisticated',
  'spare', 'sphere', 'spill', 'spin', 'spirit', 'splash', 'spoke', 'sport',
  'spot', 'spray', 'squeeze', 'stable', 'stack', 'staff', 'stain', 'stake',
  'stare', 'steady', 'steal', 'sting', 'stir', 'stock', 'stomach', 'strain',
  'strange', 'stretch', 'strict', 'string', 'strip', 'struggle', 'stupid',
  'submit', 'substance', 'subtract', 'succeed', 'such', 'sudden', 'suffer',
  'suggest', 'suit', 'sum', 'supply', 'support', 'suppose', 'surface', 'surge',
  'surround', 'survive', 'suspend', 'sustain', 'swallow', 'sweat', 'sweep',
  'swell', 'swing', 'sympathetic', 'tackle', 'tame', 'tank', 'tap', 'target',
  'taste', 'tend', 'tennis', 'term', 'terrible', 'text', 'thank', 'theme',
  'theory', 'thick', 'thin', 'thought', 'threat', 'thrill', 'throat',
  'throughout', 'throw', 'thus', 'tide', 'tight', 'toast', 'tobacco', 'tolerate',
  'tone', 'toss', 'tour', 'toward', 'towel', 'trace', 'track', 'trade',
  'trait', 'transform', 'translate', 'trash', 'trial', 'tribe', 'trick',
  'trouble', 'trunk', 'trust', 'truth', 'twist', 'type', 'typical', 'ugly',
  'ultimate', 'unconscious', 'undergo', 'underline', 'undertake', 'undoubtedly',
  'uneasy', 'unexpected', 'unity', 'universal', 'unlock', 'upset', 'urgent',
  'utility', 'utter', 'vague', 'valid', 'vanish', 'variable', 'vary', 'vehicle',
  'venture', 'vessel', 'victim', 'view', 'violate', 'virtual', 'visible',
  'voluntary', 'vote', 'wage', 'waist', 'wander', 'warmth', 'weakness',
  'wealth', 'weapon', 'whistle', 'widespread', 'willing', 'wind', 'withdraw',
  'witness', 'wrap', 'wreck', 'yield', 'zone',
]);

// ── B2 words (upper-intermediate — academic, professional, nuanced) ──

const B2_WORDS = new Set([
  'abbreviation', 'abolish', 'abstract', 'abundant', 'accessory', 'acclaim',
  'accommodate', 'accompany', 'accumulate', 'accurate', 'acknowledge',
  'acquaintance', 'acquire', 'address', 'adequate', 'adjacent', 'adjust',
  'administer', 'admirable', 'advocate', 'aesthetic', 'affluent', 'agenda',
  'alien', 'align', 'allege', 'allocate', 'ambiguous', 'ambitious', 'analogy',
  'analyse', 'analysis', 'ancestor', 'announce', 'anticipate', 'apparatus',
  'apparent', 'appendix', 'applaud', 'appreciable', 'appropriate', 'arbitrary',
  'array', 'articulate', 'ascertain', 'aspiration', 'assert', 'assess',
  'asset', 'assumption', 'astonish', 'attain', 'attitude', 'attribute',
  'authentic', 'authority', 'autonomous', 'avail', 'avert', 'awareness',
  'barely', 'bearing', 'beneficial', 'bias', 'binding', 'breach', 'budget',
  'bureaucracy', 'bypass', 'capable', 'capacity', 'capital', 'catastrophe',
  'censorship', 'chronicle', 'coincide', 'collaborate', 'commemorate',
  'compelling', 'compensate', 'compile', 'complement', 'complex', 'comply',
  'comprehensive', 'comprise', 'compromise', 'concede', 'conceive', 'concept',
  'concern', 'conclusive', 'condemn', 'conduct', 'confer', 'confine',
  'conform', 'confront', 'consensus', 'consequent', 'conservative', 'consist',
  'conspicuous', 'constitute', 'constrain', 'contemporary', 'contend',
  'context', 'contradict', 'contribute', 'controversy', 'convene', 'convert',
  'convince', 'coordinate', 'corporate', 'correspond', 'courtesy', 'criteria',
  'cumulative', 'curb', 'deduce', 'deficit', 'deliberate', 'demonstrate',
  'denote', 'deprive', 'derive', 'despite', 'detach', 'devastate', 'deviate',
  'discern', 'disclose', 'discriminate', 'dismantle', 'displace', 'dispose',
  'dispute', 'disregard', 'disrupt', 'dissolve', 'distinct', 'distort',
  'distract', 'diverse', 'dominant', 'dubious', 'duplicate', 'dynamic',
  'elaborate', 'elicit', 'embody', 'emerge', 'emphasis', 'empirical',
  'endeavour', 'enormous', 'ensue', 'entail', 'entity', 'equilibrium',
  'essential', 'establish', 'estimate', 'ethical', 'evident', 'exaggerate',
  'exceed', 'excerpt', 'exclusive', 'execute', 'exemplify', 'exhaust',
  'explicit', 'exploit', 'explore', 'export', 'expose', 'express', 'extract',
  'facilitate', 'feasible', 'fluctuate', 'foresee', 'formulate', 'fortify',
  'fortunate', 'fragment', 'framework', 'fundamental', 'generate', 'genuine',
  'gorgeous', 'gradual', 'graphic', 'gratify', 'hazard', 'highlight', 'hypothesis',
  'identical', 'identify', 'illusion', 'immense', 'implement', 'implicate',
  'implicit', 'imply', 'incentive', 'incidence', 'incline', 'inclusive',
  'inconsistency', 'incorporate', 'increment', 'index', 'indicate', 'inevitable',
  'infer', 'inhibit', 'initiate', 'innovate', 'insight', 'insist', 'integral',
  'integrate', 'integrity', 'intense', 'interim', 'interpret', 'intervene',
  'intimate', 'intrigue', 'invoke', 'isolate', 'legitimate', 'liaise', 'linear',
  'linguistic', 'magnitude', 'manipulate', 'mediate', 'mediate', 'merit',
  'metaphor', 'migration', 'minimal', 'minimize', 'momentum', 'monitor',
  'motive', 'negligible', 'notion', 'notwithstanding', 'objective', 'obligation',
  'obscure', 'observe', 'obtain', 'obvious', 'occupy', 'offset', 'ongoing',
  'oppressive', 'optimize', 'option', 'originate', 'outcome', 'overlap',
  'overwhelm', 'paradigm', 'parallel', 'partial', 'participate', 'particular',
  'passive', 'penetrate', 'perceive', 'perpetuate', 'persevere', 'perspective',
  'pertinent', 'phenomenon', 'plausible', 'polar', 'portion', 'pose', 'positive',
  'precede', 'precipitate', 'precise', 'predominant', 'preliminary', 'presume',
  'prevalent', 'primitive', 'priority', 'proceed', 'process', 'proclaim',
  'proficient', 'profound', 'prohibit', 'project', 'prolong', 'prominent',
  'prompt', 'propagate', 'proportion', 'propose', 'prospect', 'protocol',
  'provoke', 'prudent', 'publication', 'pursue', 'quantify', 'radical',
  'random', 'rational', 'react', 'realm', 'reassure', 'recall', 'recede',
  'reciprocal', 'recognize', 'recommend', 'reconcile', 'recur', 'reflect',
  'refute', 'regime', 'register', 'regulate', 'reinforce', 'reject', 'relate',
  'relentless', 'relevant', 'reliable', 'relieve', 'reluctant', 'remedy',
  'renowned', 'reproduce', 'resilient', 'resolve', 'resort', 'resource',
  'respond', 'restore', 'restrain', 'restrict', 'retain', 'retrieve',
  'reveal', 'reverse', 'revise', 'rigorous', 'rotate', 'sanction', 'scenario',
  'scope', 'scrutinize', 'sector', 'secure', 'seek', 'segregate', 'sequence',
  'shrink', 'significant', 'simulate', 'simultaneous', 'skeptical', 'sophisticated',
  'spatial', 'specific', 'specify', 'sponsor', 'stable', 'stationary', 'stimulate',
  'strategic', 'submerge', 'subsequent', 'substance', 'substantial', 'subtle',
  'successive', 'sufficient', 'sufficient', 'summary', 'supplement', 'surpass',
  'survive', 'susceptible', 'sustain', 'tentative', 'threshold', 'tolerate',
  'transcend', 'transform', 'transient', 'transmit', 'transparent', 'trigger',
  'ultimate', 'unanimous', 'underestimate', 'undergo', 'undermine', 'unfold',
  'unique', 'unprecedented', 'utilize', 'validate', 'vanish', 'variable',
  'vary', 'vehicle', 'versatile', 'vicinity', 'violate', 'virtual', 'visible',
  'vital', 'volatile', 'volatile', 'whereas', 'widespread',
]);

// ── C1 words (advanced — sophisticated, formal, literary) ──

const C1_WORDS = new Set([
  'abstain', 'acquiesce', 'admonish', 'adversary', 'advocate', 'aesthetic',
  'affinity', 'aggressor', 'alleviate', 'amalgam', 'ambiguous', 'ambivalence',
  'anomaly', 'antithesis', 'apathetic', 'apprehension', 'arbitrate', 'ascertain',
  'aspire', 'assiduous', 'atrophy', 'attenuate', 'augment', 'auspicious',
  'authoritarian', 'avow', 'belittle', 'benevolent', 'bereft', 'bombastic',
  'cajole', 'candour', 'capitulate', 'catalyst', 'caustic', 'censure',
  'chastise', 'cohesion', 'commensurate', 'compelling', 'compliant',
  'conciliate', 'condone', 'confluence', 'connotation', 'consequential',
  'consolidate', 'construe', 'contrive', 'copious', 'corroborate', 'cosmopolitan',
  'credulous', 'culpable', 'cumulative', 'debilitate', 'decorum', 'deference',
  'delinquent', 'demagogue', 'demystify', 'denigrate', 'depict', 'deplete',
  'deposition', 'derivative', 'despondent', 'deterrent', 'detrimental',
  'deviate', 'diatribe', 'didactic', 'discern', 'discrepancy', 'disdain',
  'disseminate', 'distraught', 'divergent', 'doggrel', 'ebullient', 'efface',
  'efficacy', 'egalitarian', 'elucidate', 'emancipate', 'empathy', 'emulate',
  'enervate', 'engender', 'epitome', 'equanimity', 'equivocal', 'erudite',
  'espouse', 'euphemism', 'exacerbate', 'exculpate', 'exonerate', 'expedient',
  'explicate', 'extant', 'extol', 'facetious', 'fallacious', 'fatuous',
  'feckless', 'flagrant', 'fortuitous', 'frugal', 'garrulous', 'gregarious',
  'harangue', 'hegemony', 'heterogeneous', 'hierarchy', 'hypocrisy', 'iconoclast',
  'idiosyncratic', 'imbue', 'immutable', 'impede', 'imperative', 'impertinent',
  'impetus', 'implacable', 'inadvertent', 'inaugurate', 'incentive', 'incisive',
  'inclination', 'inculcate', 'indelible', 'ineffable', 'inept', 'inertia',
  'infallible', 'infringe', 'ingenuity', 'inherent', 'innocuous', 'insidious',
  'insinuate', 'instigate', 'intransigent', 'intrinsic', 'inveterate',
  'jettison', 'juxtapose', 'languish', 'liaise', 'lugubrious', 'magnanimous',
  'malleable', 'mendacious', 'meritorious', 'metamorphosis', 'meticulous',
  'mitigate', 'morose', 'mutable', 'narcissistic', 'nefarious', 'nonchalant',
  'obdurate', 'obfuscate', 'obsequious', 'obsolescent', 'oligarchy', 'omniscient',
  'opprobrious', 'ostensible', 'palliative', 'panacea', 'paradigm', 'paragon',
  'partisan', 'pedantic', 'pejorative', 'pellucid', 'penchant', 'perceive',
  'pernicious', 'perspicacious', 'pertinent', 'philanthropic', 'placate',
  'pragmatic', 'precarious', 'precipitous', 'predilection', 'presumptuous',
  'prevaricate', 'procrastinate', 'prodigious', 'proliferate', 'propensity',
  'propitiate', 'provocative', 'punctilious', 'quintessential', 'rapport',
  'recalcitrant', 'reconcile', 'redolent', 'refute', 'relegate', 'remonstrate',
  'reprehensible', 'repudiate', 'resilient', 'restitution', 'reticent',
  'revere', 'salient', 'sanctimonious', 'sanguine', 'scurrilous', 'sedulous',
  'serendipity', 'sinecure', 'spurious', 'strident', 'subjugate', 'sublime',
  'supersede', 'supplant', 'surfeit', 'sycophant', 'tenacious', 'tepid',
  'timorous', 'transgress', 'ubiquitous', 'unassailable', 'undermine',
  'undulate', 'unflagging', 'unilateral', 'unprecedented', 'unravel',
  'unvarying', 'vacillate', 'venerable', 'verbose', 'verisimilitude',
  'viable', 'virulent', 'visceral', 'vituperate', 'volatile', 'wither',
  'zealous',
]);

// ── C2 words (mastery — rare, archaic, highly specialised) ──

const C2_WORDS = new Set([
  'aberration', 'acrimonious', 'anachronism', 'antediluvian', 'apocryphal',
  'apotheosis', 'asperity', 'assiduous', 'atavistic', 'baleful', 'bibulous',
  'cacophony', 'callipygian', 'captious', 'casuistry', 'circumlocution',
  'cloying', 'commensurate', 'concupiscent', 'coruscate', 'cupidity',
  'deleterious', 'denouement', 'diaphanous', 'dichotomy', 'disapprobation',
  'ebullient', 'ellipsis', 'encomium', 'ephemeral', 'epigram', 'esoteric',
  'exegesis', 'exiguous', 'fatidic', 'fecund', 'floccinaucinihilipilification',
  'gainsay', 'hornswoggle', 'imbroglio', 'inchoate', 'ineluctable', 'inexorable',
  'iniquitous', 'insouciant', 'invidious', 'kowtow', 'laconic', 'lambent',
  'leitmotif', 'limpid', 'logorrhea', 'lugubrious', 'machination', 'mellifluous',
  'meretricious', 'minatory', 'mordant', 'muliebrity', 'nugatory', 'obloquy',
  'obsequious', 'obviate', 'onanism', 'palliative', 'panegyric', 'parlous',
  'pellucid', 'penumbra', 'peregrinate', 'peripatetic', 'peroration', 'picayune',
  'pulchritude', 'pusillanimous', 'quidnunc', 'redoubtable', 'sanguinolent',
  'sesquipedalian', 'sibylline', 'simulacrum', 'solecism', 'sophomoric',
  'sycophancy', 'tergiversate', 'theodicy', 'uxorious', 'verisimilitude',
  'vituperative', 'voracious', 'winnow', 'xenophile', 'yonder',
]);

// ── Classification function ─────────────────────────────────

/**
 * Estimate the CEFR level of a word based on local word lists and heuristics.
 *
 * Words are looked up against explicit A1→C2 lists first (local-first, so the
 * result is deterministic and free). Only genuinely unknown words fall through
 * to the suffix/length heuristic.
 */
export function classifyWordCEFR(word: string): CEFRLevel {
  const lower = word.toLowerCase().replace(/[^a-z]/g, '');

  if (A1_WORDS.has(lower)) return 'A1';
  if (A2_WORDS.has(lower)) return 'A2';
  if (B1_WORDS.has(lower)) return 'B1';
  if (B2_WORDS.has(lower)) return 'B2';
  if (C1_WORDS.has(lower)) return 'C1';
  if (C2_WORDS.has(lower)) return 'C2';

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
    const lemma = lemmatize(lower);
    if (lemma.length < 3 || seen.has(lemma)) continue;
    seen.add(lemma);

    const level = classifyWordCEFR(lemma);
    const levelIdx = CEFR_LEVELS.indexOf(level);

    if (levelIdx >= minIdx && levelIdx <= maxIdx) {
      // Find the sentence containing this word
      const ctx = sentences.find((s) => s.toLowerCase().includes(lower)) || text.slice(0, 120);
      const cleanCtx = ctx.trim();
      results.push({
        word: lemma,
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
