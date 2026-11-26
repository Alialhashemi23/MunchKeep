import { BALANCE } from './content';
import type { Rng } from './rng';

/** A place a room can go. Coordinates are tile units; (x, y) is the room's center. */
export interface Site {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  region: number;
  kind: 'gate' | 'maw' | 'site';
}

/** A corridor that could be dug between two sites. */
export interface Edge {
  id: number;
  a: number;
  b: number;
  len: number;
}

export interface Cave {
  w: number;
  h: number;
  sites: Site[];
  edges: Edge[];
  /** Edge ids touching each site. */
  adj: number[][];
  gate: number;
  maw: number;
  /** Sites from the gate to the Maw that start out dug and connected. */
  startRoute: number[];
  regionCount: number;
}

function segRectHit(ax: number, ay: number, bx: number, by: number, s: Site, pad: number): boolean {
  const x0 = s.x - s.w / 2 - pad;
  const x1 = s.x + s.w / 2 + pad;
  const y0 = s.y - s.h / 2 - pad;
  const y1 = s.y + s.h / 2 + pad;
  // Liang-Barsky clip
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dy = by - ay;
  const clip = (p: number, q: number) => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  return clip(-dx, ax - x0) && clip(dx, x1 - ax) && clip(-dy, ay - y0) && clip(dy, y1 - ay) && t0 <= t1;
}

export function otherEnd(e: Edge, site: number): number {
  return e.a === site ? e.b : e.a;
}

/** Builds a new cave layout. Same seed, same cave. */
export function generateCave(rng: Rng): Cave {
  const W = BALANCE.caveW;
  const H = BALANCE.caveH;
  const sp = BALANCE.siteSpacing;
  const sites: Site[] = [];
  const add = (x: number, y: number, kind: Site['kind']) => {
    const big = kind === 'maw';
    sites.push({ id: sites.length, x, y, w: big ? BALANCE.mawW : BALANCE.roomW, h: big ? BALANCE.mawH : BALANCE.roomH, region: -1, kind });
  };
  add(Math.round(W / 2 + rng.range(-10, 10)), 4, 'gate');
  add(Math.round(W / 2 + rng.range(-8, 8)), H - 6, 'maw');
  for (let k = 0; k < 4000 && sites.length < 40; k++) {
    const x = Math.round(rng.range(6, W - 6));
    const y = Math.round(rng.range(6, H - 6));
    if (sites.every((s) => Math.hypot(s.x - x, s.y - y) >= sp)) add(x, y, 'site');
  }

  // Gabriel graph, without corridors that would cut through another room.
  const edges: Edge[] = [];
  const n = sites.length;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const a = sites[i];
      const b = sites[j];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d > BALANCE.maxCorridor) continue;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      let ok = true;
      for (let k = 0; k < n && ok; k++) {
        if (k === i || k === j) continue;
        const c = sites[k];
        if (Math.hypot(c.x - mx, c.y - my) < d / 2) ok = false;
        else if (segRectHit(a.x, a.y, b.x, b.y, c, 1)) ok = false;
      }
      if (ok) edges.push({ id: edges.length, a: i, b: j, len: d });
    }

  // Make sure everything is connected.
  const parent = sites.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (const e of edges) parent[find(e.a)] = find(e.b);
  for (;;) {
    const roots = new Set(sites.map((s) => find(s.id)));
    if (roots.size <= 1) break;
    let best: [number, number, number] | null = null;
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        if (find(i) === find(j)) continue;
        const d = Math.hypot(sites[i].x - sites[j].x, sites[i].y - sites[j].y);
        if (!best || d < best[2]) best = [i, j, d];
      }
    if (!best) break;
    edges.push({ id: edges.length, a: best[0], b: best[1], len: best[2] });
    parent[find(best[0])] = find(best[1]);
  }

  const adj: number[][] = sites.map(() => []);
  for (const e of edges) {
    adj[e.a].push(e.id);
    adj[e.b].push(e.id);
  }

  // Starting route: shortest path from the gate to the Maw.
  const gate = 0;
  const maw = 1;
  const dist = new Array(n).fill(Infinity);
  const prev = new Array(n).fill(-1);
  const done = new Array(n).fill(false);
  dist[gate] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done[i] && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0 || !Number.isFinite(dist[u])) break;
    done[u] = true;
    for (const eid of adj[u]) {
      const e = edges[eid];
      const v = otherEnd(e, u);
      if (dist[u] + e.len < dist[v]) {
        dist[v] = dist[u] + e.len;
        prev[v] = u;
      }
    }
  }
  const startRoute: number[] = [];
  for (let c = maw; c !== -1; c = prev[c]) startRoute.push(c);
  startRoute.reverse();

  // Region 0: the starting route plus a couple of its neighbors to build on.
  for (const s of startRoute) sites[s].region = 0;
  const extras = sites.filter((s) => s.region < 0 && adj[s.id].some((eid) => sites[otherEnd(edges[eid], s.id)].region === 0));
  for (let i = 0; i < 2 && extras.length; i++) extras.splice(Math.floor(rng.next() * extras.length), 1)[0].region = 0;

  // The rest: split into regions around far-apart seeds.
  const rest = sites.filter((s) => s.region < 0);
  const seeds: Site[] = [];
  const k = Math.min(BALANCE.regions, rest.length);
  const zero = sites.filter((s) => s.region === 0);
  for (let r = 0; r < k; r++) {
    let best: Site | null = null;
    let bestD = -1;
    for (const s of rest) {
      if (seeds.includes(s)) continue;
      const d = Math.min(...[...seeds, ...(seeds.length ? [] : zero)].map((t) => Math.hypot(t.x - s.x, t.y - s.y)));
      if (d > bestD) {
        bestD = d;
        best = s;
      }
    }
    if (best) seeds.push(best);
  }
  for (const s of rest) {
    let bi = 0;
    let bd = Infinity;
    seeds.forEach((seed, i) => {
      const d = Math.hypot(seed.x - s.x, seed.y - s.y);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    });
    s.region = bi + 1;
  }

  return { w: W, h: H, sites, edges, adj, gate, maw, startRoute, regionCount: seeds.length + 1 };
}
