import { describe, expect, it } from 'vitest';
import { FEATURES } from '../src/sim/content';
import type { SimEvent } from '../src/sim/sim';
import { blankSim, carve, carveMainRoute, place, run } from './helpers';

describe('Traps', () => {
  it('Spikes deal double damage to Sticky heroes', () => {
    const sim = blankSim();
    carveMainRoute(sim);
    place(sim, 3, 6, 'spikes');
    const k = sim.spawnHero('knight', 1);
    k.sticky = 30;
    const events: SimEvent[] = [];
    run(sim, 4, events);
    const hit = events.find((e) => e.t === 'damage' && e.on === 'hero');
    expect(hit).toMatchObject({ crit: true, amount: FEATURES.spikes.damage! * 2 - 2 });
  });

  it('Spikes deal normal damage otherwise', () => {
    const sim = blankSim();
    carveMainRoute(sim);
    place(sim, 3, 6, 'spikes');
    sim.spawnHero('knight', 1);
    const events: SimEvent[] = [];
    run(sim, 4, events);
    const hit = events.find((e) => e.t === 'damage' && e.on === 'hero');
    expect(hit).toMatchObject({ amount: FEATURES.spikes.damage! - 2 });
  });

  it('Oil makes heroes Oily, and a Fire Vent sets Oily heroes on fire', () => {
    const sim = blankSim();
    carveMainRoute(sim);
    place(sim, 2, 6, 'oil');
    place(sim, 5, 6, 'fireVent');
    const k = sim.spawnHero('knight', 1);
    const events: SimEvent[] = [];
    run(sim, 5, events);
    expect(events.some((e) => e.t === 'status' && e.status === 'oily')).toBe(true);
    expect(events.some((e) => e.t === 'ignite')).toBe(true);
    expect(events.some((e) => e.t === 'damage' && e.burn)).toBe(true);
    expect(k.hp).toBeLessThan(k.maxHp - FEATURES.fireVent.damage!);
  });

  it('a Fire Vent does not ignite heroes that are not Oily', () => {
    const sim = blankSim();
    carveMainRoute(sim);
    place(sim, 5, 6, 'fireVent');
    sim.spawnHero('knight', 1);
    const events: SimEvent[] = [];
    run(sim, 5, events);
    expect(events.some((e) => e.t === 'trap' && e.feature === 'fireVent')).toBe(true);
    expect(events.some((e) => e.t === 'ignite')).toBe(false);
  });

  it('traps touching a Hoard reset twice as fast', () => {
    const sim = blankSim();
    carveMainRoute(sim);
    carve(sim, 4, 5, 4, 5);
    const plain = place(sim, 2, 6, 'spikes');
    const fed = place(sim, 4, 6, 'spikes');
    place(sim, 4, 5, 'hoard');
    sim.grid.features[plain]!.rearm = 3;
    sim.grid.features[fed]!.rearm = 3;
    run(sim, 1.6);
    expect(sim.grid.features[fed]!.rearm).toBeLessThanOrEqual(0);
    expect(sim.grid.features[plain]!.rearm).toBeGreaterThan(1);
  });

  it('Rogues never spot traps touching Gloom', () => {
    const sim = blankSim();
    carveMainRoute(sim);
    carve(sim, 4, 5, 4, 5);
    place(sim, 4, 6, 'spikes');
    place(sim, 4, 5, 'gloom');
    const events: SimEvent[] = [];
    for (let k = 0; k < 6; k++) sim.spawnHero('rogue', 1);
    run(sim, 6, events);
    expect(events.some((e) => e.t === 'spotted')).toBe(false);
    expect(events.some((e) => e.t === 'disarm')).toBe(false);
  });

  it('Rogues do spot traps without Gloom', () => {
    const sim = blankSim();
    carveMainRoute(sim);
    place(sim, 4, 6, 'spikes');
    const events: SimEvent[] = [];
    for (let k = 0; k < 6; k++) sim.spawnHero('rogue', 1);
    run(sim, 6, events);
    expect(events.some((e) => e.t === 'spotted')).toBe(true);
  });
});

describe('Lairs and rooms', () => {
  it('a Larder makes a lair respawn twice as fast', () => {
    const sim = blankSim();
    carveMainRoute(sim);
    carve(sim, 4, 5, 4, 5);
    const fed = place(sim, 4, 6, 'goblinDen');
    place(sim, 4, 5, 'larder');
    const hungry = place(sim, 7, 10, 'goblinDen');
    for (const t of [fed, hungry]) {
      const f = sim.grid.features[t]!;
      for (const s of f.slots) s.monsterId = null;
      f.slots.forEach((s) => (s.respawn = FEATURES.goblinDen.respawn!));
    }
    sim.monsters = [];
    run(sim, FEATURES.goblinDen.respawn! / 2 + 0.2);
    expect(sim.monsters.filter((m) => m.lair === fed)).toHaveLength(2);
    expect(sim.monsters.filter((m) => m.lair === hungry)).toHaveLength(0);
  });

  it('goblins charge and kill a weak hero, paying Gold and Infamy', () => {
    const sim = blankSim();
    carveMainRoute(sim);
    place(sim, 4, 6, 'goblinDen');
    const r = sim.spawnHero('knight', 1);
    r.hp = 10;
    const gold = sim.gold;
    const events: SimEvent[] = [];
    run(sim, 6, events);
    expect(events.some((e) => e.t === 'heroDied')).toBe(true);
    expect(sim.gold).toBeGreaterThan(gold);
    expect(sim.infamy).toBeGreaterThan(0);
    expect(sim.eaten).toBe(1);
  });

  it('Slimes make heroes Sticky', () => {
    const sim = blankSim();
    carveMainRoute(sim);
    place(sim, 4, 6, 'slimePit');
    const k = sim.spawnHero('knight', 1);
    const events: SimEvent[] = [];
    run(sim, 6, events);
    expect(events.some((e) => e.t === 'status' && e.status === 'sticky')).toBe(true);
    expect(k.sticky).toBeGreaterThan(0);
  });

  it('a Mimic ambushes for triple damage', () => {
    const sim = blankSim();
    carveMainRoute(sim);
    place(sim, 4, 6, 'mimic');
    sim.spawnHero('knight', 1);
    const events: SimEvent[] = [];
    run(sim, 4, events);
    expect(events.some((e) => e.t === 'ambush')).toBe(true);
    const hit = events.find((e) => e.t === 'damage' && e.on === 'hero');
    expect(hit).toMatchObject({ crit: true });
  });

  it('heroes killed touching a Gullet pay 50% more Gold', () => {
    const pay = (gullet: boolean) => {
      const sim = blankSim();
      carveMainRoute(sim);
      carve(sim, 3, 5, 3, 5);
      if (gullet) place(sim, 3, 5, 'gullet');
      const h = sim.spawnHero('knight', 1);
      h.x = 3;
      h.y = 6;
      const events: SimEvent[] = [];
      sim.damageHero(h, 9999);
      events.push(...sim.events);
      const died = events.find((e) => e.t === 'heroDied');
      return died && died.t === 'heroDied' ? died.gold : 0;
    };
    expect(pay(true)).toBeCloseTo(pay(false) * 1.5, 5);
  });

  it('upgrading a lair makes its monsters stronger and heals them', () => {
    const sim = blankSim();
    carveMainRoute(sim);
    const t = place(sim, 4, 6, 'goblinDen');
    const [m] = sim.monsters;
    const hp = m.maxHp;
    m.hp = 1;
    expect(sim.upgrade(t).ok).toBe(true);
    expect(m.maxHp).toBeGreaterThan(hp);
    expect(m.hp).toBe(m.maxHp);
  });
});

describe('The Maw', () => {
  it('chomps heroes that come close', () => {
    const sim = blankSim();
    carveMainRoute(sim);
    const k = sim.spawnHero('knight', 1);
    const g = sim.grid;
    k.x = g.x(g.maw) - 1;
    k.y = g.y(g.maw);
    k.tile = g.idx(k.x, k.y);
    const events: SimEvent[] = [];
    run(sim, 2, events);
    expect(events.some((e) => e.t === 'chomp')).toBe(true);
  });

  it('collapses the dungeon when its HP runs out', () => {
    const sim = blankSim();
    carveMainRoute(sim);
    const k = sim.spawnHero('knight', 3);
    const g = sim.grid;
    k.x = g.x(g.maw);
    k.y = g.y(g.maw);
    k.tile = g.maw;
    sim.mawHp = 1;
    const events: SimEvent[] = [];
    run(sim, 3, events);
    expect(sim.collapsed).toBe(true);
    expect(events.some((e) => e.t === 'collapse')).toBe(true);
    const t = sim.time;
    sim.tick();
    expect(sim.time).toBe(t);
  });

  it('grows stronger when fed Gold', () => {
    const sim = blankSim();
    const hp = sim.mawMaxHp;
    const chomp = sim.mawChompDamage;
    expect(sim.upgradeMaw().ok).toBe(true);
    expect(sim.mawMaxHp).toBeGreaterThan(hp);
    expect(sim.mawChompDamage).toBeGreaterThan(chomp);
  });
});
