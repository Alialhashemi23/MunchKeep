using Microsoft.Xna.Framework;

namespace MunchKeep.Presentation.Iso;

/// <summary>
/// The 2:1 diamond isometric projection. World coordinates are continuous grid cells
/// (sim space); screen coordinates are pre-camera pixels. Tile size comes from the
/// sprite manifest so swapping tile packs is a data change.
/// </summary>
public static class IsoMath
{
    public static int TileWidth { get; set; } = 64;
    public static int TileHeight { get; set; } = 32;

    public static Vector2 WorldToScreen(float wx, float wy) =>
        new((wx - wy) * TileWidth / 2f, (wx + wy) * TileHeight / 2f);

    public static Vector2 WorldToScreen(Vector2 world) => WorldToScreen(world.X, world.Y);

    public static Vector2 ScreenToWorld(Vector2 screen) =>
        new(screen.X / TileWidth + screen.Y / TileHeight,
            screen.Y / TileHeight - screen.X / TileWidth);
}
