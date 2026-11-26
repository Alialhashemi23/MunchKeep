/**
 * A tiny chiptune sequencer. One looping song in D minor with layers that fade in
 * as raids get more dangerous: 0 = quiet, 1 = raid in progress, 2 = heroes at the Maw.
 */

const NOTE: Record<string, number> = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };

function freq(name: string): number {
  const m = /^([A-G][#b]?)(-?\d)$/.exec(name);
  if (!m) return 0;
  const midi = 12 * (parseInt(m[2], 10) + 1) + NOTE[m[1]];
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Space-separated steps (16 per bar). '.' rests, '-' holds the previous note. */
function bars(...lines: string[]): string[] {
  return lines.join(' ').trim().split(/\s+/);
}

const LEAD_A = bars(
  'D4 - - F4 E4 - D4 - A4 - - - G4 F4 E4 -',
  'F4 - - A4 G4 - F4 - E4 - - - C#4 - - -',
  'D4 - - F4 E4 - D4 - A4 - - - Bb4 - A4 -',
  'G4 - F4 - E4 - F4 - E4 - D4 - C#4 - E4 -',
);
const LEAD_B = bars(
  'Bb4 - A4 - G4 - A4 - Bb4 - - - D5 - - -',
  'C#5 - - - A4 - - - E4 - - - A4 - - -',
  'D5 - C5 - Bb4 - A4 - G4 - F4 - E4 - D4 -',
  'E4 - - - F4 - - - G4 - - - A4 - - -',
);
const BASS_A = bars(
  'D2 . D3 . D2 . D3 . D2 . D3 . F2 . A2 .',
  'Bb1 . Bb2 . Bb1 . Bb2 . A1 . A2 . A1 . C#2 .',
  'D2 . D3 . D2 . D3 . F2 . F3 . G2 . G3 .',
  'A1 . A2 . A1 . A2 . A1 . E2 . A2 . C#3 .',
);
const BASS_B = bars(
  'G1 . G2 . G1 . G2 . G1 . G2 . Bb1 . D2 .',
  'A1 . A2 . A1 . A2 . A1 . A2 . C#2 . E2 .',
  'Bb1 . Bb2 . Bb1 . Bb2 . G1 . G2 . G1 . G2 .',
  'A1 . A2 . A1 . A2 . A1 . E2 . A2 . C#3 .',
);
// One chord per half bar, arpeggiated in 16ths.
const CHORDS_A = ['Dm', 'Dm', 'Bb', 'A', 'Dm', 'F', 'A', 'A'];
const CHORDS_B = ['Gm', 'Gm', 'A', 'A', 'Bb', 'Gm', 'A', 'A'];
const CHORD_NOTES: Record<string, string[]> = {
  Dm: ['D4', 'F4', 'A4', 'D5'],
  Bb: ['Bb3', 'D4', 'F4', 'Bb4'],
  A: ['A3', 'C#4', 'E4', 'A4'],
  F: ['F4', 'A4', 'C5', 'F5'],
  Gm: ['G3', 'Bb3', 'D4', 'G4'],
};

const SECTIONS: ('A' | 'B')[] = ['A', 'A', 'B', 'A'];
const BPM = 118;
const STEP = 60 / BPM / 4;
const STEPS_PER_SECTION = 64;

export class Music {
  private ctx: AudioContext;
  private out: GainNode;
  private lead: GainNode;
  private bass: GainNode;
  private arp: GainNode;
  private drums: GainNode;
  private hats: GainNode;
  private noise: AudioBuffer;
  private timer: number | null = null;
  private step = 0;
  private nextTime = 0;
  private intensity = 0;

  constructor(ctx: AudioContext, dest: AudioNode) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.connect(dest);
    const mk = (v: number) => {
      const g = ctx.createGain();
      g.gain.value = v;
      g.connect(this.out);
      return g;
    };
    this.lead = mk(0.11);
    this.bass = mk(0.22);
    this.arp = mk(0);
    this.drums = mk(0);
    this.hats = mk(0);
    const len = Math.floor(ctx.sampleRate * 0.3);
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  start(): void {
    if (this.timer !== null) return;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 30);
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  setIntensity(level: number): void {
    if (level === this.intensity) return;
    this.intensity = level;
    const t = this.ctx.currentTime;
    const ramp = (g: GainNode, v: number) => {
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.linearRampToValueAtTime(v, t + 1.2);
    };
    ramp(this.drums, level >= 1 ? 0.5 : 0);
    ramp(this.arp, level >= 1 ? 0.045 : 0);
    ramp(this.hats, level >= 2 ? 0.12 : 0);
    ramp(this.lead, level >= 2 ? 0.14 : 0.11);
  }

  private schedule(): void {
    while (this.nextTime < this.ctx.currentTime + 0.15) {
      this.playStep(this.step, this.nextTime);
      this.step = (this.step + 1) % (STEPS_PER_SECTION * SECTIONS.length);
      this.nextTime += STEP;
    }
  }

  private playStep(step: number, t: number): void {
    const section = SECTIONS[Math.floor(step / STEPS_PER_SECTION)];
    const s = step % STEPS_PER_SECTION;
    const lead = section === 'A' ? LEAD_A : LEAD_B;
    const bass = section === 'A' ? BASS_A : BASS_B;

    const note = lead[s];
    if (note !== '.' && note !== '-') {
      let len = 1;
      while (lead[s + len] === '-') len++;
      this.tone('square', freq(note), t, len * STEP * 0.92, this.lead, 2400);
    }
    const b = bass[s];
    if (b !== '.' && b !== '-') this.tone('triangle', freq(b), t, STEP * 1.6, this.bass, 0);

    const chords = section === 'A' ? CHORDS_A : CHORDS_B;
    const chord = CHORD_NOTES[chords[Math.floor(s / 8)]];
    this.tone('square', freq(chord[s % 4]) * 2, t, STEP * 0.5, this.arp, 3000);

    const beat = s % 16;
    if (beat === 0 || beat === 8 || beat === 10) this.kick(t);
    if (beat === 4 || beat === 12) this.snare(t);
    if (beat % 2 === 0) this.hat(t, this.drums, 0.25);
    this.hat(t, this.hats, 0.6);
  }

  private tone(type: OscillatorType, f: number, t: number, dur: number, dest: GainNode, lp: number): void {
    if (!f) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1, t + 0.005);
    g.gain.setValueAtTime(1, t + dur * 0.6);
    g.gain.linearRampToValueAtTime(0, t + dur);
    if (lp) {
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = lp;
      o.connect(filt).connect(g);
    } else {
      o.connect(g);
    }
    g.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private kick(t: number): void {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    o.connect(g).connect(this.drums);
    o.start(t);
    o.stop(t + 0.18);
  }

  private snare(t: number): void {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    src.connect(f).connect(g).connect(this.drums);
    src.start(t);
    src.stop(t + 0.15);
  }

  private hat(t: number, dest: GainNode, vol: number): void {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    src.connect(f).connect(g).connect(dest);
    src.start(t);
    src.stop(t + 0.05);
  }
}
