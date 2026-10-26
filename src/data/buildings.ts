import type { Cost } from './resources';
import type { Role } from './units';

export type BuildingType =
  | 'towncenter'
  | 'house'
  | 'barracks'
  | 'stable'
  | 'workshop'
  | 'storehouse'
  | 'farm'
  | 'tower'
  | 'wall'
  | 'gate'
  | 'smithy'
  | 'academy';

export interface BuildingDef {
  type: BuildingType;
  /** Names change with the epoch; the last entry whose epoch is reached wins. */
  names: Array<[number, string]>;
  size: number;
  hp: number;
  cost: Cost;
  buildTime: number;
  minEpoch: number;
  trains: Role[];
  dropoff: boolean;
  walkable: boolean;
  sight: number;
  attack?: { dmg: number; range: number; cooldown: number };
  /** Placed by dragging a line of 1×1 segments (walls and gates). */
  line?: boolean;
  /** Lets units of the owner's team through, blocks everyone else. */
  gate?: boolean;
  hotkey: string;
  description: string;
}

export const BUILDING_DEFS: Record<BuildingType, BuildingDef> = {
  towncenter: {
    type: 'towncenter',
    names: [
      [0, 'Dorfzentrum'],
      [3, 'Stadtzentrum'],
      [12, 'Rathaus'],
      [15, 'Regierungssitz'],
    ],
    size: 4,
    hp: 2400,
    cost: { wood: 300, stone: 200, gold: 100 },
    buildTime: 90,
    minEpoch: 0,
    trains: ['citizen', 'scout'],
    dropoff: true,
    walkable: false,
    sight: 10,
    attack: { dmg: 6, range: 6, cooldown: 2 },
    hotkey: 'Z',
    description: 'Bildet Bürger und Späher aus, nimmt alle Rohstoffe an und erforscht den Aufstieg in die nächste Epoche.',
  },
  house: {
    type: 'house',
    names: [
      [0, 'Hütte'],
      [3, 'Haus'],
      [12, 'Wohnblock'],
      [15, 'Wohnturm'],
    ],
    size: 2,
    hp: 500,
    cost: { wood: 60 },
    buildTime: 18,
    minEpoch: 0,
    trains: [],
    dropoff: false,
    walkable: false,
    sight: 5,
    hotkey: 'H',
    description: 'Gibt eigenen Einheiten in der Nähe Moral: +4 % Schaden und −4 % erlittenen Schaden pro Haus (max. 5).',
  },
  barracks: {
    type: 'barracks',
    names: [
      [0, 'Kriegerlager'],
      [3, 'Kaserne'],
      [15, 'Ausbildungszentrum'],
    ],
    size: 3,
    hp: 1200,
    cost: { wood: 150 },
    buildTime: 40,
    minEpoch: 0,
    trains: ['assault', 'pike', 'ranged'],
    dropoff: false,
    walkable: false,
    sight: 6,
    hotkey: 'K',
    description: 'Bildet Sturm-, Abwehr- und Fernkampfinfanterie aus.',
  },
  stable: {
    type: 'stable',
    names: [
      [3, 'Stall'],
      [12, 'Fahrzeugwerk'],
      [16, 'Mech-Hangar'],
    ],
    size: 3,
    hp: 1200,
    cost: { wood: 150, gold: 50 },
    buildTime: 45,
    minEpoch: 3,
    trains: ['mounted'],
    dropoff: false,
    walkable: false,
    sight: 6,
    hotkey: 'S',
    description: 'Bildet Kavallerie aus, ab der Industrialisierung Fahrzeuge und Panzer.',
  },
  workshop: {
    type: 'workshop',
    names: [
      [2, 'Belagerungswerkstatt'],
      [9, 'Gießerei'],
      [13, 'Waffenfabrik'],
    ],
    size: 3,
    hp: 1100,
    cost: { wood: 200, stone: 50 },
    buildTime: 50,
    minEpoch: 2,
    trains: ['siege'],
    dropoff: false,
    walkable: false,
    sight: 6,
    hotkey: 'W',
    description: 'Baut Belagerungswaffen und Artillerie – stark gegen Gebäude.',
  },
  storehouse: {
    type: 'storehouse',
    names: [
      [0, 'Lager'],
      [12, 'Depot'],
    ],
    size: 2,
    hp: 600,
    cost: { wood: 100 },
    buildTime: 22,
    minEpoch: 0,
    trains: [],
    dropoff: true,
    walkable: false,
    sight: 5,
    hotkey: 'L',
    description: 'Abgabestelle für alle Rohstoffe – nahe an Wald und Minen bauen.',
  },
  farm: {
    type: 'farm',
    names: [
      [0, 'Feld'],
      [6, 'Bauernhof'],
      [13, 'Agrarfabrik'],
    ],
    size: 3,
    hp: 300,
    cost: { wood: 75 },
    buildTime: 15,
    minEpoch: 1,
    trains: [],
    dropoff: false,
    walkable: true,
    sight: 3,
    hotkey: 'F',
    description: 'Unerschöpfliche Nahrungsquelle für bis zu zwei Bürger.',
  },
  tower: {
    type: 'tower',
    names: [
      [0, 'Wachturm'],
      [9, 'Bastion'],
      [13, 'Bunker'],
      [15, 'Abwehrgeschütz'],
    ],
    size: 2,
    hp: 900,
    cost: { wood: 50, stone: 125 },
    buildTime: 35,
    minEpoch: 1,
    trains: [],
    dropoff: false,
    walkable: false,
    sight: 9,
    attack: { dmg: 8, range: 7, cooldown: 1.8 },
    hotkey: 'T',
    description: 'Verteidigungsturm. Wird mit jeder Epoche stärker.',
  },
  smithy: {
    type: 'smithy',
    names: [
      [0, 'Werkplatz'],
      [2, 'Schmiede'],
      [7, 'Waffenschmiede'],
      [12, 'Rüstungswerk'],
      [15, 'Waffenlabor'],
    ],
    size: 3,
    hp: 1000,
    cost: { wood: 150 },
    buildTime: 40,
    minEpoch: 0,
    trains: [],
    dropoff: false,
    walkable: false,
    sight: 5,
    hotkey: 'B',
    description: 'Erforscht Waffen und Rüstungen für Infanterie, Fernkampf und Kavallerie.',
  },
  academy: {
    type: 'academy',
    names: [
      [0, 'Ahnenstätte'],
      [3, 'Schreiberhaus'],
      [5, 'Akademie'],
      [9, 'Universität'],
      [12, 'Institut'],
      [15, 'Forschungszentrum'],
    ],
    size: 3,
    hp: 900,
    cost: { wood: 150, stone: 50 },
    buildTime: 45,
    minEpoch: 0,
    trains: [],
    dropoff: false,
    walkable: false,
    sight: 5,
    hotkey: 'U',
    description: 'Erforscht Baukunst, Mauerwerk, Mathematik, Medizin, Schrift, Kartografie und Staatskunst.',
  },
  wall: {
    type: 'wall',
    names: [
      [1, 'Palisade'],
      [3, 'Lehmziegelmauer'],
      [6, 'Steinmauer'],
      [9, 'Festungsmauer'],
      [12, 'Betonmauer'],
      [15, 'Energiebarriere'],
    ],
    size: 1,
    hp: 700,
    cost: { wood: 4, stone: 2 },
    buildTime: 6,
    minEpoch: 1,
    trains: [],
    dropoff: false,
    walkable: false,
    sight: 2,
    line: true,
    hotkey: 'M',
    description: 'Sperrt Gegner aus. Ziehen baut eine ganze Linie, Türme dürfen direkt anschließen.',
  },
  gate: {
    type: 'gate',
    names: [
      [1, 'Palisadentor'],
      [3, 'Stadttor'],
      [6, 'Torhaus'],
      [9, 'Festungstor'],
      [12, 'Schranke'],
      [15, 'Energietor'],
    ],
    size: 1,
    hp: 900,
    cost: { wood: 25, stone: 15 },
    buildTime: 14,
    minEpoch: 1,
    trains: [],
    dropoff: false,
    walkable: false,
    sight: 3,
    line: true,
    gate: true,
    hotkey: 'G',
    description: 'Durchgang in der Mauer: lässt eigene und verbündete Einheiten durch, Gegner nicht.',
  },
};

export const BUILDABLE: BuildingType[] = [
  'house',
  'farm',
  'storehouse',
  'barracks',
  'tower',
  'wall',
  'gate',
  'workshop',
  'stable',
  'smithy',
  'academy',
  'towncenter',
];

export function buildingName(type: BuildingType, epoch: number): string {
  const names = BUILDING_DEFS[type].names;
  let name = names[0][1];
  for (const [e, n] of names) if (e <= epoch) name = n;
  return name;
}

/** Buildings get sturdier with every epoch their owner reaches. */
export function buildingMaxHp(type: BuildingType, epoch: number): number {
  return Math.round(BUILDING_DEFS[type].hp * (1 + 0.18 * epoch));
}

/** Defensive buildings scale with the owner's current epoch. */
export function buildingAttack(type: BuildingType, epoch: number) {
  const a = BUILDING_DEFS[type].attack;
  if (!a) return undefined;
  return { dmg: a.dmg * (1 + 0.22 * epoch), range: a.range + Math.floor(epoch / 6), cooldown: a.cooldown };
}

export const FARM_CAPACITY = 2;
export const MORALE_RADIUS = 8;
export const MORALE_PER_HOUSE = 0.04;
export const MORALE_MAX_HOUSES = 5;
