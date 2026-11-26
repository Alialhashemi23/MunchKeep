import { BALANCE } from './content';
import { newMeta, type MetaState } from './meta';
import type { RunSave } from './sim';

export interface Settings {
  music: number;
  sfx: number;
  routes: boolean;
}

export interface SaveFile {
  v: 1;
  savedAt: number;
  meta: MetaState;
  run: RunSave | null;
  settings: Settings;
}

export const STORAGE_KEY = 'munchkeep.save.v1';

export function defaultSettings(): Settings {
  return { music: 0.5, sfx: 0.7, routes: true };
}

export function newSaveFile(): SaveFile {
  return { v: 1, savedAt: Date.now(), meta: newMeta(), run: null, settings: defaultSettings() };
}

/** Shape-checks parsed JSON so a corrupt or foreign save never crashes the game. */
export function parseSave(json: string): SaveFile | null {
  try {
    const raw = JSON.parse(json) as Partial<SaveFile>;
    if (!raw || raw.v !== 1 || typeof raw.meta !== 'object' || raw.meta === null) return null;
    const meta = { ...newMeta(), ...raw.meta };
    const run = raw.run && typeof raw.run.kinds === 'string' && Array.isArray(raw.run.features) ? raw.run : null;
    return {
      v: 1,
      savedAt: typeof raw.savedAt === 'number' ? raw.savedAt : Date.now(),
      meta,
      run,
      settings: { ...defaultSettings(), ...(raw.settings ?? {}) },
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
  eaten: number;
}

/**
 * Estimated earnings while the game was closed, based on this dungeon's own kill rate.
 * Offline time only pays out: it never damages the Maw or raises Infamy.
 */
export function offlineGains(run: RunSave, elapsedSeconds: number): OfflineGains {
  const seconds = Math.max(0, Math.min(elapsedSeconds, BALANCE.offlineCapSeconds));
  const sample = Math.max(60, run.time);
  const goldRate = run.goldFromKills / sample;
  const eatRate = run.eaten / sample;
  return {
    seconds,
    gold: Math.floor(goldRate * seconds * BALANCE.offlineEfficiency),
    eaten: Math.floor(eatRate * seconds * BALANCE.offlineEfficiency),
  };
}

export function applyOffline(run: RunSave, gains: OfflineGains): void {
  run.gold += gains.gold;
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
    return raw ? parseSave(raw) : null;
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
