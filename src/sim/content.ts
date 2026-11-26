/**
 * Every tunable number and every piece of content lives here.
 * The simulation reads only from this file, so balance changes never touch logic.
 */

export type HeroClass = 'knight' | 'rogue' | 'cleric';
export type MonsterKind = 'goblin' | 'slime' | 'skeleton' | 'mimic' | 'troll' | 'spider';
export type RoomId =
  | 'goblinWarren'
  | 'spikeHall'
  | 'vault'
  | 'larder'
  | 'slimePit'
  | 'oilCellar'
  | 'flameGallery'
  | 'gloomHall'
  | 'boneCrypt'
  | 'gullet'
  | 'mimicVault'
  | 'trollDen'
  | 'spiderNest'
  | 'pitDrop'
  | 'soulWell';
export type RoomKind = 'monster' | 'trap' | 'lure' | 'support' | 'economy';

export interface Cost {
  gold: number;
  essence: number;
}

// ---------------------------------------------------------------- world

export const BALANCE = {
  dt: 0.05, // seconds per simulation tick (20 Hz)

  // Cave generation (tile units)
  caveW: 76,
  caveH: 50,
  siteSpacing: 10,
  roomW: 7,
  roomH: 5,
  mawW: 9,
  mawH: 7,
  maxCorridor: 21,
  regions: 5,

  startGold: 150,
  startEssence: 20,
  passiveGoldPerSec: 0.3,
  corridorCostPerTile: 2,
  sellRefund: 0.5,
  excavateCosts: [15, 30, 50, 75, 110, 150, 200],

  // Escalation. Minutes are run-time minutes.
  firstPartyAt: 25,
  partyIntervalStart: 24,
  partyIntervalPerMin: 0.32,
  partyIntervalMin: 10,
  partySizeBase: 1.3,
  partySizePerMin: 0.06,
  partySizePerMin2: 0.0006,
  partySizePerInfamy: 0.001,
  partySizeMax: 7,
  heroLevelPerMin: 0.1,
  heroLevelPerMin2: 0.0012,
  heroLevelPerInfamy: 0.0015,

  championEvery: 480,
  championLevelBonus: 2,
  championHpMul: 2.0,
  championDmgMul: 1.5,
  championRewardMul: 5,

  // Hero routing
  /** Seconds of walking a fear-1.0 hero would trade to avoid one point of danger. */
  fearScale: 2.5,
  unknownRoomFear: 3,
  dangerPerRank: 1,
  vaultAppeal: 12,
  detourWeight: 0.5,
  rogueSplitScore: 4,
  rumorSeconds: 240,
  peekChance: 0.5,
  disarmChance: 0.6,

  // Status effects
  stickySlow: 0.5,
  stickySeconds: 8,
  oilySeconds: 12,
  burnSeconds: 4,
  burnDps: 8,

  // The Maw
  mawHp: 260,
  mawRegen: 0.8,
  mawChomp: 14,
  mawChompCooldown: 1.3,
  mawUpgradeBase: 70,
  mawUpgradeGrowth: 1.55,
  mawUpgradeMax: 10,
  mawHpPerLevel: 0.22,
  mawChompPerLevel: 0.3,
  biteDamageMul: 1.0,
  biteStealFraction: 0.025,
  bitesBeforeFlee: 3,

  // Looting
  lootSeconds: 2.5,
  lootStealFraction: 0.06,
  lootStealCapBase: 12,
  lootStealCapPerLevel: 6,

  // Rewards
  essenceBase: 1,
  essencePerLevel: 0.6,
  partyWipeInfamyPerHero: 1,

  // Offline
  offlineCapSeconds: 2 * 3600,
  offlineEfficiency: 0.25,

  // Infamy needed for each catalog tier
  tierInfamy: [0, 30, 90, 160],
} as const;

// ---------------------------------------------------------------- heroes

export interface HeroDef {
  name: string;
  hp: number;
  dmg: number;
  cooldown: number;
  speed: number; // tiles per second
  armor: number;
  greed: number;
  fear: number;
  fleeAt: number;
  heal?: { amount: number; interval: number };
  gold: number;
  infamy: number;
  blurb: string;
}

export const HEROES: Record<HeroClass, HeroDef> = {
  knight: {
    name: 'Knight',
    hp: 70,
    dmg: 7,
    cooldown: 1.1,
    speed: 1.7,
    armor: 2,
    greed: 0.1,
    fear: 0.15,
    fleeAt: 0,
    gold: 15,
    infamy: 1,
    blurb: 'Slow and armored. Barely afraid of anything. Monsters attack the Knight first.',
  },
  rogue: {
    name: 'Rogue',
    hp: 36,
    dmg: 6,
    cooldown: 0.7,
    speed: 2.6,
    armor: 0,
    greed: 1.0,
    fear: 0.6,
    fleeAt: 0.4,
    gold: 12,
    infamy: 1,
    blurb: 'Greedy. Peeks into nearby rooms, disarms traps it knows about, slips away to raid Vaults, and runs when hurt.',
  },
  cleric: {
    name: 'Cleric',
    hp: 40,
    dmg: 3.5,
    cooldown: 1.2,
    speed: 1.9,
    armor: 0,
    greed: 0.3,
    fear: 1.0,
    fleeAt: 0.25,
    heal: { amount: 7, interval: 2.2 },
    gold: 13,
    infamy: 1,
    blurb: 'Heals the party. Cautious: steers the party around rooms it has heard about.',
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
}

export const MONSTERS: Record<MonsterKind, MonsterDef> = {
  goblin: { name: 'Goblin', hp: 22, dmg: 4.5, cooldown: 0.9 },
  slime: { name: 'Slime', hp: 45, dmg: 3, cooldown: 1.3 },
  skeleton: { name: 'Skeleton', hp: 30, dmg: 5, cooldown: 1.0 },
  mimic: { name: 'Mimic', hp: 90, dmg: 11, cooldown: 1.4 },
  troll: { name: 'Troll', hp: 260, dmg: 12, cooldown: 1.6 },
  spider: { name: 'Spider', hp: 26, dmg: 4, cooldown: 0.8 },
};

// ---------------------------------------------------------------- rooms

export interface TrackDef {
  name: string;
  desc: (rank: number) => string;
}

export interface RoomDef {
  id: RoomId;
  name: string;
  kind: RoomKind;
  /** Index into BALANCE.tierInfamy. */
  tier: number;
  /** Bought with Teeth before it appears in the catalog. */
  blueprint?: boolean;
  cost: Cost;
  blurb: string;
  synergy: string;
  tracks: [TrackDef, TrackDef, TrackDef];
  /** How scary heroes think this room is once they know about it. */
  danger: number;
  monster?: MonsterKind;
  count?: number;
  respawn?: number;
}

const pct = (n: number) => `${Math.round(n)}%`;

export const ROOMS: Record<RoomId, RoomDef> = {
  goblinWarren: {
    id: 'goblinWarren',
    name: 'Goblin Warren',
    kind: 'monster',
    tier: 0,
    cost: { gold: 50, essence: 5 },
    blurb: 'A pack of three goblins. Heroes must beat them to get through. They come back after dying.',
    synergy: 'A linked Larder makes them come back faster and hit harder.',
    danger: 6,
    monster: 'goblin',
    count: 3,
    respawn: 9,
    tracks: [
      { name: 'Numbers', desc: (r) => `+${r} goblin${r > 1 ? 's' : ''}` },
      { name: 'Spears', desc: (r) => `+${pct(30 * r)} goblin damage` },
      { name: 'Shaman', desc: (r) => `Goblins heal ${2 * r} HP/s in fights` },
    ],
  },
  spikeHall: {
    id: 'spikeHall',
    name: 'Spike Hall',
    kind: 'trap',
    tier: 0,
    cost: { gold: 40, essence: 0 },
    blurb: 'Spikes stab a hero every 1.5s while the party crosses.',
    synergy: 'Double damage to Sticky heroes (from Slime or Spiders).',
    danger: 5,
    tracks: [
      { name: 'Sharper', desc: (r) => `+${pct(40 * r)} damage` },
      { name: 'Quicker', desc: (r) => `Stabs ${pct(20 * r)} more often` },
      { name: 'Barbed', desc: (r) => `Stabbed heroes bleed ${r + 1} HP/s for 4s` },
    ],
  },
  vault: {
    id: 'vault',
    name: 'Treasure Vault',
    kind: 'lure',
    tier: 0,
    cost: { gold: 45, essence: 0 },
    blurb: 'Heroes can see the glitter. Greedy parties detour to loot it, and Rogues sneak off to raid it alone. Looting takes 2.5s and steals Gold; kill the thief to get it back.',
    synergy: 'Put traps and monsters on the way in and out.',
    danger: 0,
    tracks: [
      { name: 'Bigger Pile', desc: (r) => `Lures heroes from ${pct(35 * r)} farther away` },
      { name: 'Heavy Locks', desc: (r) => `Looting takes ${1.5 * r}s longer` },
      { name: 'Cursed Coins', desc: (r) => `Looters are slowed and lose ${2 * r} HP/s for 6s` },
    ],
  },
  larder: {
    id: 'larder',
    name: 'Larder',
    kind: 'support',
    tier: 0,
    cost: { gold: 60, essence: 0 },
    blurb: 'Snacks for your staff.',
    synergy: 'Monster rooms linked to it by a corridor respawn twice as fast and heal between fights.',
    danger: 0,
    tracks: [
      { name: 'Fast Food', desc: (r) => `Linked lairs respawn ${(2 + 0.5 * r).toFixed(1)}× as fast` },
      { name: 'Hearty', desc: (r) => `Linked monsters get +${pct(15 * r)} HP` },
      { name: 'Spicy', desc: (r) => `Linked monsters deal +${pct(12 * r)} damage` },
    ],
  },
  slimePit: {
    id: 'slimePit',
    name: 'Slime Pit',
    kind: 'monster',
    tier: 1,
    cost: { gold: 60, essence: 10 },
    blurb: 'Two tough, slow slimes. Their hits make heroes Sticky: half speed for 8s.',
    synergy: 'Sticky heroes take double damage in a Spike Hall. Put one right after it.',
    danger: 5,
    monster: 'slime',
    count: 2,
    respawn: 12,
    tracks: [
      { name: 'Bigger Slimes', desc: (r) => `+${pct(35 * r)} slime HP` },
      { name: 'Stickier', desc: (r) => `Sticky lasts ${4 * r}s longer` },
      { name: 'Acid', desc: (r) => `Hits burn for ${2 * r} HP/s for 4s` },
    ],
  },
  oilCellar: {
    id: 'oilCellar',
    name: 'Oil Cellar',
    kind: 'trap',
    tier: 1,
    cost: { gold: 45, essence: 0 },
    blurb: 'Slick floors. Everyone who crosses becomes Oily for 12s, and crossing takes 40% longer.',
    synergy: 'A Flame Gallery sets Oily heroes on fire.',
    danger: 2,
    tracks: [
      { name: 'Slicker', desc: (r) => `Oily lasts ${4 * r}s longer` },
      { name: 'Deeper', desc: (r) => `Crossing takes ${pct(25 * r)} longer still` },
      { name: 'Fumes', desc: (r) => `Oily heroes lose ${r} HP/s` },
    ],
  },
  flameGallery: {
    id: 'flameGallery',
    name: 'Flame Gallery',
    kind: 'trap',
    tier: 1,
    cost: { gold: 70, essence: 0 },
    blurb: 'Fire vents burst every 2.2s, scorching the whole party.',
    synergy: 'Oily heroes catch fire and burn for 4s.',
    danger: 6,
    tracks: [
      { name: 'Hotter', desc: (r) => `+${pct(35 * r)} burst damage` },
      { name: 'Bellows', desc: (r) => `Bursts ${pct(18 * r)} more often` },
      { name: 'Lasting Flames', desc: (r) => `Burns last ${2 * r}s longer and hurt ${pct(20 * r)} more` },
    ],
  },
  gloomHall: {
    id: 'gloomHall',
    name: 'Gloom Hall',
    kind: 'support',
    tier: 1,
    cost: { gold: 60, essence: 0 },
    blurb: 'Thick darkness. Crossing it takes 40% longer.',
    synergy: 'Trap rooms linked to it cannot be spotted or disarmed by Rogues.',
    danger: 1,
    tracks: [
      { name: 'Darker', desc: (r) => `Heroes in linked rooms move ${pct(10 * r)} slower` },
      { name: 'Silence', desc: (r) => `${pct(33 * r)} chance survivors forget linked rooms` },
      { name: 'Dread', desc: (r) => `Heroes in linked rooms deal ${pct(10 * r)} less damage` },
    ],
  },
  boneCrypt: {
    id: 'boneCrypt',
    name: 'Bone Crypt',
    kind: 'monster',
    tier: 2,
    cost: { gold: 90, essence: 25 },
    blurb: 'Three skeletons. Each one pulls itself back together once, 3s after falling.',
    synergy: 'A linked Larder works here too. Skeletons are not picky eaters.',
    danger: 7,
    monster: 'skeleton',
    count: 3,
    respawn: 14,
    tracks: [
      { name: 'Legion', desc: (r) => `+${r} skeleton${r > 1 ? 's' : ''}` },
      { name: 'Bone Armor', desc: (r) => `Skeletons ignore ${r * 1.5} damage per hit` },
      { name: 'Deathless', desc: (r) => `Reassemble with ${50 + 15 * r}% HP` },
    ],
  },
  gullet: {
    id: 'gullet',
    name: 'Gullet',
    kind: 'economy',
    tier: 2,
    cost: { gold: 80, essence: 15 },
    blurb: 'A drooling stomach in the floor.',
    synergy: 'Heroes who die in the Gullet or in a room linked to it pay +50% Gold and Essence.',
    danger: 2,
    tracks: [
      { name: 'Bigger Stomach', desc: (r) => `+${pct(15 * r)} more Gold` },
      { name: 'Soul Juice', desc: (r) => `+${pct(25 * r)} more Essence` },
      { name: 'Acid Floor', desc: (r) => `Heroes crossing lose ${3 * r} HP/s` },
    ],
  },
  mimicVault: {
    id: 'mimicVault',
    name: 'Mimic Vault',
    kind: 'monster',
    tier: 3,
    cost: { gold: 100, essence: 30 },
    blurb: 'Looks exactly like a Treasure Vault. The chest bites for triple damage, then fights.',
    synergy: 'Greedy heroes walk right in, unless a survivor warned the town.',
    danger: 8,
    monster: 'mimic',
    count: 1,
    respawn: 18,
    tracks: [
      { name: 'Bigger Bite', desc: (r) => `+${pct(30 * r)} damage` },
      { name: 'Perfect Disguise', desc: (r) => `${pct(33 * r)} chance survivors still think it is treasure` },
      { name: 'Gorge', desc: (r) => `Heals ${pct(25 * r)} HP when it eats a hero` },
    ],
  },
  trollDen: {
    id: 'trollDen',
    name: 'Troll Den',
    kind: 'monster',
    tier: 3,
    cost: { gold: 140, essence: 45 },
    blurb: 'One huge troll that regenerates 4 HP/s and swings at two heroes at once. Parties get stuck here.',
    synergy: 'Holds parties in place: link a Gloom Hall or put traps on both sides.',
    danger: 10,
    monster: 'troll',
    count: 1,
    respawn: 25,
    tracks: [
      { name: 'Thick Hide', desc: (r) => `+${pct(30 * r)} HP` },
      { name: 'Regeneration', desc: (r) => `+${3 * r} HP/s healing` },
      { name: 'Big Club', desc: (r) => `Each swing hits ${2 + r} heroes` },
    ],
  },
  spiderNest: {
    id: 'spiderNest',
    name: 'Spider Nest',
    kind: 'monster',
    tier: 1,
    blueprint: true,
    cost: { gold: 80, essence: 20 },
    blurb: 'Three spiders. Bites poison (2 HP/s) and webs make heroes Sticky.',
    synergy: 'Sticky heroes take double damage in a Spike Hall.',
    danger: 6,
    monster: 'spider',
    count: 3,
    respawn: 11,
    tracks: [
      { name: 'Brood', desc: (r) => `+${r} spider${r > 1 ? 's' : ''}` },
      { name: 'Venom', desc: (r) => `Poison +${2 * r} HP/s` },
      { name: 'Thick Webs', desc: (r) => `Crossing takes ${pct(25 * r)} longer` },
    ],
  },
  pitDrop: {
    id: 'pitDrop',
    name: 'Pit Drop',
    kind: 'trap',
    tier: 2,
    blueprint: true,
    cost: { gold: 90, essence: 15 },
    blurb: 'Each hero crossing has a 20% chance to fall in, taking 25 damage.',
    synergy: 'Linked to a Gullet, the pit drops heroes straight into it: instantly eaten (not Champions).',
    danger: 6,
    tracks: [
      { name: 'Deeper', desc: (r) => `+${pct(10 * r)} fall chance` },
      { name: 'Spiked Bottom', desc: (r) => `+${15 * r} fall damage` },
      { name: 'Greased Edge', desc: (r) => `+${pct(15 * r)} fall chance for Oily or Sticky heroes` },
    ],
  },
  soulWell: {
    id: 'soulWell',
    name: 'Soul Well',
    kind: 'economy',
    tier: 0,
    blueprint: true,
    cost: { gold: 100, essence: 0 },
    blurb: 'Draws up 0.2 Essence per second.',
    synergy: 'Every hero who dies in a linked room adds 2 more Essence.',
    danger: 0,
    tracks: [
      { name: 'Deeper Well', desc: (r) => `+${(0.15 * r).toFixed(2)} Essence/s` },
      { name: 'Soul Hooks', desc: (r) => `+${2 * r} Essence per linked death` },
      { name: 'Haunting', desc: (r) => `Heroes crossing lose ${2 * r} HP/s` },
    ],
  },
};

export const ROOM_ORDER: RoomId[] = [
  'goblinWarren',
  'spikeHall',
  'vault',
  'larder',
  'soulWell',
  'slimePit',
  'oilCellar',
  'flameGallery',
  'gloomHall',
  'spiderNest',
  'boneCrypt',
  'gullet',
  'pitDrop',
  'mimicVault',
  'trollDen',
];

/** Price of buying rank `rank` (1-3) in one of a room's tracks. Rank 3 needs Essence. */
export function trackCost(room: RoomId, rank: number): Cost {
  const def = ROOMS[room];
  const mul = [0.6, 1.1, 1.6][rank - 1] ?? 2;
  return { gold: Math.round(def.cost.gold * mul), essence: rank === 3 ? 15 + 10 * def.tier : 0 };
}

// ---------------------------------------------------------------- prestige

export type UpgradeId =
  | 'deepPockets'
  | 'thickHide'
  | 'sharpFangs'
  | 'haggler'
  | 'gourmand'
  | 'dreadful'
  | 'lowProfile'
  | 'headStart'
  | 'bpSpiderNest'
  | 'bpPitDrop'
  | 'bpSoulWell';

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  desc: (level: number) => string;
  costs: number[];
  blueprint?: RoomId;
}

export const UPGRADES: Record<UpgradeId, UpgradeDef> = {
  deepPockets: { id: 'deepPockets', name: 'Deep Pockets', desc: (l) => `Start each dungeon with +${100 * l} Gold.`, costs: [2, 4, 7] },
  thickHide: { id: 'thickHide', name: 'Thick Hide', desc: (l) => `The Maw has +${30 * l}% max HP.`, costs: [3, 6, 10] },
  sharpFangs: { id: 'sharpFangs', name: 'Sharp Fangs', desc: (l) => `The Maw's chomp deals +${40 * l}% damage.`, costs: [3, 6, 10] },
  haggler: { id: 'haggler', name: 'Cheap Labor', desc: (l) => `Rooms, corridors and upgrades cost ${10 * l}% less Gold.`, costs: [4, 8, 12] },
  gourmand: { id: 'gourmand', name: 'Gourmand', desc: (l) => `+${20 * l}% Gold and Essence from eaten heroes.`, costs: [3, 6, 10] },
  dreadful: { id: 'dreadful', name: 'Dreadful Legend', desc: (l) => `+${25 * l}% Teeth when a dungeon collapses.`, costs: [5, 10] },
  lowProfile: { id: 'lowProfile', name: 'Low Profile', desc: (l) => `Hero parties grow stronger ${10 * l}% more slowly.`, costs: [4, 8, 14] },
  headStart: {
    id: 'headStart',
    name: 'Old Recipes',
    desc: () => 'Start with a Goblin Warren and a Spike Hall on your route, and the second catalog tier unlocked.',
    costs: [8],
  },
  bpSoulWell: { id: 'bpSoulWell', name: 'Blueprint: Soul Well', desc: () => 'Adds the Soul Well to your catalog. It draws up Essence.', costs: [5], blueprint: 'soulWell' },
  bpSpiderNest: { id: 'bpSpiderNest', name: 'Blueprint: Spider Nest', desc: () => 'Adds the Spider Nest to your catalog (second tier). Webs and poison.', costs: [7], blueprint: 'spiderNest' },
  bpPitDrop: { id: 'bpPitDrop', name: 'Blueprint: Pit Drop', desc: () => 'Adds the Pit Drop to your catalog (third tier). Feeds heroes straight to a Gullet.', costs: [10], blueprint: 'pitDrop' },
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

export const BLUEPRINT_ORDER: UpgradeId[] = ['bpSoulWell', 'bpSpiderNest', 'bpPitDrop'];

/** Teeth earned when a dungeon collapses. */
export function teethForRun(peakInfamy: number, champions: number, mul = 1): number {
  return Math.floor((Math.sqrt(Math.max(0, peakInfamy)) * 0.6 + champions * 2) * mul);
}
