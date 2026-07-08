using FontStashSharp;
using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;
using MunchKeep.Presentation.Iso;

namespace MunchKeep.Presentation.Rendering;

/// <summary>Damage numbers and pickup text rising off the battlefield.</summary>
public sealed class FloatingTextSystem
{
    private const float Lifetime = 1.2f;
    private const float RiseSpeed = 28f;

    private sealed class Entry
    {
        public required string Text;
        public required Color Color;
        public Vector2 Origin;
        public float Age;
        public float JitterX;
    }

    private readonly List<Entry> _entries = new();
    private readonly Random _jitter = new();

    public void Add(string text, float worldX, float worldY, Color color)
    {
        _entries.Add(new Entry
        {
            Text = text,
            Color = color,
            Origin = IsoMath.WorldToScreen(worldX, worldY) - new Vector2(0, IsoMath.TileHeight),
            JitterX = _jitter.Next(-10, 11),
        });
    }

    public void Update(float dt)
    {
        for (var i = _entries.Count - 1; i >= 0; i--)
        {
            _entries[i].Age += dt;
            if (_entries[i].Age >= Lifetime)
                _entries.RemoveAt(i);
        }
    }

    /// <summary>Draw inside a camera-transformed deferred batch (renders above the world pass).</summary>
    public void Draw(SpriteBatch batch, SpriteFontBase font)
    {
        foreach (var e in _entries)
        {
            var alpha = 1f - e.Age / Lifetime;
            var pos = e.Origin + new Vector2(e.JitterX - font.MeasureString(e.Text).X / 2f, -e.Age * RiseSpeed);
            batch.DrawString(font, e.Text, pos + Vector2.One, Color.Black * (alpha * 0.6f));
            batch.DrawString(font, e.Text, pos, e.Color * alpha);
        }
    }
}
