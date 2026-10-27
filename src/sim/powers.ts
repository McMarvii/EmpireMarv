import {
  ABILITY_BY_ID,
  CALAMITY_DAMAGE,
  FIELDHEAL_SHARE,
  HAZARD_TIME,
  HERO_REGEN,
  STATUS_TIME,
  STRATEGIST_AURA,
  STRATEGIST_HEAL,
  STRATEGIST_MORALE,
  WARRIOR_AURA,
  WHIRLWIND_DMG,
  type AbilityId,
} from '../data/abilities';
import { FAITH_REGEN, isHero, MAX_FAITH } from '../data/units';
import { WONDER_HEAL } from '../data/wonders';
import { applyDamage, harm } from './combat';
import { AURA_INSPIRED, AURA_LED, rectOf, type Hazard, type Unit } from './entities';
import { hypot } from './fmath';
import { distToRect } from './pathfinding';
import { attackBoost, give, hasStatus } from './status';
import { DT, TICK_RATE, type World } from './world';

/**
 * Hero auras and abilities, faith, timed states and calamities. Everything
 * here is part of the deterministic simulation.
 */

/** Healing strength of a player: Heilkunst techs. */
export function healFactor(w: World, owner: number): number {
  return 1 + w.players[owner].mods.heal;
}

/**
 * Per tick for every unit: faith, healing from auras, heroes and the
 * cathedral, and the plague. Returns false while the unit is stunned.
 */
export function tickPowers(w: World, u: Unit): boolean {
  const max = MAX_FAITH[u.role];
  if (max !== undefined && u.faith < max) {
    u.faith = Math.min(max, u.faith + (FAITH_REGEN[u.role] ?? 0) * (1 + w.players[u.owner].mods.faith) * DT);
  }
  if (u.hp < u.maxHp) {
    let share = 0;
    if (u.aura & AURA_LED) share += STRATEGIST_HEAL;
    if (isHero(u.role) && w.tick - u.lastHitTick > 5 * TICK_RATE) share += HERO_REGEN;
    if (w.wonderEffect(u.owner, 'heal')) share += WONDER_HEAL;
    if (share > 0) u.hp = Math.min(u.maxHp, u.hp + u.maxHp * share * healFactor(w, u.owner) * DT);
  }
  if (hasStatus(w, u, 'plague')) {
    const resist = w.players[u.owner].mods.calamityResist;
    const perTick = (u.maxHp * CALAMITY_DAMAGE.plague.units) / (STATUS_TIME.plague * TICK_RATE);
    harm(w, u, perTick * (1 - resist), u.plagueBy);
    if (u.dead) return false;
  }
  return !hasStatus(w, u, 'stun');
}

/** Once a second: who stands near the own strategist or warrior. */
export function updateAuras(w: World): void {
  for (const h of w.units) {
    if (h.dead || !isHero(h.role) || hasStatus(w, h, 'stun')) continue;
    const led = h.role === 'strategist';
    const r = led ? STRATEGIST_AURA : WARRIOR_AURA;
    w.forUnitsNear(h.x, h.y, r, (o) => {
      if (o === h || o.dead || w.areEnemies(o.owner, h.owner) || hypot(o.x - h.x, o.y - h.y) > r) return;
      if (led) {
        if (o.aura & AURA_LED) return;
        o.aura |= AURA_LED;
        o.morale += STRATEGIST_MORALE;
      } else {
        o.aura |= AURA_INSPIRED;
      }
    });
  }
}

/** Whether a unit could use an ability right now. */
export function abilityReady(w: World, u: Unit, id: AbilityId): boolean {
  const a = ABILITY_BY_ID.get(id);
  if (!a || a.role !== u.role || u.dead || hasStatus(w, u, 'stun')) return false;
  if (w.players[u.owner].epoch < a.minEpoch) return false;
  if (a.faith > 0) return u.faith >= a.faith;
  return (u.ready[id] ?? 0) <= w.tick;
}

/** Hero abilities: take effect at once around the hero. */
export function useAbility(w: World, u: Unit, id: AbilityId): boolean {
  const a = ABILITY_BY_ID.get(id)!;
  if (a.target !== 'self' || !abilityReady(w, u, id)) return false;
  u.ready[id] = w.tick + Math.round(a.cooldown * TICK_RATE);
  const allies = (fn: (o: Unit) => void) =>
    w.forUnitsNear(u.x, u.y, a.radius, (o) => {
      if (!o.dead && !w.areEnemies(o.owner, u.owner) && hypot(o.x - u.x, o.y - u.y) <= a.radius) fn(o);
    });
  const enemies = (fn: (o: Unit) => void) =>
    w.forUnitsNear(u.x, u.y, a.radius, (o) => {
      if (!o.dead && w.areEnemies(o.owner, u.owner) && hypot(o.x - u.x, o.y - u.y) <= a.radius) fn(o);
    });
  switch (id) {
    case 'rally':
      allies((o) => give(w, o, 'haste', STATUS_TIME.rally));
      break;
    case 'shieldwall':
      allies((o) => give(w, o, 'shield', STATUS_TIME.shieldwall));
      break;
    case 'fieldheal': {
      const k = FIELDHEAL_SHARE * healFactor(w, u.owner);
      allies((o) => {
        o.hp = Math.min(o.maxHp, o.hp + o.maxHp * k);
        delete o.status.plague;
      });
      break;
    }
    case 'warcry':
      enemies((o) => give(w, o, 'stun', STATUS_TIME.warcry));
      break;
    case 'whirlwind': {
      const dmg = u.stats.dmg * WHIRLWIND_DMG * attackBoost(w, u);
      const hit: Unit[] = [];
      enemies((o) => hit.push(o));
      for (const o of hit) applyDamage(w, o, dmg, u.role, u.owner, u.id);
      u.attackAnim = 0.35;
      break;
    }
    case 'frenzy':
      give(w, u, 'frenzy', STATUS_TIME.frenzy);
      break;
    default:
      return false;
  }
  w.effects.push({ kind: 'ring', x: u.x, y: u.y, t: 0, dur: 0.8, size: Math.max(1.5, a.radius), ability: id });
  w.cue({ kind: 'ability', x: u.x, y: u.y, owner: u.owner, epoch: u.stats.epoch, ability: id });
  return true;
}

/** Prophet in range: the calamity starts, the faith is spent. */
export function castCalamity(w: World, u: Unit, id: AbilityId, x: number, y: number): boolean {
  const a = ABILITY_BY_ID.get(id)!;
  if (a.target !== 'ground' || !abilityReady(w, u, id)) return false;
  u.faith -= a.faith;
  const kind = id as Hazard['kind'];
  w.addHazard(kind, x, y, a.radius, u.owner, HAZARD_TIME[kind]);
  w.cue({ kind: 'calamity', x, y, owner: u.owner, epoch: u.stats.epoch, ability: id });
  u.attackAnim = 0.35;
  return true;
}

/** Town centres take calamities only half as hard; wonders not at all. */
const BUILDING_CALAMITY: Partial<Record<string, number>> = { towncenter: 0.5, wonder: 0 };

/**
 * Every tick: calamities wear down the enemies of whoever called them.
 * Two calamities of one kind on the same spot do not add up.
 */
export function updateHazards(w: World): void {
  const done = new Set<string>();
  const once = (kind: string, id: number) => {
    const key = `${kind}:${id}`;
    if (done.has(key)) return false;
    done.add(key);
    return true;
  };
  for (const hz of w.hazards) {
    if (hz.until <= w.tick) continue;
    const ticks = (hz.until - hz.start) || 1;
    const share = CALAMITY_DAMAGE[hz.kind];
    const hitUnits: Unit[] = [];
    w.forUnitsNear(hz.x, hz.y, hz.r, (o) => {
      if (!o.dead && w.areEnemies(hz.owner, o.owner) && hypot(o.x - hz.x, o.y - hz.y) <= hz.r) hitUnits.push(o);
    });
    for (const o of hitUnits) {
      if (o.dead || !once(hz.kind, o.id)) continue;
      const resist = w.players[o.owner].mods.calamityResist;
      if (hz.kind === 'plague') {
        // Catching the plague once is enough; the illness does the rest.
        if (!hasStatus(w, o, 'plague')) {
          give(w, o, 'plague', STATUS_TIME.plague);
          o.plagueBy = hz.owner;
        }
        continue;
      }
      if (hz.kind === 'storm') give(w, o, 'slow', 0.5);
      harm(w, o, ((o.maxHp * share.units) / ticks) * (1 - resist), hz.owner);
    }
    if (share.buildings > 0) {
      for (const b of w.buildings) {
        if (b.dead || !w.areEnemies(hz.owner, b.owner)) continue;
        if (distToRect(hz.x, hz.y, rectOf(b)) > hz.r || !once(hz.kind, b.id)) continue;
        const resist = w.players[b.owner].mods.calamityResist;
        const k = BUILDING_CALAMITY[b.type] ?? 1;
        harm(w, b, ((b.maxHp * share.buildings * k) / ticks) * (1 - resist), hz.owner);
      }
    }
  }
  w.hazards = w.hazards.filter((hz) => hz.until > w.tick);
}
