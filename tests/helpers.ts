import type { Cave, Edge, Site } from '../src/sim/cave';
import type { HeroClass, RoomId } from '../src/sim/content';
import { newMeta, type MetaState } from '../src/sim/meta';
import { Sim, type Party, type SimEvent } from '../src/sim/sim';

/**
 * A hand-made cave so tests know exactly where everything is.
 *
 *        G(0)
 *         |
 *   S(6)-A(2)----B(3)
 *         |       |
 *        E(8)     |
 *         |       |
 *   X(7)-C(4)----D(5)
 *         |
 *        M(1)
 *
 * G-A-E-C-M is dug at the start. A-B-D-C is a longer way around E. S hangs off A.
 * X is in region 1 (not excavated); everything else is region 0.
 */
export function testCave(): Cave {
  const sites: Site[] = [];
  const add = (x: number, y: number, kind: Site['kind'], region = 0) =>
    sites.push({ id: sites.length, x, y, w: kind === 'maw' ? 9 : 7, h: kind === 'maw' ? 7 : 5, region, kind });
  add(20, 4, 'gate'); // 0
  add(20, 44, 'maw'); // 1
  add(20, 16, 'site'); // 2 A
  add(36, 16, 'site'); // 3 B
  add(20, 30, 'site'); // 4 C
  add(36, 30, 'site'); // 5 D
  add(6, 16, 'site'); // 6 S
  add(6, 30, 'site', 1); // 7 X
  add(20, 23, 'site'); // 8 E
  const pairs: [number, number][] = [
    [0, 2],
    [2, 8],
    [8, 4],
    [4, 1],
    [2, 3],
    [3, 5],
    [5, 4],
    [2, 6],
    [4, 7],
  ];
  const edges: Edge[] = pairs.map(([a, b], id) => ({ id, a, b, len: Math.hypot(sites[a].x - sites[b].x, sites[a].y - sites[b].y) }));
  const adj = sites.map((s) => edges.filter((e) => e.a === s.id || e.b === s.id).map((e) => e.id));
  return { w: 50, h: 50, sites, edges, adj, gate: 0, maw: 1, startRoute: [0, 2, 8, 4, 1], regionCount: 2 };
}

export const A = 2;
export const B = 3;
export const C = 4;
export const D = 5;
export const S = 6;
export const X = 7;
export const E = 8;

/** A sim in the test cave with no automatic parties and plenty of money. */
export function testSim(meta: MetaState = newMeta()): Sim {
  const sim = new Sim(meta, 7, undefined, testCave());
  sim.nextPartyIn = 1e9;
  sim.nextChampionAt = 1e9;
  sim.gold = 10_000;
  sim.essence = 10_000;
  return sim;
}

export function edge(sim: Sim, a: number, b: number): number {
  const e = sim.edgeBetween(a, b);
  if (!e) throw new Error(`no edge ${a}-${b}`);
  return e.id;
}

export function build(sim: Sim, site: number, id: RoomId): void {
  sim.tier = 3;
  const r = sim.build(site, id);
  if (!r.ok) throw new Error(`build ${id} at ${site}: ${r.reason}`);
}

export function party(sim: Sim, classes: HeroClass[], level = 1): Party {
  return sim.spawnHeroes(classes, level);
}

export function run(sim: Sim, seconds: number, collect?: SimEvent[]): void {
  const ticks = Math.round(seconds / 0.05);
  for (let k = 0; k < ticks; k++) {
    sim.tick();
    if (collect) collect.push(...sim.events);
    sim.events.length = 0;
  }
}

/** Run until a predicate holds (or a time limit passes). Returns seconds taken. */
export function runUntil(sim: Sim, done: () => boolean, maxSeconds: number, collect?: SimEvent[]): number {
  const t0 = sim.time;
  while (!done() && sim.time - t0 < maxSeconds) run(sim, 0.05, collect);
  return sim.time - t0;
}

export { newMeta };
