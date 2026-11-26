import { ROOMS, type RoomId } from './content';
import type { Sim } from './sim';

/**
 * A scripted player used by the balance tests (and the title-screen backdrop).
 * 'basic' plays like a new player: monster rooms and spike halls on the starting route.
 * 'good' also lengthens the route, places support rooms where they help,
 * excavates, upgrades rooms and feeds the Maw.
 */
export type BotSkill = 'idle' | 'basic' | 'good';

const GOOD_SEQUENCE: RoomId[] = [
  'goblinWarren',
  'spikeHall',
  'vault',
  'larder',
  'slimePit',
  'spikeHall',
  'oilCellar',
  'flameGallery',
  'gloomHall',
  'soulWell',
  'goblinWarren',
  'gullet',
  'boneCrypt',
  'spiderNest',
  'flameGallery',
  'pitDrop',
  'mimicVault',
  'trollDen',
  'spikeHall',
  'boneCrypt',
];

const BASIC_SEQUENCE: RoomId[] = ['goblinWarren', 'spikeHall'];

/** Rooms that belong beside the route rather than on it. */
const SIDE: Partial<Record<RoomId, (sim: Sim, site: number) => boolean>> = {
  vault: () => true,
  mimicVault: () => true,
  soulWell: (sim, s) => ROOMS[sim.rooms.get(s)?.id ?? 'vault'].kind === 'monster',
  larder: (sim, s) => ROOMS[sim.rooms.get(s)?.id ?? 'vault'].kind === 'monster',
  gloomHall: (sim, s) => ROOMS[sim.rooms.get(s)?.id ?? 'vault'].kind === 'trap',
  gullet: (sim, s) => {
    const k = ROOMS[sim.rooms.get(s)?.id ?? 'vault'].kind;
    return k === 'monster' || k === 'trap';
  },
};

export class Bot {
  private seqIdx = 0;
  private thinkT = 0;
  private waitT = 0;

  constructor(
    private sim: Sim,
    readonly skill: BotSkill,
  ) {}

  update(dt: number): void {
    if (this.skill === 'idle') return;
    this.thinkT -= dt;
    if (this.thinkT > 0) return;
    this.thinkT = 1;
    for (let k = 0; k < 4; k++) if (!this.act()) break;
  }

  private act(): boolean {
    const sim = this.sim;
    const good = this.skill === 'good';

    if (good) {
      const mawCost = sim.mawUpgradeCost();
      const wantLevel = 1 + Math.floor(sim.minutes / 6);
      if (mawCost !== null && sim.gold >= mawCost && ((sim.mawLevel < wantLevel && sim.mawHp < sim.mawMaxHp * 0.8) || sim.gold >= mawCost * 3)) {
        return sim.upgradeMaw().ok;
      }
    }

    const route = sim.previewRoute('knight');
    const onRoute = new Set(route);
    const free = route.filter((s) => sim.site(s).kind === 'site' && !sim.rooms.has(s));

    const seq = good ? GOOD_SEQUENCE : BASIC_SEQUENCE;
    let want: RoomId | null = null;
    for (let k = 0; k < seq.length; k++) {
      const id = seq[(this.seqIdx + k) % seq.length];
      if (sim.isUnlocked(id)) {
        want = id;
        this.seqIdx = (this.seqIdx + k) % seq.length;
        break;
      }
    }

    if (want) {
      const cost = sim.roomCost(want);
      if (sim.gold >= cost.gold + 30 && sim.essence >= cost.essence) {
        const side = SIDE[want];
        if (side && good) {
          if (this.placeSide(want, route, onRoute, side)) {
            this.seqIdx++;
            this.waitT = 0;
            return true;
          }
          this.seqIdx++;
        } else if (!side && free.length) {
          const site = free[Math.floor(free.length / 2)];
          if (sim.build(site, want).ok) {
            this.seqIdx++;
            this.waitT = 0;
            return true;
          }
        } else if (!side && good && this.extendRoute(route, onRoute)) {
          return true;
        }
      }
    }

    if (!good) return false;

    // Excavate when there is nowhere left to grow.
    const regions = sim.excavatable();
    if (regions.length && sim.essence >= sim.excavateCost() + 10 && free.length === 0) {
      if (sim.excavate(regions[0]).ok) return true;
    }

    // Spend spare Gold on upgrades.
    this.waitT++;
    if (this.waitT > 6 || !want || sim.gold > sim.roomCost(want).gold * 2) {
      let best: [number, number, number] | null = null;
      for (const site of route) {
        const r = sim.rooms.get(site);
        if (!r) continue;
        for (let t = 0; t < 3; t++) {
          const c = sim.upgradeCost(site, t);
          if (!c || sim.essence < c.essence) continue;
          if (!best || c.gold < best[2]) best = [site, t, c.gold];
        }
      }
      if (best && sim.gold >= best[2]) {
        this.waitT = 0;
        return sim.upgrade(best[0], best[1]).ok;
      }
    }
    return false;
  }

  /** Put a room on an empty site next to the route, linked to a room it helps. */
  private placeSide(id: RoomId, route: number[], onRoute: Set<number>, wants: (sim: Sim, site: number) => boolean): boolean {
    const sim = this.sim;
    for (const r of route) {
      if (!wants(sim, r)) continue;
      for (const eid of sim.cave.adj[r]) {
        const e = sim.cave.edges[eid];
        const s = e.a === r ? e.b : e.a;
        if (onRoute.has(s) || sim.site(s).kind !== 'site' || sim.rooms.has(s) || !sim.isExcavated(s)) continue;
        if (!sim.dug.has(eid) && !sim.dig(eid).ok) continue;
        return sim.build(s, id).ok;
      }
    }
    return false;
  }

  /** Swap a direct corridor A-B for a detour A-...-B through unused sites (up to 3 new sites). */
  private extendRoute(route: number[], onRoute: Set<number>): boolean {
    const sim = this.sim;
    for (let i = 0; i + 1 < route.length; i++) {
      const a = route[i];
      const b = route[i + 1];
      const ab = sim.edgeBetween(a, b);
      if (!ab) continue;
      // Breadth-first search from a to b through empty, excavated, off-route sites.
      const prev = new Map<number, number>([[a, -1]]);
      let frontier = [a];
      let found = false;
      for (let depth = 0; depth < 4 && !found; depth++) {
        const next: number[] = [];
        for (const u of frontier) {
          for (const eid of sim.cave.adj[u]) {
            if (eid === ab.id) continue;
            const e = sim.cave.edges[eid];
            const v = e.a === u ? e.b : e.a;
            if (prev.has(v)) continue;
            if (v === b && u !== a) {
              prev.set(v, u);
              found = true;
              break;
            }
            if (onRoute.has(v) || sim.site(v).kind !== 'site' || !sim.isExcavated(v) || sim.rooms.has(v)) continue;
            prev.set(v, u);
            next.push(v);
          }
          if (found) break;
        }
        frontier = next;
      }
      if (!found) continue;
      const path: number[] = [];
      for (let c = b; c !== -1; c = prev.get(c)!) path.push(c);
      const edges = path.slice(1).map((c, k) => sim.edgeBetween(c, path[k])!);
      const cost = edges.reduce((sum, e) => sum + (sim.dug.has(e.id) ? 0 : sim.corridorCost(e.id)), 0);
      if (sim.gold < cost + 40) return false;
      for (const e of edges) if (!sim.dug.has(e.id)) sim.dig(e.id);
      sim.fill(ab.id);
      return true;
    }
    return false;
  }
}

export interface BotRunResult {
  minutes: number;
  infamy: number;
  eaten: number;
  escaped: number;
  collapsed: boolean;
}

/** Plays a whole dungeon headless until it collapses or the time limit passes. */
export function playOut(sim: Sim, skill: BotSkill, maxMinutes: number): BotRunResult {
  const bot = new Bot(sim, skill);
  const dt = 0.05;
  const maxTicks = Math.ceil((maxMinutes * 60) / dt);
  for (let k = 0; k < maxTicks && !sim.collapsed; k++) {
    bot.update(dt);
    sim.tick();
    sim.events.length = 0;
  }
  return { minutes: sim.minutes, infamy: sim.infamy, eaten: sim.eaten, escaped: sim.escaped, collapsed: sim.collapsed };
}
