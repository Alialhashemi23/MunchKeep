import { BALANCE, UPGRADES, type UpgradeId } from './content';
import { newMeta, type MetaState } from './meta';
import type { RunSave } from './sim';

export interface Settings {
  music: number;
  sfx: number;
  routes: boolean;
}

export interface SaveFile {
  v: 2;
  savedAt: number;
  meta: MetaState;
  run: RunSave | null;
  settings: Settings;
  /** Set when progress was carried over from the old tile-grid version. */
  migratedTeeth?: number;
}

export const STORAGE_KEY = 'munchkeep.save.v2';
export const LEGACY_KEY = 'munchkeep.save.v1';

export function defaultSettings(): Settings {
  return { music: 0.5, sfx: 0.7, routes: true };
}

export function newSaveFile(): SaveFile {
  return { v: 2, savedAt: Date.now(), meta: newMeta(), run: null, settings: defaultSettings() };
}

/**
 * Old (v1) saves: the dungeon cannot carry over, but banked Teeth do,
 * and every upgrade bought is refunded as Teeth to spend again.
 */
export function migrateV1(raw: { meta?: Partial<MetaState> & { upgrades?: Record<string, number> }; settings?: Partial<Settings> }): SaveFile {
  const save = newSaveFile();
  const old = raw.meta ?? {};
  let refund = 0;
  for (const [id, level] of Object.entries(old.upgrades ?? {})) {
    const def = UPGRADES[id as UpgradeId];
    if (!def || typeof level !== 'number') continue;
    for (let l = 0; l < Math.min(level, def.costs.length); l++) refund += def.costs[l];
  }
  const teeth = (typeof old.teeth === 'number' ? old.teeth : 0) + refund;
  save.meta.teeth = teeth;
  save.meta.runs = typeof old.runs === 'number' ? old.runs : 0;
  save.meta.bestInfamy = typeof old.bestInfamy === 'number' ? old.bestInfamy : 0;
  save.meta.bestSeconds = typeof old.bestSeconds === 'number' ? old.bestSeconds : 0;
  save.meta.totalEaten = typeof old.totalEaten === 'number' ? old.totalEaten : 0;
  save.settings = { ...defaultSettings(), ...(raw.settings ?? {}) };
  save.migratedTeeth = teeth;
  return save;
}

/** Shape-checks parsed JSON so a corrupt or foreign save never crashes the game. */
export function parseSave(json: string): SaveFile | null {
  try {
    const raw = JSON.parse(json) as Omit<Partial<SaveFile>, "v"> & { v?: number };
    if (!raw || typeof raw.meta !== 'object' || raw.meta === null) return null;
    if (raw.v === 1) return migrateV1(raw as never);
    if (raw.v !== 2) return null;
    const meta = { ...newMeta(), ...raw.meta };
    const r = raw.run as Partial<RunSave> | null | undefined;
    const run = r && r.v === 2 && Array.isArray(r.rooms) && Array.isArray(r.dug) ? (r as RunSave) : null;
    return {
      v: 2,
      savedAt: typeof raw.savedAt === 'number' ? raw.savedAt : Date.now(),
      meta,
      run,
      settings: { ...defaultSettings(), ...(raw.settings ?? {}) },
      migratedTeeth: raw.migratedTeeth,
    };
  } catch {
    return null;
  }
}

/** Portable save code: base64 of the JSON, safe to paste anywhere. */
export function exportCode(save: SaveFile): string {
  const bytes = new TextEncoder().encode(JSON.stringify(save));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function importCode(code: string): SaveFile | null {
  try {
    const bin = atob(code.trim());
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return parseSave(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

export interface OfflineGains {
  seconds: number;
  gold: number;
  essence: number;
  eaten: number;
}

/**
 * Estimated earnings while the game was closed, based on this dungeon's own kill rate.
 * Offline time only pays out: it never damages the Maw or raises Infamy.
 */
export function offlineGains(run: RunSave, elapsedSeconds: number): OfflineGains {
  const seconds = Math.max(0, Math.min(elapsedSeconds, BALANCE.offlineCapSeconds));
  const sample = Math.max(60, run.time);
  const k = seconds * BALANCE.offlineEfficiency;
  return {
    seconds,
    gold: Math.floor((run.goldFromKills / sample) * k),
    essence: Math.floor((run.essenceFromKills / sample) * k),
    eaten: Math.floor((run.eaten / sample) * k),
  };
}

export function applyOffline(run: RunSave, gains: OfflineGains): void {
  run.gold += gains.gold;
  run.essence += gains.essence;
  run.eaten += gains.eaten;
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Browser storage can be missing or throw (private windows, previews); never let that break the game. */
export function readStore(store: KeyValueStore | null): SaveFile | null {
  if (!store) return null;
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (raw) return parseSave(raw);
    const legacy = store.getItem(LEGACY_KEY);
    return legacy ? parseSave(legacy) : null;
  } catch {
    return null;
  }
}

export function writeStore(store: KeyValueStore | null, save: SaveFile): boolean {
  if (!store) return false;
  try {
    save.savedAt = Date.now();
    store.setItem(STORAGE_KEY, JSON.stringify(save));
    return true;
  } catch {
    return false;
  }
}
