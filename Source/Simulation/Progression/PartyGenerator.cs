using MunchKeep.Core;
using MunchKeep.Simulation.Entities;

namespace MunchKeep.Simulation.Progression;

/// <summary>
/// Turns Renown into adventurer parties: more famous dungeons attract bigger,
/// higher-level (and therefore richer) parties.
/// </summary>
public static class PartyGenerator
{
    public static int PartySize(BalanceConfig balance, double renown) =>
        Math.Clamp(1 + (int)(renown / balance.RenownPerPartySize), 1, balance.MaxPartySize);

    public static int HeroLevel(BalanceConfig balance, double renown) =>
        1 + (int)(renown / balance.RenownPerHeroLevel);

    public static List<Hero> Generate(BalanceConfig balance, double renown, int partyId, ref int nextHeroId, GridPos entrance, Rng rng)
    {
        var size = PartySize(balance, renown);
        var level = HeroLevel(balance, renown);
        var heroes = new List<Hero>(size);
        for (var i = 0; i < size; i++)
        {
            // Small level jitter keeps parties from feeling identical.
            var jittered = Math.Max(1, level + rng.NextInt(-1, 2));
            heroes.Add(Hero.Spawn(balance, nextHeroId++, partyId, jittered, entrance));
        }
        return heroes;
    }
}
