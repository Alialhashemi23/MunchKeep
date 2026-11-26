# MunchKeep

*You are the dungeon. They are the food.*

A real-time isometric dungeon-management game for desktop browsers. Adventurers walk
in through the gate and head for **the Maw**, your mouth and heart. Dig tunnels, place
monsters, traps and rooms, steer heroes where you want them, and eat them. When the
Maw finally falls, the dungeon collapses and leaves Teeth behind for permanent upgrades.

See [docs/GAME_PLAN.md](docs/GAME_PLAN.md) for the design.

## Run it

```bash
npm install
npm run dev        # http://127.0.0.1:5173
npm test           # simulation + balance tests (Vitest)
npm run build      # static site in dist/
```

`npm run build:artifact` produces `dist-artifact/munchkeep.html`: one self-contained
file (Phaser loads from a pinned jsDelivr URL) used for the hosted playtest link.

## Controls

| Input | Action |
|---|---|
| `1`–`0` | Pick a build (Goblin Den, Spikes, Hoard, Slime Pit, Larder, Oil, Gloom, Fire Vent, Gullet, Mimic) |
| `E` / `F` / `X` | Dig / fill / remove (hold and drag to dig or fill a line) |
| `Q` | Select: click a build, hero, monster or the Maw |
| `U` / `M` | Upgrade the selection / feed the Maw |
| `Space`, `T` | Pause, cycle speed (1×, 2×, 3×) |
| `R` | Show or hide hero routes |
| `WASD`, arrows, right-drag | Pan |
| Mouse wheel | Zoom |
| `Esc` | Cancel tool, deselect, or open the menu |

## Code layout

```
src/
  sim/          The game itself, in plain TypeScript (no Phaser): runs headless.
    content.ts    Every number and every piece of content
    grid.ts       Tiles, digging, connectivity
    pathfinding.ts  Dijkstra used by the hero AI and route preview
    sim.ts        Tick loop: parties, hero AI, monsters, traps, the Maw, rumors
    meta.ts       Prestige (Teeth) upgrades
    save.ts       Save files, export codes, offline earnings
    bot.ts        Scripted player for balance tests and the title backdrop
  game/
    art/          Pixel art: ASCII sprites and procedural tiles, drawn to canvases at boot
    keeper.ts     Runs the current dungeon, saving, speed, tools, events to sound/log
    scene.ts      Phaser scene: isometric rendering, effects, camera, input
  audio/          Synthesized sound effects and a chiptune sequencer
  ui/             HTML HUD, title, collapse and Teeth screens
tests/            Vitest suites, including whole-run balance checks
dev/art.html      Preview sheet of every generated sprite (open via npm run dev)
```

The simulation advances in fixed 50 ms ticks; the renderer interpolates between them.
Because the sim has no rendering code, the balance tests can play full 30–60 minute
dungeons in well under a second each.

Saves live in browser storage (`munchkeep.save.v1`). The settings menu can copy a save
code to back up or move progress.
