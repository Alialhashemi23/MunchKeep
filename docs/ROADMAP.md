# MunchKeep Roadmap

## Milestone 1 — Vertical slice ✅ (shipped)

The full idle loop, verified by 23 headless tests and a live run:
renown-scaled parties pathfind to the Dungeon Heart; goblin dens and spike traps
kill them; corpses harvest into Essence/Scrap; build/demolish/upgrade; Heart HP
with steal + shatter-setback rules; capped offline earnings. Placeholder art via
the `Content/Assets/sprites.json` manifest; every number in
`Content/Data/balance.json`.

## Milestone 2 — "A game you want to keep playing"

Content variety and strategic depth on top of existing systems:

- **Hero classes** — Warrior (tanky), Rogue (fast, can slip past armed traps),
  Cleric (party heal-over-time). Touches `Source/Simulation/Entities/Hero.cs`,
  `Source/Simulation/Progression/PartyGenerator.cs`; stats data-driven in
  `balance.json`; new `unit.hero.*` sprite ids.
- **Second mob + trap** — Brute den (slow, heavy hits) and Poison vent
  (damage-over-time). Follow the existing `Room`/`Mob` patterns; extend `RoomType`.
- **Treasure Bait room** — heroes detour to loot it before heading to the Heart
  (A* target override), making routing the core puzzle. Loot is reclaimed when
  they die inside.
- **Speed controls** — pause/1x/2x/4x multiplier on the tick accumulator in
  `Source/Presentation/Screens/PlayScreen.cs`, plus HUD buttons.
- **Drag-paint corridors** — build-on-hold for corridor mode in `HandleGridClick`.
- Extend `MunchKeep.Tests/AutoPlayTests.cs` to cover the new content headlessly.

## Milestone 3 — Art, sound & juice

- Commit CC0 art (Kenney *Isometric Miniature Dungeon* for tiles, *Tiny Dungeon*
  for characters, UI pack) under `Content/Assets/`, then fill in `sprites.json`
  texture entries. Note: kenney.nl must be downloaded outside the CI/agent
  sandbox (its egress policy blocks the host) and committed to the repo.
- Walk/attack animation frames via manifest frame lists.
- Runtime SFX (`SoundEffect.FromStream` + committed CC0 wavs): hits, death poof,
  harvest chime, heart alarm. Screen shake on heart hits.

## Milestone 4 — Progression & meta

- **Weapon Materials**: tier-2 resource dropped by high-level heroes, gating a new
  upgrade track (trap tiers, den capacity).
- Dungeon-wide research/perks; renown milestones that send named "champion"
  mini-boss parties.
- Optional prestige ("Collapse the dungeon") for long-term retention.

## Milestone 5 — Ship it

- GitHub Actions CI: `dotnet build` + `dotnet test` on push/PR.
- `dotnet publish` packaging for Windows/Linux/macOS; itch.io butler upload script.
- PR from `claude/repo-review-ixmd1r` → `master` when ready to review and merge.
