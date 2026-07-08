using MunchKeep.Core;
using MunchKeep.Simulation;
using MunchKeep.Simulation.Dungeon;

namespace MunchKeep.Tests;

/// <summary>Builders and runners shared by the sim tests. Everything here is headless.</summary>
internal static class TestWorld
{
    /// <summary>Balance tuned so tests don't wait 45s of sim time between parties.</summary>
    public static BalanceConfig FastBalance() => new()
    {
        PartyIntervalSeconds = 2f,
        SpawnStaggerSeconds = 0.1f,
    };

    public static Sim Empty(BalanceConfig balance, int seed = 42) =>
        new(balance, seed, balance.StartEssence, balance.StartScrap, 0, balance.HeartMaxHp);

    /// <summary>Connects entrance to heart along the entrance row, choosing each cell's room type.</summary>
    public static void BuildPath(Sim sim, Func<int, RoomType>? roomAt = null)
    {
        var y = sim.Grid.Entrance.Y;
        for (var x = sim.Grid.Entrance.X + 1; x < sim.Grid.Heart.X; x++)
            sim.Grid.Build(new GridPos(x, y), roomAt?.Invoke(x) ?? RoomType.Corridor);
    }

    /// <summary>Ticks the sim for the given duration, collecting every event raised.</summary>
    public static List<SimEvent> RunSeconds(Sim sim, float seconds)
    {
        var events = new List<SimEvent>();
        var ticks = (int)MathF.Ceiling(seconds / Sim.TickSeconds);
        for (var i = 0; i < ticks; i++)
        {
            sim.Tick();
            events.AddRange(sim.Events);
        }
        return events;
    }
}
