/**
 * Curated English content. Every word here is a real, common, age-appropriate
 * word; its graphemes, pattern, skills and difficulty are derived by code, so
 * adding a word means adding it to a list — nothing else.
 */

/** Letter names plus the spellings recognisers commonly return for them. */
export const LETTER_NAMES: Record<string, string[]> = {
  a: ['a', 'ay', 'eh', 'ah'], b: ['b', 'bee', 'be', 'bea'], c: ['c', 'see', 'sea', 'si'],
  d: ['d', 'dee', 'de'], e: ['e', 'ee', 'eee'], f: ['f', 'ef', 'eff'],
  g: ['g', 'gee', 'ji', 'jee'], h: ['h', 'aitch', 'eitch', 'haitch', 'age'],
  i: ['i', 'eye', 'aye'], j: ['j', 'jay'], k: ['k', 'kay', 'cay', 'okay', 'ok'],
  l: ['l', 'el', 'elle', 'ell'], m: ['m', 'em', 'emm', 'mmm'], n: ['n', 'en', 'enn'],
  o: ['o', 'oh', 'owe'], p: ['p', 'pee', 'pea'], q: ['q', 'queue', 'cue', 'kyu'],
  r: ['r', 'are', 'ar'], s: ['s', 'es', 'ess', 'sss'], t: ['t', 'tea', 'tee'],
  u: ['u', 'you', 'yu'], v: ['v', 'vee', 've'], w: ['w', 'double you', 'double u'],
  x: ['x', 'ex', 'ax'], y: ['y', 'why', 'wye'], z: ['z', 'zee', 'zed'],
};

/** A word that shows each sound, for "s as in sun" hints. */
export const KEYWORDS: Record<string, string> = {
  s: 'sun', a: 'ant', t: 'top', p: 'pig', i: 'insect', n: 'net', m: 'map', d: 'dog',
  g: 'goat', o: 'octopus', c: 'cat', k: 'kite', e: 'egg', u: 'umbrella', r: 'rat',
  h: 'hat', b: 'bat', f: 'fish', l: 'leg', j: 'jam', v: 'van', w: 'web', x: 'box',
  y: 'yes', z: 'zip', q: 'queen',
  sh: 'ship', ch: 'chin', th: 'thin', ck: 'duck', ng: 'ring', qu: 'quick', wh: 'when',
  ee: 'tree', oo: 'moon', ai: 'rain', oa: 'boat', ar: 'car', or: 'fork', ay: 'day',
  ll: 'bell', ss: 'kiss', ff: 'off', zz: 'buzz',
  a_e: 'cake', i_e: 'kite', o_e: 'bone', u_e: 'cube', e_e: 'these',
};

/**
 * "Sound combination" drills (stage 2): rimes that are blended with an onset
 * to make whole word families, and consonant digraphs. Each lists what a
 * recogniser plausibly returns for it. They are presented as sound chunks,
 * never as vocabulary.
 */
export const CHUNKS: Array<{ text: string; accepted: string[] }> = [
  { text: 'at', accepted: ['at'] }, { text: 'an', accepted: ['an', 'ann'] },
  { text: 'ap', accepted: ['ap', 'app'] }, { text: 'ad', accepted: ['ad', 'add'] },
  { text: 'am', accepted: ['am'] }, { text: 'it', accepted: ['it'] },
  { text: 'in', accepted: ['in', 'inn'] }, { text: 'ip', accepted: ['ip', 'yip'] },
  { text: 'ot', accepted: ['ot', 'aught', 'ought'] }, { text: 'op', accepted: ['op', 'opp'] },
  { text: 'og', accepted: ['og'] }, { text: 'ug', accepted: ['ug', 'ugh'] },
  { text: 'un', accepted: ['un'] }, { text: 'up', accepted: ['up'] },
  { text: 'en', accepted: ['en'] }, { text: 'ed', accepted: ['ed', 'edd'] },
  { text: 'et', accepted: ['et'] },
  { text: 'ma', accepted: ['ma', 'mah', 'maa'] }, { text: 'pa', accepted: ['pa', 'pah'] },
  { text: 'no', accepted: ['no', 'know'] }, { text: 'so', accepted: ['so', 'sew'] },
  { text: 'go', accepted: ['go'] },
  { text: 'sh', accepted: ['sh', 'shh', 'shhh', 'ssh'] },
  { text: 'ch', accepted: ['ch', 'chh'] },
  { text: 'th', accepted: ['th', 'thh'] },
];

/** Real decodable words, grouped loosely; the grouping is not used by code. */
export const WORDS: string[] = [
  // short a
  'cat', 'bat', 'hat', 'mat', 'rat', 'sat', 'pat', 'pats', 'taps', 'saps', 'fat', 'can', 'fan', 'man', 'pan', 'ran',
  'tan', 'van', 'map', 'cap', 'nap', 'tap', 'lap', 'gap', 'bag', 'rag', 'tag', 'wag', 'dad',
  'sad', 'mad', 'bad', 'had', 'pad', 'jam', 'ham', 'ram', 'dam', 'ant', 'sap', 'nag', 'van',
  // short i
  'pin', 'tin', 'bin', 'win', 'fin', 'sit', 'hit', 'bit', 'fit', 'pit', 'kit', 'big', 'dig',
  'pig', 'wig', 'fig', 'dip', 'hip', 'lip', 'rip', 'sip', 'tip', 'zip', 'lid', 'hid', 'kid',
  'mix', 'six', 'fix', 'nip',
  // short o
  'dog', 'log', 'fog', 'hog', 'jog', 'hot', 'pot', 'not', 'dot', 'got', 'lot', 'cot', 'top',
  'hop', 'mop', 'pop', 'box', 'fox', 'job', 'rob', 'nod', 'pod', 'on',
  // short u
  'sun', 'bun', 'fun', 'run', 'nut', 'cut', 'hut', 'but', 'bug', 'hug', 'mug', 'rug', 'jug',
  'tug', 'cup', 'pup', 'bus', 'mud', 'bud', 'gum', 'hum', 'tub', 'cub', 'rub', 'up',
  // short e
  'bed', 'red', 'fed', 'led', 'wed', 'hen', 'pen', 'ten', 'men', 'den', 'net', 'pet', 'wet',
  'jet', 'vet', 'get', 'let', 'met', 'set', 'web', 'leg', 'beg', 'peg', 'yes', 'egg',
  // digraphs
  'ship', 'shop', 'fish', 'dish', 'wish', 'shed', 'shut', 'cash', 'rush', 'shell', 'chin',
  'chip', 'chop', 'chat', 'much', 'rich', 'thin', 'this', 'that', 'then', 'them', 'with',
  'bath', 'math', 'moth', 'duck', 'back', 'sock', 'kick', 'neck', 'sick', 'lock', 'rock',
  'pick', 'ring', 'sing', 'king', 'long', 'song', 'wing', 'bell', 'doll', 'hill', 'kiss',
  'miss', 'off', 'puff', 'buzz', 'quick', 'quiz', 'when', 'chick', 'thick', 'shock',
  // blends
  'frog', 'flag', 'clap', 'crab', 'drum', 'stop', 'step', 'spin', 'swim', 'slip', 'skip',
  'grab', 'plan', 'snap', 'trip', 'from', 'glad', 'club', 'plum', 'flat', 'sled', 'spot',
  'hand', 'sand', 'band', 'lamp', 'jump', 'camp', 'tent', 'best', 'nest', 'fast', 'milk',
  'gift', 'help', 'desk', 'pink', 'sink', 'bank', 'tank', 'pond', 'list', 'just', 'must',
  'black', 'truck', 'brush', 'fresh', 'string', 'crash', 'splash', 'stamp', 'plant',
  // magic e
  'cake', 'make', 'lake', 'name', 'game', 'gate', 'late', 'plate', 'kite', 'bike', 'like',
  'time', 'ride', 'hide', 'five', 'home', 'rope', 'nose', 'bone', 'hole', 'cube', 'tube',
  'cute', 'mule', 'snake', 'smile', 'stone',
  // vowel teams and r-controlled
  'rain', 'tail', 'mail', 'wait', 'paint', 'boat', 'coat', 'road', 'goat', 'soap', 'tree',
  'see', 'bee', 'feet', 'seed', 'green', 'sheep', 'moon', 'food', 'pool', 'spoon', 'room',
  'star', 'car', 'park', 'farm', 'dark', 'fork', 'corn', 'storm', 'day', 'play',
  'stay', 'tray',
];

/** Tricky (non-decodable at this stage) words, taught as whole units. */
export const TRICKY = ['the', 'is', 'a', 'i', 'we', 'he', 'she', 'my', 'has', 'to', 'was', 'you', 'are', 'of', 'be', 'me', 'go', 'no', 'so'];

export const SENTENCES: string[] = [
  'The cat is on the bed.',
  'A big dog can run.',
  'The sun is hot.',
  'I can see a red hen.',
  'The fish is in the tank.',
  'The frog sat on a log.',
  'We can jump and swim.',
  'The duck is in the mud.',
  'I had a nap in the sun.',
  'The bus is red.',
  'She has a pink hat.',
  'He can ride a bike.',
  'The cake is on the plate.',
  'We see the moon.',
  'The boat is in the rain.',
  'My cat can sit on the mat.',
  'The king had a big ship.',
  'The goat is in the park.',
  'A bee is on the green tree.',
  'The fox hid in the box.',
  'We can play in the sand.',
  'The pup has a red cup.',
  'Dad has a black truck.',
  'The sheep ran up the hill.',
  'I wish I had a pet frog.',
];

/** Pairs a recogniser cannot tell apart. Reading either counts as correct. */
export const HOMOPHONES: string[][] = [
  ['sun', 'son'], ['see', 'sea'], ['bee', 'be', 'b'], ['red', 'read'], ['tail', 'tale'],
  ['mail', 'male'], ['road', 'rode', 'rowed'], ['rain', 'reign', 'rein'], ['two', 'to', 'too', '2'],
  ['no', 'know'], ['for', 'four', '4'], ['won', 'one', '1'], ['by', 'buy', 'bye'], ['i', 'eye'],
  ['nose', 'knows'], ['hole', 'whole'], ['so', 'sew'], ['tea', 'tee', 't'], ['wait', 'weight'],
  ['ate', 'eight', '8'], ['six', '6'], ['ten', '10'], ['five', '5'], ['ring', 'wring'],
  ['which', 'witch'], ['sail', 'sale'], ['made', 'maid'], ['night', 'knight'], ['bear', 'bare'],
  ['hear', 'here'], ['meet', 'meat'], ['week', 'weak'], ['deer', 'dear'], ['pair', 'pear'],
  ['hi', 'high'], ['new', 'knew'], ['rose', 'rows'], ['plum', 'plumb'],
  ['cent', 'sent', 'scent'], ['would', 'wood'], ['flour', 'flower'], ['knot', 'not'],
  ['nit', 'knit'], ['pause', 'paws'], ['mussel', 'muscle'], ['nap', 'knap'], ['dam', 'damn'],
  ['bin', 'been'], ['ant', 'aunt'], ['cash', 'cache'],
  ['led', 'lead'], ['wed', "we'd"], ['hymn', 'him'], ['in', 'inn'], ['band', 'banned'],
  ['must', 'mussed'], ['bus', 'buss'], ['hum', 'hmm'], ['jam', 'jamb'], ['pole', 'poll'],
];
