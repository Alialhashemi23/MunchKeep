import Phaser from 'phaser';
import { BALANCE, ROOMS, type RoomKind } from '../sim/content';
import type { Hero, Monster, Party, Sim, SimEvent } from '../sim/sim';
import type { Bank } from './art/bank';
import { PixBuf } from './art/canvas';
import { FONT_CELL_H, FONT_CELL_W, FONT_CHARS, buildFontSheet } from './art/font';
import { MONSTER_SPOTS, ROOM_LOOK, T, paintFloor, paintRock, paintWall, type FloorStyle, type RoomLook } from './art/topdown';
import type { Keeper } from './keeper';

type Img = Phaser.GameObjects.Image;

const ROUTE_COLORS = { knight: 0xc9d1dd, rogue: 0x7ee06a, cleric: 0xf2c14e } as const;
const KIND_TINT: Record<RoomKind, number> = { monster: 0xff8a8a, trap: 0xffb36b, lure: 0xf2c14e, support: 0x9be07a, economy: 0xc08cff };
const COLOR = { white: 0xffffff, gold: 0xf2c14e, red: 0xff5a5a, orange: 0xff9a3c, green: 0x8be06a, purple: 0xc08cff, grey: 0xb8aec0, yellow: 0xffe066, cyan: 0x7ff5e4 };
const FORMATION: [number, number][] = [
  [0, 0],
  [-12, 6],
  [12, 6],
  [-6, -8],
  [6, -8],
  [-18, -2],
  [18, -2],
  [0, 12],
];

/** Sim tile coordinates -> world pixels (tile centers). */
const wx = (x: number) => x * T + T / 2;
const wy = (y: number) => y * T + T / 2;

interface UnitView {
  c: Phaser.GameObjects.Container;
  body: Img;
  bar: Phaser.GameObjects.Graphics;
  status: Img;
  crown: Img | null;
  base: string;
  x: number;
  y: number;
  lastAttack: number;
  lastHit: number;
  animT: number;
  frame: number;
  hpShown: number;
  hero: boolean;
  scale: number;
}

interface SiteView {
  key: string;
  objs: Phaser.GameObjects.GameObject[];
  anims: { img: Img; tex: string; frames: number }[];
  spikes: Img[];
  vents: { x: number; y: number }[];
}

export class WorldScene extends Phaser.Scene {
  private sim!: Sim;
  private version = -1;
  private fogKey = '';
  private terrainKey = '';
  private terrain!: Phaser.Textures.CanvasTexture;
  private fog!: Phaser.Textures.CanvasTexture;
  private terrainImg!: Img;
  private fogImg!: Img;
  private siteViews = new Map<number, SiteView>();
  private heroViews = new Map<number, UnitView>();
  private monsterViews = new Map<number, UnitView>();
  private trails = new Map<number, { x: number; y: number }[]>();
  private overlay!: Phaser.GameObjects.Graphics;
  private routeGfx!: Phaser.GameObjects.Graphics;
  private dragGfx!: Phaser.GameObjects.Graphics;
  private regionButtons: Phaser.GameObjects.Container[] = [];
  private eyes: Img[] = [];
  private routes: { cls: keyof typeof ROUTE_COLORS; pts: { x: number; y: number }[] }[] = [];
  private routeT = 0;
  private spikeUpUntil = new Map<number, number>();
  private mawChompUntil = 0;
  private mawDead = false;
  private floaters = 0;
  private emit: Record<string, Phaser.GameObjects.Particles.ParticleEmitter> = {};
  private panFrom: { x: number; y: number } | null = null;
  private dragFrom: { site: number; x: number; y: number; moved: boolean } | null = null;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;

  constructor(
    private keeper: Keeper,
    private bank: Bank,
  ) {
    super('world');
  }

  create(): void {
    for (const [name, canvas] of this.bank) this.textures.addCanvas(name, canvas);
    this.textures.addCanvas('font', buildFontSheet());
    this.textures.addCanvas('glow', this.makeGlow());
    this.cache.bitmapFont.add(
      'pix',
      Phaser.GameObjects.RetroFont.Parse(this, {
        image: 'font',
        width: FONT_CELL_W,
        height: FONT_CELL_H,
        chars: FONT_CHARS,
        charsPerRow: FONT_CHARS.length,
        'spacing.x': 0,
        'spacing.y': 0,
        'offset.x': 0,
        'offset.y': 0,
        lineSpacing: 1,
      }),
    );
    this.cameras.main.setBackgroundColor('#0b0710');
    this.overlay = this.add.graphics().setDepth(5000);
    this.routeGfx = this.add.graphics().setDepth(6000);
    this.dragGfx = this.add.graphics().setDepth(7000);
    this.makeEmitters();
    this.setupInput();
    this.rebuild();
    this.fitCamera();
    this.scale.on('resize', () => this.clampCamera());
  }

  private makeGlow(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,210,122,0.9)');
    g.addColorStop(0.4, 'rgba(255,170,90,0.35)');
    g.addColorStop(1, 'rgba(255,150,80,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    return c;
  }

  private makeEmitters(): void {
    const mk = (name: string, tex: string, cfg: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig) => {
      const e = this.add.particles(0, 0, tex, { emitting: false, ...cfg });
      e.setDepth(8000);
      this.emit[name] = e;
    };
    mk('spark', 'fx:spark', { lifespan: 280, speed: { min: 25, max: 70 }, scale: { start: 1, end: 0 }, gravityY: 140 });
    mk('star', 'fx:star', { lifespan: 380, speed: { min: 20, max: 50 }, scale: { start: 1, end: 0.2 }, gravityY: 60 });
    mk('dust', 'fx:dust', { lifespan: 600, speed: { min: 8, max: 35 }, angle: { min: 180, max: 360 }, alpha: { start: 0.9, end: 0 }, gravityY: 30 });
    mk('debris', 'fx:rock', { lifespan: 650, speed: { min: 40, max: 95 }, angle: { min: 200, max: 340 }, gravityY: 320, rotate: { min: 0, max: 360 } });
    mk('ember', 'fx:ember', { lifespan: 800, speedX: { min: -18, max: 18 }, speedY: { min: -55, max: -20 }, alpha: { start: 1, end: 0 } });
    mk('flame', 'fx:flame', { lifespan: 500, speedX: { min: -10, max: 10 }, speedY: { min: -40, max: -15 }, scale: { start: 1, end: 0.3 }, alpha: { start: 1, end: 0 } });
    mk('drip', 'fx:drip', { lifespan: 500, speedX: { min: -8, max: 8 }, speedY: { min: -10, max: 10 }, gravityY: 120 });
    mk('poison', 'fx:poison', { lifespan: 600, speedX: { min: -6, max: 6 }, speedY: { min: -25, max: -10 }, alpha: { start: 1, end: 0 } });
    mk('oil', 'fx:oil', { lifespan: 450, speed: { min: 30, max: 65 }, angle: { min: 200, max: 340 }, gravityY: 260 });
    mk('smoke', 'smoke:0', { lifespan: 650, speed: { min: 4, max: 16 }, scale: { start: 0.6, end: 1.5 }, alpha: { start: 0.8, end: 0 } });
    mk('heal', 'fx:plus', { lifespan: 750, speedX: { min: -6, max: 6 }, speedY: { min: -30, max: -14 }, alpha: { start: 1, end: 0 } });
    mk('mist', 'fx:mist', { lifespan: 2200, speedX: { min: -5, max: 5 }, speedY: { min: -6, max: -2 }, alpha: { start: 0.7, end: 0 }, scale: { start: 0.8, end: 1.6 } });
    mk('coins', 'fx:coin', { lifespan: 700, speed: { min: 40, max: 90 }, angle: { min: 220, max: 320 }, gravityY: 300 });
    mk('soul', 'fx:essence', { lifespan: 900, speedX: { min: -10, max: 10 }, speedY: { min: -30, max: -10 }, alpha: { start: 1, end: 0 } });
  }

  // ------------------------------------------------------------ the static world

  private rebuild(): void {
    this.sim = this.keeper.sim;
    for (const v of this.siteViews.values()) for (const o of v.objs) o.destroy();
    this.siteViews.clear();
    for (const v of this.heroViews.values()) v.c.destroy();
    for (const v of this.monsterViews.values()) v.c.destroy();
    this.heroViews.clear();
    this.monsterViews.clear();
    this.trails.clear();
    this.mawDead = false;
    const W = this.sim.cave.w * T;
    const H = this.sim.cave.h * T;
    for (const key of ['terrain', 'fog']) if (this.textures.exists(key)) this.textures.remove(key);
    this.terrainImg?.destroy();
    this.fogImg?.destroy();
    this.terrain = this.textures.createCanvas('terrain', W, H)!;
    this.fog = this.textures.createCanvas('fog', W, H)!;
    this.terrainImg = this.add.image(0, 0, 'terrain').setOrigin(0).setDepth(-10000);
    this.fogImg = this.add.image(0, 0, 'fog').setOrigin(0).setDepth(9000);
    this.version = -1;
    this.fogKey = '';
    this.terrainKey = '';
    this.syncWorld(false);
  }

  private fitCamera(): void {
    const cam = this.cameras.main;
    const cave = this.sim.cave;
    const zoom = cam.height >= 1300 ? 3 : 2;
    cam.setZoom(zoom);
    const route = cave.startRoute.map((s) => cave.sites[s]);
    const minY = Math.min(...route.map((s) => s.y));
    const maxY = Math.max(...route.map((s) => s.y));
    const midX = route.reduce((a, s) => a + s.x, 0) / route.length;
    this.clampCamera();
    cam.centerOn(wx(midX), wy(Math.min(minY + 14, (minY + maxY) / 2)));
  }

  private clampCamera(): void {
    const cam = this.cameras.main;
    const m = 200;
    cam.setBounds(-m, -m, this.sim.cave.w * T + 2 * m, this.sim.cave.h * T + 2 * m);
  }

  private look(site: number): RoomLook {
    const s = this.sim.site(site);
    if (s.kind === 'gate') return 'gate';
    if (s.kind === 'maw') return 'maw';
    return this.sim.rooms.get(site)?.id ?? 'empty';
  }

  /** Redraw terrain, props and fog when the dungeon changes. */
  private syncWorld(fx: boolean): void {
    const sim = this.sim;
    if (sim.version === this.version) return;
    const firstTime = this.version < 0;
    this.version = sim.version;
    const terrainKey = `${[...sim.dug].sort((x, y) => x - y).join(',')}|${[...sim.rooms.values()].map((r) => `${r.site}:${r.id}`).sort().join(',')}|${[...sim.excavated].sort().join(',')}`;
    if (terrainKey !== this.terrainKey) {
      this.terrainKey = terrainKey;
      this.drawTerrain();
    }
    const fogKey = [...sim.excavated].sort().join(',');
    if (fogKey !== this.fogKey) {
      this.fogKey = fogKey;
      this.drawFog();
    }
    for (const s of sim.cave.sites) {
      const visible = s.kind !== 'site' || sim.isExcavated(s.id);
      const room = sim.rooms.get(s.id);
      const key = visible ? `${this.look(s.id)}|${room?.ranks.join('') ?? ''}` : 'hidden';
      const old = this.siteViews.get(s.id);
      if (old?.key === key) continue;
      const wasLook = old?.key.split('|')[0];
      if (old) for (const o of old.objs) o.destroy();
      const view = this.makeSiteView(s.id, key, visible);
      this.siteViews.set(s.id, view);
      if (fx && !firstTime && visible) {
        const cx = wx(s.x);
        const cy = wy(s.y);
        if (wasLook !== this.look(s.id)) {
          this.emit.dust.explode(24, cx, cy);
          this.emit.smoke.explode(6, cx, cy);
          for (const o of view.objs) {
            if (!(o instanceof Phaser.GameObjects.Image) || o.texture.key === 'glow') continue;
            const sy = o.scaleY;
            const sx = o.scaleX;
            o.setScale(sx * 0.2, sy * 0.2);
            this.tweens.add({ targets: o, scaleX: sx, scaleY: sy, duration: 280, ease: 'Back.easeOut' });
          }
        } else {
          this.emit.star.explode(10, cx, cy - 8);
        }
      }
    }
    this.rebuildRegionButtons();
  }

  private drawTerrain(): void {
    const sim = this.sim;
    const cave = sim.cave;
    const W = cave.w;
    const H = cave.h;
    const floor = new Array<FloorStyle | null>(W * H).fill(null);
    // Corridors first, rooms on top.
    for (const eid of sim.dug) {
      const e = cave.edges[eid];
      const a = cave.sites[e.a];
      const b = cave.sites[e.b];
      const minX = Math.floor(Math.min(a.x, b.x)) - 2;
      const maxX = Math.ceil(Math.max(a.x, b.x)) + 2;
      const minY = Math.floor(Math.min(a.y, b.y)) - 2;
      const maxY = Math.ceil(Math.max(a.y, b.y)) + 2;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      for (let y = minY; y <= maxY; y++)
        for (let x = minX; x <= maxX; x++) {
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2));
          const d = Math.hypot(a.x + dx * t - x, a.y + dy * t - y);
          if (d <= 0.85) floor[y * W + x] = 'dirt';
        }
    }
    for (const s of cave.sites) {
      if (s.kind === 'site' && !sim.isExcavated(s.id)) continue;
      const style = ROOM_LOOK[this.look(s.id)].floor;
      const hw = (s.w - 1) / 2;
      const hh = (s.h - 1) / 2;
      const empty = s.kind === 'site' && !sim.rooms.has(s.id);
      for (let y = s.y - hh; y <= s.y + hh; y++)
        for (let x = s.x - hw; x <= s.x + hw; x++) {
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          // Empty sites are rough caverns: trim their corners.
          if (empty && Math.abs(x - s.x) === hw && Math.abs(y - s.y) === hh) continue;
          floor[y * W + x] = style;
        }
    }

    const buf = new PixBuf(W * T, H * T);
    const isFloor = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && floor[y * W + x] !== null;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const f = floor[y * W + x];
        const ox = x * T;
        const oy = y * T;
        if (f) {
          paintFloor(buf, ox, oy, f, 3);
          if (!isFloor(x, y - 1)) for (let k = 0; k < 4; k++) for (let i = 0; i < T; i++) buf.set(ox + i, oy + k, '#000000', 0.45 - k * 0.1);
          if (!isFloor(x - 1, y)) for (let i = 0; i < T; i++) buf.set(ox, oy + i, '#000000', 0.35);
          if (!isFloor(x + 1, y)) for (let i = 0; i < T; i++) buf.set(ox + T - 1, oy + i, '#000000', 0.35);
        } else if (isFloor(x, y + 1)) {
          paintWall(buf, ox, oy, x * 31 + y);
        } else {
          paintRock(buf, ox, oy, 5);
          if (isFloor(x, y - 1)) for (let i = 0; i < T; i++) buf.set(ox + i, oy, '#4a3d55');
        }
      }
    const ctx = this.terrain.getContext();
    ctx.putImageData(buf.toImageData(), 0, 0);
    this.terrain.refresh();
  }

  private drawFog(): void {
    const sim = this.sim;
    const cave = sim.cave;
    const W = cave.w;
    const H = cave.h;
    const dark = new Uint8Array(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let best = Infinity;
        let region = 0;
        for (const s of cave.sites) {
          const d = (s.x - x) ** 2 + (s.y - y) ** 2;
          if (d < best) {
            best = d;
            region = s.region;
          }
        }
        dark[y * W + x] = sim.excavated.has(region) ? 0 : 1;
      }
    const buf = new PixBuf(W * T, H * T);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        if (!dark[y * W + x]) continue;
        const edge = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ].some(([dx, dy]) => {
          const nx = x + dx;
          const ny = y + dy;
          return nx >= 0 && ny >= 0 && nx < W && ny < H && !dark[ny * W + nx];
        });
        for (let py = 0; py < T; py++)
          for (let px = 0; px < T; px++) {
            if (edge && (px + py + x + y) % 2 === 0) continue;
            buf.set(x * T + px, y * T + py, '#0b0710', edge ? 0.75 : 0.93);
          }
      }
    const ctx = this.fog.getContext();
    ctx.clearRect(0, 0, W * T, H * T);
    ctx.putImageData(buf.toImageData(), 0, 0);
    this.fog.refresh();
  }

  private makeSiteView(site: number, key: string, visible: boolean): SiteView {
    const view: SiteView = { key, objs: [], anims: [], spikes: [], vents: [] };
    if (!visible) return view;
    const sim = this.sim;
    const s = sim.site(site);
    const cx = wx(s.x);
    const cy = wy(s.y);
    const look = this.look(site);
    for (const pr of ROOM_LOOK[look].props) {
      const tex = pr.frames ? `${pr.tex}:0` : pr.tex;
      const x = cx + pr.x * T;
      const y = cy + pr.y * T;
      const img = this.add.image(x, y, tex);
      if (pr.flat) img.setOrigin(0.5).setDepth(-5000 + y);
      else img.setOrigin(0.5, 1).setDepth(y + 4).setY(y + 4);
      if (pr.flip) img.setFlipX(true);
      if (pr.scale) img.setScale(pr.scale);
      view.objs.push(img);
      if (pr.frames) view.anims.push({ img, tex: pr.tex, frames: pr.frames });
      if (pr.tex === 'td:spikes') view.spikes.push(img);
      if (pr.tex === 'td:vent') view.vents.push({ x, y });
    }
    if (look === 'maw') {
      const glow = this.add.image(cx, cy, 'glow').setBlendMode(Phaser.BlendModes.ADD).setScale(3, 2).setAlpha(0.22).setTint(0xff6080).setDepth(-4000);
      const maw = this.add.image(cx, cy + 6, 'maw:0').setOrigin(0.5, 26 / 40).setScale(2).setDepth(cy + 30);
      maw.setName('maw');
      glow.setName('mawGlow');
      view.objs.push(glow, maw);
    }
    if (look === 'gate') {
      const glow = this.add.image(cx, cy - T * 1.8, 'glow').setBlendMode(Phaser.BlendModes.ADD).setScale(1.8, 1.4).setAlpha(0.3).setDepth(-4000);
      view.objs.push(glow);
    }
    if (look === 'soulWell') view.objs.push(this.add.image(cx, cy + 2, 'glow').setBlendMode(Phaser.BlendModes.ADD).setScale(1.6).setTint(0x5fe6d2).setAlpha(0.35).setDepth(-4000));
    if (look === 'flameGallery') view.objs.push(this.add.image(cx, cy, 'glow').setBlendMode(Phaser.BlendModes.ADD).setScale(2.2, 1).setTint(0xff6a3c).setAlpha(0.12).setDepth(-4000));
    // Wall torches on the top wall of built rooms
    if (look !== 'empty' && look !== 'gate') {
      for (const dx of [-2.5, 2.5]) {
        const tx = cx + dx * T;
        const ty = cy - ((s.h + 1) / 2) * T + 8;
        const torch = this.add.image(tx, ty, 'td:torch:0').setDepth(-3000);
        view.objs.push(torch, this.add.image(tx, ty, 'glow').setBlendMode(Phaser.BlendModes.ADD).setScale(0.7).setAlpha(0.25).setDepth(-3001));
        view.anims.push({ img: torch, tex: 'td:torch', frames: 2 });
      }
    }
    // Label under the room
    const room = sim.rooms.get(site);
    let label = '';
    let tint = COLOR.grey;
    if (room) {
      const ranks = room.ranks[0] + room.ranks[1] + room.ranks[2];
      label = `${ROOMS[room.id].name}${ranks ? ` +${ranks}` : ''}`;
      tint = KIND_TINT[ROOMS[room.id].kind];
    } else if (look === 'maw') label = 'THE MAW';
    else if (look === 'gate') label = 'GATE';
    if (label) {
      const t = this.add
        .bitmapText(cx, cy + (s.h / 2) * T + 3, 'pix', label.toUpperCase())
        .setOrigin(0.5, 0)
        .setTint(tint)
        .setLetterSpacing(-1)
        .setDepth(4000);
      view.objs.push(t);
    }
    return view;
  }

  private rebuildRegionButtons(): void {
    for (const b of this.regionButtons) b.destroy();
    this.regionButtons = [];
    const sim = this.sim;
    if (this.keeper.mode !== 'play') return;
    for (const region of sim.excavatable()) {
      const sites = sim.cave.sites.filter((s) => s.region === region);
      if (!sites.length) continue;
      const x = wx(sites.reduce((a, s) => a + s.x, 0) / sites.length);
      const y = wy(sites.reduce((a, s) => a + s.y, 0) / sites.length);
      const c = this.add.container(x, y).setDepth(9500);
      const bg = this.add.graphics();
      bg.fillStyle(0x1d1425, 0.95).fillRect(-34, -11, 68, 22);
      bg.lineStyle(2, 0x5fe6d2, 1).strokeRect(-34, -11, 68, 22);
      const t1 = this.add.bitmapText(0, -7, 'pix', 'EXCAVATE').setOrigin(0.5, 0).setTint(0xf3e9d8).setLetterSpacing(-1);
      const icon = this.add.image(-8, 6, 'icon:essence').setScale(0.75);
      const t2 = this.add.bitmapText(-2, 2, 'pix', String(sim.excavateCost())).setOrigin(0, 0).setTint(COLOR.cyan).setLetterSpacing(-1);
      t2.setName('cost');
      c.add([bg, t1, icon, t2]);
      c.setSize(68, 22);
      c.setInteractive({ useHandCursor: true });
      c.on('pointerover', () => c.setScale(1.08));
      c.on('pointerout', () => c.setScale(1));
      c.on('pointerdown', (p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
        if (p.rightButtonDown()) return;
        ev.stopPropagation();
        this.keeper.excavate(region);
      });
      c.setData('region', region);
      this.regionButtons.push(c);
    }
  }

  // ------------------------------------------------------------ units

  private makeUnit(base: string, hero: boolean, champion: boolean): UnitView {
    const c = this.add.container(0, 0);
    const shadow = this.add.image(0, 1, 'shadow');
    const body = this.add.image(0, 2, `${base}:0`).setOrigin(0.5, 1);
    const bar = this.add.graphics();
    const status = this.add.image(0, -20, 'fx:drip').setVisible(false);
    c.add([shadow, body, bar, status]);
    let crown: Img | null = null;
    const scale = champion ? 1.3 : 1;
    body.setScale(scale);
    shadow.setScale(base === 'troll' ? 1.8 : scale);
    if (champion) {
      crown = this.add.image(0, -21, 'crown');
      c.add(crown);
    }
    return { c, body, bar, status, crown, base, x: 0, y: 0, lastAttack: -1, lastHit: -1, animT: 0, frame: 0, hpShown: -1, hero, scale };
  }

  /** Where each party member should stand this frame (world px). */
  private memberTargets(): Map<number, { x: number; y: number; moving: boolean; dir: number; party: Party }> {
    const out = new Map<number, { x: number; y: number; moving: boolean; dir: number; party: Party }>();
    const a = this.keeper.alpha;
    for (const p of this.sim.parties) {
      const ax = wx(p.px + (p.x - p.px) * a);
      const ay = wy(p.py + (p.y - p.py) * a);
      let trail = this.trails.get(p.id);
      if (!trail) this.trails.set(p.id, (trail = [{ x: ax, y: ay }]));
      const last = trail[0];
      if (Math.hypot(last.x - ax, last.y - ay) > 2) {
        trail.unshift({ x: ax, y: ay });
        if (trail.length > 60) trail.pop();
      }
      const moving = p.state === 'move';
      const dir = trail.length > 1 ? Math.sign(trail[0].x - trail[1].x) || 1 : 1;
      p.members.forEach((h, k) => {
        if (!moving) {
          const [fx, fy] = FORMATION[k % FORMATION.length];
          out.set(h.id, { x: ax + fx, y: ay + fy, moving, dir, party: p });
          return;
        }
        // Follow the leader's footsteps.
        let need = k * 12;
        let pt = trail![0];
        for (let i = 1; i < trail!.length && need > 0; i++) {
          const seg = Math.hypot(trail![i].x - trail![i - 1].x, trail![i].y - trail![i - 1].y);
          if (seg >= need) {
            const t = need / seg;
            pt = { x: trail![i - 1].x + (trail![i].x - trail![i - 1].x) * t, y: trail![i - 1].y + (trail![i].y - trail![i - 1].y) * t };
            need = 0;
          } else {
            need -= seg;
            pt = trail![i];
          }
        }
        out.set(h.id, { x: pt.x, y: pt.y, moving, dir, party: p });
      });
    }
    for (const id of [...this.trails.keys()]) if (!this.sim.parties.some((p) => p.id === id)) this.trails.delete(id);
    return out;
  }

  private syncUnits(delta: number): void {
    const sim = this.sim;
    const targets = this.memberTargets();
    const k = Math.min(1, (delta / 1000) * 12);

    const seen = new Set<number>();
    for (const p of sim.parties) {
      for (const h of p.members) {
        seen.add(h.id);
        const t = targets.get(h.id)!;
        let v = this.heroViews.get(h.id);
        if (!v) {
          v = this.makeUnit(h.cls, true, !!h.champion);
          v.x = t.x;
          v.y = t.y;
          this.heroViews.set(h.id, v);
          v.c.setAlpha(0);
          this.tweens.add({ targets: v.c, alpha: 1, duration: 300 });
        }
        const dx = t.x - v.x;
        v.x += dx * k;
        v.y += (t.y - v.y) * k;
        let facing = t.dir;
        if (!t.moving && p.state === 'fight') {
          const foe = sim.standing(p.to)[0];
          const fv = foe ? this.monsterViews.get(foe.id) : undefined;
          if (fv) facing = fv.x >= v.x ? 1 : -1;
        }
        this.updateUnit(v, h, t.moving && Math.abs(dx) + Math.abs(t.y - v.y) > 0.3, facing, delta);
      }
    }
    for (const [id, v] of this.heroViews) {
      if (seen.has(id)) continue;
      v.c.destroy();
      this.heroViews.delete(id);
    }

    // Monsters stand at their spots, and step up to the hero they are hitting.
    const seenM = new Set<number>();
    const heroPos = (id: number | null) => (id !== null ? this.heroViews.get(id) : undefined);
    for (const m of sim.monsters) {
      seenM.add(m.id);
      const s = sim.site(m.site);
      let v = this.monsterViews.get(m.id);
      const spot = this.monsterSpot(m);
      const sx = wx(s.x) + spot[0] * T;
      const sy = wy(s.y) + spot[1] * T;
      if (!v) {
        v = this.makeUnit(m.kind, false, false);
        v.x = sx;
        v.y = sy;
        this.monsterViews.set(m.id, v);
        if (m.kind !== 'mimic') {
          v.c.setScale(0.2);
          this.tweens.add({ targets: v.c, scale: 1, duration: 260, ease: 'Back.easeOut' });
        }
      }
      let tx = sx;
      let ty = sy;
      const target = heroPos(m.targetId);
      const engaged = target && m.kind !== 'mimic' && m.kind !== 'troll' && sim.time - m.lastAttackAt < 2;
      if (engaged && target) {
        const side = v.x <= target.x ? -1 : 1;
        tx = target.x + side * 11;
        ty = target.y + ((m.slot % 3) - 1) * 5;
      }
      const dx = tx - v.x;
      v.x += dx * k * 0.7;
      v.y += (ty - v.y) * k * 0.7;
      const facing = target ? (target.x >= v.x ? 1 : -1) : spot[0] > 0 ? -1 : 1;
      this.updateUnit(v, m, Math.abs(dx) > 0.4, facing, delta);
      v.c.setAlpha(m.down > 0 ? 0.35 : 1);
    }
    for (const [id, v] of this.monsterViews) {
      if (seenM.has(id)) continue;
      v.c.destroy();
      this.monsterViews.delete(id);
    }
  }

  private monsterSpot(m: Monster): [number, number] {
    if (m.kind === 'mimic') return [0, -0.1];
    if (m.kind === 'troll') return [0, 0.6];
    return MONSTER_SPOTS[m.slot % MONSTER_SPOTS.length];
  }

  private updateUnit(v: UnitView, u: Hero | Monster, moving: boolean, facing: number, delta: number): void {
    v.c.setPosition(Math.round(v.x), Math.round(v.y));
    v.c.setDepth(v.y);
    v.body.setFlipX(facing < 0);
    v.animT += delta;
    if (v.base === 'mimic') {
      const open = (u as Monster).targetId !== null || this.sim.time - u.lastAttackAt < 0.5;
      v.body.setTexture(open ? 'mimic:1' : 'mimic:0');
    } else if (v.base === 'slime' || v.base === 'spider') {
      if (v.animT > (v.base === 'spider' ? 160 : 380)) {
        v.animT = 0;
        v.frame ^= 1;
        v.body.setTexture(`${v.base}:${v.frame}`);
      }
    } else if (moving) {
      if (v.animT > 150) {
        v.animT = 0;
        v.frame ^= 1;
        v.body.setTexture(`${v.base}:${v.frame}`);
      }
      v.body.y = 2 - (v.frame ? 1 : 0);
    } else {
      v.body.y = 2 + Math.round(Math.sin(this.time.now / 300 + u.id) * 0.5);
    }
    if (u.lastAttackAt !== v.lastAttack) {
      if (v.lastAttack >= 0 && this.sim.time - u.lastAttackAt < 0.3) this.tweens.add({ targets: v.body, x: facing * 3, duration: 60, yoyo: true, ease: 'Quad.easeOut' });
      v.lastAttack = u.lastAttackAt;
    }
    if (u.lastHitAt !== v.lastHit) {
      if (v.lastHit >= 0 && this.sim.time - u.lastHitAt < 0.3) {
        v.body.setTintFill(0xffffff);
        const s = v.scale;
        v.body.setScale(s * 1.15, s * 0.82);
        this.time.delayedCall(70, () => {
          if (!v.body.active) return;
          v.body.clearTint();
          this.tweens.add({ targets: v.body, scaleX: s, scaleY: s, duration: 120, ease: 'Back.easeOut' });
        });
      }
      v.lastHit = u.lastHitAt;
    }
    const frac = Math.max(0, u.hp / u.maxHp);
    if (Math.abs(frac - v.hpShown) > 0.005) {
      v.hpShown = frac;
      v.bar.clear();
      if (frac < 0.999) {
        const top = -(v.body.height * v.scale) - 3;
        v.bar.fillStyle(0x1b1020, 1).fillRect(-7, top, 14, 3);
        v.bar.fillStyle(v.hero ? 0xe0463c : 0x7ee06a, 1).fillRect(-6, top + 1, Math.max(1, Math.round(12 * frac)), 1);
      }
    }
    if (v.hero) {
      const h = u as Hero;
      let icon = '';
      if (h.burning > 0) icon = 'fx:flame';
      else if (h.poison > 0) icon = 'fx:poison';
      else if (h.oily > 0) icon = 'fx:oil';
      else if (h.sticky > 0) icon = 'fx:drip';
      if (icon) {
        v.status.setTexture(icon).setVisible(true);
        v.status.y = -(v.body.height * v.scale) - 8 + Math.round(Math.sin(this.time.now / 120));
      } else v.status.setVisible(false);
      if (h.burning > 0 && Math.random() < 0.25) this.emit.ember.explode(1, v.x, v.y - 8);
      if (h.sticky > 0 && Math.random() < 0.05) this.emit.drip.explode(1, v.x, v.y - 6);
    }
  }

  // ------------------------------------------------------------ events -> effects

  private float(x: number, y: number, text: string, color: number, big = false): void {
    if (this.floaters > 70) return;
    this.floaters++;
    const t = this.add
      .bitmapText(x + Phaser.Math.Between(-4, 4), y, 'pix', text.toUpperCase())
      .setOrigin(0.5, 1)
      .setTint(color)
      .setLetterSpacing(-1)
      .setDepth(9800);
    if (big) t.setScale(2);
    this.tweens.add({
      targets: t,
      y: y - (big ? 26 : 14),
      alpha: { from: 1, to: 0 },
      duration: big ? 1600 : 850,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        t.destroy();
        this.floaters--;
      },
    });
  }

  private heroXY(id: number, fallback?: { x: number; y: number }): { x: number; y: number } {
    const v = this.heroViews.get(id);
    if (v) return { x: v.x, y: v.y };
    return fallback ?? { x: 0, y: 0 };
  }

  private siteXY(site: number): { x: number; y: number } {
    const s = this.sim.site(site);
    return { x: wx(s.x), y: wy(s.y) };
  }

  private mawXY(): { x: number; y: number } {
    return this.siteXY(this.sim.cave.maw);
  }

  private handle(e: SimEvent): void {
    switch (e.t) {
      case 'damage': {
        const p = e.on === 'hero' ? this.heroXY(e.id, { x: wx(e.x), y: wy(e.y) }) : (() => {
          const v = this.monsterViews.get(e.id);
          return v ? { x: v.x, y: v.y } : this.siteXY(e.site);
        })();
        const color = e.dot ? COLOR.orange : e.on === 'monster' ? COLOR.grey : e.crit ? COLOR.yellow : COLOR.white;
        this.float(p.x, p.y - 18, `${Math.round(e.amount)}${e.crit ? '!' : ''}`, color);
        if (!e.dot) this.emit.spark.explode(e.crit ? 7 : 3, p.x, p.y - 8);
        if (e.crit) this.emit.star.explode(4, p.x, p.y - 10);
        break;
      }
      case 'heroDied': {
        const p = this.heroXY(e.id, { x: wx(e.x), y: wy(e.y) });
        this.eatEffect(p.x, p.y, e.gold, e.essence, !!e.champion);
        if (e.infamy >= 1) this.time.delayedCall(250, () => this.float(p.x, p.y - 30, `+${Math.round(e.infamy)} INFAMY`, COLOR.purple));
        break;
      }
      case 'monsterDied': {
        const v = this.monsterViews.get(e.id);
        const p = v ? { x: v.x, y: v.y } : this.siteXY(e.site);
        this.emit.smoke.explode(5, p.x, p.y - 6);
        if (e.kind === 'slime') this.emit.drip.explode(10, p.x, p.y - 4);
        else this.emit.dust.explode(6, p.x, p.y);
        break;
      }
      case 'monsterDown': {
        const v = this.monsterViews.get(e.id);
        if (v) {
          this.emit.debris.explode(6, v.x, v.y - 6);
          this.float(v.x, v.y - 14, 'CLATTER', COLOR.grey);
        }
        break;
      }
      case 'monsterUp': {
        const v = this.monsterViews.get(e.id);
        if (v) {
          this.emit.dust.explode(6, v.x, v.y);
          this.float(v.x, v.y - 14, 'RISES!', COLOR.white);
        }
        break;
      }
      case 'trap': {
        const view = this.siteViews.get(e.site);
        const c = this.siteXY(e.site);
        if (e.room === 'spikeHall') {
          this.spikeUpUntil.set(e.site, this.time.now + 400);
          const p = e.heroId !== undefined ? this.heroXY(e.heroId, c) : c;
          this.emit.spark.explode(6, p.x, p.y - 4);
          this.cameras.main.shake(50, 0.0015);
        } else if (e.room === 'flameGallery') {
          for (const vent of view?.vents ?? []) {
            const fire = this.add.image(vent.x, vent.y + 3, 'fire:0').setOrigin(0.5, 1).setDepth(vent.y + 20);
            let f = 0;
            const timer = this.time.addEvent({
              delay: 90,
              repeat: 5,
              callback: () => {
                f++;
                if (f >= 5) {
                  fire.destroy();
                  timer.remove();
                } else fire.setTexture(`fire:${[1, 2, 1, 3][f - 1]}`);
              },
            });
            this.emit.ember.explode(8, vent.x, vent.y - 10);
          }
          this.cameras.main.shake(90, 0.003);
        } else if (e.room === 'oilCellar') {
          this.emit.oil.explode(16, c.x, c.y);
        } else if (e.room === 'pitDrop') {
          this.emit.debris.explode(8, c.x, c.y);
        }
        break;
      }
      case 'fall': {
        const v = this.heroViews.get(e.heroId);
        if (v) {
          this.float(v.x, v.y - 20, e.eaten ? 'GULP!' : 'FELL IN!', e.eaten ? COLOR.green : COLOR.orange, e.eaten);
          this.tweens.add({ targets: v.body, scaleX: 0.2, scaleY: 0.2, y: 10, duration: 300, yoyo: !e.eaten, ease: 'Quad.easeIn' });
        }
        break;
      }
      case 'ignite': {
        const p = this.heroXY(e.heroId);
        this.emit.flame.explode(12, p.x, p.y - 8);
        this.float(p.x, p.y - 26, 'IGNITED!', COLOR.orange);
        break;
      }
      case 'status': {
        const p = this.heroXY(e.heroId);
        const label = { sticky: ['STICKY', COLOR.green], oily: ['OILY', COLOR.grey], cursed: ['CURSED', COLOR.purple], poison: ['POISONED', COLOR.purple] }[e.status] as [string, number];
        this.float(p.x, p.y - 26, label[0], label[1]);
        if (e.status === 'sticky') this.emit.drip.explode(6, p.x, p.y - 8);
        if (e.status === 'poison') this.emit.poison.explode(4, p.x, p.y - 8);
        break;
      }
      case 'disarm': {
        const c = this.siteXY(e.site);
        this.float(c.x, c.y - 20, 'DISARMED', COLOR.red, true);
        break;
      }
      case 'spotted': {
        const c = this.siteXY(e.site);
        this.float(c.x, c.y - 16, 'SPOTTED', COLOR.yellow);
        break;
      }
      case 'loot': {
        const p = this.heroXY(e.heroId, this.siteXY(e.site));
        this.float(p.x, p.y - 24, `-${Math.round(e.amount)} GOLD`, COLOR.red);
        this.emit.coins.explode(8, p.x, p.y - 6);
        break;
      }
      case 'bite': {
        const m = this.mawXY();
        this.float(m.x, m.y - 30, `-${Math.round(e.amount)}`, COLOR.red);
        this.cameras.main.shake(110, 0.004);
        this.emit.spark.explode(5, m.x, m.y - 6);
        break;
      }
      case 'chomp': {
        this.mawChompUntil = this.time.now + 220;
        const m = this.mawXY();
        this.emit.drip.explode(4, m.x, m.y + 6);
        this.cameras.main.shake(70, 0.002);
        break;
      }
      case 'escaped': {
        const g = this.siteXY(this.sim.cave.gate);
        this.float(g.x, g.y - 30, e.loot >= 1 ? `ESCAPED -${Math.round(e.loot)}G` : 'ESCAPED', COLOR.red);
        break;
      }
      case 'party': {
        const g = this.siteXY(this.sim.cave.gate);
        if (e.champion) {
          this.float(g.x, g.y - 44, e.champion, COLOR.purple, true);
          this.cameras.main.shake(400, 0.006);
          this.cameras.main.flash(180, 120, 60, 160);
        }
        break;
      }
      case 'heal': {
        const p = this.heroXY(e.heroId);
        this.emit.heal.explode(3, p.x, p.y - 10);
        this.float(p.x, p.y - 22, `+${Math.round(e.amount)}`, COLOR.green);
        break;
      }
      case 'respawn': {
        const c = this.siteXY(e.site);
        this.emit.smoke.explode(3, c.x, c.y);
        break;
      }
      case 'wipe': {
        const m = this.mawXY();
        this.float(m.x, m.y - 56, 'PARTY WIPED!', COLOR.gold, true);
        break;
      }
      case 'ambush': {
        const c = this.siteXY(e.site);
        this.float(c.x, c.y - 24, 'AMBUSH!', COLOR.yellow, true);
        this.cameras.main.shake(120, 0.004);
        break;
      }
      case 'split': {
        const p = this.heroXY(e.heroId);
        this.float(p.x, p.y - 24, e.reason === 'loot' ? 'SNEAKS OFF' : 'FLEES!', e.reason === 'loot' ? COLOR.yellow : COLOR.white);
        break;
      }
      case 'excavated': {
        const sites = this.sim.cave.sites.filter((s) => s.region === e.region);
        for (const s of sites) {
          this.emit.debris.explode(14, wx(s.x), wy(s.y));
          this.emit.dust.explode(20, wx(s.x), wy(s.y));
        }
        this.cameras.main.shake(300, 0.005);
        break;
      }
      case 'collapse':
        this.collapseEffect();
        break;
      case 'unlock':
        break;
    }
  }

  /** Coins and Essence arc into the Maw, which chomps them down. */
  private eatEffect(x: number, y: number, gold: number, essence: number, champion: boolean): void {
    const to = this.mawXY();
    to.y += 4;
    this.keeper.hitStop(champion ? 220 : 45);
    if (champion) {
      this.cameras.main.shake(500, 0.008);
      this.cameras.main.flash(250, 255, 220, 120);
    }
    this.emit.smoke.explode(6, x, y - 6);
    this.emit.star.explode(5, x, y - 10);
    this.emit.soul.explode(6, x, y - 8);
    this.float(x, y - 20, `+${Math.round(gold)} GOLD`, COLOR.gold, champion);
    this.time.delayedCall(180, () => this.float(x + 10, y - 12, `+${essence.toFixed(essence < 10 ? 1 : 0)} ESSENCE`, COLOR.cyan));
    const count = Math.min(champion ? 18 : 9, 3 + Math.floor(gold / 6));
    for (let k = 0; k < count; k++) {
      const tex = k < 2 ? 'fx:bone' : k < 4 ? 'fx:essence' : 'fx:coin';
      const img = this.add.image(x, y - 8, tex).setDepth(8500);
      const peak = Math.min(y, to.y) - 30 - Math.random() * 40;
      const midX = (x + to.x) / 2 + (Math.random() - 0.5) * 60;
      const st = { t: 0 };
      this.tweens.add({
        targets: st,
        t: 1,
        delay: 120 + k * 45,
        duration: 700 + Math.random() * 300 + Math.min(600, Math.hypot(to.x - x, to.y - y)),
        ease: 'Sine.easeIn',
        onUpdate: () => {
          const t = st.t;
          const u = 1 - t;
          img.x = u * u * x + 2 * u * t * midX + t * t * to.x;
          img.y = u * u * (y - 8) + 2 * u * t * peak + t * t * to.y;
          if (tex === 'fx:bone') img.rotation += 0.25;
        },
        onComplete: () => {
          img.destroy();
          this.mawChompUntil = this.time.now + 140;
          this.keeper.audio.play(tex === 'fx:coin' ? 'coin' : 'chomp', { vol: 0.45, gap: 0.07 });
        },
      });
    }
  }

  private collapseEffect(): void {
    this.mawDead = true;
    const cam = this.cameras.main;
    cam.shake(2200, 0.012);
    cam.flash(400, 255, 80, 80);
    const maw = this.mawSprite();
    if (maw) {
      maw.setTexture('maw:hurt');
      this.tweens.add({ targets: maw, scaleX: 1.2, scaleY: 0.6, alpha: 0.4, angle: 8, duration: 2200, ease: 'Quad.easeIn' });
    }
    const sites = this.sim.cave.sites;
    for (let k = 0; k < 40; k++) {
      this.time.delayedCall(k * 55, () => {
        const s = sites[Math.floor(Math.random() * sites.length)];
        this.emit.debris.explode(6, wx(s.x), wy(s.y));
        this.emit.dust.explode(8, wx(s.x), wy(s.y));
      });
    }
  }

  private mawSprite(): Img | undefined {
    return this.siteViews.get(this.sim.cave.maw)?.objs.find((o) => o.name === 'maw') as Img | undefined;
  }

  // ------------------------------------------------------------ frame

  update(_time: number, delta: number): void {
    this.keeper.update(delta);
    if (this.keeper.sim !== this.sim) {
      this.rebuild();
      this.fitCamera();
    }
    for (const e of this.keeper.frameEvents.splice(0)) this.handle(e);
    this.syncWorld(true);
    this.animateProps();
    this.syncUnits(delta);
    this.syncMaw();
    this.panWithKeys(delta);
    this.drawOverlay();
    this.updateRoutes(delta);
    this.updateRegionButtons();
  }

  private animateProps(): void {
    const now = this.time.now;
    for (const [site, v] of this.siteViews) {
      for (const a of v.anims) {
        if (a.tex === 'td:spikes') continue;
        const period = a.tex === 'td:torch' || a.tex === 'td:candle' || a.tex === 'td:campfire' ? 160 : a.tex === 'entrance' ? 200 : 520;
        a.img.setTexture(`${a.tex}:${Math.floor((now + site * 97) / period) % a.frames}`);
      }
      const up = (this.spikeUpUntil.get(site) ?? 0) > now;
      for (const sp of v.spikes) sp.setTexture(up ? 'td:spikes:1' : 'td:spikes:0');
    }
    // Gloom mist drifting
    if (Math.random() < 0.15) {
      for (const r of this.sim.rooms.values()) {
        if (r.id !== 'gloomHall' || Math.random() > 0.5) continue;
        const c = this.siteXY(r.site);
        this.emit.mist.explode(1, c.x + Phaser.Math.Between(-40, 40), c.y + Phaser.Math.Between(-20, 20));
      }
    }
  }

  private syncMaw(): void {
    if (this.mawDead) return;
    const maw = this.mawSprite();
    if (!maw) return;
    const sim = this.sim;
    const now = this.time.now;
    const m = sim.site(sim.cave.maw);
    let tex = 'maw:0';
    if (now < this.mawChompUntil) tex = 'maw:2';
    else if (sim.time - sim.mawLastHitAt < 0.15) tex = 'maw:hurt';
    else if (sim.parties.some((p) => Math.hypot(p.x - m.x, p.y - m.y) < 8)) tex = Math.floor(now / 250) % 2 ? 'maw:1' : 'maw:2';
    maw.setTexture(tex);
    const breathe = Math.sin(now / 700) * 0.035;
    maw.setScale(2 * (1 - breathe * 0.5), 2 * (1 + breathe));
    const low = sim.mawHp < sim.mawMaxHp * 0.35;
    if (low && Math.floor(now / 300) % 2) maw.setTint(0xff9090);
    else maw.clearTint();
  }

  // ------------------------------------------------------------ input

  private setupInput(): void {
    this.input.mouse?.disableContextMenu();
    this.keys = this.input.keyboard!.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT', false) as Record<string, Phaser.Input.Keyboard.Key>;

    this.input.on('wheel', (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      const cam = this.cameras.main;
      const z = Phaser.Math.Clamp(cam.zoom + (dy > 0 ? -1 : 1), 1, 4);
      if (z === cam.zoom) return;
      const before = cam.getWorldPoint(p.x, p.y);
      cam.setZoom(z);
      cam.preRender();
      const after = cam.getWorldPoint(p.x, p.y);
      cam.scrollX += before.x - after.x;
      cam.scrollY += before.y - after.y;
    });

    this.input.on('pointerdown', (p: Phaser.Input.Pointer, over: unknown[]) => {
      this.keeper.audio.unlock();
      if (p.rightButtonDown() || p.middleButtonDown()) {
        this.panFrom = { x: p.x, y: p.y };
        return;
      }
      if (this.keeper.mode !== 'play' || over.length) return;
      const w = this.worldPoint(p);
      const site = this.siteAt(w.x, w.y);
      if (site >= 0) this.dragFrom = { site, x: p.x, y: p.y, moved: false };
      else this.dragFrom = null;
    });

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (this.panFrom) {
        const cam = this.cameras.main;
        cam.scrollX -= (p.x - this.panFrom.x) / cam.zoom;
        cam.scrollY -= (p.y - this.panFrom.y) / cam.zoom;
        this.panFrom = { x: p.x, y: p.y };
        return;
      }
      if (this.dragFrom && Math.hypot(p.x - this.dragFrom.x, p.y - this.dragFrom.y) > 8) this.dragFrom.moved = true;
    });

    this.input.on('pointerup', (p: Phaser.Input.Pointer, over: unknown[]) => {
      const wasPanning = !!this.panFrom;
      this.panFrom = null;
      const drag = this.dragFrom;
      this.dragFrom = null;
      if (wasPanning || this.keeper.mode !== 'play' || over.length) return;
      if (p.button !== 0) return;
      const w = this.worldPoint(p);
      if (drag?.moved) {
        const to = this.siteAt(w.x, w.y);
        if (to >= 0 && to !== drag.site) this.keeper.digBetween(drag.site, to);
        return;
      }
      this.clickAt(w.x, w.y, p);
    });

    this.input.on('gameout', () => {
      this.keeper.hover = null;
    });
  }

  private worldPoint(p: Phaser.Input.Pointer): { x: number; y: number } {
    const v = p.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
    return { x: v.x, y: v.y };
  }

  /** Visible site whose room rectangle contains a world point, or -1. */
  private siteAt(px: number, py: number): number {
    const sim = this.sim;
    const x = (px - T / 2) / T;
    const y = (py - T / 2) / T;
    for (const s of sim.cave.sites) {
      if (s.kind === 'site' && !sim.isExcavated(s.id)) continue;
      if (Math.abs(x - s.x) <= s.w / 2 + 0.2 && Math.abs(y - s.y) <= s.h / 2 + 0.2) return s.id;
    }
    return -1;
  }

  /** Dug or diggable corridor near a world point, or -1. */
  private edgeAt(px: number, py: number): number {
    const sim = this.sim;
    const x = (px - T / 2) / T;
    const y = (py - T / 2) / T;
    let best = -1;
    let bestD = 1.1;
    for (const e of sim.cave.edges) {
      if (!sim.isExcavated(e.a) || !sim.isExcavated(e.b)) continue;
      const a = sim.site(e.a);
      const b = sim.site(e.b);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy)));
      const d = Math.hypot(a.x + dx * t - x, a.y + dy * t - y);
      if (d < bestD) {
        bestD = d;
        best = e.id;
      }
    }
    return best;
  }

  private heroAt(px: number, py: number): number | null {
    let best: number | null = null;
    let bestD = 12;
    for (const [id, v] of this.heroViews) {
      const d = Math.hypot(v.x - px, v.y - 7 - py);
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    return best;
  }

  private clickAt(px: number, py: number, p: Phaser.Input.Pointer): void {
    const k = this.keeper;
    const sim = this.sim;
    const hero = this.heroAt(px, py);
    if (hero !== null) return k.select({ kind: 'hero', id: hero });
    const site = this.siteAt(px, py);
    if (site >= 0) {
      const s = sim.site(site);
      if (s.kind === 'maw') return k.select({ kind: 'maw' });
      if (s.kind === 'gate') return k.select(null);
      if (sim.rooms.has(site)) return k.select({ kind: 'room', site });
      return k.select({ kind: 'empty', site }, { sx: p.x, sy: p.y });
    }
    const edge = this.edgeAt(px, py);
    if (edge >= 0) {
      if (sim.dug.has(edge)) return k.select({ kind: 'corridor', edge });
      k.digEdge(edge);
      return;
    }
    k.select(null);
  }

  private panWithKeys(delta: number): void {
    const cam = this.cameras.main;
    const k = this.keys;
    const target = document.activeElement;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    const sp = (560 / cam.zoom) * (delta / 1000);
    if (k.A.isDown || k.LEFT.isDown) cam.scrollX -= sp;
    if (k.D.isDown || k.RIGHT.isDown) cam.scrollX += sp;
    if (k.W.isDown || k.UP.isDown) cam.scrollY -= sp;
    if (k.S.isDown || k.DOWN.isDown) cam.scrollY += sp;
  }

  private isPointerOnCanvas(): boolean {
    const ev = this.input.activePointer.event as MouseEvent | undefined;
    if (!ev || typeof ev.clientX !== 'number') return true;
    return document.elementFromPoint(ev.clientX, ev.clientY) === this.game.canvas;
  }

  /** Room outlines, corridor highlights, the drag line and hover text. */
  private drawOverlay(): void {
    const k = this.keeper;
    const sim = this.sim;
    const g = this.overlay;
    g.clear();
    const drag = this.dragGfx;
    drag.clear();
    k.hover = null;
    if (k.mode !== 'play') return;

    const p = this.input.activePointer;
    const onCanvas = this.isPointerOnCanvas() && !this.panFrom;
    const w = this.worldPoint(p);
    const site = onCanvas ? this.siteAt(w.x, w.y) : -1;
    const edge = onCanvas && site < 0 ? this.edgeAt(w.x, w.y) : -1;
    const rect = (sid: number, color: number, width: number, alpha: number) => {
      const s = sim.site(sid);
      g.lineStyle(width, color, alpha).strokeRect(wx(s.x) - (s.w * T) / 2, wy(s.y) - (s.h * T) / 2, s.w * T, s.h * T);
    };

    // Empty sites: dashed outline so you can see where rooms can go.
    for (const s of sim.cave.sites) {
      if (s.kind !== 'site' || !sim.isExcavated(s.id) || sim.rooms.has(s.id)) continue;
      const x0 = wx(s.x) - (s.w * T) / 2;
      const y0 = wy(s.y) - (s.h * T) / 2;
      const hot = s.id === site;
      g.lineStyle(1, hot ? 0xf2c14e : 0xa7978b, hot ? 0.95 : 0.4);
      for (let x = 0; x < s.w * T; x += 8) {
        g.lineBetween(x0 + x, y0, x0 + x + 4, y0);
        g.lineBetween(x0 + x, y0 + s.h * T, x0 + x + 4, y0 + s.h * T);
      }
      for (let y = 0; y < s.h * T; y += 8) {
        g.lineBetween(x0, y0 + y, x0, y0 + y + 4);
        g.lineBetween(x0 + s.w * T, y0 + y, x0 + s.w * T, y0 + y + 4);
      }
      g.lineStyle(2, hot ? 0xf2c14e : 0xa7978b, hot ? 1 : 0.45);
      g.lineBetween(wx(s.x) - 5, wy(s.y), wx(s.x) + 5, wy(s.y));
      g.lineBetween(wx(s.x), wy(s.y) - 5, wx(s.x), wy(s.y) + 5);
    }

    // Corridors you could dig: dotted lines between rooms.
    for (const e of sim.cave.edges) {
      if (sim.dug.has(e.id) || !sim.isExcavated(e.a) || !sim.isExcavated(e.b)) continue;
      const a = sim.site(e.a);
      const b = sim.site(e.b);
      const hot = e.id === edge;
      const ok = sim.gold >= sim.corridorCost(e.id);
      g.lineStyle(hot ? 2 : 1, hot ? (ok ? 0xf2c14e : 0xff6b6b) : 0x8a7a70, hot ? 0.95 : 0.35);
      const len = Math.hypot(b.x - a.x, b.y - a.y) * T;
      const ux = ((b.x - a.x) * T) / len;
      const uy = ((b.y - a.y) * T) / len;
      for (let d = 0; d < len; d += 6) {
        const x = wx(a.x) + ux * d;
        const y = wy(a.y) + uy * d;
        if (sim.inRect(e.a, (x - T / 2) / T, (y - T / 2) / T) || sim.inRect(e.b, (x - T / 2) / T, (y - T / 2) / T)) continue;
        g.lineBetween(x, y, x + ux * 3, y + uy * 3);
      }
    }

    // Selection
    const sel = k.selection;
    if (sel?.kind === 'room' || sel?.kind === 'empty') {
      rect(sel.site, 0xf2c14e, 2, 1);
      // Show links: everything this room touches by corridor.
      for (const n of sim.linked(sel.site)) if (sim.rooms.has(n)) rect(n, 0x8be06a, 1, 0.6);
    } else if (sel?.kind === 'maw') rect(sim.cave.maw, 0xf2c14e, 2, 1);
    else if (sel?.kind === 'corridor') {
      const e = sim.cave.edges[sel.edge];
      const a = sim.site(e.a);
      const b = sim.site(e.b);
      g.lineStyle(3, 0xf2c14e, 0.8).lineBetween(wx(a.x), wy(a.y), wx(b.x), wy(b.y));
    } else if (sel?.kind === 'hero') {
      const v = this.heroViews.get(sel.id);
      if (v) g.lineStyle(1, 0xf2c14e, 1).strokeEllipse(v.x, v.y, 18, 8);
      else k.selection = null;
    }

    // Hover
    if (site >= 0 && !(sel && 'site' in sel && sel.site === site)) {
      const s = sim.site(site);
      if (s.kind !== 'site' || sim.rooms.has(site)) rect(site, 0xffffff, 1, 0.5);
    }
    const sp = p.position;
    if (this.dragFrom?.moved) {
      const a = sim.site(this.dragFrom.site);
      const target = this.siteAt(w.x, w.y);
      const e = target >= 0 && target !== this.dragFrom.site ? sim.edgeBetween(this.dragFrom.site, target) : null;
      const okDig = e ? sim.canDig(e.id) : null;
      const color = !e ? 0xa7978b : okDig?.ok ? 0x8be06a : 0xff6b6b;
      drag.lineStyle(3, color, 0.9).lineBetween(wx(a.x), wy(a.y), w.x, w.y);
      if (target >= 0 && target !== this.dragFrom.site) {
        if (!e) k.hover = { text: 'Too far apart to join', bad: true, sx: sp.x, sy: sp.y };
        else if (sim.dug.has(e.id)) k.hover = { text: 'Already joined', bad: true, sx: sp.x, sy: sp.y };
        else k.hover = { text: okDig?.ok ? `Dig corridor · ${sim.corridorCost(e.id)} Gold` : (okDig as { reason: string }).reason, bad: !okDig?.ok, sx: sp.x, sy: sp.y };
      } else k.hover = { text: 'Drag to another room to dig a corridor', bad: false, sx: sp.x, sy: sp.y };
    } else if (edge >= 0 && !sim.dug.has(edge)) {
      const r = sim.canDig(edge);
      k.hover = { text: r.ok ? `Click to dig · ${sim.corridorCost(edge)} Gold` : r.reason, bad: !r.ok, sx: sp.x, sy: sp.y };
    } else if (site >= 0 && sim.site(site).kind === 'site' && !sim.rooms.has(site)) {
      k.hover = { text: 'Empty site · click to build', bad: false, sx: sp.x, sy: sp.y };
    }
  }

  private updateRoutes(delta: number): void {
    const k = this.keeper;
    const sim = this.sim;
    const show = k.save.settings.routes && k.mode === 'play';
    this.routeT -= delta;
    if (this.routeT <= 0) {
      this.routeT = 400;
      this.routes = [];
      if (show) {
        const offs = { knight: -3, rogue: 0, cleric: 3 };
        for (const cls of ['knight', 'rogue', 'cleric'] as const) {
          const path = sim.previewRoute(cls);
          this.routes.push({ cls, pts: path.map((s) => ({ x: wx(sim.site(s).x) + offs[cls], y: wy(sim.site(s).y) + offs[cls] })) });
        }
      }
      let n = 0;
      if (k.mode === 'play') {
        for (const [site] of sim.rumors) {
          if (!sim.rooms.get(site)) continue;
          let eye = this.eyes[n];
          if (!eye) {
            eye = this.add.image(0, 0, 'icon:eye').setDepth(9600);
            this.eyes[n] = eye;
          }
          const s = sim.site(site);
          eye.setPosition(wx(s.x) + (s.w / 2) * T - 8, wy(s.y) - (s.h / 2) * T + 6).setVisible(true);
          n++;
        }
      }
      for (let j = n; j < this.eyes.length; j++) this.eyes[j].setVisible(false);
    }
    const gfx = this.routeGfx;
    gfx.clear();
    if (!show) return;
    const dash = 5;
    const period = 10;
    const phase = (this.time.now / 50) % period;
    for (const r of this.routes) {
      gfx.lineStyle(1, ROUTE_COLORS[r.cls], 0.8);
      let dist0 = 0;
      for (let j = 1; j < r.pts.length; j++) {
        const a = r.pts[j - 1];
        const b = r.pts[j];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len < 0.01) continue;
        const first = Math.floor((dist0 - phase) / period) * period + phase;
        for (let s = first; s < dist0 + len; s += period) {
          const s0 = Math.max(s, dist0) - dist0;
          const s1 = Math.min(s + dash, dist0 + len) - dist0;
          if (s1 <= s0) continue;
          gfx.lineBetween(a.x + ((b.x - a.x) * s0) / len, a.y + ((b.y - a.y) * s0) / len, a.x + ((b.x - a.x) * s1) / len, a.y + ((b.y - a.y) * s1) / len);
        }
        dist0 += len;
      }
    }
  }

  private updateRegionButtons(): void {
    const sim = this.sim;
    const playing = this.keeper.mode === 'play';
    if (playing && !this.regionButtons.length && sim.excavatable().length) this.rebuildRegionButtons();
    const cost = sim.excavateCost();
    for (const b of this.regionButtons) {
      b.setVisible(playing);
      const t = b.getByName('cost') as Phaser.GameObjects.BitmapText | null;
      if (t) {
        t.setText(String(cost));
        t.setTint(sim.essence >= cost ? COLOR.cyan : COLOR.red);
      }
    }
  }

  static readonly DT = BALANCE.dt;
}
