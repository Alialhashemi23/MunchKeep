# MunchKeep

*You are the dungeon. They are the food.*

A real-time, top-down dungeon game for desktop browsers. Adventurer parties walk in
through the Gate and head for **the Maw**, your mouth and heart. Buy rooms from a
catalog, link them with corridors on a cave map, upgrade them, and eat the heroes who
pass through. When the Maw finally falls, the dungeon collapses and leaves Teeth behind
for permanent upgrades and new room blueprints.

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
| Click an empty site | Open the room catalog and build |
| Click a room | Room panel: upgrade tracks (`1` `2` `3`), sell |
| Drag from room to room | Dig a corridor (or click a dotted line) |
| Click a corridor | Fill it back in |
| Excavate button | Spend Essence to open a dark area |
| `M` | Feed the Maw (grow it) |
| `Space`, `T` | Pause, cycle speed (1×, 2×, 3×) |
| `R` | Show or hide hero routes |
| `WASD`, arrows, right-drag | Pan |
| Mouse wheel | Zoom |
| `Esc` | Close the panel, or open the menu |

## Code layout

```
src/
  sim/          The game itself, in plain TypeScript (no Phaser): runs headless.
    content.ts    Every number and every piece of content: rooms, tracks, heroes, prestige
    cave.ts       Cave generator: room sites, possible corridors, regions
    sim.ts        Tick loop: parties and routing, room encounters, traps, the Maw, rumors
    meta.ts       Prestige (Teeth) upgrades and blueprints
    save.ts       Save files (with v1 migration), export codes, offline earnings
    bot.ts        Scripted player for balance tests and the title-screen backdrop
  game/
    art/          Pixel art drawn in code at boot: ASCII sprites, top-down tiles, room props
    keeper.ts     Runs the current dungeon, saving, speed, selection, events to sound/log
    scene.ts      Phaser scene: terrain, fog, props, units, effects, camera, input
  audio/          Synthesized sound effects and a chiptune sequencer
  ui/             HTML HUD, room catalog, room panel, title/collapse/Teeth screens
tests/            Vitest suites (hand-made test cave), including whole-run balance checks
dev/art.html      Preview sheet of every generated sprite and room (open via npm run dev)
```

The simulation advances in fixed 50 ms ticks; the renderer interpolates between them.
Saves live in browser storage (`munchkeep.save.v2`); old `v1` saves are migrated.
