using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Input;

namespace MunchKeep.Presentation.Input;

/// <summary>Current + previous frame input snapshots with edge-detection helpers.</summary>
public sealed class InputState
{
    public KeyboardState Keyboard { get; private set; }
    public KeyboardState PrevKeyboard { get; private set; }
    public MouseState Mouse { get; private set; }
    public MouseState PrevMouse { get; private set; }

    public void Update()
    {
        PrevKeyboard = Keyboard;
        PrevMouse = Mouse;
        Keyboard = Microsoft.Xna.Framework.Input.Keyboard.GetState();
        Mouse = Microsoft.Xna.Framework.Input.Mouse.GetState();
    }

    public bool IsDown(Keys key) => Keyboard.IsKeyDown(key);
    public bool WasPressed(Keys key) => Keyboard.IsKeyDown(key) && PrevKeyboard.IsKeyUp(key);

    public Point MousePosition => Mouse.Position;
    public Vector2 MouseVector => Mouse.Position.ToVector2();
    public bool LeftClicked => Mouse.LeftButton == ButtonState.Pressed && PrevMouse.LeftButton == ButtonState.Released;
    public bool LeftHeld => Mouse.LeftButton == ButtonState.Pressed;
    public bool RightHeld => Mouse.RightButton == ButtonState.Pressed;
    public bool MiddleHeld => Mouse.MiddleButton == ButtonState.Pressed;
    public int ScrollDelta => Mouse.ScrollWheelValue - PrevMouse.ScrollWheelValue;
    public Vector2 MouseDelta => (Mouse.Position - PrevMouse.Position).ToVector2();
}
