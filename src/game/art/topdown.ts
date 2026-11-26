import type { RoomId } from '../../sim/content';
import { Px, noise, type Painter } from './canvas';
import { P } from './palette';

/** Tile size of the top-down world, in pixels. */
export const T = 16;

// ---------------------------------------------------------------- floors

export type FloorStyle =
  | 'dirt'
  | 'cave'
  | 'stone'
  | 'straw'
  | 'metal'
  | 'vault'
  | 'wood'
  | 'slime'
  | 'oil'
  | 'scorch'
  | 'gloom'
  | 'bone'
  | 'flesh'
  | 'moss'
  | 'web'
  | 'soul'
  | 'maw';

type Pattern = 'noise' | 'cobble' | 'plank' | 'plate' | 'tile' | 'flesh';

const FLOORS: Record<FloorStyle, { base: string; light: string; dark: string; pattern: Pattern; accent?: string }> = {
  dirt: { base: '#5e4535', light: '#6d513e', dark: '#4c382b', pattern: 'noise' },
  cave: { base: '#54413a', light: '#634c43', dark: '#433430', pattern: 'noise', accent: '#7a6355' },
  stone: { base: '#564a5c', light: '#655869', dark: '#43394a', pattern: 'cobble' },
  straw: { base: '#5c4634', light: '#6b523d', dark: '#4a3829', pattern: 'noise', accent: '#c9a752' },
  metal: { base: '#4f5562', light: '#636a78', dark: '#3c414c', pattern: 'plate' },
  vault: { base: '#5a3f2c', light: '#6c4d36', dark: '#463121', pattern: 'tile', accent: '#f2c14e' },
  wood: { base: '#6e4a31', light: '#80583b', dark: '#553824', pattern: 'plank' },
  slime: { base: '#3f4e40', light: '#4b5d4b', dark: '#323f33', pattern: 'cobble', accent: '#7ee06a' },
  oil: { base: '#35343f', light: '#42414e', dark: '#292832', pattern: 'cobble', accent: '#4a5578' },
  scorch: { base: '#43322f', light: '#53403b', dark: '#332523', pattern: 'cobble', accent: '#ff7a3c' },
  gloom: { base: '#2c2240', light: '#382b50', dark: '#221a33', pattern: 'tile', accent: '#6a44a0' },
  bone: { base: '#6a6458', light: '#7b7467', dark: '#565046', pattern: 'cobble', accent: '#efe6d2' },
  flesh: { base: '#8a3f52', light: '#a04c60', dark: '#6e3042', pattern: 'flesh' },
  moss: { base: '#3f4a3a', light: '#4d5a46', dark: '#323b2e', pattern: 'cobble', accent: '#6f8c5a' },
  web: { base: '#3c3743', light: '#4a4452', dark: '#2e2a34', pattern: 'cobble', accent: '#c3bbb0' },
  soul: { base: '#2e3a4c', light: '#3a4a60', dark: '#232c3a', pattern: 'tile', accent: '#5fe6d2' },
  maw: { base: '#6e3042', light: '#86394f', dark: '#552536', pattern: 'flesh' },
};

/** Paint one 16x16 floor tile at (ox, oy). */
export function paintFloor(p: Painter, ox: number, oy: number, style: FloorStyle, seed: number): void {
  const f = FLOORS[style];
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) {
      const n = noise(x + ox, y + oy, seed);
      let c = n < 0.2 ? f.dark : n > 0.85 ? f.light : f.base;
      switch (f.pattern) {
        case 'cobble': {
          const row = Math.floor(y / 8);
          const sx = (x + (row % 2) * 4) % 8;
          if (y % 8 === 7 || sx === 7) c = f.dark;
          else if (y % 8 === 0 || sx === 0) c = n > 0.5 ? f.light : f.base;
          break;
        }
        case 'plank':
          if (y % 4 === 3) c = f.dark;
          else if ((x + Math.floor(y / 4) * 5) % 16 === 0) c = f.dark;
          break;
        case 'plate':
          if (x === 0 || y === 0) c = f.light;
          if (x === T - 1 || y === T - 1) c = f.dark;
          if ((x === 2 || x === T - 3) && (y === 2 || y === T - 3)) c = f.light;
          break;
        case 'tile':
          if (x % 8 === 7 || y % 8 === 7) c = f.dark;
          else if ((Math.floor(x / 8) + Math.floor(y / 8)) % 2) c = n > 0.5 ? f.base : f.light;
          break;
        case 'flesh':
          if (noise(Math.floor((x + ox) / 3), Math.floor((y + oy) / 2), seed + 9) > 0.86) c = f.dark;
          break;
      }
      p.set(ox + x, oy + y, c);
    }
  // Accents
  if (f.accent) {
    for (let k = 0; k < 4; k++) {
      const x = Math.floor(noise(k, ox, seed + 3) * 14) + 1;
      const y = Math.floor(noise(k, oy, seed + 4) * 14) + 1;
      if (noise(k, ox + oy, seed + 5) < 0.55) continue;
      p.set(ox + x, oy + y, f.accent);
      if (style === 'straw') p.set(ox + x + 1, oy + y + (k % 2 ? 1 : -1), f.accent);
      if (style === 'slime' || style === 'moss') p.set(ox + x + 1, oy + y, f.accent);
    }
  }
}

export function paintRock(p: Painter, ox: number, oy: number, seed: number): void {
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) {
      const n = noise(x + ox, y + oy, seed);
      p.set(ox + x, oy + y, n < 0.22 ? '#231c29' : n > 0.88 ? '#3b3145' : '#2d2535');
    }
  if (noise(ox, oy, seed + 1) > 0.93) {
    const x = ox + 4 + Math.floor(noise(ox, oy, seed + 2) * 8);
    const y = oy + 4 + Math.floor(noise(oy, ox, seed + 2) * 8);
    p.set(x, y, P.crystalLight);
    p.set(x, y + 1, P.crystal);
    p.set(x - 1, y + 1, P.crystal);
  }
}

/** A south-facing wall: brick face with a lit lip on top. */
export function paintWall(p: Painter, ox: number, oy: number, seed: number): void {
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) {
      let c = '#4a3d55';
      if (y < 3) c = y === 0 ? '#2d2535' : '#5f4f6c';
      else {
        const row = Math.floor((y - 3) / 4);
        const bx = (x + (row % 2) * 4) % 8;
        if ((y - 3) % 4 === 3 || bx === 7) c = '#2a2131';
        else if (noise(x + ox, y + oy, seed) > 0.8) c = '#564766';
      }
      if (y === T - 1) c = '#1b1020';
      p.set(ox + x, oy + y, c);
    }
}

// ---------------------------------------------------------------- props and monsters

const SKELETON = [
  '....kkkk....',
  '...kZZZZk...',
  '..kZEZZEZk..',
  '..kZZZZZZk..',
  '...kZkZkk...',
  '....kZZk....',
  '..kkZZZZkk..',
  '.kZkZkkZkZk.',
  '.kZkZZZZkZk.',
  '..k.kZZk.k..',
  '....kZZk....',
];
export const SKELETON_FRAMES = [
  [...SKELETON, '...kZkkZk...', '...kZk.kZk..', '...kk...kk..'],
  [...SKELETON, '...kZkkZk...', '....kZkZk...', '....kk.kk...'],
];

const TROLL = [
  '......kkkkkk........',
  '.....knnnnnnk.......',
  '....knnNNNNnnk......',
  '....knYEnnYEnk......',
  '....knnnnnnnnk......',
  '....knWkWWkWnk......',
  '.....knnnnnnk...kk..',
  '...kknnnnnnnnkkkBBk.',
  '..knnnnnnnnnnnnkBBk.',
  '.knnknnnnnnnnknnkBk.',
  '.knnknnnnnnnnknnkBk.',
  '.knk.knnnnnnk.knkk..',
  '.knk.kbbbbbbk.knk...',
  '..k..kbbbbbbk..k....',
];
export const TROLL_FRAMES = [
  [...TROLL, '.....knnkknnk.......', '.....knnk.knnk......', '....knnk...knnk.....', '....kkk.....kkk.....'],
  [...TROLL, '.....knnkknnk.......', '.....knnkknnk.......', '.....knnkknnk.......', '.....kkk..kkk.......'],
];

export const SPIDER_FRAMES = [
  ['k...k....k...k', '.k..k....k..k.', '..k.kkkkkk.k..', '...kppppppk...', 'kkkppRppRppkkk', '...kppppppk...', '..k.kppppk.k..', '.k..k.kk.k..k.', 'k...k....k...k'],
  ['.k..k....k..k.', '.k..k....k..k.', '..k.kkkkkk.k..', 'k..kppppppk..k', '.kkppRppRppkk.', '...kppppppk...', '.k..kppppk..k.', '.k..k.kk.k..k.', '..k.k....k.k..'],
];

const COFFIN = [
  '..kkkkkk..',
  '.kBBBBBBk.',
  'kBBbBBbBBk',
  'kBBBBBBBBk',
  'kBBBkkBBBk',
  'kBBkZZkBBk',
  'kBkZZZZkBk',
  'kBBkZZkBBk',
  'kBBkZZkBBk',
  'kBBBkkBBBk',
  '.kBBBBBBk.',
  '.kBBBBBBk.',
  '..kBBBBk..',
  '..kbbbbk..',
  '...kkkk...',
];

const BARREL = ['..kkkkkk..', '.kBBBBBBk.', 'kssssssssk', 'kBBbBBbBBk', 'kBBbBBbBBk', 'kssssssssk', 'kBBbBBbBBk', 'kBBbBBbBBk', 'kssssssssk', '.kBBBBBBk.', '..kkkkkk..'];
const OIL_BARREL = BARREL.map((r) => r.replace(/B/g, 'X').replace(/b/g, 'x'));
const CAMPFIRE = [
  ['....Y.....', '...YOY....', '..YOROY...', '..ORROO...', '.kBkkkBk..', 'kBBkBBkBBk', '.kk...kk..'],
  ['...Y......', '..YOY.Y...', '..OROYO...', '..ORRRO...', '.kBkkkBk..', 'kBBkBBkBBk', '.kk...kk..'],
];
const BONES = ['kk.....kk.', 'kZkkkkkZk.', 'kZZZZZZZk.', 'kZkkkkkZkk', 'kk..kZZZZk', '....kkkkk.'];
const SKULL = ['.kkkk.', 'kZZZZk', 'kEZZEk', 'kZZZZk', '.kZZk.', '.kkkk.'];
const EGGS = ['.kkk.kkk..', 'kWWWkWWWk.', 'kWwWkWwWk.', '.kkk.kkkkk', '....kWWWWk', '.....kkkk.'];
const GEMS = ['.k..k.', 'kRkkUk', 'kRkkUk', '.k..k.'];
const CANDLE = [
  ['.Y.', '.O.', 'kWk', 'kWk', 'kWk', 'kwk', 'kkk'],
  ['Y..', '.O.', 'kWk', 'kWk', 'kWk', 'kwk', 'kkk'],
];
const TORCH = [
  ['.YY..', 'YOOY.', '.OR..', '.kBk.', '.kBk.', '..k..'],
  ['..Y..', '.YOY.', '.ROO.', '.kBk.', '.kBk.', '..k..'],
];
const CHEST_ROWS = (rows: string[]) => rows.map((r) => r.replace(/T/g, 'G'));

export interface PropSprites {
  [name: string]: HTMLCanvasElement;
}

function ascii(rows: string[]): HTMLCanvasElement {
  const w = Math.max(...rows.map((r) => r.length));
  const p = new Px(w, rows.length);
  p.ascii(rows);
  return p.canvas;
}

function spikeTile(up: boolean): HTMLCanvasElement {
  const p = new Px(T, T);
  for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) p.set(x, y, x === 2 || y === 2 ? '#3c414c' : x === 13 || y === 13 ? '#2a2e36' : '#474d59');
  for (const [x, y] of [
    [4, 5],
    [8, 5],
    [12, 5],
    [6, 9],
    [10, 9],
    [4, 13],
    [8, 13],
    [12, 13],
  ]) {
    if (!up) {
      p.set(x, y - 1, P.black);
      p.set(x - 1, y - 1, P.black);
      continue;
    }
    p.set(x, y - 1, P.steelDark);
    p.set(x - 1, y - 1, P.steelDark);
    p.set(x, y - 2, P.steel);
    p.set(x - 1, y - 2, P.steelMid);
    p.set(x - 1, y - 3, P.white);
    p.set(x - 1, y - 4, P.white);
  }
  return p.canvas;
}

function pool(w: number, h: number, inner: string, outer: string, rim: string, frame: number, bubbles: string): HTMLCanvasElement {
  const p = new Px(w, h);
  const cx = w / 2;
  const cy = h / 2;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = (x + 0.5 - cx) / (w / 2);
      const dy = (y + 0.5 - cy) / (h / 2);
      const wob = 0.08 * Math.sin(Math.atan2(dy, dx) * 5 + frame);
      const r = Math.sqrt(dx * dx + dy * dy);
      if (r > 1 - wob) continue;
      p.set(x, y, r > 0.86 - wob ? rim : r > 0.55 ? outer : inner);
    }
  const pts = frame ? [[0.3, 0.4], [0.62, 0.55]] : [[0.45, 0.35], [0.7, 0.6], [0.35, 0.62]];
  for (const [fx, fy] of pts) {
    const x = Math.floor(w * fx);
    const y = Math.floor(h * fy);
    p.set(x, y, bubbles);
    p.set(x + 1, y, bubbles);
    p.set(x, y - 1, bubbles);
  }
  return p.canvas;
}

function oilPuddle(): HTMLCanvasElement {
  const p = new Px(30, 14);
  p.ellipse(15, 7, 14, 6, P.oil);
  p.ellipse(11, 6, 4, 1.5, P.oilSheen);
  p.set(18, 8, P.oilShine);
  p.set(19, 8, P.purple);
  p.set(20, 8, P.slime);
  return p.canvas;
}

function vent(): HTMLCanvasElement {
  const p = new Px(16, 12);
  p.rect(0, 0, 16, 12, P.outline);
  p.rect(1, 1, 14, 10, P.steelDark);
  for (let x = 2; x < 14; x += 3) p.rect(x, 2, 2, 8, P.black);
  for (let x = 2; x < 14; x += 3) p.set(x, 8, P.fireRed);
  return p.canvas;
}

function mist(): HTMLCanvasElement {
  const p = new Px(44, 22);
  for (let y = 0; y < 22; y++)
    for (let x = 0; x < 44; x++) {
      const dx = (x - 22) / 22;
      const dy = (y - 11) / 11;
      const r = dx * dx + dy * dy;
      if (r > 1) continue;
      const n = noise(x >> 1, y >> 1, 41);
      if (n > 0.55) p.set(x, y, n > 0.85 ? P.gloomLight : P.gloom, 0.6 * (1 - r));
    }
  return p.canvas;
}

function gulletPit(frame: number): HTMLCanvasElement {
  const p = new Px(64, 40);
  p.ellipse(32, 20, 31, 19, P.fleshDark);
  p.ellipse(32, 20, 27, 16, P.flesh);
  p.ellipse(32, 21, 21, 12, P.fleshDeep);
  p.ellipse(32, 22, 15, 8 + frame, P.throat);
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2;
    const x = 32 + Math.cos(a) * 21;
    const y = 21 + Math.sin(a) * 12;
    p.set(x, y, P.tooth);
    p.set(x, y + (Math.sin(a) > 0 ? -1 : 1), P.toothShade);
  }
  p.ellipse(26, 14, 5, 1.5, P.tongue, 0.8);
  p.set(32, 30 + frame, P.slimeLight);
  p.outline(P.outline);
  return p.canvas;
}

function pitHole(): HTMLCanvasElement {
  const p = new Px(46, 30);
  p.ellipse(23, 15, 22, 14, '#3e3446');
  p.ellipse(23, 15, 19, 12, '#2a2131');
  p.ellipse(23, 16, 16, 10, P.black);
  for (let k = 0; k < 6; k++) {
    const x = 14 + k * 3.5;
    p.set(x, 21, P.steelDark);
    p.set(x, 20, P.steelMid);
  }
  p.outline(P.outline);
  return p.canvas;
}

function nest(): HTMLCanvasElement {
  const p = new Px(54, 32);
  p.ellipse(27, 16, 26, 15, '#4a3b2a');
  p.ellipse(27, 16, 20, 11, '#3a2e22');
  for (let k = 0; k < 22; k++) {
    const a = (k / 22) * Math.PI * 2;
    const r = 0.85 + noise(k, 1, 5) * 0.15;
    const x = 27 + Math.cos(a) * 23 * r;
    const y = 16 + Math.sin(a) * 13 * r;
    const len = 3 + Math.floor(noise(k, 2, 5) * 3);
    for (let i = 0; i < len; i++) p.set(x + i * Math.cos(a + 1.6), y + i * Math.sin(a + 1.6) * 0.6, k % 3 ? P.bone : P.wood);
  }
  p.outline(P.outline);
  return p.canvas;
}

function web(): HTMLCanvasElement {
  const p = new Px(28, 22);
  const c = '#c3bbb0';
  for (let k = 0; k < 5; k++) {
    const a = (k / 4) * (Math.PI / 2);
    for (let r = 0; r < 26; r++) p.set(Math.cos(a) * r, Math.sin(a) * r * 0.8, c, 0.7);
  }
  for (const r of [7, 13, 19]) for (let k = 0; k <= 20; k++) {
    const a = (k / 20) * (Math.PI / 2);
    p.set(Math.cos(a) * r, Math.sin(a) * r * 0.8, c, 0.55);
  }
  return p.canvas;
}

function well(): HTMLCanvasElement {
  const p = new Px(24, 20);
  p.ellipse(12, 11, 11, 8, '#4f4757');
  p.ellipse(12, 10, 9, 6, '#6a6072');
  p.ellipse(12, 10, 6.5, 4, '#2e6c7a');
  p.ellipse(12, 10, 4, 2.5, '#5fe6d2');
  p.set(10, 9, '#d8fff6');
  for (let x = 2; x < 22; x += 4) p.set(x, 15, '#3a3342');
  p.outline(P.outline);
  return p.canvas;
}

function chestFrames(mimicRows: string[][]): HTMLCanvasElement {
  return ascii(CHEST_ROWS(mimicRows[0]));
}

/** Everything top-down specific, ready to merge into the bank. */
export function buildTopdown(mimicRows: string[][]): Map<string, HTMLCanvasElement> {
  const out = new Map<string, HTMLCanvasElement>();
  SKELETON_FRAMES.forEach((f, i) => out.set(`skeleton:${i}`, ascii(f)));
  TROLL_FRAMES.forEach((f, i) => out.set(`troll:${i}`, ascii(f)));
  SPIDER_FRAMES.forEach((f, i) => out.set(`spider:${i}`, ascii(f)));
  out.set('td:coffin', ascii(COFFIN));
  out.set('td:barrel', ascii(BARREL));
  out.set('td:oilbarrel', ascii(OIL_BARREL));
  CAMPFIRE.forEach((f, i) => out.set(`td:campfire:${i}`, ascii(f)));
  out.set('td:bones', ascii(BONES));
  out.set('td:skull', ascii(SKULL));
  out.set('td:eggs', ascii(EGGS));
  out.set('td:gems', ascii(GEMS));
  CANDLE.forEach((f, i) => out.set(`td:candle:${i}`, ascii(f)));
  TORCH.forEach((f, i) => out.set(`td:torch:${i}`, ascii(f)));
  out.set('td:chest', chestFrames(mimicRows));
  out.set('td:spikes:0', spikeTile(false));
  out.set('td:spikes:1', spikeTile(true));
  out.set('td:slimepool:0', pool(58, 30, P.slimeDark, P.slime, '#2f6b37', 0, P.slimeLight));
  out.set('td:slimepool:1', pool(58, 30, P.slimeDark, P.slime, '#2f6b37', 1, P.slimeLight));
  out.set('td:oilpuddle', oilPuddle());
  out.set('td:vent', vent());
  out.set('td:mist', mist());
  out.set('td:gulletpit:0', gulletPit(0));
  out.set('td:gulletpit:1', gulletPit(1));
  out.set('td:pithole', pitHole());
  out.set('td:nest', nest());
  out.set('td:web', web());
  out.set('td:well', well());
  return out;
}

// ---------------------------------------------------------------- room layouts

/** A decoration inside a room. x/y are tile offsets from the room center; flat props lie on the floor. */
export interface Prop {
  tex: string;
  x: number;
  y: number;
  flat?: boolean;
  frames?: number;
  flip?: boolean;
  scale?: number;
}

export type RoomLook = RoomId | 'gate' | 'maw' | 'empty';

export const ROOM_LOOK: Record<RoomLook, { floor: FloorStyle; props: Prop[] }> = {
  empty: { floor: 'cave', props: [] },
  gate: { floor: 'stone', props: [{ tex: 'entrance', x: 0, y: -1.6, frames: 2 }] },
  maw: { floor: 'maw', props: [] },
  goblinWarren: {
    floor: 'straw',
    props: [
      { tex: 'goblinDen', x: -2, y: -0.9 },
      { tex: 'goblinDen', x: 2.1, y: -1.1, flip: true },
      { tex: 'td:campfire', x: 0, y: 0.1, frames: 2 },
      { tex: 'td:bones', x: -2.3, y: 1.5, flat: true },
      { tex: 'td:skull', x: 2.4, y: 1.4, flat: true },
    ],
  },
  spikeHall: {
    floor: 'metal',
    props: [-2, -1, 0, 1, 2].flatMap((x) => [
      { tex: 'td:spikes', x, y: -1, flat: true, frames: 2 },
      { tex: 'td:spikes', x, y: 1, flat: true, frames: 2 },
    ]),
  },
  vault: {
    floor: 'vault',
    props: [
      { tex: 'hoard', x: -1.7, y: 0.6 },
      { tex: 'hoard', x: 1.8, y: 1.0 },
      { tex: 'td:chest', x: 0, y: -0.6 },
      { tex: 'td:gems', x: 2.4, y: -1.2, flat: true },
      { tex: 'td:gems', x: -2.5, y: -1.4, flat: true },
    ],
  },
  larder: {
    floor: 'wood',
    props: [
      { tex: 'larder', x: 0, y: 0.6 },
      { tex: 'td:barrel', x: -2.4, y: -0.9 },
      { tex: 'td:barrel', x: 2.4, y: -0.9 },
      { tex: 'td:barrel', x: 2.6, y: 1.4 },
    ],
  },
  slimePit: { floor: 'slime', props: [{ tex: 'td:slimepool', x: 0, y: 0.2, flat: true, frames: 2 }] },
  oilCellar: {
    floor: 'oil',
    props: [
      { tex: 'td:oilpuddle', x: -1.4, y: -0.4, flat: true },
      { tex: 'td:oilpuddle', x: 1.3, y: 0.7, flat: true },
      { tex: 'td:oilpuddle', x: -0.4, y: 1.5, flat: true },
      { tex: 'td:oilbarrel', x: -2.6, y: -1.0 },
      { tex: 'td:oilbarrel', x: 2.6, y: -1.0 },
    ],
  },
  flameGallery: {
    floor: 'scorch',
    props: [
      { tex: 'td:vent', x: -2, y: 0, flat: true },
      { tex: 'td:vent', x: 0, y: 0, flat: true },
      { tex: 'td:vent', x: 2, y: 0, flat: true },
    ],
  },
  gloomHall: {
    floor: 'gloom',
    props: [
      { tex: 'td:mist', x: -1.4, y: -0.4, flat: true },
      { tex: 'td:mist', x: 1.3, y: 0.8, flat: true },
      { tex: 'td:candle', x: -2.6, y: -1.2, frames: 2 },
      { tex: 'td:candle', x: 2.6, y: -1.2, frames: 2 },
      { tex: 'td:candle', x: 0, y: 1.7, frames: 2 },
    ],
  },
  boneCrypt: {
    floor: 'bone',
    props: [
      { tex: 'td:coffin', x: -2.2, y: -0.9 },
      { tex: 'td:coffin', x: 0, y: -1.0 },
      { tex: 'td:coffin', x: 2.2, y: -0.9 },
      { tex: 'td:bones', x: -1.2, y: 1.4, flat: true },
      { tex: 'td:skull', x: 1.6, y: 1.5, flat: true },
    ],
  },
  gullet: { floor: 'flesh', props: [{ tex: 'td:gulletpit', x: 0, y: 0.1, flat: true, frames: 2 }] },
  mimicVault: {
    floor: 'vault',
    props: [
      { tex: 'hoard', x: -1.8, y: 0.8 },
      { tex: 'hoard', x: 1.9, y: 1.1 },
      { tex: 'td:gems', x: -2.4, y: -1.3, flat: true },
      { tex: 'td:gems', x: 2.5, y: -1.1, flat: true },
    ],
  },
  trollDen: {
    floor: 'moss',
    props: [
      { tex: 'td:nest', x: 0, y: 0.3, flat: true },
      { tex: 'td:skull', x: -2.4, y: -1.2, flat: true },
      { tex: 'td:bones', x: 2.2, y: 1.5, flat: true },
    ],
  },
  spiderNest: {
    floor: 'web',
    props: [
      { tex: 'td:web', x: -2.6, y: -1.6, flat: true },
      { tex: 'td:web', x: 2.6, y: -1.6, flat: true, flip: true },
      { tex: 'td:eggs', x: -2, y: 1.2 },
      { tex: 'td:eggs', x: 2.2, y: -0.6 },
      { tex: 'td:eggs', x: 0.3, y: 1.6 },
    ],
  },
  pitDrop: { floor: 'stone', props: [{ tex: 'td:pithole', x: 0, y: 0.2, flat: true }] },
  soulWell: {
    floor: 'soul',
    props: [
      { tex: 'td:well', x: 0, y: 0.6 },
      { tex: 'td:candle', x: -2.5, y: -1.2, frames: 2 },
      { tex: 'td:candle', x: 2.5, y: -1.2, frames: 2 },
    ],
  },
};

/** Where monsters stand when nobody is fighting them (tile offsets from the room center). */
export const MONSTER_SPOTS: [number, number][] = [
  [-1.2, 0.6],
  [1.2, 0.6],
  [0, 1.5],
  [-2.3, 1.2],
  [2.3, 1.2],
  [0, -0.4],
  [-1.6, -0.6],
  [1.6, -0.6],
];

/** A little picture of a room for the catalog: a wall row on top, its floor and props. */
export function roomPreview(bank: Map<string, HTMLCanvasElement>, look: RoomLook): HTMLCanvasElement {
  const W = 7;
  const H = 5;
  const p = new Px(W * T, (H + 1) * T);
  for (let x = 0; x < W; x++) paintWall(p, x * T, 0, 11 + x);
  const style = ROOM_LOOK[look].floor;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) paintFloor(p, x * T, (y + 1) * T, style, 7);
  for (let x = 0; x < W; x++) for (let k = 0; k < 3; k++) p.set(x * T + k * 6, T, '#000', 0.35);
  p.rect(0, T, W * T, 3, '#000', 0.35);
  const cx = (W * T) / 2;
  const cy = T + (H * T) / 2;
  const props = [...ROOM_LOOK[look].props].sort((a, b) => Number(!!b.flat) - Number(!!a.flat) || a.y - b.y);
  for (const pr of props) {
    const img = bank.get(pr.tex) ?? bank.get(`${pr.tex}:0`);
    if (!img) continue;
    const x = cx + pr.x * T - img.width / 2;
    const y = pr.flat ? cy + pr.y * T - img.height / 2 : cy + pr.y * T - img.height + 4;
    p.draw(img, x, y, pr.flip);
  }
  return p.canvas;
}
