import { generateCave, otherEnd, type Cave, type Edge, type Site } from './cave';
import {
  BALANCE,
  CHAMPION_NAMES,
  HEROES,
  MONSTERS,
  ROOMS,
  ROOM_ORDER,
  heroDmgMul,
  heroHpMul,
  heroRewardMul,
  trackCost,
  type Cost,
  type HeroClass,
  type MonsterKind,
  type RoomId,
} from './content';
import { metaMods, type MetaMods, type MetaState } from './meta';
import { Rng } from './rng';

// ---------------------------------------------------------------- entities

export interface Hero {
  id: number;
  cls: HeroClass;
  level: number;
  champion: string | null;
  group: number;
  hp: number;
  maxHp: number;
  dmg: number;
  cooldown: number;
  speed: number;
  armor: number;
  atk: number;
  healT: number;
  loot: number;
  lootsLeft: number;
  bites: number;
  sticky: number;
  oily: number;
  burning: number;
  burnDps: number;
  bleed: number;
  bleedDps: number;
  poison: number;
  poisonDps: number;
  cursed: number;
  cursedDps: number;
  dotAcc: number;
  dead: boolean;
  lastHitAt: number;
  lastAttackAt: number;
}

export type PartyGoal = 'maw' | 'loot' | 'flee';
export type PartyState = 'move' | 'fight' | 'loot' | 'bite';

export interface Party {
  id: number;
  members: Hero[];
  known: Map<number, RoomId>;
  disarmed: Set<number>;
  looted: Set<number>;
  goal: PartyGoal;
  target: number;
  route: number[];
  from: number;
  to: number;
  d: number;
  len: number;
  x: number;
  y: number;
  px: number;
  py: number;
  state: PartyState;
  lootT: number;
  /** Site whose room rectangle the party is standing in, or -1. */
  inside: number;
}

export interface Monster {
  id: number;
  kind: MonsterKind;
  site: number;
  slot: number;
  hp: number;
  maxHp: number;
  atk: number;
  /** Skeletons: seconds until they get back up (0 when standing). */
  down: number;
  reassembled: boolean;
  ambush: boolean;
  targetId: number | null;
  lastHitAt: number;
  lastAttackAt: number;
}

export interface Room {
  site: number;
  id: RoomId;
  ranks: [number, number, number];
  invested: Cost;
  slots: { monsterId: number | null; respawn: number }[];
  trapT: number;
}

export interface Rumor {
  room: RoomId;
  until: number;
}

export type SimEvent =
  | { t: 'damage'; x: number; y: number; amount: number; on: 'hero' | 'monster'; id: number; site: number; crit?: boolean; dot?: boolean }
  | { t: 'heroDied'; id: number; x: number; y: number; site: number; gold: number; essence: number; infamy: number; cls: HeroClass; champion: string | null; bonus: boolean }
  | { t: 'monsterDied'; id: number; site: number; kind: MonsterKind }
  | { t: 'monsterDown'; id: number; site: number }
  | { t: 'monsterUp'; id: number; site: number }
  | { t: 'trap'; site: number; room: RoomId; heroId?: number; crit?: boolean }
  | { t: 'ignite'; heroId: number }
  | { t: 'status'; heroId: number; status: 'sticky' | 'oily' | 'cursed' | 'poison' }
  | { t: 'disarm'; site: number }
  | { t: 'spotted'; site: number }
  | { t: 'loot'; site: number; heroId: number; amount: number }
  | { t: 'bite'; heroId: number; amount: number; stolen: number }
  | { t: 'chomp'; heroId: number }
  | { t: 'escaped'; cls: HeroClass; loot: number; rumors: number }
  | { t: 'party'; size: number; level: number; champion: string | null }
  | { t: 'heal'; heroId: number; amount: number }
  | { t: 'unlock'; tier: number }
  | { t: 'respawn'; site: number; kind: MonsterKind }
  | { t: 'wipe'; size: number; infamy: number }
  | { t: 'ambush'; site: number }
  | { t: 'fall'; heroId: number; site: number; eaten: boolean }
  | { t: 'split'; heroId: number; reason: 'loot' | 'flee' }
  | { t: 'excavated'; region: number }
  | { t: 'collapse' };

export type ActionResult = { ok: true } | { ok: false; reason: string };
const OK: ActionResult = { ok: true };
const fail = (reason: string): ActionResult => ({ ok: false, reason });

export interface RunSave {
  v: 2;
  seed: number;
  rng: number;
  time: number;
  gold: number;
  essence: number;
  infamy: number;
  eaten: number;
  escaped: number;
  champions: number;
  goldFromKills: number;
  essenceFromKills: number;
  mawHp: number;
  mawLevel: number;
  rooms: { site: number; id: RoomId; ranks: [number, number, number]; invested: Cost }[];
  dug: number[];
  excavated: number[];
  rumors: { site: number; room: RoomId; until: number }[];
  nextPartyIn: number;
  nextChampionAt: number;
  partyCount: number;
  tier: number;
}

interface Group {
  size: number;
  died: number;
  escaped: number;
  done: boolean;
}

// ---------------------------------------------------------------- the simulation

/**
 * The whole game world, advanced in fixed ticks of BALANCE.dt seconds.
 * Heroes travel as parties along dug corridors between room sites.
 * Pure TypeScript: rendering, audio and tests all read the same state.
 */
export class Sim {
  readonly seed: number;
  readonly rng: Rng;
  readonly cave: Cave;
  readonly mods: MetaMods;

  time = 0;
  gold: number;
  essence: number;
  infamy = 0;
  eaten = 0;
  escaped = 0;
  champions = 0;
  goldFromKills = 0;
  essenceFromKills = 0;
  mawHp: number;
  mawLevel = 1;
  mawChompT = 0;
  mawLastHitAt = -10;
  mawLastChompAt = -10;
  collapsed = false;
  /** Highest catalog tier unlocked by Infamy. */
  tier = 0;
  /** Bumped on every change to rooms, corridors or excavation. */
  version = 0;

  rooms = new Map<number, Room>();
  dug = new Set<number>();
  excavated = new Set<number>();
  monsters: Monster[] = [];
  parties: Party[] = [];
  rumors = new Map<number, Rumor>();
  events: SimEvent[] = [];

  nextPartyIn: number = BALANCE.firstPartyAt;
  nextChampionAt: number = BALANCE.championEvery;
  partyCount = 0;

  private groups = new Map<number, Group>();
  private pending: { party: Party; delay: number }[] = [];
  private nextId = 1;
  private rumorCheckT = 0;

  constructor(meta: MetaState, seed: number, save?: RunSave, cave?: Cave) {
    this.mods = metaMods(meta);
    this.seed = seed;
    this.cave = cave ?? generateCave(new Rng(seed));
    this.rng = new Rng(save ? save.rng : (seed ^ 0x5bd1e995) >>> 0);
    this.gold = BALANCE.startGold + this.mods.startGold;
    this.essence = BALANCE.startEssence;
    this.mawHp = 0;
    if (save) {
      this.time = save.time;
      this.gold = save.gold;
      this.essence = save.essence;
      this.infamy = save.infamy;
      this.eaten = save.eaten;
      this.escaped = save.escaped;
      this.champions = save.champions;
      this.goldFromKills = save.goldFromKills;
      this.essenceFromKills = save.essenceFromKills;
      this.mawLevel = save.mawLevel;
      this.nextPartyIn = Math.max(8, save.nextPartyIn);
      this.nextChampionAt = Math.max(save.nextChampionAt, this.time + 30);
      this.partyCount = save.partyCount;
      this.tier = save.tier;
      for (const r of save.excavated) this.excavated.add(r);
      for (const e of save.dug) this.dug.add(e);
      for (const r of save.rumors) this.rumors.set(r.site, { room: r.room, until: r.until });
      for (const r of save.rooms) this.placeRoom(r.site, r.id, r.ranks, r.invested);
      this.mawHp = Math.min(save.mawHp, this.mawMaxHp);
    } else {
      this.excavated.add(0);
      const route = this.cave.startRoute;
      for (let i = 0; i + 1 < route.length; i++) {
        const e = this.edgeBetween(route[i], route[i + 1]);
        if (e) this.dug.add(e.id);
      }
      this.mawHp = this.mawMaxHp;
      if (this.mods.headStart) {
        const spots = route.filter((s) => this.cave.sites[s].kind === 'site');
        if (spots[0] !== undefined) this.placeRoom(spots[0], 'spikeHall', [0, 0, 0], { gold: ROOMS.spikeHall.cost.gold, essence: 0 });
        if (spots[1] !== undefined) this.placeRoom(spots[1], 'goblinWarren', [0, 0, 0], { ...ROOMS.goblinWarren.cost });
        this.tier = Math.max(this.tier, 1);
      }
    }
    this.checkUnlocks(true);
  }

  // ------------------------------------------------------------ geometry helpers

  site(id: number): Site {
    return this.cave.sites[id];
  }

  edgeBetween(a: number, b: number): Edge | null {
    for (const eid of this.cave.adj[a]) {
      const e = this.cave.edges[eid];
      if (otherEnd(e, a) === b) return e;
    }
    return null;
  }

  isExcavated(site: number): boolean {
    return this.excavated.has(this.site(site).region);
  }

  /** Sites joined to this one by a dug corridor. */
  linked(site: number): number[] {
    const out: number[] = [];
    for (const eid of this.cave.adj[site]) if (this.dug.has(eid)) out.push(otherEnd(this.cave.edges[eid], site));
    return out;
  }

  /** Rooms of a type linked to a site by one corridor. */
  linkedRooms(site: number, id: RoomId): Room[] {
    const out: Room[] = [];
    for (const n of this.linked(site)) {
      const r = this.rooms.get(n);
      if (r?.id === id) out.push(r);
    }
    return out;
  }

  private maxRank(rooms: Room[], track: number): number {
    return rooms.reduce((m, r) => Math.max(m, r.ranks[track]), 0);
  }

  inRect(site: number, x: number, y: number): boolean {
    const s = this.site(site);
    return Math.abs(x - s.x) <= s.w / 2 && Math.abs(y - s.y) <= s.h / 2;
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
  partyLevel(): number {
    const m = this.minutes * this.mods.escalationMul;
    return 1 + BALANCE.heroLevelPerMin * m + BALANCE.heroLevelPerMin2 * m * m + BALANCE.heroLevelPerInfamy * this.infamy;
  }
  partySize(): number {
    const m = this.minutes * this.mods.escalationMul;
    return BALANCE.partySizeBase + BALANCE.partySizePerMin * m + BALANCE.partySizePerMin2 * m * m + BALANCE.partySizePerInfamy * this.infamy;
  }
  threatLabel(): string {
    return `Lv ${this.partyLevel().toFixed(1)} · ~${Math.max(1, Math.round(this.partySize()))} heroes`;
  }
  get livingHeroes(): number {
    let n = 0;
    for (const p of this.parties) n += p.members.length;
    for (const p of this.pending) n += p.party.members.length;
    return n;
  }
  heroes(): Hero[] {
    return this.parties.flatMap((p) => p.members);
  }

  isUnlocked(id: RoomId): boolean {
    const def = ROOMS[id];
    if (def.blueprint && !this.mods.blueprints.has(id)) return false;
    return def.tier <= this.tier;
  }
  nextTier(): { tier: number; infamy: number } | null {
    const t = this.tier + 1;
    return t < BALANCE.tierInfamy.length ? { tier: t, infamy: BALANCE.tierInfamy[t] } : null;
  }
  roomCost(id: RoomId): Cost {
    const c = ROOMS[id].cost;
    return { gold: Math.round(c.gold * this.mods.costMul), essence: c.essence };
  }
  upgradeCost(site: number, track: number): Cost | null {
    const r = this.rooms.get(site);
    if (!r || r.ranks[track] >= 3) return null;
    const c = trackCost(r.id, r.ranks[track] + 1);
    return { gold: Math.round(c.gold * this.mods.costMul), essence: c.essence };
  }
  corridorCost(edge: number): number {
    return Math.max(1, Math.round(this.cave.edges[edge].len * BALANCE.corridorCostPerTile * this.mods.costMul));
  }
  excavateCost(): number {
    const n = this.excavated.size - 1;
    const costs = BALANCE.excavateCosts;
    return costs[Math.min(n, costs.length - 1)];
  }
  mawUpgradeCost(): number | null {
    if (this.mawLevel >= BALANCE.mawUpgradeMax) return null;
    return Math.round(BALANCE.mawUpgradeBase * BALANCE.mawUpgradeGrowth ** (this.mawLevel - 1) * this.mods.costMul);
  }
  private afford(c: Cost): boolean {
    return this.gold >= c.gold && this.essence >= c.essence;
  }
  private pay(c: Cost): void {
    this.gold -= c.gold;
    this.essence -= c.essence;
  }
  private costReason(c: Cost): string {
    return this.gold < c.gold ? 'Not enough Gold' : 'Not enough Essence';
  }

  // ------------------------------------------------------------ player actions

  canBuild(site: number, id: RoomId): ActionResult {
    const s = this.cave.sites[site];
    if (!s || s.kind !== 'site') return fail('Rooms go on empty sites');
    if (!this.isExcavated(site)) return fail('Excavate this area first');
    if (this.rooms.has(site)) return fail('Something is already built here');
    if (!this.isUnlocked(id)) {
      const def = ROOMS[id];
      return fail(def.blueprint && !this.mods.blueprints.has(id) ? 'Buy its blueprint with Teeth first' : `Unlocks at ${BALANCE.tierInfamy[def.tier]} Infamy`);
    }
    const c = this.roomCost(id);
    if (!this.afford(c)) return fail(this.costReason(c));
    return OK;
  }

  build(site: number, id: RoomId): ActionResult {
    const r = this.canBuild(site, id);
    if (!r.ok) return r;
    const c = this.roomCost(id);
    this.pay(c);
    this.placeRoom(site, id, [0, 0, 0], { ...c });
    this.version++;
    return OK;
  }

  private placeRoom(site: number, id: RoomId, ranks: [number, number, number], invested: Cost): void {
    const def = ROOMS[id];
    const room: Room = { site, id, ranks: [...ranks] as [number, number, number], invested, slots: [], trapT: 0 };
    this.rooms.set(site, room);
    if (def.monster) {
      const count = this.monsterCount(room);
      for (let s = 0; s < count; s++) {
        room.slots.push({ monsterId: null, respawn: 0 });
        this.spawnMonster(room, s);
      }
    }
  }

  sell(site: number): ActionResult {
    const r = this.rooms.get(site);
    if (!r) return fail('Nothing to sell');
    this.gold += Math.floor(r.invested.gold * BALANCE.sellRefund);
    this.essence += Math.floor(r.invested.essence * BALANCE.sellRefund);
    this.monsters = this.monsters.filter((m) => m.site !== site);
    this.rooms.delete(site);
    this.version++;
    return OK;
  }

  canUpgrade(site: number, track: number): ActionResult {
    const r = this.rooms.get(site);
    if (!r) return fail('Nothing to upgrade');
    const c = this.upgradeCost(site, track);
    if (!c) return fail('Already maxed');
    if (!this.afford(c)) return fail(this.costReason(c));
    return OK;
  }

  upgrade(site: number, track: number): ActionResult {
    const res = this.canUpgrade(site, track);
    if (!res.ok) return res;
    const r = this.rooms.get(site)!;
    const c = this.upgradeCost(site, track)!;
    this.pay(c);
    r.invested.gold += c.gold;
    r.invested.essence += c.essence;
    r.ranks[track]++;
    // New monster slots appear straight away.
    if (ROOMS[r.id].monster) {
      while (r.slots.length < this.monsterCount(r)) {
        r.slots.push({ monsterId: null, respawn: 0 });
        this.spawnMonster(r, r.slots.length - 1);
      }
    }
    this.version++;
    this.refreshMonsters();
    return OK;
  }

  canDig(edge: number): ActionResult {
    const e = this.cave.edges[edge];
    if (!e) return fail('No corridor there');
    if (this.dug.has(edge)) return fail('Already dug');
    if (!this.isExcavated(e.a) || !this.isExcavated(e.b)) return fail('Excavate both ends first');
    if (this.gold < this.corridorCost(edge)) return fail('Not enough Gold');
    return OK;
  }

  dig(edge: number): ActionResult {
    const r = this.canDig(edge);
    if (!r.ok) return r;
    this.gold -= this.corridorCost(edge);
    this.dug.add(edge);
    this.version++;
    this.refreshMonsters();
    return OK;
  }

  canFill(edge: number): ActionResult {
    if (!this.dug.has(edge)) return fail('Nothing to fill');
    const e = this.cave.edges[edge];
    if (this.parties.some((p) => (p.from === e.a && p.to === e.b) || (p.from === e.b && p.to === e.a))) return fail('Heroes are in that corridor');
    if (!this.connected(edge)) return fail('That would cut the Maw off from the gate');
    return OK;
  }

  fill(edge: number): ActionResult {
    const r = this.canFill(edge);
    if (!r.ok) return r;
    this.dug.delete(edge);
    this.gold += Math.floor(this.corridorCost(edge) * BALANCE.sellRefund);
    this.version++;
    this.refreshMonsters();
    return OK;
  }

  /** Is the gate connected to the Maw (optionally pretending one corridor is gone)? */
  connected(withoutEdge = -1): boolean {
    const seen = new Set<number>([this.cave.gate]);
    const stack = [this.cave.gate];
    while (stack.length) {
      const c = stack.pop()!;
      if (c === this.cave.maw) return true;
      for (const eid of this.cave.adj[c]) {
        if (eid === withoutEdge || !this.dug.has(eid)) continue;
        const n = otherEnd(this.cave.edges[eid], c);
        if (!seen.has(n)) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
    return false;
  }

  /** Regions that border what you have already dug out. */
  excavatable(): number[] {
    const out = new Set<number>();
    for (const e of this.cave.edges) {
      const ra = this.site(e.a).region;
      const rb = this.site(e.b).region;
      if (this.excavated.has(ra) && !this.excavated.has(rb)) out.add(rb);
      if (this.excavated.has(rb) && !this.excavated.has(ra)) out.add(ra);
    }
    return [...out].sort((a, b) => a - b);
  }

  canExcavate(region: number): ActionResult {
    if (this.excavated.has(region)) return fail('Already excavated');
    if (!this.excavatable().includes(region)) return fail('Dig out a neighboring area first');
    if (this.essence < this.excavateCost()) return fail('Not enough Essence');
    return OK;
  }

  excavate(region: number): ActionResult {
    const r = this.canExcavate(region);
    if (!r.ok) return r;
    this.essence -= this.excavateCost();
    this.excavated.add(region);
    this.version++;
    this.events.push({ t: 'excavated', region });
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

  forceCollapse(): void {
    if (this.collapsed) return;
    this.mawHp = 0;
    this.collapsed = true;
    this.events.push({ t: 'collapse' });
  }

  // ------------------------------------------------------------ monsters

  private monsterCount(r: Room): number {
    const def = ROOMS[r.id];
    const extra = r.id === 'goblinWarren' || r.id === 'boneCrypt' || r.id === 'spiderNest' ? r.ranks[0] : 0;
    return (def.count ?? 0) + extra;
  }

  private monsterHpMul(r: Room): number {
    let mul = 1 + 0.15 * this.maxRank(this.linkedRooms(r.site, 'larder'), 1);
    if (r.id === 'slimePit') mul *= 1 + 0.35 * r.ranks[0];
    if (r.id === 'trollDen') mul *= 1 + 0.3 * r.ranks[0];
    return mul;
  }

  monsterDamage(m: Monster): number {
    const r = this.rooms.get(m.site);
    const def = MONSTERS[m.kind];
    let mul = 1;
    if (r) {
      mul *= 1 + 0.12 * this.maxRank(this.linkedRooms(r.site, 'larder'), 2);
      if (r.id === 'goblinWarren') mul *= 1 + 0.3 * r.ranks[1];
      if (r.id === 'mimicVault') mul *= 1 + 0.3 * r.ranks[0];
    }
    return def.dmg * mul;
  }

  private respawnMul(r: Room): number {
    const larders = this.linkedRooms(r.site, 'larder');
    if (!larders.length) return 1;
    return 2 + 0.5 * this.maxRank(larders, 0);
  }

  private spawnMonster(r: Room, slot: number): void {
    const kind = ROOMS[r.id].monster!;
    const hp = MONSTERS[kind].hp * this.monsterHpMul(r);
    const m: Monster = { id: this.nextId++, kind, site: r.site, slot, hp, maxHp: hp, atk: 0.5, down: 0, reassembled: false, ambush: true, targetId: null, lastHitAt: -10, lastAttackAt: -10 };
    r.slots[slot].monsterId = m.id;
    this.monsters.push(m);
  }

  /** Re-apply HP multipliers after upgrades or new links. */
  private refreshMonsters(): void {
    for (const m of this.monsters) {
      const r = this.rooms.get(m.site);
      if (!r) continue;
      const max = MONSTERS[m.kind].hp * this.monsterHpMul(r);
      if (Math.abs(max - m.maxHp) > 0.01) {
        m.hp = (m.hp / m.maxHp) * max;
        m.maxHp = max;
      }
    }
  }

  // ------------------------------------------------------------ tick

  tick(): void {
    if (this.collapsed) return;
    const dt = BALANCE.dt;
    this.time += dt;
    if (this.events.length > 4000) this.events.splice(0, this.events.length - 2000);
    for (const p of this.parties) {
      p.px = p.x;
      p.py = p.y;
    }

    this.gold += BALANCE.passiveGoldPerSec * dt;
    for (const r of this.rooms.values()) if (r.id === 'soulWell') this.essence += (0.2 + 0.15 * r.ranks[0]) * dt;

    this.tickSpawning(dt);
    this.tickRooms(dt);
    this.tickHeroes(dt);
    this.tickParties(dt);
    this.tickCombat(dt);
    this.tickTraps(dt);
    this.tickMaw(dt);
    this.cleanup();
    this.tickRumors(dt);
    this.checkUnlocks(false);

    if (this.mawHp <= 0) {
      this.mawHp = 0;
      this.collapsed = true;
      this.events.push({ t: 'collapse' });
    }
  }

  // ------------------------------------------------------------ parties: spawning

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
        this.parties.push(p.party);
        this.plan(p.party);
        this.pending.splice(k, 1);
      }
    }
  }

  private newParty(members: Hero[], at: number): Party {
    const s = this.site(at);
    const party: Party = {
      id: this.nextId++,
      members,
      known: new Map(),
      disarmed: new Set(),
      looted: new Set(),
      goal: 'maw',
      target: this.cave.maw,
      route: [],
      from: at,
      to: at,
      d: 0,
      len: 0,
      x: s.x,
      y: s.y,
      px: s.x,
      py: s.y,
      state: 'move',
      lootT: 0,
      inside: at,
    };
    for (const [site, r] of this.rumors) party.known.set(site, r.room);
    return party;
  }

  spawnParty(champion: boolean): void {
    const rng = this.rng;
    const size = Math.max(1, Math.min(BALANCE.partySizeMax, Math.round(this.partySize() + rng.range(-0.5, 0.5))));
    const levelF = this.partyLevel();
    const group = ++this.partyCount;
    let trapRumors = 0;
    for (const r of this.rumors.values()) if (ROOMS[r.room].kind === 'trap') trapRumors++;
    let lairs = 0;
    for (const r of this.rooms.values()) if (ROOMS[r.id].kind === 'monster') lairs++;
    const weights: [HeroClass, number][] = [
      ['knight', 1 + Math.min(1.2, lairs * 0.12)],
      ['rogue', 0.8 + Math.min(2, trapRumors * 0.35)],
      ['cleric', 0.8 + Math.min(1, this.escaped * 0.02)],
    ];
    const members: Hero[] = [];
    for (let k = 0; k < size; k++) {
      const level = Math.max(1, Math.round(levelF + rng.range(-0.6, 0.6)));
      members.push(this.makeHero(rng.weighted(weights), level, group, null));
    }
    let champName: string | null = null;
    if (champion) {
      champName = rng.pick(CHAMPION_NAMES);
      const cls = rng.pick(['knight', 'rogue', 'cleric'] as HeroClass[]);
      members.unshift(this.makeHero(cls, Math.round(levelF) + BALANCE.championLevelBonus, group, champName));
    }
    this.groups.set(group, { size: members.length, died: 0, escaped: 0, done: false });
    // Knights lead, Clerics stay in the middle.
    const order = { knight: 0, cleric: 1, rogue: 2 };
    members.sort((a, b) => order[a.cls] - order[b.cls]);
    this.pending.push({ party: this.newParty(members, this.cave.gate), delay: 0 });
    this.events.push({ t: 'party', size: members.length, level: Math.round(levelF), champion: champName });
  }

  /** Adds a party right now (tests and debugging). */
  spawnHeroes(classes: HeroClass[], level = 1): Party {
    const group = ++this.partyCount;
    const members = classes.map((c) => this.makeHero(c, level, group, null));
    this.groups.set(group, { size: members.length, died: 0, escaped: 0, done: false });
    const party = this.newParty(members, this.cave.gate);
    this.parties.push(party);
    this.plan(party);
    return party;
  }

  private makeHero(cls: HeroClass, level: number, group: number, champion: string | null): Hero {
    const def = HEROES[cls];
    const maxHp = def.hp * heroHpMul(level) * (champion ? BALANCE.championHpMul : 1);
    return {
      id: this.nextId++,
      cls,
      level,
      champion,
      group,
      hp: maxHp,
      maxHp,
      dmg: def.dmg * heroDmgMul(level) * (champion ? BALANCE.championDmgMul : 1),
      cooldown: def.cooldown,
      speed: def.speed * this.rng.range(0.95, 1.05),
      armor: def.armor * (1 + 0.15 * (level - 1)),
      atk: 0,
      healT: def.heal?.interval ?? 0,
      loot: 0,
      lootsLeft: cls === 'rogue' ? 2 : 1,
      bites: 0,
      sticky: 0,
      oily: 0,
      burning: 0,
      burnDps: 0,
      bleed: 0,
      bleedDps: 0,
      poison: 0,
      poisonDps: 0,
      cursed: 0,
      cursedDps: 0,
      dotAcc: 0,
      dead: false,
      lastHitAt: -10,
      lastAttackAt: -10,
    };
  }

  // ------------------------------------------------------------ parties: routing

  /** How dangerous heroes believe a site is, from what they know. */
  private believedDanger(site: number, known: Map<number, RoomId>): number {
    const room = this.rooms.get(site);
    if (!room) return 0;
    const k = known.get(site);
    if (!k) return ROOMS[room.id].kind === 'lure' || room.id === 'mimicVault' ? 0 : BALANCE.unknownRoomFear;
    if (k === 'vault') return 0;
    const ranks = k === room.id ? room.ranks[0] + room.ranks[1] + room.ranks[2] : 0;
    return ROOMS[k].danger + ranks * BALANCE.dangerPerRank;
  }

  /** Dijkstra over dug corridors. Cost is seconds of walking plus fear of what lies ahead. */
  private routeField(start: number, speed: number, fear: number, known: Map<number, RoomId>): { dist: number[]; prev: number[] } {
    const n = this.cave.sites.length;
    const dist = new Array<number>(n).fill(Infinity);
    const prev = new Array<number>(n).fill(-1);
    const done = new Array<boolean>(n).fill(false);
    dist[start] = 0;
    for (;;) {
      let u = -1;
      for (let i = 0; i < n; i++) if (!done[i] && Number.isFinite(dist[i]) && (u < 0 || dist[i] < dist[u])) u = i;
      if (u < 0) break;
      done[u] = true;
      for (const eid of this.cave.adj[u]) {
        if (!this.dug.has(eid)) continue;
        const e = this.cave.edges[eid];
        const v = otherEnd(e, u);
        if (!this.isExcavated(v)) continue;
        const c = e.len / speed + fear * BALANCE.fearScale * this.believedDanger(v, known);
        if (dist[u] + c < dist[v]) {
          dist[v] = dist[u] + c;
          prev[v] = u;
        }
      }
    }
    return { dist, prev };
  }

  private pathFrom(prev: number[], start: number, goal: number): number[] | null {
    if (goal === start) return [start];
    if (prev[goal] < 0) return null;
    const out: number[] = [];
    for (let c = goal; c !== -1; c = prev[c]) {
      out.push(c);
      if (c === start) break;
    }
    if (out[out.length - 1] !== start) return null;
    return out.reverse();
  }

  /** Vault sites (including disguised Mimics) the heroes can see glittering. */
  private vaultSites(known: Map<number, RoomId>): number[] {
    const out: number[] = [];
    for (const r of this.rooms.values()) {
      if (r.id === 'vault' || (r.id === 'mimicVault' && known.get(r.site) !== 'mimicVault')) out.push(r.site);
    }
    return out;
  }

  private vaultAppeal(site: number): number {
    const r = this.rooms.get(site);
    const rank = r?.id === 'vault' ? r.ranks[0] : 0;
    return BALANCE.vaultAppeal * (1 + 0.35 * rank);
  }

  /** Best treasure detour for given weights: [site, score] or null. */
  private bestVault(start: number, speed: number, fear: number, greed: number, known: Map<number, RoomId>, looted: Set<number>): [number, number] | null {
    if (greed <= 0) return null;
    const vaults = this.vaultSites(known).filter((v) => !looted.has(v));
    if (!vaults.length) return null;
    const a = this.routeField(start, speed, fear, known);
    const b = this.routeField(this.cave.maw, speed, fear, known);
    const direct = a.dist[this.cave.maw];
    let best: [number, number] | null = null;
    for (const v of vaults) {
      if (!Number.isFinite(a.dist[v])) continue;
      const detour = a.dist[v] + b.dist[v] - direct;
      const score = greed * this.vaultAppeal(v) - detour * BALANCE.detourWeight;
      if (score > 0 && (!best || score > best[1])) best = [v, score];
    }
    return best;
  }

  private partyWeights(p: Party): { speed: number; fear: number; greed: number } {
    let fear = 0;
    let greed = 0;
    let speed = Infinity;
    for (const h of p.members) {
      const def = HEROES[h.cls];
      fear += def.fear * (h.champion ? 0.3 : 1);
      greed += def.greed;
      speed = Math.min(speed, h.speed);
    }
    const n = Math.max(1, p.members.length);
    return { speed: Number.isFinite(speed) ? speed : 2, fear: (fear / n) * (p.goal === 'flee' ? 1.5 : 1), greed: greed / n };
  }

  /** Pick a destination and route from the site the party is standing at. */
  private plan(p: Party): void {
    const at = p.to;
    const w = this.partyWeights(p);
    if (p.goal === 'flee') {
      p.target = this.cave.gate;
    } else {
      p.goal = 'maw';
      p.target = this.cave.maw;
      const best = this.bestVault(at, w.speed, w.fear, w.greed, p.known, p.looted);
      if (best) {
        p.goal = 'loot';
        p.target = best[0];
      }
    }
    const field = this.routeField(at, w.speed, w.fear, p.known);
    p.route = this.pathFrom(field.prev, at, p.target) ?? [at];
  }

  /** The route a party of one hero of this class would take from the gate right now. */
  previewRoute(cls: HeroClass): number[] {
    const def = HEROES[cls];
    const known = new Map<number, RoomId>();
    for (const [site, r] of this.rumors) known.set(site, r.room);
    const gate = this.cave.gate;
    const best = this.bestVault(gate, def.speed, def.fear, def.greed, known, new Set());
    const field = this.routeField(gate, def.speed, def.fear, known);
    if (!best) return this.pathFrom(field.prev, gate, this.cave.maw) ?? [];
    const first = this.pathFrom(field.prev, gate, best[0]) ?? [];
    const second = this.pathFrom(this.routeField(best[0], def.speed, def.fear, known).prev, best[0], this.cave.maw) ?? [];
    return [...first, ...second.slice(1)];
  }

  // ------------------------------------------------------------ parties: movement

  private speedOf(p: Party): number {
    let speed = Infinity;
    for (const h of p.members) {
      let s = h.speed;
      if (h.sticky > 0) s *= BALANCE.stickySlow;
      if (h.cursed > 0) s *= 0.75;
      speed = Math.min(speed, s);
    }
    if (!Number.isFinite(speed)) return 0;
    if (p.inside >= 0) speed *= this.roomSlow(p.inside);
    return speed;
  }

  /** Crossing-speed multiplier for a room. */
  private roomSlow(site: number): number {
    const r = this.rooms.get(site);
    let mul = 1;
    if (r?.id === 'oilCellar') mul /= 1.4 + 0.25 * r.ranks[1];
    if (r?.id === 'gloomHall') mul /= 1.4;
    if (r?.id === 'spiderNest') mul /= 1 + 0.25 * r.ranks[2];
    const gloom = this.linkedRooms(site, 'gloomHall');
    if (gloom.length) mul *= 1 - 0.1 * this.maxRank(gloom, 0);
    return mul;
  }

  private startSegment(p: Party, next: number): void {
    const e = this.edgeBetween(p.to, next);
    p.from = p.to;
    p.to = next;
    p.d = 0;
    p.len = e ? e.len : Math.hypot(this.site(next).x - this.site(p.from).x, this.site(next).y - this.site(p.from).y);
  }

  private tickParties(dt: number): void {
    for (const p of [...this.parties]) {
      if (!p.members.length) continue;
      if (p.state === 'fight') continue;
      if (p.state === 'bite') continue;
      if (p.state === 'loot') {
        p.lootT -= dt;
        if (p.lootT <= 0) this.finishLoot(p);
        continue;
      }
      // At a site center with nowhere to go yet?
      if (p.d >= p.len) {
        const idx = p.route.indexOf(p.to);
        const next = idx >= 0 ? p.route[idx + 1] : undefined;
        if (next === undefined || !this.edgeBetween(p.to, next) || !this.dug.has(this.edgeBetween(p.to, next)!.id)) {
          this.plan(p);
          const i2 = p.route.indexOf(p.to);
          const n2 = p.route[i2 + 1];
          if (n2 === undefined) continue;
          this.startSegment(p, n2);
        } else this.startSegment(p, next);
      }
      const a = this.site(p.from);
      const b = this.site(p.to);
      p.d = Math.min(p.len, p.d + this.speedOf(p) * dt);
      const t = p.len > 0 ? p.d / p.len : 1;
      p.x = a.x + (b.x - a.x) * t;
      p.y = a.y + (b.y - a.y) * t;
      const inside = this.inRect(p.to, p.x, p.y) ? p.to : this.inRect(p.from, p.x, p.y) ? p.from : -1;
      if (inside !== p.inside) {
        p.inside = inside;
        if (inside >= 0 && inside === p.to) this.onEnterRoom(p, inside);
      }
      if (p.d >= p.len) this.arrive(p);
    }
  }

  /** The party just stepped into a room's rectangle. */
  private onEnterRoom(p: Party, site: number): void {
    const r = this.rooms.get(site);
    if (!r) return;
    const def = ROOMS[r.id];
    if (def.kind !== 'trap') return;
    const hidden = this.linkedRooms(site, 'gloomHall').length > 0;
    // Rogues disarm traps they know about.
    if (!hidden && p.known.get(site) === r.id && !p.disarmed.has(site) && p.members.some((h) => h.cls === 'rogue')) {
      if (this.rng.chance(BALANCE.disarmChance)) {
        p.disarmed.add(site);
        this.events.push({ t: 'disarm', site });
        return;
      }
    }
    if (p.disarmed.has(site)) return;
    if (r.id === 'oilCellar') {
      for (const h of p.members) {
        if (h.oily <= 0) this.events.push({ t: 'status', heroId: h.id, status: 'oily' });
        h.oily = BALANCE.oilySeconds + 4 * r.ranks[0];
      }
      this.events.push({ t: 'trap', site, room: r.id });
    } else if (r.id === 'pitDrop') {
      const gullet = this.linkedRooms(site, 'gullet').length > 0;
      for (const h of [...p.members]) {
        let chance = 0.2 + 0.1 * r.ranks[0];
        if (h.oily > 0 || h.sticky > 0) chance += 0.15 * r.ranks[2];
        if (!this.rng.chance(chance)) continue;
        const eaten = gullet && !h.champion;
        this.events.push({ t: 'fall', heroId: h.id, site, eaten });
        this.events.push({ t: 'trap', site, room: r.id, heroId: h.id });
        if (eaten) this.killHero(h, p, site);
        else this.damageHero(h, p, 25 + 15 * r.ranks[1], { pierce: true });
      }
    } else {
      // Spikes and flames start their timers as the party walks in.
      r.trapT = Math.min(r.trapT, 0.4);
    }
  }

  /** The party reached the center of a site. */
  private arrive(p: Party): void {
    const site = p.to;
    const r = this.rooms.get(site);
    if (r && !(r.id === 'mimicVault' && p.known.get(site) !== 'mimicVault')) this.learn(p, site, r.id);
    if (r?.id === 'mimicVault' && !p.known.has(site)) p.known.set(site, 'vault');

    // Rogues peek into neighboring rooms.
    if (p.goal !== 'flee' && p.members.some((h) => h.cls === 'rogue')) {
      for (const n of this.linked(site)) {
        const nr = this.rooms.get(n);
        if (!nr || p.known.has(n)) continue;
        if (ROOMS[nr.id].kind === 'trap' && this.linkedRooms(n, 'gloomHall').length) continue;
        if (this.rng.chance(BALANCE.peekChance)) {
          p.known.set(n, nr.id === 'mimicVault' ? 'vault' : nr.id);
          this.events.push({ t: 'spotted', site: n });
        }
      }
    }

    if (site === this.cave.gate && p.goal === 'flee') {
      for (const h of [...p.members]) this.escape(h, p);
      return;
    }
    if (site === this.cave.maw && p.goal !== 'flee') {
      p.state = 'bite';
      return;
    }
    if (p.goal !== 'flee' && r && ROOMS[r.id].monster && this.standing(site).length) {
      p.state = 'fight';
      return;
    }
    if (p.goal === 'loot' && site === p.target) {
      if (r?.id === 'vault') {
        p.state = 'loot';
        p.lootT = BALANCE.lootSeconds + 1.5 * r.ranks[1];
        return;
      }
      p.looted.add(site);
      p.goal = 'maw';
    }
    if (p.goal !== 'flee') this.considerSplit(p, site);
    this.plan(p);
  }

  private learn(p: Party, site: number, id: RoomId): void {
    if (p.known.get(site) !== id) p.known.set(site, id);
  }

  /** A greedy Rogue may sneak off alone to raid a Vault the party would skip. */
  private considerSplit(p: Party, site: number): void {
    if (p.members.length < 2 || p.goal === 'loot') return;
    for (const h of [...p.members]) {
      if (h.cls !== 'rogue' || h.champion || h.lootsLeft <= 0) continue;
      const def = HEROES.rogue;
      const best = this.bestVault(site, h.speed, def.fear, def.greed, p.known, p.looted);
      if (!best || best[1] < BALANCE.rogueSplitScore) continue;
      const solo = this.split(p, h);
      solo.goal = 'loot';
      solo.target = best[0];
      this.events.push({ t: 'split', heroId: h.id, reason: 'loot' });
      this.plan(solo);
      return;
    }
  }

  /** Move a hero out of its party into a party of its own at the same spot. */
  private split(p: Party, h: Hero): Party {
    p.members = p.members.filter((m) => m !== h);
    const solo: Party = {
      ...p,
      id: this.nextId++,
      members: [h],
      known: new Map(p.known),
      disarmed: new Set(p.disarmed),
      looted: new Set(p.looted),
      route: [...p.route],
      state: 'move',
    };
    this.parties.push(solo);
    return solo;
  }

  private finishLoot(p: Party): void {
    const site = p.target;
    const r = this.rooms.get(site);
    for (const h of p.members) {
      const steal = Math.max(0, Math.min(this.gold * BALANCE.lootStealFraction, BALANCE.lootStealCapBase + BALANCE.lootStealCapPerLevel * h.level));
      this.gold -= steal;
      h.loot += steal;
      h.lootsLeft--;
      this.events.push({ t: 'loot', site, heroId: h.id, amount: steal });
      if (r?.id === 'vault' && r.ranks[2] > 0) {
        h.cursed = 6;
        h.cursedDps = 2 * r.ranks[2];
        this.events.push({ t: 'status', heroId: h.id, status: 'cursed' });
      }
    }
    p.looted.add(site);
    p.state = 'move';
    p.goal = 'maw';
    // A Rogue with its loot heads home rather than pushing on.
    if (p.members.length === 1 && p.members[0].cls === 'rogue') p.goal = 'flee';
    this.plan(p);
  }

  private startFleeing(p: Party, h: Hero): void {
    const solo = p.members.length > 1 ? this.split(p, h) : p;
    solo.goal = 'flee';
    if (solo.state === 'move' && solo.d < solo.len) {
      // Turn around in the corridor.
      const from = solo.from;
      solo.from = solo.to;
      solo.to = from;
      solo.d = solo.len - solo.d;
      solo.route = [solo.from, solo.to];
    } else {
      solo.state = 'move';
      this.plan(solo);
    }
    if (solo !== p) this.events.push({ t: 'split', heroId: h.id, reason: 'flee' });
  }

  // ------------------------------------------------------------ heroes: status effects and healing

  private partyOf(h: Hero): Party | undefined {
    return this.parties.find((p) => p.members.includes(h));
  }

  private tickHeroes(dt: number): void {
    for (const p of [...this.parties]) {
      const room = p.inside >= 0 ? this.rooms.get(p.inside) : undefined;
      for (const h of [...p.members]) {
        if (h.dead) continue;
        if (h.atk > 0) h.atk -= dt;
        if (h.sticky > 0) h.sticky -= dt;
        let dps = 0;
        if (h.oily > 0) {
          h.oily -= dt;
          const fumes = this.maxRankOfType('oilCellar', 2);
          if (fumes) dps += fumes;
        }
        if (h.burning > 0) {
          h.burning -= dt;
          dps += h.burnDps;
        }
        if (h.bleed > 0) {
          h.bleed -= dt;
          dps += h.bleedDps;
        }
        if (h.poison > 0) {
          h.poison -= dt;
          dps += h.poisonDps;
        }
        if (h.cursed > 0) {
          h.cursed -= dt;
          dps += h.cursedDps;
        }
        if (room?.id === 'gullet') dps += 3 * room.ranks[2];
        if (room?.id === 'soulWell') dps += 2 * room.ranks[2];
        if (dps > 0) {
          h.dotAcc += dps * dt;
          if (h.dotAcc >= 3) {
            const amt = h.dotAcc;
            h.dotAcc = 0;
            this.damageHero(h, p, amt, { pierce: true, dot: true });
            if (h.dead) continue;
          }
        }
        const def = HEROES[h.cls];
        if (def.heal) {
          h.healT -= dt;
          if (h.healT <= 0) {
            h.healT = def.heal.interval;
            let best: Hero | null = null;
            for (const o of p.members) if (!o.dead && o.hp < o.maxHp && (!best || o.hp / o.maxHp < best.hp / best.maxHp)) best = o;
            if (best) {
              const amt = Math.min(best.maxHp - best.hp, def.heal.amount * heroDmgMul(h.level));
              best.hp += amt;
              this.events.push({ t: 'heal', heroId: best.id, amount: amt });
            }
          }
        }
        if (p.goal !== 'flee' && def.fleeAt > 0 && !h.champion && h.hp / h.maxHp < def.fleeAt) this.startFleeing(p, h);
      }
    }
  }

  private maxRankOfType(id: RoomId, track: number): number {
    let m = 0;
    for (const r of this.rooms.values()) if (r.id === id) m = Math.max(m, r.ranks[track]);
    return m;
  }

  // ------------------------------------------------------------ combat

  /** Monsters in a room that are on their feet. */
  standing(site: number): Monster[] {
    return this.monsters.filter((m) => m.site === site && m.hp > 0 && m.down <= 0);
  }

  private tickRooms(dt: number): void {
    for (const r of this.rooms.values()) {
      const def = ROOMS[r.id];
      if (!def.monster) continue;
      const mul = this.respawnMul(r);
      r.slots.forEach((slot, s) => {
        if (slot.monsterId !== null) return;
        slot.respawn -= dt * mul;
        if (slot.respawn <= 0) {
          this.spawnMonster(r, s);
          this.events.push({ t: 'respawn', site: r.site, kind: def.monster! });
        }
      });
    }
    for (const m of this.monsters) {
      if (m.down > 0) {
        m.down -= dt;
        if (m.down <= 0) {
          const r = this.rooms.get(m.site);
          m.hp = m.maxHp * (0.5 + 0.15 * (r?.id === 'boneCrypt' ? r.ranks[2] : 0));
          this.events.push({ t: 'monsterUp', id: m.id, site: m.site });
        }
      }
    }
  }

  private tickCombat(dt: number): void {
    // Heroes inside each monster room
    const bySite = new Map<number, { p: Party; h: Hero }[]>();
    for (const p of this.parties) {
      if (p.inside < 0) continue;
      const r = this.rooms.get(p.inside);
      if (!r || !ROOMS[r.id].monster) continue;
      // A party walking up to a disguised Mimic is not attacked until it reaches the chest.
      if (r.id === 'mimicVault' && p.state !== 'fight' && p.d < p.len) continue;
      let list = bySite.get(p.inside);
      if (!list) bySite.set(p.inside, (list = []));
      for (const h of p.members) if (!h.dead) list.push({ p, h });
    }

    for (const m of this.monsters) {
      if (m.hp <= 0 || m.down > 0) continue;
      const r = this.rooms.get(m.site);
      if (!r) continue;
      if (m.atk > 0) m.atk -= dt;
      const targets = bySite.get(m.site) ?? [];
      if (!targets.length) {
        m.targetId = null;
        if (m.kind === 'mimic') m.ambush = true;
        const healing = this.linkedRooms(m.site, 'larder').length ? 3 : 0;
        if (healing && m.hp < m.maxHp) m.hp = Math.min(m.maxHp, m.hp + healing * dt);
        if (m.kind === 'troll') m.hp = Math.min(m.maxHp, m.hp + (4 + 3 * r.ranks[1]) * dt);
        continue;
      }
      if (m.kind === 'troll') m.hp = Math.min(m.maxHp, m.hp + (4 + 3 * r.ranks[1]) * dt);
      if (r.id === 'goblinWarren' && r.ranks[2] > 0) m.hp = Math.min(m.maxHp, m.hp + 2 * r.ranks[2] * dt);
      if (m.atk > 0) continue;
      m.atk = MONSTERS[m.kind].cooldown;
      m.lastAttackAt = this.time;
      // Knights draw attention.
      const knights = targets.filter((t) => t.h.cls === 'knight' && !t.h.dead);
      const pool = (knights.length ? knights : targets).filter((t) => !t.h.dead);
      if (!pool.length) continue;
      const first = pool[Math.floor(this.rng.next() * pool.length)];
      const hits = m.kind === 'troll' ? [first, ...targets.filter((t) => t !== first && !t.h.dead).slice(0, 1 + r.ranks[2])] : [first];
      let dmg = this.monsterDamage(m);
      let crit = false;
      if (m.kind === 'mimic' && m.ambush) {
        dmg *= 3;
        crit = true;
        m.ambush = false;
        this.events.push({ t: 'ambush', site: m.site });
        for (const t of targets) t.p.known.set(m.site, 'mimicVault');
        for (const t of targets) if (t.p.goal !== 'flee' && (t.p.state === 'move' || t.p.state === 'loot')) t.p.state = 'fight';
      }
      m.targetId = first.h.id;
      for (const t of hits) {
        this.damageHero(t.h, t.p, dmg, { crit });
        if (t.h.dead) {
          if (r.id === 'mimicVault' && r.ranks[2]) m.hp = Math.min(m.maxHp, m.hp + m.maxHp * 0.25 * r.ranks[2]);
          continue;
        }
        if (m.kind === 'slime' || m.kind === 'spider') {
          if (t.h.sticky <= 0) this.events.push({ t: 'status', heroId: t.h.id, status: 'sticky' });
          t.h.sticky = BALANCE.stickySeconds + (r.id === 'slimePit' ? 4 * r.ranks[1] : 0);
        }
        if (r.id === 'slimePit' && r.ranks[2]) {
          t.h.poison = 4;
          t.h.poisonDps = Math.max(t.h.poisonDps, 2 * r.ranks[2]);
        }
        if (m.kind === 'spider') {
          if (t.h.poison <= 0) this.events.push({ t: 'status', heroId: t.h.id, status: 'poison' });
          t.h.poison = 4;
          t.h.poisonDps = 2 + 2 * r.ranks[1];
        }
      }
    }

    // Heroes in a fight swing back.
    for (const p of this.parties) {
      if (p.state !== 'fight') continue;
      const site = p.to;
      const foes = this.standing(site);
      if (!foes.length) {
        p.state = 'move';
        const r = this.rooms.get(site);
        if (p.goal === 'loot' && site === p.target && r?.id === 'mimicVault') {
          p.looted.add(site);
          p.goal = 'maw';
        }
        this.considerSplit(p, site);
        this.plan(p);
        continue;
      }
      const dread = this.linkedRooms(site, 'gloomHall');
      const dmgMul = 1 - 0.1 * this.maxRank(dread, 2);
      for (const h of p.members) {
        if (h.dead || h.atk > 0) continue;
        h.atk = h.cooldown;
        h.lastAttackAt = this.time;
        const foe = foes.reduce((a, b) => (b.hp < a.hp ? b : a));
        this.damageMonster(foe, h.dmg * dmgMul);
      }
    }
  }

  private damageMonster(m: Monster, amount: number): void {
    const r = this.rooms.get(m.site);
    if (r?.id === 'boneCrypt') amount = Math.max(1, amount - 1.5 * r.ranks[1]);
    m.hp -= amount;
    m.lastHitAt = this.time;
    const s = this.site(m.site);
    this.events.push({ t: 'damage', x: s.x, y: s.y, amount, on: 'monster', id: m.id, site: m.site });
    if (m.hp > 0) return;
    if (m.kind === 'skeleton' && !m.reassembled) {
      m.reassembled = true;
      m.hp = 0.0001;
      m.down = 3;
      this.events.push({ t: 'monsterDown', id: m.id, site: m.site });
      return;
    }
    m.hp = 0;
    if (r && r.slots[m.slot]?.monsterId === m.id) {
      r.slots[m.slot].monsterId = null;
      r.slots[m.slot].respawn = ROOMS[r.id].respawn ?? 10;
    }
    this.events.push({ t: 'monsterDied', id: m.id, site: m.site, kind: m.kind });
  }

  damageHero(h: Hero, p: Party | undefined, amount: number, opts: { pierce?: boolean; crit?: boolean; dot?: boolean } = {}): void {
    if (h.dead) return;
    const dmg = opts.pierce ? amount : Math.max(1, amount - h.armor);
    h.hp -= dmg;
    h.lastHitAt = this.time;
    const party = p ?? this.partyOf(h);
    this.events.push({ t: 'damage', x: party?.x ?? 0, y: party?.y ?? 0, amount: dmg, on: 'hero', id: h.id, site: party?.inside ?? -1, crit: opts.crit, dot: opts.dot });
    if (h.hp <= 0) this.killHero(h, party, party?.inside ?? -1);
  }

  private killHero(h: Hero, p: Party | undefined, site: number): void {
    if (h.dead) return;
    h.dead = true;
    h.hp = 0;
    const def = HEROES[h.cls];
    const champMul = h.champion ? BALANCE.championRewardMul : 1;
    const gullets = site >= 0 ? [...(this.rooms.get(site)?.id === 'gullet' ? [this.rooms.get(site)!] : []), ...this.linkedRooms(site, 'gullet')] : [];
    const bonus = gullets.length > 0;
    const goldMul = bonus ? 1.5 + 0.15 * this.maxRank(gullets, 0) : 1;
    const essMul = bonus ? 1.5 + 0.25 * this.maxRank(gullets, 1) : 1;
    const reward = def.gold * heroRewardMul(h.level) * this.mods.rewardMul * goldMul * champMul;
    let essence = (BALANCE.essenceBase + BALANCE.essencePerLevel * h.level) * this.mods.rewardMul * essMul * champMul;
    if (site >= 0) {
      const wells = this.linkedRooms(site, 'soulWell');
      if (this.rooms.get(site)?.id === 'soulWell') wells.push(this.rooms.get(site)!);
      for (const w of wells) essence += 2 + 2 * w.ranks[1];
    }
    const infamy = def.infamy * h.level * champMul;
    this.gold += reward + h.loot;
    this.essence += essence;
    this.goldFromKills += reward;
    this.essenceFromKills += essence;
    this.infamy += infamy;
    this.eaten++;
    if (h.champion) this.champions++;
    const g = this.groups.get(h.group);
    if (g) g.died++;
    this.events.push({ t: 'heroDied', id: h.id, x: p?.x ?? 0, y: p?.y ?? 0, site, gold: reward + h.loot, essence, infamy, cls: h.cls, champion: h.champion, bonus });
  }

  private escape(h: Hero, p: Party): void {
    h.dead = true;
    this.escaped++;
    const g = this.groups.get(h.group);
    if (g) g.escaped++;
    const until = this.time + BALANCE.rumorSeconds;
    let rumors = 0;
    for (const [site, id] of p.known) {
      const room = this.rooms.get(site);
      if (!room) continue;
      // Gloom can make survivors forget, and a good Mimic stays secret.
      const gloom = this.linkedRooms(site, 'gloomHall');
      if (gloom.length && this.rng.chance(0.33 * this.maxRank(gloom, 1))) continue;
      let report = id;
      if (id === 'mimicVault' && room.id === 'mimicVault' && this.rng.chance(0.33 * room.ranks[1])) report = 'vault';
      if (report === 'vault' && room.id === 'vault') continue;
      if (ROOMS[report].kind === 'support' || ROOMS[report].kind === 'economy') continue;
      this.rumors.set(site, { room: report, until });
      rumors++;
    }
    this.events.push({ t: 'escaped', cls: h.cls, loot: h.loot, rumors });
  }

  // ------------------------------------------------------------ traps

  private tickTraps(dt: number): void {
    for (const r of this.rooms.values()) {
      if (r.id !== 'spikeHall' && r.id !== 'flameGallery') continue;
      const inside = this.parties.filter((p) => p.inside === r.site && !p.disarmed.has(r.site) && p.members.length);
      if (!inside.length) {
        r.trapT = 0.5;
        continue;
      }
      r.trapT -= dt;
      if (r.trapT > 0) continue;
      if (r.id === 'spikeHall') {
        r.trapT = 1.5 * (1 - 0.2 * r.ranks[1]);
        const p = inside[Math.floor(this.rng.next() * inside.length)];
        const alive = p.members.filter((h) => !h.dead);
        const h = alive[Math.floor(this.rng.next() * alive.length)];
        if (!h) continue;
        const crit = h.sticky > 0;
        const dmg = 14 * (1 + 0.4 * r.ranks[0]) * (crit ? 2 : 1);
        this.events.push({ t: 'trap', site: r.site, room: r.id, heroId: h.id, crit });
        this.learnAll(inside, r.site, r.id);
        this.damageHero(h, p, dmg, { crit });
        if (!h.dead && r.ranks[2]) {
          h.bleed = 4;
          h.bleedDps = r.ranks[2] + 1;
        }
      } else {
        r.trapT = 2.2 * (1 - 0.18 * r.ranks[1]);
        this.events.push({ t: 'trap', site: r.site, room: r.id });
        this.learnAll(inside, r.site, r.id);
        for (const p of inside) {
          for (const h of [...p.members]) {
            if (h.dead) continue;
            if (h.oily > 0) {
              h.oily = 0;
              h.burning = BALANCE.burnSeconds + 2 * r.ranks[2];
              h.burnDps = BALANCE.burnDps * (1 + 0.2 * r.ranks[2]);
              this.events.push({ t: 'ignite', heroId: h.id });
            }
            this.damageHero(h, p, 9 * (1 + 0.35 * r.ranks[0]));
          }
        }
      }
    }
  }

  private learnAll(parties: Party[], site: number, id: RoomId): void {
    for (const p of parties) this.learn(p, site, id);
  }

  // ------------------------------------------------------------ the Maw

  private tickMaw(dt: number): void {
    const maw = this.cave.maw;
    if (this.mawChompT > 0) this.mawChompT -= dt;
    let biting = false;
    let target: { p: Party; h: Hero } | null = null;
    for (const p of this.parties) {
      if (p.inside !== maw) continue;
      for (const h of p.members) {
        if (h.dead) continue;
        if (p.state === 'bite') {
          biting = true;
          if (h.atk <= 0) {
            h.atk = h.cooldown;
            h.lastAttackAt = this.time;
            const dmg = h.dmg * BALANCE.biteDamageMul;
            this.mawHp -= dmg;
            this.mawLastHitAt = this.time;
            const stolen = Math.max(0, this.gold * BALANCE.biteStealFraction);
            this.gold -= stolen;
            h.loot += stolen;
            h.bites++;
            this.events.push({ t: 'bite', heroId: h.id, amount: dmg, stolen });
          }
        }
        if (!target || (p.state === 'bite' && target.p.state !== 'bite')) target = { p, h };
      }
    }
    if (target && this.mawChompT <= 0) {
      this.mawChompT = BALANCE.mawChompCooldown;
      this.mawLastChompAt = this.time;
      this.events.push({ t: 'chomp', heroId: target.h.id });
      this.damageHero(target.h, target.p, this.mawChompDamage, { pierce: true });
    }
    // Heroes who have bitten their fill run home.
    for (const p of [...this.parties]) {
      if (p.state !== 'bite') continue;
      for (const h of [...p.members]) if (!h.dead && h.bites >= BALANCE.bitesBeforeFlee) this.startFleeing(p, h);
    }
    if (!biting && this.mawHp < this.mawMaxHp) this.mawHp = Math.min(this.mawMaxHp, this.mawHp + BALANCE.mawRegen * dt);
  }

  // ------------------------------------------------------------ bookkeeping

  private cleanup(): void {
    for (const p of this.parties) p.members = p.members.filter((h) => !h.dead);
    this.parties = this.parties.filter((p) => p.members.length > 0);
    this.monsters = this.monsters.filter((m) => m.hp > 0 || m.down > 0);
    for (const [id, g] of this.groups) {
      if (g.done || g.died + g.escaped < g.size) continue;
      g.done = true;
      if (g.escaped === 0) {
        const bonus = BALANCE.partyWipeInfamyPerHero * g.size;
        this.infamy += bonus;
        this.events.push({ t: 'wipe', size: g.size, infamy: bonus });
      }
      if (this.groups.size > 60) this.groups.delete(id);
    }
  }

  private tickRumors(dt: number): void {
    this.rumorCheckT -= dt;
    if (this.rumorCheckT > 0) return;
    this.rumorCheckT = 1;
    for (const [site, r] of this.rumors) if (r.until <= this.time) this.rumors.delete(site);
  }

  private checkUnlocks(silent: boolean): void {
    while (this.tier + 1 < BALANCE.tierInfamy.length && this.infamy >= BALANCE.tierInfamy[this.tier + 1]) {
      this.tier++;
      if (!silent) this.events.push({ t: 'unlock', tier: this.tier });
    }
  }

  /** Rooms unlocked at a tier, for the HUD. */
  roomsInTier(tier: number): RoomId[] {
    return ROOM_ORDER.filter((id) => ROOMS[id].tier === tier && this.isUnlocked(id));
  }

  toSave(): RunSave {
    return {
      v: 2,
      seed: this.seed,
      rng: this.rng.state,
      time: this.time,
      gold: this.gold,
      essence: this.essence,
      infamy: this.infamy,
      eaten: this.eaten,
      escaped: this.escaped,
      champions: this.champions,
      goldFromKills: this.goldFromKills,
      essenceFromKills: this.essenceFromKills,
      mawHp: this.mawHp,
      mawLevel: this.mawLevel,
      rooms: [...this.rooms.values()].map((r) => ({ site: r.site, id: r.id, ranks: [...r.ranks] as [number, number, number], invested: { ...r.invested } })),
      dug: [...this.dug],
      excavated: [...this.excavated],
      rumors: [...this.rumors].map(([site, r]) => ({ site, room: r.room, until: r.until })),
      nextPartyIn: this.nextPartyIn,
      nextChampionAt: this.nextChampionAt,
      partyCount: this.partyCount,
      tier: this.tier,
    };
  }
}
