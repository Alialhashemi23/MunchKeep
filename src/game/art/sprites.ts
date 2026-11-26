/**
 * Hand-drawn ASCII pixel sprites. Each character is one pixel; see KEYS in palette.ts.
 * Characters face right; the renderer mirrors them to face left.
 */

const KNIGHT_BODY = [
  '....kkk.....',
  '...kRRRk....',
  '...kkRkk....',
  '..kSSSSSk...',
  '.kSSSSSSSk..',
  '.kSdEEEdSk.k',
  '.kSSSSSSSk.kS',
  '..kdSSSdk..kS',
  '.kkkSSSkk..kS',
  'kGRGkSsSSk.kS',
  'kGRGkSsSSLkkk',
  'kGGGksssskLk.',
];
const KNIGHT_LEGS_A = ['.kkkkssssk...', '....kdkkdk...', '...kdk..kdk..', '...kk....kk..'];
const KNIGHT_LEGS_B = ['.kkkkssssk...', '....kdkkdk...', '....kdkkdk...', '....kk..kk...'];

const ROGUE_BODY = [
  '....kkkk....',
  '...kHHHHk...',
  '..kHHHHHHk..',
  '..kHhhhhHk..',
  '..khLLLLLk..',
  '..khLLELEk..',
  '..khLLLLLk..',
  '...kHLLLk...',
  '..kHHHHHHk..',
  '.kHHHHHHHHk.',
  '.kLkHbbHkLkS',
  '..k.kHHHk.kk',
];
const ROGUE_LEGS_A = ['...kbbbbk...', '...kbkkbk...', '..kbk..kbk..', '..kk....kk..'];
const ROGUE_LEGS_B = ['...kbbbbk...', '...kbkkbk...', '...kbkkbk...', '...kk..kk...'];

const CLERIC_BODY = [
  '.....kk.....',
  '....kWWk....',
  '...kWGGWk...',
  '...kWGGWk..k',
  '..kkkkkkkkkGk',
  '..kLLLLLLk.kG',
  '..kLLLELEk.kg',
  '..kLLLLLLk.kg',
  '..kWWWWWWk.kg',
  '.kWWWGWWWWkkg',
  '.kLWWGWWWLLkg',
  '..kWWGWWWWkkg',
];
const CLERIC_LEGS_A = ['..kWWGWWWWk.g', '..kwWWWWWwk.k', '..kwwwwwwwk..', '...kkkkkkk...'];
const CLERIC_LEGS_B = ['..kWWGWWWWk.g', '..kwWWWWWwk.k', '..kwwwwwwwk..', '..kkkkkkkkk..'];

export const HERO_FRAMES: Record<'knight' | 'rogue' | 'cleric', string[][]> = {
  knight: [
    [...KNIGHT_BODY, ...KNIGHT_LEGS_A],
    [...KNIGHT_BODY, ...KNIGHT_LEGS_B],
  ],
  rogue: [
    [...ROGUE_BODY, ...ROGUE_LEGS_A],
    [...ROGUE_BODY, ...ROGUE_LEGS_B],
  ],
  cleric: [
    [...CLERIC_BODY, ...CLERIC_LEGS_A],
    [...CLERIC_BODY, ...CLERIC_LEGS_B],
  ],
};

const GOBLIN_TOP = [
  'k........k..',
  'kNk.kkk.kNk.',
  '.kNkNNNkNk..',
  '..kNNNNNk...',
  '..kNYEnYEk..',
  '..kNNNNNNk..',
  '...kNWNWk.k.',
  '..kbkkkkbkBk',
  '.kNkBBBBkNBk',
  '..k.kBBk.kk.',
];

export const GOBLIN_FRAMES: string[][] = [
  [...GOBLIN_TOP, '...kNkkNk...', '...kk..kk...'],
  [...GOBLIN_TOP, '..kNk..kNk..', '..kk....kk..'],
];

export const SLIME_FRAMES: string[][] = [
  [
    '............',
    '....kkkk....',
    '..kkMMCCkk..',
    '.kMMMMMCCMk.',
    '.kMMEMMEMMk.',
    'kMMMEMMEMMMk',
    'kMMMMMMMMMMk',
    'kmMMMMMMMMmk',
    '.kmmmmmmmmk.',
    '..kkkkkkkk..',
  ],
  [
    '............',
    '............',
    '...kkkkkk...',
    '.kkMMMMCCkk.',
    'kMMMEMMEMCMk',
    'kMMMEMMEMMMk',
    'kMMMMMMMMMMk',
    'kmMMMMMMMMmk',
    'kkmmmmmmmmkk',
    '.kkkkkkkkkk.',
  ],
];

export const MIMIC_FRAMES: string[][] = [
  [
    '..............',
    '..............',
    '..kkkkkkkkkk..',
    '.kBBBBBBBBBBk.',
    'kBBbBBBBBBbBBk',
    'kBBBBBBBBBBBBk',
    'kGGGGGGGGGGTGk',
    'kbbbbkGGkbbbbk',
    'kBBBBkGYkBBBBk',
    'kBBBBBkkBBBBBk',
    'kBBBBBBBBBBBBk',
    'kbBBBBBBBBBBbk',
    'kGGGGGGGGGGGGk',
    '.kkkkkkkkkkkk.',
  ],
  [
    '.kkkkkkkkkkkk.',
    'kBBBBBBBBBBBBk',
    'kGGGGGGGGGGGGk',
    'kEWEWEWEWEWEWk',
    'kEEEEEEEEEEEEk',
    'kEEYEEEEEEYEEk',
    'kETTTTTTTTTTEk',
    'kWEWEWEWEWEWEk',
    'kGGGGGGGGGGGGk',
    'kBBBBBBBBBBBBk',
    'kBBBBBBBBBBBBk',
    'kbBBBBBBBBBBbk',
    'kGGGGGGGGGGGGk',
    '.kkkkkkkkkkkk.',
  ],
];

export const HOARD = [
  '........kk........',
  '......kkGyk.......',
  '.....kGGGGGk......',
  '....kGyGGGGGkk....',
  '...kGGGGgGGGGGk...',
  '..kGGgGGGGRGGGGk..',
  '.kGGGGGGGGGGgGGGk.',
  'kGyGGGgGGGGGGGGGGk',
  'kGGGGGGGGGgGGyGGGk',
  'kgGGGGGGGGGGGGGGgk',
  '.kggggggggggggggk.',
  '..kkkkkkkkkkkkkk..',
];

export const DEN = [
  '........kk........',
  '.......kBbk.......',
  '......kBBBbk......',
  '.....kBBkkBbk.....',
  '....kBBkZZkBbk....',
  '...kBBBkZEkBBbk...',
  '..kBBBBBkkBBBBbk..',
  '..kBBBBkEEkBBBbk..',
  '.kBBBBkEEEEkBBBbk.',
  '.kBBBkEEEEEEkBBbk.',
  'kBBBBkEEEEEEkBBBbk',
  'kbbbbkEEEEEEkbbbbk',
  '.kkkkkkkkkkkkkkkk.',
];

export const LARDER = [
  '..................',
  '......kkkk........',
  '....kkQQQQkk......',
  '...kQQQQQQQQk.kk..',
  '..kQQqQQQQQQQkZZk.',
  '..kQqqQQQQQQQQkZk.',
  '..kqqqqqQQQQQkkk..',
  '.kkkkkkkkkkkkkkkk.',
  'kBBBBBBBBBBBBBBBBk',
  'kbbbbbbbbbbbbbbbbk',
  '.kbk..........kbk.',
  '.kbk..........kbk.',
  '.kkk..........kkk.',
];

export const CROWN = ['k.k.k.k', 'GkGkGkG', 'GGGGGGG', 'kkkkkkk'];

// ---------------------------------------------------------------- UI icons

export const ICON_PICK = [
  '..kkkkkk....',
  '.kSSSSSSkk..',
  'kSSkkkkSSSk.',
  'kSk..kBkkSk.',
  'kk..kBk..kk.',
  '...kBk......',
  '..kBk.......',
  '.kBk........',
  'kBk.........',
  'kk..........',
];

export const ICON_COIN = [
  '..kkkkk..',
  '.kGyyGGk.',
  'kGyGGGGgk',
  'kGyGgGGgk',
  'kGGGgGGgk',
  'kGGGgGGgk',
  'kGGGGGggk',
  '.kgggggk.',
  '..kkkkk..',
];

export const ICON_SKULL = [
  '..kkkkk..',
  '.kZZZZZk.',
  'kZZZZZZZk',
  'kZEEZEEZk',
  'kZEEZEEZk',
  'kZZZkZZZk',
  '.kZZZZZk.',
  '.kZkZkZk.',
  '..kkkkk..',
];

export const ICON_TOOTH = [
  '.kkkkkkkk.',
  'kWWWWWWWWk',
  'kWWWWWWWwk',
  'kWWWWWWWwk',
  'kWWWWWWwwk',
  '.kWWWWwwk.',
  '.kWWkkWwk.',
  '.kWk.kWwk.',
  '.kWk..kWk.',
  '..kk...kk.',
];

export const ICON_X = [
  'kk......kk',
  'kRk....kRk',
  '.kRk..kRk.',
  '..kRkkRk..',
  '...kRRk...',
  '...kRRk...',
  '..kRkkRk..',
  '.kRk..kRk.',
  'kRk....kRk',
  'kk......kk',
];

export const ICON_EYE = [
  '...kkkkkk...',
  '.kkWWWWWWkk.',
  'kWWWkkkkWWWk',
  'kWWkUUkkkWWk',
  'kWWkUkkkkWWk',
  '.kkWkkkkWkk.',
  '...kkkkkk...',
];

export const ICON_HEART = [
  '.kk...kk.',
  'kFFk.kFFk',
  'kFTFkFFfk',
  'kFFFFFFfk',
  '.kFFFFfk.',
  '..kFFfk..',
  '...kfk...',
  '....k....',
];
