import { describe, expect, it } from 'vitest';
import { playOut } from '../src/sim/bot';
import { BALANCE, UPGRADES, teethForRun } from '../src/sim/content';
import { buyUpgrade, newMeta, nextUpgradeCost } from '../src/sim/meta';
import {
  LEGACY_KEY,
  applyOffline,
  exportCode,
  importCode,
  newSaveFile,
  offlineGains,
  parseSave,
  readStore,
  writeStore,
  type KeyValueStore,
} from '../src/sim/save';
import { Sim } from '../src/sim/sim';

describe('Prestige', () => {
  it('buys upgrades with Teeth until maxed', () => {
    const meta = newMeta();
    meta.teeth = 100;
    for (let k = 0; k < 3; k++) expect(buyUpgrade(meta, 'deepPockets')).toBe(true);
    expect(nextUpgradeCost(meta, 'deepPockets')).toBeNull();
    expect(buyUpgrade(meta, 'deepPockets')).toBe(false);
    expect(meta.teeth).toBe(100 - UPGRADES.deepPockets.costs.reduce((a, b) => a + b, 0));
  });

  it('applies upgrades to a new dungeon', () => {
    const meta = newMeta();
    meta.upgrades = { deepPockets: 2, thickHide: 1, haggler: 1, headStart: 1 };
    const sim = new Sim(meta, 3);
    expect(sim.gold).toBe(BALANCE.startGold + 200);
    expect(sim.mawMaxHp).toBe(Math.round(BALANCE.mawHp * 1.3));
    expect(sim.roomCost('spikeHall').gold).toBe(Math.round(40 * 0.9));
    expect(sim.rooms.size).toBe(2);
    expect(sim.tier).toBe(1);
  });

  it('blueprints add rooms to the catalog', () => {
    const meta = newMeta();
    expect(new Sim(meta, 1).isUnlocked('soulWell')).toBe(false);
    meta.upgrades.bpSoulWell = 1;
    expect(new Sim(meta, 1).isUnlocked('soulWell')).toBe(true);
  });

  it('pays more Teeth for more Infamy and Champions', () => {
    expect(teethForRun(400, 0)).toBeGreaterThan(teethForRun(100, 0));
    expect(teethForRun(400, 2)).toBe(teethForRun(400, 0) + 4);
  });
});

describe('Saving', { timeout: 30_000 }, () => {
  it('restores a dungeon from its save', () => {
    const sim = new Sim(newMeta(), 11);
    playOut(sim, 'good', 8);
    const save = JSON.parse(JSON.stringify(sim.toSave()));
    const back = new Sim(newMeta(), 11, save);
    expect(back.gold).toBeCloseTo(sim.gold);
    expect(back.essence).toBeCloseTo(sim.essence);
    expect(back.infamy).toBeCloseTo(sim.infamy);
    expect([...back.dug].sort()).toEqual([...sim.dug].sort());
    expect([...back.excavated].sort()).toEqual([...sim.excavated].sort());
    expect([...back.rooms.keys()].sort()).toEqual([...sim.rooms.keys()].sort());
    for (const [site, r] of sim.rooms) expect(back.rooms.get(site)!.ranks).toEqual(r.ranks);
    expect(back.cave.sites.length).toBe(sim.cave.sites.length);
    playOut(back, 'good', 1);
    expect(back.time).toBeGreaterThan(sim.time);
  });

  it('round-trips through an export code', () => {
    const save = newSaveFile();
    save.meta.teeth = 42;
    save.run = new Sim(save.meta, 1).toSave();
    const back = importCode(exportCode(save));
    expect(back?.meta.teeth).toBe(42);
    expect(back?.run?.dug).toEqual(save.run.dug);
  });

  it('carries Teeth over from an old v1 save and refunds its upgrades', () => {
    const v1 = { v: 1, savedAt: 0, meta: { teeth: 5, upgrades: { deepPockets: 2, lowProfile: 1 }, runs: 3, bestInfamy: 200, bestSeconds: 1500, totalEaten: 90 }, run: { kinds: 'rrr', features: [] }, settings: { music: 0.2, sfx: 0.4, routes: false } };
    const save = parseSave(JSON.stringify(v1))!;
    expect(save.v).toBe(2);
    expect(save.meta.teeth).toBe(5 + 2 + 4 + 4);
    expect(save.meta.upgrades).toEqual({});
    expect(save.meta.runs).toBe(3);
    expect(save.run).toBeNull();
    expect(save.settings.music).toBe(0.2);
    expect(save.migratedTeeth).toBe(15);
  });

  it('reads an old save from the old storage key', () => {
    const data: Record<string, string> = { [LEGACY_KEY]: JSON.stringify({ v: 1, meta: { teeth: 9 }, run: null }) };
    const store: KeyValueStore = { getItem: (k) => data[k] ?? null, setItem: (k, v) => (data[k] = v), removeItem: (k) => delete data[k] };
    expect(readStore(store)?.meta.teeth).toBe(9);
  });

  it('rejects junk instead of crashing', () => {
    expect(parseSave('not json')).toBeNull();
    expect(parseSave('{"v":3,"meta":{}}')).toBeNull();
    expect(importCode('%%%')).toBeNull();
    expect(parseSave(JSON.stringify({ v: 2, meta: {}, run: { v: 1 } }))?.run).toBeNull();
  });

  it('survives storage that throws', () => {
    const broken: KeyValueStore = {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
      removeItem() {},
    };
    expect(readStore(broken)).toBeNull();
    expect(writeStore(broken, newSaveFile())).toBe(false);
  });

  it('pays capped offline earnings based on the dungeon kill rate', () => {
    const run = new Sim(newMeta(), 1).toSave();
    run.time = 600;
    run.goldFromKills = 600;
    run.essenceFromKills = 120;
    run.eaten = 60;
    const hour = offlineGains(run, 3600);
    expect(hour.gold).toBe(Math.floor(3600 * BALANCE.offlineEfficiency));
    expect(hour.essence).toBe(Math.floor(0.2 * 3600 * BALANCE.offlineEfficiency));
    const week = offlineGains(run, 7 * 24 * 3600);
    expect(week.seconds).toBe(BALANCE.offlineCapSeconds);
    const gold = run.gold;
    applyOffline(run, hour);
    expect(run.gold).toBe(gold + hour.gold);
  });
});
