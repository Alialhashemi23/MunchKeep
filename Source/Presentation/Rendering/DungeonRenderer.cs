using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;
using MunchKeep.Core;
using MunchKeep.Simulation;
using MunchKeep.Simulation.Dungeon;
using MunchKeep.Presentation.Iso;

namespace MunchKeep.Presentation.Rendering;

/// <summary>
/// Draws the dungeon floor plane. Depth layout for the FrontToBack world pass:
///   0.00-0.10 rock, 0.10-0.45 floors/highlights, 0.50-0.95 entities (EntityRenderer),
///   higher = bars/overlays. Within a band, depth follows (x + y) — the painter's
///   algorithm for single-elevation isometric scenes.
/// </summary>
public sealed class DungeonRenderer
{
    private readonly SpriteAtlas _atlas;

    public DungeonRenderer(SpriteAtlas atlas) => _atlas = atlas;

    public static float FloorDepth(Sim sim, float x, float y) =>
        0.10f + (x + y) / (sim.Grid.Width + sim.Grid.Height) * 0.35f;

    public static float EntityDepth(Sim sim, float x, float y) =>
        0.50f + (x + y) / (sim.Grid.Width + sim.Grid.Height) * 0.45f;

    public void Draw(SpriteBatch batch, Sim sim, float totalTime,
        GridPos? hoverCell, string? hoverHighlightId, GridPos? selectedCell)
    {
        var grid = sim.Grid;
        for (var x = 0; x < grid.Width; x++)
        {
            for (var y = 0; y < grid.Height; y++)
            {
                var pos = new GridPos(x, y);
                var screen = IsoMath.WorldToScreen(x, y);
                var room = grid.GetRoom(pos);
                if (room is null)
                {
                    _atlas.Draw(batch, "tile.rock", screen, 0.05f);
                    continue;
                }

                _atlas.Draw(batch, TileId(room.Type), screen, FloorDepth(sim, x, y));

                switch (room.Type)
                {
                    case RoomType.TrapRoom:
                        // Spikes shown raised while armed, sunken while rearming.
                        var armedTint = room.TrapArmed ? Color.White : Color.White * 0.35f;
                        _atlas.Draw(batch, "fx.spikes", screen + new Vector2(0, 4),
                            FloorDepth(sim, x, y) + 0.001f, armedTint);
                        break;

                    case RoomType.Heart:
                        var pulse = 1f + 0.08f * MathF.Sin(totalTime * 4f);
                        _atlas.Draw(batch, "fx.heart", screen + new Vector2(0, 6),
                            EntityDepth(sim, x, y), Color.White, pulse);
                        break;
                }
            }
        }

        if (hoverCell is { } hover && hoverHighlightId is not null && grid.InBounds(hover))
            _atlas.Draw(batch, hoverHighlightId, IsoMath.WorldToScreen(hover.X, hover.Y), 0.46f);

        if (selectedCell is { } selected && grid.InBounds(selected))
            _atlas.Draw(batch, "tile.highlight.select", IsoMath.WorldToScreen(selected.X, selected.Y), 0.47f);
    }

    private static string TileId(RoomType type) => type switch
    {
        RoomType.Corridor => "tile.corridor",
        RoomType.MobRoom => "tile.mobroom",
        RoomType.TrapRoom => "tile.traproom",
        RoomType.Entrance => "tile.entrance",
        RoomType.Heart => "tile.heart",
        _ => "tile.rock",
    };
}
