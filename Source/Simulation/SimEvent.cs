namespace MunchKeep.Simulation;

public enum SimEventType
{
    Damage,          // Amount = damage dealt, at world position
    HeroDied,
    MobDied,
    MobRespawned,
    TrapFired,
    Harvest,         // Amount = essence, Amount2 = scrap
    HeartDamaged,
    HeartBroken,
    PartySpawned,    // Amount = party size, Amount2 = hero level
    ResourceStolen,  // Amount = essence stolen
    HeroEscaped,
}

/// <summary>
/// One-tick notifications from the simulation, consumed by the presentation layer to
/// spawn floating text / effects. Keeps the sim free of any rendering knowledge.
/// </summary>
public readonly record struct SimEvent(SimEventType Type, float X, float Y, float Amount = 0f, float Amount2 = 0f);
