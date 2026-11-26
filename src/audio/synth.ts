/** Offline retro sound synthesis: layers of simple oscillators rendered to a sample buffer. */

export type Wave = 'square' | 'saw' | 'tri' | 'sine' | 'noise';

export interface Layer {
  wave: Wave;
  f0: number;
  f1?: number;
  dur: number;
  delay?: number;
  vol?: number;
  attack?: number;
  /** Decay curve exponent: 1 linear, >1 snappier. */
  curve?: number;
  duty?: number;
  vib?: [rate: number, depth: number];
  /** One-pole lowpass cutoff (Hz), optionally swept to lp1. */
  lp?: number;
  lp1?: number;
  hp?: number;
  /** Arpeggio: semitone offsets cycled every stepDur seconds. */
  steps?: number[];
  stepDur?: number;
}

export function render(layers: Layer[], sr: number): Float32Array {
  const total = Math.max(...layers.map((l) => (l.delay ?? 0) + l.dur));
  const out = new Float32Array(Math.ceil(total * sr) + 1);
  for (const l of layers) renderLayer(l, out, sr);
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  if (peak > 1) for (let i = 0; i < out.length; i++) out[i] /= peak;
  return out;
}

function renderLayer(l: Layer, out: Float32Array, sr: number): void {
  const start = Math.floor((l.delay ?? 0) * sr);
  const n = Math.floor(l.dur * sr);
  const vol = l.vol ?? 0.5;
  const attack = l.attack ?? 0.004;
  const curve = l.curve ?? 1.6;
  const duty = l.duty ?? 0.5;
  let phase = 0;
  let noiseVal = 0;
  let lpY = 0;
  let hpY = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const k = t / l.dur;
    let f = l.f1 !== undefined ? l.f0 * Math.pow(l.f1 / l.f0, k) : l.f0;
    if (l.steps && l.stepDur) f *= Math.pow(2, l.steps[Math.floor(t / l.stepDur) % l.steps.length] / 12);
    if (l.vib) f *= 1 + Math.sin(t * Math.PI * 2 * l.vib[0]) * l.vib[1];
    const prev = phase;
    phase = (phase + f / sr) % 1;
    let s: number;
    switch (l.wave) {
      case 'square':
        s = phase < duty ? 1 : -1;
        break;
      case 'saw':
        s = phase * 2 - 1;
        break;
      case 'tri':
        s = phase < 0.5 ? phase * 4 - 1 : 3 - phase * 4;
        break;
      case 'sine':
        s = Math.sin(phase * Math.PI * 2);
        break;
      default:
        if (phase < prev) noiseVal = Math.random() * 2 - 1;
        s = noiseVal;
    }
    if (l.lp) {
      const fc = l.lp1 !== undefined ? l.lp * Math.pow(l.lp1 / l.lp, k) : l.lp;
      const a = 1 - Math.exp((-2 * Math.PI * fc) / sr);
      lpY += a * (s - lpY);
      s = lpY;
    }
    if (l.hp) {
      const a = 1 - Math.exp((-2 * Math.PI * l.hp) / sr);
      hpY += a * (s - hpY);
      s = s - hpY;
    }
    const env = t < attack ? t / attack : Math.pow(Math.max(0, 1 - (t - attack) / Math.max(1e-4, l.dur - attack)), curve);
    const idx = start + i;
    if (idx < out.length) out[idx] += s * env * vol;
  }
}

/** Every sound effect in the game. */
export const SFX: Record<string, Layer[]> = {
  click: [{ wave: 'tri', f0: 900, f1: 1200, dur: 0.04, vol: 0.3 }],
  hover: [{ wave: 'tri', f0: 1400, dur: 0.02, vol: 0.12 }],
  nope: [
    { wave: 'square', f0: 220, f1: 180, dur: 0.07, vol: 0.25, duty: 0.25 },
    { wave: 'square', f0: 180, f1: 150, dur: 0.09, delay: 0.08, vol: 0.25, duty: 0.25 },
  ],
  dig: [
    { wave: 'noise', f0: 2400, dur: 0.14, vol: 0.5, lp: 1800, lp1: 400 },
    { wave: 'tri', f0: 180, f1: 70, dur: 0.12, vol: 0.5 },
  ],
  fill: [
    { wave: 'noise', f0: 1200, dur: 0.2, vol: 0.5, lp: 900, lp1: 200 },
    { wave: 'sine', f0: 90, f1: 50, dur: 0.18, vol: 0.6 },
  ],
  build: [
    { wave: 'square', f0: 330, f1: 660, dur: 0.08, vol: 0.25, duty: 0.25 },
    { wave: 'square', f0: 495, f1: 990, dur: 0.1, delay: 0.07, vol: 0.2, duty: 0.25 },
    { wave: 'sine', f0: 120, f1: 60, dur: 0.12, vol: 0.5 },
  ],
  upgrade: [{ wave: 'square', f0: 523, dur: 0.32, vol: 0.22, duty: 0.25, steps: [0, 4, 7, 12], stepDur: 0.07, curve: 1 }],
  demolish: [
    { wave: 'noise', f0: 1500, dur: 0.25, vol: 0.45, lp: 1500, lp1: 300 },
    { wave: 'square', f0: 300, f1: 120, dur: 0.15, vol: 0.2, duty: 0.25 },
  ],
  hit: [
    { wave: 'noise', f0: 5000, dur: 0.05, vol: 0.35, lp: 4000 },
    { wave: 'square', f0: 420, f1: 160, dur: 0.07, vol: 0.2, duty: 0.25 },
  ],
  heroHurt: [{ wave: 'square', f0: 380, f1: 140, dur: 0.09, vol: 0.22, duty: 0.3 }],
  monsterHurt: [{ wave: 'square', f0: 240, f1: 100, dur: 0.08, vol: 0.2, duty: 0.4 }],
  spikes: [
    { wave: 'noise', f0: 9000, dur: 0.06, vol: 0.3, hp: 2500 },
    { wave: 'tri', f0: 1400, f1: 900, dur: 0.1, vol: 0.35 },
    { wave: 'square', f0: 2200, f1: 1800, dur: 0.05, vol: 0.12, delay: 0.02, duty: 0.25 },
  ],
  oil: [
    { wave: 'noise', f0: 800, dur: 0.22, vol: 0.45, lp: 600, lp1: 150 },
    { wave: 'sine', f0: 140, f1: 50, dur: 0.2, vol: 0.5, vib: [18, 0.2] },
  ],
  fire: [
    { wave: 'noise', f0: 3000, dur: 0.45, vol: 0.55, lp: 300, lp1: 3500, attack: 0.04, curve: 1.2 },
    { wave: 'noise', f0: 9000, dur: 0.3, vol: 0.15, hp: 4000, delay: 0.1 },
  ],
  ignite: [
    { wave: 'noise', f0: 4000, dur: 0.6, vol: 0.4, lp: 800, lp1: 4000, attack: 0.02 },
    { wave: 'saw', f0: 200, f1: 600, dur: 0.25, vol: 0.12 },
  ],
  sticky: [{ wave: 'sine', f0: 300, f1: 90, dur: 0.18, vol: 0.45, vib: [30, 0.3] }],
  chomp: [
    { wave: 'square', f0: 110, f1: 40, dur: 0.09, vol: 0.5, duty: 0.4 },
    { wave: 'noise', f0: 1500, dur: 0.06, vol: 0.4, lp: 1200 },
    { wave: 'square', f0: 95, f1: 35, dur: 0.11, delay: 0.1, vol: 0.5, duty: 0.4 },
    { wave: 'noise', f0: 1200, dur: 0.07, delay: 0.1, vol: 0.4, lp: 1000 },
  ],
  coin: [{ wave: 'square', f0: 988, dur: 0.16, vol: 0.18, duty: 0.25, steps: [0, 5], stepDur: 0.05, curve: 1.3 }],
  death: [
    { wave: 'square', f0: 700, f1: 90, dur: 0.26, vol: 0.22, duty: 0.25, vib: [14, 0.08] },
    { wave: 'noise', f0: 3000, dur: 0.08, vol: 0.25, delay: 0.2, lp: 2000 },
  ],
  monsterDeath: [
    { wave: 'noise', f0: 2000, dur: 0.18, vol: 0.4, lp: 1600, lp1: 300 },
    { wave: 'square', f0: 260, f1: 80, dur: 0.15, vol: 0.15, duty: 0.4 },
  ],
  respawn: [{ wave: 'tri', f0: 300, f1: 600, dur: 0.12, vol: 0.18 }],
  bite: [
    { wave: 'saw', f0: 120, f1: 70, dur: 0.28, vol: 0.35, vib: [9, 0.15], lp: 900 },
    { wave: 'noise', f0: 1200, dur: 0.12, vol: 0.3, lp: 800 },
  ],
  alarm: [
    { wave: 'square', f0: 660, dur: 0.14, vol: 0.18, duty: 0.25 },
    { wave: 'square', f0: 440, dur: 0.14, delay: 0.15, vol: 0.18, duty: 0.25 },
  ],
  horn: [
    { wave: 'saw', f0: 196, f1: 262, dur: 0.55, vol: 0.22, attack: 0.05, vib: [6, 0.02], lp: 1400, curve: 0.8 },
    { wave: 'saw', f0: 98, f1: 131, dur: 0.55, vol: 0.12, attack: 0.05, lp: 700, curve: 0.8 },
  ],
  champion: [
    { wave: 'square', f0: 262, dur: 0.9, vol: 0.2, duty: 0.25, steps: [0, 7, 12, 15, 12, 19], stepDur: 0.12, curve: 0.8 },
    { wave: 'saw', f0: 65, dur: 0.9, vol: 0.18, lp: 500, curve: 0.8 },
  ],
  unlock: [{ wave: 'tri', f0: 523, dur: 0.5, vol: 0.35, steps: [0, 4, 7, 12, 16], stepDur: 0.08, curve: 1 }],
  escape: [{ wave: 'sine', f0: 700, f1: 1500, dur: 0.22, vol: 0.25, vib: [20, 0.05] }],
  heal: [{ wave: 'sine', f0: 660, f1: 990, dur: 0.18, vol: 0.18, vib: [25, 0.04] }],
  disarm: [
    { wave: 'tri', f0: 1800, dur: 0.05, vol: 0.3 },
    { wave: 'tri', f0: 1300, dur: 0.08, delay: 0.05, vol: 0.25 },
  ],
  spotted: [{ wave: 'square', f0: 1000, f1: 1500, dur: 0.08, vol: 0.15, duty: 0.25 }],
  ambush: [
    { wave: 'square', f0: 140, f1: 60, dur: 0.2, vol: 0.4, duty: 0.4 },
    { wave: 'noise', f0: 2000, dur: 0.15, vol: 0.35, lp: 1500 },
    { wave: 'square', f0: 880, dur: 0.1, delay: 0.05, vol: 0.15, duty: 0.25 },
  ],
  wipe: [{ wave: 'square', f0: 392, dur: 0.55, vol: 0.18, duty: 0.25, steps: [0, 4, 7, 12, 7, 12], stepDur: 0.08, curve: 0.9 }],
  collapse: [
    { wave: 'noise', f0: 400, dur: 2.4, vol: 0.7, lp: 300, lp1: 60, attack: 0.05, curve: 1.2 },
    { wave: 'saw', f0: 220, f1: 40, dur: 2.0, vol: 0.25, lp: 800, lp1: 120 },
  ],
  teeth: [{ wave: 'tri', f0: 784, dur: 0.3, vol: 0.3, steps: [0, 7, 12], stepDur: 0.07 }],
};
