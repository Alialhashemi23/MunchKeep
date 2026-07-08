using System.Text.Json;
using MunchKeep.Core;
using MunchKeep.Simulation;
using MunchKeep.Simulation.Dungeon;
using MunchKeep.Simulation.Entities;

namespace MunchKeep.Persistence;

/// <summary>JSON save/load in the user's application-data folder (path injectable for tests).</summary>
public sealed class SaveManager
{
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };

    public string SavePath { get; }

    public SaveManager(string? savePath = null)
    {
        SavePath = savePath ?? Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "MunchKeep", "save.json");
    }

    public bool SaveExists => File.Exists(SavePath);

    public void Delete()
    {
        if (SaveExists) File.Delete(SavePath);
    }

    public void Save(Sim sim, DateTime? nowUtc = null)
    {
        var data = ToData(sim, nowUtc ?? DateTime.UtcNow);
        Directory.CreateDirectory(Path.GetDirectoryName(SavePath)!);
        File.WriteAllText(SavePath, JsonSerializer.Serialize(data, JsonOptions));
    }

    public SaveData? Load()
    {
        if (!SaveExists) return null;
        try
        {
            return JsonSerializer.Deserialize<SaveData>(File.ReadAllText(SavePath));
        }
        catch (JsonException)
        {
            return null; // corrupt save: start fresh rather than crash
        }
    }

    public static SaveData ToData(Sim sim, DateTime nowUtc)
    {
        var rates = sim.CurrentIncomeRates();
        var data = new SaveData
        {
            LastSavedUtc = nowUtc,
            Essence = sim.Bank.Essence,
            Scrap = sim.Bank.Scrap,
            Renown = sim.Renown,
            HeartHp = sim.HeartHp,
            PartyTimer = sim.PartyTimer,
            PartyCounter = sim.PartyCounter,
            TickCount = sim.TickCount,
            RngSeed = sim.Rng.Seed + 1, // fresh stream next session
            EssencePerSecond = rates.Essence,
            ScrapPerSecond = rates.Scrap,
            RenownPerSecond = rates.Renown,
        };
        foreach (var (pos, room) in sim.Grid.Rooms())
        {
            if (room.Type is RoomType.Entrance or RoomType.Heart) continue; // placed by ctor
            data.Rooms.Add(new SavedRoom
            {
                X = pos.X,
                Y = pos.Y,
                Type = room.Type.ToString(),
                MobLevel = room.MobLevel,
            });
        }
        return data;
    }

    public static Sim FromData(SaveData data, BalanceConfig balance)
    {
        var sim = new Sim(balance, data.RngSeed, data.Essence, data.Scrap, data.Renown, data.HeartHp)
        {
            PartyTimer = data.PartyTimer,
            PartyCounter = data.PartyCounter,
            TickCount = data.TickCount,
            LoadedEssenceRate = data.EssencePerSecond,
            LoadedScrapRate = data.ScrapPerSecond,
            LoadedRenownRate = data.RenownPerSecond,
        };
        foreach (var saved in data.Rooms)
        {
            if (!Enum.TryParse<RoomType>(saved.Type, out var type)) continue;
            if (type is RoomType.Entrance or RoomType.Heart) continue;
            var room = new Room { Type = type, MobLevel = Math.Max(1, saved.MobLevel) };
            if (type == RoomType.MobRoom)
                room.Mob = Mob.Spawn(balance, room.MobLevel);
            sim.Grid.PlaceRaw(new GridPos(saved.X, saved.Y), room);
        }
        return sim;
    }
}
