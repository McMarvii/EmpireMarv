import { BUILDING_DEFS, buildingName, FARM_CAPACITY } from '../data/buildings';
import { epochLabel, EPOCHS } from '../data/epochs';
import { TECH_BY_ID } from '../data/techs';
import { BUILD_RATE, gatherRate, ROLE_DEFS } from '../data/units';
import { fire } from './combat';
import { rectOf, UNIT_RADIUS, type Building, type Entity, type GatherOrder, type ResourceNode, type Unit } from './entities';
import { distToRect, type PathGoal, type Rect } from './pathfinding';
import { DT, TICK_RATE, type World } from './world';

const WORK_REACH = 1.0;
const APPROACH_REACH = 0.85;
/** How close gatherers stand to a node's edge while working. */
const SNUG_REACH = 0.2;
const SCAN_INTERVAL = 8;

export function setPathTo(w: World, u: Unit, goal: PathGoal): void {
  u.path = w.pathfinder.find(u.x, u.y, goal, undefined, w.teamOf(u.owner));
  u.repathTick = w.tick;
}

/** Distance from a unit to the edge of an entity (0 when touching). */
export function distTo(u: { x: number; y: number }, e: Entity): number {
  if (e.kind === 'unit') return Math.max(0, Math.hypot(e.x - u.x, e.y - u.y) - UNIT_RADIUS);
  return distToRect(u.x, u.y, rectOf(e));
}

/** Whether a unit can walk straight to a point without crossing a blocked tile. */
function straightClear(w: World, u: Unit, tx: number, ty: number): boolean {
  const team = w.teamOf(u.owner);
  const steps = Math.max(1, Math.ceil(Math.hypot(tx - u.x, ty - u.y) / 0.25));
  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    if (!w.map.passableFor(Math.floor(u.x + (tx - u.x) * t), Math.floor(u.y + (ty - u.y) * t), team)) return false;
  }
  return true;
}

/**
 * Plans a route next to a rectangle. When the pathfinder has nothing to do
 * because the unit already stands on a goal tile (but was nudged a little out
 * of reach by crowding), it steps straight towards the rectangle instead.
 */
function approach(w: World, u: Unit, rect: Rect, reach: number): boolean {
  setPathTo(w, u, { kind: 'rect', rect, reach });
  if (u.path.length > 0) return true;
  const px = Math.max(rect.x, Math.min(rect.x + rect.w, u.x));
  const py = Math.max(rect.y, Math.min(rect.y + rect.h, u.y));
  const d = Math.hypot(u.x - px, u.y - py);
  if (d > reach + 1.5) return false;
  if (reach <= 0.3) {
    // Walkable targets (farms): step onto the edge.
    u.path = [{ x: px, y: py }];
    return true;
  }
  const k = d > 1e-6 ? Math.min(reach, 0.5) / d : 0;
  const tx = px + (u.x - px) * k;
  const ty = py + (u.y - py) * k;
  if (!straightClear(w, u, tx, ty)) return false;
  u.path = [{ x: tx, y: ty }];
  return true;
}

function followPath(w: World, u: Unit): void {
  if (u.path.length === 0) {
    u.moving = false;
    return;
  }
  const next = u.path[0];
  // A building placed on the route: drop the path so the order logic re-plans.
  if (!w.map.passableFor(Math.floor(next.x), Math.floor(next.y), w.teamOf(u.owner)) && u.path.length > 1) {
    u.path = [];
    u.repathTick = -1000;
    u.moving = false;
    return;
  }
  const dx = next.x - u.x;
  const dy = next.y - u.y;
  const dist = Math.hypot(dx, dy);
  const step = u.stats.speed * DT;
  u.moving = true;
  if (dist > 1e-6) u.facing = Math.atan2(dy, dx);
  if (dist <= step) {
    u.x = next.x;
    u.y = next.y;
    u.path.shift();
  } else {
    u.x += (dx / dist) * step;
    u.y += (dy / dist) * step;
  }
}

function face(u: Unit, e: Entity): void {
  u.facing = Math.atan2(e.y - u.y, e.x - u.x);
}

function goIdle(u: Unit): void {
  u.order = { kind: 'idle' };
  u.path = [];
}

/** Best enemy within a radius: combat units first, then citizens, then buildings. */
export function findTarget(w: World, owner: number, x: number, y: number, radius: number, siege = false): Entity | null {
  let best: Entity | null = null;
  let bestScore = Infinity;
  w.forUnitsNear(x, y, radius, (o) => {
    if (!w.areEnemies(owner, o.owner) || !w.inSight(owner, o)) return;
    const d = Math.hypot(o.x - x, o.y - y);
    if (d > radius) return;
    const score = d + (o.role === 'citizen' ? 3 : 0) + (siege ? 6 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = o;
    }
  });
  for (const b of w.buildings) {
    if (b.dead || !w.areEnemies(owner, b.owner)) continue;
    const d = distToRect(x, y, rectOf(b));
    if (d > radius || !w.inSight(owner, b)) continue;
    const score = d + (siege ? -2 : 5);
    if (score < bestScore) {
      bestScore = score;
      best = b;
    }
  }
  return best;
}

export function updateUnit(w: World, u: Unit): void {
  u.cooldown = Math.max(0, u.cooldown - DT);
  // Medizin: wounds heal once a unit has been out of combat for a while.
  const regen = w.players[u.owner].mods.regen;
  if (regen > 0 && u.hp < u.maxHp && w.tick - u.lastHitTick > 5 * TICK_RATE) u.hp = Math.min(u.maxHp, u.hp + regen * DT);
  if (u.attackAnim > 0) u.attackAnim = Math.max(0, u.attackAnim - DT);
  switch (u.order.kind) {
    case 'idle':
      updateIdle(w, u);
      break;
    case 'move':
      updateMove(w, u);
      break;
    case 'attack':
      updateAttack(w, u);
      break;
    case 'gather':
      updateGather(w, u);
      break;
    case 'build':
      updateBuild(w, u);
      break;
    case 'deposit':
      updateDeposit(w, u);
      break;
    case 'explore':
      updateExplore(w, u);
      break;
  }
  followPath(w, u);
}

function scanDue(w: World, u: Unit): boolean {
  if (w.tick < u.scanTick) return false;
  u.scanTick = w.tick + SCAN_INTERVAL + (u.id % 4);
  return true;
}

function updateIdle(w: World, u: Unit): void {
  if (u.role === 'citizen' || u.role === 'scout' || !scanDue(w, u)) return;
  const target = findTarget(w, u.owner, u.x, u.y, u.stats.sight, u.role === 'siege');
  if (target) {
    u.order = { kind: 'attack', targetId: target.id, resume: null, leash: { x: u.x, y: u.y } };
  }
}

function updateMove(w: World, u: Unit): void {
  const o = u.order;
  if (o.kind !== 'move') return;
  if (o.attackMove && u.role !== 'citizen' && scanDue(w, u)) {
    const target = findTarget(w, u.owner, u.x, u.y, u.stats.sight, u.role === 'siege');
    if (target) {
      u.order = { kind: 'attack', targetId: target.id, resume: { x: o.x, y: o.y }, leash: null };
      u.path = [];
      return;
    }
  }
  if (u.path.length > 0) return;
  const remaining = Math.hypot(o.x - u.x, o.y - u.y);
  if (remaining > 0.6 && u.repathTick < 0) {
    setPathTo(w, u, { kind: 'point', x: o.x, y: o.y });
    if (u.path.length > 0) return;
  }
  goIdle(u);
}

function endAttack(w: World, u: Unit): void {
  const o = u.order;
  if (o.kind === 'attack' && o.resume) {
    u.order = { kind: 'move', x: o.resume.x, y: o.resume.y, attackMove: true };
    setPathTo(w, u, { kind: 'point', x: o.resume.x, y: o.resume.y });
  } else {
    goIdle(u);
  }
  u.scanTick = w.tick;
}

function updateAttack(w: World, u: Unit): void {
  const o = u.order;
  if (o.kind !== 'attack') return;
  const t = w.get(o.targetId);
  if (!t || t.kind === 'resource' || !w.areEnemies(u.owner, t.owner)) return endAttack(w, u);
  if (t.kind === 'unit' && !w.inSight(u.owner, t)) return endAttack(w, u);
  if (o.leash && Math.hypot(u.x - o.leash.x, u.y - o.leash.y) > u.stats.sight + 6) {
    const back = o.leash;
    u.order = { kind: 'move', x: back.x, y: back.y, attackMove: false };
    setPathTo(w, u, { kind: 'point', x: back.x, y: back.y });
    return;
  }
  const d = distTo(u, t);
  if (d <= u.stats.range) {
    u.path = [];
    face(u, t);
    if (u.cooldown <= 0) {
      fire(w, u, t);
      u.cooldown = u.stats.cooldown;
    }
    return;
  }
  // Chase: re-plan often for moving targets, rarely for buildings.
  const interval = t.kind === 'unit' ? 10 : 40;
  if (u.path.length === 0 || w.tick - u.repathTick >= interval) {
    if (t.kind === 'unit') setPathTo(w, u, { kind: 'point', x: t.x, y: t.y });
    else setPathTo(w, u, { kind: 'rect', rect: rectOf(t), reach: Math.max(APPROACH_REACH, u.stats.range * 0.9) });
    if (u.path.length === 0) {
      // Already on the goal tile but a little short: step straight in.
      const k = (d - u.stats.range * 0.8) / Math.max(d, 1e-6);
      const nx = u.x + (t.x - u.x) * k;
      const ny = u.y + (t.y - u.y) * k;
      if (d <= u.stats.range + 1.5 && straightClear(w, u, nx, ny)) {
        u.path = [{ x: nx, y: ny }];
      } else {
        // Unreachable (e.g. across water) – give up instead of re-planning every tick.
        endAttack(w, u);
      }
    }
  }
}

function updateGather(w: World, u: Unit): void {
  const o = u.order;
  if (o.kind !== 'gather') return;
  const player = w.players[u.owner];

  if (o.phase === 'toDrop') {
    let drop = w.get(o.dropId);
    if (!drop || drop.kind !== 'building' || !drop.built || drop.owner !== u.owner) {
      drop = w.nearestDropoff(u.owner, u.x, u.y) ?? undefined;
      if (!drop) return goIdle(u);
      o.dropId = drop.id;
      u.path = [];
    }
    const d = distTo(u, drop);
    if (d <= WORK_REACH) {
      deliver(w, u);
      o.phase = 'toNode';
      o.snug = false;
      u.path = [];
      u.repathTick = -1000;
      return;
    }
    if (u.path.length === 0 && !approach(w, u, rectOf(drop), APPROACH_REACH)) goIdle(u);
    return;
  }

  let node = w.get(o.targetId);
  const validNode =
    node &&
    (node.kind === 'resource' || (node.kind === 'building' && node.type === 'farm' && node.owner === u.owner && node.built));
  if (!validNode) {
    const next = w.nearestResource(o.res, o.lx, o.ly, 10, u.owner);
    if (next) {
      o.targetId = next.id;
      o.lx = next.x;
      o.ly = next.y;
      o.phase = 'toNode';
      o.snug = false;
      u.path = [];
      u.repathTick = -1000;
      node = next;
    } else {
      if (u.carryAmount > 0) {
        o.phase = 'toDrop';
        o.dropId = 0;
        return;
      }
      return goIdle(u);
    }
  }
  const target = node as Entity;
  const isFarm = target.kind === 'building';
  if (isFarm && o.phase === 'toNode' && w.farmWorkers(target, u) >= FARM_CAPACITY) {
    return goIdle(u);
  }

  if (o.phase === 'toNode') {
    const d = distTo(u, target);
    const inReach = isFarm ? d <= 0.05 : d <= WORK_REACH;
    if (inReach) {
      // Take the last step right up to the node instead of working from a distance.
      if (!isFarm && d > SNUG_REACH + 0.1) {
        if (u.path.length > 0) return;
        if (!o.snug) {
          o.snug = true;
          if (snugUp(w, u, target as Building | ResourceNode)) return;
        }
      }
      o.phase = 'work';
      u.path = [];
    } else if (u.path.length === 0) {
      if (w.tick - u.repathTick < TICK_RATE) return;
      const reached = target.kind !== 'unit' && approach(w, u, rectOf(target), isFarm ? 0.3 : APPROACH_REACH);
      if (!reached) {
        // Node is fenced in by other nodes or buildings: skip it for a while and try another one.
        if (target.kind === 'resource') target.blockedUntil = w.tick + 60 * TICK_RATE;
        const alt = isFarm ? null : w.nearestResource(o.res, u.x, u.y, 12, u.owner, target.id);
        if (alt) {
          o.targetId = alt.id;
          o.lx = alt.x;
          o.ly = alt.y;
          o.snug = false;
        } else {
          goIdle(u);
        }
      }
      return;
    }
  }

  // Working.
  face(u, target);
  if (u.carry !== o.res) {
    u.carry = o.res;
    u.carryAmount = 0;
  }
  const bonus = player.mods.gather[o.res] * (isFarm ? player.mods.farm : 1);
  let amount = gatherRate(player.epoch) * player.gatherBonus * bonus * DT;
  if (target.kind === 'resource') {
    amount = Math.min(amount, target.amount);
    target.amount -= amount;
    target.hp = target.amount;
    if (target.amount <= 0.0001) w.remove(target);
  }
  u.carryAmount += amount;
  if (u.attackAnim <= 0) {
    u.attackAnim = 0.5;
    w.cue({ kind: 'work', x: u.x, y: u.y, owner: u.owner, epoch: player.epoch, work: isFarm ? 'food' : o.res });
  }
  if (u.carryAmount >= w.carryCapacity(u.owner)) {
    o.phase = 'toDrop';
    o.dropId = 0;
    u.path = [];
  }
}

/**
 * Exploring: walk towards the nearest unexplored tile on the edge of the
 * known map, preferring what lies ahead. A new target is picked as soon as
 * the current one comes into sight; targets the unit could not get to are
 * remembered and skipped. Exploring units ignore enemies.
 */
function updateExplore(w: World, u: Unit): void {
  const o = u.order;
  if (o.kind !== 'explore') return;
  const vis = w.players[u.owner].vis;
  const hasTarget = o.tx >= 0;
  const seen = hasTarget && vis[w.map.idx(o.tx, o.ty)] !== 0;
  if (hasTarget && !seen) {
    if (u.path.length > 0) return;
    // Walked as far as possible, but the target is still unknown: give up on it.
    o.skip.push(w.map.idx(o.tx, o.ty));
    if (o.skip.length > 32) o.skip.shift();
  }
  const next = frontierTile(w, u, o.skip);
  if (!next) {
    goIdle(u);
    w.emit({ type: 'info', player: u.owner, text: 'Die Karte ist vollständig erkundet.' });
    return;
  }
  o.tx = next.x;
  o.ty = next.y;
  setPathTo(w, u, { kind: 'point', x: next.x + 0.5, y: next.y + 0.5 });
}

/** Within three tiles of a target the unit already failed to reach (e.g. across a lake). */
function nearSkipped(width: number, x: number, y: number, skip: number[]): boolean {
  for (const i of skip) {
    const sx = i % width;
    if (Math.abs(sx - x) <= 3 && Math.abs((i - sx) / width - y) <= 3) return true;
  }
  return false;
}

/** Unexplored tile next to explored, walkable ground, scored by distance and heading. */
function frontierTile(w: World, u: Unit, skip: number[]): { x: number; y: number } | null {
  const map = w.map;
  const vis = w.players[u.owner].vis;
  const ux = Math.floor(u.x);
  const uy = Math.floor(u.y);
  const fx = Math.cos(u.facing);
  const fy = Math.sin(u.facing);
  let best: { x: number; y: number } | null = null;
  let bestScore = Infinity;
  let foundRing = -1;
  const maxR = Math.max(map.width, map.height);
  for (let r = 1; r <= maxR; r++) {
    if (foundRing >= 0 && r > foundRing + 6) break;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = ux + dx;
        const y = uy + dy;
        if (!map.inBounds(x, y)) continue;
        const i = map.idx(x, y);
        if (vis[i] !== 0 || nearSkipped(map.width, x, y, skip)) continue;
        const edge =
          (map.inBounds(x + 1, y) && vis[i + 1] !== 0 && map.passable(x + 1, y)) ||
          (map.inBounds(x - 1, y) && vis[i - 1] !== 0 && map.passable(x - 1, y)) ||
          (map.inBounds(x, y + 1) && vis[i + map.width] !== 0 && map.passable(x, y + 1)) ||
          (map.inBounds(x, y - 1) && vis[i - map.width] !== 0 && map.passable(x, y - 1));
        if (!edge) continue;
        if (foundRing < 0) foundRing = r;
        const d = Math.hypot(dx, dy);
        // Ground behind the unit counts up to twice as far, so it keeps a heading.
        const score = d * (1.5 - (0.5 * (dx * fx + dy * fy)) / d);
        if (score < bestScore) {
          bestScore = score;
          best = { x, y };
        }
      }
    }
  }
  return best;
}

/** Books a citizen's load into the owner's stock. */
function deliver(w: World, u: Unit): void {
  const player = w.players[u.owner];
  if (u.carry && u.carryAmount > 0) {
    player.stock[u.carry] += u.carryAmount;
    player.stats.gathered[u.carry] += u.carryAmount;
  }
  u.carryAmount = 0;
}

/**
 * Steps a gatherer from the neighbouring tile up to the node's edge. Each
 * worker takes a slightly different spot along that edge (by id), so a crowd
 * at a mine spreads out instead of stacking.
 */
function snugUp(w: World, u: Unit, node: Building | ResourceNode): boolean {
  const r = rectOf(node);
  const px = Math.max(r.x, Math.min(r.x + r.w, u.x));
  const py = Math.max(r.y, Math.min(r.y + r.h, u.y));
  const d = Math.hypot(u.x - px, u.y - py);
  if (d < 1e-6) return false;
  const nx = (u.x - px) / d;
  const ny = (u.y - py) / d;
  const slot = ((u.id % 5) - 2) * 0.35;
  let ex = px;
  let ey = py;
  const sideX = px === r.x || px === r.x + r.w;
  const sideY = py === r.y || py === r.y + r.h;
  if (sideX && !sideY) ey = Math.max(r.y + 0.15, Math.min(r.y + r.h - 0.15, py + slot));
  else if (sideY && !sideX) ex = Math.max(r.x + 0.15, Math.min(r.x + r.w - 0.15, px + slot));
  const tx = ex + nx * SNUG_REACH;
  const ty = ey + ny * SNUG_REACH;
  if (!straightClear(w, u, tx, ty)) return false;
  u.path = [{ x: tx, y: ty }];
  return true;
}

function updateDeposit(w: World, u: Unit): void {
  const o = u.order;
  if (o.kind !== 'deposit') return;
  if (u.carryAmount <= 0) return finishDeposit(u, o.resume);
  let drop = w.get(o.targetId);
  if (!drop || drop.kind !== 'building' || !drop.built || drop.owner !== u.owner || !BUILDING_DEFS[drop.type].dropoff) {
    drop = w.nearestDropoff(u.owner, u.x, u.y) ?? undefined;
    if (!drop) return goIdle(u);
    o.targetId = drop.id;
    u.path = [];
  }
  if (distTo(u, drop) <= WORK_REACH) {
    deliver(w, u);
    return finishDeposit(u, o.resume);
  }
  if (u.path.length === 0 && !approach(w, u, rectOf(drop as Building), APPROACH_REACH)) goIdle(u);
}

function finishDeposit(u: Unit, resume: GatherOrder | null): void {
  if (!resume) return goIdle(u);
  u.order = { ...resume, phase: 'toNode', dropId: 0, snug: false };
  u.path = [];
  u.repathTick = -1000;
}

function updateBuild(w: World, u: Unit): void {
  const o = u.order;
  if (o.kind !== 'build') return;
  const b = w.get(o.targetId);
  if (!b || b.kind !== 'building' || b.owner !== u.owner) return goIdle(u);
  if (b.built && b.hp >= b.maxHp) return afterBuild(w, u, b);
  const d = distTo(u, b);
  const walkable = BUILDING_DEFS[b.type].walkable;
  if (d <= (walkable ? 0.6 : WORK_REACH)) {
    u.path = [];
    face(u, b);
    if (u.attackAnim <= 0) {
      u.attackAnim = 0.5;
      w.cue({ kind: 'work', x: u.x, y: u.y, owner: u.owner, epoch: w.players[u.owner].epoch, work: 'build' });
    }
    const def = BUILDING_DEFS[b.type];
    if (!b.built) {
      const delta = (BUILD_RATE * w.players[u.owner].mods.build * DT) / def.buildTime;
      b.progress = Math.min(1, b.progress + delta);
      b.hp = Math.min(b.maxHp, b.hp + b.maxHp * delta);
      if (b.progress >= 1) completeBuilding(w, b);
    } else {
      // Repairs are free but take twice as long as construction.
      b.hp = Math.min(b.maxHp, b.hp + (b.maxHp * DT) / (def.buildTime * 2));
    }
    return;
  }
  if (u.path.length === 0) {
    if (w.tick - u.repathTick < TICK_RATE) return;
    if (!approach(w, u, rectOf(b), walkable ? 0.3 : APPROACH_REACH)) goIdle(u);
  }
}

function completeBuilding(w: World, b: Building): void {
  b.built = true;
  b.progress = 1;
  w.openGate(b);
  const p = w.players[b.owner];
  p.stats.buildingsBuilt++;
  w.emit({ type: 'built', player: b.owner, text: `${buildingName(b.type, b.epoch)} fertiggestellt.`, x: b.x, y: b.y });
}

/** Builders look for useful follow-up work, like the classic games did. */
function afterBuild(w: World, u: Unit, b: Building): void {
  if (b.type === 'farm' && w.farmWorkers(b, u) < FARM_CAPACITY) {
    u.order = { kind: 'gather', targetId: b.id, res: 'food', phase: 'toNode', dropId: 0, lx: b.x, ly: b.y };
    u.path = [];
    return;
  }
  // The nearest site first, so builders walk a wall line segment by segment.
  let site: Building | null = null;
  let siteD = 8;
  for (const other of w.buildings) {
    if (other.dead || other.built || other.owner !== u.owner) continue;
    const d = Math.hypot(other.x - u.x, other.y - u.y);
    if (d < siteD) {
      siteD = d;
      site = other;
    }
  }
  if (site) {
    u.order = { kind: 'build', targetId: site.id };
    u.path = [];
    return;
  }
  if (BUILDING_DEFS[b.type].dropoff) {
    const n = w.nearestAnyResource(b.x, b.y, 10, u.owner);
    if (n) {
      u.order = { kind: 'gather', targetId: n.id, res: n.res, phase: 'toNode', dropId: 0, lx: n.x, ly: n.y };
      u.path = [];
      return;
    }
  }
  goIdle(u);
}

export function updateBuilding(w: World, b: Building): void {
  if (!b.built) return;
  const player = w.players[b.owner];
  const def = BUILDING_DEFS[b.type];

  if (def.attack) {
    b.cooldown = Math.max(0, b.cooldown - DT);
    const atk = w.buildingAttackFor(b.owner, b.type)!;
    let target = b.targetId ? w.get(b.targetId) : undefined;
    if (target && (target.kind === 'resource' || distTo(b, target) > atk.range + b.size / 2 || !w.inSight(b.owner, target))) {
      target = undefined;
    }
    if (!target && w.tick >= b.scanTick) {
      b.scanTick = w.tick + SCAN_INTERVAL;
      const found = findTarget(w, b.owner, b.x, b.y, atk.range + b.size / 2);
      target = found && found.kind === 'unit' ? found : undefined;
    }
    b.targetId = target ? target.id : 0;
    if (target && b.cooldown <= 0) {
      fire(w, b, target);
      b.cooldown = atk.cooldown;
    }
  }

  if (b.research) {
    b.research.progress += DT * player.mods.research;
    if (b.research.progress >= b.research.total) {
      const epoch = EPOCHS[b.research.targetEpoch];
      player.epoch = epoch.index;
      b.research = null;
      // The whole city moves into the new era: new look, sturdier walls.
      for (const other of w.buildings) {
        if (other.dead || other.owner !== b.owner) continue;
        const ratio = other.hp / other.maxHp;
        other.epoch = epoch.index;
        other.maxHp = w.buildingMaxHpFor(other.owner, other.type, epoch.index);
        other.hp = Math.max(1, ratio * other.maxHp);
      }
      for (const p of w.players) {
        const label = epochLabel(epoch.index);
        const text = p.id === b.owner ? `Neue Epoche erreicht: ${label}!` : `${player.name} hat die Epoche „${label}“ erreicht.`;
        w.emit({ type: 'epoch', player: p.id, text, epoch: epoch.index });
      }
    }
    return;
  }

  if (b.tech) {
    b.tech.progress += DT * player.mods.research;
    if (b.tech.progress >= b.tech.total) {
      const tech = TECH_BY_ID.get(b.tech.id)!;
      b.tech = null;
      w.completeTech(b.owner, tech.id);
      w.emit({ type: 'tech', player: b.owner, text: `Erforscht: ${tech.name} – ${tech.branch.text}.`, tech: tech.id });
    }
  }

  const item = b.queue[0];
  if (!item) {
    b.popBlocked = false;
    return;
  }
  if (w.popCount(b.owner) >= w.popLimit()) {
    if (!b.popBlocked) w.emit({ type: 'warn', player: b.owner, text: 'Bevölkerungslimit erreicht.' });
    b.popBlocked = true;
    return;
  }
  b.popBlocked = false;
  item.progress += DT * player.mods.train;
  if (item.progress < ROLE_DEFS[item.role].trainTime) return;
  const towards = b.rally ?? { x: b.x + b.size, y: b.y + b.size };
  const spot = w.findSpawnPoint(b, towards);
  if (!spot) return;
  b.queue.shift();
  const u = w.spawnUnit(b.owner, item.role, spot.x, spot.y);
  player.stats.unitsTrained++;
  w.emit({ type: 'trained', player: b.owner, text: `${u.stats.name} bereit.` });
  if (b.rally) sendToRally(w, u, b.rally.x, b.rally.y);
}

function sendToRally(w: World, u: Unit, x: number, y: number): void {
  if (u.role === 'citizen') {
    const node = w.resources.find((n) => !n.dead && x >= n.tx && x < n.tx + n.size && y >= n.ty && y < n.ty + n.size);
    if (node) {
      w.issue({ type: 'gather', player: u.owner, ids: [u.id], targetId: node.id });
      return;
    }
  }
  w.issue({ type: 'move', player: u.owner, ids: [u.id], x, y, attackMove: u.role !== 'citizen' && u.role !== 'scout' });
}

/** Light push-apart so groups don't collapse into a single point. */
export function separateUnits(w: World): void {
  const minDist = UNIT_RADIUS * 2;
  for (const u of w.units) {
    if (u.dead) continue;
    const working = (u.order.kind === 'gather' && u.order.phase === 'work') || u.order.kind === 'build';
    if (working) continue;
    let pushX = 0;
    let pushY = 0;
    w.forUnitsNear(u.x, u.y, minDist, (o) => {
      if (o === u) return;
      const dx = u.x - o.x;
      const dy = u.y - o.y;
      const d = Math.hypot(dx, dy);
      if (d >= minDist) return;
      if (d < 1e-4) {
        // Exactly stacked: split deterministically by id.
        pushX += u.id > o.id ? 0.05 : -0.05;
        pushY += u.id > o.id ? 0.03 : -0.03;
        return;
      }
      const f = ((minDist - d) / minDist) * 0.08;
      pushX += (dx / d) * f;
      pushY += (dy / d) * f;
    });
    if (pushX === 0 && pushY === 0) continue;
    const nx = u.x + pushX;
    const ny = u.y + pushY;
    if (w.map.passableFor(Math.floor(nx), Math.floor(ny), w.teamOf(u.owner))) {
      u.x = nx;
      u.y = ny;
    }
  }
}
