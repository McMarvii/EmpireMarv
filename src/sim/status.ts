import { FRENZY_COOLDOWN, FRENZY_DMG, HASTE_SPEED, SHIELD_TAKEN, SLOW_SPEED, WARRIOR_BOOST, type Status } from '../data/abilities';
import { AURA_INSPIRED, type Unit } from './entities';
import { TICK_RATE, type World } from './world';

/** Timed states on units (stunned, hastened, shielded …) and what they change. */

export function hasStatus(w: World, u: Unit, s: Status): boolean {
  return (u.status[s] ?? 0) > w.tick;
}

export function give(w: World, u: Unit, s: Status, seconds: number): void {
  u.status[s] = Math.max(u.status[s] ?? 0, w.tick + Math.round(seconds * TICK_RATE));
}

/** Walking speed with haste and slow applied. */
export function unitSpeed(w: World, u: Unit): number {
  let v = u.stats.speed;
  if (hasStatus(w, u, 'haste')) v *= HASTE_SPEED;
  if (hasStatus(w, u, 'slow')) v *= SLOW_SPEED;
  return v;
}

/** Attack multiplier from the warrior's aura and frenzy. */
export function attackBoost(w: World, u: Unit): number {
  let k = u.aura & AURA_INSPIRED ? WARRIOR_BOOST : 1;
  if (hasStatus(w, u, 'frenzy')) k *= FRENZY_DMG;
  return k;
}

/** Seconds between attacks. */
export function attackCooldown(w: World, u: Unit): number {
  return hasStatus(w, u, 'frenzy') ? u.stats.cooldown * FRENZY_COOLDOWN : u.stats.cooldown;
}

/** Share of incoming damage that lands (Schildwall). */
export function damageTaken(w: World, u: Unit): number {
  return hasStatus(w, u, 'shield') ? SHIELD_TAKEN : 1;
}
