using System.Text.Json;
using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;
using MunchKeep.Presentation.Iso;

namespace MunchKeep.Presentation.Rendering;

/// <summary>
/// All rendering goes through logical sprite ids (e.g. "tile.corridor", "unit.goblin")
/// resolved via Content/Assets/sprites.json. Ids with a texture path load that PNG at
/// runtime; ids without one get a generated placeholder shape, so the game is fully
/// playable before any art exists and re-skinning is a pure manifest/file swap.
/// </summary>
public sealed class SpriteAtlas : IDisposable
{
    public sealed record Sprite(Texture2D Texture, Rectangle Source, Vector2 Origin);

    private readonly Dictionary<string, Sprite> _sprites = new();
    private readonly Dictionary<string, Texture2D> _textureCache = new();
    private readonly List<Texture2D> _generated = new();
    private readonly GraphicsDevice _device;
    private readonly string _assetRoot;

    public Texture2D Pixel { get; }

    public SpriteAtlas(GraphicsDevice device, string? assetRoot = null)
    {
        _device = device;
        _assetRoot = assetRoot ?? Path.Combine(AppContext.BaseDirectory, "Content", "Assets");

        Pixel = new Texture2D(device, 1, 1);
        Pixel.SetData(new[] { Color.White });
        _generated.Add(Pixel);

        var manifest = LoadManifest();
        if (manifest?.TileWidth > 0) IsoMath.TileWidth = manifest.TileWidth;
        if (manifest?.TileHeight > 0) IsoMath.TileHeight = manifest.TileHeight;

        if (manifest?.Sprites != null)
            foreach (var entry in manifest.Sprites)
                TryLoadManifestSprite(entry);

        RegisterPlaceholders();
    }

    public Sprite Get(string id) =>
        _sprites.TryGetValue(id, out var sprite)
            ? sprite
            : throw new KeyNotFoundException($"Unknown sprite id '{id}'");

    public void Draw(SpriteBatch batch, string id, Vector2 position, float layerDepth,
        Color? color = null, float scale = 1f)
    {
        var s = Get(id);
        batch.Draw(s.Texture, position, s.Source, color ?? Color.White, 0f, s.Origin,
            scale, SpriteEffects.None, layerDepth);
    }

    // ------------------------------------------------------------------ manifest loading

    private sealed class Manifest
    {
        public int TileWidth { get; set; }
        public int TileHeight { get; set; }
        public List<ManifestSprite>? Sprites { get; set; }
    }

    private sealed class ManifestSprite
    {
        public string Id { get; set; } = "";
        public string? Texture { get; set; }
        public int? X { get; set; }
        public int? Y { get; set; }
        public int? W { get; set; }
        public int? H { get; set; }
        public float? OriginX { get; set; }
        public float? OriginY { get; set; }
    }

    private Manifest? LoadManifest()
    {
        var path = Path.Combine(_assetRoot, "sprites.json");
        if (!File.Exists(path)) return null;
        try
        {
            return JsonSerializer.Deserialize<Manifest>(File.ReadAllText(path),
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private void TryLoadManifestSprite(ManifestSprite entry)
    {
        if (string.IsNullOrEmpty(entry.Id) || string.IsNullOrEmpty(entry.Texture)) return;
        var file = Path.Combine(_assetRoot, entry.Texture);
        if (!File.Exists(file)) return; // silently fall through to placeholder

        if (!_textureCache.TryGetValue(file, out var texture))
        {
            using var stream = File.OpenRead(file);
            texture = Texture2D.FromStream(_device, stream);
            _textureCache[file] = texture;
        }

        var source = entry is { X: { } x, Y: { } y, W: { } w, H: { } h }
            ? new Rectangle(x, y, w, h)
            : texture.Bounds;
        // Default anchor: tiles pivot at diamond center, everything else at bottom-center (feet).
        var origin = new Vector2(
            entry.OriginX ?? source.Width / 2f,
            entry.OriginY ?? (entry.Id.StartsWith("tile.") ? source.Height / 2f : source.Height));
        _sprites[entry.Id] = new Sprite(texture, source, origin);
    }

    // ------------------------------------------------------------------ placeholder shapes

    private void RegisterPlaceholders()
    {
        AddDiamond("tile.rock", new Color(38, 38, 48), new Color(52, 52, 64));
        AddDiamond("tile.corridor", new Color(138, 127, 102), new Color(90, 82, 66));
        AddDiamond("tile.mobroom", new Color(133, 74, 74), new Color(88, 48, 48));
        AddDiamond("tile.traproom", new Color(108, 90, 128), new Color(70, 58, 84));
        AddDiamond("tile.entrance", new Color(74, 122, 74), new Color(46, 78, 46));
        AddDiamond("tile.heart", new Color(120, 52, 70), new Color(160, 60, 84));
        AddDiamond("tile.highlight.valid", new Color(120, 255, 120) * 0.35f, new Color(160, 255, 160));
        AddDiamond("tile.highlight.invalid", new Color(255, 90, 90) * 0.35f, new Color(255, 130, 130));
        AddDiamond("tile.highlight.select", new Color(255, 240, 140) * 0.30f, new Color(255, 240, 140));

        AddEllipse("unit.hero", 22, 30, new Color(224, 192, 96), new Color(140, 110, 40));
        AddEllipse("unit.goblin", 20, 24, new Color(88, 160, 80), new Color(48, 96, 44));
        AddEllipse("unit.corpse", 26, 12, new Color(150, 150, 150), new Color(90, 90, 90));
        AddEllipse("fx.heart", 26, 26, new Color(230, 70, 100), new Color(255, 140, 160));
        AddEllipse("fx.spikes", 22, 10, new Color(200, 200, 210), new Color(120, 120, 130));
    }

    private void AddDiamond(string id, Color fill, Color outline)
    {
        if (_sprites.ContainsKey(id)) return; // manifest art wins
        int w = IsoMath.TileWidth, h = IsoMath.TileHeight;
        var data = new Color[w * h];
        float cx = (w - 1) / 2f, cy = (h - 1) / 2f;
        for (var y = 0; y < h; y++)
        {
            for (var x = 0; x < w; x++)
            {
                var v = MathF.Abs(x - cx) / (w / 2f) + MathF.Abs(y - cy) / (h / 2f);
                if (v <= 1f)
                    data[y * w + x] = v > 0.86f ? outline : fill;
            }
        }
        AddGenerated(id, w, h, data, new Vector2(w / 2f, h / 2f));
    }

    private void AddEllipse(string id, int w, int h, Color fill, Color outline)
    {
        if (_sprites.ContainsKey(id)) return;
        var data = new Color[w * h];
        float cx = (w - 1) / 2f, cy = (h - 1) / 2f;
        for (var y = 0; y < h; y++)
        {
            for (var x = 0; x < w; x++)
            {
                var dx = (x - cx) / (w / 2f);
                var dy = (y - cy) / (h / 2f);
                var v = dx * dx + dy * dy;
                if (v <= 1f)
                    data[y * w + x] = v > 0.72f ? outline : fill;
            }
        }
        AddGenerated(id, w, h, data, new Vector2(w / 2f, h)); // feet at bottom-center
    }

    private void AddGenerated(string id, int w, int h, Color[] data, Vector2 origin)
    {
        var texture = new Texture2D(_device, w, h);
        texture.SetData(data);
        _generated.Add(texture);
        _sprites[id] = new Sprite(texture, texture.Bounds, origin);
    }

    public void Dispose()
    {
        foreach (var t in _generated) t.Dispose();
        foreach (var t in _textureCache.Values) t.Dispose();
    }
}
