import { fm, midiToHz, noise, tone, type Out } from './synth';

/**
 * Pitched instruments, from bone flute to synthesizer. Each era's music and
 * its interface jingles use the instruments of that era.
 */
export type Inst =
  | 'flute'
  | 'pluck'
  | 'shawm'
  | 'brass'
  | 'strings'
  | 'epiano'
  | 'synth'
  | 'bell'
  | 'drone'
  | 'pad'
  | 'bass'
  | 'subbass'
  | 'horn';

export type Drum = 'kick' | 'frame' | 'tom' | 'snare' | 'hat' | 'shaker' | 'clap' | 'timpani' | 'click';

export const INSTRUMENTS: Inst[] = ['flute', 'pluck', 'shawm', 'brass', 'strings', 'epiano', 'synth', 'bell', 'drone', 'pad', 'bass', 'subbass', 'horn'];
export const DRUMS: Drum[] = ['kick', 'frame', 'tom', 'snare', 'hat', 'shaker', 'clap', 'timpani', 'click'];

/** Plays one note; `dur` is the written length, tails may ring a little longer. */
export function playNote(o: Out, inst: Inst, midi: number, dur: number, vel: number): void {
  const f = midiToHz(midi);
  const v = vel;
  switch (inst) {
    case 'flute':
      tone(o, { f, dur: dur + 0.12, attack: 0.06, hold: Math.max(0, dur - 0.1), vol: 0.22 * v, vibrato: [5, 0.006] });
      tone(o, { f: f * 2, dur: dur + 0.08, attack: 0.08, hold: Math.max(0, dur - 0.12), vol: 0.03 * v });
      noise(o, { dur: Math.min(0.25, dur), attack: 0.03, vol: 0.035 * v, filter: { type: 'bandpass', f: f * 2, q: 3 } });
      break;
    case 'pluck':
      tone(o, { type: 'triangle', f, dur: Math.max(0.5, dur * 1.6), attack: 0.002, vol: 0.3 * v, filter: { type: 'lowpass', f: f * 6, f2: f * 1.2 } });
      tone(o, { f: f * 2, dur: 0.25, attack: 0.002, vol: 0.06 * v });
      break;
    case 'shawm':
      tone(o, { type: 'square', f, dur: dur + 0.08, attack: 0.025, hold: Math.max(0, dur - 0.08), vol: 0.1 * v, vibrato: [5.5, 0.005], filter: { type: 'lowpass', f: f * 3.5, q: 1.5 } });
      break;
    case 'brass':
      tone(o, { type: 'sawtooth', f, dur: dur + 0.1, attack: 0.04, hold: Math.max(0, dur - 0.1), vol: 0.12 * v, filter: { type: 'lowpass', f: f * 1.2, f2: f * 5, q: 1 } });
      tone(o, { type: 'sawtooth', f, detune: 8, dur: dur + 0.1, attack: 0.05, hold: Math.max(0, dur - 0.1), vol: 0.06 * v, filter: { type: 'lowpass', f: f * 3 } });
      break;
    case 'horn':
      tone(o, { type: 'sawtooth', f: f * 0.97, f2: f, glide: 0.12, dur: dur + 0.2, attack: 0.09, hold: Math.max(0, dur - 0.15), vol: 0.14 * v, filter: { type: 'lowpass', f: f * 2.2, q: 2 } });
      tone(o, { f: f / 2, dur: dur + 0.2, attack: 0.1, hold: Math.max(0, dur - 0.15), vol: 0.08 * v });
      break;
    case 'strings':
      for (const d of [-7, 7]) {
        tone(o, { type: 'sawtooth', f, detune: d, dur: dur + 0.35, attack: Math.min(0.25, dur * 0.4), hold: Math.max(0, dur - 0.3), vol: 0.05 * v, vibrato: [5, 0.004], filter: { type: 'lowpass', f: Math.min(4000, f * 4) } });
      }
      break;
    case 'epiano':
      fm(o, { f, ratio: 1, index: 1.4, index2: 0.1, dur: Math.max(0.6, dur * 1.3), attack: 0.004, vol: 0.2 * v });
      tone(o, { f: f * 4, dur: 0.12, vol: 0.02 * v });
      break;
    case 'synth':
      tone(o, { type: 'sawtooth', f, dur: dur + 0.06, attack: 0.008, hold: Math.max(0, dur - 0.08), vol: 0.07 * v, filter: { type: 'lowpass', f: f * 8, f2: f * 2, q: 6 } });
      tone(o, { type: 'square', f: f * 1.003, dur: dur + 0.06, attack: 0.008, hold: Math.max(0, dur - 0.08), vol: 0.04 * v, filter: { type: 'lowpass', f: f * 5 } });
      break;
    case 'bell':
      fm(o, { f, ratio: 3.5, index: 2.5, index2: 0.2, dur: Math.max(1.2, dur * 2), attack: 0.002, vol: 0.14 * v });
      break;
    case 'drone':
      tone(o, { type: 'sawtooth', f, dur: dur + 0.4, attack: 0.5, hold: Math.max(0, dur - 0.6), vol: 0.05 * v, filter: { type: 'lowpass', f: 420, q: 1 } });
      tone(o, { f: f * 1.5, dur: dur + 0.4, attack: 0.6, hold: Math.max(0, dur - 0.7), vol: 0.03 * v });
      break;
    case 'pad':
      for (const d of [-10, 0, 10]) {
        tone(o, { type: 'sawtooth', f, detune: d, dur: dur + 0.6, attack: Math.min(0.6, dur * 0.4), hold: Math.max(0, dur - 0.6), vol: 0.03 * v, filter: { type: 'lowpass', f: 900, q: 0.8 } });
      }
      break;
    case 'bass':
      tone(o, { type: 'triangle', f, dur: dur + 0.05, attack: 0.006, hold: Math.max(0, dur * 0.6), vol: 0.28 * v, filter: { type: 'lowpass', f: 700 } });
      break;
    case 'subbass':
      tone(o, { f, dur: dur + 0.05, attack: 0.01, hold: Math.max(0, dur * 0.7), vol: 0.3 * v });
      tone(o, { type: 'sawtooth', f, dur: dur * 0.6 + 0.05, attack: 0.01, vol: 0.05 * v, filter: { type: 'lowpass', f: f * 4, f2: f * 1.5, q: 3 } });
      break;
  }
}

export function playDrum(o: Out, drum: Drum, vel: number): void {
  const v = vel;
  switch (drum) {
    case 'kick':
      tone(o, { f: 130, f2: 45, glide: 0.12, dur: 0.35, attack: 0.002, vol: 0.55 * v });
      noise(o, { dur: 0.02, vol: 0.08 * v, filter: { type: 'lowpass', f: 3000 } });
      break;
    case 'frame':
      tone(o, { f: 170, f2: 95, glide: 0.18, dur: 0.32, attack: 0.002, vol: 0.32 * v });
      noise(o, { dur: 0.12, vol: 0.08 * v, filter: { type: 'lowpass', f: 900 } });
      break;
    case 'tom':
      tone(o, { f: 160, f2: 100, glide: 0.2, dur: 0.3, attack: 0.002, vol: 0.32 * v });
      break;
    case 'snare':
      noise(o, { dur: 0.16, vol: 0.2 * v, filter: { type: 'bandpass', f: 2200, q: 0.8 } });
      tone(o, { type: 'triangle', f: 210, f2: 160, dur: 0.09, attack: 0.002, vol: 0.14 * v });
      break;
    case 'hat':
      noise(o, { dur: 0.045, attack: 0.001, vol: 0.07 * v, filter: { type: 'highpass', f: 7500 } });
      break;
    case 'shaker':
      noise(o, { dur: 0.09, attack: 0.03, vol: 0.06 * v, filter: { type: 'highpass', f: 5000 } });
      break;
    case 'clap':
      for (const at of [0, 0.012, 0.024]) noise(o, { at, dur: 0.1, attack: 0.001, vol: 0.12 * v, filter: { type: 'bandpass', f: 1400, q: 1.2 } });
      break;
    case 'timpani':
      tone(o, { f: 92, f2: 88, dur: 0.9, attack: 0.004, vol: 0.4 * v });
      tone(o, { f: 92 * 1.5, dur: 0.4, attack: 0.004, vol: 0.08 * v });
      noise(o, { dur: 0.06, vol: 0.05 * v, filter: { type: 'lowpass', f: 600 } });
      break;
    case 'click':
      tone(o, { f: 1800, dur: 0.025, attack: 0.001, vol: 0.06 * v });
      break;
  }
}
