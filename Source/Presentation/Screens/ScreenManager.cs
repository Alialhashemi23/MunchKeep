using Microsoft.Xna.Framework.Graphics;
using MunchKeep.Presentation.Input;

namespace MunchKeep.Presentation.Screens;

public abstract class Screen
{
    protected GameServices Services { get; }

    protected Screen(GameServices services) => Services = services;

    public abstract void Update(float dt, InputState input);
    public abstract void Draw(SpriteBatch batch);

    /// <summary>Called when the game shuts down while this screen is active.</summary>
    public virtual void OnExiting() { }
}

public sealed class ScreenManager
{
    public Screen? Current { get; private set; }

    public void SetScreen(Screen screen) => Current = screen;
}
