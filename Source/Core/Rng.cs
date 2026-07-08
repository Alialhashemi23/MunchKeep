namespace MunchKeep.Core;

/// <summary>
/// Seedable RNG wrapper so simulation runs are reproducible. A saved seed counter
/// lets us re-create the stream after load without persisting internal state.
/// </summary>
public sealed class Rng
{
    private Random _random;

    public int Seed { get; private set; }

    public Rng(int seed)
    {
        Seed = seed;
        _random = new Random(seed);
    }

    public void Reseed(int seed)
    {
        Seed = seed;
        _random = new Random(seed);
    }

    public int NextInt(int minInclusive, int maxExclusive) => _random.Next(minInclusive, maxExclusive);

    public float NextFloat() => (float)_random.NextDouble();

    public float NextFloat(float min, float max) => min + (max - min) * NextFloat();
}
