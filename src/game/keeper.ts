import type { Audio } from '../audio/audio';
import { Bot } from '../sim/bot';
import { BALANCE, HEROES, ROOMS, ROOM_ORDER, teethForRun, type RoomId } from '../sim/content';
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

export type Mode = 'title' | 'play' | 'collapsed';
export type Selection =
  | { kind: 'room'; site: number }
  | { kind: 'empty'; site: number }
  | { kind: 'hero'; id: number }
  | { kind: 'monster'; id: number }
  | { kind: 'corridor'; edge: number }
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

/** What the pointer is over, for the cursor tooltip. */
export interface Hover {
  text: string;
  bad: boolean;
  sx: number;
  sy: number;
}

const COLLAPSE_SCREEN_DELAY = 2800;

/**
 * The game's conductor: owns the current Sim, the save file, the selection and the speed.
 * The renderer and the HUD both read from it.
 */
export class Keeper {
  save: SaveFile;
  sim: Sim;
  mode: Mode = 'title';
  speed = 1;
  selection: Selection = null;
  /** Screen position of the click that opened the catalog. */
  catalogAt: { sx: number; sy: number } | null = null;
  log: LogLine[] = [];
  frameEvents: SimEvent[] = [];
  alpha = 0;
  offlineReport: OfflineGains | null = null;
  result: RunResult | null = null;
  collapseAt: number | null = null;
  toast: { text: string; tone: Tone; at: number } | null = null;
  hover: Hover | null = null;

  private attract: Bot | null = null;
  private acc = 0;
  private hitStopMs = 0;
  private autosaveMs = 0;
  private logId = 0;
  private lastAlarm = -99;
  private lastSpeed = 1;
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
    if (this.save.migratedTeeth !== undefined) writeStore(store, this.save);
  }

  get hasRun(): boolean {
    return this.save.run !== null;
  }

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
    for (let k = 0; k < (6 * 60) / BALANCE.dt; k++) {
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
    this.selection = null;
    this.catalogAt = null;
    this.log = [];
    this.result = null;
    this.collapseAt = null;
    this.offlineReport = null;
    this.frameEvents = [];
    this.addLog('You wake up hungry. Build rooms along the tunnel and wait for dinner.', 'info');
    this.persist();
    this.notify();
  }

  continueRun(): void {
    if (!this.save.run) return this.newRun();
    this.attract = null;
    this.mode = 'play';
    this.speed = 1;
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
    this.result = { minutes: sim.minutes, eaten: sim.eaten, escaped: sim.escaped, infamy: sim.infamy, champions: sim.champions, teeth, newBest, voluntary };
    this.save.run = null;
    this.collapseAt = performance.now();
    this.selection = null;
    writeStore(this.store, this.save);
  }

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

  clearMigrationNote(): void {
    delete this.save.migratedTeeth;
    writeStore(this.store, this.save);
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

  hitStop(ms: number): void {
    this.hitStopMs = Math.max(this.hitStopMs, ms);
  }

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
        this.processEvents(this.sim.events.splice(0), false);
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
    } else this.audio.setIntensity(0);
  }

  private intensity(): number {
    const sim = this.sim;
    if (!sim.parties.length) return 0;
    const maw = sim.site(sim.cave.maw);
    const near = sim.parties.some((p) => Math.hypot(p.x - maw.x, p.y - maw.y) < 14);
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
          if (!e.dot) a.play(e.on === 'hero' ? 'heroHurt' : 'monsterHurt', { vol: 0.6, gap: 0.06 });
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
        case 'monsterDown':
          a.play('monsterDeath', { vol: 0.4, pitch: 1.4 });
          break;
        case 'monsterUp':
          a.play('respawn', { vol: 0.5, pitch: 0.7 });
          break;
        case 'trap':
          a.play(e.room === 'spikeHall' ? 'spikes' : e.room === 'oilCellar' ? 'oil' : e.room === 'pitDrop' ? 'fill' : 'fire', { vol: 0.8 });
          break;
        case 'ignite':
          a.play('ignite');
          break;
        case 'status':
          if (e.status === 'sticky') a.play('sticky', { vol: 0.6 });
          break;
        case 'disarm':
          a.play('disarm');
          this.addLog(`A Rogue disarmed your ${ROOMS[this.sim.rooms.get(e.site)?.id ?? 'spikeHall'].name}.`, 'bad');
          break;
        case 'spotted':
          a.play('spotted', { vol: 0.5 });
          break;
        case 'loot':
          a.play('coin', { pitch: 0.7 });
          this.addLog(`A hero is looting your Vault (−${Math.round(e.amount)} Gold).`, 'bad');
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
          const talk = e.rumors > 0 ? ` and is telling the town about ${e.rumors} room${e.rumors > 1 ? 's' : ''}` : '';
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
        case 'unlock': {
          a.play('unlock');
          const names = ROOM_ORDER.filter((id) => ROOMS[id].tier === e.tier && this.sim.isUnlocked(id)).map((id) => ROOMS[id].name);
          this.addLog(`New rooms in the catalog: ${names.join(', ')}.`, 'good');
          this.setToast('New rooms unlocked!', 'good');
          break;
        }
        case 'respawn':
          a.play('respawn', { vol: 0.35, gap: 0.3 });
          break;
        case 'wipe':
          a.play('wipe');
          this.addLog(`Party wiped out! +${Math.round(e.infamy)} Infamy`, 'good');
          break;
        case 'ambush':
          a.play('ambush');
          this.addLog('Your Mimic ambushed a hero!', 'good');
          break;
        case 'fall':
          a.play(e.eaten ? 'chomp' : 'heroHurt');
          if (e.eaten) this.addLog('A hero fell through the Pit Drop straight into your Gullet.', 'good');
          break;
        case 'split':
          if (e.reason === 'loot') this.addLog('A Rogue slipped away from its party to raid your Vault.', 'info');
          break;
        case 'excavated':
          a.play('dig');
          a.play('fill', { pitch: 0.8 });
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

  private result_(r: ActionResult, okSound: string): ActionResult {
    if (r.ok) this.audio.play(okSound);
    else {
      this.audio.play('nope', { gap: 0.15 });
      if (r.reason) this.setToast(r.reason, 'bad');
    }
    this.notify();
    return r;
  }

  select(sel: Selection, at?: { sx: number; sy: number }): void {
    this.selection = sel;
    this.catalogAt = sel?.kind === 'empty' ? (at ?? { sx: window.innerWidth / 2, sy: window.innerHeight / 2 }) : null;
    if (sel) this.audio.play('click', { vol: 0.6 });
    this.notify();
  }

  buildRoom(site: number, id: RoomId): ActionResult {
    const r = this.result_(this.sim.build(site, id), 'build');
    if (r.ok) this.select({ kind: 'room', site });
    return r;
  }

  sellRoom(site: number): ActionResult {
    const r = this.result_(this.sim.sell(site), 'demolish');
    if (r.ok) this.select({ kind: 'empty', site }, this.catalogAt ?? undefined);
    return r;
  }

  upgradeTrack(site: number, track: number): ActionResult {
    return this.result_(this.sim.upgrade(site, track), 'upgrade');
  }

  digEdge(edge: number): ActionResult {
    return this.result_(this.sim.dig(edge), 'dig');
  }

  digBetween(a: number, b: number): ActionResult {
    const e = this.sim.edgeBetween(a, b);
    if (!e) return this.result_({ ok: false, reason: 'Those rooms are too far apart to join' }, 'dig');
    return this.digEdge(e.id);
  }

  fillEdge(edge: number): ActionResult {
    const r = this.result_(this.sim.fill(edge), 'fill');
    if (r.ok) this.selection = null;
    return r;
  }

  excavate(region: number): ActionResult {
    return this.result_(this.sim.excavate(region), 'unlock');
  }

  upgradeMaw(): ActionResult {
    return this.result_(this.sim.upgradeMaw(), 'upgrade');
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
