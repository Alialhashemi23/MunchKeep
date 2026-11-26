import { featureIcon, type Bank } from '../game/art/bank';
import type { Keeper, Tool } from '../game/keeper';
import {
  BALANCE,
  FEATURES,
  FEATURE_ORDER,
  HEROES,
  MONSTERS,
  UPGRADES,
  UPGRADE_ORDER,
  monsterDmgMul,
  monsterHpMul,
  trapDmgMul,
  type FeatureId,
} from '../sim/content';
import { buyUpgrade, nextUpgradeCost, upgradeLevel } from '../sim/meta';
import { exportCode, importCode } from '../sim/save';
import type { Sim } from '../sim/sim';

const SHORT: Record<FeatureId, string> = {
  goblinDen: 'Goblins',
  spikes: 'Spikes',
  hoard: 'Hoard',
  slimePit: 'Slime',
  larder: 'Larder',
  oil: 'Oil',
  gloom: 'Gloom',
  fireVent: 'Fire',
  gullet: 'Gullet',
  mimic: 'Mimic',
};

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];

type BarItem = { id: Tool | 'maw'; key: string; name: string; icon: string } | 'sep';

interface Hint {
  text: string;
  done: (sim: Sim, ui: Ui) => boolean;
}

const HINTS: Hint[] = [
  {
    text: 'Heroes walk the dotted lines toward your Maw. Press <b>1</b>, then click a tunnel tile on their path to build a Goblin Den.',
    done: (sim) => sim.grid.featureTiles().some((t) => FEATURES[sim.grid.features[t]!.id].category === 'lair'),
  },
  {
    text: 'Press <b>2</b> for Spikes and place a few along the path. Traps hit anyone standing on them.',
    done: (sim) => sim.grid.featureTiles().filter((t) => FEATURES[sim.grid.features[t]!.id].category === 'trap').length >= 2,
  },
  {
    text: 'Press <b>E</b> and drag across rock to dig. A long, winding path keeps heroes in your traps. <b>F</b> fills a shortcut back in.',
    done: (sim, ui) => ui.floorCount(sim) >= ui.baselineFloor + 6,
  },
  {
    text: 'Build a <b>Hoard</b> (3) just off the path. Greedy Rogues detour to loot it, so surround it with traps.',
    done: (sim) => sim.grid.featureTiles().some((t) => sim.grid.features[t]!.id === 'hoard'),
  },
  {
    text: 'Press <b>Q</b> and click something you built to upgrade it. Press <b>M</b> to feed the Maw and make it tougher.',
    done: (sim) => sim.mawLevel > 1 || sim.grid.featureTiles().some((t) => sim.grid.features[t]!.level > 1),
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
  private toolEls = new Map<string, HTMLElement>();
  private modal: null | 'help' | 'settings' | 'offline' | 'confirm' = null;
  private confirmState: { text: string; yes: string; onYes: () => void } | null = null;
  private subscreen: null | 'teeth' = null;
  private renderedScreen = '';
  private tooltipFor: string | null = null;
  private hintsOff = false;
  private pausedForModal: number | null = null;
  private lastInspect = '';
  private lastFeed = '';
  baselineFloor = 0;

  constructor(
    private k: Keeper,
    bank: Bank,
  ) {
    this.makeIcons(bank);
    this.buildHud();
    k.onChange(() => this.onChange());
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('pointerdown', () => k.audio.unlock(), { capture: true });
    if (k.offlineReport) this.modal = 'offline';
    this.onChange();
    window.setInterval(() => this.tick(), 100);
  }

  // ------------------------------------------------------------ icons

  private makeIcons(bank: Bank): void {
    const put = (name: string, url: string) => this.icons.set(name, url);
    const map: Record<FeatureId, string> = {
      goblinDen: 'goblinDen',
      spikes: 'spikes:1',
      hoard: 'hoard',
      slimePit: 'slimePit',
      larder: 'larder',
      oil: 'oil',
      gloom: 'gloom:0',
      fireVent: 'fireVent',
      gullet: 'gullet',
      mimic: 'mimic:0',
    };
    for (const f of FEATURE_ORDER) {
      if (f === 'mimic') {
        put(f, scaled(bank.get('mimic:0')!, 3, [0, 2, 14, 12]));
        continue;
      }
      if (f === 'slimePit') {
        // A slime sitting in its puddle reads better than the puddle alone.
        const base = featureIcon(bank, 'slimePit');
        const ctx = base.getContext('2d')!;
        ctx.drawImage(bank.get('slime:0')!, 11, 20);
        put(f, scaled(base, 2, [1, 10, 32, 28]));
        continue;
      }
      put(f, scaled(featureIcon(bank, map[f]), 2, [1, 10, 32, 28]));
    }
    put('dig', scaled(bank.get('icon:pick')!, 4));
    put('fill', scaled(bank.get('rock:0')!, 2, [0, 0, 32, 25]));
    put('demolish', scaled(bank.get('icon:x')!, 4));
    put('inspect', scaled(bank.get('icon:eye')!, 4));
    put('maw', scaled(bank.get('maw:1')!, 1));
    put('coin', scaled(bank.get('icon:coin')!, 2));
    put('skull', scaled(bank.get('icon:skull')!, 2));
    put('tooth', scaled(bank.get('icon:tooth')!, 2));
    put('toothBig', scaled(bank.get('icon:tooth')!, 4));
    put('heart', scaled(bank.get('icon:heart')!, 2));
  }

  private img(name: string, cls = ''): string {
    return `<img class="px ${cls}" src="${this.icons.get(name)}" alt="">`;
  }

  // ------------------------------------------------------------ HUD skeleton

  private buildHud(): void {
    const bar: BarItem[] = [
      { id: 'inspect', key: 'Q', name: 'Select', icon: 'inspect' },
      { id: 'dig', key: 'E', name: 'Dig', icon: 'dig' },
      { id: 'fill', key: 'F', name: 'Fill', icon: 'fill' },
      { id: 'demolish', key: 'X', name: 'Remove', icon: 'demolish' },
      'sep',
      ...FEATURE_ORDER.map((f) => ({ id: f as Tool, key: FEATURES[f].hotkey, name: SHORT[f], icon: f })),
      'sep',
      { id: 'maw', key: 'M', name: 'Feed Maw', icon: 'maw' },
    ];
    this.hud.innerHTML = `
      <div class="res panel">
        <div class="res-row gold">${this.img('coin')}<span class="val" data-r="gold">0</span><span class="sub" data-r="income"></span></div>
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
      <div class="inspect panel" data-r="inspect" hidden></div>
      <div class="buildbar panel" data-r="bar">
        ${bar
          .map((b) =>
            b === 'sep'
              ? '<div class="sep"></div>'
              : `<div class="tool" data-tool="${b.id}">
                  <span class="key">${b.key}</span>
                  <span class="ic">${this.img(b.icon)}</span>
                  <span class="name">${b.name}</span>
                  <span class="cost" data-cost></span>
                </div>`,
          )
          .join('')}
      </div>
      <div class="tooltip panel" data-r="tip" hidden></div>
      <div class="cursortip" data-r="ctip" hidden></div>
    `;
    this.hud.querySelectorAll<HTMLElement>('[data-r]').forEach((el) => (this.refs[el.dataset.r!] = el));
    this.hud.querySelectorAll<HTMLElement>('[data-tool]').forEach((el) => this.toolEls.set(el.dataset.tool!, el));

    this.hud.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const tool = t.closest<HTMLElement>('[data-tool]');
      if (tool) {
        const id = tool.dataset.tool!;
        if (id === 'maw') this.k.upgradeMaw();
        else this.k.setTool(id as Tool);
        return;
      }
      const sp = t.closest<HTMLElement>('[data-speed]');
      if (sp) {
        this.k.setSpeed(Number(sp.dataset.speed));
        this.k.audio.play('click');
        return;
      }
      const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
      if (act) this.action(act);
    });
    this.refs.bar.addEventListener('mouseover', (e) => {
      const tool = (e.target as HTMLElement).closest<HTMLElement>('[data-tool]');
      if (tool) this.showTip(tool.dataset.tool!, tool);
    });
    this.refs.bar.addEventListener('mouseleave', () => this.hideTip());
  }

  // ------------------------------------------------------------ actions

  private action(act: string): void {
    const k = this.k;
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
      case 'upgrade':
        k.upgradeSelected();
        this.lastInspect = '';
        break;
      case 'remove':
        k.demolishSelected();
        this.lastInspect = '';
        break;
      case 'deselect':
        k.select(null);
        break;
      case 'continue':
        k.continueRun();
        this.baselineFloor = this.floorCount(k.sim);
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
          this.baselineFloor = this.floorCount(k.sim);
        }
        break;
      case 'teeth':
        this.subscreen = 'teeth';
        this.k.audio.play('click');
        this.renderScreen(true);
        break;
      case 'back':
        this.subscreen = null;
        this.k.audio.play('click');
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
    this.modal = null;
    this.confirmState = null;
    if (this.pausedForModal !== null && this.k.mode === 'play') this.k.setSpeed(this.pausedForModal);
    this.pausedForModal = null;
    this.renderScreen(true);
  }

  floorCount(sim: Sim): number {
    let n = 0;
    for (const k of sim.grid.kinds) if (k === 'floor') n++;
    return n;
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

    const idx = '1234567890'.indexOf(key);
    if (idx >= 0) {
      k.setTool(FEATURE_ORDER[idx]);
      return;
    }
    switch (key.toLowerCase()) {
      case 'q':
        k.setTool('inspect');
        break;
      case 'e':
        k.setTool('dig');
        break;
      case 'f':
        k.setTool('fill');
        break;
      case 'x':
        k.setTool('demolish');
        break;
      case 'm':
        k.upgradeMaw();
        break;
      case 'u':
        k.upgradeSelected();
        this.lastInspect = '';
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
      case 'delete':
      case 'backspace':
        k.demolishSelected();
        break;
      case 'escape':
        if (k.tool !== 'inspect') k.setTool('inspect');
        else if (k.selection) k.select(null);
        else this.openModal('settings');
        break;
    }
  }

  // ------------------------------------------------------------ change + tick

  private onChange(): void {
    const k = this.k;
    this.hud.hidden = k.mode !== 'play';
    document.getElementById('boot')?.remove();
    for (const [id, el] of this.toolEls) el.classList.toggle('on', id === k.tool);
    this.hud.querySelectorAll<HTMLElement>('[data-speed]').forEach((b) => b.classList.toggle('on', Number(b.dataset.speed) === k.speed));
    this.hud.querySelector('[data-act="routes"]')?.classList.toggle('on', k.save.settings.routes);
    this.lastInspect = '';
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
    r.infamy.textContent = n0(sim.infamy);
    const next = sim.nextUnlock();
    if (next) {
      const prevAt = FEATURE_ORDER.map((f) => FEATURES[f].unlockInfamy)
        .filter((v) => v <= sim.infamy)
        .reduce((a, b) => Math.max(a, b), 0);
      const frac = (sim.infamy - prevAt) / Math.max(1, next.infamy - prevAt);
      r.infMeter.style.width = `${Math.min(100, frac * 100)}%`;
      r.infNext.textContent = `Next: ${FEATURES[next.feature].name} at ${next.infamy}`;
    } else {
      r.infMeter.style.width = '100%';
      r.infNext.textContent = 'Everything unlocked';
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

    // Build bar costs and states
    for (const [id, el] of this.toolEls) {
      const cost = el.querySelector<HTMLElement>('[data-cost]')!;
      if (id === 'maw') {
        const c = sim.mawUpgradeCost();
        cost.textContent = c === null ? 'MAX' : String(c);
        el.classList.toggle('poor', c !== null && sim.gold < c);
      } else if (id === 'dig') {
        cost.textContent = String(sim.digCost);
        el.classList.toggle('poor', sim.gold < sim.digCost);
      } else if (id === 'fill') {
        cost.textContent = String(sim.fillCost);
      } else if (id in FEATURES) {
        const f = id as FeatureId;
        const locked = !sim.unlocked.has(f);
        el.classList.toggle('locked', locked);
        cost.textContent = locked ? `${FEATURES[f].unlockInfamy} inf` : String(sim.featureCost(f));
        el.classList.toggle('poor', !locked && sim.gold < sim.featureCost(f));
      } else cost.textContent = '';
    }
    if (this.tooltipFor) this.refreshTip();

    // Toast
    const toast = k.toast;
    if (toast && performance.now() - toast.at < 2600) {
      r.toast.textContent = toast.text;
      r.toast.className = `toast panel ${toast.tone}`;
      r.toast.style.opacity = '1';
    } else r.toast.style.opacity = '0';

    // Feed
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

    // Tips for the first dungeons
    if (!this.hintsOff && k.save.meta.runs < 2) {
      const hint = HINTS.find((h) => !h.done(sim, this));
      r.hint.hidden = !hint;
      if (hint && r.hintText.innerHTML !== hint.text) r.hintText.innerHTML = hint.text;
    } else r.hint.hidden = true;

    // Cursor tip for invalid placements
    const hv = k.hover;
    if (hv && !hv.ok && hv.reason && k.tool !== 'inspect') {
      r.ctip.hidden = false;
      r.ctip.textContent = hv.reason;
      r.ctip.style.left = `${hv.sx + 18}px`;
      r.ctip.style.top = `${hv.sy + 18}px`;
    } else r.ctip.hidden = true;

    this.renderInspect();
  }

  // ------------------------------------------------------------ tooltip

  private showTip(id: string, anchor: HTMLElement): void {
    this.tooltipFor = id;
    this.refreshTip();
    const tip = this.refs.tip;
    tip.hidden = false;
    const a = anchor.getBoundingClientRect();
    const w = 300;
    const left = Math.max(12, Math.min(window.innerWidth - w - 12, a.left + a.width / 2 - w / 2));
    tip.style.left = `${left}px`;
    tip.style.bottom = `${window.innerHeight - a.top + 14}px`;
  }

  private hideTip(): void {
    this.tooltipFor = null;
    this.refs.tip.hidden = true;
  }

  private refreshTip(): void {
    const id = this.tooltipFor;
    if (!id) return;
    const sim = this.k.sim;
    let html = '';
    const tools: Record<string, [string, string]> = {
      inspect: ['Select', 'Click a build, a hero, a monster or the Maw to see details and upgrade it.'],
      dig: ['Dig', `Carve tunnel out of rock for ${sim.digCost} Gold a tile. Hold and drag to dig a line. New tunnel must touch the dungeon.`],
      fill: ['Fill', `Turn empty tunnel back into rock for ${sim.fillCost} Gold. Use it to close shortcuts. You can never cut the Maw off completely.`],
      demolish: ['Remove', 'Tear down a build and get half of what you spent on it back.'],
    };
    if (id in tools) {
      html = `<h4>${tools[id][0]}</h4><p>${tools[id][1]}</p>`;
    } else if (id === 'maw') {
      const c = sim.mawUpgradeCost();
      html = `<h4>Feed the Maw <span class="gold">${c === null ? 'MAX' : c + ' Gold'}</span></h4>
        <div class="tag">Level ${sim.mawLevel}</div>
        <p>Makes the Maw bigger: +${Math.round(BALANCE.mawHpPerLevel * 100)}% max HP and +${Math.round(BALANCE.mawChompPerLevel * 100)}% chomp damage per level. The Maw chomps any hero that gets close.</p>`;
    } else {
      const f = id as FeatureId;
      const def = FEATURES[f];
      const locked = !sim.unlocked.has(f);
      html = `<h4>${def.name} <span class="gold">${sim.featureCost(f)} Gold</span></h4>
        <div class="tag">${def.category === 'lair' ? 'Monster lair' : def.category === 'trap' ? 'Trap' : 'Room'} · key ${def.hotkey}</div>
        <p>${def.desc}</p>
        <p class="syn">${def.synergy}</p>
        ${locked ? `<p class="lock">Unlocks at ${def.unlockInfamy} Infamy (you have ${n0(sim.infamy)}).</p>` : ''}`;
    }
    if (this.refs.tip.innerHTML !== html) this.refs.tip.innerHTML = html;
  }

  // ------------------------------------------------------------ inspect panel

  private renderInspect(): void {
    const html = this.inspectHtml();
    const el = this.refs.inspect;
    if (!html) {
      el.hidden = true;
      this.lastInspect = '';
      return;
    }
    el.hidden = false;
    if (html !== this.lastInspect) {
      this.lastInspect = html;
      el.innerHTML = html;
    }
  }

  private inspectHtml(): string | null {
    const k = this.k;
    const sim = k.sim;
    const g = sim.grid;
    const sel = k.selection;
    if (!sel) return null;
    const close = '<button class="close" data-act="deselect" title="Close">✕</button>';
    const stat = (a: string, b: string) => `<dt>${a}</dt><dd>${b}</dd>`;
    const yes = (ok: boolean, a: string, b: string) => `<div class="${ok ? 'yes' : 'no'}">${ok ? '✓ ' + a : '· ' + b}</div>`;

    if (sel.kind === 'maw') {
      const c = sim.mawUpgradeCost();
      return `${close}<h3>The Maw <small>Lv ${sim.mawLevel}</small></h3>
        <div class="tag">Your mouth, your heart</div>
        <dl class="stats">${stat('HP', `${Math.ceil(sim.mawHp)} / ${sim.mawMaxHp}`)}${stat('Chomp', `${Math.round(sim.mawChompDamage)} dmg`)}${stat('Regrows', `${BALANCE.mawRegen} HP/s when safe`)}</dl>
        <p class="small">Heroes who reach the Maw bite it ${BALANCE.bitesBeforeFlee} times, steal Gold, then run home. If its HP hits zero, the dungeon collapses.</p>
        <div class="row"><button class="btn gold" data-act="upgrade" ${c === null || sim.gold < c ? 'disabled' : ''}>${c === null ? 'Fully grown' : `Feed · ${c} Gold`}</button></div>`;
    }

    if (sel.kind === 'tile') {
      const f = g.features[sel.tile];
      if (!f) return null;
      const def = FEATURES[f.id];
      const lines: string[] = [];
      const stats: string[] = [];
      if (def.category === 'lair') {
        const mdef = MONSTERS[def.monster!];
        const alive = f.slots.filter((s) => s.monsterId !== null).length;
        const fed = g.touches(sel.tile, 'larder');
        stats.push(stat(`${mdef.name}s`, `${alive} / ${f.slots.length}`));
        stats.push(stat('HP', n0(mdef.hp * monsterHpMul(f.level))));
        stats.push(stat('Damage', `${(mdef.dmg * monsterDmgMul(f.level) * (mdef.ambushMul ?? 1)).toFixed(1)}${mdef.ambushMul ? ' first bite' : ''}`));
        stats.push(stat('Respawn', `${((def.respawn ?? 10) / (fed ? 2 : 1)).toFixed(0)}s`));
        const waiting = f.slots.filter((s) => s.monsterId === null).map((s) => Math.max(0, s.respawn / (fed ? 2 : 1)));
        if (waiting.length) stats.push(stat('Next back in', `${Math.ceil(Math.min(...waiting))}s`));
        lines.push(yes(fed, 'Fed by a Larder', 'Place a Larder touching it'));
        if (f.id === 'mimic') {
          const known = sim.rumors.has(sel.tile);
          lines.push(known ? '<div class="warn">! The town knows this is a Mimic</div>' : '<div class="yes">✓ Heroes think it is treasure</div>');
        }
      } else if (def.category === 'trap') {
        if (def.damage) stats.push(stat('Damage', (def.damage * trapDmgMul(f.level)).toFixed(0)));
        if (f.id === 'fireVent') stats.push(stat('Burn', `${(7 * trapDmgMul(f.level) * BALANCE.burnSeconds).toFixed(0)} over ${BALANCE.burnSeconds}s`));
        stats.push(stat('Resets in', `${def.rearm}s${g.touches(sel.tile, 'hoard') ? ' (2× faster)' : ''}`));
        stats.push(stat('State', f.rearm > 0 ? `<span class="no">resetting ${f.rearm.toFixed(1)}s</span>` : '<span class="yes">armed</span>'));
        lines.push(yes(g.touches(sel.tile, 'hoard'), 'Next to a Hoard: resets faster', 'A Hoard touching it doubles reset speed'));
        lines.push(yes(g.touches(sel.tile, 'gloom'), 'In Gloom: Rogues cannot spot it', 'Gloom touching it hides it from Rogues'));
        if (sim.rumors.has(sel.tile)) lines.push('<div class="warn">! Heroes have heard about this trap</div>');
      } else {
        const touching = g.neighbors8(sel.tile).map((n) => g.features[n]).filter(Boolean);
        if (f.id === 'larder') lines.push(`<div>Feeding ${touching.filter((t) => FEATURES[t!.id].category === 'lair').length} lair(s)</div>`);
        if (f.id === 'hoard' || f.id === 'gloom') lines.push(`<div>Boosting ${touching.filter((t) => FEATURES[t!.id].category === 'trap').length} trap(s)</div>`);
        if (f.id === 'gullet') lines.push('<div>Heroes dying on or next to it pay +50% Gold</div>');
      }
      const up = sim.upgradeCost(sel.tile);
      const refund = Math.floor(f.invested * BALANCE.demolishRefund);
      return `${close}<h3>${def.name} <small>${def.upgradable ? 'Lv ' + ROMAN[f.level] : ''}</small></h3>
        <div class="tag">${def.category === 'lair' ? 'Monster lair' : def.category === 'trap' ? 'Trap' : 'Room'}</div>
        ${stats.length ? `<dl class="stats">${stats.join('')}</dl>` : ''}
        <p class="small">${def.synergy}</p>
        ${lines.join('')}
        <div class="row">
          ${def.upgradable ? `<button class="btn gold" data-act="upgrade" ${up === null || sim.gold < up ? 'disabled' : ''}>${up === null ? 'Max level' : `Upgrade · ${up}`}</button>` : ''}
          <button class="btn danger" data-act="remove">Remove · +${refund}</button>
        </div>`;
    }

    if (sel.kind === 'hero') {
      const h = sim.heroes.find((x) => x.id === sel.id);
      if (!h) return null;
      const def = HEROES[h.cls];
      let intent = 'Heading for the Maw';
      if (h.state === 'loot') intent = 'Looting your Hoard!';
      else if (h.state === 'bite') intent = 'Biting the Maw!';
      else if (h.state === 'fight') intent = 'Fighting';
      else if (h.goal === 'flee') intent = h.loot >= 1 ? `Running home with ${n0(h.loot)} Gold` : 'Running home';
      else if (h.goal === 'loot') intent = 'Heading for treasure';
      const st: string[] = [];
      if (h.sticky > 0) st.push('Sticky');
      if (h.oily > 0) st.push('Oily');
      if (h.burning > 0) st.push('Burning');
      const party = sim.parties.get(h.partyId);
      let knownTraps = 0;
      if (party) for (const [t, id] of party.known) if (g.features[t]?.id === id) knownTraps++;
      return `${close}<h3>${h.champion ? esc(h.champion) : def.name} <small>Lv ${h.level}</small></h3>
        <div class="tag">${h.champion ? `Champion ${def.name}` : 'Hero'}</div>
        <dl class="stats">${stat('HP', `${Math.ceil(h.hp)} / ${Math.ceil(h.maxHp)}`)}${stat('Damage', h.dmg.toFixed(1))}${stat('Doing', intent)}${st.length ? stat('Status', st.join(', ')) : ''}${h.loot >= 1 ? stat('Carrying', `${n0(h.loot)} Gold`) : ''}${stat('Knows', `${knownTraps} of your traps`)}</dl>
        <p class="small">${def.blurb}</p>`;
    }

    if (sel.kind === 'monster') {
      const m = sim.monsters.find((x) => x.id === sel.id);
      if (!m) return null;
      const def = MONSTERS[m.kind];
      return `${close}<h3>${def.name} <small>Lv ${m.level}</small></h3>
        <div class="tag">Your monster</div>
        <dl class="stats">${stat('HP', `${Math.ceil(m.hp)} / ${Math.ceil(m.maxHp)}`)}${stat('Damage', m.dmg.toFixed(1))}${stat('Range', def.leash ? `${def.leash} tiles from its lair` : 'its own tile')}</dl>
        <p class="small">Upgrade its lair to make it stronger.</p>`;
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
        this.action(act);
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
        const v = Number(input.value) / 100;
        this.k.setVolume(kind, v);
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
      navigator.clipboard?.writeText(ta.value).then(
        () => (status.textContent = 'Copied to your clipboard.'),
        () => (status.textContent = 'Select the code and copy it.'),
      ) ?? (status.textContent = 'Select the code and copy it.');
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
      <div class="teeth-earned">${this.img('toothBig')}<div><b>+${r.teeth}</b> Teeth<div class="small">You now have ${m.teeth}. Spend them on upgrades for every future dungeon.</div></div></div>
      <div class="actions">
        <button class="btn gold" data-act="teeth">Spend Teeth</button>
        <button class="btn primary" data-act="new">Dig a new dungeon</button>
      </div>
    </div></div>`;
  }

  private teethHtml(): string {
    const k = this.k;
    const m = k.save.meta;
    const cards = UPGRADE_ORDER.map((id) => {
      const def = UPGRADES[id];
      const lvl = upgradeLevel(m, id);
      const cost = nextUpgradeCost(m, id);
      const max = def.costs.length;
      const pips = Array.from({ length: max }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('');
      return `<div class="upg ${cost === null ? 'maxed' : ''}">
        <h4>${def.name}<span class="pips">${pips}</span></h4>
        <p>${lvl > 0 ? def.desc(lvl) : '<span class="muted">Not bought yet.</span>'}</p>
        ${cost !== null ? `<div class="next">Next: ${def.desc(lvl + 1)}</div>` : '<div class="next gold">Maxed</div>'}
        ${cost !== null ? `<button class="btn gold" data-buy="${id}" ${m.teeth < cost ? 'disabled' : ''}>${this.img('tooth')} ${cost}</button>` : ''}
      </div>`;
    }).join('');
    const from = k.mode === 'collapsed' || !k.hasRun;
    return `<div class="screen"><div class="tree card panel">
      <div class="head"><h2>Teeth</h2><div class="bank">${this.img('toothBig')} ${m.teeth}</div></div>
      <p class="muted">Every collapsed dungeon leaves Teeth behind. Upgrades apply to every dungeon you dig from now on${k.hasRun ? ', starting with your next one' : ''}.</p>
      <div class="upgrades">${cards}</div>
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
        </div>
        <p class="small">Offline time only earns. It never hurts the Maw.</p>
        <div class="actions"><button class="btn primary" data-act="close">Nice</button></div>
      </div></div>`;
    }
    if (this.modal === 'help') {
      return `<div class="modal"><div class="card panel howto" style="width:min(680px,100%)">
        <h2>How to play</h2>
        <ul>
          <li>Heroes come in through the gate and walk to <b>the Maw</b>, your mouth and heart. If they chew it to death, the dungeon collapses.</li>
          <li>Build monsters, traps and rooms on tunnel tiles. <b>Dig</b> new tunnels to make the route longer. The dotted lines show where each kind of hero will walk.</li>
          <li><b>Knights</b> barely fear anything. <b>Clerics</b> heal and avoid traps they have heard about. <b>Rogues</b> go for treasure, spot traps, and run when hurt.</li>
          <li>Heroes who escape tell the town about your traps (the eye marker). Later parties avoid those tiles. Eat everyone and nobody learns anything.</li>
          <li>Combine things: Slime makes heroes Sticky for double Spikes damage. Oil plus a Fire Vent burns. Rooms boost whatever they touch.</li>
          <li>Kills pay Gold and <b>Infamy</b>. Infamy unlocks new builds and attracts tougher heroes. A named Champion arrives every 8 minutes.</li>
          <li>When the dungeon collapses you keep <b>Teeth</b> for permanent upgrades.</li>
        </ul>
        <div class="keys">
          <span><kbd>1</kbd>–<kbd>0</kbd> build</span><span><kbd>E</kbd> dig · <kbd>F</kbd> fill · <kbd>X</kbd> remove</span>
          <span><kbd>Q</kbd> select · <kbd>U</kbd> upgrade</span><span><kbd>M</kbd> feed the Maw</span>
          <span><kbd>Space</kbd> pause · <kbd>T</kbd> speed</span><span><kbd>R</kbd> routes · <kbd>Esc</kbd> menu</span>
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
