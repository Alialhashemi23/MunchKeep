namespace MunchKeep.Core;

/// <summary>Integer cell coordinate on the dungeon grid. Engine-agnostic (no MonoGame types).</summary>
public readonly record struct GridPos(int X, int Y)
{
    public static readonly GridPos[] CardinalOffsets =
    {
        new(1, 0), new(-1, 0), new(0, 1), new(0, -1),
    };

    public GridPos Offset(GridPos o) => new(X + o.X, Y + o.Y);

    public int ManhattanDistance(GridPos other) =>
        System.Math.Abs(X - other.X) + System.Math.Abs(Y - other.Y);

    public override string ToString() => $"({X},{Y})";
}
