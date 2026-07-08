using System.Text.Json;
using MunchKeep.Simulation;

namespace MunchKeep.Data;

/// <summary>
/// Loads balance numbers from Content/Data/balance.json next to the executable.
/// Missing or malformed files fall back to the compiled-in defaults so the game
/// (and headless tests) always run.
/// </summary>
public static class BalanceLoader
{
    public static BalanceConfig Load(string? baseDirectory = null)
    {
        var path = Path.Combine(baseDirectory ?? AppContext.BaseDirectory, "Content", "Data", "balance.json");
        if (!File.Exists(path)) return new BalanceConfig();
        try
        {
            return JsonSerializer.Deserialize<BalanceConfig>(File.ReadAllText(path)) ?? new BalanceConfig();
        }
        catch (JsonException)
        {
            return new BalanceConfig();
        }
    }
}
