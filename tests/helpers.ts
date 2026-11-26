import { newMeta, type MetaState } from '../src/sim/meta';
import { Sim, type SimEvent } from '../src/sim/sim';

/**
 * A sim with no automatic parties and only the tiles we carve.
 * Entrance is (0,6) and the Maw is (15,14) (see BALANCE).
 */
export function blankSim(meta: MetaState = newMeta()): Sim {
  const sim = new Sim(meta, 7);
  const g = sim.grid;
  for (let i = 0; i < g.kinds.length; i++) {
    if (g.kinds[i] === 'floor' || g.kinds[i] === 'bedrock') g.kinds[i] = 'rock';
    g.features[i] = null;
  }
  sim.monsters = [];
  sim.nextPartyIn = 1e9;
  sim.nextChampionAt = 1e9;
  sim.gold = 10_000;
  g.touch();
  return sim;
}

/** Carves a straight horizontal or vertical run of floor. */
export function carve(sim: Sim, x0: number, y0: number, x1: number, y1: number): void {
  const g = sim.grid;
  const dx = Math.sign(x1 - x0);
  const dy = Math.sign(y1 - y0);
  let x = x0;
  let y = y0;
  for (;;) {
    const i = g.idx(x, y);
    if (g.kinds[i] === 'rock' || g.kinds[i] === 'bedrock') g.kinds[i] = 'floor';
    if (x === x1 && y === y1) break;
    x += dx;
    y += dy;
  }
  g.touch();
}

/** The default L-shaped route: (0..7,6) -> (7,6..14) -> (7..15,14). */
export function carveMainRoute(sim: Sim): void {
  carve(sim, 0, 6, 7, 6);
  carve(sim, 7, 6, 7, 14);
  carve(sim, 7, 14, 15, 14);
}

/** A bypass that skips the middle of the main route: (3,6)->(3,2)->(11,2)->(11,14). Six steps longer. */
export function carveBypass(sim: Sim): void {
  carve(sim, 3, 6, 3, 2);
  carve(sim, 3, 2, 11, 2);
  carve(sim, 11, 2, 11, 14);
}

export function run(sim: Sim, seconds: number, collect?: SimEvent[]): void {
  const ticks = Math.round(seconds / 0.05);
  for (let k = 0; k < ticks; k++) {
    sim.tick();
    if (collect) collect.push(...sim.events);
    sim.events.length = 0;
  }
}

export function place(sim: Sim, x: number, y: number, id: Parameters<Sim['place']>[1]): number {
  const i = sim.grid.idx(x, y);
  sim.unlocked.add(id);
  const r = sim.place(i, id);
  if (!r.ok) throw new Error(`place ${id} at ${x},${y}: ${r.reason}`);
  return i;
}
