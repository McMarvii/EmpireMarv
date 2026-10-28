import { MORALE_PER_HOUSE } from '../data/buildings';
import { applyArmor, damageMultiplier } from '../data/combat';
import { isFaithful, type Projectile, type Role } from '../data/units';
import { rectOf, type Building, type Entity, type Unit } from './entities';
import { hypot } from './fmath';
import { distToRect } from './pathfinding';
import { attackBoost, damageTaken } from './status';
import { DT, type World } from './world';

const PROJECTILE_SPEED: Record<Projectile, number> = {
  none: 0,
  stone: 10,
  arrow: 14,
  bullet: 40,
  shell: 16,
  boulder: 7,
  laser: 60,
};

/** Area weapons fly to a fixed spot (and can miss movers); the rest home in. */
const HOMING: Record<Projectile, boolean> = {
  none: true,
  stone: true,
  arrow: true,
  bullet: true,
  shell: false,
  boulder: false,
  laser: true,
};

function centerOf(e: Entity): { x: number; y: number } {
  return { x: e.x, y: e.y };
}

/** Starts an attack: melee hits land at once, everything else spawns a projectile. */
export function fire(w: World, attacker: Unit | Building, target: Entity): void {
  let role: Role | 'tower';
  let dmg: number;
  let projectile: Projectile;
  let splash = 0;
  let epoch: number;
  if (attacker.kind === 'unit') {
    role = attacker.role;
    dmg = attacker.stats.dmg * (1 + attacker.morale * MORALE_PER_HOUSE) * attackBoost(w, attacker);
    projectile = attacker.stats.projectile;
    splash = attacker.stats.splash;
    epoch = attacker.stats.epoch;
    attacker.attackAnim = 0.35;
  } else {
    role = 'tower';
    dmg = w.buildingAttackFor(attacker.owner, attacker.type)!.dmg;
    epoch = w.players[attacker.owner].epoch;
    projectile = epoch >= 16 ? 'laser' : epoch >= 9 ? 'bullet' : 'arrow';
  }
  const look = attacker.kind === 'unit' ? attacker.stats.look : undefined;

  if (projectile === 'none') {
    w.cue({ kind: 'melee', x: target.x, y: target.y, owner: attacker.owner, epoch, look });
    applyDamage(w, target, dmg, role, attacker.owner, attacker.id);
    if (splash > 0) splashDamage(w, target.x, target.y, splash, dmg * 0.5, role, attacker.owner, attacker.id, target.id);
    return;
  }
  const from = centerOf(attacker);
  const to = centerOf(target);
  w.cue({ kind: 'shot', x: from.x, y: from.y, owner: attacker.owner, epoch, look, projectile });
  const dist = hypot(to.x - from.x, to.y - from.y);
  w.projectiles.push({
    kind: projectile,
    x0: from.x,
    y0: from.y,
    x1: to.x,
    y1: to.y,
    t: 0,
    dur: Math.max(0.05, dist / PROJECTILE_SPEED[projectile]),
    targetId: target.id,
    homing: HOMING[projectile],
    owner: attacker.owner,
    attackerId: attacker.id,
    attackerRole: role,
    dmg,
    splash,
  });
}

export function updateProjectiles(w: World): void {
  const keep = [];
  for (const p of w.projectiles) {
    p.t += DT;
    const target = w.get(p.targetId);
    if (p.homing && target) {
      p.x1 = target.x;
      p.y1 = target.y;
    }
    if (p.t < p.dur) {
      keep.push(p);
      continue;
    }
    if (p.splash > 0) {
      // Direct hit if the target is still at the impact point (and still an enemy), area damage around it.
      if (target && target.kind !== 'resource' && w.areEnemies(p.owner, target.owner) && hitsPoint(target, p.x1, p.y1, 0.6)) {
        applyDamage(w, target, p.dmg, p.attackerRole, p.owner, p.attackerId);
      }
      splashDamage(w, p.x1, p.y1, p.splash, p.dmg * 0.5, p.attackerRole, p.owner, p.attackerId, p.targetId);
      w.effects.push({ kind: p.kind === 'laser' ? 'laserhit' : 'explosion', x: p.x1, y: p.y1, t: 0, dur: 0.6, size: p.splash });
      w.cue({ kind: 'blast', x: p.x1, y: p.y1, owner: p.owner, projectile: p.kind, size: p.splash });
    } else if (target && target.kind !== 'resource' && w.areEnemies(p.owner, target.owner)) {
      // A unit converted while the shot was in the air is spared.
      w.cue({ kind: 'impact', x: p.x1, y: p.y1, owner: p.owner, projectile: p.kind, size: target.kind === 'building' ? target.size : 0 });
      applyDamage(w, target, p.dmg, p.attackerRole, p.owner, p.attackerId);
      w.effects.push({ kind: p.kind === 'laser' ? 'laserhit' : 'hit', x: p.x1, y: p.y1, t: 0, dur: 0.25, size: 0.3 });
    }
  }
  w.projectiles = keep;
}

function hitsPoint(e: Entity, x: number, y: number, tolerance: number): boolean {
  if (e.kind === 'unit') return hypot(e.x - x, e.y - y) <= tolerance;
  return distToRect(x, y, rectOf(e as Building)) <= tolerance;
}

function splashDamage(
  w: World,
  x: number,
  y: number,
  radius: number,
  dmg: number,
  role: Role | 'tower',
  owner: number,
  attackerId: number,
  skipId: number,
): void {
  w.forUnitsNear(x, y, radius, (u) => {
    if (u.id === skipId || !w.areEnemies(owner, u.owner)) return;
    if (hypot(u.x - x, u.y - y) <= radius) applyDamage(w, u, dmg, role, owner, attackerId);
  });
  for (const b of w.buildings) {
    if (b.dead || b.id === skipId || !w.areEnemies(owner, b.owner)) continue;
    if (distToRect(x, y, rectOf(b)) <= radius * 0.5) applyDamage(w, b, dmg, role, owner, attackerId);
  }
}

export function applyDamage(
  w: World,
  target: Entity,
  raw: number,
  role: Role | 'tower',
  attackerOwner: number,
  attackerId: number,
): void {
  if (target.kind === 'resource' || target.dead || (target.kind === 'unit' && target.inside)) return;
  const cls = target.kind === 'building' ? 'building' : target.role;
  const armor = target.kind === 'unit' ? target.stats.armor : 1 + target.epoch * 0.6;
  const moraleDef = target.kind === 'unit' ? target.morale * MORALE_PER_HOUSE : 0;
  const shield = target.kind === 'unit' ? damageTaken(w, target) : 1;
  const dmg = applyArmor(raw * damageMultiplier(role, cls), armor) * Math.max(0.2, 1 - moraleDef) * shield;
  target.hp -= dmg;
  target.lastHitTick = w.tick;
  w.alertAttack(target.owner, target.x, target.y);

  if (target.kind === 'unit' && target.hp > 0) {
    const attacker = w.get(attackerId);
    // Idle soldiers strike back; workers and the faithful keep doing their thing like in the classics.
    if (attacker && attacker.kind !== 'resource' && target.role !== 'citizen' && !isFaithful(target.role) && target.order.kind === 'idle') {
      target.order = { kind: 'attack', targetId: attacker.id, resume: null, leash: { x: target.x, y: target.y } };
    }
  }
  if (target.hp <= 0) w.kill(target, attackerOwner);
}

/** Damage past armor and morale: calamities and the plague. */
export function harm(w: World, target: Unit | Building, amount: number, attackerOwner: number): void {
  if (target.dead || amount <= 0) return;
  target.hp -= amount;
  target.lastHitTick = w.tick;
  w.alertAttack(target.owner, target.x, target.y);
  if (target.hp <= 0) w.kill(target, attackerOwner);
}
