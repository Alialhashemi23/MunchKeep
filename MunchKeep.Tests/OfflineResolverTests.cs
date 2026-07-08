using MunchKeep.Simulation;
using MunchKeep.Simulation.Offline;
using Xunit;

namespace MunchKeep.Tests;

public class OfflineResolverTests
{
    [Fact]
    public void AppliesEfficiencyToMeasuredRates()
    {
        var balance = new BalanceConfig { OfflineEfficiency = 0.5f };

        var result = OfflineResolver.Resolve(balance, 1000, essencePerSecond: 2, scrapPerSecond: 1, renownPerSecond: 0.1);

        Assert.Equal(1000, result.Seconds);
        Assert.Equal(1000, result.Essence, 3); // 2/s * 1000s * 0.5
        Assert.Equal(500, result.Scrap, 3);
        Assert.Equal(50, result.Renown, 3);
        Assert.True(result.AnyGain);
    }

    [Fact]
    public void CapsAtConfiguredHours()
    {
        var balance = new BalanceConfig { OfflineCapHours = 8 };
        var week = 7 * 24 * 3600.0;

        var result = OfflineResolver.Resolve(balance, week, 1, 0, 0);

        Assert.Equal(8 * 3600, result.Seconds);
    }

    [Fact]
    public void ZeroRatesAndNegativeElapsedAreSafe()
    {
        var balance = new BalanceConfig();

        Assert.False(OfflineResolver.Resolve(balance, 3600, 0, 0, 0).AnyGain);
        Assert.Equal(0, OfflineResolver.Resolve(balance, -50, 5, 5, 5).Seconds); // clock skew
    }

    [Fact]
    public void SimReportsLoadedRatesUntilEnoughSessionData()
    {
        var sim = TestWorld.Empty(new BalanceConfig());
        sim.LoadedEssenceRate = 1.5;

        var early = sim.CurrentIncomeRates();
        Assert.Equal(1.5, early.Essence); // young session: trust the previous session's number
    }
}
