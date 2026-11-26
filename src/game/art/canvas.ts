import { KEYS } from './palette';

/** Tiny pixel painter on top of a 2D canvas. Everything is whole pixels. */
export class Px {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
    this.ctx.imageSmoothingEnabled = false;
  }

  set(x: number, y: number, color: string, alpha = 1): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.ctx.globalAlpha = alpha;
    this.ctx.fillStyle = color;
    this.ctx.fillRect(Math.floor(x), Math.floor(y), 1, 1);
    this.ctx.globalAlpha = 1;
  }

  rect(x: number, y: number, w: number, h: number, color: string, alpha = 1): void {
    this.ctx.globalAlpha = alpha;
    this.ctx.fillStyle = color;
    this.ctx.fillRect(Math.floor(x), Math.floor(y), Math.floor(w), Math.floor(h));
    this.ctx.globalAlpha = 1;
  }

  /** Paint an ASCII sprite at (ox, oy). Optional flip mirrors horizontally. */
  ascii(rows: readonly string[], ox = 0, oy = 0, keys: Record<string, string> = KEYS): void {
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const c = row[x];
        if (c === '.' || c === ' ') continue;
        const color = keys[c];
        if (color) this.set(ox + x, oy + y, color);
      }
    });
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, color: string, alpha = 1): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.set(x, y, color, alpha);
      }
  }

  /** Is (x, y) on the given ellipse's edge band? */
  static inEllipse(x: number, y: number, cx: number, cy: number, rx: number, ry: number): boolean {
    const dx = (x + 0.5 - cx) / rx;
    const dy = (y + 0.5 - cy) / ry;
    return dx * dx + dy * dy <= 1;
  }

  /** Outline every opaque pixel's transparent neighbors (4-way) in a color. */
  outline(color: string): void {
    const img = this.ctx.getImageData(0, 0, this.w, this.h);
    const a = (x: number, y: number) => (x < 0 || y < 0 || x >= this.w || y >= this.h ? 0 : img.data[(y * this.w + x) * 4 + 3]);
    const marks: [number, number][] = [];
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        if (a(x, y) > 0) continue;
        if (a(x - 1, y) > 0 || a(x + 1, y) > 0 || a(x, y - 1) > 0 || a(x, y + 1) > 0) marks.push([x, y]);
      }
    for (const [x, y] of marks) this.set(x, y, color);
  }

  /** Recolor every pixel of one color to another (for palette swaps). */
  swap(from: string, to: string): void {
    const img = this.ctx.getImageData(0, 0, this.w, this.h);
    const f = hex(from);
    const t = hex(to);
    for (let i = 0; i < img.data.length; i += 4) {
      if (img.data[i + 3] && img.data[i] === f[0] && img.data[i + 1] === f[1] && img.data[i + 2] === f[2]) {
        img.data[i] = t[0];
        img.data[i + 1] = t[1];
        img.data[i + 2] = t[2];
      }
    }
    this.ctx.putImageData(img, 0, 0);
  }

  draw(src: HTMLCanvasElement, x: number, y: number, flip = false): void {
    if (!flip) {
      this.ctx.drawImage(src, Math.floor(x), Math.floor(y));
      return;
    }
    this.ctx.save();
    this.ctx.translate(Math.floor(x) + src.width, Math.floor(y));
    this.ctx.scale(-1, 1);
    this.ctx.drawImage(src, 0, 0);
    this.ctx.restore();
  }
}

export function hex(c: string): [number, number, number] {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Deterministic per-pixel noise in [0, 1). */
export function noise(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export const TILE_W = 32;
export const TILE_H = 16;
export const BLOCK_H = 9;

/** Half-width of the 2:1 iso diamond on row y (0..TILE_H-1). */
export function diamondHalf(y: number): number {
  return y < TILE_H / 2 ? (y + 1) * 2 : (TILE_H - y) * 2;
}

export function inDiamond(x: number, y: number): boolean {
  if (y < 0 || y >= TILE_H) return false;
  const hw = diamondHalf(y);
  return x >= TILE_W / 2 - hw && x < TILE_W / 2 + hw;
}

/** True for diamond pixels that sit on its border. */
export function onDiamondEdge(x: number, y: number): boolean {
  if (!inDiamond(x, y)) return false;
  return !inDiamond(x - 1, y) || !inDiamond(x + 1, y) || !inDiamond(x, y - 1) || !inDiamond(x, y + 1);
}
