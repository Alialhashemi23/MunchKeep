namespace MunchKeep.Persistence;

/// <summary>
/// Serialization DTOs, deliberately separate from the live sim classes so refactors
/// don't silently change the save format. Heroes and corpses in flight are not
/// persisted: a save/load boundary simply ends the current raid.
/// </summary>
public sealed class SaveData
{
    public int Version { get; set; } = 1;
    public DateTime LastSavedUtc { get; set; }

    public double Essence { get; set; }
    public double Scrap { get; set; }
    public double Renown { get; set; }
    public float HeartHp { get; set; }
    public float PartyTimer { get; set; }
    public int PartyCounter { get; set; }
    public long TickCount { get; set; }
    public int RngSeed { get; set; }

    public double EssencePerSecond { get; set; }
    public double ScrapPerSecond { get; set; }
    public double RenownPerSecond { get; set; }

    public List<SavedRoom> Rooms { get; set; } = new();
}

public sealed class SavedRoom
{
    public int X { get; set; }
    public int Y { get; set; }
    public string Type { get; set; } = "";
    public int MobLevel { get; set; } = 1;
}
