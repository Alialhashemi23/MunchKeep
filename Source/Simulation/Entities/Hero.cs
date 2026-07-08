using MunchKeep.Core;

namespace MunchKeep.Simulation.Entities;

public enum HeroState
{
    Moving,
    Fighting,
    AttackingHeart,
    Dead,
}

public enum HeroGoal
{
    ReachHeart,
    Escape,
}

/// <summary>
/// An adventurer working their way toward the Dungeon Heart (or fleeing back out).
/// Position is continuous grid coordinates; PrevX/PrevY hold last tick's position
/// for render interpolation.
/// </summary>
public sealed class Hero
{
    public int Id { get; init; }
    public int PartyId { get; init; }
    public int Level { get; init; } = 1;

    public float Hp { get; set; }
    public float MaxHp { get; init; }
    public float AttackDamage { get; init; }
    public float AttackCooldown { get; init; }
    public float AttackTimer { get; set; }
    public float Speed { get; init; }

    public HeroState State { get; set; } = HeroState.Moving;
    public HeroGoal Goal { get; set; } = HeroGoal.ReachHeart;
    public float X { get; set; }
    public float Y { get; set; }
    public float PrevX { get; set; }
    public float PrevY { get; set; }

    public List<GridPos> Path { get; set; } = new();
    public int PathIndex { get; set; }
    public int PathGridVersion { get; set; } = -1;

    /// <summary>Resources looted from the heart; returned to the player if the hero dies.</summary>
    public double StolenEssence { get; set; }
    public double StolenScrap { get; set; }
    public int HeartHitsRemaining { get; set; }

    public bool Alive => State != HeroState.Dead;
    public GridPos Cell => new((int)MathF.Round(X), (int)MathF.Round(Y));

    public static Hero Spawn(BalanceConfig balance, int id, int partyId, int level, GridPos at)
    {
        var maxHp = balance.HeroBaseHp + balance.HeroHpPerLevel * (level - 1);
        return new Hero
        {
            Id = id,
            PartyId = partyId,
            Level = level,
            MaxHp = maxHp,
            Hp = maxHp,
            AttackDamage = balance.HeroBaseDamage + balance.HeroDamagePerLevel * (level - 1),
            AttackCooldown = balance.HeroAttackCooldown,
            Speed = balance.HeroSpeed,
            X = at.X,
            Y = at.Y,
            PrevX = at.X,
            PrevY = at.Y,
            HeartHitsRemaining = balance.HeartHitsPerHero,
        };
    }
}
