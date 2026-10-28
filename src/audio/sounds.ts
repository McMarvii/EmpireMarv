import type { AbilityId } from '../data/abilities';
import { EPOCHS, type EraStyle } from '../data/epochs';
import type { Res } from '../data/resources';
import type { Look, Projectile } from '../data/units';
import { playDrum, playNote, type Inst } from './instruments';
import { fm, noise, sub, tone, type Out } from './synth';

/**
 * Sound recipes. Each one takes an output and a few game facts (weapon,
 * unit look, era) and schedules its oscillators and noise bursts. `r` is a
 * random number in [0, 1) that adds a little variation between repeats.
 */

/** Lead instrument and fanfare instrument of an era family. */
export const ERA_INST: Record<EraStyle, { lead: Inst; fanfare: Inst }> = {
  stone: { lead: 'flute', fanfare: 'horn' },
  ancient: { lead: 'pluck', fanfare: 'horn' },
  medieval: { lead: 'shawm', fanfare: 'brass' },
  imperial: { lead: 'brass', fanfare: 'brass' },
  modern: { lead: 'epiano', fanfare: 'brass' },
  future: { lead: 'synth', fanfare: 'synth' },
};

const WOOD_SIEGE = new Set<Look>(['ram', 'catapult', 'trebuchet']);
const MACHINES = new Set<Look>(['tank', 'mech', 'armoredcar', 'jeep', 'cannon', 'rocket', 'beam']);

function vary(r: number, amount = 0.12): number {
  return 1 + (r - 0.5) * amount;
}

// ------------------------------------------------------------------ combat

export function shotSound(o: Out, projectile: Projectile, look: Look | undefined, epoch: number, r: number): void {
  const k = vary(r);
  switch (projectile) {
    case 'stone':
      noise(o, { dur: 0.16, attack: 0.04, vol: 0.4, filter: { type: 'bandpass', f: 900 * k, f2: 2200, q: 2 } });
      tone(o, { f: 300 * k, f2: 150, dur: 0.05, vol: 0.12 });
      break;
    case 'arrow':
      tone(o, { type: 'triangle', f: 165 * k, f2: 150 * k, dur: 0.22, attack: 0.001, vol: 0.3, filter: { type: 'lowpass', f: 1400 } });
      noise(o, { at: 0.02, dur: 0.15, attack: 0.03, vol: 0.07, filter: { type: 'bandpass', f: 3000, f2: 1600, q: 1.5 } });
      break;
    case 'bullet':
      if (epoch < 12) {
        // Black powder: a dull boom with a cloud of noise.
        noise(o, { dur: 0.4, attack: 0.002, vol: 0.42, rate: 0.7, filter: { type: 'lowpass', f: 2600 * k, f2: 300 } });
        tone(o, { f: 95 * k, f2: 40, dur: 0.25, attack: 0.002, vol: 0.35 });
      } else {
        // Smokeless powder: a sharp crack, automatic weapons fire bursts.
        const burst = look === 'armoredcar' || (look === 'trooper' && epoch >= 14) ? 3 : 1;
        for (let i = 0; i < burst; i++) {
          const s = sub(o, i * 0.075, burst > 1 ? 0.7 : 1);
          noise(s, { dur: 0.07, attack: 0.001, vol: 0.4, filter: { type: 'highpass', f: 1300 * k } });
          noise(s, { at: 0.008, dur: 0.22, attack: 0.002, vol: 0.22, filter: { type: 'lowpass', f: 1600, f2: 250 } });
          tone(s, { f: 150 * k, f2: 60, dur: 0.1, attack: 0.001, vol: 0.22 });
        }
      }
      break;
    case 'shell':
      if (look === 'rocket' || look === 'rocketeer') {
        noise(o, { dur: 0.12, attack: 0.002, vol: 0.55, filter: { type: 'lowpass', f: 1200 } });
        noise(o, { dur: 0.75, attack: 0.06, vol: 0.5, filter: { type: 'bandpass', f: 500 * k, f2: 2600, q: 1.2 } });
      } else {
        noise(o, { dur: 0.05, attack: 0.001, vol: 0.2, filter: { type: 'highpass', f: 2500 } });
        noise(o, { dur: 0.95, attack: 0.003, vol: 0.5, rate: 0.6, filter: { type: 'lowpass', f: 1800 * k, f2: 140 } });
        tone(o, { f: 78 * k, f2: 32, dur: 0.6, attack: 0.002, vol: 0.5 });
      }
      break;
    case 'boulder':
      tone(o, { type: 'sawtooth', f: 115 * k, f2: 80, dur: 0.22, attack: 0.02, vol: 0.09, filter: { type: 'bandpass', f: 700, q: 6 } });
      tone(o, { at: 0.12, f: 95, f2: 45, dur: 0.28, attack: 0.002, vol: 0.35 });
      noise(o, { at: 0.12, dur: 0.16, vol: 0.14, filter: { type: 'lowpass', f: 500 } });
      break;
    case 'laser': {
      const heavy = look === 'beam' || look === 'mech';
      const f = (heavy ? 1300 : 2300) * k;
      tone(o, { type: 'sawtooth', f, f2: heavy ? 120 : 300, dur: heavy ? 0.4 : 0.18, attack: 0.002, vol: 0.22, filter: { type: 'bandpass', f: 1500, q: 1 } });
      tone(o, { f: f / 2, f2: heavy ? 60 : 250, dur: heavy ? 0.4 : 0.16, attack: 0.002, vol: 0.24 });
      break;
    }
    case 'none':
      break;
  }
}

export function meleeSound(o: Out, look: Look | undefined, epoch: number, r: number): void {
  const k = vary(r, 0.2);
  if (look === 'ram') {
    tone(o, { f: 70 * k, f2: 40, dur: 0.4, attack: 0.002, vol: 0.5 });
    noise(o, { dur: 0.3, vol: 0.3, rate: 0.5, filter: { type: 'lowpass', f: 700, f2: 200 } });
    return;
  }
  if (look === 'club' || epoch < 3) {
    // Wood and stone: a dull knock.
    tone(o, { f: 140 * k, f2: 70, dur: 0.12, attack: 0.001, vol: 0.3 });
    noise(o, { dur: 0.07, vol: 0.18, filter: { type: 'bandpass', f: 800 * k, q: 1.5 } });
    return;
  }
  // Bronze and steel: a short metallic clang.
  fm(o, { f: 820 * k, ratio: 2.76, index: 2.2, index2: 0.3, dur: 0.35, attack: 0.001, vol: 0.16 });
  noise(o, { dur: 0.05, vol: 0.22, filter: { type: 'highpass', f: 2500 } });
}

export function impactSound(o: Out, projectile: Projectile, building: boolean, r: number): void {
  const k = vary(r, 0.25);
  switch (projectile) {
    case 'laser':
      noise(o, { dur: 0.12, vol: 0.07, filter: { type: 'highpass', f: 4000 } });
      break;
    case 'bullet':
      if (building && r < 0.35) tone(o, { f: 2700 * k, f2: 1700, dur: 0.14, attack: 0.002, vol: 0.04 });
      noise(o, { dur: 0.05, vol: building ? 0.14 : 0.12, filter: { type: 'bandpass', f: building ? 900 : 500, q: 1.5 } });
      break;
    default:
      if (building) {
        noise(o, { dur: 0.08, vol: 0.14, filter: { type: 'bandpass', f: 520 * k, q: 2 } });
        tone(o, { f: 230 * k, f2: 140, dur: 0.07, vol: 0.09 });
      } else {
        noise(o, { dur: 0.05, vol: 0.15, filter: { type: 'bandpass', f: 1200 * k, q: 1.2 } });
      }
  }
}

export function blastSound(o: Out, projectile: Projectile, size: number, r: number): void {
  const k = vary(r, 0.2);
  const big = Math.min(2, 0.6 + size * 0.5);
  if (projectile === 'laser') {
    tone(o, { type: 'sawtooth', f: 900 * k, f2: 70, dur: 0.5, attack: 0.002, vol: 0.13, filter: { type: 'lowpass', f: 2200 } });
    noise(o, { dur: 0.5 * big, vol: 0.32, filter: { type: 'lowpass', f: 3000, f2: 200 } });
    return;
  }
  if (projectile === 'boulder') {
    noise(o, { dur: 0.45, vol: 0.42, rate: 0.5, filter: { type: 'lowpass', f: 900 * k, f2: 180 } });
    tone(o, { f: 85 * k, f2: 40, dur: 0.3, attack: 0.002, vol: 0.42 });
    for (let i = 0; i < 3; i++) noise(o, { at: 0.06 + i * 0.07 * k, dur: 0.05, vol: 0.08, filter: { type: 'bandpass', f: 1400 + i * 500, q: 2 } });
    return;
  }
  noise(o, { dur: 0.9 * big, attack: 0.003, vol: 0.55, rate: 0.6, filter: { type: 'lowpass', f: 2000 * k, f2: 110 } });
  tone(o, { f: 62 * k, f2: 28, dur: 0.7 * big, attack: 0.003, vol: 0.5 });
  noise(o, { at: 0.12, dur: 0.4, vol: 0.09, filter: { type: 'bandpass', f: 900, q: 1 } });
}

export function deathSound(o: Out, look: Look | undefined, r: number): void {
  const k = vary(r, 0.3);
  if (look === 'drone') {
    tone(o, { type: 'square', f: 800 * k, f2: 60, dur: 0.5, attack: 0.002, vol: 0.06, filter: { type: 'lowpass', f: 2000 } });
    noise(o, { dur: 0.3, vol: 0.07, filter: { type: 'highpass', f: 3000 } });
    return;
  }
  if (look && WOOD_SIEGE.has(look)) {
    noise(o, { dur: 0.55, vol: 0.32, rate: 0.6, filter: { type: 'bandpass', f: 700 * k, f2: 280, q: 1.2 } });
    for (let i = 0; i < 4; i++) tone(o, { at: i * 0.09 * k, f: 180 - i * 20, f2: 90, dur: 0.08, vol: 0.18 });
    return;
  }
  if (look && MACHINES.has(look)) {
    noise(o, { dur: 0.65, vol: 0.32, filter: { type: 'bandpass', f: 1400 * k, q: 0.8 } });
    fm(o, { f: 290 * k, ratio: 2.41, index: 3, index2: 0.4, dur: 0.8, attack: 0.002, vol: 0.1 });
    tone(o, { f: 72, f2: 34, dur: 0.5, attack: 0.002, vol: 0.35 });
    return;
  }
  // Living units: a short groan through two vowel formants, then the fall.
  const f = (150 + r * 70) * (look === 'citizen' ? 1.25 : 1);
  tone(o, { type: 'sawtooth', f, f2: f * 0.62, glide: 0.26, dur: 0.28, attack: 0.012, vol: 0.32, filter: { type: 'bandpass', f: 720 * k, q: 3 } });
  tone(o, { type: 'sawtooth', f, f2: f * 0.62, glide: 0.26, dur: 0.26, attack: 0.012, vol: 0.12, filter: { type: 'bandpass', f: 1150 * k, q: 4 } });
  noise(o, { at: 0.2, dur: 0.15, vol: 0.2, filter: { type: 'lowpass', f: 420 } });
}

export function collapseSound(o: Out, size: number, r: number): void {
  const len = 1.1 + size * 0.25;
  noise(o, { dur: len, attack: 0.05, vol: 0.5, rate: 0.5, filter: { type: 'lowpass', f: 420, f2: 60 } });
  tone(o, { f: 52, f2: 30, dur: len * 0.8, attack: 0.02, vol: 0.32 });
  for (let i = 0; i < 6; i++) {
    const at = 0.08 + ((i * 0.173 + r) % 1) * len * 0.7;
    noise(o, { at, dur: 0.07, vol: 0.09, filter: { type: 'bandpass', f: 900 + i * 280, q: 2 } });
  }
}

// ------------------------------------------------------------ heroes, faith

/** Hero abilities: a call to arms, a war cry, the whirl of a blade … */
export function abilitySound(o: Out, ability: AbilityId, style: EraStyle, r: number): void {
  const k = vary(r, 0.06);
  const { lead, fanfare } = ERA_INST[style];
  switch (ability) {
    case 'rally':
      // Rising call on the era's fanfare instrument.
      [60, 64, 67, 72].forEach((m, i) => playNote(sub(o, i * 0.09), fanfare, m, 0.16, 0.55));
      break;
    case 'shieldwall':
      playDrum(o, 'timpani', 0.8);
      playNote(o, fanfare, 55, 0.5, 0.5);
      playNote(o, fanfare, 62, 0.5, 0.4);
      noise(o, { at: 0.02, dur: 0.12, vol: 0.12, filter: { type: 'bandpass', f: 2600, q: 3 } });
      break;
    case 'fieldheal':
      [72, 76, 79, 84].forEach((m, i) => playNote(sub(o, i * 0.07), 'bell', m, 0.5, 0.35));
      break;
    case 'warcry':
      // A shout: a falling, growling saw plus a war horn.
      tone(o, { type: 'sawtooth', f: 240 * k, f2: 150, glide: 0.5, dur: 0.6, attack: 0.03, vol: 0.18, vibrato: [7, 0.04], filter: { type: 'bandpass', f: 900, q: 1.2 } });
      playNote(o, 'horn', 50, 0.7, 0.6);
      break;
    case 'whirlwind':
      for (let i = 0; i < 3; i++) noise(o, { at: i * 0.09, dur: 0.12, vol: 0.18, filter: { type: 'bandpass', f: 1800 + i * 600, q: 1.5 } });
      playDrum(sub(o, 0.3), 'tom', 0.8);
      break;
    case 'frenzy':
      tone(o, { type: 'sawtooth', f: 90 * k, f2: 180, glide: 0.4, dur: 0.5, attack: 0.02, vol: 0.16, filter: { type: 'lowpass', f: 1200 } });
      playDrum(o, 'kick', 0.9);
      playDrum(sub(o, 0.18), 'kick', 0.9);
      break;
    default:
      playNote(o, lead, 67, 0.3, 0.4);
  }
}

/** Prophets' calamities: rumbling earth, roaring fire, howling wind, a sickly drone. */
export function calamitySound(o: Out, ability: AbilityId, r: number): void {
  const k = vary(r, 0.1);
  switch (ability) {
    case 'quake':
      noise(o, { dur: 2.6, attack: 0.2, vol: 0.55, rate: 0.35, filter: { type: 'lowpass', f: 260, f2: 90 } });
      tone(o, { f: 38 * k, f2: 28, dur: 2.4, attack: 0.15, vol: 0.4, vibrato: [9, 0.2] });
      for (let i = 0; i < 5; i++) noise(o, { at: 0.3 + i * 0.37, dur: 0.12, vol: 0.12, filter: { type: 'bandpass', f: 700 + i * 160, q: 2 } });
      break;
    case 'firestorm':
      noise(o, { dur: 2.2, attack: 0.25, vol: 0.4, filter: { type: 'bandpass', f: 600, f2: 1800, q: 0.6 } });
      for (let i = 0; i < 8; i++) noise(o, { at: 0.1 + ((i * 0.37 + r) % 1) * 1.8, dur: 0.03, vol: 0.12, filter: { type: 'highpass', f: 3000 } });
      break;
    case 'storm':
      noise(o, { dur: 2.8, attack: 0.5, vol: 0.4, filter: { type: 'bandpass', f: 500, f2: 1400, q: 3 } });
      noise(o, { at: 0.6, dur: 2, attack: 0.4, vol: 0.25, filter: { type: 'bandpass', f: 1500, f2: 700, q: 4 } });
      break;
    case 'plague':
      tone(o, { type: 'sawtooth', f: 73 * k, dur: 2.2, attack: 0.4, vol: 0.12, vibrato: [3, 0.03], filter: { type: 'lowpass', f: 500 } });
      tone(o, { type: 'sawtooth', f: 77.8 * k, dur: 2.2, attack: 0.4, vol: 0.1, filter: { type: 'lowpass', f: 500 } });
      for (let i = 0; i < 6; i++) tone(o, { at: 0.2 + i * 0.3, f: 300 + ((i * 97) % 200), f2: 120, dur: 0.08, vol: 0.05 });
      break;
    default:
      noise(o, { dur: 1, vol: 0.3, filter: { type: 'lowpass', f: 600 } });
  }
}

/** A unit changes sides: a soft choir chord swelling up. */
export function convertSound(o: Out, style: EraStyle): void {
  const inst = style === 'future' ? 'pad' : 'strings';
  for (const m of [60, 64, 67, 72]) playNote(o, inst, m, 1.2, 0.3);
  playNote(sub(o, 0.5), 'bell', 84, 0.8, 0.3);
}

/** A priest's healing: a quiet chime. */
export function healSound(o: Out, r: number): void {
  const k = vary(r, 0.05);
  tone(o, { type: 'sine', f: 1320 * k, dur: 0.5, attack: 0.01, vol: 0.06 });
  tone(o, { at: 0.08, type: 'sine', f: 1760 * k, dur: 0.45, attack: 0.01, vol: 0.05 });
}

/** Citizens at work: axe on wood, pick on rock, rustling crops, hammering. */
export function workSound(o: Out, work: Res | 'build', style: EraStyle, r: number): void {
  const k = vary(r, 0.15);
  switch (work) {
    case 'wood':
      tone(o, { f: 190 * k, f2: 120, dur: 0.07, attack: 0.001, vol: 0.22 });
      noise(o, { dur: 0.05, vol: 0.14, filter: { type: 'bandpass', f: 1100 * k, q: 2 } });
      break;
    case 'stone':
    case 'gold':
    case 'iron': {
      const f = (work === 'stone' ? 2000 : work === 'gold' ? 2500 : 2250) * k;
      noise(o, { dur: 0.04, vol: 0.12, filter: { type: 'highpass', f: 2500 } });
      tone(o, { f, dur: 0.1, attack: 0.001, vol: 0.09 });
      tone(o, { f: f * 1.53, dur: 0.07, attack: 0.001, vol: 0.05 });
      break;
    }
    case 'food':
      noise(o, { dur: 0.14, attack: 0.03, vol: 0.12, filter: { type: 'bandpass', f: 3200 * k, q: 0.7 } });
      break;
    case 'build':
      if (style === 'future') {
        tone(o, { type: 'square', f: 140 * k, dur: 0.09, attack: 0.002, vol: 0.05, filter: { type: 'lowpass', f: 900 } });
        noise(o, { dur: 0.08, vol: 0.05, filter: { type: 'highpass', f: 5000 } });
      } else {
        tone(o, { f: 160 * k, f2: 95, dur: 0.06, attack: 0.001, vol: 0.22 });
        noise(o, { dur: 0.035, vol: 0.14, filter: { type: 'bandpass', f: 1900 * k, q: 1.5 } });
      }
      break;
  }
}

// --------------------------------------------------------------- interface

export type UiSound = 'click' | 'error' | 'place' | 'built' | 'trained' | 'tech' | 'epoch' | 'alarm' | 'victory' | 'defeat' | 'wonder';
export const UI_SOUNDS: UiSound[] = ['click', 'error', 'place', 'built', 'trained', 'tech', 'epoch', 'alarm', 'victory', 'defeat', 'wonder'];

/** Plays notes given as [offset in s, semitones over `root`, length in s]. */
function phrase(o: Out, inst: Inst, root: number, notes: Array<[number, number, number]>, vel = 1): void {
  for (const [at, step, len] of notes) playNote(sub(o, at), inst, root + step, len, vel);
}

export function uiSound(o: Out, id: UiSound, style: EraStyle): void {
  const { lead, fanfare } = ERA_INST[style];
  switch (id) {
    case 'click':
      tone(o, { f: 1250, dur: 0.035, attack: 0.001, vol: 0.06 });
      break;
    case 'error':
      tone(o, { type: 'square', f: 233, dur: 0.09, attack: 0.002, vol: 0.06, filter: { type: 'lowpass', f: 1200 } });
      tone(o, { type: 'square', f: 196, at: 0.11, dur: 0.12, attack: 0.002, vol: 0.06, filter: { type: 'lowpass', f: 1200 } });
      break;
    case 'place':
      tone(o, { f: 170, f2: 80, dur: 0.14, attack: 0.001, vol: 0.3 });
      noise(o, { dur: 0.09, vol: 0.12, filter: { type: 'lowpass', f: 900 } });
      break;
    case 'built':
      phrase(o, lead, 67, [[0, 0, 0.12], [0.1, 4, 0.12], [0.2, 7, 0.3]], 0.8);
      break;
    case 'trained':
      phrase(o, lead, 69, [[0, 0, 0.1], [0.11, 7, 0.22]], 0.7);
      break;
    case 'tech':
      phrase(o, 'bell', 79, [[0, 0, 0.3], [0.09, 7, 0.3], [0.18, 12, 0.3], [0.27, 16, 0.6]], 0.8);
      break;
    case 'epoch':
      phrase(o, fanfare, 60, [[0, 0, 0.18], [0.2, 0, 0.12], [0.34, 4, 0.12], [0.48, 7, 0.2], [0.72, 12, 0.9]]);
      phrase(o, fanfare, 48, [[0, 0, 0.5], [0.72, 7, 0.9]], 0.6);
      playDrum(o, style === 'future' || style === 'modern' ? 'kick' : 'timpani', 0.8);
      playDrum(sub(o, 0.72), style === 'future' || style === 'modern' ? 'kick' : 'timpani', 1);
      break;
    case 'alarm':
      alarmSound(o, style);
      break;
    case 'wonder':
      // Bells over a wide chord: something for the ages.
      phrase(o, 'bell', 72, [[0, 0, 0.8], [0.25, 7, 0.8], [0.5, 12, 1.2]], 0.7);
      phrase(o, 'strings', 48, [[0, 0, 2], [0, 7, 2], [0, 16, 2]], 0.6);
      break;
    case 'victory':
      phrase(o, fanfare, 60, [[0, 0, 0.15], [0.16, 4, 0.15], [0.32, 7, 0.15], [0.48, 12, 0.3], [0.8, 7, 0.15], [0.96, 12, 1.2]]);
      phrase(o, 'strings', 48, [[0, 0, 0.8], [0.8, 4, 1.4]], 0.9);
      playDrum(o, 'timpani', 0.9);
      playDrum(sub(o, 0.96), 'timpani', 1);
      break;
    case 'defeat':
      phrase(o, 'strings', 57, [[0, 12, 0.5], [0.5, 10, 0.5], [1, 7, 0.5], [1.5, 3, 0.5], [2, 0, 1.6]], 0.9);
      phrase(o, 'horn', 45, [[0, 0, 1.4], [1.5, -5, 2]], 0.7);
      break;
  }
}

/** Under attack: war horn, church bell, bugle or siren, depending on the era. */
function alarmSound(o: Out, style: EraStyle): void {
  switch (style) {
    case 'stone':
    case 'ancient':
      phrase(o, 'horn', 45, [[0, 0, 0.55], [0.7, 0, 0.3], [1.05, 5, 0.8]], 1.3);
      break;
    case 'medieval':
      for (let i = 0; i < 4; i++) playNote(sub(o, i * 0.32), 'bell', i % 2 ? 67 : 72, 0.6, 1);
      break;
    case 'imperial':
      phrase(o, 'brass', 67, [[0, 0, 0.09], [0.11, 0, 0.09], [0.22, 0, 0.09], [0.34, 5, 0.4], [0.8, 0, 0.09], [0.91, 5, 0.5]]);
      break;
    default:
      for (let i = 0; i < 2; i++) {
        tone(o, { at: i * 0.7, f: 620, f2: 1050, glide: 0.35, dur: 0.7, attack: 0.03, hold: 0.4, vol: 0.12 });
        tone(o, { at: i * 0.7, type: 'square', f: 620, f2: 1050, glide: 0.35, dur: 0.7, attack: 0.03, hold: 0.4, vol: 0.03, filter: { type: 'lowpass', f: 2500 } });
      }
  }
}

/** What a unit says when selected or given an order. */
export type Ack = 'select' | 'move' | 'attack' | 'work';
export const ACKS: Ack[] = ['select', 'move', 'attack', 'work'];

const ACK_STEPS: Record<Ack, [number, number]> = {
  select: [0, 7],
  move: [7, 12],
  attack: [0, -5],
  work: [4, 7],
};

/**
 * Acknowledgement: machines answer with their engine, everybody else with
 * a two-note call on the era's lead instrument (riders add hoofbeats).
 * `look` undefined means a building was selected.
 */
export function ackSound(o: Out, ack: Ack, look: Look | undefined, style: EraStyle, r: number): void {
  const k = vary(r, 0.06);
  if (look === 'drone') {
    tone(o, { type: 'sawtooth', f: 190 * k, dur: 0.35, attack: 0.04, vol: 0.16, vibrato: [32, 0.05], filter: { type: 'bandpass', f: 900, q: 1.5 } });
    return;
  }
  if (look === 'mech') {
    tone(o, { type: 'square', f: 280 * k, f2: ack === 'attack' ? 200 : 620, glide: 0.14, dur: 0.18, attack: 0.004, vol: 0.09, filter: { type: 'lowpass', f: 1800 } });
    tone(o, { at: 0.2, f: 1600, dur: 0.03, vol: 0.08 });
    return;
  }
  if (look && MACHINES.has(look)) {
    const up = ack === 'attack' ? 1.5 : 1.25;
    tone(o, { type: 'sawtooth', f: 52 * k, f2: 52 * k * up, glide: 0.22, dur: 0.42, attack: 0.03, vol: 0.13, filter: { type: 'lowpass', f: 380 } });
    noise(o, { dur: 0.4, attack: 0.03, vol: 0.08, rate: 0.4, filter: { type: 'lowpass', f: 320 } });
    return;
  }
  if (look && WOOD_SIEGE.has(look)) {
    tone(o, { type: 'sawtooth', f: 95 * k, f2: 75, dur: 0.28, attack: 0.03, vol: 0.08, filter: { type: 'bandpass', f: 650, q: 7 } });
    tone(o, { at: 0.24, f: 170, f2: 100, dur: 0.07, vol: 0.18 });
    return;
  }
  const { lead } = ERA_INST[style];
  if (!look) {
    playNote(o, lead, 67, 0.18, 0.5);
    playNote(o, lead, 74, 0.18, 0.35);
    return;
  }
  if (look === 'runner' || look === 'scouthorse') {
    tone(o, { f: 1500 * k, f2: 1950 * k, glide: 0.1, dur: 0.14, attack: 0.01, vol: 0.1 });
    tone(o, { at: 0.16, f: 1950 * k, f2: ack === 'attack' ? 1500 : 2300, glide: 0.08, dur: 0.12, attack: 0.01, vol: 0.1 });
  } else {
    // Heroes answer low and firm, the faithful high and soft.
    const root = look === 'citizen' ? 76 : look === 'horse' || look === 'chariot' ? 69 : look === 'strategist' || look === 'warrior' ? 57 : look === 'priest' || look === 'prophet' ? 72 : 64;
    const [a, b] = ACK_STEPS[ack];
    playNote(o, lead, root + a, 0.1, 0.6);
    playNote(sub(o, 0.11), lead, root + b, ack === 'attack' ? 0.18 : 0.14, ack === 'attack' ? 0.8 : 0.6);
    if (ack === 'attack') playDrum(o, style === 'modern' || style === 'future' ? 'snare' : 'frame', 0.5);
  }
  if (look === 'horse' || look === 'chariot' || look === 'scouthorse') {
    for (let i = 0; i < 3; i++) playDrum(sub(o, 0.05 + i * 0.09), 'click', 0.9);
  }
}

// ------------------------------------------------------------ sample list

export interface Sample {
  name: string;
  /** Rough length in seconds, for offline rendering. */
  dur: number;
  play: (o: Out) => void;
}

const STYLES = [...new Set(EPOCHS.map((e) => e.style))];
const SHOT_CASES: Array<[Projectile, Look | undefined, number]> = [
  ['stone', 'sling', 0],
  ['arrow', 'bow', 4],
  ['bullet', 'gun', 10],
  ['bullet', 'rifle', 12],
  ['bullet', 'trooper', 14],
  ['bullet', 'armoredcar', 12],
  ['shell', 'cannon', 10],
  ['shell', 'rocket', 14],
  ['shell', 'tank', 14],
  ['boulder', 'catapult', 5],
  ['laser', 'laser', 16],
  ['laser', 'beam', 17],
];
const ACK_LOOKS: Array<Look | undefined> = [undefined, 'citizen', 'sword', 'horse', 'runner', 'catapult', 'tank', 'mech', 'drone', 'warrior', 'priest'];
const ABILITY_IDS: AbilityId[] = ['rally', 'shieldwall', 'fieldheal', 'warcry', 'whirlwind', 'frenzy'];
const CALAMITY_IDS: AbilityId[] = ['plague', 'quake', 'firestorm', 'storm'];

/** Every recipe with representative inputs: for tests and listening checks. */
export function soundSamples(): Sample[] {
  const out: Sample[] = [];
  for (const [p, look, epoch] of SHOT_CASES) out.push({ name: `shot:${p}:${look}`, dur: 1.2, play: (o) => shotSound(o, p, look, epoch, 0.5) });
  for (const [look, epoch] of [['club', 0], ['sword', 7], ['ram', 2]] as Array<[Look, number]>) {
    out.push({ name: `melee:${look}`, dur: 0.6, play: (o) => meleeSound(o, look, epoch, 0.5) });
  }
  for (const p of ['arrow', 'bullet', 'laser'] as Projectile[]) {
    for (const building of [false, true]) out.push({ name: `impact:${p}:${building ? 'building' : 'unit'}`, dur: 0.3, play: (o) => impactSound(o, p, building, 0.2) });
  }
  for (const p of ['shell', 'boulder', 'laser'] as Projectile[]) out.push({ name: `blast:${p}`, dur: 1.6, play: (o) => blastSound(o, p, 1.5, 0.5) });
  for (const look of ['sword', 'citizen', 'tank', 'catapult', 'drone'] as Look[]) out.push({ name: `death:${look}`, dur: 1, play: (o) => deathSound(o, look, 0.5) });
  out.push({ name: 'collapse', dur: 2.2, play: (o) => collapseSound(o, 3, 0.5) });
  for (const work of ['wood', 'stone', 'gold', 'iron', 'food', 'build'] as Array<Res | 'build'>) {
    out.push({ name: `work:${work}`, dur: 0.3, play: (o) => workSound(o, work, 'medieval', 0.5) });
  }
  out.push({ name: 'work:build:future', dur: 0.3, play: (o) => workSound(o, 'build', 'future', 0.5) });
  for (const id of ABILITY_IDS) out.push({ name: `ability:${id}`, dur: 1.8, play: (o) => abilitySound(o, id, 'medieval', 0.5) });
  for (const id of CALAMITY_IDS) out.push({ name: `calamity:${id}`, dur: 3, play: (o) => calamitySound(o, id, 0.5) });
  out.push({ name: 'convert', dur: 2.6, play: (o) => convertSound(o, 'ancient') });
  out.push({ name: 'heal', dur: 0.6, play: (o) => healSound(o, 0.5) });
  for (const style of STYLES) {
    for (const id of UI_SOUNDS) out.push({ name: `ui:${id}:${style}`, dur: id === 'defeat' || id === 'wonder' ? 4 : id === 'victory' ? 3 : 2.5, play: (o) => uiSound(o, id, style) });
    for (const look of ACK_LOOKS) {
      for (const ack of ACKS) out.push({ name: `ack:${ack}:${look ?? 'building'}:${style}`, dur: 0.8, play: (o) => ackSound(o, ack, look, style, 0.5) });
    }
  }
  return out;
}
