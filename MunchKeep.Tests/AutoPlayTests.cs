using MunchKeep.Core;
using MunchKeep.Simulation;
using MunchKeep.Simulation.Dungeon;
using Xunit;

namespace MunchKeep.Tests;

/// <summary>
/// End-to-end guard on the idle loop: a whole simulated session with a simple
/// scripted "player" who spends the opening bank on traps and upgrades the goblin
/// whenever scrap allows. If the core loop (lure -> kill -> harvest -> upgrade ->
/// scale) stalls or collapses, these assertions catch it without any graphics.
/// </summary>
public class AutoPlayTests
{
    [Fact]
    public void ThirtySimulatedMinutesOfPlayGrowTheDungeon()
    {
        var balance = new BalanceConfig();
        var sim = Sim.CreateNew(balance, seed: 1234);

        // Opening move a player is nudged toward: convert two corridor cells' worth
        // of savings into traps flanking the goblin den (built on fresh cells is not
        // possible on the only path, so extend hazards by building a detour is out of
        // scope here — instead we place them on buildable cells adjacent to the path
        // after demolishing corridor segments, exactly as a player would).
        var y = sim.Grid.Entrance.Y;
        foreach (var x in new[] { 4, 9 })
        {
            Assert.True(sim.TryDemolish(new GridPos(x, y)));
            Assert.True(sim.TryBuild(new GridPos(x, y), RoomType.TrapRoom));
        }

        var heroesDied = 0;
        var mobCell = sim.Grid.Rooms().First(r => r.Room.Type == RoomType.MobRoom).Pos;
        var totalMinutes = 30;
        for (var minute = 0; minute < totalMinutes; minute++)
        {
            var events = TestWorld.RunSeconds(sim, 60f);
            heroesDied += events.Count(e => e.Type == SimEventType.HeroDied);
            // Scripted player: keep the goblin as scary as the budget allows.
            while (sim.TryUpgradeMob(mobCell)) { }
        }

        Assert.True(heroesDied >= 5, $"expected a body count, got {heroesDied}");
        Assert.True(sim.Bank.SessionEssenceEarned > 100,
            $"harvest income too low: {sim.Bank.SessionEssenceEarned:0}");
        Assert.True(sim.Renown >= 10, $"renown stalled at {sim.Renown:0.0}");
        Assert.True(sim.Bank.Essence > 0, "the dungeon should not go bankrupt");
        Assert.True(sim.HeartHp > 0, "the heart must survive a normal session");

        var rates = sim.CurrentIncomeRates();
        Assert.True(rates.Essence > 0, "offline income rate should be measurable after a session");
    }

    [Fact]
    public void RenownGrowthEventuallyScalesPartySize()
    {
        var balance = TestWorld.FastBalance();
        balance.TrapDamage = 1000f; // guaranteed kills, fast renown
        var sim = TestWorld.Empty(balance);
        TestWorld.BuildPath(sim, x => x == 5 ? RoomType.TrapRoom : RoomType.Corridor);
        sim.PartyTimer = 0.1f;

        var events = TestWorld.RunSeconds(sim, 120f);

        var sizes = events.Where(e => e.Type == SimEventType.PartySpawned).Select(e => (int)e.Amount).ToList();
        Assert.True(sizes.Count > 5, "expected a steady stream of parties");
        Assert.Equal(1, sizes.First());
        Assert.True(sizes.Max() > 1, "renown growth should attract bigger parties");
    }
}
