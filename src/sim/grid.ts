import { BALANCE, type FeatureId } from './content';
import type { Rng } from './rng';

export type TileKind = 'rock' | 'bedrock' | 'floor' | 'entrance' | 'maw';

export interface LairSlot {
  monsterId: number | null;
  respawn: number;
}

export interface Feature {
  id: FeatureId;
  level: number;
  /** Total Gold spent on this feature (for refunds). */
  invested: number;
  /** Traps: seconds until armed again. */
  rearm: number;
  /** Lairs: one slot per monster. */
  slots: LairSlot[];
}

const KIND_CODES: Record<TileKind, string> = { rock: 'r', bedrock: 'b', floor: 'f', entrance: 'e', maw: 'm' };
const CODE_KINDS: Record<string, TileKind> = { r: 'rock', b: 'bedrock', f: 'floor', e: 'entrance', m: 'maw' };

export const DIRS4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

export const DIRS8 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;

/**
 * The dungeon map. Tiles are addressed by index (y * w + x).
 * Every structural change bumps `version` so heroes and caches know to refresh.
 */
export class Grid {
  readonly w: number;
  readonly h: number;
  readonly kinds: TileKind[];
  readonly features: (Feature | null)[];
  readonly entrance: number;
  readonly maw: number;
  version = 0;

  constructor(w: number, h: number, entrance: number, maw: number) {
    this.w = w;
    this.h = h;
    this.kinds = new Array<TileKind>(w * h).fill('rock');
    this.features = new Array<Feature | null>(w * h).fill(null);
    this.entrance = entrance;
    this.maw = maw;
    this.kinds[entrance] = 'entrance';
    this.kinds[maw] = 'maw';
  }

  /** A fresh dungeon: a winding starter tunnel from the entrance to a small chamber around the Maw. */
  static createStarter(rng: Rng): Grid {
    const { gridW: w, gridH: h, entrance: e, maw: m } = BALANCE;
    const g = new Grid(w, h, e.y * w + e.x, m.y * w + m.x);
    const carve = (x: number, y: number) => {
      const i = g.idx(x, y);
      if (g.kinds[i] === 'rock') g.kinds[i] = 'floor';
    };
    // Starter tunnel: east from the entrance, south, then east into the Maw chamber.
    const bendX = 7;
    for (let x = e.x; x <= bendX; x++) carve(x, e.y);
    for (let y = e.y; y <= m.y; y++) carve(bendX, y);
    for (let x = bendX; x <= m.x; x++) carve(x, m.y);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) carve(m.x + dx, m.y + dy);

    // Scatter bedrock, keeping clear of anything already dug.
    for (let i = 0; i < w * h; i++) {
      if (g.kinds[i] !== 'rock') continue;
      const x = g.x(i);
      const y = g.y(i);
      let nearDug = false;
      for (let dx = -1; dx <= 1 && !nearDug; dx++)
        for (let dy = -1; dy <= 1 && !nearDug; dy++) {
          const nx = x + dx;
          const ny = y + dy;
          if (g.inBounds(nx, ny) && g.kinds[g.idx(nx, ny)] !== 'rock') nearDug = true;
        }
      if (!nearDug && rng.chance(BALANCE.bedrockChance)) g.kinds[i] = 'bedrock';
    }
    return g;
  }

  idx(x: number, y: number): number {
    return y * this.w + x;
  }
  x(i: number): number {
    return i % this.w;
  }
  y(i: number): number {
    return Math.floor(i / this.w);
  }
  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }
  /** Tile index under a continuous position, or -1 when off the map. */
  tileAt(x: number, y: number): number {
    const tx = Math.round(x);
    const ty = Math.round(y);
    return this.inBounds(tx, ty) ? this.idx(tx, ty) : -1;
  }

  isWalkable(i: number): boolean {
    const k = this.kinds[i];
    return k === 'floor' || k === 'entrance' || k === 'maw';
  }

  neighbors4(i: number): number[] {
    const out: number[] = [];
    const x = this.x(i);
    const y = this.y(i);
    for (const [dx, dy] of DIRS4) if (this.inBounds(x + dx, y + dy)) out.push(this.idx(x + dx, y + dy));
    return out;
  }

  neighbors8(i: number): number[] {
    const out: number[] = [];
    const x = this.x(i);
    const y = this.y(i);
    for (const [dx, dy] of DIRS8) if (this.inBounds(x + dx, y + dy)) out.push(this.idx(x + dx, y + dy));
    return out;
  }

  /** True when any of the 8 surrounding tiles holds the given feature. */
  touches(i: number, id: FeatureId): boolean {
    for (const n of this.neighbors8(i)) if (this.features[n]?.id === id) return true;
    return false;
  }

  /** Chebyshev distance between two tiles. */
  chebyshev(a: number, b: number): number {
    return Math.max(Math.abs(this.x(a) - this.x(b)), Math.abs(this.y(a) - this.y(b)));
  }

  /** Can heroes walk from the entrance to the Maw? Optionally pretend one tile is solid. */
  isConnected(blocked = -1): boolean {
    const seen = new Uint8Array(this.w * this.h);
    const stack = [this.entrance];
    seen[this.entrance] = 1;
    while (stack.length) {
      const c = stack.pop()!;
      if (c === this.maw) return true;
      for (const n of this.neighbors4(c)) {
        if (seen[n] || n === blocked || !this.isWalkable(n)) continue;
        seen[n] = 1;
        stack.push(n);
      }
    }
    return false;
  }

  /** Walkable tiles reachable from `from` within `depth` steps (4-way). */
  area(from: number, depth: number): Set<number> {
    const out = new Set<number>([from]);
    let frontier = [from];
    for (let d = 0; d < depth; d++) {
      const next: number[] = [];
      for (const c of frontier)
        for (const n of this.neighbors4(c)) {
          if (out.has(n) || !this.isWalkable(n)) continue;
          out.add(n);
          next.push(n);
        }
      frontier = next;
    }
    return out;
  }

  featureTiles(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.features.length; i++) if (this.features[i]) out.push(i);
    return out;
  }

  touch(): void {
    this.version++;
  }

  encodeKinds(): string {
    return this.kinds.map((k) => KIND_CODES[k]).join('');
  }

  static decode(w: number, h: number, entrance: number, maw: number, kinds: string): Grid {
    const g = new Grid(w, h, entrance, maw);
    for (let i = 0; i < kinds.length && i < w * h; i++) g.kinds[i] = CODE_KINDS[kinds[i]] ?? 'rock';
    g.kinds[entrance] = 'entrance';
    g.kinds[maw] = 'maw';
    return g;
  }
}
