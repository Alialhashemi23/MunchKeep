using MunchKeep.Core;
using MunchKeep.Persistence;
using MunchKeep.Simulation;
using MunchKeep.Simulation.Dungeon;
using Xunit;

namespace MunchKeep.Tests;

public class SaveLoadTests : IDisposable
{
    private readonly string _savePath = Path.Combine(
        Path.GetTempPath(), $"munchkeep-test-{Guid.NewGuid():N}", "save.json");

    public void Dispose()
    {
        var dir = Path.GetDirectoryName(_savePath)!;
        if (Directory.Exists(dir)) Directory.Delete(dir, recursive: true);
    }

    [Fact]
    public void RoundTripPreservesEconomyDungeonAndMobLevels()
    {
        var balance = new BalanceConfig();
        var sim = Sim.CreateNew(balance, seed: 7);
        sim.Renown = 42.5;
        sim.HeartHp = 77f;
        var mobCell = sim.Grid.Rooms().First(r => r.Room.Type == RoomType.MobRoom).Pos;
        sim.Bank.Grant(0, 100);
        sim.TryUpgradeMob(mobCell);
        sim.TryBuild(new GridPos(mobCell.X, mobCell.Y + 1), RoomType.TrapRoom);
        var roomCount = sim.Grid.Rooms().Count();

        var manager = new SaveManager(_savePath);
        manager.Save(sim);
        var loaded = SaveManager.FromData(manager.Load()!, balance);

        Assert.Equal(sim.Bank.Essence, loaded.Bank.Essence, 3);
        Assert.Equal(sim.Bank.Scrap, loaded.Bank.Scrap, 3);
        Assert.Equal(42.5, loaded.Renown, 3);
        Assert.Equal(77f, loaded.HeartHp, 1);
        Assert.Equal(roomCount, loaded.Grid.Rooms().Count());
        Assert.Equal(2, loaded.Grid.GetRoom(mobCell)!.MobLevel);
        Assert.NotNull(loaded.Grid.GetRoom(mobCell)!.Mob);
        Assert.True(loaded.Grid.HeartReachable);
    }

    [Fact]
    public void LoadedSimKeepsRunning()
    {
        var balance = TestWorld.FastBalance();
        var sim = Sim.CreateNew(balance, seed: 7);
        var manager = new SaveManager(_savePath);
        manager.Save(sim);

        var loaded = SaveManager.FromData(manager.Load()!, balance);
        loaded.PartyTimer = 0.1f;
        var events = TestWorld.RunSeconds(loaded, 15f);

        Assert.Contains(events, e => e.Type == SimEventType.PartySpawned);
    }

    [Fact]
    public void MissingAndCorruptSavesReturnNull()
    {
        var manager = new SaveManager(_savePath);
        Assert.Null(manager.Load());

        Directory.CreateDirectory(Path.GetDirectoryName(_savePath)!);
        File.WriteAllText(_savePath, "{ not valid json !!");
        Assert.Null(manager.Load());
    }
}
