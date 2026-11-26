import { FEATURES, type FeatureId } from './content';
import type { Sim } from './sim';

/**
 * A scripted player used by the balance tests (and the title-screen backdrop).
 * 'basic' plays like a new player: monsters and spikes along the main path.
 * 'good' also uses rooms, synergies, upgrades and the Maw.
 */
export type BotSkill = 'idle' | 'basic' | 'good';

const GOOD_SEQUENCE: FeatureId[] = [
  'goblinDen',
  'spikes',
  'hoard',
  'spikes',
  'goblinDen',
  'slimePit',
  'larder',
  'spikes',
  'oil',
  'gloom',
  'fireVent',
  'gullet',
  'slimePit',
  'spikes',
  'oil',
  'fireVent',
  'mimic',
  'goblinDen',
  'spikes',
  'fireVent',
];

const BASIC_SEQUENCE: FeatureId[] = ['goblinDen', 'spikes', 'spikes', 'goblinDen'];

export class Bot {
  private seqIdx = 0;
  private thinkT = 0;
  private waitT = 0;

  constructor(
    private sim: Sim,
    readonly skill: BotSkill,
  ) {}

  /** Call once per sim tick. */
  update(dt: number): void {
    if (this.skill === 'idle') return;
    this.thinkT -= dt;
    if (this.thinkT > 0) return;
    this.thinkT = 1;
    for (let k = 0; k < 4; k++) if (!this.act()) break;
  }

  private act(): boolean {
    const sim = this.sim;
    const g = sim.grid;
    const good = this.skill === 'good';

    if (good) {
      const mawCost = sim.mawUpgradeCost();
      const wantLevel = 1 + Math.floor(sim.minutes / 6);
      const spare = mawCost !== null && sim.gold >= mawCost * 3;
      if (mawCost !== null && sim.gold >= mawCost && ((sim.mawLevel < wantLevel && sim.mawHp < sim.mawMaxHp * 0.8) || spare)) {
        return sim.upgradeMaw().ok;
      }
    }

    const route = sim.previewRoute('knight');
    const free = route.filter((i) => g.kinds[i] === 'floor' && !g.features[i] && g.chebyshev(i, g.maw) > 1 && g.chebyshev(i, g.entrance) > 1);

    const seq = good ? GOOD_SEQUENCE : BASIC_SEQUENCE;
    let want: FeatureId | null = null;
    for (let k = 0; k < seq.length; k++) {
      const f = seq[(this.seqIdx + k) % seq.length];
      if (sim.unlocked.has(f)) {
        want = f;
        this.seqIdx = (this.seqIdx + k) % seq.length;
        break;
      }
    }

    // Rooms only pay off a few times; past that, skip them.
    const built = g.featureTiles();
    const tooEarly = built.length < 6 && want !== 'hoard';
    if (want && FEATURES[want].category === 'room' && (tooEarly || built.filter((t) => g.features[t]!.id === want).length >= 2)) {
      this.seqIdx++;
      want = null;
    }

    if (want && sim.gold >= sim.featureCost(want) + (FEATURES[want].category === 'room' ? sim.digCost : 0)) {
      const tile = this.chooseTile(want, route, free);
      if (tile !== null) {
        if (g.kinds[tile] === 'rock') sim.dig(tile);
        if (sim.place(tile, want).ok) {
          this.seqIdx++;
          this.waitT = 0;
          return true;
        }
      } else {
        this.seqIdx++;
      }
    }

    // Saving up for a while, or nowhere left to build: upgrade instead.
    this.waitT += 1;
    if (good && (this.waitT > 8 || free.length === 0 || !want || sim.gold > sim.featureCost(want) * 2)) {
      let best: number | null = null;
      let bestCost = Infinity;
      for (const t of g.featureTiles()) {
        const c = sim.upgradeCost(t);
        if (c !== null && c < bestCost) {
          bestCost = c;
          best = t;
        }
      }
      if (best !== null && sim.gold >= bestCost) {
        this.waitT = 0;
        return sim.upgrade(best).ok;
      }
    }
    return false;
  }

  private chooseTile(want: FeatureId, route: number[], free: number[]): number | null {
    const sim = this.sim;
    const g = sim.grid;
    const cat = FEATURES[want].category;
    if (cat !== 'room') {
      if (!free.length) return null;
      // Spread things out along the route, favoring synergy neighbors.
      let best = free[Math.floor(free.length / 2)];
      let bestScore = -Infinity;
      for (const t of free) {
        let score = -Math.abs(route.indexOf(t) - route.length * 0.55) * 0.2;
        if (want === 'spikes' && g.touches(t, 'slimePit')) score += 4;
        if (want === 'fireVent' && g.touches(t, 'oil')) score += 6;
        if (want === 'oil' && g.touches(t, 'fireVent')) score += 6;
        if (cat === 'trap' && g.touches(t, 'hoard')) score += 2;
        if (cat === 'trap' && g.neighbors8(t).some((n) => g.features[n] && FEATURES[g.features[n]!.id].category === 'trap')) score -= 1;
        if (score > bestScore) {
          bestScore = score;
          best = t;
        }
      }
      return best;
    }

    // Rooms go beside the route, digging a side pocket if needed.
    const onRoute = new Set(route);
    let best: number | null = null;
    let bestScore = -Infinity;
    for (const r of route) {
      for (const n of g.neighbors4(r)) {
        if (onRoute.has(n) || n === g.entrance || n === g.maw) continue;
        const k = g.kinds[n];
        if (!(k === 'rock' || (k === 'floor' && !g.features[n]))) continue;
        let score = 0;
        for (const m of g.neighbors8(n)) {
          const f = g.features[m];
          if (!f) continue;
          const c = FEATURES[f.id].category;
          if (want === 'larder' && c === 'lair') score += 3;
          if (want === 'hoard' && c === 'trap') score += 2;
          if (want === 'gloom' && c === 'trap') score += 2;
          if (want === 'gullet' && f.id !== 'gullet') score += 1;
        }
        if (k === 'rock') score -= 0.5;
        if (score > bestScore) {
          bestScore = score;
          best = n;
        }
      }
    }
    return best;
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
