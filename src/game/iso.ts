import { BLOCK_H, TILE_H, TILE_W } from './art/canvas';

/** Grid (continuous) -> world pixels at the floor plane. */
export function toWorld(x: number, y: number): { x: number; y: number } {
  return { x: (x - y) * (TILE_W / 2), y: (x + y) * (TILE_H / 2) };
}

/** World pixels at a given plane height -> fractional grid coordinates. */
export function toGrid(wx: number, wy: number, raised = 0): { x: number; y: number } {
  const ay = wy + raised;
  return {
    x: (wx / (TILE_W / 2) + ay / (TILE_H / 2)) / 2,
    y: (ay / (TILE_H / 2) - wx / (TILE_W / 2)) / 2,
  };
}

/** Draw order: everything is banded by x + y so nearer things paint over farther ones. */
export function depthOf(x: number, y: number, layer: number): number {
  return (x + y) * 10 + layer;
}

export const LAYER = {
  floor: 0,
  decal: 1,
  highlight: 2,
  route: 3,
  prop: 5,
  unit: 6,
  block: 8,
} as const;

export { BLOCK_H, TILE_H, TILE_W };
