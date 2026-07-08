namespace MunchKeep.Simulation;

/// <summary>
/// Every tunable number in the game. Loaded from Content/Data/balance.json at runtime;
/// the property initializers below double as the fallback defaults, so the sim (and its
/// tests) work even without the JSON file present.
/// </summary>
public sealed class BalanceConfig
{
    // Grid
    public int GridWidth { get; set; } = 24;
    public int GridHeight { get; set; } = 24;
    public int EntranceX { get; set; } = 2;
    public int EntranceY { get; set; } = 11;
    public int HeartX { get; set; } = 12;
    public int HeartY { get; set; } = 11;

    // Economy
    public int StartEssence { get; set; } = 60;
    public int StartScrap { get; set; } = 0;
    public int CorridorCost { get; set; } = 5;
    public int MobRoomCost { get; set; } = 25;
    public int TrapRoomCost { get; set; } = 20;
    public float DemolishRefund { get; set; } = 0.5f;

    // Heroes
    public float HeroBaseHp { get; set; } = 30f;
    public float HeroHpPerLevel { get; set; } = 12f;
    public float HeroBaseDamage { get; set; } = 4f;
    public float HeroDamagePerLevel { get; set; } = 1.5f;
    public float HeroAttackCooldown { get; set; } = 1.0f;
    public float HeroSpeed { get; set; } = 1.8f; // tiles per second
    public float HeroLootEssencePerLevel { get; set; } = 10f;
    public float HeroLootScrapPerLevel { get; set; } = 3f;

    // Mobs
    public float MobBaseHp { get; set; } = 20f;
    public float MobHpPerLevel { get; set; } = 8f;
    public float MobBaseDamage { get; set; } = 3f;
    public float MobDamagePerLevel { get; set; } = 1.2f;
    public float MobAttackCooldown { get; set; } = 0.8f;
    public float MobRespawnSeconds { get; set; } = 15f;
    public int MobUpgradeBaseCost { get; set; } = 5;
    public float MobUpgradeCostGrowth { get; set; } = 1.6f;

    // Traps
    public float TrapDamage { get; set; } = 8f;
    public float TrapRearmSeconds { get; set; } = 3f;

    // Party spawning / renown
    public float PartyIntervalSeconds { get; set; } = 45f;
    public float SpawnStaggerSeconds { get; set; } = 0.6f;
    public float RenownPerHeroLevel { get; set; } = 15f;
    public float RenownPerPartySize { get; set; } = 20f;
    public int MaxPartySize { get; set; } = 3;
    public float RenownPerKillPerLevel { get; set; } = 1f;
    public float PartyWipeRenown { get; set; } = 3f;

    // Dungeon Heart
    public float HeartMaxHp { get; set; } = 100f;
    public float HeartRegenPerSecond { get; set; } = 0.5f;
    public float HeartStealFractionPerHit { get; set; } = 0.02f;
    public int HeartHitsPerHero { get; set; } = 5;
    public float HeartBreakResourceLoss { get; set; } = 0.25f;
    public float HeartBreakRenownLoss { get; set; } = 0.1f;

    // Corpses & harvest
    public float CorpseDissolveSeconds { get; set; } = 4f;

    // Offline progress
    public float OfflineCapHours { get; set; } = 8f;
    public float OfflineEfficiency { get; set; } = 0.5f;

    public int MobUpgradeCost(int currentLevel) =>
        (int)MathF.Ceiling(MobUpgradeBaseCost * MathF.Pow(currentLevel, MobUpgradeCostGrowth));
}
