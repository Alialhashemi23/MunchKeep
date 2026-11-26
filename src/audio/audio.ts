import { Music } from './music';
import { SFX, render } from './synth';

/**
 * Owns the AudioContext. Browsers only allow sound after a user gesture, so nothing
 * is created until unlock() runs from a click or key press.
 */
export class Audio {
  private ctx: AudioContext | null = null;
  private sfxGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private lastPlayed = new Map<string, number>();
  private music: Music | null = null;
  private sfxVol = 0.7;
  private musicVol = 0.5;

  get ready(): boolean {
    return this.ctx !== null;
  }

  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
      this.ctx = new Ctor();
    } catch {
      return;
    }
    const master = this.ctx.createGain();
    master.gain.value = 0.8;
    const comp = this.ctx.createDynamicsCompressor();
    master.connect(comp).connect(this.ctx.destination);
    this.sfxGain = this.ctx.createGain();
    this.sfxGain.connect(master);
    this.musicGain = this.ctx.createGain();
    this.musicGain.connect(master);
    this.applyVolumes();
    for (const [name, layers] of Object.entries(SFX)) {
      const data = render(layers, this.ctx.sampleRate);
      const buf = this.ctx.createBuffer(1, data.length, this.ctx.sampleRate);
      buf.getChannelData(0).set(data);
      this.buffers.set(name, buf);
    }
    this.music = new Music(this.ctx, this.musicGain);
    this.music.start();
  }

  setVolumes(sfx: number, music: number): void {
    this.sfxVol = sfx;
    this.musicVol = music;
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx || !this.sfxGain || !this.musicGain) return;
    const t = this.ctx.currentTime;
    this.sfxGain.gain.setTargetAtTime(this.sfxVol, t, 0.05);
    this.musicGain.gain.setTargetAtTime(this.musicVol * 0.6, t, 0.05);
  }

  /** Play a sound. Repeats of the same sound closer than `gap` seconds are dropped. */
  play(name: string, opts: { vol?: number; pitch?: number; gap?: number } = {}): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxGain || ctx.state !== 'running') return;
    const buf = this.buffers.get(name);
    if (!buf) return;
    const now = ctx.currentTime;
    const gap = opts.gap ?? 0.045;
    if (now - (this.lastPlayed.get(name) ?? -1) < gap) return;
    this.lastPlayed.set(name, now);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = (opts.pitch ?? 1) * (0.95 + Math.random() * 0.1);
    const g = ctx.createGain();
    g.gain.value = opts.vol ?? 1;
    src.connect(g).connect(this.sfxGain);
    src.start();
  }

  setIntensity(level: number): void {
    this.music?.setIntensity(level);
  }

  suspend(): void {
    void this.ctx?.suspend();
  }

  resume(): void {
    if (this.ctx?.state === 'suspended') void this.ctx.resume();
  }
}
