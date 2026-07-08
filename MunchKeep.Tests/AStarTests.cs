using MunchKeep.Core;
using MunchKeep.Simulation;
using MunchKeep.Simulation.Dungeon;
using MunchKeep.Simulation.Pathfinding;
using Xunit;

namespace MunchKeep.Tests;

public class AStarTests
{
    [Fact]
    public void FindsStraightPathAlongCorridor()
    {
        var sim = TestWorld.Empty(new BalanceConfig());
        TestWorld.BuildPath(sim);

        var path = AStar.FindPath(sim.Grid, sim.Grid.Entrance, sim.Grid.Heart);

        Assert.NotNull(path);
        Assert.Equal(sim.Grid.Entrance, path![0]);
        Assert.Equal(sim.Grid.Heart, path[^1]);
        Assert.Equal(sim.Grid.Entrance.ManhattanDistance(sim.Grid.Heart) + 1, path.Count);
    }

    [Fact]
    public void ReturnsNullWhenHeartIsCutOff()
    {
        var sim = TestWorld.Empty(new BalanceConfig());
        // No corridors built: entrance and heart are isolated islands.
        Assert.Null(AStar.FindPath(sim.Grid, sim.Grid.Entrance, sim.Grid.Heart));
        Assert.False(sim.Grid.HeartReachable);
    }

    [Fact]
    public void RoutesAroundDemolishedCells()
    {
        var sim = TestWorld.Empty(new BalanceConfig());
        TestWorld.BuildPath(sim);
        var y = sim.Grid.Entrance.Y;
        // Build a detour above the corridor, then cut the direct route.
        for (var x = 5; x <= 7; x++)
            sim.Grid.Build(new GridPos(x, y - 1), RoomType.Corridor);
        sim.Grid.Demolish(new GridPos(6, y));

        var path = AStar.FindPath(sim.Grid, sim.Grid.Entrance, sim.Grid.Heart);

        Assert.NotNull(path);
        Assert.Contains(new GridPos(6, y - 1), path!);
        Assert.True(sim.Grid.HeartReachable);
    }

    [Fact]
    public void AllowsStartingFromUnwalkableCell()
    {
        var sim = TestWorld.Empty(new BalanceConfig());
        TestWorld.BuildPath(sim);
        var rock = new GridPos(sim.Grid.Entrance.X + 1, sim.Grid.Entrance.Y - 1); // adjacent rock

        var path = AStar.FindPath(sim.Grid, rock, sim.Grid.Heart);

        Assert.NotNull(path); // stranded heroes can step back onto the dungeon
    }
}
