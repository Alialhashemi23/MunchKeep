import {
  BALANCE,
  CHAMPION_NAMES,
  FEATURES,
  FEATURE_ORDER,
  HEROES,
  MONSTERS,
  heroDmgMul,
  heroHpMul,
  heroRewardMul,
  monsterDmgMul,
  monsterHpMul,
  trapDmgMul,
  type FeatureId,
  type HeroClass,
  type MonsterKind,
} from './content';
import { Grid, type Feature } from './grid';
import { metaMods, type MetaMods, type MetaState } from './meta';
import { dijkstra, pathTo, type DistanceField } from './pathfinding';
import { Rng } from './rng';

// ---------------------------------------------------------------- entity types

export type HeroGoal = 'loot' | 'maw' | 'flee';
export type HeroState = 'walk' | 'fight' | 'loot' | 'bite' | 'dead' | 'escaped';

export interface Hero {
  id: number;
  cls: HeroClass;
  level: number;
  partyId: number;
  champion: string | null;
  hp: number;
  maxHp: number;
  dmg: number;
  cooldown: number;
  speed: number;
  armor: number;
  x: number;
  y: number;
  px: number;
  py: number;
  /** Last tile center the hero reached. */
  tile: number;
  path: number[];
  pathIdx: number;
  target: number;
  goal: HeroGoal;
  state: HeroState;
  planVersion: string;
  atk: number;
  lootT: number;
  healT: number;
  loot: number;
  looted: number[];
  lootsLeft: number;
  bites: number;
  sticky: number;
  oily: number;
  burning: number;
  burnDps: number;
  burnAcc: number;
  spotRolled: number[];
  disarmTried: number[];
  facing: 1 | -1;
  lastHitAt: number;
  lastAttackAt: number;
}

export interface Monster {
  id: number;
  kind: MonsterKind;
  lair: number;
  slot: number;
  level: number;
  hp: number;
  maxHp: number;
  dmg: number;
  cooldown: number;
  speed: number;
  x: number;
  y: number;
  px: number;
  py: number;
  homeX: number;
  homeY: number;
  atk: number;
  targetId: number | null;
  ambush: boolean;
  idleT: number;
  facing: 1 | -1;
  lastHitAt: number;
  lastAttackAt: number;
}

export interface Party {
  id: number;
  known: Map<number, FeatureId>;
  version: number;
  size: number;
  died: number;
  escaped: number;
  done: boolean;
}

export interface Rumor {
  feature: FeatureId;
  until: number;
}

export type SimEvent =
  | { t: 'damage'; x: number; y: number; amount: number; on: 'hero' | 'monster'; id: number; crit?: boolean; burn?: boolean }
  | { t: 'heroDied'; x: number; y: number; gold: number; infamy: number; cls: HeroClass; champion: string | null; gullet: boolean }
  | { t: 'monsterDied'; x: number; y: number; kind: MonsterKind }
  | { t: 'trap'; tile: number; feature: FeatureId; crit?: boolean }
  | { t: 'ignite'; x: number; y: number }
  | { t: 'status'; x: number; y: number; status: 'sticky' | 'oily' }
  | { t: 'disarm'; tile: number }
  | { t: 'spotted'; tile: number }
  | { t: 'loot'; x: number; y: number; amount: number }
  | { t: 'bite'; amount: number; stolen: number }
  | { t: 'chomp'; heroId: number }
  | { t: 'escaped'; cls: HeroClass; loot: number; rumors: number }
  | { t: 'party'; size: number; level: number; champion: string | null }
  | { t: 'heal'; x: number; y: number; amount: number }
  | { t: 'unlock'; feature: FeatureId }
  | { t: 'respawn'; tile: number; kind: MonsterKind }
  | { t: 'wipe'; size: number; infamy: number }
  | { t: 'ambush'; tile: number }
  | { t: 'collapse' };

export type ActionResult = { ok: true } | { ok: false; reason: string };

const OK: ActionResult = { ok: true };
const fail = (reason: string): ActionResult => ({ ok: false, reason });

// ---------------------------------------------------------------- save shape

export interface RunSave {
  seed: number;
  rng: number;
  time: number;
  gold: number;
  infamy: number;
  eaten: number;
  escaped: number;
  champions: number;
  goldFromKills: number;
  mawHp: number;
  mawLevel: number;
  kinds: string;
  features: { i: number; id: FeatureId; level: number; invested: number }[];
  rumors: { i: number; feature: FeatureId; until: number }[];
  nextPartyIn: number;
  nextChampionAt: number;
  partyCount: number;
  unlocked: FeatureId[];
}

// ---------------------------------------------------------------- the simulation

/**
 * The whole game world, advanced in fixed ticks of BALANCE.dt seconds.
 * Pure TypeScript: rendering, audio and tests all read the same state.
 */
export class Sim {
  readonly rng: Rng;
  readonly seed: number;
  readonly grid: Grid;
  readonly mods: MetaMods;

  time = 0;
  gold: number;
  infamy = 0;
  eaten = 0;
  escaped = 0;
  champions = 0;
  goldFromKills = 0;
  mawHp: number;
  mawLevel = 1;
  mawChompT = 0;
  mawLastHitAt = -10;
  mawLastChompAt = -10;
  collapsed = false;

  heroes: Hero[] = [];
  monsters: Monster[] = [];
  parties = new Map<number, Party>();
  rumors = new Map<number, Rumor>();
  unlocked = new Set<FeatureId>();
  events: SimEvent[] = [];

  nextPartyIn: number = BALANCE.firstPartyAt;
  nextChampionAt: number = BALANCE.championEvery;
  partyCount = 0;

  private pending: { hero: Hero; delay: number }[] = [];
  private nextId = 1;
  private leashCache = new Map<number, Set<number>>();
  private dangerCache: Float32Array | null = null;
  private cacheVersion = -1;
  private rumorCheckT = 0;

  constructor(meta: MetaState, seed: number, save?: RunSave) {
    this.mods = metaMods(meta);
    this.seed = seed;
    this.rng = new Rng(save ? save.rng : seed);
    if (save) {
      const { gridW, gridH, entrance, maw } = BALANCE;
      this.grid = Grid.decode(gridW, gridH, entrance.y * gridW + entrance.x, maw.y * gridW + maw.x, save.kinds);
      this.time = save.time;
      this.gold = save.gold;
      this.infamy = save.infamy;
      this.eaten = save.eaten;
      this.escaped = save.escaped;
      this.champions = save.champions;
      this.goldFromKills = save.goldFromKills;
      this.mawLevel = save.mawLevel;
      this.mawHp = Math.min(save.mawHp, this.mawMaxHp);
      this.nextPartyIn = Math.max(8, save.nextPartyIn);
      this.nextChampionAt = Math.max(save.nextChampionAt, this.time + 30);
      this.partyCount = save.partyCount;
      for (const f of save.unlocked) this.unlocked.add(f);
      for (const r of save.rumors) this.rumors.set(r.i, { feature: r.feature, until: r.until });
      for (const f of save.features) {
        this.grid.features[f.i] = this.makeFeature(f.id, f.level, f.invested);
        this.spawnLairMonsters(f.i);
      }
    } else {
      this.grid = Grid.createStarter(this.rng);
      this.gold = BALANCE.startGold + this.mods.startGold;
      this.mawHp = this.mawMaxHp;
      if (this.mods.headStart) {
        const g = this.grid;
        for (const [x, y, id] of [
          [7, 9, 'slimePit'],
          [7, 10, 'spikes'],
        ] as [number, number, FeatureId][]) {
          const t = g.idx(x, y);
          g.features[t] = this.makeFeature(id, 1, FEATURES[id].cost);
          this.spawnLairMonsters(t);
        }
        g.touch();
      }
    }
    if (this.mods.headStart) for (const f of ['slimePit', 'larder', 'oil', 'gloom'] as FeatureId[]) this.unlocked.add(f);
    for (const f of FEATURE_ORDER) if (FEATURES[f].unlockInfamy <= this.infamy) this.unlocked.add(f);
  }

  // ------------------------------------------------------------ derived numbers

  get minutes(): number {
    return this.time / 60;
  }
  get mawMaxHp(): number {
    return Math.round(BALANCE.mawHp * (1 + BALANCE.mawHpPerLevel * (this.mawLevel - 1)) * this.mods.mawHpMul);
  }
  get mawChompDamage(): number {
    return BALANCE.mawChomp * (1 + BALANCE.mawChompPerLevel * (this.mawLevel - 1)) * this.mods.chompMul;
  }
  get partyInterval(): number {
    return Math.max(BALANCE.partyIntervalMin, BALANCE.partyIntervalStart - BALANCE.partyIntervalPerMin * this.minutes);
  }
  get digCost(): number {
    return Math.max(1, Math.round(BALANCE.digCost * this.mods.costMul));
  }
  get fillCost(): number {
    return Math.max(1, Math.round(BALANCE.fillCost * this.mods.costMul));
  }
  featureCost(id: FeatureId): number {
    return Math.round(FEATURES[id].cost * this.mods.costMul);
  }
  upgradeCost(tile: number): number | null {
    const f = this.grid.features[tile];
    if (!f || !FEATURES[f.id].upgradable || f.level >= BALANCE.featureMaxLevel) return null;
    return Math.round(FEATURES[f.id].cost * BALANCE.upgradeBaseFactor * BALANCE.upgradeGrowth ** (f.level - 1) * this.mods.costMul);
  }
  mawUpgradeCost(): number | null {
    if (this.mawLevel >= BALANCE.mawUpgradeMax) return null;
    return Math.round(BALANCE.mawUpgradeBase * BALANCE.mawUpgradeGrowth ** (this.mawLevel - 1) * this.mods.costMul);
  }
  /** Infamy needed for the next locked feature, or null when all are unlocked. */
  nextUnlock(): { feature: FeatureId; infamy: number } | null {
    for (const f of FEATURE_ORDER)
      if (!this.unlocked.has(f)) return { feature: f, infamy: FEATURES[f].unlockInfamy };
    return null;
  }
  get livingHeroes(): number {
    return this.heroes.length + this.pending.length;
  }

  // ------------------------------------------------------------ player actions

  canDig(i: number): ActionResult {
    const g = this.grid;
    if (i < 0 || i >= g.kinds.length) return fail('Off the map');
    if (g.kinds[i] === 'bedrock') return fail('Bedrock is too hard to dig');
    if (g.kinds[i] !== 'rock') return fail('Already dug');
    if (!g.neighbors4(i).some((n) => g.isWalkable(n))) return fail('Must touch the dungeon');
    if (this.gold < this.digCost) return fail('Not enough Gold');
    return OK;
  }

  dig(i: number): ActionResult {
    const r = this.canDig(i);
    if (!r.ok) return r;
    this.gold -= this.digCost;
    this.grid.kinds[i] = 'floor';
    this.grid.touch();
    return OK;
  }

  canFill(i: number): ActionResult {
    const g = this.grid;
    if (i < 0 || i >= g.kinds.length) return fail('Off the map');
    if (g.kinds[i] !== 'floor') return fail('Only empty tunnel can be filled');
    if (g.features[i]) return fail('Remove what is built there first');
    if (this.occupied(i)) return fail('Something is standing there');
    if (!g.isConnected(i)) return fail('That would block the only way to the Maw');
    if (this.gold < this.fillCost) return fail('Not enough Gold');
    return OK;
  }

  fill(i: number): ActionResult {
    const r = this.canFill(i);
    if (!r.ok) return r;
    this.gold -= this.fillCost;
    this.grid.kinds[i] = 'rock';
    this.grid.touch();
    return OK;
  }

  canPlace(i: number, id: FeatureId): ActionResult {
    const g = this.grid;
    if (i < 0 || i >= g.kinds.length) return fail('Off the map');
    if (!this.unlocked.has(id)) return fail(`Unlocks at ${FEATURES[id].unlockInfamy} Infamy`);
    if (g.kinds[i] !== 'floor') return fail(g.kinds[i] === 'rock' ? 'Dig here first' : 'Cannot build here');
    if (g.features[i]) return fail('Something is already built here');
    if (this.gold < this.featureCost(id)) return fail('Not enough Gold');
    return OK;
  }

  place(i: number, id: FeatureId): ActionResult {
    const r = this.canPlace(i, id);
    if (!r.ok) return r;
    const cost = this.featureCost(id);
    this.gold -= cost;
    this.grid.features[i] = this.makeFeature(id, 1, cost);
    this.spawnLairMonsters(i);
    this.grid.touch();
    return OK;
  }

  canDemolish(i: number): ActionResult {
    if (!this.grid.features[i]) return fail('Nothing to remove');
    return OK;
  }

  demolish(i: number): ActionResult {
    const f = this.grid.features[i];
    if (!f) return fail('Nothing to remove');
    this.gold += Math.floor(f.invested * BALANCE.demolishRefund);
    this.monsters = this.monsters.filter((m) => m.lair !== i);
    this.grid.features[i] = null;
    this.grid.touch();
    return OK;
  }

  upgrade(i: number): ActionResult {
    const f = this.grid.features[i];
    if (!f) return fail('Nothing to upgrade');
    const cost = this.upgradeCost(i);
    if (cost === null) return fail(FEATURES[f.id].upgradable ? 'Already at max level' : 'Rooms cannot be upgraded');
    if (this.gold < cost) return fail('Not enough Gold');
    this.gold -= cost;
    f.level++;
    f.invested += cost;
    for (const m of this.monsters) {
      if (m.lair !== i) continue;
      const def = MONSTERS[m.kind];
      m.level = f.level;
      m.maxHp = def.hp * monsterHpMul(f.level);
      m.hp = m.maxHp;
      m.dmg = def.dmg * monsterDmgMul(f.level);
    }
    return OK;
  }

  upgradeMaw(): ActionResult {
    const cost = this.mawUpgradeCost();
    if (cost === null) return fail('The Maw is fully grown');
    if (this.gold < cost) return fail('Not enough Gold');
    const before = this.mawMaxHp;
    this.gold -= cost;
    this.mawLevel++;
    this.mawHp = Math.min(this.mawMaxHp, this.mawHp + (this.mawMaxHp - before));
    return OK;
  }

  private occupied(i: number): boolean {
    const g = this.grid;
    return (
      this.heroes.some((h) => g.tileAt(h.x, h.y) === i || h.tile === i) ||
      this.monsters.some((m) => g.tileAt(m.x, m.y) === i)
    );
  }

  private makeFeature(id: FeatureId, level: number, invested: number): Feature {
    const def = FEATURES[id];
    const slots = def.category === 'lair' ? Array.from({ length: def.count ?? 1 }, () => ({ monsterId: null, respawn: 0 })) : [];
    return { id, level, invested, rearm: 0, slots };
  }

  private spawnLairMonsters(tile: number): void {
    const f = this.grid.features[tile];
    if (!f || FEATURES[f.id].category !== 'lair') return;
    f.slots.forEach((slot, s) => {
      if (slot.monsterId === null) this.spawnMonster(tile, f, s);
    });
  }

  private spawnMonster(tile: number, f: Feature, slot: number): Monster {
    const kind = FEATURES[f.id].monster!;
    const def = MONSTERS[kind];
    const g = this.grid;
    const count = f.slots.length;
    const offset = count > 1 ? (slot === 0 ? -0.22 : 0.22) : 0;
    const m: Monster = {
      id: this.nextId++,
      kind,
      lair: tile,
      slot,
      level: f.level,
      hp: def.hp * monsterHpMul(f.level),
      maxHp: def.hp * monsterHpMul(f.level),
      dmg: def.dmg * monsterDmgMul(f.level),
      cooldown: def.cooldown,
      speed: def.speed,
      x: g.x(tile) + offset,
      y: g.y(tile) - offset,
      px: g.x(tile) + offset,
      py: g.y(tile) - offset,
      homeX: g.x(tile) + offset,
      homeY: g.y(tile) - offset,
      atk: 0,
      targetId: null,
      ambush: true,
      idleT: 0,
      facing: 1,
      lastHitAt: -10,
      lastAttackAt: -10,
    };
    f.slots[slot].monsterId = m.id;
    this.monsters.push(m);
    return m;
  }

  // ------------------------------------------------------------ tick

  tick(): void {
    if (this.collapsed) return;
    const dt = BALANCE.dt;
    this.time += dt;
    if (this.events.length > 4000) this.events.splice(0, this.events.length - 2000);

    for (const h of this.heroes) {
      h.px = h.x;
      h.py = h.y;
    }
    for (const m of this.monsters) {
      m.px = m.x;
      m.py = m.y;
    }

    this.gold += BALANCE.passiveGoldPerSec * dt;
    this.refreshCaches();
    this.tickSpawning(dt);
    this.tickFeatures(dt);
    this.tickHeroes(dt);
    this.tickMonsters(dt);
    this.tickTraps();
    this.tickMaw(dt);
    this.cleanup();
    this.tickRumors(dt);
    this.checkUnlocks();

    if (this.mawHp <= 0) {
      this.mawHp = 0;
      this.collapsed = true;
      this.events.push({ t: 'collapse' });
    }
  }

  private refreshCaches(): void {
    if (this.cacheVersion === this.grid.version) return;
    this.cacheVersion = this.grid.version;
    this.leashCache.clear();
    const g = this.grid;
    const danger = new Float32Array(g.w * g.h);
    for (const t of g.featureTiles()) {
      const f = g.features[t]!;
      if (f.id !== 'goblinDen' && f.id !== 'slimePit') continue;
      danger[t] += BALANCE.lairFear;
      for (const n of g.neighbors8(t)) danger[n] += BALANCE.lairNearFear;
    }
    this.dangerCache = danger;
  }

  private leashArea(lair: number, kind: MonsterKind): Set<number> {
    let a = this.leashCache.get(lair);
    if (!a) {
      a = this.grid.area(lair, MONSTERS[kind].leash);
      this.leashCache.set(lair, a);
    }
    return a;
  }

  // ------------------------------------------------------------ parties

  private tickSpawning(dt: number): void {
    this.nextPartyIn -= dt;
    if (this.nextPartyIn <= 0) {
      this.spawnParty(false);
      this.nextPartyIn += this.partyInterval;
    }
    if (this.time >= this.nextChampionAt) {
      this.spawnParty(true);
      this.nextChampionAt += BALANCE.championEvery;
    }
    for (let k = this.pending.length - 1; k >= 0; k--) {
      const p = this.pending[k];
      p.delay -= dt;
      if (p.delay <= 0) {
        this.heroes.push(p.hero);
        this.pending.splice(k, 1);
      }
    }
  }

  /** Expected hero level for a party spawned now. */
  partyLevel(): number {
    const m = this.minutes * this.mods.escalationMul;
    return 1 + BALANCE.heroLevelPerMin * m + BALANCE.heroLevelPerMin2 * m * m + BALANCE.heroLevelPerInfamy * this.infamy;
  }

  /** Expected party size for a party spawned now. */
  partySize(): number {
    const m = this.minutes * this.mods.escalationMul;
    return BALANCE.partySizeBase + BALANCE.partySizePerMin * m + BALANCE.partySizePerMin2 * m * m + BALANCE.partySizePerInfamy * this.infamy;
  }

  spawnParty(champion: boolean): void {
    const rng = this.rng;
    const g = this.grid;
    const size = Math.max(1, Math.min(BALANCE.partySizeMax, Math.round(this.partySize() + rng.range(-0.5, 0.5))));
    const levelF = this.partyLevel();
    const party: Party = { id: ++this.partyCount, known: new Map(), version: 0, size: 0, died: 0, escaped: 0, done: false };
    for (const [tile, r] of this.rumors) party.known.set(tile, r.feature);
    this.parties.set(party.id, party);

    // Rumors shape who answers the call: trap stories bring rogues, monster stories bring knights.
    let trapRumors = 0;
    for (const r of this.rumors.values()) if (FEATURES[r.feature].category === 'trap') trapRumors++;
    let lairs = 0;
    for (const t of g.featureTiles()) if (FEATURES[g.features[t]!.id].category === 'lair') lairs++;
    const weights: [HeroClass, number][] = [
      ['knight', 1 + Math.min(1.2, lairs * 0.1)],
      ['rogue', 0.8 + Math.min(2, trapRumors * 0.3)],
      ['cleric', 0.8 + Math.min(1, this.escaped * 0.02)],
    ];

    const members: Hero[] = [];
    for (let k = 0; k < size; k++) {
      const level = Math.max(1, Math.round(levelF + rng.range(-0.6, 0.6)));
      members.push(this.makeHero(rng.weighted(weights), level, party.id, null));
    }
    let champName: string | null = null;
    if (champion) {
      champName = rng.pick(CHAMPION_NAMES);
      const cls = rng.pick(['knight', 'rogue', 'cleric'] as HeroClass[]);
      const champ = this.makeHero(cls, Math.round(levelF) + BALANCE.championLevelBonus, party.id, champName);
      members.splice(Math.floor(members.length / 2), 0, champ);
    }
    party.size = members.length;
    members.forEach((hero, k) => this.pending.push({ hero, delay: k * BALANCE.spawnStagger }));
    this.events.push({ t: 'party', size: members.length, level: Math.round(levelF), champion: champName });
  }

  /** Adds one hero at the entrance right now (tests and debugging). */
  spawnHero(cls: HeroClass, level = 1, partyId?: number): Hero {
    let party = partyId !== undefined ? this.parties.get(partyId) : undefined;
    if (!party) {
      party = { id: ++this.partyCount, known: new Map(), version: 0, size: 0, died: 0, escaped: 0, done: false };
      for (const [tile, r] of this.rumors) party.known.set(tile, r.feature);
      this.parties.set(party.id, party);
    }
    party.size++;
    const h = this.makeHero(cls, level, party.id, null);
    this.heroes.push(h);
    return h;
  }

  private makeHero(cls: HeroClass, level: number, partyId: number, champion: string | null): Hero {
    const def = HEROES[cls];
    const g = this.grid;
    const hpMul = champion ? BALANCE.championHpMul : 1;
    const dmgMul = champion ? BALANCE.championDmgMul : 1;
    const maxHp = def.hp * heroHpMul(level) * hpMul;
    const ex = g.x(g.entrance);
    const ey = g.y(g.entrance);
    return {
      id: this.nextId++,
      cls,
      level,
      partyId,
      champion,
      hp: maxHp,
      maxHp,
      dmg: def.dmg * heroDmgMul(level) * dmgMul,
      cooldown: def.cooldown,
      speed: def.speed * this.rng.range(0.94, 1.06),
      armor: def.armor * (1 + 0.15 * (level - 1)),
      x: ex,
      y: ey,
      px: ex,
      py: ey,
      tile: g.entrance,
      path: [],
      pathIdx: 0,
      target: g.maw,
      goal: 'maw',
      state: 'walk',
      planVersion: '',
      atk: 0,
      lootT: 0,
      healT: def.heal?.interval ?? 0,
      loot: 0,
      looted: [],
      lootsLeft: def.maxLoots,
      bites: 0,
      sticky: 0,
      oily: 0,
      burning: 0,
      burnDps: 0,
      burnAcc: 0,
      spotRolled: [],
      disarmTried: [],
      facing: 1,
      lastHitAt: -10,
      lastAttackAt: -10,
    };
  }

  // ------------------------------------------------------------ features

  private tickFeatures(dt: number): void {
    const g = this.grid;
    for (const t of g.featureTiles()) {
      const f = g.features[t]!;
      const def = FEATURES[f.id];
      if (def.category === 'trap' && f.rearm > 0) {
        f.rearm -= dt * (g.touches(t, 'hoard') ? 2 : 1);
      } else if (def.category === 'lair') {
        const fed = g.touches(t, 'larder');
        f.slots.forEach((slot, s) => {
          if (slot.monsterId !== null) return;
          slot.respawn -= dt * (fed ? 2 : 1);
          if (slot.respawn <= 0) {
            this.spawnMonster(t, f, s);
            this.events.push({ t: 'respawn', tile: t, kind: def.monster! });
          }
        });
      }
    }
  }

  // ------------------------------------------------------------ heroes

  /** Price of stepping onto tile i for this hero, given what its party knows. */
  private costFn(h: Hero): (i: number) => number {
    const g = this.grid;
    const fear = HEROES[h.cls].fear * (h.champion ? 0.3 : 1) * (h.goal === 'flee' ? 1.5 : 1);
    const known = this.parties.get(h.partyId)?.known;
    return this.makeCostFn(fear, known ?? new Map(), g);
  }

  private makeCostFn(fear: number, known: Map<number, FeatureId>, g: Grid): (i: number) => number {
    const danger = this.dangerCache!;
    const gloomExtra = 1 / BALANCE.gloomSlow - 1;
    return (i: number) => {
      let c = 1 + fear * danger[i];
      const k = known.get(i);
      if (k) {
        const cat = FEATURES[k].category;
        if (cat === 'trap') c += fear * BALANCE.knownTrapFear;
        else if (k === 'mimic') c += fear * BALANCE.lairFear;
      }
      if (g.features[i]?.id === 'gloom') c += gloomExtra;
      return c;
    };
  }

  /** Tiles a hero treats as treasure: Hoards, plus Mimics nobody has warned it about. */
  private lootCandidates(known: Map<number, FeatureId>): number[] {
    const g = this.grid;
    const out: number[] = [];
    for (const t of g.featureTiles()) {
      const id = g.features[t]!.id;
      if (id === 'hoard' || (id === 'mimic' && known.get(t) !== 'mimic')) out.push(t);
    }
    return out;
  }

  /** Choose where to go next and how to get there. */
  private plan(h: Hero): void {
    const g = this.grid;
    const party = this.parties.get(h.partyId);
    h.planVersion = `${g.version}:${party?.version ?? 0}:${h.goal}`;

    let start = g.tileAt(h.x, h.y);
    if (start < 0 || !g.isWalkable(start)) start = g.isWalkable(h.tile) ? h.tile : g.entrance;
    const cost = this.costFn(h);
    const field = dijkstra(g, start, cost);

    let target = g.maw;
    if (h.goal === 'flee') {
      target = g.entrance;
    } else {
      h.goal = 'maw';
      const greed = HEROES[h.cls].greed;
      if (h.lootsLeft > 0 && greed > 0) {
        const candidates = this.lootCandidates(party?.known ?? new Map()).filter((c) => !h.looted.includes(c));
        if (candidates.length) {
          const fromMaw = dijkstra(g, g.maw, cost);
          const direct = field.dist[g.maw];
          let best = 0;
          for (const c of candidates) {
            if (!Number.isFinite(field.dist[c])) continue;
            const detour = field.dist[c] + fromMaw.dist[c] - direct;
            const score = greed * BALANCE.hoardAppeal - detour * BALANCE.detourWeight;
            if (score > best) {
              best = score;
              target = c;
            }
          }
          if (target !== g.maw) h.goal = 'loot';
        }
      }
    }

    h.target = target;
    const path = pathTo(field, target);
    if (path === null) {
      // Nowhere to go (should not happen: the dungeon always stays connected).
      h.path = [];
      h.pathIdx = 0;
      return;
    }
    h.path = [start, ...path];
    h.pathIdx = 0;
  }

  private tickHeroes(dt: number): void {
    for (const h of this.heroes) {
      if (h.state === 'dead' || h.state === 'escaped') continue;
      const def = HEROES[h.cls];

      // Status effects
      if (h.sticky > 0) h.sticky -= dt;
      if (h.oily > 0) h.oily -= dt;
      if (h.burning > 0) {
        h.burning -= dt;
        h.burnAcc += h.burnDps * dt;
        if (h.burnAcc >= 3 || (h.burning <= 0 && h.burnAcc > 0)) {
          const amt = h.burnAcc;
          h.burnAcc = 0;
          this.damageHero(h, amt, { pierce: true, burn: true });
          if (h.hp <= 0) continue;
        }
      }
      if (h.atk > 0) h.atk -= dt;

      // Cleric healing
      if (def.heal) {
        h.healT -= dt;
        if (h.healT <= 0) {
          h.healT = def.heal.interval;
          let best: Hero | null = null;
          for (const o of this.heroes) {
            if (o.state === 'dead' || o.state === 'escaped' || o.hp >= o.maxHp) continue;
            if (Math.hypot(o.x - h.x, o.y - h.y) > def.heal.radius) continue;
            if (!best || o.hp / o.maxHp < best.hp / best.maxHp) best = o;
          }
          if (best) {
            const amt = Math.min(best.maxHp - best.hp, def.heal.amount * heroDmgMul(h.level));
            best.hp += amt;
            this.events.push({ t: 'heal', x: best.x, y: best.y, amount: amt });
          }
        }
      }

      // Running scared
      if (h.goal !== 'flee' && def.fleeAt > 0 && !h.champion && h.hp / h.maxHp < def.fleeAt) {
        this.startFleeing(h);
      }

      if (h.state === 'loot') {
        h.lootT -= dt;
        if (h.lootT <= 0) this.finishLoot(h);
        continue;
      }
      if (h.state === 'bite') {
        this.tickBite(h);
        continue;
      }

      // Fight anything in reach (unless running away).
      if (h.goal !== 'flee') {
        const foe = this.nearestMonster(h.x, h.y, BALANCE.meleeRange);
        if (foe) {
          h.state = 'fight';
          h.facing = this.faceToward(h.x, h.y, foe.x, foe.y, h.facing);
          if (h.atk <= 0) {
            h.atk = h.cooldown;
            h.lastAttackAt = this.time;
            this.damageMonster(foe, h.dmg);
          }
          continue;
        }
      }
      h.state = 'walk';
      this.walk(h, dt);
    }
  }

  private nearestMonster(x: number, y: number, range: number): Monster | null {
    let best: Monster | null = null;
    let bestD = range;
    for (const m of this.monsters) {
      if (m.hp <= 0) continue;
      const d = Math.hypot(m.x - x, m.y - y);
      if (d <= bestD) {
        bestD = d;
        best = m;
      }
    }
    return best;
  }

  private faceToward(x: number, y: number, tx: number, ty: number, current: 1 | -1): 1 | -1 {
    // Screen-space x in the isometric view is (x - y).
    const sx = tx - ty - (x - y);
    if (Math.abs(sx) < 0.01) return current;
    return sx > 0 ? 1 : -1;
  }

  private walk(h: Hero, dt: number): void {
    const g = this.grid;
    const party = this.parties.get(h.partyId);
    const version = `${g.version}:${party?.version ?? 0}:${h.goal}`;
    if (h.planVersion !== version || h.pathIdx >= h.path.length) {
      if (h.pathIdx >= h.path.length && h.planVersion === version) {
        this.arrive(h);
        if (h.state !== 'walk') return;
      }
      this.plan(h);
    }

    let slow = 1;
    if (h.sticky > 0) slow *= BALANCE.stickySlow;
    if (h.oily > 0) slow *= BALANCE.oilySlow;
    const here = g.tileAt(h.x, h.y);
    if (here >= 0 && g.features[here]?.id === 'gloom') slow *= BALANCE.gloomSlow;
    let budget = h.speed * slow * dt;

    while (budget > 0 && h.pathIdx < h.path.length) {
      const t = h.path[h.pathIdx];
      const tx = g.x(t);
      const ty = g.y(t);
      const dx = tx - h.x;
      const dy = ty - h.y;
      const d = Math.hypot(dx, dy);
      if (d > 1e-6) h.facing = this.faceToward(h.x, h.y, tx, ty, h.facing);
      if (d <= budget) {
        h.x = tx;
        h.y = ty;
        budget -= d;
        h.pathIdx++;
        if (t !== h.tile) {
          h.tile = t;
          this.onEnter(h, t);
        }
        if (h.pathIdx >= h.path.length) {
          this.arrive(h);
          return;
        }
      } else {
        h.x += (dx / d) * budget;
        h.y += (dy / d) * budget;
        budget = 0;
      }
    }
  }

  /** Rogues scan around themselves for traps whenever they reach a new tile. */
  private onEnter(h: Hero, t: number): void {
    const def = HEROES[h.cls];
    if (def.spotChance <= 0 || h.goal === 'flee') return;
    const g = this.grid;
    const party = this.parties.get(h.partyId);
    if (!party) return;
    for (const n of [t, ...g.neighbors8(t)]) {
      const f = g.features[n];
      if (!f || FEATURES[f.id].category !== 'trap') continue;
      if (party.known.get(n) === f.id || h.spotRolled.includes(n)) continue;
      h.spotRolled.push(n);
      if (g.touches(n, 'gloom')) continue;
      if (this.rng.chance(def.spotChance)) {
        party.known.set(n, f.id);
        party.version++;
        this.events.push({ t: 'spotted', tile: n });
      }
    }
  }

  private arrive(h: Hero): void {
    const g = this.grid;
    const here = h.path.length ? h.path[h.path.length - 1] : h.tile;
    if (here !== h.target) {
      this.plan(h);
      return;
    }
    if (h.goal === 'flee' && here === g.entrance) {
      this.escape(h);
      return;
    }
    if (h.goal === 'maw' && here === g.maw) {
      h.state = 'bite';
      return;
    }
    if (h.goal === 'loot') {
      const f = g.features[here];
      if (f?.id === 'hoard') {
        h.state = 'loot';
        h.lootT = BALANCE.lootSeconds;
        return;
      }
      // A Mimic (or a Hoard that was torn down): nothing to loot.
      h.looted.push(here);
      h.lootsLeft--;
      if (f?.id === 'mimic') {
        const party = this.parties.get(h.partyId);
        if (party && party.known.get(here) !== 'mimic') {
          party.known.set(here, 'mimic');
          party.version++;
        }
      }
      h.goal = 'maw';
      this.plan(h);
    }
  }

  private finishLoot(h: Hero): void {
    const steal = Math.max(0, Math.min(this.gold * BALANCE.lootStealFraction, BALANCE.lootStealCapBase + BALANCE.lootStealCapPerLevel * h.level));
    this.gold -= steal;
    h.loot += steal;
    h.looted.push(h.target);
    h.lootsLeft--;
    this.events.push({ t: 'loot', x: h.x, y: h.y, amount: steal });
    h.state = 'walk';
    h.goal = 'maw';
    this.plan(h);
  }

  private tickBite(h: Hero): void {
    if (h.atk > 0) return;
    h.atk = h.cooldown;
    h.lastAttackAt = this.time;
    const dmg = h.dmg * BALANCE.biteDamageMul;
    this.mawHp -= dmg;
    this.mawLastHitAt = this.time;
    const stolen = Math.max(0, this.gold * BALANCE.biteStealFraction);
    this.gold -= stolen;
    h.loot += stolen;
    h.bites++;
    this.events.push({ t: 'bite', amount: dmg, stolen });
    if (h.bites >= BALANCE.bitesBeforeFlee) this.startFleeing(h);
  }

  private startFleeing(h: Hero): void {
    h.goal = 'flee';
    h.state = 'walk';
    this.plan(h);
  }

  private escape(h: Hero): void {
    h.state = 'escaped';
    this.escaped++;
    const party = this.parties.get(h.partyId);
    let rumors = 0;
    if (party) {
      party.escaped++;
      const until = this.time + BALANCE.rumorSeconds;
      for (const [tile, feature] of party.known) {
        if (FEATURES[feature].category !== 'trap' && feature !== 'mimic') continue;
        this.rumors.set(tile, { feature, until });
        rumors++;
      }
    }
    this.events.push({ t: 'escaped', cls: h.cls, loot: h.loot, rumors });
  }

  damageHero(h: Hero, amount: number, opts: { pierce?: boolean; burn?: boolean; crit?: boolean } = {}): void {
    if (h.state === 'dead' || h.state === 'escaped') return;
    const dmg = opts.pierce ? amount : Math.max(1, amount - h.armor);
    h.hp -= dmg;
    h.lastHitAt = this.time;
    this.events.push({ t: 'damage', x: h.x, y: h.y, amount: dmg, on: 'hero', id: h.id, crit: opts.crit, burn: opts.burn });
    if (h.hp <= 0) this.killHero(h);
  }

  private killHero(h: Hero): void {
    h.state = 'dead';
    h.hp = 0;
    const def = HEROES[h.cls];
    const g = this.grid;
    const tile = g.tileAt(h.x, h.y);
    const gullet = tile >= 0 && (g.features[tile]?.id === 'gullet' || g.touches(tile, 'gullet'));
    const champMul = h.champion ? BALANCE.championRewardMul : 1;
    const reward = def.gold * heroRewardMul(h.level) * this.mods.goldMul * (gullet ? 1.5 : 1) * champMul;
    const gold = reward + h.loot;
    const infamy = def.infamy * h.level * champMul;
    this.gold += gold;
    this.goldFromKills += reward;
    this.infamy += infamy;
    this.eaten++;
    if (h.champion) this.champions++;
    const party = this.parties.get(h.partyId);
    if (party) party.died++;
    this.events.push({ t: 'heroDied', x: h.x, y: h.y, gold, infamy, cls: h.cls, champion: h.champion, gullet });
  }

  // ------------------------------------------------------------ monsters

  private damageMonster(m: Monster, amount: number): void {
    m.hp -= amount;
    m.lastHitAt = this.time;
    this.events.push({ t: 'damage', x: m.x, y: m.y, amount, on: 'monster', id: m.id });
    if (m.hp > 0) return;
    const f = this.grid.features[m.lair];
    if (f && f.slots[m.slot]?.monsterId === m.id) {
      f.slots[m.slot].monsterId = null;
      f.slots[m.slot].respawn = FEATURES[f.id].respawn ?? 10;
    }
    this.events.push({ t: 'monsterDied', x: m.x, y: m.y, kind: m.kind });
  }

  private tickMonsters(dt: number): void {
    const g = this.grid;
    for (const m of this.monsters) {
      if (m.hp <= 0) continue;
      const def = MONSTERS[m.kind];
      if (m.atk > 0) m.atk -= dt;
      const area = this.leashArea(m.lair, m.kind);

      // Pick a target: Knights draw attention, otherwise the nearest hero in range.
      let target: Hero | null = null;
      let bestScore = Infinity;
      for (const h of this.heroes) {
        if (h.state === 'dead' || h.state === 'escaped') continue;
        if (m.kind === 'mimic') {
          if (Math.hypot(h.x - m.x, h.y - m.y) > 0.9) continue;
        } else if (!area.has(g.tileAt(h.x, h.y))) continue;
        let score = Math.hypot(h.x - m.x, h.y - m.y);
        if (h.cls === 'knight') score -= 1.5;
        if (score < bestScore) {
          bestScore = score;
          target = h;
        }
      }

      if (!target) {
        m.targetId = null;
        m.idleT += dt;
        if (m.kind === 'mimic' && m.idleT > 4) m.ambush = true;
        this.moveMonster(m, m.homeX, m.homeY, dt);
        if (g.touches(m.lair, 'larder') && m.hp < m.maxHp) m.hp = Math.min(m.maxHp, m.hp + 3 * dt);
        continue;
      }

      m.idleT = 0;
      m.targetId = target.id;
      const d = Math.hypot(target.x - m.x, target.y - m.y);
      m.facing = this.faceToward(m.x, m.y, target.x, target.y, m.facing);
      if (d > BALANCE.monsterReach && def.speed > 0) {
        // Approach from a slightly different angle per monster so groups fan out.
        const ang = m.id * 2.399;
        this.moveMonster(m, target.x + Math.cos(ang) * 0.3, target.y + Math.sin(ang) * 0.3, dt, area);
      }
      const reach = def.speed > 0 ? BALANCE.monsterReach + 0.05 : 0.9;
      if (d <= reach && m.atk <= 0) {
        m.atk = m.cooldown;
        m.lastAttackAt = this.time;
        let dmg = m.dmg;
        if (m.ambush && def.ambushMul) {
          dmg *= def.ambushMul;
          m.ambush = false;
          this.events.push({ t: 'ambush', tile: m.lair });
          const party = this.parties.get(target.partyId);
          if (party && party.known.get(m.lair) !== 'mimic') {
            party.known.set(m.lair, 'mimic');
            party.version++;
          }
        }
        this.damageHero(target, dmg, { crit: dmg > m.dmg });
        if (def.sticky && target.state !== 'dead') {
          if (target.sticky <= 0) this.events.push({ t: 'status', x: target.x, y: target.y, status: 'sticky' });
          target.sticky = BALANCE.stickySeconds;
        }
      }
    }
  }

  /** Step toward a point, staying on walkable tiles inside the leash area. */
  private moveMonster(m: Monster, tx: number, ty: number, dt: number, area?: Set<number>): void {
    if (m.speed <= 0) return;
    const g = this.grid;
    const dx = tx - m.x;
    const dy = ty - m.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.02) return;
    const step = Math.min(d, m.speed * dt);
    const nx = m.x + (dx / d) * step;
    const ny = m.y + (dy / d) * step;
    const ok = (x: number, y: number) => {
      const t = g.tileAt(x, y);
      return t >= 0 && g.isWalkable(t) && (!area || area.has(t));
    };
    if (ok(nx, ny)) {
      m.x = nx;
      m.y = ny;
    } else if (ok(nx, m.y)) {
      m.x = nx;
    } else if (ok(m.x, ny)) {
      m.y = ny;
    }
  }

  // ------------------------------------------------------------ traps

  private tickTraps(): void {
    const g = this.grid;
    for (const t of g.featureTiles()) {
      const f = g.features[t]!;
      const def = FEATURES[f.id];
      if (def.category !== 'trap' || f.rearm > 0) continue;

      if (f.id === 'fireVent') {
        const trigger = this.heroes.some((h) => this.isActive(h) && g.chebyshev(g.tileAt(h.x, h.y), t) <= 1);
        if (!trigger) continue;
        f.rearm = def.rearm!;
        this.events.push({ t: 'trap', tile: t, feature: f.id });
        const cx = g.x(t);
        const cy = g.y(t);
        for (const h of this.heroes) {
          if (!this.isActive(h) || Math.hypot(h.x - cx, h.y - cy) > 1.5) continue;
          this.learn(h, t, f.id);
          if (h.oily > 0) {
            h.oily = 0;
            h.burning = BALANCE.burnSeconds;
            h.burnDps = 7 * trapDmgMul(f.level);
            this.events.push({ t: 'ignite', x: h.x, y: h.y });
          }
          this.damageHero(h, def.damage! * trapDmgMul(f.level));
        }
        continue;
      }

      // Spikes and oil hit someone standing on the tile.
      const victim = this.heroes.find((h) => this.isActive(h) && g.tileAt(h.x, h.y) === t);
      if (!victim) continue;
      const party = this.parties.get(victim.partyId);
      const def2 = HEROES[victim.cls];
      if (def2.disarmChance > 0 && party?.known.get(t) === f.id && !victim.disarmTried.includes(t) && !g.touches(t, 'gloom')) {
        victim.disarmTried.push(t);
        if (this.rng.chance(def2.disarmChance)) {
          f.rearm = def.rearm! * 2;
          this.events.push({ t: 'disarm', tile: t });
          continue;
        }
      }
      f.rearm = def.rearm!;
      this.learn(victim, t, f.id);
      if (f.id === 'spikes') {
        const crit = victim.sticky > 0;
        this.events.push({ t: 'trap', tile: t, feature: f.id, crit });
        this.damageHero(victim, def.damage! * trapDmgMul(f.level) * (crit ? 2 : 1), { crit });
      } else if (f.id === 'oil') {
        this.events.push({ t: 'trap', tile: t, feature: f.id });
        if (victim.oily <= 0) this.events.push({ t: 'status', x: victim.x, y: victim.y, status: 'oily' });
        victim.oily = BALANCE.oilySeconds;
      }
    }
  }

  private isActive(h: Hero): boolean {
    return h.state !== 'dead' && h.state !== 'escaped';
  }

  private learn(h: Hero, tile: number, id: FeatureId): void {
    const party = this.parties.get(h.partyId);
    if (!party || party.known.get(tile) === id) return;
    party.known.set(tile, id);
    party.version++;
  }

  // ------------------------------------------------------------ the Maw

  private tickMaw(dt: number): void {
    const g = this.grid;
    const mx = g.x(g.maw);
    const my = g.y(g.maw);
    if (this.mawChompT > 0) this.mawChompT -= dt;
    let biting = false;
    let target: Hero | null = null;
    let bestD = Infinity;
    for (const h of this.heroes) {
      if (!this.isActive(h)) continue;
      if (h.state === 'bite') biting = true;
      const d = Math.hypot(h.x - mx, h.y - my) - (h.state === 'bite' ? 1 : 0);
      if (d <= BALANCE.mawChompRange && d < bestD) {
        bestD = d;
        target = h;
      }
    }
    if (target && this.mawChompT <= 0) {
      this.mawChompT = BALANCE.mawChompCooldown;
      this.mawLastChompAt = this.time;
      this.events.push({ t: 'chomp', heroId: target.id });
      this.damageHero(target, this.mawChompDamage, { pierce: true });
    }
    if (!biting && this.mawHp < this.mawMaxHp) this.mawHp = Math.min(this.mawMaxHp, this.mawHp + BALANCE.mawRegen * dt);
  }

  // ------------------------------------------------------------ bookkeeping

  private cleanup(): void {
    this.heroes = this.heroes.filter((h) => h.state !== 'dead' && h.state !== 'escaped');
    this.monsters = this.monsters.filter((m) => m.hp > 0);
    for (const p of this.parties.values()) {
      if (p.done || p.died + p.escaped < p.size) continue;
      p.done = true;
      if (p.escaped === 0) {
        const bonus = BALANCE.partyWipeInfamyPerHero * p.size;
        this.infamy += bonus;
        this.events.push({ t: 'wipe', size: p.size, infamy: bonus });
      }
    }
    if (this.parties.size > 50) {
      for (const [id, p] of this.parties) if (p.done) this.parties.delete(id);
    }
  }

  private tickRumors(dt: number): void {
    this.rumorCheckT -= dt;
    if (this.rumorCheckT > 0) return;
    this.rumorCheckT = 1;
    for (const [tile, r] of this.rumors) if (r.until <= this.time) this.rumors.delete(tile);
  }

  private checkUnlocks(): void {
    for (const f of FEATURE_ORDER) {
      if (this.unlocked.has(f) || this.infamy < FEATURES[f].unlockInfamy) continue;
      this.unlocked.add(f);
      this.events.push({ t: 'unlock', feature: f });
    }
  }

  // ------------------------------------------------------------ queries for the UI

  /**
   * The route a fresh hero of this class would take right now, using only what the
   * town has heard. Includes a Hoard detour when the class would make one.
   */
  previewRoute(cls: HeroClass): number[] {
    this.refreshCaches();
    const g = this.grid;
    const known = new Map<number, FeatureId>();
    for (const [tile, r] of this.rumors) known.set(tile, r.feature);
    const def = HEROES[cls];
    const cost = this.makeCostFn(def.fear, known, g);
    const field = dijkstra(g, g.entrance, cost);
    const fromMaw = dijkstra(g, g.maw, cost);
    const direct = field.dist[g.maw];
    let best = 0;
    let target = g.maw;
    for (const c of this.lootCandidates(known)) {
      if (!Number.isFinite(field.dist[c])) continue;
      const score = def.greed * BALANCE.hoardAppeal - (field.dist[c] + fromMaw.dist[c] - direct) * BALANCE.detourWeight;
      if (score > best) {
        best = score;
        target = c;
      }
    }
    const first = pathTo(field, target) ?? [];
    if (target === g.maw) return [g.entrance, ...first];
    const second = pathTo(dijkstra(g, target, cost), g.maw) ?? [];
    return [g.entrance, ...first, ...second];
  }

  /** Infamy -> danger readout for the HUD. */
  threatLabel(): string {
    const lvl = this.partyLevel();
    const size = this.partySize();
    return `Lv ${lvl.toFixed(1)} · ~${Math.max(1, Math.round(size))} heroes`;
  }

  toSave(): RunSave {
    const g = this.grid;
    return {
      seed: this.seed,
      rng: this.rng.state,
      time: this.time,
      gold: this.gold,
      infamy: this.infamy,
      eaten: this.eaten,
      escaped: this.escaped,
      champions: this.champions,
      goldFromKills: this.goldFromKills,
      mawHp: this.mawHp,
      mawLevel: this.mawLevel,
      kinds: g.encodeKinds(),
      features: g.featureTiles().map((i) => {
        const f = g.features[i]!;
        return { i, id: f.id, level: f.level, invested: f.invested };
      }),
      rumors: [...this.rumors].map(([i, r]) => ({ i, feature: r.feature, until: r.until })),
      nextPartyIn: this.nextPartyIn,
      nextChampionAt: this.nextChampionAt,
      partyCount: this.partyCount,
      unlocked: [...this.unlocked],
    };
  }
}

export type { DistanceField };
