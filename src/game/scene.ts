import Phaser from 'phaser';
import { BALANCE, FEATURES, MONSTERS } from '../sim/content';
import type { Hero, Monster, Sim, SimEvent } from '../sim/sim';
import type { Bank } from './art/bank';
import { FONT_CELL_H, FONT_CELL_W, FONT_CHARS, buildFontSheet } from './art/font';
import { BLOCK_H, LAYER, TILE_H, TILE_W, depthOf, toGrid, toWorld } from './iso';
import type { Keeper } from './keeper';

type Img = Phaser.GameObjects.Image;

interface UnitView {
  c: Phaser.GameObjects.Container;
  body: Img;
  shadow: Img;
  bar: Phaser.GameObjects.Graphics;
  status: Img;
  crown: Img | null;
  base: string;
  lastAttack: number;
  lastHit: number;
  lastX: number;
  lastY: number;
  animT: number;
  frame: number;
  hpShown: number;
  isHero: boolean;
}

const ROUTE_COLORS = { knight: 0xc9d1dd, rogue: 0x7ee06a, cleric: 0xf2c14e } as const;
const ROMAN = ['', '', 'II', 'III', 'IV', 'V'];
const UPRIGHT = new Set(['goblinDen', 'hoard', 'larder']);
const COLOR = {
  white: 0xffffff,
  gold: 0xf2c14e,
  red: 0xff5a5a,
  orange: 0xff9a3c,
  green: 0x8be06a,
  purple: 0xc08cff,
  grey: 0xb8aec0,
  yellow: 0xffe066,
};

function hash(i: number): number {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) % 997;
}

export class WorldScene extends Phaser.Scene {
  private sim!: Sim;
  private tileImgs: (Img | null)[] = [];
  private featImgs: (Img | null)[] = [];
  private levelTexts: (Phaser.GameObjects.BitmapText | null)[] = [];
  private tileKeys: string[] = [];
  private gridVersion = -1;
  private heroViews = new Map<number, UnitView>();
  private monsterViews = new Map<number, UnitView>();
  private maw!: Img;
  private mawGlow!: Img;
  private entrance!: Img;
  private entranceGlow!: Img;
  private hoverImg!: Img;
  private ghost!: Img;
  private selectImg!: Img;
  private marks: Img[] = [];
  private eyes: Img[] = [];
  private routeGfx!: Phaser.GameObjects.Graphics;
  private routes: { cls: keyof typeof ROUTE_COLORS; pts: { x: number; y: number }[] }[] = [];
  private routeT = 0;
  private spikeUp = new Map<number, number>();
  private mawChompUntil = 0;
  private mawDead = false;
  private floaters = 0;
  private emit: Record<string, Phaser.GameObjects.Particles.ParticleEmitter> = {};
  private panFrom: { x: number; y: number } | null = null;
  private painting = false;
  private paintedTiles = new Set<number>();
  private mistT = 0;
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

    this.cameras.main.setBackgroundColor('#120d16');
    this.routeGfx = this.add.graphics().setDepth(900000);
    this.hoverImg = this.add.image(0, 0, 'hl:hover').setVisible(false).setDepth(800000);
    this.selectImg = this.add.image(0, 0, 'hl:select').setVisible(false).setDepth(800001);
    this.ghost = this.add.image(0, 0, 'hoard').setVisible(false).setDepth(800002).setAlpha(0.6);
    this.makeEmitters();
    this.setupInput();
    this.rebuild();
    this.fitCamera();
    this.scale.on('resize', () => this.fitCamera(false));
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
      e.setDepth(850000);
      this.emit[name] = e;
    };
    mk('spark', 'fx:spark', { lifespan: 280, speed: { min: 25, max: 70 }, scale: { start: 1, end: 0 }, gravityY: 140 });
    mk('star', 'fx:star', { lifespan: 380, speed: { min: 20, max: 50 }, scale: { start: 1, end: 0.2 }, gravityY: 60 });
    mk('dust', 'fx:dust', { lifespan: 600, speed: { min: 8, max: 35 }, angle: { min: 180, max: 360 }, alpha: { start: 0.9, end: 0 }, gravityY: 30 });
    mk('debris', 'fx:rock', { lifespan: 650, speed: { min: 40, max: 95 }, angle: { min: 200, max: 340 }, gravityY: 320, rotate: { min: 0, max: 360 } });
    mk('ember', 'fx:ember', { lifespan: 800, speedX: { min: -18, max: 18 }, speedY: { min: -55, max: -20 }, alpha: { start: 1, end: 0 } });
    mk('flame', 'fx:flame', { lifespan: 500, speedX: { min: -10, max: 10 }, speedY: { min: -40, max: -15 }, scale: { start: 1, end: 0.3 }, alpha: { start: 1, end: 0 } });
    mk('drip', 'fx:drip', { lifespan: 500, speedX: { min: -8, max: 8 }, speedY: { min: -10, max: 10 }, gravityY: 120 });
    mk('oil', 'fx:oil', { lifespan: 450, speed: { min: 30, max: 65 }, angle: { min: 200, max: 340 }, gravityY: 260 });
    mk('smoke', 'smoke:0', { lifespan: 650, speed: { min: 4, max: 16 }, scale: { start: 0.6, end: 1.5 }, alpha: { start: 0.8, end: 0 } });
    mk('heal', 'fx:plus', { lifespan: 750, speedX: { min: -6, max: 6 }, speedY: { min: -30, max: -14 }, alpha: { start: 1, end: 0 } });
    mk('mist', 'fx:mist', { lifespan: 2200, speedX: { min: -5, max: 5 }, speedY: { min: -6, max: -2 }, alpha: { start: 0.7, end: 0 }, scale: { start: 0.8, end: 1.6 } });
    mk('coins', 'fx:coin', { lifespan: 700, speed: { min: 40, max: 90 }, angle: { min: 220, max: 320 }, gravityY: 300 });
  }

  // ------------------------------------------------------------ world construction

  private rebuild(): void {
    this.sim = this.keeper.sim;
    for (const img of this.tileImgs) img?.destroy();
    for (const img of this.featImgs) img?.destroy();
    for (const t of this.levelTexts) t?.destroy();
    for (const v of this.heroViews.values()) v.c.destroy();
    for (const v of this.monsterViews.values()) v.c.destroy();
    this.heroViews.clear();
    this.monsterViews.clear();
    this.maw?.destroy();
    this.mawGlow?.destroy();
    this.entrance?.destroy();
    this.entranceGlow?.destroy();
    const n = this.sim.grid.w * this.sim.grid.h;
    this.tileImgs = new Array(n).fill(null);
    this.featImgs = new Array(n).fill(null);
    this.levelTexts = new Array(n).fill(null);
    this.tileKeys = new Array(n).fill('');
    this.gridVersion = -1;
    this.mawDead = false;
    this.spikeUp.clear();

    const g = this.sim.grid;
    const mp = toWorld(g.x(g.maw), g.y(g.maw));
    this.mawGlow = this.add.image(mp.x, mp.y, 'glow').setBlendMode(Phaser.BlendModes.ADD).setScale(2.2, 1.3).setAlpha(0.22).setTint(0xff6080).setDepth(depthOf(g.x(g.maw), g.y(g.maw), LAYER.decal));
    this.maw = this.add.image(mp.x, mp.y + 2, 'maw:0').setOrigin(0.5, 26 / 40).setDepth(depthOf(g.x(g.maw), g.y(g.maw), LAYER.prop));
    const ep = toWorld(g.x(g.entrance), g.y(g.entrance));
    this.entrance = this.add.image(ep.x, ep.y + 5, 'entrance:0').setOrigin(0.5, 1).setDepth(depthOf(g.x(g.entrance), g.y(g.entrance), LAYER.block));
    this.entranceGlow = this.add.image(ep.x, ep.y - 6, 'glow').setBlendMode(Phaser.BlendModes.ADD).setScale(1.6, 1.1).setAlpha(0.3).setDepth(depthOf(g.x(g.entrance), g.y(g.entrance), LAYER.block) + 1);
    this.syncTiles(false);
  }

  private fitCamera(center = true): void {
    const cam = this.cameras.main;
    const g = this.sim.grid;
    const left = toWorld(0, g.h - 1).x - TILE_W;
    const right = toWorld(g.w - 1, 0).x + TILE_W;
    const top = -TILE_H - 40;
    const bottom = toWorld(g.w - 1, g.h - 1).y + TILE_H + 20;
    const w = right - left;
    const h = bottom - top;
    const margin = 260;
    cam.setBounds(left - margin, top - margin, w + margin * 2, h + margin * 2);
    if (center) {
      // Fit the whole route from the gate to the Maw between the HUD bars.
      const e = toWorld(g.x(g.entrance), g.y(g.entrance));
      const m = toWorld(g.x(g.maw), g.y(g.maw));
      const spanH = m.y - e.y + 70;
      const spanW = Math.abs(m.x - e.x) + 140;
      const zoom = Phaser.Math.Clamp(Math.min(Math.floor((cam.height - 240) / spanH), Math.floor((cam.width - 120) / spanW)), 2, 4);
      cam.setZoom(zoom);
      cam.centerOn((e.x + m.x) / 2, (e.y + m.y) / 2 - 10);
    }
  }

  /** Bring tile sprites in line with the grid. `fx` plays dig/build effects for changes. */
  private syncTiles(fx: boolean): void {
    const g = this.sim.grid;
    if (g.version === this.gridVersion) return;
    this.gridVersion = g.version;
    for (let i = 0; i < g.kinds.length; i++) {
      const kind = g.kinds[i];
      const f = g.features[i];
      const key = `${kind}|${f?.id ?? ''}|${f?.level ?? 0}`;
      if (key === this.tileKeys[i]) continue;
      const prev = this.tileKeys[i];
      this.tileKeys[i] = key;
      const x = g.x(i);
      const y = g.y(i);
      const w = toWorld(x, y);
      const prevKind = prev.split('|')[0];
      const prevFeat = prev.split('|')[1];

      if (prevKind !== kind) {
        this.tileImgs[i]?.destroy();
        let img: Img | null = null;
        if (kind === 'rock' || kind === 'bedrock') {
          const tex = kind === 'rock' ? `rock:${hash(i) % 3}` : `bedrock:${hash(i) % 2}`;
          img = this.add.image(w.x, w.y - BLOCK_H, tex).setOrigin(0.5, (TILE_H / 2) / (TILE_H + BLOCK_H)).setDepth(depthOf(x, y, LAYER.block));
          if (fx && prevKind === 'floor') {
            img.setAlpha(0).y -= 10;
            this.tweens.add({ targets: img, y: w.y - BLOCK_H, alpha: 1, duration: 180, ease: 'Quad.easeIn' });
            this.time.delayedCall(170, () => this.emit.dust.explode(10, w.x, w.y + 4));
            this.cameras.main.shake(60, 0.002);
          }
        } else {
          img = this.add.image(w.x, w.y, `floor:${hash(i) % 4}`).setDepth(depthOf(x, y, LAYER.floor));
          if (fx && (prevKind === 'rock' || prevKind === 'bedrock')) {
            this.emit.debris.explode(10, w.x, w.y - 6);
            this.emit.dust.explode(12, w.x, w.y);
          }
        }
        this.tileImgs[i] = img;
      }

      if (prevFeat !== (f?.id ?? '') || !f) {
        this.featImgs[i]?.destroy();
        this.featImgs[i] = null;
        if (f) {
          const img = this.makeFeatureImage(f.id, w.x, w.y, x, y);
          this.featImgs[i] = img;
          if (fx) {
            const sy = img.scaleY;
            img.setScale(0.2, 0.2);
            this.tweens.add({ targets: img, scaleX: 1, scaleY: sy, duration: 260, ease: 'Back.easeOut' });
            this.emit.dust.explode(8, w.x, w.y + 2);
          }
        } else if (fx && prevFeat) {
          this.emit.smoke.explode(4, w.x, w.y - 4);
        }
      }

      this.levelTexts[i]?.destroy();
      this.levelTexts[i] = null;
      if (f && f.level > 1) {
        const t = this.add.bitmapText(w.x + 9, w.y + 1, 'pix', ROMAN[f.level] ?? String(f.level)).setTint(COLOR.gold).setDepth(depthOf(x, y, LAYER.prop) + 0.5).setLetterSpacing(-1);
        this.levelTexts[i] = t;
        if (fx) {
          this.emit.star.explode(6, w.x, w.y - 8);
          this.tweens.add({ targets: this.featImgs[i], scaleX: 1.25, scaleY: 1.25, duration: 90, yoyo: true });
        }
      }
    }
  }

  private makeFeatureImage(id: string, wx: number, wy: number, x: number, y: number): Img {
    if (UPRIGHT.has(id)) {
      return this.add.image(wx, wy + 5, id).setOrigin(0.5, 1).setDepth(depthOf(x, y, LAYER.prop));
    }
    if (id === 'spikes') return this.add.image(wx, wy, 'spikes:0').setOrigin(0.5, 16 / 24).setDepth(depthOf(x, y, LAYER.decal));
    if (id === 'gloom') return this.add.image(wx, wy, 'gloom:0').setDepth(depthOf(x, y, LAYER.decal) + 0.2);
    if (id === 'mimic') return this.add.image(wx, wy, 'mimicBait').setDepth(depthOf(x, y, LAYER.decal));
    return this.add.image(wx, wy, id).setDepth(depthOf(x, y, LAYER.decal));
  }

  // ------------------------------------------------------------ units

  private makeUnit(base: string, isHero: boolean, champion: boolean): UnitView {
    const c = this.add.container(0, 0);
    const shadow = this.add.image(0, 1, 'shadow');
    const body = this.add.image(0, 2, `${base}:0`).setOrigin(0.5, 1);
    const bar = this.add.graphics();
    const status = this.add.image(0, -20, 'fx:drip').setVisible(false);
    c.add([shadow, body, bar, status]);
    let crown: Img | null = null;
    if (champion) {
      body.setScale(1.3);
      shadow.setScale(1.3);
      crown = this.add.image(0, -21, 'crown');
      c.add(crown);
    }
    return { c, body, shadow, bar, status, crown, base, lastAttack: -1, lastHit: -1, lastX: 0, lastY: 0, animT: 0, frame: 0, hpShown: -1, isHero };
  }

  private syncUnits(delta: number): void {
    const a = this.keeper.alpha;
    const seenH = new Set<number>();
    for (const h of this.sim.heroes) {
      seenH.add(h.id);
      let v = this.heroViews.get(h.id);
      if (!v) {
        v = this.makeUnit(h.cls, true, !!h.champion);
        this.heroViews.set(h.id, v);
        v.c.setAlpha(0);
        this.tweens.add({ targets: v.c, alpha: 1, duration: 250 });
      }
      this.updateUnit(v, h, a, delta);
    }
    for (const [id, v] of this.heroViews) {
      if (seenH.has(id)) continue;
      v.c.destroy();
      this.heroViews.delete(id);
    }
    const seenM = new Set<number>();
    for (const m of this.sim.monsters) {
      seenM.add(m.id);
      let v = this.monsterViews.get(m.id);
      if (!v) {
        v = this.makeUnit(m.kind, false, false);
        this.monsterViews.set(m.id, v);
        if (m.kind !== 'mimic') {
          v.c.setScale(0.2);
          this.tweens.add({ targets: v.c, scale: 1, duration: 260, ease: 'Back.easeOut' });
        }
      }
      this.updateUnit(v, m, a, delta);
    }
    for (const [id, v] of this.monsterViews) {
      if (seenM.has(id)) continue;
      v.c.destroy();
      this.monsterViews.delete(id);
    }
  }

  private updateUnit(v: UnitView, u: Hero | Monster, a: number, delta: number): void {
    const gx = u.px + (u.x - u.px) * a;
    const gy = u.py + (u.y - u.py) * a;
    const w = toWorld(gx, gy);
    const moved = Math.hypot(w.x - v.lastX, w.y - v.lastY) > 0.05;
    v.lastX = w.x;
    v.lastY = w.y;
    v.c.setPosition(Math.round(w.x), Math.round(w.y));
    v.c.setDepth(depthOf(gx, gy, LAYER.unit));
    v.body.setFlipX(u.facing < 0);

    // Animation frames
    v.animT += delta;
    const isMimic = v.base === 'mimic';
    if (isMimic) {
      const open = (u as Monster).targetId !== null || this.sim.time - u.lastAttackAt < 0.5;
      v.body.setTexture(open ? 'mimic:1' : 'mimic:0');
    } else if (v.base === 'slime') {
      if (v.animT > 380) {
        v.animT = 0;
        v.frame ^= 1;
        v.body.setTexture(`slime:${v.frame}`);
      }
    } else if (moved) {
      if (v.animT > 150) {
        v.animT = 0;
        v.frame ^= 1;
        v.body.setTexture(`${v.base}:${v.frame}`);
      }
      v.body.y = 2 - (v.frame ? 1 : 0);
    } else {
      v.body.y = 2 + Math.round(Math.sin(this.time.now / 300 + u.id) * 0.5);
    }

    // Attack lunge
    if (u.lastAttackAt !== v.lastAttack) {
      if (v.lastAttack >= 0 && this.sim.time - u.lastAttackAt < 0.3) {
        const dx = u.facing * 3;
        this.tweens.add({ targets: v.body, x: dx, duration: 60, yoyo: true, ease: 'Quad.easeOut' });
      }
      v.lastAttack = u.lastAttackAt;
    }
    // Hit flash and squash
    if (u.lastHitAt !== v.lastHit) {
      if (v.lastHit >= 0 && this.sim.time - u.lastHitAt < 0.3) {
        v.body.setTintFill(0xffffff);
        const s = v.crown ? 1.3 : 1;
        v.body.setScale(s * 1.15, s * 0.82);
        this.time.delayedCall(70, () => {
          v.body.clearTint();
          this.tweens.add({ targets: v.body, scaleX: s, scaleY: s, duration: 120, ease: 'Back.easeOut' });
        });
      }
      v.lastHit = u.lastHitAt;
    }

    // HP bar
    const frac = Math.max(0, u.hp / u.maxHp);
    if (Math.abs(frac - v.hpShown) > 0.005) {
      v.hpShown = frac;
      v.bar.clear();
      if (frac < 0.999) {
        const top = v.crown ? -25 : v.base === 'slime' ? -13 : v.base === 'goblin' ? -15 : v.base === 'mimic' ? -16 : -19;
        v.bar.fillStyle(0x1b1020, 1).fillRect(-7, top, 14, 3);
        v.bar.fillStyle(v.isHero ? 0xe0463c : 0x7ee06a, 1).fillRect(-6, top + 1, Math.max(1, Math.round(12 * frac)), 1);
      }
    }

    // Status marker
    if (v.isHero) {
      const h = u as Hero;
      let icon = '';
      if (h.burning > 0) icon = 'fx:flame';
      else if (h.oily > 0) icon = 'fx:oil';
      else if (h.sticky > 0) icon = 'fx:drip';
      else if (h.goal === 'flee') icon = 'fx:bang';
      if (icon) {
        v.status.setTexture(icon).setVisible(true);
        v.status.y = (v.crown ? -30 : -24) + Math.round(Math.sin(this.time.now / 120) * 1);
      } else v.status.setVisible(false);
      if (h.burning > 0 && Math.random() < 0.25) this.emit.ember.explode(1, w.x, w.y - 8);
      if (h.sticky > 0 && Math.random() < 0.05) this.emit.drip.explode(1, w.x, w.y - 6);
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
      .setDepth(1_000_000);
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

  private handle(e: SimEvent): void {
    const g = this.sim.grid;
    switch (e.t) {
      case 'damage': {
        const w = toWorld(e.x, e.y);
        const color = e.burn ? COLOR.orange : e.on === 'monster' ? COLOR.grey : e.crit ? COLOR.yellow : COLOR.white;
        this.float(w.x, w.y - 18, `${Math.round(e.amount)}${e.crit ? '!' : ''}`, color);
        if (!e.burn) this.emit.spark.explode(e.crit ? 7 : 3, w.x, w.y - 8);
        if (e.crit) this.emit.star.explode(4, w.x, w.y - 10);
        break;
      }
      case 'heroDied':
        this.eatEffect(e.x, e.y, e.gold, !!e.champion);
        if (e.infamy >= 1) {
          const w = toWorld(e.x, e.y);
          this.time.delayedCall(250, () => this.float(w.x, w.y - 28, `+${Math.round(e.infamy)} INFAMY`, COLOR.purple));
        }
        break;
      case 'monsterDied': {
        const w = toWorld(e.x, e.y);
        this.emit.smoke.explode(5, w.x, w.y - 6);
        if (e.kind === 'slime') this.emit.drip.explode(10, w.x, w.y - 4);
        else this.emit.dust.explode(6, w.x, w.y);
        break;
      }
      case 'trap': {
        const w = toWorld(g.x(e.tile), g.y(e.tile));
        if (e.feature === 'spikes') {
          this.spikeUp.set(e.tile, this.time.now + 450);
          this.emit.spark.explode(5, w.x, w.y - 4);
          this.cameras.main.shake(50, 0.0015);
        } else if (e.feature === 'oil') {
          this.emit.oil.explode(10, w.x, w.y);
        } else if (e.feature === 'fireVent') {
          const fire = this.add.image(w.x, w.y + 3, 'fire:0').setOrigin(0.5, 1).setDepth(depthOf(g.x(e.tile), g.y(e.tile), LAYER.unit) + 0.5);
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
          this.emit.ember.explode(14, w.x, w.y - 10);
          this.cameras.main.shake(90, 0.003);
        }
        break;
      }
      case 'ignite': {
        const w = toWorld(e.x, e.y);
        this.emit.flame.explode(12, w.x, w.y - 8);
        this.float(w.x, w.y - 26, 'IGNITED!', COLOR.orange);
        break;
      }
      case 'status': {
        const w = toWorld(e.x, e.y);
        this.float(w.x, w.y - 26, e.status === 'sticky' ? 'STICKY' : 'OILY', e.status === 'sticky' ? COLOR.green : COLOR.grey);
        if (e.status === 'sticky') this.emit.drip.explode(6, w.x, w.y - 8);
        break;
      }
      case 'disarm': {
        const w = toWorld(g.x(e.tile), g.y(e.tile));
        this.float(w.x, w.y - 12, 'DISARMED', COLOR.red);
        this.emit.spark.explode(4, w.x, w.y);
        break;
      }
      case 'spotted': {
        const w = toWorld(g.x(e.tile), g.y(e.tile));
        this.float(w.x, w.y - 10, 'SPOTTED!', COLOR.yellow);
        break;
      }
      case 'loot': {
        const w = toWorld(e.x, e.y);
        this.float(w.x, w.y - 24, `-${Math.round(e.amount)} GOLD`, COLOR.red);
        this.emit.coins.explode(6, w.x, w.y - 6);
        break;
      }
      case 'bite': {
        const mp = toWorld(g.x(g.maw), g.y(g.maw));
        this.float(mp.x, mp.y - 22, `-${Math.round(e.amount)}`, COLOR.red);
        this.cameras.main.shake(110, 0.004);
        this.emit.spark.explode(5, mp.x, mp.y - 6);
        break;
      }
      case 'chomp': {
        this.mawChompUntil = this.time.now + 220;
        const mp = toWorld(g.x(g.maw), g.y(g.maw));
        this.emit.drip.explode(4, mp.x, mp.y);
        this.cameras.main.shake(70, 0.002);
        break;
      }
      case 'escaped': {
        const w = toWorld(g.x(g.entrance), g.y(g.entrance));
        this.float(w.x, w.y - 30, e.loot >= 1 ? `ESCAPED -${Math.round(e.loot)}G` : 'ESCAPED', COLOR.red);
        this.emit.dust.explode(8, w.x, w.y);
        break;
      }
      case 'party': {
        const w = toWorld(g.x(g.entrance), g.y(g.entrance));
        if (e.champion) {
          this.float(w.x, w.y - 44, e.champion, COLOR.purple, true);
          this.cameras.main.shake(400, 0.006);
          this.cameras.main.flash(180, 120, 60, 160);
        }
        this.tweens.add({ targets: this.entranceGlow, alpha: 0.7, duration: 150, yoyo: true });
        break;
      }
      case 'heal': {
        const w = toWorld(e.x, e.y);
        this.emit.heal.explode(3, w.x, w.y - 10);
        this.float(w.x, w.y - 22, `+${Math.round(e.amount)}`, COLOR.green);
        break;
      }
      case 'respawn': {
        const w = toWorld(g.x(e.tile), g.y(e.tile));
        this.emit.smoke.explode(3, w.x, w.y - 4);
        break;
      }
      case 'wipe': {
        const mp = toWorld(g.x(g.maw), g.y(g.maw));
        this.float(mp.x, mp.y - 40, 'PARTY WIPED!', COLOR.gold, true);
        break;
      }
      case 'ambush': {
        const w = toWorld(g.x(e.tile), g.y(e.tile));
        this.float(w.x, w.y - 22, 'AMBUSH!', COLOR.yellow, true);
        this.cameras.main.shake(120, 0.004);
        break;
      }
      case 'collapse':
        this.collapseEffect();
        break;
      case 'unlock':
        break;
    }
  }

  /** Bones and coins arc into the Maw, which chomps them down. */
  private eatEffect(x: number, y: number, gold: number, champion: boolean): void {
    const g = this.sim.grid;
    const from = toWorld(x, y);
    const to = toWorld(g.x(g.maw), g.y(g.maw));
    to.y -= 2;
    this.keeper.hitStop(champion ? 220 : 45);
    if (champion) {
      this.cameras.main.shake(500, 0.008);
      this.cameras.main.flash(250, 255, 220, 120);
    }
    this.emit.smoke.explode(6, from.x, from.y - 6);
    this.emit.star.explode(5, from.x, from.y - 10);
    this.float(from.x, from.y - 20, `+${Math.round(gold)} GOLD`, COLOR.gold, champion);
    const count = Math.min(champion ? 18 : 9, 3 + Math.floor(gold / 6));
    for (let k = 0; k < count; k++) {
      const tex = k < 2 ? 'fx:bone' : 'fx:coin';
      const img = this.add.image(from.x, from.y - 8, tex).setDepth(870000);
      const peak = Math.min(from.y, to.y) - 30 - Math.random() * 30;
      const midX = (from.x + to.x) / 2 + (Math.random() - 0.5) * 40;
      const state = { t: 0 };
      this.tweens.add({
        targets: state,
        t: 1,
        delay: 120 + k * 45,
        duration: 650 + Math.random() * 250,
        ease: 'Sine.easeIn',
        onUpdate: () => {
          const t = state.t;
          const u = 1 - t;
          img.x = u * u * from.x + 2 * u * t * midX + t * t * to.x;
          img.y = u * u * (from.y - 8) + 2 * u * t * peak + t * t * to.y;
          img.rotation += tex === 'fx:bone' ? 0.25 : 0;
        },
        onComplete: () => {
          img.destroy();
          this.mawChompUntil = this.time.now + 140;
          this.keeper.audio.play(tex === 'fx:bone' ? 'chomp' : 'coin', { vol: 0.5, gap: 0.07 });
        },
      });
    }
  }

  private collapseEffect(): void {
    this.mawDead = true;
    const cam = this.cameras.main;
    cam.shake(2200, 0.012);
    cam.flash(400, 255, 80, 80);
    this.maw.setTexture('maw:hurt');
    this.tweens.add({ targets: this.maw, scaleX: 0.6, scaleY: 0.3, alpha: 0.4, angle: 8, duration: 2200, ease: 'Quad.easeIn' });
    const g = this.sim.grid;
    for (let k = 0; k < 40; k++) {
      this.time.delayedCall(k * 55, () => {
        const i = Math.floor(Math.random() * g.kinds.length);
        const w = toWorld(g.x(i), g.y(i));
        this.emit.debris.explode(4, w.x, w.y - 10);
        this.emit.dust.explode(6, w.x, w.y);
      });
    }
  }

  // ------------------------------------------------------------ frame

  update(_time: number, delta: number): void {
    this.keeper.update(delta);
    if (this.keeper.sim !== this.sim) {
      this.rebuild();
      this.fitCamera();
    }
    const evs = this.keeper.frameEvents.splice(0);
    for (const e of evs) this.handle(e);

    this.syncTiles(true);
    this.syncFeatures(delta);
    this.syncUnits(delta);
    this.syncMaw();
    this.panWithKeys(delta);
    this.updateHover();
    this.updateRoutes(delta);
  }

  private syncFeatures(delta: number): void {
    const g = this.sim.grid;
    const now = this.time.now;
    const gloomFrame = Math.floor(now / 600) % 2;
    this.mistT -= delta;
    const emitMist = this.mistT <= 0;
    if (emitMist) this.mistT = 350;
    for (let i = 0; i < this.featImgs.length; i++) {
      const img = this.featImgs[i];
      const f = g.features[i];
      if (!img || !f) continue;
      if (f.id === 'spikes') img.setTexture((this.spikeUp.get(i) ?? 0) > now ? 'spikes:1' : 'spikes:0');
      else if (f.id === 'gloom') {
        img.setTexture(`gloom:${gloomFrame}`);
        if (emitMist && Math.random() < 0.4) {
          const w = toWorld(g.x(i), g.y(i));
          this.emit.mist.explode(1, w.x + Phaser.Math.Between(-8, 8), w.y);
        }
      } else if (f.id === 'fireVent' && f.rearm <= 0 && Math.random() < 0.02) {
        const w = toWorld(g.x(i), g.y(i));
        this.emit.ember.explode(1, w.x, w.y - 2);
      }
      // Disarmed or resetting traps look dim.
      if (FEATURES[f.id].category === 'trap') img.setAlpha(f.rearm > 0 && f.id !== 'spikes' ? 0.6 : 1);
    }
    // Entrance torches
    if (Math.random() < 0.08) this.entrance.setTexture(`entrance:${Math.random() < 0.5 ? 0 : 1}`);
    this.entranceGlow.setAlpha(0.26 + Math.sin(now / 90) * 0.03 + Math.random() * 0.02);
  }

  private syncMaw(): void {
    if (this.mawDead) return;
    const sim = this.sim;
    const g = sim.grid;
    const now = this.time.now;
    const mx = g.x(g.maw);
    const my = g.y(g.maw);
    let tex = 'maw:0';
    if (now < this.mawChompUntil) tex = 'maw:2';
    else if (sim.time - sim.mawLastHitAt < 0.15) tex = 'maw:hurt';
    else if (sim.heroes.some((h) => Math.hypot(h.x - mx, h.y - my) < 2.6)) tex = Math.floor(now / 250) % 2 ? 'maw:1' : 'maw:2';
    this.maw.setTexture(tex);
    const breathe = Math.sin(now / 700) * 0.035;
    this.maw.setScale(1 - breathe * 0.5, 1 + breathe);
    const low = sim.mawHp < sim.mawMaxHp * 0.35;
    if (low && Math.floor(now / 300) % 2) this.maw.setTint(0xff9090);
    else this.maw.clearTint();
    this.mawGlow.setAlpha(low ? 0.35 + Math.sin(now / 150) * 0.1 : 0.2);
  }

  // ------------------------------------------------------------ input

  private setupInput(): void {
    this.input.mouse?.disableContextMenu();
    this.keys = this.input.keyboard!.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT', false) as Record<string, Phaser.Input.Keyboard.Key>;

    this.input.on('wheel', (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      const cam = this.cameras.main;
      const z = Phaser.Math.Clamp(cam.zoom + (dy > 0 ? -1 : 1), 1, 5);
      if (z === cam.zoom) return;
      const before = cam.getWorldPoint(p.x, p.y);
      cam.setZoom(z);
      cam.preRender();
      const after = cam.getWorldPoint(p.x, p.y);
      cam.scrollX += before.x - after.x;
      cam.scrollY += before.y - after.y;
    });

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.keeper.audio.unlock();
      if (p.rightButtonDown() || p.middleButtonDown()) {
        this.panFrom = { x: p.x, y: p.y };
        return;
      }
      if (this.keeper.mode !== 'play') return;
      const tile = this.pick(p);
      if (this.keeper.tool === 'inspect') {
        this.inspectAt(p, tile);
        return;
      }
      if (tile < 0) return;
      this.painting = true;
      this.paintedTiles.clear();
      this.applyTool(tile, p);
    });

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (this.panFrom) {
        const cam = this.cameras.main;
        cam.scrollX -= (p.x - this.panFrom.x) / cam.zoom;
        cam.scrollY -= (p.y - this.panFrom.y) / cam.zoom;
        this.panFrom = { x: p.x, y: p.y };
        return;
      }
      if (this.painting && p.leftButtonDown()) {
        const t = this.keeper.tool;
        if (t === 'dig' || t === 'fill' || t === 'demolish') {
          const tile = this.pick(p);
          if (tile >= 0 && !this.paintedTiles.has(tile)) this.applyTool(tile, p, true);
        }
      }
    });

    const stop = () => {
      this.panFrom = null;
      this.painting = false;
    };
    this.input.on('pointerup', stop);
    this.input.on('pointerupoutside', stop);
    this.input.on('gameout', () => {
      this.keeper.hover = null;
    });
  }

  private applyTool(tile: number, p: Phaser.Input.Pointer, quiet = false): void {
    this.paintedTiles.add(tile);
    const r = this.keeper.useTool(tile);
    if (!r.ok && r.reason && !quiet) {
      const w = p.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
      this.float(w.x, w.y - 4, r.reason, COLOR.red);
    }
  }

  /** Which tile is under the pointer? Raised block tops win over the floor behind them. */
  private pick(p: Phaser.Input.Pointer): number {
    const g = this.sim.grid;
    const w = p.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
    const up = toGrid(w.x, w.y, BLOCK_H);
    const ux = Math.round(up.x);
    const uy = Math.round(up.y);
    if (g.inBounds(ux, uy)) {
      const k = g.kinds[g.idx(ux, uy)];
      if (k === 'rock' || k === 'bedrock') return g.idx(ux, uy);
    }
    const fl = toGrid(w.x, w.y);
    const fx = Math.round(fl.x);
    const fy = Math.round(fl.y);
    return g.inBounds(fx, fy) ? g.idx(fx, fy) : -1;
  }

  private inspectAt(p: Phaser.Input.Pointer, tile: number): void {
    const w = p.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
    let best: { kind: 'hero' | 'monster'; id: number; d: number } | null = null;
    const consider = (views: Map<number, UnitView>, kind: 'hero' | 'monster') => {
      for (const [id, v] of views) {
        const dx = w.x - v.c.x;
        const dy = w.y - (v.c.y - 7);
        if (Math.abs(dx) > 8 || Math.abs(dy) > 11) continue;
        const d = Math.hypot(dx, dy);
        if (!best || d < best.d) best = { kind, id, d };
      }
    };
    consider(this.heroViews, 'hero');
    consider(this.monsterViews, 'monster');
    const g = this.sim.grid;
    if (best) {
      const b = best as { kind: 'hero' | 'monster'; id: number };
      this.keeper.select({ kind: b.kind, id: b.id });
    } else if (tile === g.maw || (tile >= 0 && g.chebyshev(tile, g.maw) <= 0)) this.keeper.select({ kind: 'maw' });
    else if (tile >= 0 && g.features[tile]) this.keeper.select({ kind: 'tile', tile });
    else this.keeper.select(null);
  }

  private panWithKeys(delta: number): void {
    const cam = this.cameras.main;
    const k = this.keys;
    const target = document.activeElement;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    const sp = (520 / cam.zoom) * (delta / 1000);
    if (k.A.isDown || k.LEFT.isDown) cam.scrollX -= sp;
    if (k.D.isDown || k.RIGHT.isDown) cam.scrollX += sp;
    if (k.W.isDown || k.UP.isDown) cam.scrollY -= sp;
    if (k.S.isDown || k.DOWN.isDown) cam.scrollY += sp;
  }

  // ------------------------------------------------------------ hover, previews, routes

  private useMark(n: number, tex: string, x: number, y: number, raised: boolean): void {
    let m = this.marks[n];
    if (!m) {
      m = this.add.image(0, 0, tex).setDepth(799000);
      this.marks[n] = m;
    }
    m.setTexture(tex).setPosition(x, y - (raised ? BLOCK_H : 0)).setVisible(true);
  }

  private updateHover(): void {
    const k = this.keeper;
    const sim = this.sim;
    const g = sim.grid;
    let marks = 0;
    const p = this.input.activePointer;
    const inside = p.x >= 0 && p.y >= 0 && p.x < this.cameras.main.width && p.y < this.cameras.main.height && !this.panFrom;
    const tile = k.mode === 'play' && inside && this.isPointerOnCanvas() ? this.pick(p) : -1;

    this.hoverImg.setVisible(false);
    this.ghost.setVisible(false);
    k.hover = null;

    const isBlock = (i: number) => g.kinds[i] === 'rock' || g.kinds[i] === 'bedrock';
    const markArea = (center: number, tiles: Iterable<number>, tex: string) => {
      for (const t of tiles) {
        if (t === center) continue;
        const w = toWorld(g.x(t), g.y(t));
        this.useMark(marks++, tex, w.x, w.y, isBlock(t));
      }
    };

    if (tile >= 0) {
      const w = toWorld(g.x(tile), g.y(tile));
      const res = k.check(tile);
      const raised = isBlock(tile);
      this.hoverImg.setTexture(k.tool === 'inspect' ? 'hl:hover' : res.ok ? 'hl:ok' : 'hl:bad');
      this.hoverImg.setPosition(w.x, w.y - (raised ? BLOCK_H : 0)).setVisible(true);
      const sp = p.position;
      k.hover = { tile, ok: res.ok, reason: res.ok ? '' : res.reason, sx: sp.x, sy: sp.y };

      const tool = k.tool;
      if (tool !== 'inspect' && tool !== 'dig' && tool !== 'fill' && tool !== 'demolish') {
        const def = FEATURES[tool];
        const tex = tool === 'spikes' ? 'spikes:0' : tool === 'gloom' ? 'gloom:0' : tool === 'mimic' ? 'mimic:0' : tool;
        this.ghost.setTexture(tex).setVisible(!raised);
        if (UPRIGHT.has(tool) || tool === 'mimic') this.ghost.setOrigin(0.5, 1).setPosition(w.x, w.y + 5);
        else if (tool === 'spikes') this.ghost.setOrigin(0.5, 16 / 24).setPosition(w.x, w.y);
        else this.ghost.setOrigin(0.5, 0.5).setPosition(w.x, w.y);
        if (res.ok) this.ghost.clearTint();
        else this.ghost.setTint(0xff6060);
        // Show what this would affect.
        if (def.category === 'lair') markArea(-1, this.sim.grid.area(tile, MONSTERS[def.monster!].leash), 'hl:range');
        else if (tool === 'fireVent') markArea(tile, g.neighbors8(tile), 'hl:range');
        else if (def.category === 'room') {
          for (const n of g.neighbors8(tile)) {
            const f = g.features[n];
            const cat = f ? FEATURES[f.id].category : null;
            const buffs =
              (tool === 'larder' && cat === 'lair') ||
              ((tool === 'hoard' || tool === 'gloom') && cat === 'trap') ||
              (tool === 'gullet' && g.isWalkable(n));
            const wn = toWorld(g.x(n), g.y(n));
            if (!isBlock(n)) this.useMark(marks++, buffs ? 'hl:buff' : 'hl:hover', wn.x, wn.y, false);
          }
        } else if (def.category === 'trap') {
          for (const n of g.neighbors8(tile)) {
            const id = g.features[n]?.id;
            if (id === 'hoard' || id === 'gloom') {
              const wn = toWorld(g.x(n), g.y(n));
              this.useMark(marks++, 'hl:buff', wn.x, wn.y, false);
            }
          }
        }
      } else if (tool === 'inspect') {
        const f = g.features[tile];
        if (f && FEATURES[f.id].category === 'lair') markArea(-1, g.area(tile, MONSTERS[FEATURES[f.id].monster!].leash), 'hl:range');
        if (f?.id === 'fireVent') markArea(tile, g.neighbors8(tile), 'hl:range');
      }
    }

    // Selection marker
    const sel = k.selection;
    this.selectImg.setVisible(false);
    if (sel?.kind === 'tile' && g.features[sel.tile]) {
      const w = toWorld(g.x(sel.tile), g.y(sel.tile));
      this.selectImg.setScale(1).setPosition(w.x, w.y).setVisible(true);
    } else if (sel?.kind === 'hero' || sel?.kind === 'monster') {
      const v = (sel.kind === 'hero' ? this.heroViews : this.monsterViews).get(sel.id);
      if (v) this.selectImg.setScale(0.55).setPosition(v.c.x, v.c.y + 1).setVisible(true);
      else k.selection = null;
    } else if (sel?.kind === 'maw') {
      const w = toWorld(g.x(g.maw), g.y(g.maw));
      this.selectImg.setScale(1.6).setPosition(w.x, w.y).setVisible(true);
    }

    for (let n = marks; n < this.marks.length; n++) this.marks[n].setVisible(false);
  }

  private isPointerOnCanvas(): boolean {
    const ev = this.input.activePointer.event as MouseEvent | undefined;
    if (!ev || typeof ev.clientX !== 'number') return true;
    return document.elementFromPoint(ev.clientX, ev.clientY) === this.game.canvas;
  }

  private updateRoutes(delta: number): void {
    const k = this.keeper;
    const sim = this.sim;
    const g = sim.grid;
    const show = k.save.settings.routes && k.mode === 'play';
    this.routeT -= delta;
    if (this.routeT <= 0) {
      this.routeT = 400;
      this.routes = [];
      if (show) {
        const offs = { knight: -2, rogue: 0, cleric: 2 };
        for (const cls of ['knight', 'rogue', 'cleric'] as const) {
          const path = sim.previewRoute(cls);
          this.routes.push({
            cls,
            pts: path.map((t) => {
              const w = toWorld(g.x(t), g.y(t));
              return { x: w.x, y: w.y + offs[cls] };
            }),
          });
        }
      }
      // Eyes over tiles the town has heard about
      let n = 0;
      if (k.mode === 'play') {
        for (const [tile] of sim.rumors) {
          if (!g.features[tile]) continue;
          let eye = this.eyes[n];
          if (!eye) {
            eye = this.add.image(0, 0, 'icon:eye').setDepth(880000).setScale(0.75);
            this.eyes[n] = eye;
          }
          const w = toWorld(g.x(tile), g.y(tile));
          eye.setPosition(w.x, w.y - 14).setVisible(true);
          n++;
        }
      }
      for (let j = n; j < this.eyes.length; j++) this.eyes[j].setVisible(false);
    }
    for (const eye of this.eyes) if (eye.visible) eye.y += Math.sin(this.time.now / 300) * 0.05;

    const gfx = this.routeGfx;
    gfx.clear();
    if (!show) return;
    const dash = 4;
    const period = 8;
    const phase = (this.time.now / 60) % period;
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

  /** Keep the dt in sync for anyone reading it. */
  static readonly DT = BALANCE.dt;
}
