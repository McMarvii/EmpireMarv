import type { Role } from './units';

export type TargetClass = Role | 'building';

/**
 * Damage multipliers (attacker role → target class). The core loop is
 * assault > pike > mounted > ranged > assault, with siege as the answer
 * to buildings. Values below 1 mark a bad matchup.
 */
export const DAMAGE_MULTIPLIER: Record<Role | 'tower', Partial<Record<TargetClass, number>>> = {
  citizen: { building: 0.4 },
  scout: { building: 0.2 },
  assault: { pike: 1.6, siege: 1.6, mounted: 0.7, citizen: 1.2, building: 0.5 },
  pike: { mounted: 2.2, assault: 0.7, building: 0.4, fighter: 1.6, bomber: 1.8, balloon: 1.5 },
  ranged: { assault: 1.6, pike: 1.3, mounted: 0.6, siege: 0.8, building: 0.25, warship: 0.8, bombard: 0.8, balloon: 1.3 },
  mounted: { ranged: 1.8, siege: 1.8, citizen: 1.3, pike: 0.55, building: 0.6, priest: 1.6, prophet: 1.6 },
  siege: { building: 4, assault: 0.6, pike: 0.6, ranged: 0.6, mounted: 0.5, citizen: 0.6, siege: 1, warship: 1.2, bombard: 1.2, transport: 1.2 },
  strategist: { building: 0.4 },
  warrior: { assault: 1.25, pike: 1.25, ranged: 1.25, mounted: 1.1, siege: 1.3, citizen: 1.2, building: 0.6 },
  // The faithful do not fight; their weapons are faith and calamities.
  priest: {},
  prophet: {},
  // At sea: warships hunt ships, bombard ships shell the coast and are prey for warships.
  fisher: {},
  transport: {},
  warship: { fisher: 1.5, transport: 1.6, warship: 1.2, bombard: 1.8, building: 0.3 },
  bombard: { building: 3, warship: 0.5, fisher: 0.8, transport: 0.8, citizen: 0.8, assault: 0.8, pike: 0.8, ranged: 0.8, mounted: 0.8 },
  tower: { siege: 1.3, mounted: 0.9, fisher: 1.2, transport: 1.2, warship: 1.2, bombard: 1.3, fighter: 1.4, bomber: 1.6, balloon: 1.5 },
  // In the air: fighters rule the sky but barely scratch the ground, bombers level what stands still.
  balloon: {},
  fighter: { fighter: 1.2, bomber: 1.8, balloon: 2, building: 0.15 },
  bomber: { building: 2.5, siege: 1.2, mounted: 1.2, fisher: 1.2, transport: 1.2, warship: 1.2, bombard: 1.2 },
};

/** For targets without an entry of their own; missing means 1. */
const DEFAULT_MULTIPLIER: Partial<Record<Role | 'tower', number>> = { fighter: 0.4 };

export function damageMultiplier(attacker: Role | 'tower', target: TargetClass): number {
  return DAMAGE_MULTIPLIER[attacker][target] ?? DEFAULT_MULTIPLIER[attacker] ?? 1;
}

/** Flat armor, but every hit lands at least 15 % of its raw damage. */
export function applyArmor(raw: number, armor: number): number {
  return Math.max(raw * 0.15, raw - armor);
}
