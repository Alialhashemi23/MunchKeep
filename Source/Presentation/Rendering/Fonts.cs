using FontStashSharp;

namespace MunchKeep.Presentation.Rendering;

/// <summary>
/// Runtime TTF text rendering via FontStashSharp (no content pipeline needed).
/// Loads the first .ttf found in Content/Fonts.
/// </summary>
public sealed class Fonts
{
    private readonly FontSystem _fontSystem = new();

    public Fonts(string? fontDirectory = null)
    {
        var dir = fontDirectory ?? Path.Combine(AppContext.BaseDirectory, "Content", "Fonts");
        var ttf = Directory.Exists(dir) ? Directory.EnumerateFiles(dir, "*.ttf").FirstOrDefault() : null;
        if (ttf is null)
            throw new FileNotFoundException(
                $"No .ttf font found in '{dir}'. Ship at least one TTF in Content/Fonts.");
        _fontSystem.AddFont(File.ReadAllBytes(ttf));
    }

    public SpriteFontBase Get(int size) => _fontSystem.GetFont(size);
}
