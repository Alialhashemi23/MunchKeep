using MunchKeep.Core;
using MunchKeep.Simulation;
using MunchKeep.Simulation.Dungeon;
using Xunit;

namespace MunchKeep.Tests;

public class DungeonGridTests
{
    [Fact]
    public void BuildingRequiresAdjacencyToExistingDungeon()
    {
        var sim = TestWorld.Empty(new BalanceConfig());
        var nextToEntrance = new GridPos(sim.Grid.Entrance.X + 1, sim.Grid.Entrance.Y);
        var farAway = new GridPos(20, 20);

        Assert.True(sim.Grid.CanBuild(nextToEntrance));
        Assert.False(sim.Grid.CanBuild(farAway));
        Assert.False(sim.Grid.CanBuild(sim.Grid.Entrance)); // occupied
    }

    [Fact]
    public void TryBuildChargesEssenceAndRefusesWhenBroke()
    {
        var balance = new BalanceConfig { StartEssence = 30 };
        var sim = TestWorld.Empty(balance);
        var cell = new GridPos(sim.Grid.Entrance.X + 1, sim.Grid.Entrance.Y);

        Assert.True(sim.TryBuild(cell, RoomType.MobRoom)); // 25e
        Assert.Equal(5, sim.Bank.Essence);
        Assert.NotNull(sim.Grid.GetRoom(cell)?.Mob); // mob rooms come staffed

        var next = new GridPos(cell.X + 1, cell.Y);
        Assert.False(sim.TryBuild(next, RoomType.TrapRoom)); // 20e > 5e
        Assert.Null(sim.Grid.GetRoom(next));
    }

    [Fact]
    public void DemolishRefundsHalfAndProtectsEntranceAndHeart()
    {
        var balance = new BalanceConfig();
        var sim = TestWorld.Empty(balance);
        var cell = new GridPos(sim.Grid.Entrance.X + 1, sim.Grid.Entrance.Y);
        sim.TryBuild(cell, RoomType.Corridor);
        var before = sim.Bank.Essence;

        Assert.True(sim.TryDemolish(cell));
        var refund = (int)(balance.CorridorCost * balance.DemolishRefund); // whole essence only
        Assert.Equal(before + refund, sim.Bank.Essence);
        Assert.False(sim.Grid.CanDemolish(sim.Grid.Entrance));
        Assert.False(sim.Grid.CanDemolish(sim.Grid.Heart));
    }

    [Fact]
    public void UpgradeMobSpendsScrapAndRespawnsStronger()
    {
        var balance = new BalanceConfig { StartScrap = 100 };
        var sim = TestWorld.Empty(balance);
        var cell = new GridPos(sim.Grid.Entrance.X + 1, sim.Grid.Entrance.Y);
        sim.TryBuild(cell, RoomType.MobRoom);
        var baseHp = sim.Grid.GetRoom(cell)!.Mob!.MaxHp;

        Assert.True(sim.TryUpgradeMob(cell));

        var room = sim.Grid.GetRoom(cell)!;
        Assert.Equal(2, room.MobLevel);
        Assert.True(room.Mob!.MaxHp > baseHp);
        Assert.Equal(100 - balance.MobUpgradeCost(1), sim.Bank.Scrap);
    }
}
