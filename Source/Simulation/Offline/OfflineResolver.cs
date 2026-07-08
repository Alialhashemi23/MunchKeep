namespace MunchKeep.Simulation.Offline;

public sealed record OfflineResult(double Seconds, double Essence, double Scrap, double Renown)
{
    public bool AnyGain => Essence >= 1 || Scrap >= 1 || Renown >= 1;
}

/// <summary>
/// Capped offline progress: instead of replaying every tick, we apply the measured
/// income rates from the previous session (earned-per-second averages) at reduced
/// efficiency, capped at OfflineCapHours. Deliberately conservative and cheap.
/// </summary>
public static class OfflineResolver
{
    public static OfflineResult Resolve(
        BalanceConfig balance,
        double elapsedSeconds,
        double essencePerSecond,
        double scrapPerSecond,
        double renownPerSecond)
    {
        var seconds = Math.Clamp(elapsedSeconds, 0, balance.OfflineCapHours * 3600.0);
        var eff = balance.OfflineEfficiency;
        return new OfflineResult(
            seconds,
            Math.Max(0, essencePerSecond) * seconds * eff,
            Math.Max(0, scrapPerSecond) * seconds * eff,
            Math.Max(0, renownPerSecond) * seconds * eff);
    }
}
