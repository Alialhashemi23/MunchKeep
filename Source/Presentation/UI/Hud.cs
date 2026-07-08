using FontStashSharp;
using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;
using MunchKeep.Simulation.Dungeon;
using MunchKeep.Presentation.Screens;

namespace MunchKeep.Presentation.UI;

/// <summary>Screen-space UI: resource readout, heart bar, announcements, build bar, inspect panel.</summary>
public sealed class Hud
{
    private const int BarHeight = 58;

    private sealed record Button(Rectangle Rect, string Label, InteractionMode? Mode, string Action);

    private readonly PlayScreen _owner;
    private readonly GameServices _services;
    private readonly List<(string Text, Color Color, float Ttl)> _announcements = new();

    public Hud(PlayScreen owner, GameServices services)
    {
        _owner = owner;
        _services = services;
    }

    public void Announce(string text, Color color, float seconds = 4f) =>
        _announcements.Add((text, color, seconds));

    public void Update(float dt)
    {
        for (var i = _announcements.Count - 1; i >= 0; i--)
        {
            var (text, color, ttl) = _announcements[i];
            ttl -= dt;
            if (ttl <= 0) _announcements.RemoveAt(i);
            else _announcements[i] = (text, color, ttl);
        }
    }

    /// <summary>Returns true if the click landed on UI and must not reach the grid.</summary>
    public bool HandleClick(Point p, Viewport viewport)
    {
        foreach (var button in BuildButtons(viewport))
        {
            if (!button.Rect.Contains(p)) continue;
            if (button.Action == "upgrade") _owner.TryUpgradeSelected();
            else if (button.Mode is { } mode) _owner.Mode = mode;
            return true;
        }
        return BottomBar(viewport).Contains(p) || TopLeftPanel().Contains(p);
    }

    public void Draw(SpriteBatch batch, Viewport viewport, float totalTime)
    {
        var sim = _owner.Sim;
        var font = _services.Fonts.Get(20);
        var small = _services.Fonts.Get(16);
        var pixel = _services.Atlas.Pixel;

        // --- resources, top-left
        var panel = TopLeftPanel();
        batch.Draw(pixel, panel, Color.Black * 0.55f);
        batch.DrawString(font, $"Essence  {sim.Bank.Essence:0}", new Vector2(panel.X + 10, panel.Y + 8), new Color(255, 214, 120));
        batch.DrawString(font, $"Scrap    {sim.Bank.Scrap:0}", new Vector2(panel.X + 10, panel.Y + 32), new Color(190, 200, 210));
        batch.DrawString(font, $"Renown   {sim.Renown:0}", new Vector2(panel.X + 10, panel.Y + 56), new Color(200, 150, 255));
        var partyLine = sim.Heroes.Count > 0
            ? $"Raid in progress ({sim.Heroes.Count} inside)"
            : $"Next party in {MathF.Max(0, sim.PartyTimer):0}s";
        batch.DrawString(small, partyLine, new Vector2(panel.X + 10, panel.Y + 84), Color.White);
        if (!sim.Grid.HeartReachable)
            batch.DrawString(small, "Heart cut off! No one will come.", new Vector2(panel.X + 10, panel.Y + 104), Color.OrangeRed);

        // --- heart bar, top-center
        var barW = 320;
        var heartRect = new Rectangle(viewport.Width / 2 - barW / 2, 12, barW, 18);
        batch.Draw(pixel, heartRect, new Color(40, 10, 16));
        var ratio = MathHelper.Clamp(sim.HeartHp / sim.HeartMaxHp, 0f, 1f);
        batch.Draw(pixel, new Rectangle(heartRect.X, heartRect.Y, (int)(barW * ratio), heartRect.Height), new Color(214, 60, 88));
        var heartText = $"Dungeon Heart  {sim.HeartHp:0}/{sim.HeartMaxHp:0}";
        var heartTextW = small.MeasureString(heartText).X;
        batch.DrawString(small, heartText, new Vector2(viewport.Width / 2f - heartTextW / 2f, heartRect.Y + 1), Color.White);

        // --- announcements under the heart bar
        var y = 44f;
        foreach (var (text, color, ttl) in _announcements)
        {
            var alpha = MathHelper.Clamp(ttl, 0f, 1f);
            var w = font.MeasureString(text).X;
            batch.DrawString(font, text, new Vector2(viewport.Width / 2f - w / 2f, y), color * alpha);
            y += 24;
        }

        // --- bottom build bar
        var bar = BottomBar(viewport);
        batch.Draw(pixel, bar, Color.Black * 0.6f);
        foreach (var button in BuildButtons(viewport))
        {
            var active = button.Mode is { } mode && mode == _owner.Mode;
            batch.Draw(pixel, button.Rect, active ? new Color(90, 80, 40) * 0.9f : Color.White * 0.08f);
            if (active) DrawBorder(batch, pixel, button.Rect, new Color(255, 220, 120));
            var size = small.MeasureString(button.Label);
            batch.DrawString(small, button.Label, new Vector2(
                button.Rect.Center.X - size.X / 2f, button.Rect.Center.Y - size.Y / 2f), Color.White);
        }
        var hints = "WASD/RMB drag: pan   wheel: zoom   F5: save   Esc: menu";
        var hintsW = small.MeasureString(hints).X;
        batch.DrawString(small, hints, new Vector2(viewport.Width - hintsW - 12, bar.Y - 22), Color.Gray);

        // --- inspect panel
        if (_owner.Selected is { } sel && sim.Grid.GetRoom(sel) is { } room)
        {
            var info = new Rectangle(viewport.Width - 280, bar.Y - 96, 268, 88);
            batch.Draw(pixel, info, Color.Black * 0.6f);
            batch.DrawString(small, RoomTitle(room), new Vector2(info.X + 10, info.Y + 8), Color.White);
            if (room.Type == RoomType.MobRoom)
            {
                var hp = room.Mob is { } mob ? $"HP {mob.Hp:0}/{mob.MaxHp:0}" : $"respawning ({room.MobRespawnTimer:0}s)";
                batch.DrawString(small, hp, new Vector2(info.X + 10, info.Y + 30), Color.LightGray);
                var cost = sim.Balance.MobUpgradeCost(room.MobLevel);
                var affordable = sim.Bank.CanAfford(0, cost);
                batch.DrawString(small, $"[U] Upgrade to Lv{room.MobLevel + 1}  ({cost} scrap)",
                    new Vector2(info.X + 10, info.Y + 56), affordable ? Color.LightGreen : Color.Gray);
            }
            else if (room.Type == RoomType.TrapRoom)
            {
                batch.DrawString(small, room.TrapArmed ? "Armed and hungry." : $"Rearming ({room.TrapRearmTimer:0.0}s)",
                    new Vector2(info.X + 10, info.Y + 30), Color.LightGray);
            }
        }
    }

    public void DrawPopup(SpriteBatch batch, Viewport viewport, IReadOnlyList<string> lines)
    {
        var font = _services.Fonts.Get(22);
        var pixel = _services.Atlas.Pixel;
        var w = 460;
        var h = 60 + lines.Count * 28;
        var rect = new Rectangle(viewport.Width / 2 - w / 2, viewport.Height / 2 - h / 2, w, h);
        batch.Draw(pixel, new Rectangle(0, 0, viewport.Width, viewport.Height), Color.Black * 0.5f);
        batch.Draw(pixel, rect, new Color(24, 20, 30));
        DrawBorder(batch, pixel, rect, new Color(230, 90, 110));
        var y = rect.Y + 18f;
        foreach (var line in lines)
        {
            var lw = font.MeasureString(line).X;
            batch.DrawString(font, line, new Vector2(viewport.Width / 2f - lw / 2f, y), Color.White);
            y += 28;
        }
        var hint = "click or press Enter";
        var hintW = font.MeasureString(hint).X;
        batch.DrawString(font, hint, new Vector2(viewport.Width / 2f - hintW / 2f, rect.Bottom - 34), Color.Gray);
    }

    private static string RoomTitle(Room room) => room.Type switch
    {
        RoomType.MobRoom => $"Goblin Den  ·  Lv{room.MobLevel}",
        RoomType.TrapRoom => "Spike Trap",
        RoomType.Corridor => "Corridor",
        RoomType.Entrance => "Entrance",
        RoomType.Heart => "Dungeon Heart",
        _ => "?",
    };

    private static void DrawBorder(SpriteBatch batch, Texture2D pixel, Rectangle r, Color color)
    {
        batch.Draw(pixel, new Rectangle(r.X, r.Y, r.Width, 2), color);
        batch.Draw(pixel, new Rectangle(r.X, r.Bottom - 2, r.Width, 2), color);
        batch.Draw(pixel, new Rectangle(r.X, r.Y, 2, r.Height), color);
        batch.Draw(pixel, new Rectangle(r.Right - 2, r.Y, 2, r.Height), color);
    }

    private static Rectangle TopLeftPanel() => new(10, 10, 240, 126);

    private static Rectangle BottomBar(Viewport viewport) =>
        new(0, viewport.Height - BarHeight, viewport.Width, BarHeight);

    private List<Button> BuildButtons(Viewport viewport)
    {
        var sim = _owner.Sim;
        var bar = BottomBar(viewport);
        var buttons = new List<Button>();
        var x = 10;
        void Add(string label, InteractionMode? mode, string action = "mode", int width = 170)
        {
            buttons.Add(new Button(new Rectangle(x, bar.Y + 9, width, BarHeight - 18), label, mode, action));
            x += width + 8;
        }

        Add($"[1] Corridor  {sim.Balance.CorridorCost}e", InteractionMode.BuildCorridor);
        Add($"[2] Goblin Den  {sim.Balance.MobRoomCost}e", InteractionMode.BuildMobRoom);
        Add($"[3] Spike Trap  {sim.Balance.TrapRoomCost}e", InteractionMode.BuildTrapRoom);
        Add("[X] Demolish", InteractionMode.Demolish, width: 130);
        Add("[Q] Inspect", InteractionMode.Inspect, width: 120);

        if (_owner.Selected is { } sel && sim.Grid.GetRoom(sel)?.Type == RoomType.MobRoom)
        {
            var info = new Rectangle(viewport.Width - 280, bar.Y - 96, 268, 88);
            buttons.Add(new Button(new Rectangle(info.X + 6, info.Y + 52, info.Width - 12, 28), "", null, "upgrade"));
        }
        return buttons;
    }
}
