using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;
using MunchKeep.Data;
using MunchKeep.Presentation.Input;
using MunchKeep.Presentation.Rendering;
using MunchKeep.Presentation.Screens;

namespace MunchKeep;

/// <summary>Thin bootstrap: window setup, shared services, and the screen loop.</summary>
public class Game1 : Game
{
    private readonly GraphicsDeviceManager _graphics;
    private readonly InputState _input = new();
    private readonly ScreenManager _screens = new();
    private SpriteBatch _spriteBatch = null!;
    private SpriteAtlas _atlas = null!;

    public Game1()
    {
        _graphics = new GraphicsDeviceManager(this)
        {
            PreferredBackBufferWidth = 1280,
            PreferredBackBufferHeight = 720,
        };
        Window.AllowUserResizing = true;
        Window.Title = "MunchKeep";
        IsMouseVisible = true;
    }

    protected override void LoadContent()
    {
        _spriteBatch = new SpriteBatch(GraphicsDevice);
        _atlas = new SpriteAtlas(GraphicsDevice);
        var services = new GameServices
        {
            Game = this,
            GraphicsDevice = GraphicsDevice,
            Atlas = _atlas,
            Fonts = new Fonts(),
            Screens = _screens,
            Balance = BalanceLoader.Load(),
        };
        _screens.SetScreen(new MenuScreen(services));
    }

    protected override void Update(GameTime gameTime)
    {
        _input.Update();
        _screens.Current?.Update((float)gameTime.ElapsedGameTime.TotalSeconds, _input);
        base.Update(gameTime);
    }

    protected override void Draw(GameTime gameTime)
    {
        GraphicsDevice.Clear(new Color(16, 14, 20));
        _screens.Current?.Draw(_spriteBatch);
        base.Draw(gameTime);
    }

    protected override void UnloadContent()
    {
        _screens.Current?.OnExiting(); // save on the way out
        _atlas?.Dispose();
        base.UnloadContent();
    }
}
