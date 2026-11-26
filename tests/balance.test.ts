import { describe, expect, it } from 'vitest';
import { playOut } from '../src/sim/bot';
import { UPGRADES, type UpgradeId } from '../src/sim/content';
import { newMeta } from '../src/sim/meta';
import { Sim } from '../src/sim/sim';

/**
 * Whole-run balance checks. A scripted bot plays complete dungeons headless.
 * The design target is a 30-60 minute run for a decent player.
 */
const SEEDS = [1, 2, 3, 4, 5];
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

describe('Run length', { timeout: 60_000 }, () => {
  it('doing nothing loses quickly', () => {
    const mins = SEEDS.map((s) => playOut(new Sim(newMeta(), s), 'idle', 90).minutes);
    expect(median(mins)).toBeLessThan(10);
  });

  it('a beginner who only builds monsters and spikes lasts a while, not forever', () => {
    const mins = SEEDS.map((s) => playOut(new Sim(newMeta(), s), 'basic', 90).minutes);
    expect(median(mins)).toBeGreaterThan(10);
    expect(median(mins)).toBeLessThan(28);
  });

  it('a decent player lands in the 30-60 minute window', () => {
    const results = SEEDS.map((s) => playOut(new Sim(newMeta(), s), 'good', 90));
    for (const r of results) expect(r.collapsed).toBe(true);
    const mins = median(results.map((r) => r.minutes));
    expect(mins).toBeGreaterThanOrEqual(30);
    expect(mins).toBeLessThanOrEqual(60);
  });

  it('prestige upgrades make the next dungeon last longer', () => {
    const maxed = newMeta();
    for (const id of Object.keys(UPGRADES) as UpgradeId[]) maxed.upgrades[id] = UPGRADES[id].costs.length;
    const base = median(SEEDS.map((s) => playOut(new Sim(newMeta(), s), 'good', 120).minutes));
    const boosted = median(SEEDS.map((s) => playOut(new Sim(maxed, s), 'good', 120).minutes));
    expect(boosted).toBeGreaterThan(base + 3);
  });
});
