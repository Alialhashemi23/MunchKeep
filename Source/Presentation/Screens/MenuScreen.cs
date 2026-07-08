using FontStashSharp;
using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;
using Microsoft.Xna.Framework.Input;
using MunchKeep.Persistence;
using MunchKeep.Presentation.Input;

namespace MunchKeep.Presentation.Screens;

public sealed class MenuScreen : Screen
{
    public MenuScreen(GameServices services) : base(services) { }

    public override void Update(float dt, InputState input)
    {
        if (input.WasPressed(Keys.Enter))
            Services.Screens.SetScreen(new PlayScreen(Services, newGame: false));
        else if (input.WasPressed(Keys.N))
            Services.Screens.SetScreen(new PlayScreen(Services, newGame: true));
        else if (input.WasPressed(Keys.Escape))
            Services.Game.Exit();
    }

    public override void Draw(SpriteBatch batch)
    {
        var viewport = Services.GraphicsDevice.Viewport;
        var center = new Vector2(viewport.Width / 2f, viewport.Height / 2f);
        var hasSave = new SaveManager().SaveExists;

        batch.Begin();
        DrawCentered(batch, 64, "MunchKeep", center + new Vector2(0, -120), new Color(230, 90, 110));
        DrawCentered(batch, 22, "You are the dungeon. They are the food.", center + new Vector2(0, -60), Color.LightGray);
        DrawCentered(batch, 26, hasSave ? "[Enter]  Return to your depths" : "[Enter]  Dig your first halls",
            center + new Vector2(0, 20), Color.White);
        DrawCentered(batch, 20, "[N]  New dungeon (erases save)", center + new Vector2(0, 60), Color.Gray);
        DrawCentered(batch, 20, "[Esc]  Quit", center + new Vector2(0, 92), Color.Gray);
        batch.End();
    }

    private void DrawCentered(SpriteBatch batch, int size, string text, Vector2 at, Color color)
    {
        var font = Services.Fonts.Get(size);
        var width = font.MeasureString(text).X;
        batch.DrawString(font, text, at - new Vector2(width / 2f, 0), color);
    }
}
