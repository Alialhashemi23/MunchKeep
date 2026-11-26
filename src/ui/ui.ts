import type { Bank } from '../game/art/bank';
import { roomPreview, type RoomLook } from '../game/art/topdown';
import type { Keeper } from '../game/keeper';
import {
  BALANCE,
  BLUEPRINT_ORDER,
  HEROES,
  MONSTERS,
  ROOMS,
  ROOM_ORDER,
  UPGRADES,
  UPGRADE_ORDER,
  type Cost,
  type RoomId,
  type RoomKind,
} from '../sim/content';
import { buyUpgrade, nextUpgradeCost, upgradeLevel } from '../sim/meta';
import { exportCode, importCode } from '../sim/save';
import type { Room, Sim } from '../sim/sim';

const KIND_LABEL: Record<RoomKind, string> = { monster: 'Monster room', trap: 'Trap room', lure: 'Lure', support: 'Support room', economy: 'Economy room' };
const TIER_LABEL = ['Basics', 'Second tier', 'Third tier', 'Fourth tier'];

interface Hint {
  text: string;
  done: (sim: Sim) => boolean;
}

const HINTS: Hint[] = [
  {
    text: 'Heroes walk the dotted lines from the Gate to your Maw. <b>Click an empty site</b> on their path and build a Goblin Warren.',
    done: (sim) => [...sim.rooms.values()].some((r) => ROOMS[r.id].kind === 'monster'),
  },
  {
    text: 'Add a <b>Spike Hall</b> on the path too. Traps hit a party while it crosses the room.',
    done: (sim) => [...sim.rooms.values()].some((r) => ROOMS[r.id].kind === 'trap'),
  },
  {
    text: '<b>Click a room</b> to upgrade it. Every room has three upgrade tracks to spend on however you like.',
    done: (sim) => [...sim.rooms.values()].some((r) => r.ranks.some((x) => x > 0)),
  },
  {
    text: '<b>Drag from one room to another</b> to dig a corridor (or click a dotted line). A longer route takes heroes through more of your rooms.',
    done: (sim) => sim.dug.size > sim.cave.startRoute.length - 1,
  },
  {
    text: 'Spend Essence to <b>excavate</b> a dark area and find more room sites. Essence drips from every hero you eat.',
    done: (sim) => sim.excavated.size > 1,
  },
  {
    text: 'A <b>Treasure Vault</b> just off the path lures greedy heroes. Rogues even sneak away from their party to raid it.',
    done: (sim) => [...sim.rooms.values()].some((r) => r.id === 'vault'),
  },
];

function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function n0(v: number): string {
  return Math.floor(v).toLocaleString('en-US');
}

function scaled(src: HTMLCanvasElement, s: number, crop?: [number, number, number, number]): string {
  const [cx, cy, cw, ch] = crop ?? [0, 0, src.width, src.height];
  const c = document.createElement('canvas');
  c.width = cw * s;
  c.height = ch * s;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, cx, cy, cw, ch, 0, 0, cw * s, ch * s);
  return c.toDataURL();
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

export class Ui {
  private hud = document.getElementById('hud')!;
  private screens = document.getElementById('screens')!;
  private icons = new Map<string, string>();
  private refs: Record<string, HTMLElement> = {};
  private modal: null | 'help' | 'settings' | 'offline' | 'confirm' | 'migrated' = null;
  private confirmState: { text: string; yes: string; onYes: () => void } | null = null;
  private subscreen: null | 'teeth' = null;
  private renderedScreen = '';
  private hintsOff = false;
  private pausedForModal: number | null = null;
  private lastPanel = '';
  private lastCatalog = '';
  private lastFeed = '';

  constructor(
    private k: Keeper,
    bank: Bank,
  ) {
    this.makeIcons(bank);
    this.buildHud();
    k.onChange(() => this.onChange());
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('pointerdown', () => k.audio.unlock(), { capture: true });
    if (k.save.migratedTeeth !== undefined) this.modal = 'migrated';
    else if (k.offlineReport) this.modal = 'offline';
    this.onChange();
    window.setInterval(() => this.tick(), 100);
  }

  // ------------------------------------------------------------ icons

  private makeIcons(bank: Bank): void {
    const put = (name: string, url: string) => this.icons.set(name, url);
    for (const id of [...ROOM_ORDER, 'maw', 'gate', 'empty'] as RoomLook[]) put(`room:${id}`, scaled(roomPreview(bank, id), 1, [8, 12, 96, 72]));
    put('coin', scaled(bank.get('icon:coin')!, 2));
    put('essence', scaled(bank.get('icon:essence')!, 2));
    put('skull', scaled(bank.get('icon:skull')!, 2));
    put('tooth', scaled(bank.get('icon:tooth')!, 2));
    put('toothBig', scaled(bank.get('icon:tooth')!, 4));
    put('maw', scaled(bank.get('maw:1')!, 1));
  }

  private img(name: string, cls = ''): string {
    return `<img class="px ${cls}" src="${this.icons.get(name)}" alt="">`;
  }

  private cost(c: Cost, sim?: Sim): string {
    const poorG = sim && sim.gold < c.gold;
    const poorE = sim && sim.essence < c.essence;
    let out = `<span class="${poorG ? 'poor' : 'gold'}">${this.img('coin', 'ci')}${c.gold}</span>`;
    if (c.essence) out += ` <span class="${poorE ? 'poor' : 'ess'}">${this.img('essence', 'ci')}${c.essence}</span>`;
    return out;
  }

  // ------------------------------------------------------------ HUD skeleton

  private buildHud(): void {
    this.hud.innerHTML = `
      <div class="res panel">
        <div class="res-row gold">${this.img('coin')}<span class="val" data-r="gold">0</span><span class="sub" data-r="income"></span></div>
        <div class="res-row ess">${this.img('essence')}<span class="val" data-r="essence">0</span><span class="sub">Essence</span></div>
        <div class="res-row infamy">${this.img('skull')}<span class="val" data-r="infamy">0</span><span class="sub">Infamy</span></div>
        <div class="meter"><i data-r="infMeter" style="width:0"></i></div>
        <div class="next" data-r="infNext"></div>
        <div class="clock"><span data-r="clock">0:00</span><span data-r="eaten">0 eaten</span></div>
      </div>
      <div class="mawbar panel">
        <div class="label"><span><b>The Maw</b> <span data-r="mawLvl"></span></span><span data-r="mawHp"></span></div>
        <div class="hpbar" data-r="mawBar"><i data-r="mawFill" style="width:100%"></i></div>
        <div class="waves"><span data-r="wave"></span><span class="champ" data-r="champ"></span></div>
      </div>
      <div class="topright panel">
        <button class="btn" data-speed="0" title="Pause (Space)">II</button>
        <button class="btn" data-speed="1" title="Normal speed">1x</button>
        <button class="btn" data-speed="2" title="Fast">2x</button>
        <button class="btn" data-speed="3" title="Faster">3x</button>
        <button class="btn" data-act="routes" title="Show hero routes (R)">Routes</button>
        <button class="btn" data-act="help" title="How to play (H)">?</button>
        <button class="btn" data-act="settings" title="Menu (Esc)">Menu</button>
      </div>
      <div class="toast panel" data-r="toast" style="opacity:0"></div>
      <div class="feed" data-r="feed"></div>
      <div class="hint panel" data-r="hint" hidden><span data-r="hintText"></span><span class="x" data-act="hideHints" title="Hide tips">✕</span></div>
      <div class="side panel" data-r="panel" hidden></div>
      <div class="catalog panel" data-r="catalog" hidden></div>
      <div class="bottombar panel">
        <span class="small">Click an empty site to build · Drag between rooms to dig · Right-drag to pan</span>
        <button class="btn gold" data-act="feedMaw" title="Feed the Maw (M)">${this.img('maw', 'mawicon')} Feed the Maw <span data-r="mawCost"></span></button>
      </div>
      <div class="cursortip" data-r="ctip" hidden></div>
    `;
    this.hud.querySelectorAll<HTMLElement>('[data-r]').forEach((el) => (this.refs[el.dataset.r!] = el));
    this.hud.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const sp = t.closest<HTMLElement>('[data-speed]');
      if (sp) {
        this.k.setSpeed(Number(sp.dataset.speed));
        this.k.audio.play('click');
        return;
      }
      const el = t.closest<HTMLElement>('[data-act]');
      if (el) this.action(el.dataset.act!, el);
    });
  }

  // ------------------------------------------------------------ actions

  private action(act: string, el?: HTMLElement): void {
    const k = this.k;
    const sel = k.selection;
    switch (act) {
      case 'routes':
        k.toggleRoutes();
        break;
      case 'help':
        this.openModal('help');
        break;
      case 'settings':
        this.openModal('settings');
        break;
      case 'hideHints':
        this.hintsOff = true;
        this.refs.hint.hidden = true;
        break;
      case 'feedMaw':
        k.upgradeMaw();
        this.lastPanel = '';
        break;
      case 'build':
        if (sel?.kind === 'empty' && el?.dataset.room) k.buildRoom(sel.site, el.dataset.room as RoomId);
        this.lastPanel = this.lastCatalog = '';
        break;
      case 'track':
        if (sel?.kind === 'room' && el?.dataset.track) k.upgradeTrack(sel.site, Number(el.dataset.track));
        this.lastPanel = '';
        break;
      case 'sell':
        if (sel?.kind === 'room') this.confirm(`Sell this ${ROOMS[k.sim.rooms.get(sel.site)!.id].name}? You get half of what you spent back.`, 'Sell it', () => k.sellRoom(sel.site));
        break;
      case 'fill':
        if (sel?.kind === 'corridor') k.fillEdge(sel.edge);
        this.lastPanel = '';
        break;
      case 'deselect':
        k.select(null);
        break;
      case 'continue':
        k.continueRun();
        break;
      case 'new':
        if (k.hasRun && k.mode === 'title') {
          this.confirm('Abandon this dungeon? It collapses now and pays out its Teeth.', 'Collapse it', () => {
            k.continueRun();
            k.collapseNow();
          });
        } else {
          this.subscreen = null;
          k.newRun();
        }
        break;
      case 'teeth':
        this.subscreen = 'teeth';
        k.audio.play('click');
        this.renderScreen(true);
        break;
      case 'back':
        this.subscreen = null;
        k.audio.play('click');
        this.renderScreen(true);
        break;
      case 'title':
        this.closeModal();
        k.toTitle();
        break;
      case 'collapseNow':
        this.confirm('Collapse this dungeon now? You keep the Teeth it has earned so far.', 'Collapse', () => k.collapseNow());
        break;
      case 'erase':
        this.confirm('Erase all progress, including Teeth and upgrades? This cannot be undone.', 'Erase everything', () => k.resetEverything());
        break;
      case 'close':
        this.closeModal();
        break;
    }
  }

  private confirm(text: string, yes: string, onYes: () => void): void {
    this.confirmState = { text, yes, onYes };
    this.openModal('confirm');
  }

  private openModal(m: NonNullable<Ui['modal']>): void {
    this.modal = m;
    this.k.audio.play('click');
    if (this.k.mode === 'play' && this.k.speed > 0 && m !== 'confirm') {
      this.pausedForModal = this.k.speed;
      this.k.setSpeed(0);
    }
    this.renderScreen(true);
  }

  private closeModal(): void {
    if (this.modal === 'offline') this.k.offlineReport = null;
    if (this.modal === 'migrated') {
      this.k.clearMigrationNote();
      if (this.k.offlineReport) {
        this.modal = 'offline';
        this.renderScreen(true);
        return;
      }
    }
    this.modal = null;
    this.confirmState = null;
    if (this.pausedForModal !== null && this.k.mode === 'play') this.k.setSpeed(this.pausedForModal);
    this.pausedForModal = null;
    this.renderScreen(true);
  }

  // ------------------------------------------------------------ keyboard

  private onKey(e: KeyboardEvent): void {
    const k = this.k;
    k.audio.unlock();
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const key = e.key;
    if (this.modal) {
      if (key === 'Escape') {
        e.preventDefault();
        this.closeModal();
      }
      return;
    }
    if (k.mode === 'title') {
      if (key === 'Enter') this.action(k.hasRun ? 'continue' : 'new');
      return;
    }
    if (k.mode !== 'play') return;
    const sel = k.selection;
    if (sel?.kind === 'room' && '123'.includes(key)) {
      k.upgradeTrack(sel.site, Number(key) - 1);
      this.lastPanel = '';
      return;
    }
    switch (key.toLowerCase()) {
      case 'm':
        k.upgradeMaw();
        break;
      case 'r':
        k.toggleRoutes();
        break;
      case 'h':
      case '?':
        this.openModal('help');
        break;
      case 't':
        k.setSpeed(k.speed >= 3 ? 1 : k.speed + 1);
        break;
      case ' ':
        e.preventDefault();
        k.togglePause();
        break;
      case 'escape':
        if (k.selection) k.select(null);
        else this.openModal('settings');
        break;
    }
  }

  // ------------------------------------------------------------ change + tick

  private onChange(): void {
    const k = this.k;
    this.hud.hidden = k.mode !== 'play';
    document.getElementById('boot')?.remove();
    this.hud.querySelectorAll<HTMLElement>('[data-speed]').forEach((b) => b.classList.toggle('on', Number(b.dataset.speed) === k.speed));
    this.hud.querySelector('[data-act="routes"]')?.classList.toggle('on', k.save.settings.routes);
    this.lastPanel = this.lastCatalog = '';
    this.renderScreen(false);
    this.tick();
  }

  private tick(): void {
    const k = this.k;
    if (k.collapseScreenDue) k.showCollapseScreen();
    if (k.mode !== 'play') return;
    const sim = k.sim;
    const r = this.refs;

    r.gold.textContent = n0(sim.gold);
    const inc = sim.minutes > 0.5 ? sim.goldFromKills / sim.minutes : 0;
    r.income.textContent = inc > 0 ? `+${n0(inc)}/min` : '';
    r.essence.textContent = sim.essence < 100 ? sim.essence.toFixed(0) : n0(sim.essence);
    r.infamy.textContent = n0(sim.infamy);
    const next = sim.nextTier();
    if (next) {
      const prevAt = BALANCE.tierInfamy[sim.tier];
      r.infMeter.style.width = `${Math.min(100, ((sim.infamy - prevAt) / Math.max(1, next.infamy - prevAt)) * 100)}%`;
      r.infNext.textContent = `More rooms at ${next.infamy} Infamy`;
    } else {
      r.infMeter.style.width = '100%';
      r.infNext.textContent = 'Every room unlocked';
    }
    r.clock.textContent = `Survived ${fmtTime(sim.time)}`;
    r.eaten.textContent = `${sim.eaten} eaten`;
    r.mawLvl.textContent = `Lv ${sim.mawLevel}`;
    r.mawHp.textContent = `${Math.ceil(sim.mawHp)} / ${sim.mawMaxHp}`;
    const hpFrac = sim.mawHp / sim.mawMaxHp;
    r.mawFill.style.width = `${Math.max(0, hpFrac * 100)}%`;
    r.mawBar.classList.toggle('low', hpFrac < 0.35);
    const inside = sim.livingHeroes;
    r.wave.textContent = inside > 0 ? `${inside} hero${inside > 1 ? 'es' : ''} inside · next ${fmtTime(sim.nextPartyIn)}` : `Next party in ${fmtTime(sim.nextPartyIn)} · ${sim.threatLabel()}`;
    r.champ.textContent = `Champion ${fmtTime(sim.nextChampionAt - sim.time)}`;
    const mc = sim.mawUpgradeCost();
    r.mawCost.innerHTML = mc === null ? 'MAX' : this.cost({ gold: mc, essence: 0 }, sim);

    const toast = k.toast;
    if (toast && performance.now() - toast.at < 2600) {
      r.toast.textContent = toast.text;
      r.toast.className = `toast panel ${toast.tone}`;
      r.toast.style.opacity = '1';
    } else r.toast.style.opacity = '0';

    const now = performance.now();
    const lines = k.log.slice(-6);
    const feedKey = lines.map((l) => l.id).join(',') + Math.floor(now / 1000);
    if (feedKey !== this.lastFeed) {
      this.lastFeed = feedKey;
      r.feed.innerHTML = lines
        .map((l) => {
          const age = (now - l.at) / 1000;
          const op = age < 10 ? 1 : Math.max(0, 1 - (age - 10) / 6);
          return op > 0 ? `<div class="${l.tone}" style="opacity:${op.toFixed(2)}">${esc(l.text)}</div>` : '';
        })
        .join('');
    }

    if (!this.hintsOff && k.save.meta.runs < 3) {
      const hint = HINTS.find((h) => !h.done(sim));
      r.hint.hidden = !hint;
      if (hint && r.hintText.innerHTML !== hint.text) r.hintText.innerHTML = hint.text;
    } else r.hint.hidden = true;

    const hv = k.hover;
    if (hv) {
      r.ctip.hidden = false;
      r.ctip.textContent = hv.text;
      r.ctip.classList.toggle('bad', hv.bad);
      r.ctip.style.left = `${hv.sx + 18}px`;
      r.ctip.style.top = `${hv.sy + 18}px`;
    } else r.ctip.hidden = true;

    this.renderCatalog();
    this.renderPanel();
  }

  // ------------------------------------------------------------ catalog

  private renderCatalog(): void {
    const k = this.k;
    const sim = k.sim;
    const el = this.refs.catalog;
    const sel = k.selection;
    if (sel?.kind !== 'empty') {
      el.hidden = true;
      this.lastCatalog = '';
      return;
    }
    const tiers: string[] = [];
    for (let t = 0; t < BALANCE.tierInfamy.length; t++) {
      const ids = ROOM_ORDER.filter((id) => ROOMS[id].tier === t);
      const rows = ids
        .map((id) => {
          const def = ROOMS[id];
          const bp = def.blueprint && !sim.mods.blueprints.has(id);
          if (bp) return '';
          const locked = !sim.isUnlocked(id);
          const c = sim.roomCost(id);
          const can = sim.canBuild(sel.site, id).ok;
          return `<button class="entry ${locked ? 'locked' : ''} ${can ? '' : 'cant'}" data-act="build" data-room="${id}" ${locked ? 'disabled' : ''}>
            ${this.img(`room:${id}`, 'thumb')}
            <span class="info"><b>${def.name}</b><span class="tag ${def.kind}">${KIND_LABEL[def.kind]}</span><span class="blurb">${def.blurb}</span></span>
            <span class="price">${locked ? `<span class="lock">${BALANCE.tierInfamy[t]} Infamy</span>` : this.cost(c, sim)}</span>
          </button>`;
        })
        .join('');
      if (rows) tiers.push(`<div class="tier"><h5>${TIER_LABEL[t]}${t > sim.tier ? ` · unlocks at ${BALANCE.tierInfamy[t]} Infamy` : ''}</h5>${rows}</div>`);
    }
    const html = `<div class="cat-head"><h3>Build a room</h3><button class="close" data-act="deselect" title="Close">✕</button></div><div class="cat-list">${tiers.join('')}</div>`;
    const key = html + sim.tier;
    if (key !== this.lastCatalog) {
      const scroll = el.querySelector('.cat-list')?.scrollTop ?? 0;
      el.innerHTML = html;
      const list = el.querySelector('.cat-list');
      if (list) list.scrollTop = scroll;
      this.lastCatalog = key;
    }
    el.hidden = false;
    const at = k.catalogAt ?? { sx: window.innerWidth / 2, sy: window.innerHeight / 2 };
    const w = el.offsetWidth || 420;
    const h = el.offsetHeight || 520;
    const left = at.sx + 24 + w < window.innerWidth - 12 ? at.sx + 24 : Math.max(12, at.sx - w - 24);
    const top = Math.max(80, Math.min(window.innerHeight - h - 12, at.sy - h / 2));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }

  // ------------------------------------------------------------ side panel

  private renderPanel(): void {
    const html = this.panelHtml();
    const el = this.refs.panel;
    if (!html) {
      el.hidden = true;
      this.lastPanel = '';
      return;
    }
    el.hidden = false;
    if (html !== this.lastPanel) {
      this.lastPanel = html;
      el.innerHTML = html;
    }
  }

  private roomLines(sim: Sim, r: Room): { stats: [string, string][]; links: string[] } {
    const def = ROOMS[r.id];
    const stats: [string, string][] = [];
    const links: string[] = [];
    const yes = (ok: boolean, a: string, b: string) => `<div class="${ok ? 'yes' : 'no'}">${ok ? '✓ ' + a : '· ' + b}</div>`;
    const linked = (id: RoomId) => sim.linkedRooms(r.site, id).length > 0;
    if (def.monster) {
      const m = MONSTERS[def.monster];
      const standing = sim.standing(r.site).length;
      stats.push([`${m.name}s`, `${standing} / ${r.slots.length}`]);
      const sample = sim.monsters.find((x) => x.site === r.site);
      if (sample) {
        stats.push(['HP', n0(sample.maxHp)]);
        stats.push(['Damage', sim.monsterDamage(sample).toFixed(1)]);
      }
      const waiting = r.slots.filter((s) => s.monsterId === null).map((s) => s.respawn);
      stats.push(['Respawn', waiting.length ? `next in ${Math.ceil(Math.min(...waiting))}s` : `${def.respawn}s`]);
      links.push(yes(linked('larder'), 'Fed by a linked Larder', 'Link a Larder to respawn faster'));
      if (r.id === 'mimicVault') links.push(sim.rumors.has(r.site) ? '<div class="warn">! The town knows it is a Mimic</div>' : '<div class="yes">✓ Heroes think it is treasure</div>');
    } else if (def.kind === 'trap') {
      if (r.id === 'spikeHall') {
        stats.push(['Stab', (14 * (1 + 0.4 * r.ranks[0])).toFixed(0)]);
        stats.push(['Every', `${(1.5 * (1 - 0.2 * r.ranks[1])).toFixed(2)}s`]);
      }
      if (r.id === 'flameGallery') {
        stats.push(['Burst', (9 * (1 + 0.35 * r.ranks[0])).toFixed(0)]);
        stats.push(['Every', `${(2.2 * (1 - 0.18 * r.ranks[1])).toFixed(2)}s`]);
      }
      if (r.id === 'oilCellar') stats.push(['Oily for', `${BALANCE.oilySeconds + 4 * r.ranks[0]}s`]);
      if (r.id === 'pitDrop') stats.push(['Fall chance', `${Math.round((0.2 + 0.1 * r.ranks[0]) * 100)}%`]);
      links.push(yes(linked('gloomHall'), 'Hidden by a linked Gloom Hall', 'Link a Gloom Hall to stop Rogues disarming it'));
      if (r.id === 'pitDrop') links.push(yes(linked('gullet'), 'Drops heroes into a linked Gullet', 'Link a Gullet to eat fallen heroes outright'));
      if (sim.rumors.has(r.site)) links.push('<div class="warn">! Heroes have heard about this room</div>');
    } else {
      const neighbors = sim.linked(r.site).map((n) => sim.rooms.get(n)).filter(Boolean) as Room[];
      const count = (kind: RoomKind) => neighbors.filter((n) => ROOMS[n.id].kind === kind).length;
      if (r.id === 'larder') links.push(`<div class="${count('monster') ? 'yes' : 'no'}">Feeding ${count('monster')} linked monster room(s)</div>`);
      if (r.id === 'gloomHall') links.push(`<div class="${count('trap') ? 'yes' : 'no'}">Hiding ${count('trap')} linked trap room(s)</div>`);
      if (r.id === 'gullet') links.push(`<div class="${neighbors.length ? 'yes' : 'no'}">Digesting for ${neighbors.length} linked room(s)</div>`);
      if (r.id === 'soulWell') stats.push(['Essence', `+${(0.2 + 0.15 * r.ranks[0]).toFixed(2)}/s`]);
      if (r.id === 'vault') stats.push(['Looting takes', `${BALANCE.lootSeconds + 1.5 * r.ranks[1]}s`]);
    }
    return { stats, links };
  }

  private panelHtml(): string | null {
    const k = this.k;
    const sim = k.sim;
    const sel = k.selection;
    if (!sel || sel.kind === 'empty') return null;
    const close = '<button class="close" data-act="deselect" title="Close">✕</button>';
    const dl = (rows: [string, string][]) => (rows.length ? `<dl class="stats">${rows.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('')}</dl>` : '');

    if (sel.kind === 'maw') {
      const c = sim.mawUpgradeCost();
      return `${close}<h3>The Maw <small>Lv ${sim.mawLevel}</small></h3>
        <div class="tag">Your mouth, your heart</div>
        ${dl([
          ['HP', `${Math.ceil(sim.mawHp)} / ${sim.mawMaxHp}`],
          ['Chomp', `${Math.round(sim.mawChompDamage)} dmg`],
          ['Regrows', `${BALANCE.mawRegen} HP/s when safe`],
        ])}
        <p class="small">Heroes who reach the Maw bite it ${BALANCE.bitesBeforeFlee} times, steal Gold, then run home. If its HP hits zero, the dungeon collapses.</p>
        <button class="btn gold wide" data-act="feedMaw" ${c === null || sim.gold < c ? 'disabled' : ''}>${c === null ? 'Fully grown' : `Feed · ${this.cost({ gold: c, essence: 0 }, sim)}`}</button>`;
    }

    if (sel.kind === 'room') {
      const r = sim.rooms.get(sel.site);
      if (!r) return null;
      const def = ROOMS[r.id];
      const { stats, links } = this.roomLines(sim, r);
      const tracks = def.tracks
        .map((t, i) => {
          const rank = r.ranks[i];
          const c = sim.upgradeCost(sel.site, i);
          const pips = [0, 1, 2].map((j) => `<i class="${j < rank ? 'on' : ''}"></i>`).join('');
          const can = c !== null && sim.gold >= c.gold && sim.essence >= c.essence;
          return `<div class="track">
            <div class="track-head"><b>${t.name}</b><span class="pips">${pips}</span></div>
            <div class="track-now">${rank ? t.desc(rank) : '<span class="no">Not upgraded</span>'}</div>
            ${c ? `<button class="btn ${can ? 'gold' : ''} wide" data-act="track" data-track="${i}" ${can ? '' : 'disabled'} title="Key ${i + 1}">${i + 1} · ${t.desc(rank + 1)} · ${this.cost(c, sim)}</button>` : '<div class="gold small">Maxed</div>'}
          </div>`;
        })
        .join('');
      const refund = `${Math.floor(r.invested.gold * BALANCE.sellRefund)}${r.invested.essence ? ` + ${Math.floor(r.invested.essence * BALANCE.sellRefund)} Essence` : ''}`;
      return `${close}<div class="room-head">${this.img(`room:${r.id}`, 'thumb')}<div><h3>${def.name}</h3><div class="tag ${def.kind}">${KIND_LABEL[def.kind]}</div></div></div>
        <p class="small">${def.blurb}</p>
        <p class="small syn">${def.synergy}</p>
        ${dl(stats)}
        ${links.join('')}
        <div class="tracks">${tracks}</div>
        <button class="btn danger wide" data-act="sell">Sell · +${refund} Gold</button>`;
    }

    if (sel.kind === 'corridor') {
      const e = sim.cave.edges[sel.edge];
      const name = (s: number) => {
        const site = sim.site(s);
        if (site.kind === 'gate') return 'the Gate';
        if (site.kind === 'maw') return 'the Maw';
        return sim.rooms.has(s) ? ROOMS[sim.rooms.get(s)!.id].name : 'an empty site';
      };
      const can = sim.canFill(sel.edge);
      return `${close}<h3>Corridor</h3>
        <div class="tag">${Math.round(e.len)} tiles long</div>
        <p class="small">Joins ${name(e.a)} and ${name(e.b)}. Rooms joined by a corridor are linked, so support rooms affect each other through it.</p>
        <button class="btn danger wide" data-act="fill" ${can.ok ? '' : 'disabled'}>Fill it in · +${Math.floor(sim.corridorCost(sel.edge) * BALANCE.sellRefund)} Gold</button>
        ${can.ok ? '' : `<p class="small warn">${esc((can as { reason: string }).reason)}</p>`}`;
    }

    if (sel.kind === 'hero') {
      const party = sim.parties.find((p) => p.members.some((h) => h.id === sel.id));
      const h = party?.members.find((x) => x.id === sel.id);
      if (!party || !h) return null;
      const def = HEROES[h.cls];
      let intent = party.goal === 'flee' ? (h.loot >= 1 ? `Running home with ${n0(h.loot)} Gold` : 'Running home') : party.goal === 'loot' ? 'Heading for treasure' : 'Heading for the Maw';
      if (party.state === 'fight') intent = 'Fighting';
      if (party.state === 'loot') intent = 'Looting your Vault!';
      if (party.state === 'bite') intent = 'Biting the Maw!';
      const st: string[] = [];
      if (h.sticky > 0) st.push('Sticky');
      if (h.oily > 0) st.push('Oily');
      if (h.burning > 0) st.push('Burning');
      if (h.poison > 0) st.push('Poisoned');
      if (h.bleed > 0) st.push('Bleeding');
      if (h.cursed > 0) st.push('Cursed');
      let knows = 0;
      for (const [s, id] of party.known) if (sim.rooms.get(s)?.id === id && ROOMS[id].kind !== 'lure') knows++;
      return `${close}<h3>${h.champion ? esc(h.champion) : def.name} <small>Lv ${h.level}</small></h3>
        <div class="tag">${h.champion ? `Champion ${def.name}` : 'Hero'} · party of ${party.members.length}</div>
        ${dl([
          ['HP', `${Math.ceil(h.hp)} / ${Math.ceil(h.maxHp)}`],
          ['Damage', h.dmg.toFixed(1)],
          ['Doing', intent],
          ...(st.length ? ([['Status', st.join(', ')]] as [string, string][]) : []),
          ...(h.loot >= 1 ? ([['Carrying', `${n0(h.loot)} Gold`]] as [string, string][]) : []),
          ['Knows', `${knows} of your rooms`],
        ])}
        <p class="small">${def.blurb}</p>`;
    }
    return null;
  }

  // ------------------------------------------------------------ screens

  private screenKey(): string {
    const k = this.k;
    return `${k.mode}|${this.subscreen ?? ''}|${this.modal ?? ''}|${k.hasRun}|${k.save.meta.teeth}`;
  }

  private renderScreen(force: boolean): void {
    const key = this.screenKey();
    if (!force && key === this.renderedScreen) return;
    this.renderedScreen = key;
    const k = this.k;
    let html = '';
    if (this.subscreen === 'teeth') html = this.teethHtml();
    else if (k.mode === 'title') html = this.titleHtml();
    else if (k.mode === 'collapsed') html = this.collapseHtml();
    if (this.modal) html += this.modalHtml();
    this.screens.innerHTML = html;
    this.bindScreen();
  }

  private bindScreen(): void {
    const root = this.screens;
    root.querySelectorAll<HTMLElement>('[data-act]').forEach((el) =>
      el.addEventListener('click', () => {
        const act = el.dataset.act!;
        if (act === 'confirmYes') {
          const st = this.confirmState;
          this.closeModal();
          st?.onYes();
          return;
        }
        this.action(act, el);
      }),
    );
    root.querySelectorAll<HTMLElement>('[data-buy]').forEach((el) =>
      el.addEventListener('click', () => {
        if (buyUpgrade(this.k.save.meta, el.dataset.buy as never)) {
          this.k.audio.play('teeth');
          this.k.persist();
        } else this.k.audio.play('nope');
        this.renderScreen(true);
      }),
    );
    const vol = (id: string, kind: 'sfx' | 'music') => {
      const input = root.querySelector<HTMLInputElement>(`#${id}`);
      const out = root.querySelector<HTMLElement>(`#${id}-v`);
      input?.addEventListener('input', () => {
        this.k.setVolume(kind, Number(input.value) / 100);
        if (out) out.textContent = String(input.value);
        if (kind === 'sfx') this.k.audio.play('coin', { gap: 0.15 });
      });
    };
    vol('vol-sfx', 'sfx');
    vol('vol-music', 'music');
    root.querySelector('#exportBtn')?.addEventListener('click', () => {
      const ta = root.querySelector<HTMLTextAreaElement>('#exportCode')!;
      this.k.persist();
      ta.value = exportCode(this.k.save);
      ta.hidden = false;
      ta.select();
      const status = root.querySelector<HTMLElement>('#exportStatus')!;
      const clip = navigator.clipboard?.writeText(ta.value);
      if (clip) clip.then(() => (status.textContent = 'Copied to your clipboard.'), () => (status.textContent = 'Select the code and copy it.'));
      else status.textContent = 'Select the code and copy it.';
    });
    root.querySelector('#importBtn')?.addEventListener('click', () => {
      const ta = root.querySelector<HTMLTextAreaElement>('#importCode')!;
      const status = root.querySelector<HTMLElement>('#importStatus')!;
      const file = importCode(ta.value);
      if (!file) {
        status.textContent = 'That code did not work. Check that you copied all of it.';
        status.className = 'small warn';
        return;
      }
      this.closeModal();
      this.k.loadSave(file);
    });
  }

  private titleHtml(): string {
    const k = this.k;
    const m = k.save.meta;
    const run = k.save.run;
    return `<div class="screen"><div class="title-card">
      <div class="logo">Munch<span>Keep</span></div>
      <div class="tagline">You are the dungeon. <em>They are the food.</em></div>
      <div class="menu">
        ${run ? `<button class="btn primary" data-act="continue">Continue dungeon · ${fmtTime(run.time)}</button>` : ''}
        <button class="btn ${run ? '' : 'primary'}" data-act="new">Dig a new dungeon</button>
        <button class="btn gold" data-act="teeth">${this.img('tooth')} Teeth upgrades · ${m.teeth}</button>
        <button class="btn" data-act="help">How to play</button>
        <button class="btn" data-act="settings">Settings</button>
      </div>
      ${m.runs > 0 ? `<div class="meta-line"><span>Dungeons: ${m.runs}</span><span>Longest: ${fmtTime(m.bestSeconds)}</span><span>Heroes eaten: ${n0(m.totalEaten)}</span></div>` : ''}
      <div class="narrow-note">MunchKeep is made for a desktop browser with a mouse and keyboard.</div>
    </div></div>`;
  }

  private collapseHtml(): string {
    const r = this.k.result;
    const m = this.k.save.meta;
    if (!r) return '';
    return `<div class="screen"><div class="card panel">
      <h2 class="dead">${r.voluntary ? 'You collapsed the dungeon' : 'The Maw has fallen'}</h2>
      <p class="muted">It lasted ${fmtTime(r.minutes * 60)}. ${r.newBest ? '<span class="gold">Your longest dungeon yet!</span>' : `Your record is ${fmtTime(m.bestSeconds)}.`}</p>
      <div class="statgrid">
        <div class="stat"><b>${r.eaten}</b><span>heroes eaten</span></div>
        <div class="stat"><b>${r.escaped}</b><span>got away</span></div>
        <div class="stat"><b class="infamy">${n0(r.infamy)}</b><span>Infamy</span></div>
        <div class="stat"><b>${r.champions}</b><span>Champions eaten</span></div>
      </div>
      <div class="teeth-earned">${this.img('toothBig')}<div><b>+${r.teeth}</b> Teeth<div class="small">You now have ${m.teeth}. Spend them on upgrades and blueprints for every future dungeon.</div></div></div>
      <div class="actions">
        <button class="btn gold" data-act="teeth">Spend Teeth</button>
        <button class="btn primary" data-act="new">Dig a new dungeon</button>
      </div>
    </div></div>`;
  }

  private teethHtml(): string {
    const k = this.k;
    const m = k.save.meta;
    const card = (id: (typeof UPGRADE_ORDER)[number]) => {
      const def = UPGRADES[id];
      const lvl = upgradeLevel(m, id);
      const cost = nextUpgradeCost(m, id);
      const max = def.costs.length;
      const pips = Array.from({ length: max }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('');
      const thumb = def.blueprint ? this.img(`room:${def.blueprint}`, 'thumb small-thumb') : '';
      return `<div class="upg ${cost === null ? 'maxed' : ''}">
        <h4>${def.name}<span class="pips">${pips}</span></h4>
        ${thumb}
        <p>${lvl > 0 ? def.desc(lvl) : `<span class="muted">${def.blueprint ? def.desc(1) : 'Not bought yet.'}</span>`}</p>
        ${cost !== null && !def.blueprint ? `<div class="next">Next: ${def.desc(lvl + 1)}</div>` : ''}
        ${cost !== null ? `<button class="btn gold" data-buy="${id}" ${m.teeth < cost ? 'disabled' : ''}>${this.img('tooth')} ${cost}</button>` : '<div class="next gold">Owned</div>'}
      </div>`;
    };
    const from = k.mode === 'collapsed' || !k.hasRun;
    return `<div class="screen"><div class="tree card panel">
      <div class="head"><h2>Teeth</h2><div class="bank">${this.img('toothBig')} ${m.teeth}</div></div>
      <p class="muted">Every collapsed dungeon leaves Teeth behind. What you buy here applies to every dungeon you dig from now on${k.hasRun ? ', starting with your next one' : ''}.</p>
      <h5 class="section">Blueprints</h5>
      <div class="upgrades">${BLUEPRINT_ORDER.map(card).join('')}</div>
      <h5 class="section">Upgrades</h5>
      <div class="upgrades">${UPGRADE_ORDER.map(card).join('')}</div>
      <div class="actions">
        <button class="btn" data-act="back">Back</button>
        ${from ? '<button class="btn primary" data-act="new">Dig a new dungeon</button>' : ''}
      </div>
    </div></div>`;
  }

  private modalHtml(): string {
    const k = this.k;
    if (this.modal === 'confirm' && this.confirmState) {
      return `<div class="modal"><div class="card panel">
        <p>${esc(this.confirmState.text)}</p>
        <div class="actions"><button class="btn" data-act="close">Cancel</button><button class="btn danger" data-act="confirmYes">${esc(this.confirmState.yes)}</button></div>
      </div></div>`;
    }
    if (this.modal === 'migrated') {
      return `<div class="modal"><div class="card panel">
        <h2>MunchKeep has been rebuilt</h2>
        <p>Dungeons are now made of rooms you buy and link with corridors, seen from above. Old dungeons could not come along, but your progress did: you have <b class="tooth">${k.save.meta.teeth} Teeth</b>, including a full refund of the upgrades you had bought.</p>
        <div class="actions"><button class="btn primary" data-act="close">Let's eat</button></div>
      </div></div>`;
    }
    if (this.modal === 'offline' && k.offlineReport) {
      const o = k.offlineReport;
      const hrs = o.seconds / 3600;
      const span = hrs >= 1 ? `${hrs.toFixed(1)} hours` : `${Math.round(o.seconds / 60)} minutes`;
      return `<div class="modal"><div class="card panel">
        <h2>While you slept…</h2>
        <p>Your dungeon kept munching for ${span}${o.seconds >= BALANCE.offlineCapSeconds ? ' (the most it can manage alone)' : ''}.</p>
        <div class="statgrid">
          <div class="stat"><b>${o.eaten}</b><span>heroes eaten</span></div>
          <div class="stat"><b class="gold">+${n0(o.gold)}</b><span>Gold</span></div>
          <div class="stat"><b class="ess">+${n0(o.essence)}</b><span>Essence</span></div>
        </div>
        <p class="small">Offline time only earns. It never hurts the Maw.</p>
        <div class="actions"><button class="btn primary" data-act="close">Nice</button></div>
      </div></div>`;
    }
    if (this.modal === 'help') {
      return `<div class="modal"><div class="card panel howto" style="width:min(700px,100%)">
        <h2>How to play</h2>
        <ul>
          <li>Hero parties come in through the <b>Gate</b> and walk toward <b>the Maw</b>, your mouth and heart. If they chew it to death, the dungeon collapses.</li>
          <li><b>Click an empty site</b> to buy a room from the catalog. Monster rooms block the way until the party beats them. Trap rooms hurt parties while they cross.</li>
          <li><b>Drag from one room to another</b> (or click a dotted line) to dig a corridor. Heroes pick routes through your corridors, and the dotted colored lines show where each kind of hero will go.</li>
          <li>Rooms joined by a corridor are <b>linked</b>. A Larder feeds linked monster rooms; a Gloom Hall hides linked traps; a Gullet digests heroes who die in linked rooms.</li>
          <li>Order matters: Slime or Spiders make heroes Sticky for double Spikes damage. An Oil Cellar before a Flame Gallery burns.</li>
          <li><b>Knights</b> fear nothing. <b>Clerics</b> heal and steer around rooms they have heard about. <b>Rogues</b> peek into rooms, disarm known traps, and sneak off to raid Vaults.</li>
          <li>Heroes who escape tell the town about your rooms (the eye marker). Eat them all and nobody learns anything.</li>
          <li>Eaten heroes give <b>Gold</b> and <b>Essence</b>. Essence pays for monster rooms, top-rank upgrades and <b>excavating</b> dark areas. <b>Infamy</b> unlocks more of the catalog.</li>
          <li>When the dungeon collapses you keep <b>Teeth</b> for upgrades and new room blueprints.</li>
        </ul>
        <div class="keys">
          <span>Click a room to upgrade · <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> buy a track</span><span><kbd>M</kbd> feed the Maw</span>
          <span><kbd>Space</kbd> pause · <kbd>T</kbd> speed</span><span><kbd>R</kbd> routes · <kbd>Esc</kbd> close or menu</span>
          <span><kbd>WASD</kbd> or right-drag to pan</span><span>Mouse wheel to zoom</span>
        </div>
        <div class="actions"><button class="btn primary" data-act="close">Got it</button></div>
      </div></div>`;
    }
    if (this.modal === 'settings') {
      const s = k.save.settings;
      const playing = k.mode === 'play' && !k.sim.collapsed;
      return `<div class="modal"><div class="card panel" style="width:min(560px,100%)">
        <h2>${playing ? 'Paused' : 'Settings'}</h2>
        <label class="slider" for="vol-music">Music <input id="vol-music" type="range" min="0" max="100" value="${Math.round(s.music * 100)}"><span id="vol-music-v">${Math.round(s.music * 100)}</span></label>
        <label class="slider" for="vol-sfx">Sounds <input id="vol-sfx" type="range" min="0" max="100" value="${Math.round(s.sfx * 100)}"><span id="vol-sfx-v">${Math.round(s.sfx * 100)}</span></label>
        <div>
          <div class="small">Your progress is saved in this browser. Keep a save code somewhere safe to move it or back it up.</div>
          <div class="actions" style="justify-content:flex-start;margin-top:6px"><button class="btn" id="exportBtn">Copy save code</button></div>
          <textarea class="code" id="exportCode" readonly hidden></textarea>
          <div class="small" id="exportStatus"></div>
        </div>
        <div>
          <textarea class="code" id="importCode" placeholder="Paste a save code here"></textarea>
          <div class="actions" style="justify-content:flex-start;margin-top:6px"><button class="btn" id="importBtn">Load save code</button></div>
          <div class="small" id="importStatus"></div>
        </div>
        <div class="actions">
          <button class="btn danger" data-act="erase">Erase progress</button>
          ${playing ? '<button class="btn danger" data-act="collapseNow">Collapse dungeon</button><button class="btn" data-act="title">Title screen</button>' : ''}
          <button class="btn primary" data-act="close">${playing ? 'Resume' : 'Close'}</button>
        </div>
      </div></div>`;
    }
    return '';
  }
}
