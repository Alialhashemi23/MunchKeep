/**
 * Every tunable number and every piece of content lives here.
 * The simulation reads only from this file, so balance changes never touch logic.
 */

export type HeroClass = 'knight' | 'rogue' | 'cleric';
export type MonsterKind = 'goblin' | 'slime' | 'mimic';
export type FeatureId =
  | 'goblinDen'
  | 'spikes'
  | 'hoard'
  | 'slimePit'
  | 'larder'
  | 'oil'
  | 'gloom'
  | 'fireVent'
  | 'gullet'
  | 'mimic';
export type FeatureCategory = 'lair' | 'trap' | 'room';

// ---------------------------------------------------------------- world

export const BALANCE = {
  dt: 0.05, // seconds per simulation tick (20 Hz)

  gridW: 22,
  gridH: 22,
  entrance: { x: 0, y: 6 },
  maw: { x: 15, y: 14 },
  bedrockChance: 0.07,

  startGold: 160,
  passiveGoldPerSec: 0.35,
  digCost: 5,
  fillCost: 4,
  demolishRefund: 0.5,

  // Escalation. Minutes are run-time minutes.
  firstPartyAt: 22,
  partyIntervalStart: 22,
  partyIntervalPerMin: 0.32,
  partyIntervalMin: 9,
  partySizeBase: 1.3,
  partySizePerMin: 0.06,
  partySizePerInfamy: 0.001,
  partySizePerMin2: 0.0006,
  partySizeMax: 7,
  heroLevelPerMin: 0.1,
  heroLevelPerMin2: 0.0012,
  heroLevelPerInfamy: 0.0015,
  spawnStagger: 0.7,

  championEvery: 480, // seconds
  championLevelBonus: 2,
  championHpMul: 2.0,
  championDmgMul: 1.5,
  championRewardMul: 5,

  // The Maw
  mawHp: 260,
  mawRegen: 0.8, // hp/s when nobody is biting
  mawChomp: 14,
  mawChompCooldown: 1.3,
  mawChompRange: 1.15,
  mawUpgradeBase: 70,
  mawUpgradeGrowth: 1.55,
  mawUpgradeMax: 10,
  mawHpPerLevel: 0.22,
  mawChompPerLevel: 0.3,
  biteDamageMul: 1.0,
  biteStealFraction: 0.025,
  bitesBeforeFlee: 3,

  // Looting
  lootSeconds: 2.0,
  lootStealFraction: 0.06,
  lootStealCapBase: 12,
  lootStealCapPerLevel: 6,
  hoardAppeal: 11,
  detourWeight: 0.55,

  // Fear & knowledge
  knownTrapFear: 9,
  lairFear: 5,
  lairNearFear: 2,
  gloomSlow: 0.7,
  rumorSeconds: 210,

  // Status effects
  stickySlow: 0.5,
  stickySeconds: 4,
  oilySlow: 0.6,
  oilySeconds: 8,
  burnSeconds: 4,

  meleeRange: 0.72,
  monsterReach: 0.62,

  upgradeGrowth: 1.7,
  upgradeBaseFactor: 0.8,
  featureMaxLevel: 5,

  partyWipeInfamyPerHero: 1,

  // Offline
  offlineCapSeconds: 2 * 3600,
  offlineEfficiency: 0.25,
} as const;

// ---------------------------------------------------------------- heroes

export interface HeroDef {
  name: string;
  hp: number;
  dmg: number;
  cooldown: number;
  speed: number;
  armor: number;
  greed: number;
  fear: number;
  fleeAt: number;
  spotChance: number;
  disarmChance: number;
  heal?: { amount: number; interval: number; radius: number };
  gold: number;
  infamy: number;
  maxLoots: number;
  blurb: string;
}

export const HEROES: Record<HeroClass, HeroDef> = {
  knight: {
    name: 'Knight',
    hp: 70,
    dmg: 7,
    cooldown: 1.1,
    speed: 1.25,
    armor: 2,
    greed: 0.1,
    fear: 0.15,
    fleeAt: 0,
    spotChance: 0,
    disarmChance: 0,
    gold: 15,
    infamy: 1,
    maxLoots: 1,
    blurb: 'Slow and armored. Barely afraid of anything. Monsters attack the Knight first.',
  },
  rogue: {
    name: 'Rogue',
    hp: 36,
    dmg: 6,
    cooldown: 0.7,
    speed: 2.1,
    armor: 0,
    greed: 1.0,
    fear: 0.6,
    fleeAt: 0.4,
    spotChance: 0.5,
    disarmChance: 0.7,
    gold: 12,
    infamy: 1,
    maxLoots: 2,
    blurb: 'Fast and greedy. Spots and disarms traps. Runs away when hurt and tells the town what it saw.',
  },
  cleric: {
    name: 'Cleric',
    hp: 40,
    dmg: 3.5,
    cooldown: 1.2,
    speed: 1.45,
    armor: 0,
    greed: 0.4,
    fear: 1.0,
    fleeAt: 0.25,
    spotChance: 0,
    disarmChance: 0,
    heal: { amount: 7, interval: 2.2, radius: 2.6 },
    gold: 13,
    infamy: 1,
    maxLoots: 1,
    blurb: 'Heals nearby heroes. Cautious: routes around danger it knows about.',
  },
};

export const heroHpMul = (level: number) => 1 + 0.32 * (level - 1);
export const heroDmgMul = (level: number) => 1 + 0.2 * (level - 1);
export const heroRewardMul = (level: number) => 1 + 0.3 * (level - 1);

export const CHAMPION_NAMES = [
  'Sir Crunchless',
  'Dame Gristle',
  'Brother Unchewable',
  'Lady Toughbone',
  'Old Indigestion',
  'Sir Gravy the Bold',
  'Mother Heartburn',
  'Lord Leathery',
  'The Bitter Pill',
  'Captain Gristlebeard',
];

// ---------------------------------------------------------------- monsters

export interface MonsterDef {
  name: string;
  hp: number;
  dmg: number;
  cooldown: number;
  speed: number;
  leash: number;
  sticky?: boolean;
  ambushMul?: number;
}

export const MONSTERS: Record<MonsterKind, MonsterDef> = {
  goblin: { name: 'Goblin', hp: 22, dmg: 4.5, cooldown: 0.9, speed: 2.2, leash: 2 },
  slime: { name: 'Slime', hp: 42, dmg: 3, cooldown: 1.3, speed: 0.9, leash: 1, sticky: true },
  mimic: { name: 'Mimic', hp: 70, dmg: 10, cooldown: 1.4, speed: 0, leash: 0, ambushMul: 3 },
};

export const monsterHpMul = (level: number) => 1 + 0.45 * (level - 1);
export const monsterDmgMul = (level: number) => 1 + 0.38 * (level - 1);
export const trapDmgMul = (level: number) => 1 + 0.45 * (level - 1);

// ---------------------------------------------------------------- features

export interface FeatureDef {
  id: FeatureId;
  name: string;
  category: FeatureCategory;
  cost: number;
  unlockInfamy: number;
  hotkey: string;
  desc: string;
  synergy: string;
  upgradable: boolean;
  // lairs
  monster?: MonsterKind;
  count?: number;
  respawn?: number;
  // traps
  damage?: number;
  rearm?: number;
}

export const FEATURES: Record<FeatureId, FeatureDef> = {
  goblinDen: {
    id: 'goblinDen',
    name: 'Goblin Den',
    category: 'lair',
    cost: 40,
    unlockInfamy: 0,
    hotkey: '1',
    desc: 'Two goblins that charge heroes within 2 tiles. They come back after dying.',
    synergy: 'A Larder touching it makes goblins come back twice as fast and heal between fights.',
    upgradable: true,
    monster: 'goblin',
    count: 2,
    respawn: 10,
  },
  spikes: {
    id: 'spikes',
    name: 'Spikes',
    category: 'trap',
    cost: 30,
    unlockInfamy: 0,
    hotkey: '2',
    desc: 'Stabs a hero standing on it, then resets.',
    synergy: 'Double damage to Sticky heroes (hit by a Slime).',
    upgradable: true,
    damage: 14,
    rearm: 3.5,
  },
  hoard: {
    id: 'hoard',
    name: 'Hoard',
    category: 'room',
    cost: 45,
    unlockInfamy: 0,
    hotkey: '3',
    desc: 'Greedy heroes detour to loot it, standing still for 2s and stealing some Gold. Kill them to get it back.',
    synergy: 'Traps touching a Hoard reset twice as fast.',
    upgradable: false,
  },
  slimePit: {
    id: 'slimePit',
    name: 'Slime Pit',
    category: 'lair',
    cost: 55,
    unlockInfamy: 15,
    hotkey: '4',
    desc: 'A slow, tough slime. Its hits make heroes Sticky (half speed for 4s).',
    synergy: 'Sticky heroes take double damage from Spikes.',
    upgradable: true,
    monster: 'slime',
    count: 1,
    respawn: 14,
  },
  larder: {
    id: 'larder',
    name: 'Larder',
    category: 'room',
    cost: 60,
    unlockInfamy: 15,
    hotkey: '5',
    desc: 'Snacks for your staff.',
    synergy: 'Lairs touching it respawn twice as fast, and their monsters heal while idle.',
    upgradable: false,
  },
  oil: {
    id: 'oil',
    name: 'Oil Slick',
    category: 'trap',
    cost: 35,
    unlockInfamy: 45,
    hotkey: '6',
    desc: 'Coats a hero in oil: Oily heroes move at 60% speed for 8s.',
    synergy: 'A Fire Vent sets Oily heroes on fire for heavy burn damage.',
    upgradable: true,
    damage: 0,
    rearm: 3,
  },
  gloom: {
    id: 'gloom',
    name: 'Gloom',
    category: 'room',
    cost: 50,
    unlockInfamy: 45,
    hotkey: '7',
    desc: 'Thick darkness. Heroes crossing it move 30% slower.',
    synergy: 'Traps touching Gloom cannot be spotted or disarmed by Rogues.',
    upgradable: false,
  },
  fireVent: {
    id: 'fireVent',
    name: 'Fire Vent',
    category: 'trap',
    cost: 65,
    unlockInfamy: 90,
    hotkey: '8',
    desc: 'Erupts when a hero comes within 1 tile, scorching everyone around it.',
    synergy: 'Ignites Oily heroes: they burn for 4s.',
    upgradable: true,
    damage: 9,
    rearm: 6,
  },
  gullet: {
    id: 'gullet',
    name: 'Gullet',
    category: 'room',
    cost: 75,
    unlockInfamy: 90,
    hotkey: '9',
    desc: 'A drooling pit that digests the fallen on the spot.',
    synergy: 'Heroes killed on or touching a Gullet pay +50% Gold.',
    upgradable: false,
  },
  mimic: {
    id: 'mimic',
    name: 'Mimic',
    category: 'lair',
    cost: 90,
    unlockInfamy: 150,
    hotkey: '0',
    desc: 'Looks exactly like a Hoard to heroes. Bites for triple damage when they try to loot it.',
    synergy: 'Greedy heroes route straight to it, unless a survivor warned the town.',
    upgradable: true,
    monster: 'mimic',
    count: 1,
    respawn: 18,
  },
};

export const FEATURE_ORDER: FeatureId[] = [
  'goblinDen',
  'spikes',
  'hoard',
  'slimePit',
  'larder',
  'oil',
  'gloom',
  'fireVent',
  'gullet',
  'mimic',
];

// ---------------------------------------------------------------- prestige

export type UpgradeId =
  | 'deepPockets'
  | 'thickHide'
  | 'sharpFangs'
  | 'haggler'
  | 'gourmand'
  | 'dreadful'
  | 'lowProfile'
  | 'headStart';

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  desc: (level: number) => string;
  costs: number[];
}

export const UPGRADES: Record<UpgradeId, UpgradeDef> = {
  deepPockets: {
    id: 'deepPockets',
    name: 'Deep Pockets',
    desc: (l) => `Start each dungeon with +${100 * l} Gold.`,
    costs: [2, 4, 7],
  },
  thickHide: {
    id: 'thickHide',
    name: 'Thick Hide',
    desc: (l) => `The Maw has +${30 * l}% max HP.`,
    costs: [3, 6, 10],
  },
  sharpFangs: {
    id: 'sharpFangs',
    name: 'Sharp Fangs',
    desc: (l) => `The Maw's chomp deals +${40 * l}% damage.`,
    costs: [3, 6, 10],
  },
  haggler: {
    id: 'haggler',
    name: 'Cheap Labor',
    desc: (l) => `Building and upgrading cost ${10 * l}% less.`,
    costs: [4, 8, 12],
  },
  gourmand: {
    id: 'gourmand',
    name: 'Gourmand',
    desc: (l) => `+${20 * l}% Gold from eaten heroes.`,
    costs: [3, 6, 10],
  },
  dreadful: {
    id: 'dreadful',
    name: 'Dreadful Legend',
    desc: (l) => `+${25 * l}% Teeth when a dungeon collapses.`,
    costs: [5, 10],
  },
  lowProfile: {
    id: 'lowProfile',
    name: 'Low Profile',
    desc: (l) => `Hero parties grow stronger ${10 * l}% more slowly.`,
    costs: [4, 8, 14],
  },
  headStart: {
    id: 'headStart',
    name: 'Old Recipes',
    desc: () => 'Start with a Slime Pit and Spikes already built, and Slime Pit, Larder, Oil Slick and Gloom unlocked.',
    costs: [8],
  },
};

export const UPGRADE_ORDER: UpgradeId[] = [
  'deepPockets',
  'thickHide',
  'sharpFangs',
  'haggler',
  'gourmand',
  'dreadful',
  'lowProfile',
  'headStart',
];

/** Teeth earned when a dungeon collapses. */
export function teethForRun(peakInfamy: number, champions: number, mul = 1): number {
  return Math.floor((Math.sqrt(Math.max(0, peakInfamy)) * 0.6 + champions * 2) * mul);
}
