using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;
using Microsoft.Xna.Framework.Input;
using MunchKeep.Presentation.Input;

namespace MunchKeep.Presentation.Iso;

/// <summary>Pan/zoom camera over the iso-projected plane. Position is the world-pixel point kept at screen center.</summary>
public sealed class IsoCamera
{
    private const float PanSpeed = 500f;
    private const float MinZoom = 0.5f;
    private const float MaxZoom = 2.5f;

    public Vector2 Position { get; set; }
    public float Zoom { get; set; } = 1f;

    public Matrix GetTransform(Viewport viewport) =>
        Matrix.CreateTranslation(-Position.X, -Position.Y, 0)
        * Matrix.CreateScale(Zoom)
        * Matrix.CreateTranslation(viewport.Width / 2f, viewport.Height / 2f, 0);

    public Vector2 ScreenToWorldPixels(Vector2 screen, Viewport viewport) =>
        (screen - new Vector2(viewport.Width / 2f, viewport.Height / 2f)) / Zoom + Position;

    public void Update(float dt, InputState input, Viewport viewport)
    {
        var pan = Vector2.Zero;
        if (input.IsDown(Keys.W) || input.IsDown(Keys.Up)) pan.Y -= 1;
        if (input.IsDown(Keys.S) || input.IsDown(Keys.Down)) pan.Y += 1;
        if (input.IsDown(Keys.A) || input.IsDown(Keys.Left)) pan.X -= 1;
        if (input.IsDown(Keys.D) || input.IsDown(Keys.Right)) pan.X += 1;
        if (pan != Vector2.Zero)
            Position += pan * (PanSpeed / Zoom) * dt;

        if (input.MiddleHeld || input.RightHeld)
            Position -= input.MouseDelta / Zoom;

        if (input.ScrollDelta != 0)
        {
            // Zoom toward the cursor so the point under the mouse stays put.
            var before = ScreenToWorldPixels(input.MouseVector, viewport);
            Zoom = MathHelper.Clamp(Zoom * MathF.Pow(1.1f, input.ScrollDelta / 120f), MinZoom, MaxZoom);
            var after = ScreenToWorldPixels(input.MouseVector, viewport);
            Position += before - after;
        }
    }
}
