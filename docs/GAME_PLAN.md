# MunchKeep game plan

*You are the dungeon. They are the food.*

A real-time, isometric, pixel-art dungeon-management game for desktop browsers.
You shape a living dungeon so that greedy, scared or reckless adventurers walk
the routes you want, then you eat them.

## Decisions

| Question | Choice |
|---|---|
| Tech | Web: Vite + TypeScript + Phaser 3. Simulation is plain TypeScript, tested with Vitest. |
| Concept | Keep "living dungeon vs. adventurers", rebuild the execution. |
| What was wrong before | Ugly / no juice, and too shallow. |
| Play style | Real-time management (with pause and 1×/2×/3×). |
| View | Isometric. |
| Art | Chunky pixel art drawn in code; goofy, darkly funny tone. |
| Depth | Smarter hero variety, monster/trap synergies, room adjacency combos. |
| Progression | Endless with prestige. Runs of 30–60 minutes. |
| Heart destroyed | Forced collapse into a prestige reset (Teeth). |
| Devices | Desktop browser only: mouse and keyboard. |
| Audio | Generated retro SFX and a chiptune loop with intensity layers. |
| Offline | Capped earnings: 2 hours at 25% of the dungeon's kill rate. Gold only. |
| Scope | Polished vertical slice first, then iterate. |
| Playtesting | Private hosted link after each build. |

## Core loop

1. Hero parties arrive at the gate and head for **the Maw**, the dungeon's heart and mouth.
2. You dig tunnels, place monsters, traps and rooms, and rearrange them live. Heroes re-plan as soon as the layout changes.
3. Dead heroes turn into **Gold**; kills raise **Infamy**, which unlocks builds and attracts tougher parties.
4. Heroes reaching the Maw bite it three times, steal Gold and run. If its HP hits zero, the dungeon collapses.
5. A collapse pays **Teeth**, spent on permanent upgrades for every future dungeon.

## Hero AI

Each class weighs greed, fear and bravery when choosing a route (weighted Dijkstra
over the grid). Greedy heroes detour to Hoards when the detour is worth it.

| Class | Behavior |
|---|---|
| Knight | Slow, armored, almost fearless. Monsters attack Knights first. |
| Rogue | Fast, very greedy. Spots and disarms traps (unless Gloom hides them). Flees at 40% HP. |
| Cleric | Heals nearby heroes. Fears known danger and routes around it. Flees at 25% HP. |

**Rumors:** a hero who escapes reports every trap and Mimic its party learned about.
Later parties start out knowing those tiles (shown with an eye marker) and the
class mix shifts toward counters (trap rumors bring more Rogues).

**Champions:** every 8 minutes a named Champion leads a party: +2 levels, double HP,
1.5× damage, five times the reward.

## Content (vertical slice)

| Build | Kind | Synergy |
|---|---|---|
| Goblin Den | Lair (2 goblins) | Larder touching it: double respawn speed, heal while idle |
| Spikes | Trap | Double damage to Sticky heroes |
| Hoard | Room | Lures greedy heroes, who stand still 2s to loot; traps touching it reset twice as fast |
| Slime Pit | Lair (1 slime) | Hits make heroes Sticky (half speed) |
| Larder | Room | Lairs touching it respawn twice as fast and heal |
| Oil Slick | Trap | Makes heroes Oily (slow); Fire Vents ignite them |
| Gloom | Room | Traps touching it cannot be spotted or disarmed; slows heroes |
| Fire Vent | Trap | Area damage within 1 tile; ignites Oily heroes for a 4s burn |
| Gullet | Room | Heroes killed on or touching it pay +50% Gold |
| Mimic | Lair | Looks like a Hoard to heroes; triple-damage ambush |

Unlocks by Infamy: start (Goblin Den, Spikes, Hoard), 15 (Slime Pit, Larder),
45 (Oil, Gloom), 90 (Fire Vent, Gullet), 150 (Mimic).
Lairs and traps upgrade to level 5. The Maw itself can be fed Gold to grow (10 levels).

## Prestige tree (Teeth)

Teeth per collapse = ⌊(√Infamy × 0.6 + 2 × Champions eaten) × Dreadful Legend bonus⌋.

| Upgrade | Effect per level | Max |
|---|---|---|
| Deep Pockets | +100 starting Gold | 3 |
| Thick Hide | +30% Maw HP | 3 |
| Sharp Fangs | +40% Maw chomp damage | 3 |
| Cheap Labor | −10% build and upgrade costs | 3 |
| Gourmand | +20% Gold from kills | 3 |
| Dreadful Legend | +25% Teeth per collapse | 2 |
| Low Profile | Parties grow stronger 10% more slowly | 3 |
| Old Recipes | Start with a Slime Pit and Spikes built; four builds unlocked | 1 |

## Balance targets (checked by `tests/balance.test.ts`)

A scripted bot plays whole dungeons headless across five seeds:

- Doing nothing collapses in under 10 minutes (the first Champion ends it).
- A beginner (monsters and spikes on the main path) lasts 10–28 minutes.
- A decent player (rooms, synergies, upgrades) lasts 30–60 minutes.
- A maxed prestige tree adds at least 3 minutes to a decent player's run.

Difficulty grows with time (quadratically) and a little with Infamy, so even great
play eventually collapses and prestige stays meaningful.

## Next steps after this slice

- Direct intervention: spells, dropping boulders, possessing a monster.
- More heroes (Mage burns monsters, Ranger shoots from range) and more builds.
- A bigger prestige tree and named Champion modifiers.
- A second dungeon map shape.
