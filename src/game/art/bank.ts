import { BLOCK_H, Px, TILE_H, TILE_W, diamondHalf, inDiamond, noise, onDiamondEdge } from './canvas';
import { P } from './palette';
import {
  CROWN,
  DEN,
  GOBLIN_FRAMES,
  HERO_FRAMES,
  HOARD,
  ICON_COIN,
  ICON_EYE,
  ICON_HEART,
  ICON_PICK,
  ICON_SKULL,
  ICON_TOOTH,
  ICON_X,
  LARDER,
  MIMIC_FRAMES,
  SLIME_FRAMES,
} from './sprites';

/** Every generated image, by name. Animated things are name:0, name:1, ... */
export type Bank = Map<string, HTMLCanvasElement>;

function fromAscii(rows: string[]): HTMLCanvasElement {
  const w = Math.max(...rows.map((r) => r.length));
  const p = new Px(w, rows.length);
  p.ascii(rows);
  return p.canvas;
}

// ---------------------------------------------------------------- ground

function floorTile(seed: number): HTMLCanvasElement {
  const p = new Px(TILE_W, TILE_H);
  for (let y = 0; y < TILE_H; y++)
    for (let x = 0; x < TILE_W; x++) {
      if (!inDiamond(x, y)) continue;
      const n = noise(x, y, seed);
      let c: string = P.dirt;
      if (n < 0.18) c = P.dirtDark;
      else if (n > 0.86) c = P.dirtLight;
      // Light from the upper left: darken the lower-right half a little.
      if (x + y * 2 > 40 && n < 0.45) c = P.dirtDark;
      p.set(x, y, c);
    }
  // Pebbles and a crack or two.
  for (let k = 0; k < 4; k++) {
    const x = 6 + Math.floor(noise(k, 1, seed) * 20);
    const y = 4 + Math.floor(noise(k, 2, seed) * 8);
    if (inDiamond(x, y) && inDiamond(x + 1, y)) {
      p.set(x, y, P.pebble);
      p.set(x + 1, y, P.dirtDark);
    }
  }
  if (seed % 2 === 0) {
    let x = 10 + (seed % 7);
    let y = 6;
    for (let k = 0; k < 5; k++) {
      if (inDiamond(x, y)) p.set(x, y, P.crack);
      x += 1;
      y += noise(k, 9, seed) > 0.5 ? 1 : 0;
    }
  }
  for (let y = 0; y < TILE_H; y++)
    for (let x = 0; x < TILE_W; x++) if (onDiamondEdge(x, y) && (y >= TILE_H / 2 || x >= TILE_W / 2)) p.set(x, y, P.dirtEdge);
  return p.canvas;
}

/** A raised iso block: top diamond plus two shaded faces. */
function block(seed: number, top: string, topLight: string, topDark: string, left: string, right: string, deco: 'moss' | 'crystal'): HTMLCanvasElement {
  const p = new Px(TILE_W, TILE_H + BLOCK_H);
  // Faces
  for (let x = 0; x < TILE_W; x++) {
    let bottom = 0;
    for (let y = 0; y < TILE_H; y++) if (inDiamond(x, y)) bottom = y;
    for (let y = bottom + 1; y <= bottom + BLOCK_H; y++) {
      const left_ = x < TILE_W / 2;
      let c = left_ ? left : right;
      const n = noise(x, y, seed + 50);
      if (n < 0.12) c = P.outline;
      p.set(x, y, c, n < 0.12 ? 0.35 : 1);
      if (n < 0.12) p.set(x, y, left_ ? left : right, 0.65);
    }
    // Horizontal strata lines
    const strata = bottom + 5 + (x < TILE_W / 2 ? 0 : 1);
    if (noise(x, 3, seed) > 0.35) p.set(x, strata, P.outline, 0.25);
  }
  // Top
  for (let y = 0; y < TILE_H; y++)
    for (let x = 0; x < TILE_W; x++) {
      if (!inDiamond(x, y)) continue;
      const n = noise(x, y, seed);
      let c = top;
      if (n < 0.2) c = topDark;
      else if (n > 0.85 || (y < 5 && n > 0.6)) c = topLight;
      p.set(x, y, c);
    }
  if (deco === 'moss') {
    for (let k = 0; k < 6; k++) {
      const x = 4 + Math.floor(noise(k, 4, seed) * 24);
      const y = 3 + Math.floor(noise(k, 5, seed) * 10);
      if (inDiamond(x, y) && noise(k, 6, seed) > 0.4) {
        p.set(x, y, P.moss);
        if (inDiamond(x + 1, y)) p.set(x + 1, y, P.mossLight);
      }
    }
  } else {
    for (let k = 0; k < 3; k++) {
      const x = 8 + Math.floor(noise(k, 7, seed) * 16);
      const y = 4 + Math.floor(noise(k, 8, seed) * 6);
      p.set(x, y, P.crystalLight);
      p.set(x, y + 1, P.crystal);
      p.set(x + 1, y + 1, P.crystal);
      p.set(x - 1, y + 1, P.crystal);
      p.set(x, y + 2, P.crystal);
    }
  }
  // Edges: dark outline on the faces' outside, light rim on the top-left edges.
  for (let y = 0; y < TILE_H; y++)
    for (let x = 0; x < TILE_W; x++) {
      if (!onDiamondEdge(x, y)) continue;
      p.set(x, y, y < TILE_H / 2 && x < TILE_W / 2 ? topLight : topDark);
    }
  for (let y = TILE_H / 2; y < TILE_H / 2 + BLOCK_H + 1; y++) {
    p.set(0, y, P.outline, 0.7);
    p.set(TILE_W - 1, y, P.outline, 0.7);
  }
  for (let x = 0; x < TILE_W; x++) {
    let bottom = 0;
    for (let y = 0; y < TILE_H; y++) if (inDiamond(x, y)) bottom = y;
    p.set(x, bottom + BLOCK_H, P.outline, 0.8);
  }
  for (let y = TILE_H; y < TILE_H + BLOCK_H - 1; y++) p.set(TILE_W / 2 - 1, y, topDark, 0.5);
  return p.canvas;
}

// ---------------------------------------------------------------- decals (flat on a floor tile)

function decal(paint: (p: Px) => void): HTMLCanvasElement {
  const p = new Px(TILE_W, TILE_H);
  paint(p);
  return p.canvas;
}

function insetDiamond(x: number, y: number, inset: number): boolean {
  // Scale the diamond about its center.
  const cx = TILE_W / 2 - 0.5;
  const cy = TILE_H / 2 - 0.5;
  const k = 1 / (1 - inset);
  const sx = cx + (x - cx) * k;
  const sy = cy + (y - cy) * k;
  return inDiamond(Math.round(sx), Math.round(sy));
}

function spikes(up: boolean): HTMLCanvasElement {
  const p = new Px(TILE_W, TILE_H + 8);
  const oy = 8;
  for (let y = 0; y < TILE_H; y++)
    for (let x = 0; x < TILE_W; x++) if (insetDiamond(x, y, 0.25)) p.set(x, y + oy, onDiamondEdge(x, y) ? P.outline : P.steelDark, insetDiamond(x, y, 0.32) ? 1 : 0.6);
  const holes: [number, number][] = [
    [16, 4],
    [11, 6],
    [21, 6],
    [16, 8],
    [11, 10],
    [21, 10],
    [16, 12],
    [7, 8],
    [25, 8],
  ];
  for (const [x, y] of holes) {
    if (!up) {
      p.set(x, y + oy, P.black);
      p.set(x + 1, y + oy, P.black);
      continue;
    }
    for (let h = 0; h < 7; h++) {
      p.set(x, y + oy - h, h > 4 ? P.white : P.steel);
      if (h < 4) p.set(x + 1, y + oy - h, P.steelMid);
    }
    p.set(x, y + oy - 7, P.outline);
  }
  return p.canvas;
}

function oilSlick(seed: number): HTMLCanvasElement {
  return decal((p) => {
    for (let y = 0; y < TILE_H; y++)
      for (let x = 0; x < TILE_W; x++) {
        if (!insetDiamond(x, y, 0.15)) continue;
        const wob = noise(x >> 2, y >> 1, seed) > 0.75 && !insetDiamond(x, y, 0.3);
        if (wob) continue;
        p.set(x, y, P.oil);
      }
    for (let k = 0; k < 8; k++) {
      const x = 9 + k * 2;
      const y = 5 + (k % 3);
      p.set(x, y, k % 2 ? P.oilSheen : P.oilShine);
      p.set(x + 1, y, P.oilSheen);
    }
    p.set(12, 9, P.purple);
    p.set(13, 9, P.blue);
    p.set(14, 9, P.slime);
  });
}

function gullet(): HTMLCanvasElement {
  const p = new Px(TILE_W, TILE_H);
  for (let y = 0; y < TILE_H; y++)
    for (let x = 0; x < TILE_W; x++) {
      if (!insetDiamond(x, y, 0.08)) continue;
      let c: string = P.flesh;
      if (insetDiamond(x, y, 0.3)) c = P.fleshDark;
      if (insetDiamond(x, y, 0.5)) c = P.fleshDeep;
      if (insetDiamond(x, y, 0.66)) c = P.throat;
      if (c === P.flesh && noise(x, y, 3) > 0.85) c = P.tongue;
      p.set(x, y, c);
    }
  // A ring of little teeth around the pit.
  for (const [x, y] of [
    [11, 5],
    [16, 3],
    [21, 5],
    [8, 8],
    [24, 8],
    [12, 11],
    [20, 11],
  ])
    p.set(x, y, P.tooth);
  // Drool
  p.set(16, 9, P.slimeLight, 0.7);
  return p.canvas;
}

function grate(): HTMLCanvasElement {
  return decal((p) => {
    for (let y = 0; y < TILE_H; y++)
      for (let x = 0; x < TILE_W; x++) {
        if (!insetDiamond(x, y, 0.2)) continue;
        const bar = (x + y * 2) % 6 < 2 || (x - y * 2 + 64) % 6 < 2;
        let c: string = bar ? P.steelDark : P.black;
        if (!insetDiamond(x, y, 0.3)) c = P.steelMid;
        if (!bar && insetDiamond(x, y, 0.55) && noise(x, y, 1) > 0.6) c = P.fireRed;
        p.set(x, y, c);
      }
    for (let y = 0; y < TILE_H; y++) for (let x = 0; x < TILE_W; x++) if (insetDiamond(x, y, 0.2) && !insetDiamond(x + 1, y + 1, 0.2)) p.set(x, y, P.outline);
  });
}

function gloomDecal(frame: number): HTMLCanvasElement {
  return decal((p) => {
    for (let y = 0; y < TILE_H; y++)
      for (let x = 0; x < TILE_W; x++) {
        if (!inDiamond(x, y)) continue;
        const n = noise((x + frame * 3) >> 1, y, 77);
        const a = insetDiamond(x, y, 0.3) ? 0.85 : 0.55;
        p.set(x, y, n > 0.8 ? P.gloomLight : P.gloom, a);
      }
  });
}

function slimePuddle(): HTMLCanvasElement {
  return decal((p) => {
    for (let y = 0; y < TILE_H; y++)
      for (let x = 0; x < TILE_W; x++) {
        if (!insetDiamond(x, y, 0.22)) continue;
        if (!insetDiamond(x, y, 0.32) && noise(x >> 1, y, 5) > 0.6) continue;
        p.set(x, y, insetDiamond(x, y, 0.45) ? P.slimeDark : P.slime, 0.9);
      }
    p.set(12, 6, P.slimeLight);
    p.set(19, 9, P.slimeLight);
    p.set(20, 9, P.slimeLight);
  });
}

function baitCoins(): HTMLCanvasElement {
  return decal((p) => {
    for (const [x, y] of [
      [10, 7],
      [14, 10],
      [20, 6],
      [22, 9],
      [16, 5],
    ]) {
      p.set(x, y, P.gold);
      p.set(x + 1, y, P.goldDark);
      p.set(x, y - 1, P.goldLight);
    }
  });
}

/** Diamond outline or fill used for hover and range highlights. */
function highlight(color: string, fill: number, edge: number, raised: boolean): HTMLCanvasElement {
  const p = new Px(TILE_W, TILE_H);
  for (let y = 0; y < TILE_H; y++)
    for (let x = 0; x < TILE_W; x++) {
      if (!inDiamond(x, y)) continue;
      p.set(x, y, color, onDiamondEdge(x, y) ? edge : fill);
    }
  void raised;
  return p.canvas;
}

// ---------------------------------------------------------------- big pieces

function maw(open: number, hurt: boolean): HTMLCanvasElement {
  const W = 52;
  const H = 40;
  const p = new Px(W, H);
  const cx = 26;
  const cy = 26;
  const lip = hurt ? P.white : P.lip;
  // Eye stalks
  for (const ex of [14, 38]) {
    p.ellipse(ex, 9, 5, 5, P.lipDark);
    p.ellipse(ex, 8, 4, 4, P.tooth);
    p.ellipse(ex + 1, 8, 2, 2.4, P.black);
    p.set(ex - 1, 6, P.white);
  }
  // Fleshy mound
  p.ellipse(cx, cy, 24, 12, P.lipDark);
  p.ellipse(cx, cy - 1, 22, 10.5, lip);
  p.ellipse(cx - 6, cy - 5, 8, 3, P.flesh, 0.8);
  // Mouth
  const mh = 1 + open * 7;
  p.ellipse(cx, cy, 15, mh, P.throat);
  if (open > 0) {
    p.ellipse(cx, cy + mh * 0.45, 9, Math.max(1, mh * 0.45), P.tongueDark);
    p.ellipse(cx, cy + mh * 0.4, 8, Math.max(1, mh * 0.35), P.tongue);
  }
  // Teeth along the top and bottom of the opening
  for (let x = cx - 13; x <= cx + 13; x += 3) {
    const t = (x - cx) / 15;
    const edge = Math.sqrt(Math.max(0, 1 - t * t)) * mh;
    const len = open > 0 ? 3 : 2;
    for (let k = 0; k < len; k++) {
      p.set(x, cy - edge + k, k === len - 1 ? P.toothShade : P.tooth);
      if (k === 0) p.set(x + 1, cy - edge + k, P.toothShade);
      p.set(x + 1, cy + edge - k, k === len - 1 ? P.toothShade : P.tooth);
      if (k === 0) p.set(x + 2, cy + edge - k, P.toothShade);
    }
  }
  p.outline(P.outline);
  return p.canvas;
}

function entrance(frame: number): HTMLCanvasElement {
  const W = 34;
  const H = 46;
  const p = new Px(W, H);
  // Dark doorway
  p.rect(9, 12, 16, 30, P.throat);
  for (let k = 0; k < 6; k++) p.rect(10, 38 - k * 4, 14, 1, P.rockLeft);
  p.rect(12, 14, 10, 8, P.torch, 0.08);
  // Pillars
  for (const x of [3, 25]) {
    p.rect(x, 10, 6, 34, P.rockTop);
    p.rect(x + 4, 10, 2, 34, P.rockLeft);
    for (let y = 14; y < 44; y += 6) p.rect(x, y, 6, 1, P.rockRight);
  }
  // Arch
  for (let x = 3; x < 31; x++) {
    const t = (x - 17) / 14;
    const top = 2 + Math.round(t * t * 8);
    for (let y = top; y < top + 6; y++) p.set(x, y, y < top + 2 ? P.rockTopLight : P.rockTop);
  }
  p.rect(15, 2, 4, 5, P.rockTopDark);
  p.set(16, 3, P.red);
  p.set(17, 3, P.red);
  // Torches
  for (const x of [5, 27]) {
    p.rect(x, 18, 2, 5, P.wood);
    const f = frame === 0 ? 0 : 1;
    p.rect(x - f, 14, 2 + f, 4, P.fireOrange);
    p.rect(x, 15 - f, 2, 2, P.fireYellow);
    p.set(x + f, 13 - f, P.torchHot);
  }
  p.outline(P.outline);
  return p.canvas;
}

function fireColumn(frame: number): HTMLCanvasElement {
  const W = 16;
  const H = 30;
  const p = new Px(W, H);
  const height = [10, 26, 22, 14][frame];
  for (let y = 0; y < height; y++) {
    const t = y / height;
    const width = 6 * (1 - t * 0.7) + Math.sin(y * 1.3 + frame) * 1.2;
    for (let x = -width; x <= width; x++) {
      const ax = Math.abs(x) / width;
      const c = ax < 0.35 && t < 0.7 ? P.fireYellow : ax < 0.7 ? P.fireOrange : P.fireRed;
      p.set(8 + x, H - 1 - y, c);
    }
  }
  return p.canvas;
}

function smoke(frame: number): HTMLCanvasElement {
  const p = new Px(12, 12);
  const r = [3, 4.5, 5.5][frame];
  p.ellipse(6, 6, r, r * 0.85, P.grey, 0.85 - frame * 0.2);
  p.ellipse(5, 5, r * 0.5, r * 0.4, P.white, 0.7 - frame * 0.2);
  return p.canvas;
}

function shadow(): HTMLCanvasElement {
  const p = new Px(14, 6);
  p.ellipse(7, 3, 6.5, 2.6, P.outline, 0.45);
  return p.canvas;
}

function tiny(rows: string[], colors: Record<string, string>): HTMLCanvasElement {
  const w = Math.max(...rows.map((r) => r.length));
  const p = new Px(w, rows.length);
  p.ascii(rows, 0, 0, { k: P.outline, ...colors });
  return p.canvas;
}

/** Builds every image the game uses. Called once at boot (needs a DOM). */
export function buildBank(): Bank {
  const bank: Bank = new Map();
  const put = (name: string, c: HTMLCanvasElement) => bank.set(name, c);

  for (let i = 0; i < 4; i++) put(`floor:${i}`, floorTile(i + 1));
  for (let i = 0; i < 3; i++) put(`rock:${i}`, block(i + 11, P.rockTop, P.rockTopLight, P.rockTopDark, P.rockLeft, P.rockRight, 'moss'));
  for (let i = 0; i < 2; i++) put(`bedrock:${i}`, block(i + 31, P.bedTop, P.crystal, P.bedRight, P.bedLeft, P.bedRight, 'crystal'));

  put('spikes:0', spikes(false));
  put('spikes:1', spikes(true));
  put('oil', oilSlick(4));
  put('gullet', gullet());
  put('fireVent', grate());
  put('gloom:0', gloomDecal(0));
  put('gloom:1', gloomDecal(1));
  put('slimePit', slimePuddle());
  put('mimicBait', baitCoins());
  put('hoard', fromAscii(HOARD));
  put('goblinDen', fromAscii(DEN));
  put('larder', fromAscii(LARDER));

  for (const cls of ['knight', 'rogue', 'cleric'] as const) HERO_FRAMES[cls].forEach((f, i) => put(`${cls}:${i}`, fromAscii(f)));
  GOBLIN_FRAMES.forEach((f, i) => put(`goblin:${i}`, fromAscii(f)));
  SLIME_FRAMES.forEach((f, i) => put(`slime:${i}`, fromAscii(f)));
  MIMIC_FRAMES.forEach((f, i) => put(`mimic:${i}`, fromAscii(f)));
  put('crown', fromAscii(CROWN));
  put('shadow', shadow());

  put('maw:0', maw(0, false));
  put('maw:1', maw(0.55, false));
  put('maw:2', maw(1, false));
  put('maw:hurt', maw(0.4, true));
  put('entrance:0', entrance(0));
  put('entrance:1', entrance(1));

  for (let i = 0; i < 4; i++) put(`fire:${i}`, fireColumn(i));
  for (let i = 0; i < 3; i++) put(`smoke:${i}`, smoke(i));

  put('fx:coin', tiny(['.kk.', 'kGyk', 'kGgk', '.kk.'], { G: P.gold, y: P.goldLight, g: P.goldDark }));
  put('fx:bone', tiny(['kk...kk', 'kZkkkZk', 'kZZZZZk', 'kZkkkZk', 'kk...kk'], { Z: P.bone }));
  put('fx:spark', tiny(['.Y.', 'YWY', '.Y.'], { Y: P.fireYellow, W: P.white }));
  put('fx:ember', tiny(['O'], { O: P.fireOrange }));
  put('fx:drip', tiny(['M', 'M'], { M: P.slime }));
  put('fx:oil', tiny(['x', 'X'], { X: P.oil, x: P.oilSheen }));
  put('fx:plus', tiny(['.kkk.', 'kkMkk', 'kMMMk', 'kkMkk', '.kkk.'], { M: P.slime }));
  put('fx:star', tiny(['..Y..', '.YYY.', 'YYWYY', '.YYY.', '..Y..'], { Y: P.fireYellow, W: P.white }));
  put('fx:bang', tiny(['kk', 'Yk', 'Yk', 'Yk', 'kk', 'Yk', 'kk'], { Y: P.eye }));
  put('fx:flame', tiny(['.Y.', 'YOY', 'ORO', '.R.'], { Y: P.fireYellow, O: P.fireOrange, R: P.fireRed }));
  put('fx:dust', tiny(['ww', 'ww'], { w: P.dirtLight }));
  put('fx:rock', tiny(['kk', 'Rk'], { R: P.rockTopLight }));
  put('fx:mist', tiny(['.pp.', 'pPPp', '.pp.'], { P: P.gloomLight, p: P.gloom }));

  put('hl:hover', highlight(P.white, 0.12, 0.9, false));
  put('hl:ok', highlight(P.slime, 0.25, 0.9, false));
  put('hl:bad', highlight(P.red, 0.25, 0.9, false));
  put('hl:select', highlight(P.gold, 0.15, 1, false));
  put('hl:range', highlight(P.red, 0.14, 0.35, false));
  put('hl:buff', highlight(P.slime, 0.18, 0.6, false));
  put('hl:route', highlight(P.white, 0, 0, false));

  put('icon:pick', fromAscii(ICON_PICK));
  put('icon:coin', fromAscii(ICON_COIN));
  put('icon:skull', fromAscii(ICON_SKULL));
  put('icon:tooth', fromAscii(ICON_TOOTH));
  put('icon:x', fromAscii(ICON_X));
  put('icon:eye', fromAscii(ICON_EYE));
  put('icon:heart', fromAscii(ICON_HEART));
  return bank;
}

/** A floor tile with a feature drawn on it, for build-bar icons. */
export function featureIcon(bank: Bank, name: string): HTMLCanvasElement {
  const p = new Px(TILE_W + 2, TILE_H + 22);
  const oy = 20;
  p.draw(bank.get('floor:0')!, 1, oy);
  const img = bank.get(name) ?? bank.get(`${name}:0`) ?? bank.get(`${name}:1`);
  if (!img) return p.canvas;
  const flat = img.height <= TILE_H + 8 && img.width === TILE_W;
  if (flat) p.draw(img, 1, oy + TILE_H - img.height);
  else p.draw(img, 1 + TILE_W / 2 - Math.floor(img.width / 2), oy + TILE_H / 2 + 2 - img.height);
  return p.canvas;
}

export { diamondHalf };
