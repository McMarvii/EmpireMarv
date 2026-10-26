import type { EraStyle } from '../data/epochs';
import { playDrum, playNote } from './instruments';
import { composeBar, MUSIC, stepSeconds } from './music';
import { makeNoise, type Out } from './synth';

export interface AudioSettings {
  master: number;
  sfx: number;
  music: number;
  muted: boolean;
}

export const DEFAULT_AUDIO: AudioSettings = { master: 0.8, sfx: 0.8, music: 0.45, muted: false };
const STORAGE_KEY = 'empiremarv.audio';
/** Sound effects that may ring at the same time; more are dropped. */
const MAX_VOICES = 28;
/** Music is written this far ahead of the playhead. */
const LOOKAHEAD = 0.35;

function loadSettings(): AudioSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_AUDIO, ...JSON.parse(raw) };
  } catch {
    // Storage can be unavailable (private mode); defaults are fine.
  }
  return { ...DEFAULT_AUDIO };
}

export interface PlayOptions {
  gain?: number;
  /** Stereo position, -1 (left) to 1 (right). */
  pan?: number;
  /** Rough length in seconds, for the voice budget. */
  length?: number;
}

/**
 * Owns the AudioContext, the mixer (effects, interface, music → master →
 * compressor) and the music sequencer. Browsers only allow audio after a
 * user gesture, so nothing plays before `unlock()` ran inside one.
 */
export class AudioEngine {
  settings: AudioSettings = loadSettings();
  private ctx: AudioContext | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private uiBus!: GainNode;
  private musicBus!: GainNode;
  /** End times of the effects still ringing. */
  private voices: number[] = [];
  private paused = false;

  private musicStyle: EraStyle | null = null;
  /** Gain of the current piece; replaced (and faded out) when the style changes. */
  private piece: GainNode | null = null;
  private wantedStyle: EraStyle | null = null;
  private battle = false;
  private bar = 0;
  private nextBar = 0;
  private seed = 1;

  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      this.ctx = ctx;
      this.noiseBuf = makeNoise(ctx);
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.knee.value = 8;
      comp.ratio.value = 4;
      comp.attack.value = 0.004;
      comp.release.value = 0.25;
      comp.connect(ctx.destination);
      this.master = ctx.createGain();
      this.master.connect(comp);
      this.sfxBus = ctx.createGain();
      this.uiBus = ctx.createGain();
      this.musicBus = ctx.createGain();
      for (const bus of [this.sfxBus, this.uiBus, this.musicBus]) bus.connect(this.master);
      this.applyVolumes();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  get ready(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  setSettings(s: Partial<AudioSettings>): void {
    this.settings = { ...this.settings, ...s };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      // Ignore – remembering the mix is only a convenience.
    }
    this.applyVolumes();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const s = this.settings;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.muted ? 0 : s.master, t, 0.03);
    this.sfxBus.gain.setTargetAtTime(s.sfx, t, 0.03);
    this.uiBus.gain.setTargetAtTime(Math.min(1, s.sfx * 1.1), t, 0.03);
    this.musicBus.gain.setTargetAtTime(s.music * (this.paused ? 0.5 : 1), t, 0.2);
  }

  /**
   * Plays a recipe on the effects or interface bus. Returns false when the
   * sound was dropped because too many effects are already ringing.
   */
  play(bus: 'sfx' | 'ui', recipe: (o: Out) => void, opts: PlayOptions = {}): boolean {
    const ctx = this.ctx;
    if (!ctx || !this.ready || this.settings.muted) return false;
    const now = ctx.currentTime;
    this.voices = this.voices.filter((end) => end > now);
    if (bus === 'sfx' && this.voices.length >= MAX_VOICES) return false;
    this.voices.push(now + (opts.length ?? 0.5));
    const gain = ctx.createGain();
    gain.gain.value = opts.gain ?? 1;
    let dest: AudioNode = gain;
    if (opts.pan) {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, opts.pan));
      gain.connect(panner);
      panner.connect(bus === 'sfx' ? this.sfxBus : this.uiBus);
    } else {
      gain.connect(bus === 'sfx' ? this.sfxBus : this.uiBus);
    }
    recipe({ ctx, dest, t: now + 0.005, noise: this.noiseBuf! });
    return true;
  }

  // ------------------------------------------------------------------ music

  /** Chooses the music; style changes and battle mode take effect on the next bar. */
  setMusic(style: EraStyle | null, battle: boolean): void {
    if (style !== this.wantedStyle) this.seed = (Math.random() * 1e9) | 0;
    this.wantedStyle = style;
    this.battle = battle;
  }

  /** Briefly lowers the music, e.g. under a fanfare. */
  duck(seconds: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const base = this.settings.music * (this.paused ? 0.5 : 1);
    this.musicBus.gain.cancelScheduledValues(t);
    this.musicBus.gain.setTargetAtTime(base * 0.3, t, 0.05);
    this.musicBus.gain.setTargetAtTime(base, t + seconds, 0.5);
  }

  /** Writes the next bars of music; call every frame. */
  updateMusic(): void {
    const ctx = this.ctx;
    if (!ctx || !this.ready) return;
    const now = ctx.currentTime;
    if (this.nextBar < now) this.nextBar = now + 0.05;
    while (this.nextBar < now + LOOKAHEAD) {
      if (this.wantedStyle !== this.musicStyle) {
        this.musicStyle = this.wantedStyle;
        this.bar = 0;
        // Long drones of the old piece fade out instead of ringing on.
        this.piece?.gain.setTargetAtTime(0, now, 0.4);
        this.piece = ctx.createGain();
        this.piece.connect(this.musicBus);
      }
      const styleId = this.musicStyle;
      if (!styleId || this.settings.muted || this.settings.music <= 0) {
        // Silence still advances the clock, so music resumes on a bar line.
        this.nextBar += 1;
        continue;
      }
      const style = MUSIC[styleId];
      const sd = stepSeconds(style);
      this.piece!.gain.setTargetAtTime(this.battle ? style.gain.battle : style.gain.calm, this.nextBar, 0.15);
      const bar = composeBar(styleId, this.bar, this.seed, this.battle);
      const dest = this.piece!;
      const out = (step: number): Out => ({ ctx, dest, t: this.nextBar + step * sd, noise: this.noiseBuf! });
      for (const n of bar.notes) playNote(out(n.step), n.inst, n.midi, n.len * sd, n.vel);
      for (const d of bar.drums) playDrum(out(d.step), d.drum, d.vel);
      this.nextBar += style.steps * sd;
      this.bar++;
    }
  }

  /** Fades the music out right away (game over, back to the menu). */
  stopMusic(): void {
    this.setMusic(null, false);
    this.musicStyle = null;
    if (this.ctx && this.piece) this.piece.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4);
    this.piece = null;
  }
}

/** One engine for the whole page, so the mix and the unlocked context survive new games. */
export const audio = new AudioEngine();
