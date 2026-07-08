using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;
using Microsoft.Xna.Framework.Input;
using MunchKeep.Core;
using MunchKeep.Persistence;
using MunchKeep.Simulation;
using MunchKeep.Simulation.Dungeon;
using MunchKeep.Simulation.Offline;
using MunchKeep.Presentation.Input;
using MunchKeep.Presentation.Iso;
using MunchKeep.Presentation.Rendering;
using MunchKeep.Presentation.UI;

namespace MunchKeep.Presentation.Screens;

public enum InteractionMode
{
    Inspect,
    BuildCorridor,
    BuildMobRoom,
    BuildTrapRoom,
    Demolish,
}

/// <summary>
/// The game proper: owns the Sim, steps it on a fixed 100ms accumulator, renders the
/// interpolated world, and routes player input to build/demolish/upgrade actions.
/// </summary>
public sealed class PlayScreen : Screen
{
    private const float AutosaveInterval = 60f;
    private const int MaxCatchUpTicks = 100; // stay responsive after long frame hitches

    private readonly SaveManager _saveManager = new();
    private readonly IsoCamera _camera = new();
    private readonly DungeonRenderer _dungeonRenderer;
    private readonly EntityRenderer _entityRenderer;
    private readonly FloatingTextSystem _floaties = new();
    private readonly Hud _hud;

    private float _accumulator;
    private float _autosaveTimer;
    private float _totalTime;
    private GridPos? _hoverCell;

    public Sim Sim { get; }
    public InteractionMode Mode { get; set; } = InteractionMode.Inspect;
    public GridPos? Selected { get; set; }
    public IReadOnlyList<string>? OfflinePopup { get; private set; }

    public PlayScreen(GameServices services, bool newGame) : base(services)
    {
        _dungeonRenderer = new DungeonRenderer(services.Atlas);
        _entityRenderer = new EntityRenderer(services.Atlas);
        _hud = new Hud(this, services);

        if (newGame) _saveManager.Delete();
        var data = newGame ? null : _saveManager.Load();
        if (data is not null)
        {
            Sim = SaveManager.FromData(data, services.Balance);
            ApplyOfflineProgress(data);
        }
        else
        {
            Sim = Sim.CreateNew(services.Balance, Environment.TickCount);
            _hud.Announce("Your heart beats. Dig, build, and let them come.", Color.White, 6f);
        }

        var mid = (Sim.Grid.Entrance.X + Sim.Grid.Heart.X) / 2f;
        _camera.Position = IsoMath.WorldToScreen(mid, Sim.Grid.Heart.Y);
    }

    private void ApplyOfflineProgress(SaveData data)
    {
        var elapsed = (DateTime.UtcNow - data.LastSavedUtc).TotalSeconds;
        var result = OfflineResolver.Resolve(Services.Balance, elapsed,
            data.EssencePerSecond, data.ScrapPerSecond, data.RenownPerSecond);
        if (elapsed < 60 || !result.AnyGain) return;

        Sim.Bank.Grant(result.Essence, result.Scrap);
        Sim.Renown += result.Renown;
        var away = TimeSpan.FromSeconds(result.Seconds);
        OfflinePopup = new[]
        {
            "While you were away...",
            $"({(int)away.TotalHours}h {away.Minutes}m of munching)",
            $"+{result.Essence:0} essence",
            $"+{result.Scrap:0} scrap",
            $"+{result.Renown:0} renown",
        };
    }

    public bool TryUpgradeSelected()
    {
        if (Selected is not { } cell || !Sim.TryUpgradeMob(cell)) return false;
        _floaties.Add("upgraded!", cell.X, cell.Y, Color.LightGreen);
        return true;
    }

    public override void Update(float dt, InputState input)
    {
        _totalTime += dt;

        if (OfflinePopup is not null)
        {
            if (input.WasPressed(Keys.Enter) || input.LeftClicked)
                OfflinePopup = null;
            return; // world holds its breath until the popup is dismissed
        }

        var viewport = Services.GraphicsDevice.Viewport;
        _camera.Update(dt, input, viewport);
        HandleHotkeys(input);
        UpdateHover(input, viewport);
        if (input.LeftClicked && !_hud.HandleClick(input.MousePosition, viewport))
            HandleGridClick();

        // Fixed-step simulation with render interpolation.
        _accumulator += dt;
        var ticks = 0;
        while (_accumulator >= Sim.TickSeconds && ticks++ < MaxCatchUpTicks)
        {
            _accumulator -= Sim.TickSeconds;
            Sim.Tick();
            ProcessSimEvents();
        }
        if (ticks >= MaxCatchUpTicks) _accumulator = 0;

        _floaties.Update(dt);
        _hud.Update(dt);

        _autosaveTimer += dt;
        if (_autosaveTimer >= AutosaveInterval)
        {
            _autosaveTimer = 0;
            _saveManager.Save(Sim);
        }
    }

    private void HandleHotkeys(InputState input)
    {
        if (input.WasPressed(Keys.D1)) Mode = InteractionMode.BuildCorridor;
        if (input.WasPressed(Keys.D2)) Mode = InteractionMode.BuildMobRoom;
        if (input.WasPressed(Keys.D3)) Mode = InteractionMode.BuildTrapRoom;
        if (input.WasPressed(Keys.X)) Mode = InteractionMode.Demolish;
        if (input.WasPressed(Keys.Q)) Mode = InteractionMode.Inspect;
        if (input.WasPressed(Keys.U)) TryUpgradeSelected();

        if (input.WasPressed(Keys.F5))
        {
            _saveManager.Save(Sim);
            _hud.Announce("Saved.", Color.LightGreen, 2f);
        }

        if (input.WasPressed(Keys.Escape))
        {
            if (Mode != InteractionMode.Inspect)
            {
                Mode = InteractionMode.Inspect;
            }
            else
            {
                _saveManager.Save(Sim);
                Services.Screens.SetScreen(new MenuScreen(Services));
            }
        }
    }

    private void UpdateHover(InputState input, Viewport viewport)
    {
        var world = IsoMath.ScreenToWorld(_camera.ScreenToWorldPixels(input.MouseVector, viewport));
        var cell = new GridPos((int)MathF.Round(world.X), (int)MathF.Round(world.Y));
        _hoverCell = Sim.Grid.InBounds(cell) ? cell : null;
    }

    private void HandleGridClick()
    {
        if (_hoverCell is not { } cell) return;
        switch (Mode)
        {
            case InteractionMode.BuildCorridor:
            case InteractionMode.BuildMobRoom:
            case InteractionMode.BuildTrapRoom:
                var type = Mode switch
                {
                    InteractionMode.BuildCorridor => RoomType.Corridor,
                    InteractionMode.BuildMobRoom => RoomType.MobRoom,
                    _ => RoomType.TrapRoom,
                };
                if (Sim.TryBuild(cell, type))
                    _floaties.Add($"-{Sim.Grid.BuildCost(type)}e", cell.X, cell.Y, Color.Yellow);
                else if (Sim.Grid.CanBuild(cell))
                    _floaties.Add("not enough essence", cell.X, cell.Y, Color.OrangeRed);
                break;

            case InteractionMode.Demolish:
                if (Sim.TryDemolish(cell))
                    _floaties.Add("demolished", cell.X, cell.Y, Color.Orange);
                break;

            case InteractionMode.Inspect:
                Selected = Sim.Grid.GetRoom(cell) is not null ? cell : null;
                break;
        }
    }

    private void ProcessSimEvents()
    {
        foreach (var e in Sim.Events)
        {
            switch (e.Type)
            {
                case SimEventType.Damage:
                    _floaties.Add($"-{e.Amount:0}", e.X, e.Y, new Color(255, 120, 90));
                    break;
                case SimEventType.HeroDied:
                    _floaties.Add("slain!", e.X, e.Y, Color.LightGray);
                    break;
                case SimEventType.MobDied:
                    _floaties.Add("defender down", e.X, e.Y, Color.Orange);
                    break;
                case SimEventType.MobRespawned:
                    _floaties.Add("rises again", e.X, e.Y, Color.LightGreen);
                    break;
                case SimEventType.TrapFired:
                    _floaties.Add("SNAP!", e.X, e.Y, Color.Yellow);
                    break;
                case SimEventType.Harvest:
                    _floaties.Add($"+{e.Amount:0}e +{e.Amount2:0}s", e.X, e.Y, Color.LightGreen);
                    break;
                case SimEventType.HeartDamaged:
                    _floaties.Add($"-{e.Amount:0}", e.X, e.Y, Color.Magenta);
                    break;
                case SimEventType.ResourceStolen:
                    _floaties.Add($"-{e.Amount:0}e stolen!", e.X, e.Y, Color.Red);
                    break;
                case SimEventType.HeartBroken:
                    _hud.Announce("YOUR HEART SHATTERS! Treasures scatter...", Color.Red, 6f);
                    break;
                case SimEventType.PartySpawned:
                    _hud.Announce($"A party of {(int)e.Amount} (Lv{(int)e.Amount2}) descends!", Color.White, 4f);
                    break;
                case SimEventType.HeroEscaped:
                    _floaties.Add(e.Amount >= 1 ? "escaped with loot!" : "fled!", e.X, e.Y, Color.OrangeRed);
                    break;
            }
        }
    }

    public override void Draw(SpriteBatch batch)
    {
        var viewport = Services.GraphicsDevice.Viewport;
        var transform = _camera.GetTransform(viewport);
        var alpha = MathHelper.Clamp(_accumulator / Sim.TickSeconds, 0f, 1f);

        batch.Begin(SpriteSortMode.FrontToBack, BlendState.NonPremultiplied,
            SamplerState.PointClamp, null, null, null, transform);
        _dungeonRenderer.Draw(batch, Sim, _totalTime, _hoverCell, HoverHighlightId(), Selected);
        _entityRenderer.Draw(batch, Sim, alpha);
        batch.End();

        batch.Begin(SpriteSortMode.Deferred, BlendState.NonPremultiplied,
            SamplerState.PointClamp, null, null, null, transform);
        _floaties.Draw(batch, Services.Fonts.Get(18));
        batch.End();

        batch.Begin(SpriteSortMode.Deferred, BlendState.NonPremultiplied);
        _hud.Draw(batch, viewport, _totalTime);
        if (OfflinePopup is not null)
            _hud.DrawPopup(batch, viewport, (IReadOnlyList<string>)OfflinePopup);
        batch.End();
    }

    private string? HoverHighlightId()
    {
        if (_hoverCell is not { } cell) return null;
        return Mode switch
        {
            InteractionMode.BuildCorridor or InteractionMode.BuildMobRoom or InteractionMode.BuildTrapRoom =>
                Sim.Grid.CanBuild(cell) ? "tile.highlight.valid" : "tile.highlight.invalid",
            InteractionMode.Demolish =>
                Sim.Grid.CanDemolish(cell) ? "tile.highlight.invalid" : null,
            _ => null,
        };
    }

    public override void OnExiting() => _saveManager.Save(Sim);
}
