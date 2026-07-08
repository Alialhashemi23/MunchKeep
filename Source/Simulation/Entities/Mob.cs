namespace MunchKeep.Simulation.Entities;

/// <summary>A dungeon defender. Lives inside a MobRoom and never moves (milestone 1).</summary>
public sealed class Mob
{
    public int Level { get; init; } = 1;
    public float Hp { get; set; }
    public float MaxHp { get; init; }
    public float AttackDamage { get; init; }
    public float AttackCooldown { get; init; }
    public float AttackTimer { get; set; }

    public bool Alive => Hp > 0f;

    public static Mob Spawn(BalanceConfig balance, int level)
    {
        var maxHp = balance.MobBaseHp + balance.MobHpPerLevel * (level - 1);
        return new Mob
        {
            Level = level,
            MaxHp = maxHp,
            Hp = maxHp,
            AttackDamage = balance.MobBaseDamage + balance.MobDamagePerLevel * (level - 1),
            AttackCooldown = balance.MobAttackCooldown,
        };
    }
}
