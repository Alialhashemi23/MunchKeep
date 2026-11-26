import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../src/sim/sim';
import { A, B, C, D, E, S, build, edge, party, run, runUntil, testSim } from './helpers';

const detour = (sim: ReturnType<typeof testSim>) => {
  sim.dig(edge(sim, A, B));
  sim.dig(edge(sim, B, D));
  sim.dig(edge(sim, D, C));
};

describe('Parties', () => {
  it('walk from the gate to the Maw together and bite it', () => {
    const sim = testSim();
    const p = party(sim, ['knight', 'cleric']);
    const events: SimEvent[] = [];
    runUntil(sim, () => p.state === 'bite', 60, events);
    expect(p.state).toBe('bite');
    expect(p.to).toBe(1);
    run(sim, 3, events);
    expect(events.some((e) => e.t === 'bite')).toBe(true);
    expect(sim.mawHp).toBeLessThan(sim.mawMaxHp);
  });

  it('must clear a monster room before moving on', () => {
    const sim = testSim();
    build(sim, A, 'goblinWarren');
    const p = party(sim, ['knight'], 3);
    runUntil(sim, () => p.state === 'fight', 30);
    expect(p.state).toBe('fight');
    expect(p.to).toBe(A);
    // Still there while goblins stand.
    run(sim, 1);
    if (sim.standing(A).length) expect(p.to).toBe(A);
    runUntil(sim, () => sim.standing(A).length === 0 || !sim.parties.includes(p), 60);
    run(sim, 0.2);
    if (sim.parties.includes(p)) expect(p.state).toBe('move');
  });

  it('Clerics avoid a room they have heard about; Knights walk straight through', () => {
    const sim = testSim();
    detour(sim);
    build(sim, E, 'trollDen');
    expect(sim.previewRoute('cleric')).toContain(E);
    sim.rumors.set(E, { room: 'trollDen', until: 1e9 });
    expect(sim.previewRoute('knight')).toContain(E);
    expect(sim.previewRoute('cleric')).not.toContain(E);
    expect(sim.previewRoute('cleric')).toContain(B);
  });

  it('greedy parties detour to a Vault they can see', () => {
    const sim = testSim();
    sim.dig(edge(sim, A, S));
    build(sim, S, 'vault');
    expect(sim.previewRoute('rogue')).toContain(S);
    expect(sim.previewRoute('knight')).not.toContain(S);
  });

  it('a Rogue slips away from its party to raid a Vault', () => {
    const sim = testSim();
    sim.dig(edge(sim, A, S));
    build(sim, S, 'vault');
    const p = party(sim, ['knight', 'knight', 'rogue']);
    const events: SimEvent[] = [];
    runUntil(sim, () => events.some((e) => e.t === 'loot'), 60, events);
    expect(events.some((e) => e.t === 'split' && e.reason === 'loot')).toBe(true);
    expect(events.some((e) => e.t === 'loot')).toBe(true);
    expect(p.members.every((h) => h.cls === 'knight')).toBe(true);
  });

  it('heroes who escape spread rumors that the next party already knows', () => {
    const sim = testSim();
    build(sim, A, 'spikeHall');
    const p = party(sim, ['cleric']);
    p.members[0].hp = 16; // one or two stabs and it runs
    const events: SimEvent[] = [];
    runUntil(sim, () => events.some((e) => e.t === 'escaped' || e.t === 'heroDied'), 60, events);
    if (events.some((e) => e.t === 'escaped')) {
      expect(sim.rumors.get(A)?.room).toBe('spikeHall');
      const next = party(sim, ['knight']);
      expect(next.known.get(A)).toBe('spikeHall');
    } else {
      // Died before escaping: nobody learned anything.
      expect(sim.rumors.size).toBe(0);
    }
  });

  it('rumors fade', () => {
    const sim = testSim();
    sim.rumors.set(A, { room: 'spikeHall', until: 3 });
    run(sim, 4);
    expect(sim.rumors.size).toBe(0);
  });

  it('Rogues peek into neighboring rooms and disarm traps they know', () => {
    const sim = testSim();
    build(sim, A, 'spikeHall');
    sim.rumors.set(A, { room: 'spikeHall', until: 1e9 });
    const events: SimEvent[] = [];
    for (let k = 0; k < 12; k++) {
      party(sim, ['rogue', 'knight'], 5);
      run(sim, 2, events);
    }
    run(sim, 30, events);
    expect(events.some((e) => e.t === 'disarm')).toBe(true);
  });

  it('traps linked to a Gloom Hall cannot be disarmed', () => {
    const sim = testSim();
    build(sim, A, 'spikeHall');
    build(sim, S, 'gloomHall');
    sim.dig(edge(sim, A, S));
    sim.rumors.set(A, { room: 'spikeHall', until: 1e9 });
    const events: SimEvent[] = [];
    for (let k = 0; k < 12; k++) {
      party(sim, ['rogue', 'knight'], 5);
      run(sim, 2, events);
    }
    run(sim, 30, events);
    expect(events.some((e) => e.t === 'disarm')).toBe(false);
  });

  it('Clerics heal the party', () => {
    const sim = testSim();
    const p = party(sim, ['knight', 'cleric']);
    p.members[0].hp = 20;
    const events: SimEvent[] = [];
    run(sim, 3, events);
    expect(events.some((e) => e.t === 'heal')).toBe(true);
    expect(p.members.find((h) => h.cls === 'knight')!.hp).toBeGreaterThan(20);
  });

  it('a wiped-out party pays bonus Infamy', () => {
    const sim = testSim();
    const p = party(sim, ['knight', 'knight']);
    const events: SimEvent[] = [];
    for (const h of [...p.members]) sim.damageHero(h, p, 9999);
    run(sim, 0.1, events);
    expect(events.find((e) => e.t === 'wipe')).toMatchObject({ size: 2 });
  });

  it('Champions arrive on schedule with a name', () => {
    const sim = testSim();
    sim.nextChampionAt = 1;
    const events: SimEvent[] = [];
    run(sim, 1.5, events);
    const e = events.find((x) => x.t === 'party');
    expect(e && e.t === 'party' && e.champion).toBeTruthy();
  });

  it('get bigger and stronger over time', () => {
    const sim = testSim();
    const early = { lvl: sim.partyLevel(), size: sim.partySize() };
    sim.time = 30 * 60;
    sim.infamy = 500;
    expect(sim.partyLevel()).toBeGreaterThan(early.lvl + 3);
    expect(sim.partySize()).toBeGreaterThan(early.size + 1.5);
  });
});
