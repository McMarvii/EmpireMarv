import type { BuildingType } from './buildings';
import type { Cost, Res } from './resources';
import type { Role } from './units';

/**
 * Technologies come in branches: a branch has one effect that every level
 * applies again, and levels that unlock epoch by epoch. Each level needs the
 * one before it, a few also need a level of another branch. So the tree keeps
 * growing with the civilisation, and adding a level is one line of data.
 */
export type Effect =
  | { kind: 'unit'; roles: Role[]; dmg?: number; armor?: number; hp?: number; speed?: number; range?: number; sight?: number }
  | { kind: 'gather'; res: Res[]; mul: number }
  | { kind: 'farm'; mul: number }
  | { kind: 'carry'; add: number }
  | { kind: 'build'; mul: number }
  | { kind: 'buildingHp'; types: BuildingType[] | 'all'; mul: number }
  | { kind: 'tower'; dmg?: number; range?: number }
  | { kind: 'research'; mul: number }
  | { kind: 'train'; mul: number }
  | { kind: 'regen'; add: number }
  /** Conversions of own units take this much longer (0.4 = +40 %). */
  | { kind: 'convertResist'; add: number }
  /** Healing by priests, the strategist and wonders is this much stronger. */
  | { kind: 'heal'; add: number }
  /** Calamities hurt own units and buildings this much less (fraction, capped). */
  | { kind: 'calamityResist'; add: number }
  /** Faith regenerates this much faster. */
  | { kind: 'faith'; add: number }
  /** Fishing boats catch this much more. */
  | { kind: 'fishing'; mul: number }
  /** Planes carry this much more fuel. */
  | { kind: 'fuel'; mul: number }
  /** Bombers carry this many more bombs per sortie. */
  | { kind: 'bombs'; add: number }
  /** Anti-aircraft fire (towers, anti-tank troops) does this much more damage to planes. */
  | { kind: 'antiAir'; mul: number };

/** Glyph drawn on the tech icon. */
export type TechGlyph =
  | 'sword'
  | 'bow'
  | 'shield'
  | 'horse'
  | 'hammer'
  | 'wall'
  | 'angle'
  | 'cross'
  | 'book'
  | 'eye'
  | 'crown'
  | 'pick'
  | 'basket'
  | 'people'
  | 'helmet'
  | 'boot'
  | 'horseshoe'
  | 'wheel'
  | 'cannon'
  | 'crosshair'
  | 'tower'
  | 'axe'
  | 'ore'
  | 'wheat'
  | 'anchor'
  | 'fish'
  | 'plane';

export interface Branch {
  id: string;
  name: string;
  building: BuildingType;
  glyph: TechGlyph;
  /** What every level of the branch adds, in words. */
  text: string;
  effects: Effect[];
  base: Cost;
  /** [epoch, name, extra prerequisite (tech id)?] in ascending epoch order. */
  levels: Array<[number, string, string?]>;
}

export interface Tech {
  id: string;
  name: string;
  branch: Branch;
  /** Position in the branch, from 0. */
  level: number;
  epoch: number;
  building: BuildingType;
  cost: Cost;
  time: number;
  requires: string[];
}

const INFANTRY: Role[] = ['assault', 'pike'];
const FOOT: Role[] = ['assault', 'pike', 'ranged'];
const SHIPS: Role[] = ['fisher', 'transport', 'warship', 'bombard'];
const AIRCRAFT: Role[] = ['balloon', 'fighter', 'bomber'];
const PLANES: Role[] = ['fighter', 'bomber'];
const ALL_UNITS: Role[] = [
  'citizen',
  'scout',
  'assault',
  'pike',
  'ranged',
  'mounted',
  'siege',
  'strategist',
  'warrior',
  'priest',
  'prophet',
  ...SHIPS,
  ...AIRCRAFT,
];

export const BRANCHES: Branch[] = [
  // ------------------------------------------------------------ Schmiede
  {
    id: 'infwaffen',
    name: 'Infanteriewaffen',
    building: 'smithy',
    glyph: 'sword',
    text: 'Sturm- und Abwehrinfanterie +6 % Schaden',
    effects: [{ kind: 'unit', roles: INFANTRY, dmg: 1.06 }],
    base: { food: 50, iron: 40 },
    levels: [
      [0, 'Feuersteinklingen'],
      [2, 'Kupferguss'],
      [3, 'Bronzeklingen'],
      [4, 'Eisenschmieden'],
      [7, 'Stahlhärtung'],
      [9, 'Damaszener Stahl'],
      [11, 'Gezogene Läufe', 'fernwaffen-6'],
      [13, 'Maschinenpistolen'],
      [15, 'Verbundwerkstoffe'],
      [16, 'Nanoklingen'],
    ],
  },
  {
    id: 'fernwaffen',
    name: 'Fernwaffen',
    building: 'smithy',
    glyph: 'bow',
    text: 'Fernkampf +5 % Schaden, +0,15 Reichweite',
    effects: [{ kind: 'unit', roles: ['ranged'], dmg: 1.05, range: 0.15 }],
    base: { wood: 60, gold: 30 },
    levels: [
      [0, 'Wurfholz'],
      [2, 'Sehnenbogen'],
      [4, 'Kompositbogen'],
      [6, 'Eisenspitzen'],
      [8, 'Eibenholz'],
      [9, 'Luntenschloss', 'geschuetz-3'],
      [10, 'Steinschloss'],
      [12, 'Hinterlader'],
      [14, 'Zielfernrohr'],
      [16, 'Fokuslinsen'],
    ],
  },
  {
    id: 'ruestung',
    name: 'Infanterierüstung',
    building: 'smithy',
    glyph: 'shield',
    text: 'Fußtruppen +0,3 Rüstung, +3 % Lebenspunkte',
    effects: [{ kind: 'unit', roles: FOOT, armor: 0.3, hp: 1.03 }],
    base: { food: 40, iron: 50 },
    levels: [
      [1, 'Lederwams'],
      [3, 'Bronzeschild'],
      [5, 'Kettenhemd'],
      [7, 'Plattenpanzer'],
      [9, 'Kürass'],
      [13, 'Stahlhelm'],
      [14, 'Splitterschutz'],
      [15, 'Kevlarweste'],
      [17, 'Exoskelett'],
    ],
  },
  {
    id: 'reiter',
    name: 'Reiterharnisch',
    building: 'smithy',
    glyph: 'horse',
    text: 'Kavallerie und Fahrzeuge +5 % Schaden, +0,3 Rüstung',
    effects: [{ kind: 'unit', roles: ['mounted'], dmg: 1.05, armor: 0.3 }],
    base: { food: 60, iron: 50 },
    levels: [
      [3, 'Bronzebeschläge'],
      [5, 'Steigbügel'],
      [6, 'Rossharnisch'],
      [7, 'Lanzenstahl'],
      [10, 'Säbelschmiede'],
      [12, 'Panzerstahl'],
      [13, 'Verbundpanzerung'],
      [15, 'Reaktivpanzerung'],
      [16, 'Plasmaschilde'],
    ],
  },
  // ------------------------------------------------------------ Akademie
  {
    id: 'baukunst',
    name: 'Baukunst',
    building: 'academy',
    glyph: 'hammer',
    text: 'Bürger bauen 12 % schneller',
    effects: [{ kind: 'build', mul: 1.12 }],
    base: { wood: 80, stone: 40 },
    levels: [
      [1, 'Lehmziegel'],
      [3, 'Mörtel'],
      [5, 'Gewölbe'],
      [8, 'Gerüstbau'],
      [11, 'Dampfkran'],
      [13, 'Fertigteile'],
      [16, 'Baudrohnen'],
    ],
  },
  {
    id: 'mauerwerk',
    name: 'Mauerwerk',
    building: 'academy',
    glyph: 'wall',
    text: 'Gebäude +8 % Lebenspunkte, Mauern und Tore weitere +15 %',
    effects: [
      { kind: 'buildingHp', types: 'all', mul: 1.08 },
      { kind: 'buildingHp', types: ['wall', 'gate'], mul: 1.15 },
    ],
    base: { stone: 80, wood: 30 },
    levels: [
      [1, 'Trockenmauer'],
      [4, 'Quaderbau'],
      [7, 'Zinnenbau'],
      [9, 'Sternschanze'],
      [12, 'Stahlbeton'],
      [14, 'Bunkerbau'],
      [16, 'Nanokeramik'],
    ],
  },
  {
    id: 'mathematik',
    name: 'Mathematik',
    building: 'academy',
    glyph: 'angle',
    text: 'Türme und Dorfzentren +8 % Schaden, +0,25 Reichweite',
    effects: [{ kind: 'tower', dmg: 1.08, range: 0.25 }],
    base: { gold: 60, stone: 30 },
    levels: [
      [2, 'Zählkunst'],
      [4, 'Geometrie'],
      [6, 'Algebra'],
      [9, 'Ballistik', 'schrift-3'],
      [12, 'Feuerleitung'],
      [14, 'Radar'],
      [16, 'Zielrechner'],
    ],
  },
  {
    id: 'medizin',
    name: 'Medizin',
    building: 'academy',
    glyph: 'cross',
    text: 'Verwundete Einheiten heilen sich außerhalb des Kampfes (+0,15 LP/s)',
    effects: [{ kind: 'regen', add: 0.15 }],
    base: { food: 80, gold: 30 },
    levels: [
      [1, 'Heilkräuter'],
      [5, 'Wundversorgung'],
      [8, 'Feldscher'],
      [11, 'Impfung'],
      [13, 'Antibiotika'],
      [15, 'Gentherapie'],
      [17, 'Nanomedizin'],
    ],
  },
  {
    id: 'schrift',
    name: 'Schrift',
    building: 'academy',
    glyph: 'book',
    text: 'Forschung und Epochenaufstieg 10 % schneller',
    effects: [{ kind: 'research', mul: 1.1 }],
    base: { food: 50, gold: 50 },
    levels: [
      [1, 'Bilderschrift'],
      [3, 'Keilschrift'],
      [5, 'Alphabet'],
      [9, 'Buchdruck'],
      [12, 'Telegrafie'],
      [14, 'Computer'],
      [16, 'Quantenrechner'],
    ],
  },
  {
    id: 'kartografie',
    name: 'Kartografie',
    building: 'academy',
    glyph: 'eye',
    text: 'Alle Einheiten +0,5 Sichtweite',
    effects: [{ kind: 'unit', roles: ALL_UNITS, sight: 0.5 }],
    base: { wood: 40, gold: 50 },
    levels: [
      [2, 'Sternkunde'],
      [6, 'Kompass'],
      [9, 'Kartografie'],
      [10, 'Fernrohr'],
      [13, 'Luftaufklärung'],
      [15, 'Satelliten', 'geschuetz-6'],
    ],
  },
  {
    id: 'staatskunst',
    name: 'Staatskunst',
    building: 'academy',
    glyph: 'crown',
    text: 'Alle Gebäude bilden 6 % schneller aus',
    effects: [{ kind: 'train', mul: 1.06 }],
    base: { food: 70, gold: 40 },
    levels: [
      [3, 'Gesetzestafeln'],
      [5, 'Verwaltung'],
      [7, 'Lehnswesen'],
      [10, 'Wehrpflicht'],
      [12, 'Massenfertigung'],
      [14, 'Logistik'],
      [17, 'Klonfabriken'],
    ],
  },
  // --------------------------------------------------------- Dorfzentrum
  {
    id: 'werkzeuge',
    name: 'Werkzeuge',
    building: 'towncenter',
    glyph: 'pick',
    text: 'Bürger sammeln alle Rohstoffe 6 % schneller',
    effects: [{ kind: 'gather', res: ['food', 'wood', 'stone', 'gold', 'iron'], mul: 1.06 }],
    base: { wood: 70, food: 30 },
    levels: [
      [0, 'Grabstock'],
      [2, 'Kupferwerkzeug'],
      [4, 'Eisenwerkzeug'],
      [8, 'Stahlwerkzeug'],
      [12, 'Maschinenwerkzeug'],
      [15, 'Robotik', 'schrift-5'],
    ],
  },
  {
    id: 'tragen',
    name: 'Tragekunst',
    building: 'towncenter',
    glyph: 'basket',
    text: 'Bürger tragen 2 Einheiten mehr',
    effects: [{ kind: 'carry', add: 2 }],
    base: { wood: 60, food: 20 },
    levels: [
      [0, 'Tragekorb'],
      [3, 'Rad'],
      [7, 'Schubkarre'],
      [11, 'Handkarren'],
      [13, 'Lastwagen', 'zucht-3'],
      [16, 'Antigravträger'],
    ],
  },
  {
    id: 'buergerwehr',
    name: 'Bürgerwehr',
    building: 'towncenter',
    glyph: 'people',
    text: 'Bürger +15 % Lebenspunkte und Schaden, +0,5 Rüstung',
    effects: [{ kind: 'unit', roles: ['citizen'], hp: 1.15, dmg: 1.15, armor: 0.5 }],
    base: { food: 60, wood: 40 },
    levels: [
      [1, 'Dorfwache'],
      [6, 'Landwehr'],
      [10, 'Bürgerwehr'],
      [14, 'Zivilschutz'],
    ],
  },
  // ------------------------------------------------------------- Kaserne
  {
    id: 'drill',
    name: 'Drill',
    building: 'barracks',
    glyph: 'helmet',
    text: 'Fußtruppen +6 % Lebenspunkte',
    effects: [{ kind: 'unit', roles: FOOT, hp: 1.06 }],
    base: { food: 70, gold: 20 },
    levels: [
      [0, 'Kriegstanz'],
      [3, 'Phalanxdrill'],
      [5, 'Legionsdrill'],
      [9, 'Exerzierreglement'],
      [12, 'Grundausbildung'],
      [15, 'Spezialausbildung'],
    ],
  },
  {
    id: 'marsch',
    name: 'Gewaltmarsch',
    building: 'barracks',
    glyph: 'boot',
    text: 'Fußtruppen 5 % schneller',
    effects: [{ kind: 'unit', roles: FOOT, speed: 1.05 }],
    base: { food: 60, wood: 30 },
    levels: [
      [2, 'Läuferpfade'],
      [5, 'Römerstraßen'],
      [10, 'Marschordnung'],
      [13, 'Motorisierung', 'zucht-3'],
      [16, 'Sprunganzüge'],
    ],
  },
  // --------------------------------------------------------------- Stall
  {
    id: 'zucht',
    name: 'Zucht und Antrieb',
    building: 'stable',
    glyph: 'horseshoe',
    text: 'Kavallerie und Fahrzeuge +6 % Lebenspunkte',
    effects: [{ kind: 'unit', roles: ['mounted'], hp: 1.06 }],
    base: { food: 80, gold: 30 },
    levels: [
      [3, 'Pferdezucht'],
      [6, 'Schlachtrösser'],
      [9, 'Remonte'],
      [12, 'Verbrennungsmotor', 'bergbau-4'],
      [14, 'Gasturbine'],
      [16, 'Fusionsantrieb'],
    ],
  },
  {
    id: 'tempo',
    name: 'Beweglichkeit',
    building: 'stable',
    glyph: 'wheel',
    text: 'Kavallerie, Fahrzeuge und Späher 5 % schneller',
    effects: [{ kind: 'unit', roles: ['mounted', 'scout'], speed: 1.05 }],
    base: { wood: 50, gold: 40 },
    levels: [
      [4, 'Leichte Wagen'],
      [7, 'Hufbeschlag'],
      [11, 'Leichte Reiterei'],
      [13, 'Kettenlaufwerk'],
      [15, 'Hybridantrieb'],
    ],
  },
  // ------------------------------------------------------------ Werkstatt
  {
    id: 'geschuetz',
    name: 'Geschützbau',
    building: 'workshop',
    glyph: 'cannon',
    text: 'Belagerung und Artillerie +7 % Schaden',
    effects: [{ kind: 'unit', roles: ['siege'], dmg: 1.07 }],
    base: { wood: 60, iron: 50 },
    levels: [
      [2, 'Holzverbindungen'],
      [5, 'Torsionsfedern'],
      [7, 'Gegengewicht'],
      [9, 'Schwarzpulver'],
      [10, 'Bronzeguss'],
      [12, 'Rücklaufbremse'],
      [14, 'Raketentechnik'],
      [16, 'Ionentechnik'],
    ],
  },
  {
    id: 'zielkunst',
    name: 'Zielkunst',
    building: 'workshop',
    glyph: 'crosshair',
    text: 'Belagerung und Artillerie +0,4 Reichweite',
    effects: [{ kind: 'unit', roles: ['siege'], range: 0.4 }],
    base: { wood: 50, gold: 50 },
    levels: [
      [6, 'Spannwerk'],
      [9, 'Richtaufsatz'],
      [12, 'Gezogene Rohre'],
      [14, 'Lenkflugkörper', 'mathematik-5'],
      [17, 'Orbitale Zielerfassung'],
    ],
  },
  // ---------------------------------------------------------------- Turm
  {
    id: 'wachdienst',
    name: 'Wachdienst',
    building: 'tower',
    glyph: 'tower',
    text: 'Türme und Dorfzentren +10 % Schaden',
    effects: [{ kind: 'tower', dmg: 1.1 }],
    base: { wood: 40, stone: 60 },
    levels: [
      [2, 'Wachfeuer'],
      [7, 'Pechnasen'],
      [10, 'Kasematten'],
      [13, 'MG-Nest'],
      [15, 'Raketenabwehr'],
    ],
  },
  {
    id: 'flugabwehr',
    name: 'Flugabwehr',
    building: 'tower',
    glyph: 'crosshair',
    text: 'Türme und Abwehrinfanterie +12 % Schaden gegen Flugzeuge',
    effects: [{ kind: 'antiAir', mul: 1.12 }],
    base: { wood: 50, iron: 60 },
    levels: [
      [13, 'Flakgeschütze'],
      [14, 'Radarleitung'],
      [15, 'Fla-Raketen'],
      [16, 'Laserabwehr'],
      [17, 'Abfangsatelliten'],
    ],
  },
  // --------------------------------------------------------------- Lager
  {
    id: 'holz',
    name: 'Holzwirtschaft',
    building: 'storehouse',
    glyph: 'axe',
    text: 'Holz wird 10 % schneller gesammelt',
    effects: [{ kind: 'gather', res: ['wood'], mul: 1.1 }],
    base: { wood: 50, food: 40 },
    levels: [
      [0, 'Steinaxt'],
      [3, 'Bronzeaxt'],
      [6, 'Zugsäge'],
      [9, 'Sägemühle'],
      [12, 'Dampfsäge'],
      [14, 'Kettensäge'],
      [16, 'Holzernter'],
    ],
  },
  {
    id: 'bergbau',
    name: 'Bergbau',
    building: 'storehouse',
    glyph: 'ore',
    text: 'Stein, Gold und Eisen werden 10 % schneller gesammelt',
    effects: [{ kind: 'gather', res: ['stone', 'gold', 'iron'], mul: 1.1 }],
    base: { wood: 70, food: 30 },
    levels: [
      [1, 'Schlägel und Eisen'],
      [4, 'Stollenbau'],
      [7, 'Grubenlampe'],
      [10, 'Sprengpulver'],
      [12, 'Dampfpumpe'],
      [13, 'Pressluftbohrer'],
      [16, 'Asteroidenbergbau'],
    ],
  },
  {
    id: 'ackerbau',
    name: 'Ackerbau',
    building: 'storehouse',
    glyph: 'wheat',
    text: 'Felder bringen 10 % mehr Nahrung',
    effects: [{ kind: 'farm', mul: 1.1 }],
    base: { wood: 60, food: 40 },
    levels: [
      [1, 'Hakenpflug'],
      [4, 'Bewässerung'],
      [6, 'Dreifelderwirtschaft'],
      [8, 'Kummet'],
      [11, 'Fruchtwechsel'],
      [12, 'Kunstdünger'],
      [13, 'Traktoren', 'zucht-3'],
      [15, 'Gentechnik'],
      [17, 'Hydroponik'],
    ],
  },
  // ------------------------------------------------------------ Tempel
  {
    id: 'glaubensschutz',
    name: 'Glaubensschutz',
    building: 'temple',
    glyph: 'shield',
    text: 'Eigene Einheiten zu bekehren dauert 40 % länger',
    effects: [{ kind: 'convertResist', add: 0.4 }],
    base: { food: 60, gold: 60 },
    levels: [
      [1, 'Amulette'],
      [4, 'Ahnenkult'],
      [7, 'Reliquien'],
      [10, 'Bekenntnisschriften'],
      [13, 'Gewissensfreiheit'],
      [16, 'Psi-Abschirmung'],
    ],
  },
  {
    id: 'heilkunst',
    name: 'Heilkunst',
    building: 'temple',
    glyph: 'cross',
    text: 'Priester, Stratege und Kathedrale heilen 25 % stärker',
    effects: [{ kind: 'heal', add: 0.25 }],
    base: { food: 70, gold: 40 },
    levels: [
      [1, 'Kräuterkunde'],
      [4, 'Heilbäder'],
      [7, 'Hospitäler'],
      [10, 'Feldlazarette'],
      [13, 'Antibiotika'],
      [16, 'Nanomedizin'],
    ],
  },
  {
    id: 'katastrophenschutz',
    name: 'Katastrophenschutz',
    building: 'temple',
    glyph: 'wall',
    text: 'Katastrophen richten 15 % weniger Schaden an',
    effects: [{ kind: 'calamityResist', add: 0.15 }],
    base: { wood: 60, stone: 60 },
    levels: [
      [2, 'Opfergaben'],
      [5, 'Deiche'],
      [8, 'Brandwachen'],
      [11, 'Quarantäne'],
      [14, 'Zivilschutz'],
      [17, 'Kraftfelder'],
    ],
  },
  {
    id: 'glaubenseifer',
    name: 'Glaubenseifer',
    building: 'temple',
    glyph: 'eye',
    text: 'Priester und Propheten sammeln 20 % schneller Glauben',
    effects: [{ kind: 'faith', add: 0.2 }],
    base: { food: 50, gold: 70 },
    levels: [
      [2, 'Rituale'],
      [5, 'Orakelstätten'],
      [8, 'Pilgerfahrten'],
      [11, 'Missionen'],
      [14, 'Massenmedien'],
      [17, 'Neuronale Netze'],
    ],
  },
  // ------------------------------------------------------------ Hafen
  {
    id: 'schiffbau',
    name: 'Schiffbau',
    building: 'dock',
    glyph: 'anchor',
    text: 'Schiffe +12 % LP und +0,5 Rüstung',
    effects: [{ kind: 'unit', roles: SHIPS, hp: 1.12, armor: 0.5 }],
    base: { wood: 70, gold: 30 },
    levels: [
      [1, 'Kalfatern'],
      [4, 'Kiel'],
      [7, 'Klinkerbau'],
      [10, 'Kupferbeschlag'],
      [13, 'Stahlrumpf'],
      [16, 'Verbundpanzerung'],
    ],
  },
  {
    id: 'fischerei',
    name: 'Fischerei',
    building: 'dock',
    glyph: 'fish',
    text: 'Fischerboote fangen 15 % mehr',
    effects: [{ kind: 'fishing', mul: 1.15 }],
    base: { food: 40, wood: 50 },
    levels: [
      [1, 'Netze'],
      [4, 'Schleppnetz'],
      [7, 'Salzfisch'],
      [10, 'Seekarten'],
      [13, 'Echolot'],
      [16, 'Schwarmortung'],
    ],
  },
  // ------------------------------------------------------------ Flugplatz
  {
    id: 'reichweite',
    name: 'Reichweite',
    building: 'airfield',
    glyph: 'plane',
    text: 'Flugzeuge +15 % Treibstoff – länger in der Luft',
    effects: [{ kind: 'fuel', mul: 1.15 }],
    base: { wood: 60, gold: 50 },
    levels: [
      [13, 'Zusatztanks'],
      [14, 'Luftbetankung'],
      [15, 'Sparsame Triebwerke'],
      [16, 'Brennstoffzellen'],
      [17, 'Fusionsantrieb'],
    ],
  },
  {
    id: 'flugzeugbau',
    name: 'Flugzeugbau',
    building: 'airfield',
    glyph: 'hammer',
    text: 'Flugzeuge und Ballone +10 % LP, +0,5 Rüstung, +4 % Tempo',
    effects: [{ kind: 'unit', roles: AIRCRAFT, hp: 1.1, armor: 0.5, speed: 1.04 }],
    base: { wood: 70, iron: 50 },
    levels: [
      [13, 'Ganzmetallbau'],
      [14, 'Strahltriebwerk'],
      [15, 'Avionik'],
      [16, 'Tarnbeschichtung'],
      [17, 'Antigravitation'],
    ],
  },
  {
    id: 'bordwaffen',
    name: 'Bordwaffen',
    building: 'airfield',
    glyph: 'cannon',
    text: 'Jäger und Bomber +8 % Schaden, Bomber +1 Bombe',
    effects: [
      { kind: 'unit', roles: PLANES, dmg: 1.08 },
      { kind: 'bombs', add: 1 },
    ],
    base: { gold: 50, iron: 60 },
    levels: [
      [13, 'Synchronisierte MGs'],
      [14, 'Bordkanonen'],
      [15, 'Lenkbomben'],
      [16, 'Schwarmmunition'],
      [17, 'Plasmawerfer'],
    ],
  },
];

/** Finished techs of the current epoch a player needs before advancing. */
export const TECHS_FOR_ADVANCE = 2;

function round5(n: number): number {
  return Math.max(5, Math.round(n / 5) * 5);
}

/**
 * Tech prices grow by 30 % of the base per epoch. Gold is not mined before
 * the copper age and iron hardly before the iron age, so early levels pay
 * wood and stone instead.
 */
function techCost(base: Cost, epoch: number): Cost {
  const g = 1 + 0.3 * epoch;
  const out: Cost = {};
  for (const [r, v] of Object.entries(base) as Array<[Res, number]>) {
    let res: Res = r;
    if (res === 'gold' && epoch < 2) res = 'wood';
    if (res === 'iron' && epoch < 4) res = 'stone';
    out[res] = (out[res] ?? 0) + round5(v * g);
  }
  return out;
}

export const TECHS: Tech[] = BRANCHES.flatMap((branch) =>
  branch.levels.map(([epoch, name, extra], level) => ({
    id: `${branch.id}-${level}`,
    name,
    branch,
    level,
    epoch,
    building: branch.building,
    cost: techCost(branch.base, epoch),
    time: 18 + 2 * epoch,
    requires: [...(level > 0 ? [`${branch.id}-${level - 1}`] : []), ...(extra ? [extra] : [])],
  })),
);

export const TECH_BY_ID = new Map(TECHS.map((t) => [t.id, t]));

/** Buildings that research something. */
export const RESEARCH_BUILDINGS: BuildingType[] = [...new Set(BRANCHES.map((b) => b.building))];

export function branchesAt(type: BuildingType): Branch[] {
  return BRANCHES.filter((b) => b.building === type);
}

/** Additive and multiplicative bonuses a player has collected from techs. */
export interface Mods {
  unit: Record<Role, { dmg: number; armor: number; hp: number; speed: number; range: number; sight: number }>;
  gather: Record<Res, number>;
  farm: number;
  carry: number;
  build: number;
  buildingHp: Partial<Record<BuildingType, number>>;
  buildingHpAll: number;
  towerDmg: number;
  towerRange: number;
  research: number;
  train: number;
  regen: number;
  convertResist: number;
  heal: number;
  calamityResist: number;
  faith: number;
  fishing: number;
  fuel: number;
  bombs: number;
  antiAir: number;
}

export function baseMods(): Mods {
  const unit = {} as Mods['unit'];
  for (const r of ALL_UNITS) unit[r] = { dmg: 1, armor: 0, hp: 1, speed: 1, range: 0, sight: 0 };
  return {
    unit,
    gather: { food: 1, wood: 1, stone: 1, gold: 1, iron: 1 },
    farm: 1,
    carry: 0,
    build: 1,
    buildingHp: {},
    buildingHpAll: 1,
    towerDmg: 1,
    towerRange: 0,
    research: 1,
    train: 1,
    regen: 0,
    convertResist: 0,
    heal: 0,
    calamityResist: 0,
    faith: 0,
    fishing: 1,
    fuel: 1,
    bombs: 0,
    antiAir: 1,
  };
}

/** Folds the effects of a set of finished techs into one modifier table. */
export function modsFor(techs: Iterable<string>): Mods {
  const m = baseMods();
  for (const id of techs) {
    const t = TECH_BY_ID.get(id);
    if (!t) continue;
    for (const e of t.branch.effects) {
      switch (e.kind) {
        case 'unit':
          for (const r of e.roles) {
            const u = m.unit[r];
            u.dmg *= e.dmg ?? 1;
            u.hp *= e.hp ?? 1;
            u.speed *= e.speed ?? 1;
            u.armor += e.armor ?? 0;
            u.range += e.range ?? 0;
            u.sight += e.sight ?? 0;
          }
          break;
        case 'gather':
          for (const r of e.res) m.gather[r] *= e.mul;
          break;
        case 'farm':
          m.farm *= e.mul;
          break;
        case 'carry':
          m.carry += e.add;
          break;
        case 'build':
          m.build *= e.mul;
          break;
        case 'buildingHp':
          if (e.types === 'all') m.buildingHpAll *= e.mul;
          else for (const ty of e.types) m.buildingHp[ty] = (m.buildingHp[ty] ?? 1) * e.mul;
          break;
        case 'tower':
          m.towerDmg *= e.dmg ?? 1;
          m.towerRange += e.range ?? 0;
          break;
        case 'research':
          m.research *= e.mul;
          break;
        case 'train':
          m.train *= e.mul;
          break;
        case 'regen':
          m.regen += e.add;
          break;
        case 'convertResist':
          m.convertResist += e.add;
          break;
        case 'heal':
          m.heal += e.add;
          break;
        case 'calamityResist':
          m.calamityResist = Math.min(0.75, m.calamityResist + e.add);
          break;
        case 'faith':
          m.faith += e.add;
          break;
        case 'fishing':
          m.fishing *= e.mul;
          break;
        case 'fuel':
          m.fuel *= e.mul;
          break;
        case 'bombs':
          m.bombs += e.add;
          break;
        case 'antiAir':
          m.antiAir *= e.mul;
          break;
      }
    }
  }
  return m;
}
