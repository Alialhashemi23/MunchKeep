import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../src/sim/sim';
import { blankSim, carve, carveBypass, carveMainRoute, place, run } from './helpers';

describe('Hero routing', () => {
  it('Clerics route around a trap they have heard about; Knights walk straight through', () => {
    const sim = blankSim();
    carveMainRoute(sim);
    carveBypass(sim);
    const g = sim.grid;
    const trap = place(sim, 7, 10, 'spikes');
    sim.rumors.set(trap, { feature: 'spikes', until: 1e9 });

    expect(sim.previewRoute('knight')).toContain(trap);
    expect(sim.previewRoute('cleric')).not.toContain(trap);
    expect(sim.previewRoute('cleric')).toContain(g.idx(11, 2));
  });

  it('nobody avoids a trap the town has not heard about', () => {
    const sim = blankSim();
    carveMainRoute(sim);
    carveBypass(sim);
    const trap = place(sim, 7, 10, 'spikes');
    expect(sim.previewRoute('cleric')).toContain(trap);
  });

  it('Rogues detour for a Hoard down a side tunnel; Knights do not', () => {
    const sim = blankSim();
    carveMainRoute(sim);
    carve(sim, 5, 6, 5, 9); // 3-tile side tunnel
    const hoard = place(sim, 5, 9, 'hoard');
    expect(sim.previewRoute('rogue')).toContain(hoard);
    expect(sim.previewRoute('knight')).not.toContain(hoard);
  });

  it('only very greedy heroes go far out of their way', () => {
    const sim = blankSim();
    carveMainRoute(sim);
    carve(sim, 5, 6, 5, 12); // 6 tiles deep
    const hoard = place(sim, 5, 12, 'hoard');
    expect(sim.previewRoute('rogue')).toContain(hoard);
    expect(sim.previewRoute('cleric')).not.toContain(hoard);
  });

  it('treats an unknown Mimic as treasure, and avoids it once warned', () => {
    const sim = blankSim();
    carveMainRoute(sim);
    carve(sim, 5, 6, 5, 9);
    const mimic = place(sim, 5, 9, 'mimic');
    expect(sim.previewRoute('rogue')).toContain(mimic);
    sim.rumors.set(mimic, { feature: 'mimic', until: 1e9 });
    expect(sim.previewRoute('rogue')).not.toContain(mimic);
  });

  it('a hero walks the whole way, bites the Maw and runs home with Gold', () => {
    const sim = blankSim();
    carveMainRoute(sim);
    const knight = sim.spawnHero('knight', 1);
    const events: SimEvent[] = [];
    const gold = sim.gold;
    run(sim, 40, events);
    expect(events.some((e) => e.t === 'bite')).toBe(true);
    expect(sim.mawHp).toBeLessThan(sim.mawMaxHp);
    expect(sim.gold).toBeLessThan(gold + 40 * 0.35);
    // Either chomped by the Maw or escaped with the loot.
    expect(sim.heroes.includes(knight)).toBe(false);
  });

  it('a hero that escapes spreads rumors the next party already knows', () => {
    const sim = blankSim();
    carveMainRoute(sim);
    const trap = place(sim, 2, 6, 'spikes');
    const cleric = sim.spawnHero('cleric', 1);
    cleric.hp = 15; // one spike hit sends it running
    const events: SimEvent[] = [];
    run(sim, 15, events);
    expect(events.some((e) => e.t === 'escaped')).toBe(true);
    expect(sim.rumors.get(trap)?.feature).toBe('spikes');

    const next = sim.spawnHero('cleric', 1);
    expect(sim.parties.get(next.partyId)!.known.get(trap)).toBe('spikes');
  });

  it('rumors fade', () => {
    const sim = blankSim();
    carveMainRoute(sim);
    sim.rumors.set(sim.grid.idx(3, 6), { feature: 'spikes', until: 5 });
    run(sim, 6);
    expect(sim.rumors.size).toBe(0);
  });

  it('Clerics heal wounded allies', () => {
    const sim = blankSim();
    carveMainRoute(sim);
    const knight = sim.spawnHero('knight', 1);
    sim.spawnHero('cleric', 1, knight.partyId);
    knight.hp = 20;
    const events: SimEvent[] = [];
    run(sim, 3, events);
    expect(events.some((e) => e.t === 'heal')).toBe(true);
    expect(knight.hp).toBeGreaterThan(20);
  });
});

describe('Parties', () => {
  it('get bigger and stronger over time', () => {
    const sim = blankSim();
    const early = { lvl: sim.partyLevel(), size: sim.partySize() };
    sim.time = 30 * 60;
    sim.infamy = 500;
    expect(sim.partyLevel()).toBeGreaterThan(early.lvl + 3);
    expect(sim.partySize()).toBeGreaterThan(early.size + 1.5);
  });

  it('a party wiped out to the last hero pays bonus Infamy', () => {
    const sim = blankSim();
    carveMainRoute(sim);
    const a = sim.spawnHero('knight', 1);
    const b = sim.spawnHero('knight', 1, a.partyId);
    const events: SimEvent[] = [];
    sim.damageHero(a, 999);
    sim.damageHero(b, 999);
    run(sim, 0.1, events);
    expect(events.find((e) => e.t === 'wipe')).toMatchObject({ t: 'wipe', size: 2 });
  });

  it('Champions arrive on schedule with a name', () => {
    const sim = blankSim();
    carveMainRoute(sim);
    sim.nextChampionAt = 1;
    const events: SimEvent[] = [];
    run(sim, 1.5, events);
    const party = events.find((e) => e.t === 'party');
    expect(party && party.t === 'party' && party.champion).toBeTruthy();
  });
});
