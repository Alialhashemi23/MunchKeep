import { describe, expect, it } from 'vitest';
import { playOut } from '../src/sim/bot';
import { BALANCE, UPGRADES, teethForRun } from '../src/sim/content';
import { buyUpgrade, metaMods, newMeta, nextUpgradeCost } from '../src/sim/meta';
import {
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
    expect(buyUpgrade(meta, 'deepPockets')).toBe(true);
    expect(buyUpgrade(meta, 'deepPockets')).toBe(true);
    expect(buyUpgrade(meta, 'deepPockets')).toBe(true);
    expect(nextUpgradeCost(meta, 'deepPockets')).toBeNull();
    expect(buyUpgrade(meta, 'deepPockets')).toBe(false);
    expect(meta.teeth).toBe(100 - UPGRADES.deepPockets.costs.reduce((a, b) => a + b, 0));
  });

  it('refuses upgrades it cannot afford', () => {
    const meta = newMeta();
    meta.teeth = 1;
    expect(buyUpgrade(meta, 'headStart')).toBe(false);
    expect(meta.teeth).toBe(1);
  });

  it('applies upgrades to a new dungeon', () => {
    const meta = newMeta();
    meta.upgrades = { deepPockets: 2, thickHide: 1, haggler: 1, headStart: 1 };
    const sim = new Sim(meta, 3);
    expect(sim.gold).toBe(BALANCE.startGold + 200);
    expect(sim.mawMaxHp).toBe(Math.round(BALANCE.mawHp * 1.3));
    expect(sim.featureCost('spikes')).toBe(Math.round(30 * 0.9));
    expect(sim.grid.featureTiles()).toHaveLength(2);
    expect(sim.unlocked.has('oil')).toBe(true);
    expect(metaMods(meta).costMul).toBeCloseTo(0.9);
  });

  it('pays more Teeth for more Infamy and Champions', () => {
    expect(teethForRun(0, 0)).toBe(0);
    expect(teethForRun(400, 0)).toBeGreaterThan(teethForRun(100, 0));
    expect(teethForRun(400, 2)).toBe(teethForRun(400, 0) + 4);
    expect(teethForRun(400, 0, 1.5)).toBe(Math.floor(400 ** 0.5 * 0.6 * 1.5));
  });
});

describe('Saving', { timeout: 30_000 }, () => {
  it('restores a dungeon from its save', () => {
    const sim = new Sim(newMeta(), 11);
    playOut(sim, 'good', 6);
    const save = sim.toSave();
    const back = new Sim(newMeta(), 11, JSON.parse(JSON.stringify(save)));
    expect(back.gold).toBeCloseTo(sim.gold);
    expect(back.infamy).toBeCloseTo(sim.infamy);
    expect(back.time).toBeCloseTo(sim.time);
    expect(back.grid.encodeKinds()).toBe(sim.grid.encodeKinds());
    expect(back.grid.featureTiles()).toEqual(sim.grid.featureTiles());
    for (const t of sim.grid.featureTiles()) expect(back.grid.features[t]!.level).toBe(sim.grid.features[t]!.level);
    expect([...back.unlocked].sort()).toEqual([...sim.unlocked].sort());
    // Lairs come back fully staffed.
    const lairs = sim.grid.featureTiles().filter((t) => back.grid.features[t]!.slots.length > 0);
    for (const t of lairs) expect(back.grid.features[t]!.slots.every((s) => s.monsterId !== null)).toBe(true);
    // And the restored dungeon keeps running.
    playOut(back, 'good', 1);
    expect(back.time).toBeGreaterThan(sim.time);
  });

  it('round-trips through an export code', () => {
    const save = newSaveFile();
    save.meta.teeth = 42;
    save.run = new Sim(save.meta, 1).toSave();
    const back = importCode(exportCode(save));
    expect(back?.meta.teeth).toBe(42);
    expect(back?.run?.kinds).toBe(save.run.kinds);
  });

  it('rejects junk instead of crashing', () => {
    expect(parseSave('not json')).toBeNull();
    expect(parseSave('{"v":2}')).toBeNull();
    expect(importCode('%%%')).toBeNull();
    expect(parseSave(JSON.stringify({ v: 1, meta: {}, run: { kinds: 5 } }))?.run).toBeNull();
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
    expect(readStore(null)).toBeNull();
  });

  it('pays capped offline earnings based on the dungeon kill rate', () => {
    const run = new Sim(newMeta(), 1).toSave();
    run.time = 600;
    run.goldFromKills = 600; // 1 Gold/s
    run.eaten = 60;
    const hour = offlineGains(run, 3600);
    expect(hour.gold).toBe(Math.floor(3600 * BALANCE.offlineEfficiency));
    const week = offlineGains(run, 7 * 24 * 3600);
    expect(week.seconds).toBe(BALANCE.offlineCapSeconds);
    expect(week.gold).toBe(Math.floor(BALANCE.offlineCapSeconds * BALANCE.offlineEfficiency));
    const gold = run.gold;
    applyOffline(run, hour);
    expect(run.gold).toBe(gold + hour.gold);
  });
});
