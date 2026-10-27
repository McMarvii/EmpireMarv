import { epochStyle, type EraStyle } from './epochs';

/** What a standing wonder does for its owner. */
export type WonderEffect = 'gather' | 'reveal' | 'heal' | 'train' | 'morale' | 'research';

export interface WonderDef {
  era: EraStyle;
  name: string;
  effect: WonderEffect;
  /** The effect in words, for tooltips and messages. */
  text: string;
}

/**
 * One wonder per era. A wonder keeps the era it was founded in: its look,
 * its name and its effect stay when its owner moves on to later epochs.
 */
export const WONDERS: Record<EraStyle, WonderDef> = {
  stone: { era: 'stone', name: 'Steinkreis', effect: 'gather', text: 'Alle Rohstoffe werden 15 % schneller gesammelt.' },
  ancient: { era: 'ancient', name: 'Große Bibliothek', effect: 'reveal', text: 'Die ganze Karte ist aufgedeckt – für dich und deine Verbündeten.' },
  medieval: { era: 'medieval', name: 'Kathedrale', effect: 'heal', text: 'Alle eigenen Einheiten heilen überall langsam, auch im Kampf.' },
  imperial: { era: 'imperial', name: 'Kaiserpalast', effect: 'train', text: 'Einheiten werden 25 % schneller ausgebildet.' },
  modern: { era: 'modern', name: 'Sendeturm', effect: 'morale', text: 'Alle eigenen Einheiten haben überall +2 Moral.' },
  future: { era: 'future', name: 'Weltraumlift', effect: 'research', text: 'Forschung und Aufstieg gehen 30 % schneller.' },
};

/** The wonder a player in this epoch can found. */
export function wonderOf(epoch: number): WonderDef {
  return WONDERS[epochStyle(epoch)];
}

export const WONDER_GATHER = 1.15;
export const WONDER_TRAIN = 1.25;
export const WONDER_RESEARCH = 1.3;
export const WONDER_MORALE = 2;
/** Share of max HP healed per second by the cathedral. */
export const WONDER_HEAL = 0.006;
/** Wonder victory: minutes a finished wonder must stand (0 = off). */
export const WONDER_VICTORY_OPTIONS = [0, 5, 10, 15];
