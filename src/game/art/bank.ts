import { Px } from './canvas';
import { P } from './palette';
import { buildTopdown } from './topdown';
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

  put('hoard', fromAscii(HOARD));
  put('goblinDen', fromAscii(DEN));
  put('larder', fromAscii(LARDER));
  for (const cls of ['knight', 'rogue', 'cleric'] as const) HERO_FRAMES[cls].forEach((f, i) => put(`${cls}:${i}`, fromAscii(f)));
  GOBLIN_FRAMES.forEach((f, i) => put(`goblin:${i}`, fromAscii(f)));
  SLIME_FRAMES.forEach((f, i) => put(`slime:${i}`, fromAscii(f)));
  MIMIC_FRAMES.forEach((f, i) => put(`mimic:${i}`, fromAscii(f)));
  put('crown', fromAscii(CROWN));
  put('shadow', shadow());
  for (const [k, v] of buildTopdown(MIMIC_FRAMES)) put(k, v);

  put('maw:0', maw(0, false));
  put('maw:1', maw(0.55, false));
  put('maw:2', maw(1, false));
  put('maw:hurt', maw(0.4, true));
  put('entrance:0', entrance(0));
  put('entrance:1', entrance(1));

  for (let i = 0; i < 4; i++) put(`fire:${i}`, fireColumn(i));
  for (let i = 0; i < 3; i++) put(`smoke:${i}`, smoke(i));

  put('fx:coin', tiny(['.kk.', 'kGyk', 'kGgk', '.kk.'], { G: P.gold, y: P.goldLight, g: P.goldDark }));
  put('fx:essence', tiny(['.cc.', 'cCCc', 'cCCc', '.cc.'], { c: '#2fa89a', C: '#7ff5e4' }));
  put('fx:bone', tiny(['kk...kk', 'kZkkkZk', 'kZZZZZk', 'kZkkkZk', 'kk...kk'], { Z: P.bone }));
  put('fx:spark', tiny(['.Y.', 'YWY', '.Y.'], { Y: P.fireYellow, W: P.white }));
  put('fx:ember', tiny(['O'], { O: P.fireOrange }));
  put('fx:drip', tiny(['M', 'M'], { M: P.slime }));
  put('fx:oil', tiny(['x', 'X'], { X: P.oil, x: P.oilSheen }));
  put('fx:plus', tiny(['.kkk.', 'kkMkk', 'kMMMk', 'kkMkk', '.kkk.'], { M: P.slime }));
  put('fx:star', tiny(['..Y..', '.YYY.', 'YYWYY', '.YYY.', '..Y..'], { Y: P.fireYellow, W: P.white }));
  put('fx:bang', tiny(['kk', 'Yk', 'Yk', 'Yk', 'kk', 'Yk', 'kk'], { Y: P.eye }));
  put('fx:flame', tiny(['.Y.', 'YOY', 'ORO', '.R.'], { Y: P.fireYellow, O: P.fireOrange, R: P.fireRed }));
  put('fx:poison', tiny(['.p.', 'pPp', '.p.'], { P: '#b46cf0', p: '#6a3a9a' }));
  put('fx:dust', tiny(['ww', 'ww'], { w: '#8a7462' }));
  put('fx:rock', tiny(['kk', 'Rk'], { R: '#4a3d55' }));
  put('fx:mist', tiny(['.pp.', 'pPPp', '.pp.'], { P: P.gloomLight, p: P.gloom }));

  put('icon:pick', fromAscii(ICON_PICK));
  put('icon:coin', fromAscii(ICON_COIN));
  put('icon:essence', tiny(['...c....', '..cCc...', '.cCWCc..', 'cCCWCCc.', 'cCCCCCc.', 'cCCCCCc.', '.cCCCc..', '..ccc...'], { c: '#1f7d72', C: '#5fe6d2', W: '#d8fff6' }));
  put('icon:skull', fromAscii(ICON_SKULL));
  put('icon:tooth', fromAscii(ICON_TOOTH));
  put('icon:x', fromAscii(ICON_X));
  put('icon:eye', fromAscii(ICON_EYE));
  put('icon:heart', fromAscii(ICON_HEART));
  return bank;
}
