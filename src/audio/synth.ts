/**
 * Synthesis building blocks. Every sound in the game is assembled from these
 * at play time – oscillators, filtered noise and simple FM – so the game ships
 * without a single audio file, just like it ships without image files.
 * Everything works on a BaseAudioContext, so sounds render offline too.
 */

/** Where and when a sound plays. */
export interface Out {
  ctx: BaseAudioContext;
  dest: AudioNode;
  /** Start time in context seconds. */
  t: number;
  noise: AudioBuffer;
}

export interface Env {
  /** Offset from `Out.t` in seconds. */
  at?: number;
  attack?: number;
  /** Time at full level before the decay starts. */
  hold?: number;
  /** Total length including attack, hold and decay. */
  dur: number;
  vol: number;
}

export interface Filter {
  type: BiquadFilterType;
  f: number;
  /** Cutoff at the end of the sound (exponential sweep). */
  f2?: number;
  q?: number;
}

const SILENT = 0.0001;

/** One second of white noise from a fixed LCG, so renders are reproducible. */
export function makeNoise(ctx: BaseAudioContext): AudioBuffer {
  const len = ctx.sampleRate;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let s = 0x2f6b1d3;
  for (let i = 0; i < len; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    data[i] = s / 2147483648 - 1;
  }
  return buf;
}

/** Percussive or sustained gain envelope; returns the end time. */
function envelope(g: AudioParam, t0: number, p: Env): number {
  const attack = Math.max(0.001, p.attack ?? 0.004);
  const hold = p.hold ?? 0;
  const vol = Math.max(SILENT * 2, p.vol);
  const end = t0 + Math.max(p.dur, attack + hold + 0.01);
  g.setValueAtTime(SILENT, t0);
  g.linearRampToValueAtTime(vol, t0 + attack);
  if (hold > 0) g.setValueAtTime(vol, t0 + attack + hold);
  g.exponentialRampToValueAtTime(SILENT, end);
  return end;
}

function filterNode(o: Out, f: Filter, t0: number, end: number): BiquadFilterNode {
  const node = o.ctx.createBiquadFilter();
  node.type = f.type;
  node.Q.value = f.q ?? 0.7;
  node.frequency.setValueAtTime(f.f, t0);
  if (f.f2 !== undefined) node.frequency.exponentialRampToValueAtTime(Math.max(20, f.f2), end);
  return node;
}

export interface ToneParams extends Env {
  type?: OscillatorType;
  f: number;
  /** Pitch at the end of `glide` seconds (exponential). */
  f2?: number;
  glide?: number;
  detune?: number;
  /** [rate in Hz, depth as a fraction of the pitch]. */
  vibrato?: [number, number];
  filter?: Filter;
}

/** An oscillator with optional pitch glide, vibrato and filter. */
export function tone(o: Out, p: ToneParams): void {
  const { ctx } = o;
  const t0 = o.t + (p.at ?? 0);
  const osc = ctx.createOscillator();
  osc.type = p.type ?? 'sine';
  osc.frequency.setValueAtTime(p.f, t0);
  if (p.f2 !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, p.f2), t0 + (p.glide ?? p.dur));
  if (p.detune) osc.detune.value = p.detune;
  const gain = ctx.createGain();
  const end = envelope(gain.gain, t0, p);
  if (p.vibrato) {
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.value = p.vibrato[0];
    depth.gain.value = p.f * p.vibrato[1];
    lfo.connect(depth).connect(osc.frequency);
    lfo.start(t0);
    lfo.stop(end + 0.02);
  }
  if (p.filter) osc.connect(filterNode(o, p.filter, t0, end)).connect(gain);
  else osc.connect(gain);
  gain.connect(o.dest);
  osc.start(t0);
  osc.stop(end + 0.02);
}

export interface NoiseParams extends Env {
  filter: Filter;
  /** Playback rate of the noise buffer; lower sounds darker and grainier. */
  rate?: number;
}

/** A burst of filtered noise: hits, breath, wind, explosions. */
export function noise(o: Out, p: NoiseParams): void {
  const { ctx } = o;
  const t0 = o.t + (p.at ?? 0);
  const src = ctx.createBufferSource();
  src.buffer = o.noise;
  src.loop = true;
  src.playbackRate.value = p.rate ?? 1;
  const gain = ctx.createGain();
  const end = envelope(gain.gain, t0, p);
  src.connect(filterNode(o, p.filter, t0, end)).connect(gain).connect(o.dest);
  // Random-looking but reproducible start inside the buffer.
  src.start(t0, (t0 * 7.31) % 0.9);
  src.stop(end + 0.02);
}

export interface FmParams extends Env {
  f: number;
  /** Modulator frequency as a multiple of `f`; non-integers sound metallic. */
  ratio: number;
  /** Modulation depth as a multiple of the modulator frequency. */
  index: number;
  /** Modulation depth at the end; lower values make the tone mellow out. */
  index2?: number;
  type?: OscillatorType;
}

/** Two-operator FM: bells, clangs, electric piano. */
export function fm(o: Out, p: FmParams): void {
  const { ctx } = o;
  const t0 = o.t + (p.at ?? 0);
  const car = ctx.createOscillator();
  const mod = ctx.createOscillator();
  const depth = ctx.createGain();
  car.type = p.type ?? 'sine';
  car.frequency.value = p.f;
  const mf = p.f * p.ratio;
  mod.frequency.value = mf;
  const gain = ctx.createGain();
  const end = envelope(gain.gain, t0, p);
  depth.gain.setValueAtTime(mf * p.index, t0);
  depth.gain.exponentialRampToValueAtTime(Math.max(1, mf * (p.index2 ?? p.index * 0.2)), end);
  mod.connect(depth).connect(car.frequency);
  car.connect(gain).connect(o.dest);
  mod.start(t0);
  car.start(t0);
  mod.stop(end + 0.02);
  car.stop(end + 0.02);
}

/** Same output, shifted in time and with its own volume. */
export function sub(o: Out, at: number, vol = 1): Out {
  if (vol === 1) return { ...o, t: o.t + at };
  const g = o.ctx.createGain();
  g.gain.value = vol;
  g.connect(o.dest);
  return { ...o, t: o.t + at, dest: g };
}

export function midiToHz(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}
