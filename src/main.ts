import Phaser from 'phaser';
import './ui/style.css';
import { Audio } from './audio/audio';
import { buildBank } from './game/art/bank';
import { Keeper } from './game/keeper';
import { Bot } from './sim/bot';
import { WorldScene } from './game/scene';
import type { KeyValueStore } from './sim/save';
import { Ui } from './ui/ui';

/** localStorage can be missing or throw (private windows, sandboxed previews). */
function storage(): KeyValueStore | null {
  try {
    const s = window.localStorage;
    s.setItem('__mk', '1');
    s.removeItem('__mk');
    return s;
  } catch {
    return null;
  }
}

/** The artifact viewer's hot-reload hook (absent everywhere else). */
interface Hot {
  ready?: (fn: (data: unknown) => void) => void;
  data?: unknown;
  snapshot?: (fn: () => unknown) => void;
}

const hot = (window as unknown as { claude?: { hot?: Hot } }).claude?.hot;

function start(data: unknown): void {
  const saved = (data as { save?: unknown } | null)?.save;
  const audio = new Audio();
  const keeper = new Keeper(audio, storage(), typeof saved === 'string' ? saved : undefined);
  const bank = buildBank();

  new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    backgroundColor: '#120d16',
    pixelArt: true,
    roundPixels: true,
    antialias: false,
    banner: false,
    disableContextMenu: true,
    scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
    scene: [new WorldScene(keeper, bank)],
  });
  new Ui(keeper, bank);

  document.addEventListener('visibilitychange', () => (document.hidden ? keeper.onHidden() : keeper.onVisible()));
  window.addEventListener('pagehide', () => keeper.persist());
  try {
    hot?.snapshot?.(() => ({ save: keeper.snapshot() }));
  } catch {
    // Not running inside the artifact viewer.
  }
  if (import.meta.env.DEV) Object.assign(window, { munchkeep: keeper, MunchBot: Bot });
}

if (hot?.ready) hot.ready(start);
else start(hot?.data ?? null);
