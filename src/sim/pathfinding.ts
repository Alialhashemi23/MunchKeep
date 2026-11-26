import type { Grid } from './grid';

export interface DistanceField {
  dist: Float64Array;
  prev: Int32Array;
  start: number;
}

/** Binary min-heap keyed by priority. */
class Heap {
  private items: number[] = [];
  private prios: number[] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: number, prio: number): void {
    const items = this.items;
    const prios = this.prios;
    let i = items.length;
    items.push(item);
    prios.push(prio);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (prios[p] <= prio) break;
      items[i] = items[p];
      prios[i] = prios[p];
      i = p;
    }
    items[i] = item;
    prios[i] = prio;
  }

  pop(): number {
    const items = this.items;
    const prios = this.prios;
    const top = items[0];
    const lastItem = items.pop()!;
    const lastPrio = prios.pop()!;
    const n = items.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && prios[r] < prios[l] ? r : l;
        if (prios[c] >= lastPrio) break;
        items[i] = items[c];
        prios[i] = prios[c];
        i = c;
      }
      items[i] = lastItem;
      prios[i] = lastPrio;
    }
    return top;
  }
}

/**
 * Dijkstra over walkable tiles with 4-way movement.
 * `cost(i)` is the price of stepping onto tile i (>= 1).
 */
export function dijkstra(grid: Grid, start: number, cost: (i: number) => number): DistanceField {
  const n = grid.w * grid.h;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const heap = new Heap();
  dist[start] = 0;
  heap.push(start, 0);
  while (heap.size) {
    const c = heap.pop();
    if (done[c]) continue;
    done[c] = 1;
    for (const nb of grid.neighbors4(c)) {
      if (done[nb] || !grid.isWalkable(nb)) continue;
      const d = dist[c] + cost(nb);
      if (d < dist[nb]) {
        dist[nb] = d;
        prev[nb] = c;
        heap.push(nb, d);
      }
    }
  }
  return { dist, prev, start };
}

/** Tiles from (excluding) the field's start to (including) goal, or null if unreachable. */
export function pathTo(field: DistanceField, goal: number): number[] | null {
  if (goal === field.start) return [];
  if (!Number.isFinite(field.dist[goal])) return null;
  const out: number[] = [];
  for (let c = goal; c !== field.start; c = field.prev[c]) {
    if (c < 0) return null;
    out.push(c);
  }
  return out.reverse();
}
