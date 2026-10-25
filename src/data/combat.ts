import type { Role } from './units';

export type TargetClass = Role | 'building';

/**
 * Damage multipliers (attacker role → target class). The core loop is
 * assault > pike > mounted > ranged > assault, with siege as the answer
 * to buildings. Values below 1 mark a bad matchup.
 */
export const DAMAGE_MULTIPLIER: Record<Role | 'tower', Partial<Record<TargetClass, number>>> = {
  citizen: { building: 0.4 },
  assault: { pike: 1.6, siege: 1.6, mounted: 0.7, citizen: 1.2, building: 0.5 },
  pike: { mounted: 2.2, assault: 0.7, building: 0.4 },
  ranged: { assault: 1.6, pike: 1.3, mounted: 0.6, siege: 0.8, building: 0.25 },
  mounted: { ranged: 1.8, siege: 1.8, citizen: 1.3, pike: 0.55, building: 0.6 },
  siege: { building: 4, assault: 0.6, pike: 0.6, ranged: 0.6, mounted: 0.5, citizen: 0.6, siege: 1 },
  tower: { siege: 1.3, mounted: 0.9 },
};

export function damageMultiplier(attacker: Role | 'tower', target: TargetClass): number {
  return DAMAGE_MULTIPLIER[attacker][target] ?? 1;
}

/** Flat armor, but every hit lands at least 15 % of its raw damage. */
export function applyArmor(raw: number, armor: number): number {
  return Math.max(raw * 0.15, raw - armor);
}
