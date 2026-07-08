using MunchKeep.Core;
using MunchKeep.Simulation.Dungeon;

namespace MunchKeep.Simulation.Pathfinding;

/// <summary>
/// Plain A* over walkable dungeon cells, 4-directional, uniform cost.
/// Small grids (24x24) make this cheap enough to re-run on every dungeon edit.
/// </summary>
public static class AStar
{
    /// <summary>
    /// Returns the path from start to goal inclusive, or null if unreachable.
    /// The start cell is always allowed even if not walkable (a hero may be standing
    /// on a just-demolished cell); every subsequent step must be walkable.
    /// </summary>
    public static List<GridPos>? FindPath(DungeonGrid grid, GridPos start, GridPos goal)
    {
        if (!grid.InBounds(start) || !grid.IsWalkable(goal)) return null;
        if (start == goal) return new List<GridPos> { start };

        var open = new PriorityQueue<GridPos, int>();
        var cameFrom = new Dictionary<GridPos, GridPos>();
        var costSoFar = new Dictionary<GridPos, int> { [start] = 0 };
        open.Enqueue(start, start.ManhattanDistance(goal));

        while (open.TryDequeue(out var current, out _))
        {
            if (current == goal)
                return Reconstruct(cameFrom, start, goal);

            foreach (var offset in GridPos.CardinalOffsets)
            {
                var next = current.Offset(offset);
                if (!grid.IsWalkable(next)) continue;
                var newCost = costSoFar[current] + 1;
                if (costSoFar.TryGetValue(next, out var existing) && newCost >= existing) continue;
                costSoFar[next] = newCost;
                cameFrom[next] = current;
                open.Enqueue(next, newCost + next.ManhattanDistance(goal));
            }
        }

        return null;
    }

    private static List<GridPos> Reconstruct(Dictionary<GridPos, GridPos> cameFrom, GridPos start, GridPos goal)
    {
        var path = new List<GridPos> { goal };
        var current = goal;
        while (current != start)
        {
            current = cameFrom[current];
            path.Add(current);
        }
        path.Reverse();
        return path;
    }
}
