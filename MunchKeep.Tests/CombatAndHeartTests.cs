using MunchKeep.Simulation;
using MunchKeep.Simulation.Dungeon;
using Xunit;

namespace MunchKeep.Tests;

public class CombatAndHeartTests
{
    [Fact]
    public void LethalTrapKillsHeroAndCorpseIsHarvested()
    {
        var balance = TestWorld.FastBalance();
        balance.TrapDamage = 1000f; // instant kill on the first trap
        var sim = TestWorld.Empty(balance);
        TestWorld.BuildPath(sim, x => x == 5 ? RoomType.TrapRoom : RoomType.Corridor);
        sim.PartyTimer = 0.1f;
        var startEssence = sim.Bank.Essence;

        var events = TestWorld.RunSeconds(sim, 15f);

        Assert.Contains(events, e => e.Type == SimEventType.TrapFired);
        Assert.Contains(events, e => e.Type == SimEventType.HeroDied);
        Assert.Contains(events, e => e.Type == SimEventType.Harvest);
        Assert.True(sim.Bank.Essence > startEssence, "harvested loot should exceed starting essence");
        Assert.True(sim.Renown > 0, "kills should raise renown");
    }

    [Fact]
    public void MobFightsBackAndRespawnsAfterDying()
    {
        var balance = TestWorld.FastBalance();
        balance.MobRespawnSeconds = 2f;
        balance.HeroBaseDamage = 50f; // hero one-shots the goblin
        var sim = TestWorld.Empty(balance);
        TestWorld.BuildPath(sim, x => x == 5 ? RoomType.MobRoom : RoomType.Corridor);
        sim.PartyTimer = 0.1f;

        var events = TestWorld.RunSeconds(sim, 20f);

        Assert.Contains(events, e => e.Type == SimEventType.MobDied);
        Assert.Contains(events, e => e.Type == SimEventType.MobRespawned);
    }

    [Fact]
    public void UnopposedHeroStealsFromHeartAndEscapes()
    {
        var balance = TestWorld.FastBalance();
        balance.PartyIntervalSeconds = 1000f; // exactly one party
        var sim = TestWorld.Empty(balance);
        TestWorld.BuildPath(sim); // pure corridor: nothing can stop them
        sim.PartyTimer = 0.1f;
        var startEssence = sim.Bank.Essence;
        var startHeart = sim.HeartHp;

        var events = TestWorld.RunSeconds(sim, 40f);

        Assert.Contains(events, e => e.Type == SimEventType.HeartDamaged);
        Assert.Contains(events, e => e.Type == SimEventType.HeroEscaped);
        Assert.True(sim.Bank.Essence < startEssence, "the hero should have stolen essence");
        Assert.Empty(sim.Heroes); // and made it out alive
        Assert.Equal(0, sim.Renown, 3); // no kills, no fame
    }

    [Fact]
    public void BreakingTheHeartCostsResourcesAndSendsHeroesHome()
    {
        var balance = TestWorld.FastBalance();
        balance.PartyIntervalSeconds = 1000f;
        var sim = TestWorld.Empty(balance);
        TestWorld.BuildPath(sim);
        sim.PartyTimer = 0.1f;
        sim.HeartHp = 1f; // one hit from shattering
        sim.Renown = 100;
        var startEssence = sim.Bank.Essence;

        var events = TestWorld.RunSeconds(sim, 40f);

        Assert.Contains(events, e => e.Type == SimEventType.HeartBroken);
        Assert.True(sim.Renown < 100, "heart break should cost renown");
        Assert.True(sim.Bank.Essence < startEssence, "heart break should cost resources");
        Assert.True(sim.HeartHp > 0, "the heart recovers to half strength — a setback, not game over");
        Assert.Empty(sim.Heroes);
    }

    [Fact]
    public void PartiesScaleWithRenown()
    {
        var balance = new BalanceConfig();
        Assert.Equal(1, Simulation.Progression.PartyGenerator.PartySize(balance, 0));
        Assert.Equal(2, Simulation.Progression.PartyGenerator.PartySize(balance, 25));
        Assert.Equal(3, Simulation.Progression.PartyGenerator.PartySize(balance, 45));
        Assert.Equal(3, Simulation.Progression.PartyGenerator.PartySize(balance, 500)); // capped
        Assert.Equal(1, Simulation.Progression.PartyGenerator.HeroLevel(balance, 0));
        Assert.Equal(3, Simulation.Progression.PartyGenerator.HeroLevel(balance, 30));
    }

    [Fact]
    public void NoPartiesSpawnWhileHeartIsCutOff()
    {
        var balance = TestWorld.FastBalance();
        var sim = TestWorld.Empty(balance); // no corridors at all
        sim.PartyTimer = 0.1f;

        var events = TestWorld.RunSeconds(sim, 10f);

        Assert.DoesNotContain(events, e => e.Type == SimEventType.PartySpawned);
        Assert.Empty(sim.Heroes);
    }
}
