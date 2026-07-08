using MunchKeep.Simulation.Entities;

namespace MunchKeep.Simulation.Dungeon;

/// <summary>A single built cell of the dungeon. One cell = one room in milestone 1.</summary>
public sealed class Room
{
    public RoomType Type { get; init; }

    /// <summary>Occupying mob for MobRooms; null while waiting to respawn.</summary>
    public Mob? Mob { get; set; }
    public float MobRespawnTimer { get; set; }
    public int MobLevel { get; set; } = 1;

    /// <summary>Trap state for TrapRooms. Armed when RearmTimer &lt;= 0.</summary>
    public float TrapRearmTimer { get; set; }
    public bool TrapArmed => Type == RoomType.TrapRoom && TrapRearmTimer <= 0f;
}
