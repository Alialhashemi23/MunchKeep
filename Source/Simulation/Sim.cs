using MunchKeep.Core;
using MunchKeep.Simulation.Dungeon;
using MunchKeep.Simulation.Economy;
using MunchKeep.Simulation.Entities;
using MunchKeep.Simulation.Pathfinding;
using MunchKeep.Simulation.Progression;

namespace MunchKeep.Simulation;

/// <summary>
/// The whole game world, advanced by fixed 100ms ticks. Contains no MonoGame types:
/// the presentation layer reads this state and interpolates, and tests drive it headless.
/// </summary>
public sealed class Sim
{
    public const float TickSeconds = 0.1f;

    public BalanceConfig Balance { get; }
    public DungeonGrid Grid { get; }
    public ResourceBank Bank { get; }
    public Rng Rng { get; }

    public double Renown { get; set; }
    public float HeartHp { get; set; }
    public float HeartMaxHp => Balance.HeartMaxHp;

    public List<Hero> Heroes { get; } = new();
    public List<Corpse> Corpses { get; } = new();
    public List<SimEvent> Events { get; } = new();

    public float PartyTimer { get; set; }
    public int PartyCounter { get; set; }
    public long TickCount { get; set; }
    public double SessionSeconds { get; private set; }
    public double SessionRenownEarned { get; private set; }

    /// <summary>Income rates carried over from the previous session (for offline estimates).</summary>
    public double LoadedEssenceRate { get; set; }
    public double LoadedScrapRate { get; set; }
    public double LoadedRenownRate { get; set; }

    private readonly List<(Hero Hero, float Delay)> _pendingSpawns = new();
    private int _nextHeroId;

    public Sim(BalanceConfig balance, int seed, double essence, double scrap, double renown, float heartHp)
    {
        Balance = balance;
        Grid = new DungeonGrid(balance);
        Bank = new ResourceBank(essence, scrap);
        Rng = new Rng(seed);
        Renown = renown;
        HeartHp = heartHp;
        PartyTimer = balance.PartyIntervalSeconds;
    }

    /// <summary>Fresh game: a corridor from the entrance to the heart with one goblin room mid-path.</summary>
    public static Sim CreateNew(BalanceConfig balance, int seed)
    {
        var sim = new Sim(balance, seed, balance.StartEssence, balance.StartScrap, 0, balance.HeartMaxHp);
        var y = sim.Grid.Entrance.Y;
        var mobX = (sim.Grid.Entrance.X + sim.Grid.Heart.X) / 2;
        for (var x = sim.Grid.Entrance.X + 1; x < sim.Grid.Heart.X; x++)
        {
            var type = x == mobX ? RoomType.MobRoom : RoomType.Corridor;
            sim.Grid.Build(new GridPos(x, y), type);
        }
        return sim;
    }

    // ------------------------------------------------------------------ player actions

    public bool TryBuild(GridPos pos, RoomType type)
    {
        if (!Grid.CanBuild(pos)) return false;
        if (!Bank.TrySpend(Grid.BuildCost(type))) return false;
        Grid.Build(pos, type);
        return true;
    }

    public bool TryDemolish(GridPos pos)
    {
        if (!Grid.CanDemolish(pos)) return false;
        Bank.Grant(Grid.Demolish(pos));
        return true;
    }

    public bool TryUpgradeMob(GridPos pos)
    {
        if (Grid.GetRoom(pos) is not { Type: RoomType.MobRoom } room) return false;
        if (!Bank.TrySpend(0, Balance.MobUpgradeCost(room.MobLevel))) return false;
        room.MobLevel++;
        room.Mob = Mob.Spawn(Balance, room.MobLevel); // upgrade also heals/respawns
        room.MobRespawnTimer = 0f;
        return true;
    }

    // ------------------------------------------------------------------ tick

    public void Tick()
    {
        const float dt = TickSeconds;
        Events.Clear();
        TickCount++;
        SessionSeconds += dt;

        foreach (var hero in Heroes)
        {
            hero.PrevX = hero.X;
            hero.PrevY = hero.Y;
        }

        TickPartySpawning(dt);
        TickRooms(dt);
        TickHeroes(dt);
        TickMobAttacks(dt);
        TickCorpses(dt);
        TickHeart(dt);

        Heroes.RemoveAll(h => h.State == HeroState.Dead);
    }

    private void TickPartySpawning(float dt)
    {
        PartyTimer -= dt;
        if (PartyTimer <= 0f)
        {
            PartyTimer += Balance.PartyIntervalSeconds;
            if (Grid.HeartReachable)
            {
                PartyCounter++;
                var heroes = PartyGenerator.Generate(Balance, Renown, PartyCounter, ref _nextHeroId, Grid.Entrance, Rng);
                for (var i = 0; i < heroes.Count; i++)
                    _pendingSpawns.Add((heroes[i], i * Balance.SpawnStaggerSeconds));
                Events.Add(new SimEvent(SimEventType.PartySpawned, Grid.Entrance.X, Grid.Entrance.Y, heroes.Count, heroes[0].Level));
            }
        }

        for (var i = _pendingSpawns.Count - 1; i >= 0; i--)
        {
            var (hero, delay) = _pendingSpawns[i];
            delay -= dt;
            if (delay <= 0f)
            {
                Heroes.Add(hero);
                _pendingSpawns.RemoveAt(i);
            }
            else
            {
                _pendingSpawns[i] = (hero, delay);
            }
        }
    }

    private void TickRooms(float dt)
    {
        foreach (var (pos, room) in Grid.Rooms())
        {
            if (room.Type == RoomType.TrapRoom && room.TrapRearmTimer > 0f)
                room.TrapRearmTimer -= dt;

            if (room.Type == RoomType.MobRoom && room.Mob is null)
            {
                room.MobRespawnTimer -= dt;
                if (room.MobRespawnTimer <= 0f)
                {
                    room.Mob = Mob.Spawn(Balance, room.MobLevel);
                    Events.Add(new SimEvent(SimEventType.MobRespawned, pos.X, pos.Y));
                }
            }

            if (room.Mob is { } mob && mob.AttackTimer > 0f)
                mob.AttackTimer -= dt;
        }
    }

    private void TickHeroes(float dt)
    {
        // Iterate over a snapshot index range; heroes are only appended by spawning
        // (handled earlier) and removal happens at end of Tick.
        for (var i = 0; i < Heroes.Count; i++)
        {
            var hero = Heroes[i];
            if (!hero.Alive) continue;
            if (hero.AttackTimer > 0f) hero.AttackTimer -= dt;

            switch (hero.State)
            {
                case HeroState.Moving:
                    if (!EnsurePath(hero)) break;
                    MoveHero(hero, dt);
                    break;

                case HeroState.Fighting:
                    TickHeroFighting(hero);
                    break;

                case HeroState.AttackingHeart:
                    TickHeroAtHeart(hero);
                    break;
            }
        }
    }

    /// <summary>Recomputes the hero's path if the dungeon changed. Returns false if the hero despawned.</summary>
    private bool EnsurePath(Hero hero)
    {
        var upToDate = hero.PathGridVersion == Grid.Version && hero.PathIndex <= hero.Path.Count;
        if (upToDate) return true;

        var target = hero.Goal == HeroGoal.ReachHeart ? Grid.Heart : Grid.Entrance;
        var path = AStar.FindPath(Grid, hero.Cell, target);
        if (path is null && hero.Goal == HeroGoal.ReachHeart)
        {
            hero.Goal = HeroGoal.Escape; // heart unreachable: give up and head home
            path = AStar.FindPath(Grid, hero.Cell, Grid.Entrance);
        }
        if (path is null)
        {
            // Fully stranded (dungeon demolished around them): vanish in a puff of narrative.
            hero.State = HeroState.Dead;
            return false;
        }
        hero.Path = path;
        hero.PathIndex = 1; // skip own cell so we don't re-trigger it
        hero.PathGridVersion = Grid.Version;
        return true;
    }

    private void MoveHero(Hero hero, float dt)
    {
        while (dt > 0f && hero.PathIndex < hero.Path.Count)
        {
            var target = hero.Path[hero.PathIndex];
            var dx = target.X - hero.X;
            var dy = target.Y - hero.Y;
            var dist = MathF.Sqrt(dx * dx + dy * dy);
            var step = hero.Speed * dt;

            if (step >= dist)
            {
                hero.X = target.X;
                hero.Y = target.Y;
                hero.PathIndex++;
                dt -= dist / hero.Speed;
                OnEnterCell(hero, target);
                if (hero.State != HeroState.Moving) return;
            }
            else
            {
                hero.X += dx / dist * step;
                hero.Y += dy / dist * step;
                return;
            }
        }
    }

    private void OnEnterCell(Hero hero, GridPos cell)
    {
        var room = Grid.GetRoom(cell);
        if (room is null) return;

        if (room.TrapArmed)
        {
            room.TrapRearmTimer = Balance.TrapRearmSeconds;
            Events.Add(new SimEvent(SimEventType.TrapFired, cell.X, cell.Y));
            DamageHero(hero, Balance.TrapDamage);
            if (!hero.Alive) return;
        }

        if (room.Mob is { Alive: true })
        {
            hero.State = HeroState.Fighting;
            return;
        }

        if (cell == Grid.Heart && hero.Goal == HeroGoal.ReachHeart)
        {
            hero.State = HeroState.AttackingHeart;
            return;
        }

        if (cell == Grid.Entrance && hero.Goal == HeroGoal.Escape)
        {
            hero.State = HeroState.Dead; // removed at end of tick; loot leaves with them
            Events.Add(new SimEvent(SimEventType.HeroEscaped, cell.X, cell.Y, (float)hero.StolenEssence));
        }
    }

    private void TickHeroFighting(Hero hero)
    {
        var room = Grid.GetRoom(hero.Cell);
        if (room?.Mob is not { Alive: true } mob)
        {
            hero.State = HeroState.Moving; // fight over, resume the march
            return;
        }

        if (hero.AttackTimer <= 0f)
        {
            hero.AttackTimer += hero.AttackCooldown;
            mob.Hp -= hero.AttackDamage;
            Events.Add(new SimEvent(SimEventType.Damage, hero.X, hero.Y - 0.3f, hero.AttackDamage));
            if (!mob.Alive)
            {
                room.Mob = null;
                room.MobRespawnTimer = Balance.MobRespawnSeconds;
                Events.Add(new SimEvent(SimEventType.MobDied, hero.X, hero.Y));
                hero.State = HeroState.Moving;
            }
        }
    }

    private void TickHeroAtHeart(Hero hero)
    {
        if (hero.AttackTimer > 0f) return;
        hero.AttackTimer += hero.AttackCooldown;

        HeartHp -= hero.AttackDamage;
        var (essence, scrap) = Bank.Steal(Balance.HeartStealFractionPerHit);
        hero.StolenEssence += essence;
        hero.StolenScrap += scrap;
        hero.HeartHitsRemaining--;
        Events.Add(new SimEvent(SimEventType.HeartDamaged, Grid.Heart.X, Grid.Heart.Y, hero.AttackDamage));
        if (essence >= 1)
            Events.Add(new SimEvent(SimEventType.ResourceStolen, Grid.Heart.X, Grid.Heart.Y, (float)essence));

        if (HeartHp <= 0f)
        {
            BreakHeart();
        }
        else if (hero.HeartHitsRemaining <= 0)
        {
            SendHome(hero);
        }
    }

    private void BreakHeart()
    {
        Bank.LoseFraction(Balance.HeartBreakResourceLoss);
        Renown *= 1 - Balance.HeartBreakRenownLoss;
        HeartHp = Balance.HeartMaxHp * 0.5f;
        Events.Add(new SimEvent(SimEventType.HeartBroken, Grid.Heart.X, Grid.Heart.Y));
        foreach (var hero in Heroes)
            if (hero.Alive)
                SendHome(hero);
    }

    private void SendHome(Hero hero)
    {
        hero.Goal = HeroGoal.Escape;
        hero.State = HeroState.Moving;
        hero.PathGridVersion = -1; // force re-path
    }

    private void TickMobAttacks(float dt)
    {
        foreach (var (pos, room) in Grid.Rooms())
        {
            if (room.Mob is not { Alive: true } mob || mob.AttackTimer > 0f) continue;
            foreach (var hero in Heroes)
            {
                if (!hero.Alive || hero.Cell != pos) continue;
                mob.AttackTimer += mob.AttackCooldown;
                DamageHero(hero, mob.AttackDamage);
                break; // one target per swing
            }
        }
    }

    private void DamageHero(Hero hero, float damage)
    {
        hero.Hp -= damage;
        Events.Add(new SimEvent(SimEventType.Damage, hero.X, hero.Y, damage));
        if (hero.Hp > 0f) return;

        hero.State = HeroState.Dead;
        Corpses.Add(new Corpse
        {
            X = hero.X,
            Y = hero.Y,
            Timer = Balance.CorpseDissolveSeconds,
            Essence = Balance.HeroLootEssencePerLevel * hero.Level + hero.StolenEssence,
            Scrap = Balance.HeroLootScrapPerLevel * hero.Level + hero.StolenScrap,
        });
        Events.Add(new SimEvent(SimEventType.HeroDied, hero.X, hero.Y));

        var renownGain = Balance.RenownPerKillPerLevel * hero.Level;
        var partyWiped = !_pendingSpawns.Any(p => p.Hero.PartyId == hero.PartyId)
                         && !Heroes.Any(h => h != hero && h.Alive && h.PartyId == hero.PartyId);
        if (partyWiped)
            renownGain += Balance.PartyWipeRenown;
        Renown += renownGain;
        SessionRenownEarned += renownGain;
    }

    private void TickCorpses(float dt)
    {
        for (var i = Corpses.Count - 1; i >= 0; i--)
        {
            var corpse = Corpses[i];
            corpse.Timer -= dt;
            if (corpse.Timer > 0f) continue;
            Bank.Earn(corpse.Essence, corpse.Scrap);
            Events.Add(new SimEvent(SimEventType.Harvest, corpse.X, corpse.Y, (float)corpse.Essence, (float)corpse.Scrap));
            Corpses.RemoveAt(i);
        }
    }

    private void TickHeart(float dt)
    {
        if (HeartHp < HeartMaxHp)
            HeartHp = MathF.Min(HeartMaxHp, HeartHp + Balance.HeartRegenPerSecond * dt);
    }

    // ------------------------------------------------------------------ offline-rate bookkeeping

    /// <summary>
    /// Income rates to persist: session averages once we have enough data,
    /// otherwise whatever the previous session measured.
    /// </summary>
    public (double Essence, double Scrap, double Renown) CurrentIncomeRates()
    {
        const double minSample = 120; // seconds of play before we trust the new average
        if (SessionSeconds < minSample)
            return (LoadedEssenceRate, LoadedScrapRate, LoadedRenownRate);
        return (
            Bank.SessionEssenceEarned / SessionSeconds,
            Bank.SessionScrapEarned / SessionSeconds,
            SessionRenownEarned / SessionSeconds);
    }
}
