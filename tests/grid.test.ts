import { describe, expect, it } from 'vitest';
import { Grid } from '../src/sim/grid';
import { newMeta } from '../src/sim/meta';
import { dijkstra, pathTo } from '../src/sim/pathfinding';
import { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';
import { blankSim, carve, carveBypass, carveMainRoute } from './helpers';

describe('Grid', () => {
  it('starts with the entrance connected to the Maw', () => {
    for (const seed of [1, 2, 3, 99]) {
      const g = Grid.createStarter(new Rng(seed));
      expect(g.isConnected()).toBe(true);
      expect(g.kinds[g.entrance]).toBe('entrance');
      expect(g.kinds[g.maw]).toBe('maw');
    }
  });

  it('round-trips through its save encoding', () => {
    const g = Grid.createStarter(new Rng(5));
    const back = Grid.decode(g.w, g.h, g.entrance, g.maw, g.encodeKinds());
    expect(back.kinds).toEqual(g.kinds);
  });

  it('only digs rock that touches the dungeon', () => {
    const sim = blankSim();
    carveMainRoute(sim);
    const g = sim.grid;
    expect(sim.canDig(g.idx(1, 5)).ok).toBe(true);
    expect(sim.canDig(g.idx(1, 4))).toEqual({ ok: false, reason: 'Must touch the dungeon' });
    g.kinds[g.idx(2, 5)] = 'bedrock';
    expect(sim.canDig(g.idx(2, 5))).toEqual({ ok: false, reason: 'Bedrock is too hard to dig' });
    const before = sim.gold;
    expect(sim.dig(g.idx(1, 5)).ok).toBe(true);
    expect(sim.gold).toBe(before - sim.digCost);
    expect(g.kinds[g.idx(1, 5)]).toBe('floor');
  });

  it('refuses to fill the only path to the Maw', () => {
    const sim = blankSim();
    carveMainRoute(sim);
    const g = sim.grid;
    expect(sim.canFill(g.idx(7, 10))).toEqual({ ok: false, reason: 'That would block the only way to the Maw' });
    carveBypass(sim);
    expect(sim.canFill(g.idx(7, 10)).ok).toBe(true);
  });

  it('refunds half of what a feature cost when demolished', () => {
    const sim = blankSim();
    carveMainRoute(sim);
    const t = sim.grid.idx(5, 6);
    sim.place(t, 'spikes');
    sim.upgrade(t);
    const invested = sim.grid.features[t]!.invested;
    const before = sim.gold;
    sim.demolish(t);
    expect(sim.gold).toBe(before + Math.floor(invested / 2));
    expect(sim.grid.features[t]).toBeNull();
  });

  it('keeps features locked until enough Infamy', () => {
    const sim = new Sim(newMeta(), 1);
    expect(sim.unlocked.has('fireVent')).toBe(false);
    sim.infamy = 1000;
    sim.tick();
    expect(sim.unlocked.has('fireVent')).toBe(true);
    expect(sim.unlocked.has('mimic')).toBe(true);
  });
});

describe('Pathfinding', () => {
  it('finds the shortest walkable path', () => {
    const sim = blankSim();
    carveMainRoute(sim);
    const g = sim.grid;
    const field = dijkstra(g, g.entrance, () => 1);
    const path = pathTo(field, g.maw)!;
    expect(path.length).toBe(7 + 8 + 8);
    expect(path[path.length - 1]).toBe(g.maw);
    for (const t of path) expect(g.isWalkable(t)).toBe(true);
  });

  it('returns null when the goal cannot be reached', () => {
    const sim = blankSim();
    carve(sim, 0, 6, 3, 6);
    const field = dijkstra(sim.grid, sim.grid.entrance, () => 1);
    expect(pathTo(field, sim.grid.maw)).toBeNull();
  });
});
