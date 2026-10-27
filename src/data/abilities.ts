import type { Role } from './units';

export type AbilityId = 'rally' | 'shieldwall' | 'fieldheal' | 'warcry' | 'whirlwind' | 'frenzy' | 'plague' | 'quake' | 'firestorm' | 'storm';

/** Timed states on a unit, set by abilities and calamities. */
export type Status = 'stun' | 'haste' | 'shield' | 'frenzy' | 'plague' | 'slow';
/** Fixed order, e.g. for checksums. */
export const STATUSES: Status[] = ['stun', 'haste', 'shield', 'frenzy', 'plague', 'slow'];

export interface AbilityDef {
  id: AbilityId;
  name: string;
  role: Role;
  /** Key on the command card (abilities never share a card with citizens' build keys). */
  key: string;
  /** Seconds until it can be used again (heroes). */
  cooldown: number;
  radius: number;
  /** Self: around the caster at once. Ground: a spot within `range`, the caster walks there first. */
  target: 'self' | 'ground';
  range: number;
  /** Faith points it costs (prophets). */
  faith: number;
  minEpoch: number;
  text: string;
}

export const ABILITIES: AbilityDef[] = [
  {
    id: 'rally',
    name: 'Sammelruf',
    role: 'strategist',
    key: 'M',
    cooldown: 60,
    radius: 8,
    target: 'self',
    range: 0,
    faith: 0,
    minEpoch: 0,
    text: 'Eigene und verbündete Einheiten in der Nähe laufen 10 s lang 35 % schneller.',
  },
  {
    id: 'shieldwall',
    name: 'Schildwall',
    role: 'strategist',
    key: 'W',
    cooldown: 75,
    radius: 6,
    target: 'self',
    range: 0,
    faith: 0,
    minEpoch: 0,
    text: 'Einheiten in der Nähe erleiden 12 s lang 40 % weniger Schaden.',
  },
  {
    id: 'fieldheal',
    name: 'Feldlazarett',
    role: 'strategist',
    key: 'L',
    cooldown: 90,
    radius: 7,
    target: 'self',
    range: 0,
    faith: 0,
    minEpoch: 0,
    text: 'Heilt Einheiten in der Nähe sofort um 35 % ihrer Lebenspunkte und kuriert die Seuche.',
  },
  {
    id: 'warcry',
    name: 'Kampfschrei',
    role: 'warrior',
    key: 'K',
    cooldown: 50,
    radius: 5,
    target: 'self',
    range: 0,
    faith: 0,
    minEpoch: 0,
    text: 'Gegnerische Einheiten in der Nähe sind 3 s lang gelähmt.',
  },
  {
    id: 'whirlwind',
    name: 'Wirbelschlag',
    role: 'warrior',
    key: 'D',
    cooldown: 30,
    radius: 2.5,
    target: 'self',
    range: 0,
    faith: 0,
    minEpoch: 0,
    text: 'Trifft alle Gegner rundum mit dem 2,5-fachen Schaden.',
  },
  {
    id: 'frenzy',
    name: 'Blutrausch',
    role: 'warrior',
    key: 'U',
    cooldown: 60,
    radius: 0,
    target: 'self',
    range: 0,
    faith: 0,
    minEpoch: 0,
    text: '10 s lang 50 % mehr Schaden und schnellere Angriffe.',
  },
  {
    id: 'plague',
    name: 'Seuche',
    role: 'prophet',
    key: 'S',
    cooldown: 0,
    radius: 4,
    target: 'ground',
    range: 9,
    faith: 100,
    minEpoch: 2,
    text: 'Gegnerische Einheiten im Gebiet erkranken und verlieren in 12 s 30 % ihrer Lebenspunkte – auch wenn sie davonlaufen.',
  },
  {
    id: 'quake',
    name: 'Erdbeben',
    role: 'prophet',
    key: 'B',
    cooldown: 0,
    radius: 5,
    target: 'ground',
    range: 9,
    faith: 150,
    minEpoch: 2,
    text: 'Erschüttert das Gebiet 3 s lang: gegnerische Gebäude verlieren 25 %, Einheiten 15 % ihrer Lebenspunkte.',
  },
  {
    id: 'firestorm',
    name: 'Feuersturm',
    role: 'prophet',
    key: 'F',
    cooldown: 0,
    radius: 3.5,
    target: 'ground',
    range: 9,
    faith: 150,
    minEpoch: 5,
    text: 'Flammen fegen 6 s lang über das Gebiet: Gegner verlieren bis zu 45 %, Gebäude 15 % ihrer Lebenspunkte.',
  },
  {
    id: 'storm',
    name: 'Sturm',
    role: 'prophet',
    key: 'T',
    cooldown: 0,
    radius: 5,
    target: 'ground',
    range: 9,
    faith: 120,
    minEpoch: 8,
    text: 'Ein Sturm bremst Gegner im Gebiet 8 s lang auf halbes Tempo und kostet sie 20 % ihrer Lebenspunkte.',
  },
];

export const ABILITY_BY_ID = new Map(ABILITIES.map((a) => [a.id, a]));

export function abilitiesOf(role: Role): AbilityDef[] {
  return ABILITIES.filter((a) => a.role === role);
}

/** How long a calamity's area stays active (seconds); the plague lingers in its victims longer. */
export const HAZARD_TIME: Record<'plague' | 'quake' | 'firestorm' | 'storm', number> = { plague: 4, quake: 3, firestorm: 6, storm: 8 };

/** Durations of the states abilities and calamities leave (seconds). */
export const STATUS_TIME: Record<AbilityId, number> = {
  rally: 10,
  shieldwall: 12,
  fieldheal: 0,
  warcry: 3,
  whirlwind: 0,
  frenzy: 10,
  plague: 12,
  quake: 3,
  firestorm: 6,
  storm: 8,
};

export const HASTE_SPEED = 1.35;
export const SLOW_SPEED = 0.5;
export const SHIELD_TAKEN = 0.6;
export const FRENZY_DMG = 1.5;
export const FRENZY_COOLDOWN = 0.6;
export const FIELDHEAL_SHARE = 0.35;
export const WHIRLWIND_DMG = 2.5;

/** Hero auras: the strategist leads (morale, healing), the warrior inspires (attack). */
export const STRATEGIST_AURA = 7;
export const STRATEGIST_MORALE = 2;
/** Share of max HP healed per second near the strategist. */
export const STRATEGIST_HEAL = 0.01;
export const WARRIOR_AURA = 6;
export const WARRIOR_BOOST = 1.15;
/** Heroes heal themselves out of combat (share of max HP per second). */
export const HERO_REGEN = 0.01;

/** Priests. */
export const CONVERT_RANGE = 5;
export const CONVERT_TIME = 6;
/** How hard a unit is to win over, by role (heroes cannot be converted at all). */
export const CONVERT_CLASS: Partial<Record<Role, number>> = { citizen: 0.75, scout: 0.75, mounted: 1.5, siege: 2, priest: 1.5, prophet: 1.5 };
/** A hit on a converting priest throws the prayer back this many seconds. */
export const CONVERT_SETBACK = 1.5;
export const HEAL_RANGE = 4;
/** Share of the patient's max HP a priest heals per second. */
export const PRIEST_HEAL = 0.025;

/** Calamity damage as a share of max HP over the whole duration. */
export const CALAMITY_DAMAGE: Record<'plague' | 'quake' | 'firestorm' | 'storm', { units: number; buildings: number }> = {
  plague: { units: 0.3, buildings: 0 },
  quake: { units: 0.15, buildings: 0.25 },
  firestorm: { units: 0.45, buildings: 0.15 },
  storm: { units: 0.2, buildings: 0 },
};
