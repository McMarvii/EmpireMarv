import type { BuildingType } from './buildings';
import type { Cost } from './resources';

/** Visual style families; every three epochs share one architecture look. */
export type EraStyle = 'stone' | 'ancient' | 'medieval' | 'imperial' | 'modern' | 'future';

export interface Epoch {
  index: number;
  name: string;
  period: string;
  style: EraStyle;
  description: string;
  /** Cost to advance INTO this epoch (empty for the first one). */
  advanceCost: Cost;
  /** Seconds the town center needs to research the advance. */
  advanceTime: number;
  /** Finished buildings a player needs to advance INTO this epoch. */
  requires: Partial<Record<BuildingType, number>>;
}

const RAW: Array<Pick<Epoch, 'name' | 'period' | 'description'>> = [
  { name: 'Urzeit', period: 'bis 10.000 v. Chr.', description: 'Jäger und Sammler, Keulen und Steine.' },
  { name: 'Jungsteinzeit', period: '10.000–5.000 v. Chr.', description: 'Ackerbau, erste Siedlungen, Schleudern.' },
  { name: 'Kupferzeit', period: '5.000–3.000 v. Chr.', description: 'Erste Metalle, Bögen und Rammböcke.' },
  { name: 'Bronzezeit', period: '3.000–1.200 v. Chr.', description: 'Streitwagen und Bronzeschwerter.' },
  { name: 'Eisenzeit', period: '1.200–500 v. Chr.', description: 'Eisenwaffen, Hopliten, Kompositbögen.' },
  { name: 'Antike', period: '500 v. Chr.–500 n. Chr.', description: 'Legionen, Reiterei und Katapulte.' },
  { name: 'Frühmittelalter', period: '500–1000', description: 'Völkerwanderung und Kettenhemden.' },
  { name: 'Hochmittelalter', period: '1000–1300', description: 'Ritter, Burgen und Trebuchets.' },
  { name: 'Spätmittelalter', period: '1300–1500', description: 'Langbögen, Hellebarden, erste Bombarden.' },
  { name: 'Renaissance', period: '1500–1650', description: 'Arkebusen, Landsknechte und Kürassiere.' },
  { name: 'Zeitalter der Imperien', period: '1650–1789', description: 'Musketen, Dragoner und Feldkanonen.' },
  { name: 'Revolutionszeit', period: '1789–1850', description: 'Linieninfanterie, Husaren und Grenadiere.' },
  { name: 'Industrialisierung', period: '1850–1914', description: 'Gewehre, Feldgeschütze, Panzerwagen.' },
  { name: 'Weltkriege', period: '1914–1945', description: 'Panzer, Haubitzen und Sturmtruppen.' },
  { name: 'Atomzeitalter', period: '1945–1991', description: 'Kampfpanzer, Raketenartillerie, Bazookas.' },
  { name: 'Digitalzeitalter', period: '1991–2040', description: 'Präzisionswaffen und Spezialeinheiten.' },
  { name: 'Nanozeitalter', period: '2040–2100', description: 'Kampfmechs, Laser und Nano-Soldaten.' },
  { name: 'Weltraumzeitalter', period: 'ab 2100', description: 'Plasmawaffen und Titan-Mechs.' },
];

const STYLES: EraStyle[] = ['stone', 'ancient', 'medieval', 'imperial', 'modern', 'future'];

/**
 * Buildings needed to advance into each epoch. Every step asks for what the
 * previous epochs unlocked, in growing numbers, so a city has to grow with
 * its era instead of racing through the town center alone.
 */
const REQUIRES: Array<Partial<Record<BuildingType, number>>> = [
  {},
  { house: 2, storehouse: 1 },
  { barracks: 1, farm: 2 },
  { barracks: 1, workshop: 1, house: 2 },
  { stable: 1, tower: 1 },
  { farm: 4, storehouse: 2 },
  { barracks: 2, house: 4 },
  { wall: 12, gate: 1 },
  { tower: 2, stable: 2 },
  { workshop: 2, storehouse: 3 },
  { house: 6, farm: 6 },
  { barracks: 3, tower: 3 },
  { stable: 3, workshop: 3 },
  { farm: 8, storehouse: 4 },
  { tower: 4, wall: 24 },
  { house: 8, barracks: 4 },
  { stable: 4, workshop: 4 },
  { house: 10, tower: 5, gate: 2 },
];

function round25(n: number): number {
  return Math.round(n / 25) * 25;
}

/**
 * Advance costs grow linearly so that a full 18-epoch game stays playable in
 * roughly an hour; stone, gold and iron only become part of the price once
 * they matter for that era's units.
 */
function advanceCostFor(index: number): Cost {
  if (index === 0) return {};
  const g = 1 + 0.35 * (index - 1);
  const cost: Cost = { food: round25(300 * g), wood: round25(250 * g) };
  if (index >= 2) cost.stone = round25(150 * g);
  if (index >= 4) cost.gold = round25(200 * g);
  if (index >= 6) cost.iron = round25(150 * g);
  return cost;
}

export const EPOCHS: Epoch[] = RAW.map((e, index) => ({
  ...e,
  index,
  style: STYLES[Math.floor(index / 3)],
  advanceCost: advanceCostFor(index),
  advanceTime: index === 0 ? 0 : 25 + 2 * index,
  requires: REQUIRES[index],
}));

export const EPOCH_COUNT = EPOCHS.length;
export const LAST_EPOCH = EPOCH_COUNT - 1;

export function epochStyle(index: number): EraStyle {
  return EPOCHS[Math.max(0, Math.min(LAST_EPOCH, index))].style;
}

const ROMAN: Array<[number, string]> = [
  [1000, 'M'],
  [900, 'CM'],
  [500, 'D'],
  [400, 'CD'],
  [100, 'C'],
  [90, 'XC'],
  [50, 'L'],
  [40, 'XL'],
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
];

export function toRoman(n: number): string {
  let out = '';
  for (const [v, sym] of ROMAN) {
    while (n >= v) {
      out += sym;
      n -= v;
    }
  }
  return out;
}

/** Roman numeral of an epoch, counted from I like the classics. */
export function epochNumeral(index: number): string {
  return toRoman(index + 1);
}

/** "IV · Bronzezeit" */
export function epochLabel(index: number): string {
  return `${epochNumeral(index)} · ${EPOCHS[index].name}`;
}
