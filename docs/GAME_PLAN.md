# MunchKeep game plan (v2: room map)

*You are the dungeon. They are the food.*

A real-time, top-down, pixel-art dungeon game for desktop browsers. You buy rooms
from a catalog, link them with corridors on a cave map, upgrade them, and steer
adventurer parties through them on their way to the Maw.

v2 replaced v1's isometric tile grid (dig and fill single squares) with a map of
room sites joined by corridors, after playtest feedback that the grid was hard to
read and felt like editing squares rather than building a dungeon.

## Decisions

| Question | Choice |
|---|---|
| Tech | Web: Vite + TypeScript + Phaser 3. Simulation is plain TypeScript, tested with Vitest. |
| View | 3/4 top-down: rooms are chambers with front wall faces; tunnels between doorways. |
| Map | Generated cave per dungeon: ~22 room sites and the corridors possible between them. |
| Map growth | Start with a small cleared area; spend Essence to excavate neighboring regions. |
| Rooms | Bought from a catalog onto empty sites. Infamy tiers unlock more during a run; Teeth buy blueprints between runs. |
| Upgrades | Three tracks per room, three ranks each; rank 3 costs Essence. |
| Currencies | Gold (loot) for most things; Essence (from dead heroes) for monster rooms, top ranks, excavation. |
| Heroes | Parties move as a group. Monster rooms block until cleared; trap rooms hit while crossing. |
| Unchanged from v1 | Real-time with pause, the Maw, Champions, rumors, Teeth prestige, offline earnings, audio and effects. |

## The map

- Each dungeon generates a cave (Poisson-disk sites, Gabriel-graph corridors that never cut through a room). The Gate is at the top, the Maw at the bottom.
- The shortest Gate-to-Maw chain starts dug. The rest of the cave is in darkness, split into about five regions.
- **Excavate** a region bordering what you have (15, 30, 50, 75, 110... Essence) to reveal its sites and corridors.
- **Dig** any possible corridor between two excavated sites for Gold (2 per tile). **Fill** one back for half, unless it would cut the Maw off or heroes are in it.
- Empty sites are walkable caverns. Rooms joined by a corridor are **linked**.

## Rooms

| Tier (Infamy) | Room | Kind | Effect |
|---|---|---|---|
| 0 | Goblin Warren | Monster | 3 goblins that respawn |
| 0 | Spike Hall | Trap | Stabs a hero every 1.5s while the party crosses; ×2 vs Sticky |
| 0 | Treasure Vault | Lure | Visible to heroes; greedy parties detour, Rogues raid it alone |
| 0 | Larder | Support | Linked monster rooms respawn 2× faster and heal |
| 30 | Slime Pit | Monster | 2 slimes; hits make heroes Sticky |
| 30 | Oil Cellar | Trap | Everyone crossing becomes Oily; crossing 40% slower |
| 30 | Flame Gallery | Trap | Bursts hit the whole party; ignites Oily heroes |
| 30 | Gloom Hall | Support | Linked traps cannot be spotted or disarmed |
| 90 | Bone Crypt | Monster | 3 skeletons that reassemble once |
| 90 | Gullet | Economy | Deaths in it or linked rooms pay +50% Gold and Essence |
| 160 | Mimic Vault | Monster | Looks like a Vault; triple-damage ambush |
| 160 | Troll Den | Monster | One regenerating troll that hits two heroes per swing |
| Blueprint | Soul Well | Economy | Trickles Essence; more per death in linked rooms |
| Blueprint | Spider Nest | Monster | Webs (Sticky) and poison |
| Blueprint | Pit Drop | Trap | Heroes may fall in; linked to a Gullet they are eaten outright |

Every room has three upgrade tracks (for example Spike Hall: Sharper, Quicker, Barbed;
Goblin Warren: Numbers, Spears, Shaman). Rank costs are 0.6×, 1.1× and 1.6× the room's
Gold price; rank 3 also costs 15 + 10×tier Essence. Selling refunds half.

## Heroes

- Parties spawn at the Gate and route with Dijkstra over dug corridors. Cost = walking time + fear × believed danger of each room.
- Party fear and greed are the average of its members (Knight 0.15 / 0.1, Rogue 0.6 / 1.0, Cleric 1.0 / 0.3). Champions are far braver.
- Heroes know the corridor layout but not what is in a room until they enter it, a Rogue peeks into it (50% per neighbor), or a rumor says so. Unknown rooms count as mild danger. Vaults are always visible.
- Greedy parties detour to a Vault when the treasure outweighs the detour. A Rogue whose own score is high enough splits off alone to raid it, then heads home with the loot.
- Monster rooms block: the party fights until no monster stands. Trap rooms fire while the party is inside. Rogues try to disarm traps they know about (60%), unless a Gloom Hall is linked.
- Rogues flee alone at 40% HP, Clerics at 25%. Heroes who reach the Maw bite it three times, steal Gold, and run.
- Escaped heroes report every trap and monster room their party knew about; later parties start with those rumors (eye marker) for four minutes. Trap rumors bring more Rogues.
- A named Champion arrives every 8 minutes.

## Prestige

Teeth per collapse = ⌊(√Infamy × 0.6 + 2 × Champions eaten) × Dreadful Legend bonus⌋.

- Upgrades: Deep Pockets, Thick Hide, Sharp Fangs, Cheap Labor, Gourmand (now also Essence), Dreadful Legend, Low Profile, Old Recipes (starts with a Goblin Warren and Spike Hall built and tier 2 unlocked).
- Blueprints: Soul Well (5), Spider Nest (7), Pit Drop (10).
- v1 saves: dungeons are dropped; banked Teeth carry over and every v1 upgrade is refunded as Teeth.

## Balance targets (checked by `tests/balance.test.ts`)

A scripted bot plays whole dungeons headless across five seeds:

- Doing nothing collapses in under 10 minutes.
- A beginner (monster rooms and spike halls on the starting route) lasts 9–25 minutes.
- A decent player (support rooms in the right places, route extension, excavation, upgrades) lasts 30–60 minutes.
- A maxed prestige tree adds at least 3 minutes.

## Next steps

- Direct intervention: spells, dropping boulders, possessing a monster.
- More heroes (Mage, Ranger) and more rooms; big-room sites.
- Late-game Gold sinks (Gold piles up once every room is maxed).
- A minimap.
