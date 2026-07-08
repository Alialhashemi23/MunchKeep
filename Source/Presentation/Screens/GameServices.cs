using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;
using MunchKeep.Simulation;
using MunchKeep.Presentation.Rendering;

namespace MunchKeep.Presentation.Screens;

/// <summary>Shared services handed to every screen.</summary>
public sealed class GameServices
{
    public required Game Game { get; init; }
    public required GraphicsDevice GraphicsDevice { get; init; }
    public required SpriteAtlas Atlas { get; init; }
    public required Fonts Fonts { get; init; }
    public required ScreenManager Screens { get; init; }
    public required BalanceConfig Balance { get; init; }
}
