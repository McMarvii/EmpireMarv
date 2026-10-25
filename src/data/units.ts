import type { Cost, Res } from './resources';
import type { BuildingType } from './buildings';

/**
 * Every combat unit belongs to one of five roles. The role decides its place in
 * the counter system, and each epoch swaps in a new tier of the same role, so
 * the rock-paper-scissors logic stays readable from the stone age to space.
 */
export type CombatRole = 'assault' | 'pike' | 'ranged' | 'mounted' | 'siege';
export type Role = 'citizen' | CombatRole;

export const COMBAT_ROLES: CombatRole[] = ['assault', 'pike', 'ranged', 'mounted', 'siege'];

/** How a tier is drawn; the renderer picks a sprite per look. */
export type Look =
  | 'citizen'
  | 'club'
  | 'sword'
  | 'spear'
  | 'sling'
  | 'bow'
  | 'gun'
  | 'rifle'
  | 'trooper'
  | 'rocketeer'
  | 'laser'
  | 'chariot'
  | 'horse'
  | 'armoredcar'
  | 'tank'
  | 'mech'
  | 'ram'
  | 'catapult'
  | 'trebuchet'
  | 'cannon'
  | 'rocket'
  | 'beam';

export type Projectile = 'none' | 'stone' | 'arrow' | 'bullet' | 'shell' | 'boulder' | 'laser';

export interface UnitTier {
  epoch: number;
  name: string;
  look: Look;
  projectile?: Projectile;
  /** Overrides for ranged mounted units (tanks) or long range guns. */
  range?: number;
}

export interface RoleDef {
  role: Role;
  label: string;
  producedAt: BuildingType;
  hp: number;
  dmg: number;
  armor: number;
  range: number;
  sight: number;
  speed: number;
  cooldown: number;
  splash: number;
  cost: Cost;
  trainTime: number;
  strongVs: string;
  weakVs: string;
  tiers: UnitTier[];
}

export const MELEE_RANGE = 0.9;

export const ROLE_DEFS: Record<Role, RoleDef> = {
  citizen: {
    role: 'citizen',
    label: 'Bürger',
    producedAt: 'towncenter',
    hp: 40,
    dmg: 3,
    armor: 0,
    range: MELEE_RANGE,
    sight: 6,
    speed: 1.7,
    cooldown: 1.5,
    splash: 0,
    cost: { food: 50 },
    trainTime: 12,
    strongVs: '—',
    weakVs: 'Allem',
    tiers: [
      { epoch: 0, name: 'Sammlerin', look: 'citizen' },
      { epoch: 6, name: 'Bauer', look: 'citizen' },
      { epoch: 12, name: 'Arbeiter', look: 'citizen' },
      { epoch: 15, name: 'Techniker', look: 'citizen' },
    ],
  },
  assault: {
    role: 'assault',
    label: 'Sturminfanterie',
    producedAt: 'barracks',
    hp: 70,
    dmg: 8,
    armor: 1,
    range: MELEE_RANGE,
    sight: 6,
    speed: 1.75,
    cooldown: 1.2,
    splash: 0,
    cost: { food: 45, iron: 20 },
    trainTime: 14,
    strongVs: 'Abwehrinfanterie, Belagerung',
    weakVs: 'Fernkampf, Kavallerie',
    tiers: [
      { epoch: 0, name: 'Keulenkrieger', look: 'club' },
      { epoch: 1, name: 'Axtkämpfer', look: 'club' },
      { epoch: 3, name: 'Bronzeschwertkämpfer', look: 'sword' },
      { epoch: 5, name: 'Legionär', look: 'sword' },
      { epoch: 7, name: 'Langschwertkämpfer', look: 'sword' },
      { epoch: 9, name: 'Landsknecht', look: 'sword' },
      { epoch: 11, name: 'Grenadier', look: 'gun', projectile: 'bullet', range: 3 },
      { epoch: 13, name: 'Sturmtruppe', look: 'trooper', projectile: 'bullet', range: 3 },
      { epoch: 15, name: 'Spezialeinheit', look: 'trooper', projectile: 'bullet', range: 3.5 },
      { epoch: 16, name: 'Nano-Soldat', look: 'laser', projectile: 'laser', range: 3.5 },
      { epoch: 17, name: 'Exo-Krieger', look: 'laser', projectile: 'laser', range: 4 },
    ],
  },
  pike: {
    role: 'pike',
    label: 'Abwehrinfanterie',
    producedAt: 'barracks',
    hp: 65,
    dmg: 6,
    armor: 2,
    range: MELEE_RANGE + 0.3,
    sight: 6,
    speed: 1.6,
    cooldown: 1.3,
    splash: 0,
    cost: { food: 40, wood: 25 },
    trainTime: 13,
    strongVs: 'Kavallerie & Fahrzeuge',
    weakVs: 'Sturminfanterie, Fernkampf',
    tiers: [
      { epoch: 0, name: 'Speerträger', look: 'spear' },
      { epoch: 2, name: 'Speerkämpfer', look: 'spear' },
      { epoch: 4, name: 'Hoplit', look: 'spear' },
      { epoch: 6, name: 'Schildwallkrieger', look: 'spear' },
      { epoch: 7, name: 'Pikenier', look: 'spear' },
      { epoch: 8, name: 'Hellebardier', look: 'spear' },
      { epoch: 12, name: 'Panzerbüchsenschütze', look: 'rifle', projectile: 'bullet', range: 4 },
      { epoch: 13, name: 'Panzerabwehrtrupp', look: 'rocketeer', projectile: 'shell', range: 4.5 },
      { epoch: 14, name: 'Bazooka-Trupp', look: 'rocketeer', projectile: 'shell', range: 5 },
      { epoch: 15, name: 'Lenkwaffentrupp', look: 'rocketeer', projectile: 'shell', range: 5.5 },
      { epoch: 16, name: 'Plasma-Lanzer', look: 'laser', projectile: 'laser', range: 5 },
    ],
  },
  ranged: {
    role: 'ranged',
    label: 'Fernkampf',
    producedAt: 'barracks',
    hp: 45,
    dmg: 6,
    armor: 0,
    range: 5,
    sight: 7,
    speed: 1.6,
    cooldown: 1.6,
    splash: 0,
    cost: { wood: 35, gold: 25 },
    trainTime: 14,
    strongVs: 'Sturminfanterie, Abwehrinfanterie',
    weakVs: 'Kavallerie & Fahrzeuge',
    tiers: [
      { epoch: 0, name: 'Steinwerfer', look: 'sling', projectile: 'stone', range: 4 },
      { epoch: 1, name: 'Schleuderer', look: 'sling', projectile: 'stone', range: 4.5 },
      { epoch: 2, name: 'Bogenschütze', look: 'bow', projectile: 'arrow' },
      { epoch: 4, name: 'Kompositbogenschütze', look: 'bow', projectile: 'arrow', range: 5.5 },
      { epoch: 7, name: 'Armbrustschütze', look: 'bow', projectile: 'arrow', range: 5.5 },
      { epoch: 8, name: 'Langbogenschütze', look: 'bow', projectile: 'arrow', range: 6.5 },
      { epoch: 9, name: 'Arkebusier', look: 'gun', projectile: 'bullet', range: 5 },
      { epoch: 10, name: 'Musketier', look: 'gun', projectile: 'bullet', range: 5.5 },
      { epoch: 11, name: 'Füsilier', look: 'gun', projectile: 'bullet', range: 6 },
      { epoch: 12, name: 'Gewehrschütze', look: 'rifle', projectile: 'bullet', range: 6.5 },
      { epoch: 13, name: 'Infanterist', look: 'rifle', projectile: 'bullet', range: 6.5 },
      { epoch: 14, name: 'Sturmgewehrschütze', look: 'trooper', projectile: 'bullet', range: 7 },
      { epoch: 15, name: 'Präzisionsschütze', look: 'trooper', projectile: 'bullet', range: 8 },
      { epoch: 16, name: 'Laserschütze', look: 'laser', projectile: 'laser', range: 8 },
      { epoch: 17, name: 'Plasmaschütze', look: 'laser', projectile: 'laser', range: 8.5 },
    ],
  },
  mounted: {
    role: 'mounted',
    label: 'Kavallerie & Fahrzeuge',
    producedAt: 'stable',
    hp: 120,
    dmg: 9,
    armor: 2,
    range: MELEE_RANGE,
    sight: 8,
    speed: 2.8,
    cooldown: 1.3,
    splash: 0,
    cost: { food: 60, gold: 40, iron: 20 },
    trainTime: 18,
    strongVs: 'Fernkampf, Belagerung, Bürger',
    weakVs: 'Abwehrinfanterie',
    tiers: [
      { epoch: 3, name: 'Streitwagen', look: 'chariot' },
      { epoch: 5, name: 'Reiter', look: 'horse' },
      { epoch: 6, name: 'Panzerreiter', look: 'horse' },
      { epoch: 7, name: 'Ritter', look: 'horse' },
      { epoch: 9, name: 'Kürassier', look: 'horse' },
      { epoch: 10, name: 'Dragoner', look: 'horse' },
      { epoch: 11, name: 'Husar', look: 'horse' },
      { epoch: 12, name: 'Panzerwagen', look: 'armoredcar', projectile: 'bullet', range: 4 },
      { epoch: 13, name: 'Früher Panzer', look: 'tank', projectile: 'shell', range: 5 },
      { epoch: 14, name: 'Kampfpanzer', look: 'tank', projectile: 'shell', range: 6 },
      { epoch: 15, name: 'Moderner Kampfpanzer', look: 'tank', projectile: 'shell', range: 6.5 },
      { epoch: 16, name: 'Kampfmech', look: 'mech', projectile: 'laser', range: 6 },
      { epoch: 17, name: 'Titan-Mech', look: 'mech', projectile: 'laser', range: 7 },
    ],
  },
  siege: {
    role: 'siege',
    label: 'Belagerung & Artillerie',
    producedAt: 'workshop',
    hp: 90,
    dmg: 22,
    armor: 1,
    range: 8,
    sight: 8,
    speed: 1.0,
    cooldown: 4,
    splash: 1.2,
    cost: { wood: 120, iron: 60, gold: 30 },
    trainTime: 25,
    strongVs: 'Gebäude, Gruppen',
    weakVs: 'Kavallerie, Sturminfanterie',
    tiers: [
      { epoch: 2, name: 'Rammbock', look: 'ram', range: MELEE_RANGE, projectile: 'none' },
      { epoch: 5, name: 'Katapult', look: 'catapult', projectile: 'boulder' },
      { epoch: 7, name: 'Trebuchet', look: 'trebuchet', projectile: 'boulder', range: 10 },
      { epoch: 9, name: 'Bombarde', look: 'cannon', projectile: 'shell', range: 8 },
      { epoch: 10, name: 'Kanone', look: 'cannon', projectile: 'shell', range: 8.5 },
      { epoch: 12, name: 'Feldgeschütz', look: 'cannon', projectile: 'shell', range: 9 },
      { epoch: 13, name: 'Haubitze', look: 'cannon', projectile: 'shell', range: 10 },
      { epoch: 14, name: 'Raketenartillerie', look: 'rocket', projectile: 'shell', range: 11 },
      { epoch: 16, name: 'Ionenkanone', look: 'beam', projectile: 'laser', range: 11 },
      { epoch: 17, name: 'Plasmaartillerie', look: 'beam', projectile: 'laser', range: 12 },
    ],
  },
};

export interface UnitStats {
  role: Role;
  tier: number;
  epoch: number;
  name: string;
  look: Look;
  projectile: Projectile;
  hp: number;
  dmg: number;
  armor: number;
  range: number;
  sight: number;
  speed: number;
  cooldown: number;
  splash: number;
  cost: Cost;
  trainTime: number;
}

/** Index of the newest tier of a role available in an epoch, or -1. */
export function bestTier(role: Role, epoch: number): number {
  const tiers = ROLE_DEFS[role].tiers;
  let best = -1;
  for (let i = 0; i < tiers.length; i++) if (tiers[i].epoch <= epoch) best = i;
  return best;
}

function scaleCost(cost: Cost, factor: number): Cost {
  const out: Cost = {};
  for (const [k, v] of Object.entries(cost) as [Res, number][]) out[k] = Math.round((v * factor) / 5) * 5;
  return out;
}

const statsCache = new Map<string, UnitStats>();

/**
 * Stats grow with the epoch a tier belongs to. Combat units gain 22 % per
 * epoch, costs only 12 %, so later armies are stronger but not
 * proportionally more expensive. Gunpowder and engines add a jump on top.
 */
export function unitStats(role: Role, tier: number): UnitStats {
  const key = `${role}:${tier}`;
  const cached = statsCache.get(key);
  if (cached) return cached;
  const def = ROLE_DEFS[role];
  const t = def.tiers[tier];
  const e = t.epoch;
  const isCitizen = role === 'citizen';
  const power = isCitizen ? 1 + 0.05 * e : 1 + 0.22 * e;
  const vehicle = t.look === 'tank' || t.look === 'mech' || t.look === 'armoredcar';
  const stats: UnitStats = {
    role,
    tier,
    epoch: e,
    name: t.name,
    look: t.look,
    projectile: t.projectile ?? 'none',
    hp: Math.round(def.hp * power * (vehicle ? 1.6 : 1)),
    dmg: Math.round(def.dmg * power * 10) / 10,
    armor: Math.round(def.armor * power * (vehicle ? 2 : 1) * 10) / 10,
    range: t.range ?? def.range,
    sight: Math.max(def.sight, (t.range ?? def.range) + 1.5),
    speed: vehicle ? def.speed * 0.9 : def.speed,
    cooldown: def.cooldown,
    splash: def.splash,
    cost: isCitizen ? def.cost : scaleCost(def.cost, 1 + 0.12 * e),
    trainTime: def.trainTime,
  };
  statsCache.set(key, stats);
  return stats;
}

/** Citizens get slightly better tools every epoch. */
export function gatherRate(epoch: number): number {
  return 0.75 * (1 + 0.04 * epoch);
}

export const CARRY_CAPACITY = 10;
export const BUILD_RATE = 1;

export const GATHER_LABEL: Record<Res, string> = {
  food: 'sammelt Nahrung',
  wood: 'fällt Holz',
  stone: 'bricht Stein',
  gold: 'schürft Gold',
  iron: 'schürft Eisen',
};
