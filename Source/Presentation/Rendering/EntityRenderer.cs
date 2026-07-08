using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;
using MunchKeep.Simulation;
using MunchKeep.Simulation.Dungeon;
using MunchKeep.Presentation.Iso;

namespace MunchKeep.Presentation.Rendering;

/// <summary>Heroes, mobs and corpses, depth-sorted by interpolated world position.</summary>
public sealed class EntityRenderer
{
    private readonly SpriteAtlas _atlas;

    public EntityRenderer(SpriteAtlas atlas) => _atlas = atlas;

    /// <param name="alpha">Interpolation factor between the previous and current sim tick.</param>
    public void Draw(SpriteBatch batch, Sim sim, float alpha)
    {
        foreach (var corpse in sim.Corpses)
        {
            var screen = IsoMath.WorldToScreen(corpse.X, corpse.Y);
            var depth = DungeonRenderer.EntityDepth(sim, corpse.X, corpse.Y) - 0.02f; // under feet
            var fade = MathHelper.Clamp(corpse.Timer / 1.5f, 0.25f, 1f);
            _atlas.Draw(batch, "unit.corpse", screen + new Vector2(0, 6), depth, Color.White * fade);
        }

        foreach (var (pos, room) in sim.Grid.Rooms())
        {
            if (room.Type != RoomType.MobRoom || room.Mob is not { Alive: true } mob) continue;
            var screen = IsoMath.WorldToScreen(pos.X, pos.Y) + new Vector2(0, 6);
            var depth = DungeonRenderer.EntityDepth(sim, pos.X, pos.Y);
            var scale = MathF.Min(1.4f, 1f + 0.06f * (mob.Level - 1)); // higher level = beefier
            _atlas.Draw(batch, "unit.goblin", screen, depth, Color.White, scale);
            if (mob.Hp < mob.MaxHp)
                DrawBar(batch, screen, depth, mob.Hp / mob.MaxHp, 26, Color.LimeGreen);
        }

        foreach (var hero in sim.Heroes)
        {
            var x = MathHelper.Lerp(hero.PrevX, hero.X, alpha);
            var y = MathHelper.Lerp(hero.PrevY, hero.Y, alpha);
            // Nudge party members apart so stacked heroes stay readable.
            var offset = (hero.Id % 3 - 1) * 0.14f;
            var screen = IsoMath.WorldToScreen(x + offset, y - offset) + new Vector2(0, 6);
            var depth = DungeonRenderer.EntityDepth(sim, x, y);
            _atlas.Draw(batch, "unit.hero", screen, depth);
            DrawBar(batch, screen, depth, hero.Hp / hero.MaxHp, 24, Color.OrangeRed);
        }
    }

    private void DrawBar(SpriteBatch batch, Vector2 feet, float depth, float ratio, int width, Color color)
    {
        var barPos = feet + new Vector2(-width / 2f, -38);
        batch.Draw(_atlas.Pixel, barPos, null, Color.Black * 0.6f, 0f, Vector2.Zero,
            new Vector2(width, 3), SpriteEffects.None, depth + 0.001f);
        batch.Draw(_atlas.Pixel, barPos, null, color, 0f, Vector2.Zero,
            new Vector2(width * MathHelper.Clamp(ratio, 0f, 1f), 3), SpriteEffects.None, depth + 0.002f);
    }
}
