namespace MunchKeep.Simulation.Entities;

/// <summary>A dead adventurer, dissolving into harvestable resources after a short delay.</summary>
public sealed class Corpse
{
    public float X { get; init; }
    public float Y { get; init; }
    public float Timer { get; set; }
    public double Essence { get; init; }
    public double Scrap { get; init; }
}
