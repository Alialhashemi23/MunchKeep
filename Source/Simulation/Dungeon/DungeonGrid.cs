using MunchKeep.Core;
using MunchKeep.Simulation.Entities;
using MunchKeep.Simulation.Pathfinding;

namespace MunchKeep.Simulation.Dungeon;

/// <summary>
/// The dungeon: a fixed-size grid where each cell is either unexcavated rock (null)
/// or a built Room. Entrance and Heart are permanent rooms placed at construction.
/// </summary>
public sealed class DungeonGrid
{
    private readonly Room?[,] _cells;
    private readonly BalanceConfig _balance;

    public int Width { get; }
    public int Height { get; }
    public GridPos Entrance { get; }
    public GridPos Heart { get; }

    /// <summary>Bumped on every build/demolish; lets heroes know to re-path.</summary>
    public int Version { get; private set; }

    /// <summary>Recomputed on change: can a hero walk from the entrance to the heart?</summary>
    public bool HeartReachable { get; private set; }

    public DungeonGrid(BalanceConfig balance)
    {
        _balance = balance;
        Width = balance.GridWidth;
        Height = balance.GridHeight;
        _cells = new Room?[Width, Height];
        Entrance = new GridPos(balance.EntranceX, balance.EntranceY);
        Heart = new GridPos(balance.HeartX, balance.HeartY);
        _cells[Entrance.X, Entrance.Y] = new Room { Type = RoomType.Entrance };
        _cells[Heart.X, Heart.Y] = new Room { Type = RoomType.Heart };
        RecomputeReachability();
    }

    public bool InBounds(GridPos p) => p.X >= 0 && p.X < Width && p.Y >= 0 && p.Y < Height;

    public Room? GetRoom(GridPos p) => InBounds(p) ? _cells[p.X, p.Y] : null;

    public bool IsWalkable(GridPos p) => GetRoom(p) is not null;

    public IEnumerable<(GridPos Pos, Room Room)> Rooms()
    {
        for (var x = 0; x < Width; x++)
            for (var y = 0; y < Height; y++)
                if (_cells[x, y] is { } room)
                    yield return (new GridPos(x, y), room);
    }

    public int BuildCost(RoomType type) => type switch
    {
        RoomType.Corridor => _balance.CorridorCost,
        RoomType.MobRoom => _balance.MobRoomCost,
        RoomType.TrapRoom => _balance.TrapRoomCost,
        _ => int.MaxValue,
    };

    /// <summary>A cell is buildable if empty, in bounds, and adjacent to the existing dungeon.</summary>
    public bool CanBuild(GridPos p)
    {
        if (!InBounds(p) || _cells[p.X, p.Y] is not null) return false;
        foreach (var o in GridPos.CardinalOffsets)
            if (IsWalkable(p.Offset(o)))
                return true;
        return false;
    }

    /// <summary>Places a room; the caller is responsible for having charged the cost.</summary>
    public Room Build(GridPos p, RoomType type)
    {
        if (!CanBuild(p)) throw new InvalidOperationException($"Cannot build at {p}");
        if (type is RoomType.Entrance or RoomType.Heart) throw new InvalidOperationException($"Cannot place {type}");
        var room = new Room { Type = type };
        if (type == RoomType.MobRoom)
            room.Mob = Mob.Spawn(_balance, room.MobLevel);
        _cells[p.X, p.Y] = room;
        OnChanged();
        return room;
    }

    public bool CanDemolish(GridPos p) =>
        GetRoom(p) is { } room && room.Type is not (RoomType.Entrance or RoomType.Heart);

    /// <summary>Removes a room and returns the refund amount.</summary>
    public int Demolish(GridPos p)
    {
        if (!CanDemolish(p)) throw new InvalidOperationException($"Cannot demolish at {p}");
        var refund = (int)(BuildCost(_cells[p.X, p.Y]!.Type) * _balance.DemolishRefund);
        _cells[p.X, p.Y] = null;
        OnChanged();
        return refund;
    }

    /// <summary>
    /// Places a room without cost or adjacency checks. Used when rebuilding a saved
    /// dungeon, where rooms arrive in arbitrary order.
    /// </summary>
    public void PlaceRaw(GridPos p, Room room)
    {
        if (!InBounds(p)) throw new ArgumentOutOfRangeException(nameof(p));
        _cells[p.X, p.Y] = room;
        OnChanged();
    }

    private void OnChanged()
    {
        Version++;
        RecomputeReachability();
    }

    private void RecomputeReachability() =>
        HeartReachable = AStar.FindPath(this, Entrance, Heart) is not null;
}
