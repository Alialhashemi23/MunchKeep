import { UPGRADES, type RoomId, type UpgradeId } from './content';

/** Progress that survives dungeon collapses. */
export interface MetaState {
  teeth: number;
  upgrades: Partial<Record<UpgradeId, number>>;
  runs: number;
  bestInfamy: number;
  bestSeconds: number;
  totalEaten: number;
}

export function newMeta(): MetaState {
  return { teeth: 0, upgrades: {}, runs: 0, bestInfamy: 0, bestSeconds: 0, totalEaten: 0 };
}

export function upgradeLevel(meta: MetaState, id: UpgradeId): number {
  return meta.upgrades[id] ?? 0;
}

/** Cost of the next level, or null when maxed. */
export function nextUpgradeCost(meta: MetaState, id: UpgradeId): number | null {
  const lvl = upgradeLevel(meta, id);
  const costs = UPGRADES[id].costs;
  return lvl >= costs.length ? null : costs[lvl];
}

export function buyUpgrade(meta: MetaState, id: UpgradeId): boolean {
  const cost = nextUpgradeCost(meta, id);
  if (cost === null || meta.teeth < cost) return false;
  meta.teeth -= cost;
  meta.upgrades[id] = upgradeLevel(meta, id) + 1;
  return true;
}

/** Every number the prestige tree changes, in one place. */
export interface MetaMods {
  startGold: number;
  mawHpMul: number;
  chompMul: number;
  costMul: number;
  rewardMul: number;
  teethMul: number;
  escalationMul: number;
  headStart: boolean;
  blueprints: Set<RoomId>;
}

export function metaMods(meta: MetaState): MetaMods {
  const l = (id: UpgradeId) => upgradeLevel(meta, id);
  const blueprints = new Set<RoomId>();
  for (const def of Object.values(UPGRADES)) if (def.blueprint && l(def.id) > 0) blueprints.add(def.blueprint);
  return {
    startGold: 100 * l('deepPockets'),
    mawHpMul: 1 + 0.3 * l('thickHide'),
    chompMul: 1 + 0.4 * l('sharpFangs'),
    costMul: 1 - 0.1 * l('haggler'),
    rewardMul: 1 + 0.2 * l('gourmand'),
    teethMul: 1 + 0.25 * l('dreadful'),
    escalationMul: 1 - 0.1 * l('lowProfile'),
    headStart: l('headStart') > 0,
    blueprints,
  };
}
