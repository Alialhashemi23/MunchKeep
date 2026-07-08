namespace MunchKeep.Simulation.Economy;

/// <summary>The dungeon's stockpile. Doubles as the offline-income bookkeeping point.</summary>
public sealed class ResourceBank
{
    public double Essence { get; private set; }
    public double Scrap { get; private set; }

    /// <summary>Lifetime earnings this session, used to estimate offline income rates.</summary>
    public double SessionEssenceEarned { get; private set; }
    public double SessionScrapEarned { get; private set; }

    public ResourceBank(double essence, double scrap)
    {
        Essence = essence;
        Scrap = scrap;
    }

    public void Earn(double essence, double scrap)
    {
        Essence += essence;
        Scrap += scrap;
        SessionEssenceEarned += essence;
        SessionScrapEarned += scrap;
    }

    public bool CanAfford(double essence, double scrap = 0) => Essence >= essence && Scrap >= scrap;

    public bool TrySpend(double essence, double scrap = 0)
    {
        if (!CanAfford(essence, scrap)) return false;
        Essence -= essence;
        Scrap -= scrap;
        return true;
    }

    /// <summary>Grants that don't count as session income (refunds, offline earnings).</summary>
    public void Grant(double essence, double scrap = 0)
    {
        Essence += essence;
        Scrap += scrap;
    }

    /// <summary>Removes up to the requested amount and returns what was actually taken.</summary>
    public (double Essence, double Scrap) Steal(double essenceFraction)
    {
        var takenEssence = Essence * essenceFraction;
        var takenScrap = Scrap * essenceFraction;
        Essence -= takenEssence;
        Scrap -= takenScrap;
        return (takenEssence, takenScrap);
    }

    public void LoseFraction(double fraction)
    {
        Essence *= 1 - fraction;
        Scrap *= 1 - fraction;
    }
}
