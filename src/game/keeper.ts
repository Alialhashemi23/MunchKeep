import type { Audio } from '../audio/audio';
import { Bot } from '../sim/bot';
import { BALANCE, FEATURES, HEROES, teethForRun, type FeatureId } from '../sim/content';
import {
  applyOffline,
  newSaveFile,
  offlineGains,
  parseSave,
  readStore,
  writeStore,
  type KeyValueStore,
  type OfflineGains,
  type SaveFile,
} from '../sim/save';
import { Sim, type ActionResult, type SimEvent } from '../sim/sim';

export type Tool = 'inspect' | 'dig' | 'fill' | 'demolish' | FeatureId;
export type Mode = 'title' | 'play' | 'collapsed';
export type Selection =
  | { kind: 'tile'; tile: number }
  | { kind: 'hero'; id: number }
  | { kind: 'monster'; id: number }
  | { kind: 'maw' }
  | null;

export type Tone = 'good' | 'bad' | 'info' | 'gold' | 'champ';
export interface LogLine {
  id: number;
  text: string;
  tone: Tone;
  at: number;
}

export interface RunResult {
  minutes: number;
  eaten: number;
  escaped: number;
  infamy: number;
  champions: number;
  teeth: number;
  newBest: boolean;
  voluntary: boolean;
}

const COLLAPSE_SCREEN_DELAY = 2800;

/**
 * The game's conductor: owns the current Sim, the save file and the player's
 * current tool and speed. The renderer and the HUD both read from it.
 */
export class Keeper {
  save: SaveFile;
  sim: Sim;
  mode: Mode = 'title';
  speed = 1;
  tool: Tool = 'inspect';
  selection: Selection = null;
  log: LogLine[] = [];
  /** Events produced since the renderer last drained them. */
  frameEvents: SimEvent[] = [];
  /** Interpolation factor between the last two sim ticks. */
  alpha = 0;
  offlineReport: OfflineGains | null = null;
  result: RunResult | null = null;
  collapseAt: number | null = null;
  toast: { text: string; tone: Tone; at: number } | null = null;
  /** The tile under the cursor and whether the current tool would work there. */
  hover: { tile: number; ok: boolean; reason: string; sx: number; sy: number } | null = null;

  private attract: Bot | null = null;
  private acc = 0;
  private hitStopMs = 0;
  private autosaveMs = 0;
  private logId = 0;
  private lastAlarm = -99;
  private listeners = new Set<() => void>();
  private pausedBeforeHidden: number | null = null;

  constructor(
    readonly audio: Audio,
    private store: KeyValueStore | null,
    hotSave?: string,
  ) {
    const fromHot = hotSave ? parseSave(hotSave) : null;
    this.save = fromHot ?? readStore(store) ?? newSaveFile();
    this.audio.setVolumes(this.save.settings.sfx, this.save.settings.music);

    const run = this.save.run;
    if (run) {
      const elapsed = (Date.now() - this.save.savedAt) / 1000;
      if (!fromHot && elapsed > 60) {
        const gains = offlineGains(run, elapsed);
        if (gains.gold > 0 || gains.eaten > 0) {
          applyOffline(run, gains);
          this.offlineReport = gains;
        }
      }
      this.sim = new Sim(this.save.meta, run.seed, run);
      this.speed = 0;
    } else {
      this.sim = this.makeAttract();
    }
  }

  get hasRun(): boolean {
    return this.save.run !== null;
  }

  // ------------------------------------------------------------ change notification

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify(): void {
    for (const fn of this.listeners) fn();
  }

  // ------------------------------------------------------------ run lifecycle

  private makeAttract(): Sim {
    const sim = new Sim(this.save.meta, 1234 + (this.save.meta.runs % 5));
    this.attract = new Bot(sim, 'good');
    // Fast-forward a few minutes so the title backdrop already looks lived in.
    for (let k = 0; k < (5 * 60) / BALANCE.dt; k++) {
      this.attract.update(BALANCE.dt);
      sim.tick();
    }
    sim.events.length = 0;
    this.speed = 1;
    return sim;
  }

  newRun(): void {
    this.attract = null;
    const seed = (Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0;
    this.sim = new Sim(this.save.meta, seed);
    this.mode = 'play';
    this.speed = 1;
    this.tool = 'inspect';
    this.selection = null;
    this.log = [];
    this.result = null;
    this.collapseAt = null;
    this.offlineReport = null;
    this.frameEvents = [];
    this.addLog('You wake up hungry. Dig, build, and wait for dinner.', 'info');
    this.persist();
    this.notify();
  }

  continueRun(): void {
    if (!this.save.run) return this.newRun();
    this.attract = null;
    this.mode = 'play';
    this.speed = 1;
    this.tool = 'inspect';
    this.frameEvents = [];
    this.addLog('Welcome back. The Maw missed you.', 'info');
    this.notify();
  }

  toTitle(): void {
    this.persist();
    this.mode = 'title';
    if (!this.save.run) this.sim = this.makeAttract();
    else this.speed = 0;
    this.selection = null;
    this.notify();
  }

  /** Give up on this dungeon now and collect its Teeth. */
  collapseNow(): void {
    if (this.mode !== 'play' || this.sim.collapsed) return;
    this.sim.forceCollapse();
    this.processEvents(this.sim.events.splice(0), true);
  }

  private finishRun(voluntary: boolean): void {
    const sim = this.sim;
    const meta = this.save.meta;
    const teeth = teethForRun(sim.infamy, sim.champions, sim.mods.teethMul);
    const newBest = sim.time > meta.bestSeconds;
    meta.teeth += teeth;
    meta.runs++;
    meta.bestInfamy = Math.max(meta.bestInfamy, sim.infamy);
    meta.bestSeconds = Math.max(meta.bestSeconds, sim.time);
    meta.totalEaten += sim.eaten;
    this.result = {
      minutes: sim.minutes,
      eaten: sim.eaten,
      escaped: sim.escaped,
      infamy: sim.infamy,
      champions: sim.champions,
      teeth,
      newBest,
      voluntary,
    };
    this.save.run = null;
    this.collapseAt = performance.now();
    writeStore(this.store, this.save);
  }

  /** Called by the UI once the collapse animation has played. */
  get collapseScreenDue(): boolean {
    return this.collapseAt !== null && this.mode === 'play' && performance.now() - this.collapseAt > COLLAPSE_SCREEN_DELAY;
  }

  showCollapseScreen(): void {
    this.mode = 'collapsed';
    this.notify();
  }

  // ------------------------------------------------------------ persistence

  persist(): void {
    if (this.mode === 'play' && !this.sim.collapsed && !this.attract) this.save.run = this.sim.toSave();
    writeStore(this.store, this.save);
  }

  /** Save data for the artifact viewer's hot-reload snapshot. */
  snapshot(): string {
    if (this.mode === 'play' && !this.sim.collapsed && !this.attract) this.save.run = this.sim.toSave();
    this.save.savedAt = Date.now();
    return JSON.stringify(this.save);
  }

  loadSave(file: SaveFile): void {
    this.save = file;
    this.save.savedAt = Date.now();
    this.audio.setVolumes(file.settings.sfx, file.settings.music);
    writeStore(this.store, this.save);
    this.offlineReport = null;
    this.result = null;
    this.collapseAt = null;
    this.mode = 'title';
    if (file.run) {
      this.attract = null;
      this.sim = new Sim(file.meta, file.run.seed, file.run);
      this.speed = 0;
    } else {
      this.sim = this.makeAttract();
    }
    this.notify();
  }

  resetEverything(): void {
    this.loadSave(newSaveFile());
  }

  onHidden(): void {
    this.persist();
    if (this.mode === 'play' && this.speed > 0) {
      this.pausedBeforeHidden = this.speed;
      this.speed = 0;
    }
    this.audio.suspend();
  }

  onVisible(): void {
    if (this.pausedBeforeHidden !== null) this.speed = this.pausedBeforeHidden;
    this.pausedBeforeHidden = null;
    this.audio.resume();
  }

  // ------------------------------------------------------------ time

  setSpeed(s: number): void {
    this.speed = s;
    this.notify();
  }

  togglePause(): void {
    if (this.speed === 0) this.speed = this.lastSpeed || 1;
    else {
      this.lastSpeed = this.speed;
      this.speed = 0;
    }
    this.notify();
  }
  private lastSpeed = 1;

  hitStop(ms: number): void {
    this.hitStopMs = Math.max(this.hitStopMs, ms);
  }

  /** Advance the world by real milliseconds. */
  update(deltaMs: number): void {
    const dtMs = BALANCE.dt * 1000;
    if (this.hitStopMs > 0) {
      this.hitStopMs -= deltaMs;
      return;
    }
    if (this.speed > 0 && !this.sim.collapsed) {
      this.acc += Math.min(deltaMs, 100) * this.speed;
      let steps = 0;
      while (this.acc >= dtMs && steps < 16) {
        this.attract?.update(BALANCE.dt);
        this.sim.tick();
        this.acc -= dtMs;
        steps++;
        const evs = this.sim.events.splice(0);
        this.processEvents(evs, false);
        if (this.hitStopMs > 0) break;
      }
      if (steps >= 16) this.acc = 0;
    }
    this.alpha = Math.min(1, this.acc / dtMs);

    if (this.attract && this.sim.collapsed) {
      this.sim = this.makeAttract();
      this.frameEvents = [];
      this.notify();
    }

    if (this.mode === 'play') {
      this.autosaveMs += deltaMs;
      if (this.autosaveMs > 10_000) {
        this.autosaveMs = 0;
        this.persist();
      }
      this.audio.setIntensity(this.intensity());
    } else {
      this.audio.setIntensity(0);
    }
  }

  private intensity(): number {
    const sim = this.sim;
    if (!sim.heroes.length) return 0;
    const g = sim.grid;
    const mx = g.x(g.maw);
    const my = g.y(g.maw);
    const near = sim.heroes.some((h) => Math.abs(h.x - mx) + Math.abs(h.y - my) <= 4);
    return near || sim.mawHp < sim.mawMaxHp * 0.4 ? 2 : 1;
  }

  // ------------------------------------------------------------ events -> sound and log

  private processEvents(evs: SimEvent[], force: boolean): void {
    if (!evs.length) return;
    this.frameEvents.push(...evs);
    if (this.frameEvents.length > 600) this.frameEvents.splice(0, this.frameEvents.length - 300);
    if (this.attract && !force) return;
    const a = this.audio;
    for (const e of evs) {
      switch (e.t) {
        case 'damage':
          if (!e.burn) a.play(e.on === 'hero' ? 'heroHurt' : 'monsterHurt', { vol: 0.6, gap: 0.06 });
          break;
        case 'heroDied':
          a.play('death', { vol: e.champion ? 1 : 0.7 });
          if (e.champion) {
            this.addLog(`${e.champion} was eaten! +${Math.round(e.gold)} Gold`, 'champ');
            this.setToast(`${e.champion} has been eaten!`, 'champ');
          }
          break;
        case 'monsterDied':
          a.play('monsterDeath', { vol: 0.6 });
          break;
        case 'trap':
          a.play(e.feature === 'spikes' ? 'spikes' : e.feature === 'oil' ? 'oil' : 'fire', { vol: 0.8 });
          break;
        case 'ignite':
          a.play('ignite');
          break;
        case 'status':
          if (e.status === 'sticky') a.play('sticky', { vol: 0.6 });
          break;
        case 'disarm':
          a.play('disarm');
          this.addLog(`A Rogue disarmed your ${FEATURES[this.sim.grid.features[e.tile]?.id ?? 'spikes'].name}.`, 'bad');
          break;
        case 'spotted':
          a.play('spotted', { vol: 0.6 });
          break;
        case 'loot':
          a.play('coin', { pitch: 0.7 });
          this.addLog(`A hero is looting your Hoard (−${Math.round(e.amount)} Gold).`, 'bad');
          break;
        case 'bite':
          a.play('bite');
          if (this.sim.mawHp < this.sim.mawMaxHp * 0.35 && this.sim.time - this.lastAlarm > 4) {
            this.lastAlarm = this.sim.time;
            a.play('alarm');
            this.setToast('The Maw is badly hurt!', 'bad');
          }
          break;
        case 'chomp':
          a.play('chomp');
          break;
        case 'escaped': {
          a.play('escape');
          const loot = e.loot >= 1 ? ` with ${Math.round(e.loot)} Gold` : '';
          const talk = e.rumors > 0 ? ` and is telling the town about ${e.rumors} trap${e.rumors > 1 ? 's' : ''}` : '';
          this.addLog(`A ${HEROES[e.cls].name} escaped${loot}${talk}.`, 'bad');
          break;
        }
        case 'party':
          if (e.champion) {
            a.play('champion');
            this.addLog(`Champion ${e.champion} leads a party of ${e.size}!`, 'champ');
            this.setToast(`${e.champion} approaches!`, 'champ');
          } else {
            a.play('horn', { vol: 0.7 });
            this.addLog(`A party of ${e.size} (Lv ${e.level}) enters the dungeon.`, 'info');
          }
          break;
        case 'heal':
          a.play('heal', { vol: 0.5, gap: 0.2 });
          break;
        case 'unlock':
          a.play('unlock');
          this.addLog(`New: ${FEATURES[e.feature].name} unlocked!`, 'good');
          this.setToast(`Unlocked: ${FEATURES[e.feature].name}`, 'good');
          break;
        case 'respawn':
          a.play('respawn', { vol: 0.4, gap: 0.3 });
          break;
        case 'wipe':
          a.play('wipe');
          this.addLog(`Party wiped out! +${Math.round(e.infamy)} Infamy`, 'good');
          break;
        case 'ambush':
          a.play('ambush');
          this.addLog('Your Mimic ambushed a hero!', 'good');
          break;
        case 'collapse':
          a.play('collapse');
          if (this.mode === 'play' && !this.attract) this.finishRun(force);
          break;
      }
    }
  }

  addLog(text: string, tone: Tone): void {
    const last = this.log[this.log.length - 1];
    if (last && last.text === text && performance.now() - last.at < 4000) return;
    this.log.push({ id: ++this.logId, text, tone, at: performance.now() });
    if (this.log.length > 40) this.log.shift();
  }

  setToast(text: string, tone: Tone): void {
    this.toast = { text, tone, at: performance.now() };
  }

  // ------------------------------------------------------------ player actions

  setTool(tool: Tool): void {
    if (tool !== 'inspect' && tool !== 'dig' && tool !== 'fill' && tool !== 'demolish' && !this.sim.unlocked.has(tool)) {
      this.audio.play('nope');
      this.setToast(`${FEATURES[tool].name} unlocks at ${FEATURES[tool].unlockInfamy} Infamy`, 'bad');
      return;
    }
    this.tool = this.tool === tool && tool !== 'inspect' ? 'inspect' : tool;
    this.audio.play('click');
    this.notify();
  }

  /** What the current tool would do on a tile (for hover previews). */
  check(tile: number): ActionResult {
    const sim = this.sim;
    switch (this.tool) {
      case 'inspect':
        return { ok: true };
      case 'dig':
        return sim.canDig(tile);
      case 'fill':
        return sim.canFill(tile);
      case 'demolish':
        return sim.canDemolish(tile);
      default:
        return sim.canPlace(tile, this.tool);
    }
  }

  useTool(tile: number): ActionResult {
    if (this.mode !== 'play' || this.sim.collapsed) return { ok: false, reason: '' };
    const sim = this.sim;
    let r: ActionResult;
    switch (this.tool) {
      case 'inspect':
        return { ok: true };
      case 'dig':
        r = sim.dig(tile);
        if (r.ok) this.audio.play('dig');
        break;
      case 'fill':
        r = sim.fill(tile);
        if (r.ok) this.audio.play('fill');
        break;
      case 'demolish':
        r = sim.demolish(tile);
        if (r.ok) {
          this.audio.play('demolish');
          if (this.selection?.kind === 'tile' && this.selection.tile === tile) this.selection = null;
        }
        break;
      default:
        if (sim.grid.features[tile]) {
          // Clicking something already built with a build tool selects it instead.
          this.select({ kind: 'tile', tile });
          return { ok: true };
        }
        r = sim.place(tile, this.tool);
        if (r.ok) this.audio.play('build');
    }
    if (!r.ok) this.audio.play('nope', { gap: 0.15 });
    this.notify();
    return r;
  }

  select(sel: Selection): void {
    this.selection = sel;
    if (sel) this.audio.play('click', { vol: 0.6 });
    this.notify();
  }

  upgradeSelected(): ActionResult {
    const sel = this.selection;
    let r: ActionResult = { ok: false, reason: 'Select something you built first' };
    if (sel?.kind === 'tile') r = this.sim.upgrade(sel.tile);
    else if (sel?.kind === 'maw') r = this.sim.upgradeMaw();
    this.audio.play(r.ok ? 'upgrade' : 'nope');
    if (!r.ok && r.reason) this.setToast(r.reason, 'bad');
    this.notify();
    return r;
  }

  upgradeMaw(): ActionResult {
    const r = this.sim.upgradeMaw();
    this.audio.play(r.ok ? 'upgrade' : 'nope');
    if (!r.ok) this.setToast(r.reason, 'bad');
    this.notify();
    return r;
  }

  demolishSelected(): void {
    const sel = this.selection;
    if (sel?.kind !== 'tile') return;
    const r = this.sim.demolish(sel.tile);
    this.audio.play(r.ok ? 'demolish' : 'nope');
    if (r.ok) this.selection = null;
    this.notify();
  }

  setVolume(kind: 'sfx' | 'music', v: number): void {
    this.save.settings[kind] = v;
    this.audio.setVolumes(this.save.settings.sfx, this.save.settings.music);
    writeStore(this.store, this.save);
  }

  toggleRoutes(): void {
    this.save.settings.routes = !this.save.settings.routes;
    this.audio.play('click');
    writeStore(this.store, this.save);
    this.notify();
  }
}
