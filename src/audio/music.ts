import type { EraStyle } from '../data/epochs';
import { Rng } from '../sim/rng';
import type { Drum, Inst } from './instruments';

/**
 * Generative music: every era family has its own scale, tempo, instruments
 * and grooves, and a small composer writes bar after bar from them. Motifs
 * repeat in an A B A C pattern so the music sounds like tunes, not like
 * random notes. Pure functions only – the audio engine plays the result.
 *
 * Pattern strings have one character per step:
 *  - lead rhythms: `x` new note, `-` hold, `.` rest
 *  - bass: `r` chord root, `f` fifth, `o` octave, `-` hold, `.` rest
 *  - arpeggio: `0`–`3` chord tone (3 = octave), `.` rest
 *  - drums: `x` hit, `o` soft hit, `.` nothing
 */
export interface MusicStyle {
  name: string;
  /** Beats per minute; a beat is `beat` steps long. */
  bpm: number;
  steps: number;
  beat: number;
  /** MIDI note of the tonic in the bass register. */
  root: number;
  /** Scale as semitones over the tonic. */
  scale: number[];
  /** Chord root per bar as scale degree. */
  progression: number[];
  lead: Inst;
  rhythms: string[];
  bass: Inst;
  bassLine: { calm: string; battle: string };
  /** Sustained harmony: a pad chord per bar, or a drone on tonic and fifth. */
  harmony: Inst;
  drone: boolean;
  /** Optional second voice playing broken chords. */
  arp?: { inst: Inst; calm: string; battle: string };
  drums: { calm: Partial<Record<Drum, string>>; battle: Partial<Record<Drum, string>> };
  /** Level trim, measured so all eras sound equally loud (battle a little louder). */
  gain: { calm: number; battle: number };
}

export const MUSIC: Record<EraStyle, MusicStyle> = {
  stone: {
    name: 'Knochenflöte über Bordun, Rahmentrommel',
    bpm: 80,
    steps: 16,
    beat: 4,
    root: 50,
    scale: [0, 3, 5, 7, 10],
    progression: [0, 0, 3, 0, 0, 3, 2, 0],
    lead: 'flute',
    rhythms: ['x---x-x-x-------', 'x-x-x---x-------', 'x-----x-x---x---', 'x---x---x-x-x---'],
    bass: 'bass',
    bassLine: { calm: 'r...............', battle: 'r.....r.r.....r.' },
    harmony: 'drone',
    drone: true,
    drums: {
      calm: { frame: 'x.......o.......', shaker: '....o.......o...' },
      battle: { frame: 'x..o..x.x..o..x.', tom: '....x.......x..o', shaker: 'o.o.o.o.o.o.o.o.' },
    },
    gain: { calm: 1.5, battle: 0.71 },
  },
  ancient: {
    name: 'Leier und Harfe im Hijaz-Modus',
    bpm: 88,
    steps: 16,
    beat: 4,
    root: 52,
    scale: [0, 1, 4, 5, 7, 8, 10],
    progression: [0, 0, 6, 0, 3, 3, 1, 0],
    lead: 'pluck',
    rhythms: ['x-x-x---x-x-x---', 'x---x-xxx-------', 'x-x-x-x-x---x---', 'x-----x-x-x-x---'],
    bass: 'bass',
    bassLine: { calm: 'r.......f.......', battle: 'r.r...r.f.f...f.' },
    harmony: 'drone',
    drone: true,
    arp: { inst: 'pluck', calm: '0...1...2...1...', battle: '0.1.2.1.0.1.2.3.' },
    drums: {
      calm: { frame: 'x.....o.......o.' },
      battle: { frame: 'x..ox.o.x..ox.o.', tom: 'x.......x...x...', clap: '....x.......x...' },
    },
    gain: { calm: 1.23, battle: 0.89 },
  },
  medieval: {
    name: 'Schalmei im Dorischen, Bordun, Tabor im 6/8-Takt',
    bpm: 64,
    steps: 12,
    beat: 6,
    root: 50,
    scale: [0, 2, 3, 5, 7, 9, 10],
    progression: [0, 0, 6, 0, 3, 3, 4, 0],
    lead: 'shawm',
    rhythms: ['x-xx-xx-xx--', 'x--x-xx-----', 'x-xx-xx-xx-x', 'x-----x-x-x-'],
    bass: 'bass',
    bassLine: { calm: 'r-----f-----', battle: 'r..r..f..f..' },
    harmony: 'drone',
    drone: true,
    drums: {
      calm: { frame: 'x.....o.....', shaker: '...o.....o..' },
      battle: { frame: 'x.ox.ox.ox.o', tom: 'x.....x.....', snare: '...o.....o..' },
    },
    gain: { calm: 0.59, battle: 0.94 },
  },
  imperial: {
    name: 'Blechbläser und Streicher in Dur, Marschtrommel',
    bpm: 104,
    steps: 16,
    beat: 4,
    root: 48,
    scale: [0, 2, 4, 5, 7, 9, 11],
    progression: [0, 4, 5, 3, 0, 3, 4, 0],
    lead: 'brass',
    rhythms: ['x---x-x-x---x---', 'x--xx---x-------', 'x-x-x-x-x---x---', 'x-----x-x-x-x---'],
    bass: 'bass',
    bassLine: { calm: 'r...f...r...f...', battle: 'r.r.f.f.r.r.f.f.' },
    harmony: 'strings',
    drone: false,
    drums: {
      calm: { snare: '....o.......o...', timpani: 'x...............' },
      battle: { snare: 'x.ooo.x.x.ooo.x.', timpani: 'x.......x.......', kick: 'x...x...x...x...' },
    },
    gain: { calm: 0.88, battle: 0.82 },
  },
  modern: {
    name: 'E-Piano, Flächen und Schlagzeug in Moll',
    bpm: 92,
    steps: 16,
    beat: 4,
    root: 45,
    scale: [0, 2, 3, 5, 7, 8, 10],
    progression: [0, 5, 2, 6, 0, 5, 3, 4],
    lead: 'epiano',
    rhythms: ['x---x-x---x-----', 'x-x---x-x-------', '..x-x-x-x---x---', 'x-----x---x-x---'],
    bass: 'subbass',
    bassLine: { calm: 'r-------r---f---', battle: 'r.rr..r.r.rr..f.' },
    harmony: 'pad',
    drone: false,
    drums: {
      calm: { kick: 'x.......x.......', hat: '..o...o...o...o.' },
      battle: { kick: 'x..x..x.x..x..x.', snare: '....x.......x...', hat: 'xoxoxoxoxoxoxoxo' },
    },
    gain: { calm: 0.43, battle: 0.69 },
  },
  future: {
    name: 'Synthesizer-Arpeggios, Flächen und Sub-Bass',
    bpm: 116,
    steps: 16,
    beat: 4,
    root: 47,
    scale: [0, 2, 3, 5, 7, 8, 10],
    progression: [0, 0, 5, 5, 3, 3, 4, 4],
    lead: 'synth',
    rhythms: ['x---x---x-x-x---', 'x-------x-x-----', 'x-x-x---x-------', '..x-x-x-x-x-x---'],
    bass: 'subbass',
    bassLine: { calm: 'r-------r-------', battle: 'r.r.r.r.r.r.f.f.' },
    harmony: 'pad',
    drone: false,
    arp: { inst: 'synth', calm: '0.1.2.1.0.1.2.3.', battle: '0123012301230123' },
    drums: {
      calm: { kick: 'x.......x.......', hat: '..o...o...o...o.' },
      battle: { kick: 'x...x...x...x...', clap: '....x.......x...', hat: 'o.x.o.x.o.x.o.x.' },
    },
    gain: { calm: 0.43, battle: 0.67 },
  },
};

const STYLE_IDS = Object.keys(MUSIC) as EraStyle[];

export interface NoteEvent {
  step: number;
  len: number;
  inst: Inst;
  midi: number;
  vel: number;
}

export interface DrumEvent {
  step: number;
  drum: Drum;
  vel: number;
}

export interface Bar {
  notes: NoteEvent[];
  drums: DrumEvent[];
}

export function stepSeconds(style: MusicStyle): number {
  return 60 / style.bpm / style.beat;
}

/** Scale degree (any integer, octaves wrap) to a MIDI note. */
export function degreeToMidi(style: MusicStyle, degree: number, octave = 0): number {
  const n = style.scale.length;
  const oct = Math.floor(degree / n);
  const idx = degree - oct * n;
  return style.root + style.scale[idx] + 12 * (oct + octave);
}

function hash(...parts: number[]): number {
  let h = 0x811c9dc5;
  for (const p of parts) {
    h ^= p | 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** Bars per section; a section is two phrases of four bars. */
export const SECTION_BARS = 8;
/** Which motif each bar of a section plays: A B A C, A B A D (cadence). */
const MOTIF_OF_BAR = [0, 1, 0, 2, 0, 1, 0, 3];

interface Motif {
  rhythm: string;
  /** Pitch per onset, in scale degrees over the chord root. */
  degrees: number[];
}

function makeMotif(style: MusicStyle, rng: Rng, cadence: boolean): Motif {
  const rhythm = rng.pick(style.rhythms);
  const onsets = [...rhythm].filter((c) => c === 'x').length;
  const degrees: number[] = [];
  let d = rng.pick([0, 2, 4]);
  for (let i = 0; i < onsets; i++) {
    if (i > 0) d += rng.pick([-2, -1, -1, 0, 1, 1, 2]);
    d = Math.max(-2, Math.min(7, d));
    degrees.push(d);
  }
  if (cadence) degrees[degrees.length - 1] = 0;
  return { rhythm, degrees };
}

/** Snaps a degree over the chord root to the nearest chord tone (root, third, fifth, octave). */
function toChordTone(d: number, n: number): number {
  const oct = Math.floor(d / n);
  const r = d - oct * n;
  const tones = [0, 2, 4, n];
  let best = 0;
  for (const t of tones) if (Math.abs(t - r) < Math.abs(best - r)) best = t;
  return oct * n + best;
}

/**
 * Writes one bar. The same style, bar number and seed always give the same
 * bar, so the music is reproducible and testable. `battle` switches to the
 * driving bass line and drum patterns.
 */
export function composeBar(styleId: EraStyle, bar: number, seed: number, battle: boolean): Bar {
  const style = MUSIC[styleId];
  const notes: NoteEvent[] = [];
  const drums: DrumEvent[] = [];
  const inBar = bar % SECTION_BARS;
  const section = Math.floor(bar / SECTION_BARS);
  const chord = style.progression[bar % style.progression.length];
  const n = style.scale.length;

  // Harmony: pad chord every bar, or a drone that is renewed every four bars.
  if (style.drone) {
    if (bar % 4 === 0) {
      const len = style.steps * 4;
      notes.push({ step: 0, len, inst: style.harmony, midi: style.root - 12, vel: 0.8 });
      notes.push({ step: 0, len, inst: style.harmony, midi: degreeToMidi(style, n > 5 ? 4 : 3, -1), vel: 0.6 });
    }
  } else {
    for (const t of [0, 2, 4]) notes.push({ step: 0, len: style.steps, inst: style.harmony, midi: degreeToMidi(style, chord + t), vel: 0.7 });
  }

  // Bass line.
  const line = battle ? style.bassLine.battle : style.bassLine.calm;
  for (let s = 0; s < line.length; s++) {
    const c = line[s];
    if (c === '.' || c === '-') continue;
    let len = 1;
    while (s + len < line.length && line[s + len] === '-') len++;
    const deg = chord + (c === 'f' ? (n > 5 ? 4 : 3) : 0);
    notes.push({ step: s, len, inst: style.bass, midi: degreeToMidi(style, deg, c === 'o' ? 0 : -1), vel: 0.8 });
  }

  // Broken chords.
  if (style.arp) {
    const pat = battle ? style.arp.battle : style.arp.calm;
    for (let s = 0; s < pat.length; s++) {
      const c = pat[s];
      if (c === '.') continue;
      const tone = [0, 2, 4, n][Number(c)];
      notes.push({ step: s, len: 1, inst: style.arp.inst, midi: degreeToMidi(style, chord + tone, 1), vel: 0.35 });
    }
  }

  // Lead: two themes alternate between sections; every fourth calm section rests.
  const theme = Math.floor(section / 2) % 2;
  const resting = !battle && hash(seed, section, 7) % 4 === 3;
  if (!resting) {
    const motifId = MOTIF_OF_BAR[inBar];
    const motif = makeMotif(style, new Rng(hash(seed, theme, motifId, STYLE_IDS.indexOf(styleId))), motifId === 3);
    let k = 0;
    for (let s = 0; s < motif.rhythm.length; s++) {
      if (motif.rhythm[s] !== 'x') continue;
      let len = 1;
      while (s + len < motif.rhythm.length && motif.rhythm[s + len] === '-') len++;
      let deg = motif.degrees[k++];
      // Strong beats land on chord tones, so the tune fits the harmony.
      if (s % style.beat === 0) deg = toChordTone(deg, n);
      const accent = s === 0 ? 1 : s % style.beat === 0 ? 0.85 : 0.7;
      notes.push({ step: s, len, inst: style.lead, midi: degreeToMidi(style, chord + deg, 1), vel: 0.75 * accent });
    }
  }

  // Drums.
  const kit = battle ? style.drums.battle : style.drums.calm;
  for (const [drum, pat] of Object.entries(kit) as Array<[Drum, string]>) {
    for (let s = 0; s < pat.length; s++) {
      if (pat[s] === 'x') drums.push({ step: s, drum, vel: 0.8 });
      else if (pat[s] === 'o') drums.push({ step: s, drum, vel: 0.45 });
    }
  }
  return { notes, drums };
}
