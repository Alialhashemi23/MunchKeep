import { describe, expect, it } from 'vitest';
import { generateCave, otherEnd } from '../src/sim/cave';
import { BALANCE, ROOMS, trackCost } from '../src/sim/content';
import { newMeta } from '../src/sim/meta';
import { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';
import { A, B, C, D, E, S, X, build, edge, party, testSim } from './helpers';

describe('Cave generation', () => {
  it('makes a connected cave with a gate, a Maw and a starting route', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const cave = generateCave(new Rng(seed));
      expect(cave.sites[cave.gate].kind).toBe('gate');
      expect(cave.sites[cave.maw].kind).toBe('maw');
      expect(cave.sites.length).toBeGreaterThanOrEqual(16);
      expect(cave.startRoute[0]).toBe(cave.gate);
      expect(cave.startRoute[cave.startRoute.length - 1]).toBe(cave.maw);
      expect(cave.regionCount).toBeGreaterThanOrEqual(4);
      // Every site is reachable over possible corridors.
      const seen = new Set([cave.gate]);
      const stack = [cave.gate];
      while (stack.length) {
        const c = stack.pop()!;
        for (const eid of cave.adj[c]) {
          const n = otherEnd(cave.edges[eid], c);
          if (!seen.has(n)) {
            seen.add(n);
            stack.push(n);
          }
        }
      }
      expect(seen.size).toBe(cave.sites.length);
      // Rooms never overlap.
      for (const a of cave.sites)
        for (const b of cave.sites) {
          if (a === b) continue;
          const apart = Math.abs(a.x - b.x) >= (a.w + b.w) / 2 || Math.abs(a.y - b.y) >= (a.h + b.h) / 2;
          expect(apart).toBe(true);
        }
    }
  });

  it('is the same cave for the same seed', () => {
    expect(JSON.stringify(generateCave(new Rng(42)))).toBe(JSON.stringify(generateCave(new Rng(42))));
  });

  it('starts a new dungeon with the route dug and the gate connected to the Maw', () => {
    const sim = new Sim(newMeta(), 3);
    expect(sim.connected()).toBe(true);
    expect(sim.excavated.has(0)).toBe(true);
    expect(sim.dug.size).toBe(sim.cave.startRoute.length - 1);
  });
});

describe('Building rooms', () => {
  it('builds on an empty, excavated site and charges Gold and Essence', () => {
    const sim = testSim();
    const gold = sim.gold;
    const ess = sim.essence;
    expect(sim.build(A, 'goblinWarren').ok).toBe(true);
    expect(sim.gold).toBe(gold - ROOMS.goblinWarren.cost.gold);
    expect(sim.essence).toBe(ess - ROOMS.goblinWarren.cost.essence);
    expect(sim.standing(A)).toHaveLength(3);
    expect(sim.build(A, 'spikeHall')).toEqual({ ok: false, reason: 'Something is already built here' });
  });

  it('refuses gate, Maw, unexcavated sites and locked rooms', () => {
    const sim = testSim();
    expect(sim.build(0, 'spikeHall').ok).toBe(false);
    expect(sim.build(1, 'spikeHall').ok).toBe(false);
    expect(sim.build(X, 'spikeHall')).toEqual({ ok: false, reason: 'Excavate this area first' });
    expect(sim.build(A, 'slimePit')).toEqual({ ok: false, reason: `Unlocks at ${BALANCE.tierInfamy[1]} Infamy` });
    expect(sim.build(A, 'spiderNest')).toEqual({ ok: false, reason: 'Buy its blueprint with Teeth first' });
  });

  it('needs Essence for Essence rooms', () => {
    const sim = testSim();
    sim.essence = 0;
    expect(sim.build(A, 'goblinWarren')).toEqual({ ok: false, reason: 'Not enough Essence' });
  });

  it('upgrades tracks up to rank 3, with Essence on the last rank', () => {
    const sim = testSim();
    build(sim, A, 'spikeHall');
    expect(sim.upgrade(A, 0).ok).toBe(true);
    expect(sim.upgrade(A, 0).ok).toBe(true);
    const ess = sim.essence;
    expect(sim.upgrade(A, 0).ok).toBe(true);
    expect(sim.essence).toBe(ess - trackCost('spikeHall', 3).essence);
    expect(sim.upgrade(A, 0)).toEqual({ ok: false, reason: 'Already maxed' });
    expect(sim.rooms.get(A)!.ranks).toEqual([3, 0, 0]);
  });

  it('adds monsters when a Numbers upgrade is bought', () => {
    const sim = testSim();
    build(sim, A, 'goblinWarren');
    sim.upgrade(A, 0);
    expect(sim.standing(A)).toHaveLength(4);
  });

  it('refunds half of everything spent when a room is sold', () => {
    const sim = testSim();
    build(sim, A, 'goblinWarren');
    sim.upgrade(A, 1);
    const inv = { ...sim.rooms.get(A)!.invested };
    const gold = sim.gold;
    sim.sell(A);
    expect(sim.gold).toBe(gold + Math.floor(inv.gold / 2));
    expect(sim.rooms.has(A)).toBe(false);
    expect(sim.standing(A)).toHaveLength(0);
  });
});

describe('Corridors and excavation', () => {
  it('digs corridors between excavated sites and charges by length', () => {
    const sim = testSim();
    const e = edge(sim, A, B);
    const gold = sim.gold;
    expect(sim.dig(e).ok).toBe(true);
    expect(sim.gold).toBe(gold - sim.corridorCost(e));
    expect(sim.linked(A)).toContain(B);
    expect(sim.dig(edge(sim, C, X))).toEqual({ ok: false, reason: 'Excavate both ends first' });
  });

  it('never fills the last way from the gate to the Maw', () => {
    const sim = testSim();
    expect(sim.fill(edge(sim, A, E))).toEqual({ ok: false, reason: 'That would cut the Maw off from the gate' });
    sim.dig(edge(sim, A, B));
    sim.dig(edge(sim, B, D));
    sim.dig(edge(sim, D, C));
    expect(sim.fill(edge(sim, A, E)).ok).toBe(true);
    expect(sim.connected()).toBe(true);
  });

  it('will not fill a corridor with heroes in it', () => {
    const sim = testSim();
    sim.dig(edge(sim, A, B));
    sim.dig(edge(sim, B, D));
    sim.dig(edge(sim, D, C));
    const p = party(sim, ['knight']);
    p.from = A;
    p.to = E;
    p.d = 1;
    p.len = 7;
    expect(sim.fill(edge(sim, A, E))).toEqual({ ok: false, reason: 'Heroes are in that corridor' });
  });

  it('excavates neighboring regions for Essence, each costing more', () => {
    const sim = testSim();
    expect(sim.excavatable()).toEqual([1]);
    const cost = sim.excavateCost();
    const ess = sim.essence;
    expect(sim.excavate(1).ok).toBe(true);
    expect(sim.essence).toBe(ess - cost);
    expect(sim.isExcavated(X)).toBe(true);
    expect(sim.excavateCost()).toBeGreaterThan(cost);
    expect(sim.dig(edge(sim, C, X)).ok).toBe(true);
  });

  it('unlocks catalog tiers with Infamy', () => {
    const sim = testSim();
    expect(sim.isUnlocked('slimePit')).toBe(false);
    sim.infamy = BALANCE.tierInfamy[2];
    sim.tick();
    expect(sim.tier).toBe(2);
    expect(sim.isUnlocked('slimePit')).toBe(true);
    expect(sim.isUnlocked('boneCrypt')).toBe(true);
    expect(sim.isUnlocked('trollDen')).toBe(false);
  });

  it('a Side room counts as linked only when a corridor joins them', () => {
    const sim = testSim();
    build(sim, A, 'goblinWarren');
    build(sim, S, 'larder');
    expect(sim.linkedRooms(A, 'larder')).toHaveLength(0);
    sim.dig(edge(sim, A, S));
    expect(sim.linkedRooms(A, 'larder')).toHaveLength(1);
  });
});
