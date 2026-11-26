import { describe, expect, it } from 'vitest';
import { HEROES, heroRewardMul } from '../src/sim/content';
import type { SimEvent } from '../src/sim/sim';
import { A, C, S, build, edge, party, run, runUntil, testSim } from './helpers';

describe('Room synergies', () => {
  it('Spike Halls deal double damage to Sticky heroes', () => {
    const sim = testSim();
    build(sim, A, 'spikeHall');
    const p = party(sim, ['knight'], 5);
    p.members[0].sticky = 60;
    const events: SimEvent[] = [];
    runUntil(sim, () => events.some((e) => e.t === 'trap'), 30, events);
    expect(events.find((e) => e.t === 'trap')).toMatchObject({ crit: true });
  });

  it('Slimes make heroes Sticky', () => {
    const sim = testSim();
    build(sim, A, 'slimePit');
    const p = party(sim, ['knight'], 4);
    const events: SimEvent[] = [];
    runUntil(sim, () => events.some((e) => e.t === 'status' && e.status === 'sticky'), 40, events);
    expect(p.members[0]?.sticky ?? 1).toBeGreaterThan(0);
  });

  it('Oil Cellar then Flame Gallery sets heroes on fire', () => {
    const sim = testSim();
    build(sim, A, 'oilCellar');
    build(sim, C, 'flameGallery');
    party(sim, ['knight'], 8);
    const events: SimEvent[] = [];
    runUntil(sim, () => events.some((e) => e.t === 'ignite'), 60, events);
    expect(events.some((e) => e.t === 'status' && e.status === 'oily')).toBe(true);
    expect(events.some((e) => e.t === 'ignite')).toBe(true);
  });

  it('a Flame Gallery without oil only scorches', () => {
    const sim = testSim();
    build(sim, A, 'flameGallery');
    party(sim, ['knight'], 8);
    const events: SimEvent[] = [];
    run(sim, 20, events);
    expect(events.some((e) => e.t === 'trap' && e.room === 'flameGallery')).toBe(true);
    expect(events.some((e) => e.t === 'ignite')).toBe(false);
  });

  it('a linked Larder makes monster rooms respawn faster', () => {
    const respawned = (withLarder: boolean) => {
      const sim = testSim();
      build(sim, A, 'goblinWarren');
      if (withLarder) {
        build(sim, S, 'larder');
        sim.dig(edge(sim, A, S));
      }
      for (const m of sim.monsters) m.hp = 0.01;
      // Kill them through the normal path.
      const room = sim.rooms.get(A)!;
      for (const slot of room.slots) {
        slot.monsterId = null;
        slot.respawn = 9;
      }
      sim.monsters = [];
      run(sim, 5);
      return sim.standing(A).length;
    };
    expect(respawned(true)).toBe(3);
    expect(respawned(false)).toBe(0);
  });

  it('heroes dying in a room linked to a Gullet pay 50% more', () => {
    const pay = (gullet: boolean) => {
      const sim = testSim();
      build(sim, A, 'spikeHall');
      if (gullet) {
        build(sim, S, 'gullet');
        sim.dig(edge(sim, A, S));
      }
      const p = party(sim, ['knight']);
      p.inside = A;
      const events: SimEvent[] = [];
      sim.damageHero(p.members[0], p, 9999);
      events.push(...sim.events);
      const d = events.find((e) => e.t === 'heroDied');
      return d && d.t === 'heroDied' ? d : null;
    };
    const plain = pay(false)!;
    const fed = pay(true)!;
    expect(plain.gold).toBeCloseTo(HEROES.knight.gold * heroRewardMul(1));
    expect(fed.gold).toBeCloseTo(plain.gold * 1.5);
    expect(fed.essence).toBeCloseTo(plain.essence * 1.5);
    expect(fed.bonus).toBe(true);
  });

  it('a Pit Drop linked to a Gullet eats heroes outright', () => {
    const sim = testSim();
    sim.mods.blueprints.add('pitDrop');
    build(sim, A, 'pitDrop');
    build(sim, S, 'gullet');
    sim.dig(edge(sim, A, S));
    const events: SimEvent[] = [];
    for (let k = 0; k < 20 && !events.some((e) => e.t === 'fall'); k++) {
      party(sim, ['knight', 'knight', 'knight'], 10);
      run(sim, 4, events);
    }
    expect(events.some((e) => e.t === 'fall' && e.eaten)).toBe(true);
  });

  it('skeletons get back up once', () => {
    const sim = testSim();
    build(sim, A, 'boneCrypt');
    const events: SimEvent[] = [];
    party(sim, ['knight', 'knight'], 6);
    run(sim, 40, events);
    expect(events.some((e) => e.t === 'monsterDown')).toBe(true);
    expect(events.some((e) => e.t === 'monsterUp')).toBe(true);
  });

  it('a Mimic Vault ambushes greedy heroes for triple damage', () => {
    const sim = testSim();
    sim.dig(edge(sim, A, S));
    build(sim, S, 'mimicVault');
    const p = party(sim, ['rogue'], 3);
    expect(sim.previewRoute('rogue')).toContain(S);
    const events: SimEvent[] = [];
    runUntil(sim, () => events.some((e) => e.t === 'ambush'), 40, events);
    expect(events.some((e) => e.t === 'ambush')).toBe(true);
    const hit = events.find((e) => e.t === 'damage' && e.on === 'hero');
    expect(hit).toMatchObject({ crit: true });
    if (sim.parties.includes(p)) expect(p.known.get(S)).toBe('mimicVault');
  });

  it('a Troll hits more than one hero per swing', () => {
    const sim = testSim();
    build(sim, A, 'trollDen');
    party(sim, ['knight', 'knight', 'knight'], 8);
    const events: SimEvent[] = [];
    runUntil(sim, () => events.filter((e) => e.t === 'damage' && e.on === 'hero').length >= 2, 40, events);
    const hits = events.filter((e) => e.t === 'damage' && e.on === 'hero');
    expect(hits.length).toBeGreaterThanOrEqual(2);
  });

  it('a Soul Well trickles Essence', () => {
    const sim = testSim();
    sim.mods.blueprints.add('soulWell');
    build(sim, S, 'soulWell');
    const ess = sim.essence;
    run(sim, 10);
    expect(sim.essence).toBeGreaterThan(ess + 1.5);
  });

  it('a Treasure Vault loses Gold to looters', () => {
    const sim = testSim();
    sim.dig(edge(sim, A, S));
    build(sim, S, 'vault');
    party(sim, ['rogue']);
    const events: SimEvent[] = [];
    const gold = sim.gold;
    runUntil(sim, () => events.some((e) => e.t === 'loot'), 40, events);
    expect(sim.gold).toBeLessThan(gold);
  });
});

describe('The Maw', () => {
  it('chomps heroes biting it', () => {
    const sim = testSim();
    party(sim, ['knight'], 3);
    const events: SimEvent[] = [];
    runUntil(sim, () => events.some((e) => e.t === 'chomp'), 60, events);
    expect(events.some((e) => e.t === 'chomp')).toBe(true);
  });

  it('collapses the dungeon when its HP runs out', () => {
    const sim = testSim();
    const p = party(sim, ['knight'], 5);
    runUntil(sim, () => p.state === 'bite', 60);
    sim.mawHp = 1;
    const events: SimEvent[] = [];
    run(sim, 3, events);
    expect(sim.collapsed).toBe(true);
    expect(events.some((e) => e.t === 'collapse')).toBe(true);
  });

  it('can be collapsed on purpose', () => {
    const sim = testSim();
    sim.forceCollapse();
    expect(sim.collapsed).toBe(true);
  });

  it('grows when fed Gold', () => {
    const sim = testSim();
    const hp = sim.mawMaxHp;
    expect(sim.upgradeMaw().ok).toBe(true);
    expect(sim.mawMaxHp).toBeGreaterThan(hp);
  });
});
