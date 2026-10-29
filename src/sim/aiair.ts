import { buildingCost, BUILDING_DEFS, type BuildingType } from '../data/buildings';
import { canAfford } from '../data/resources';
import { ANTI_AIR_EPOCH, bestTier, isAir, unitStats, type AirRole } from '../data/units';
import type { AISnapshot } from './ai';
import type { NavalHost } from './ainaval';
import { canHit } from './combat';
import type { Building, Unit } from './entities';
import { hypot } from './fmath';
import type { Point } from './pathfinding';
import { TICK_RATE, type World } from './world';

/** What the air planner borrows from the computer player it works for. */
export interface AirHost extends NavalHost {
  placeNear(w: World, s: AISnapshot, type: BuildingType, center: Point, builders: Unit[], minR: number, maxR: number): boolean;
}

/** The planner's memory, for saved games. */
interface AirState {
  nextOrders: number;
  nextRaid: number;
  nextBuild: number;
  nextBalloon: number;
  /** Enemy aircraft seen lately (fades slowly), so fighters are not disbanded the moment the sky clears. */
  enemyAir: number;
}

/** Enemy aircraft this close to the base are hunted. */
const DEFENCE_RADIUS = 20;
/** Towers more than this many tiles from a target do not count as its flak. */
const FLAK_RADIUS = 7;

/**
 * The computer player in the air: a balloon over the front from the
 * revolution on, an airfield in the world wars, fighters against enemy
 * planes and bombers raiding what lies within half a tank of fuel – the
 * one way to reach an island without a landing. Refuelling is the
 * simulation's business.
 */
export class AirPlanner {
  private nextOrders = 0;
  private nextRaid = 0;
  /** Next look at building an airfield or flak towers. */
  private nextBuild = 0;
  private nextBalloon = 0;
  private enemyAir = 0;

  constructor(private readonly host: AirHost) {}

  saveState(): AirState {
    return { nextOrders: this.nextOrders, nextRaid: this.nextRaid, nextBuild: this.nextBuild, nextBalloon: this.nextBalloon, enemyAir: this.enemyAir };
  }

  loadState(state: unknown): void {
    const s = state as AirState | undefined;
    if (!s) return;
    this.nextOrders = s.nextOrders;
    this.nextRaid = s.nextRaid;
    this.nextBuild = s.nextBuild;
    this.nextBalloon = s.nextBalloon;
    this.enemyAir = s.enemyAir;
  }

  update(w: World, s: AISnapshot): void {
    const { player } = s;
    if (player.epoch < 11) return;
    const intruders = this.watchSky(w, s);
    this.balloon(w, s);
    if (player.epoch < ANTI_AIR_EPOCH) return;
    const building = w.tick >= this.nextBuild;
    if (building) this.nextBuild = w.tick + 10 * TICK_RATE;
    const field = this.airfield(w, s, building);
    if (field?.built) this.train(w, s, field);
    if (building) this.flak(w, s);
    if (w.tick < this.nextOrders) return;
    this.nextOrders = w.tick + 4 * TICK_RATE;
    if (intruders.length) this.defend(w, s, intruders);
    else if (field?.built) this.raid(w, s, field);
  }

  /** Visible enemy aircraft, nearest to the base first; remembers how many there were. */
  private watchSky(w: World, s: AISnapshot): Unit[] {
    const id = this.host.playerId;
    let seen = 0;
    const near: Array<{ u: Unit; d: number }> = [];
    for (const e of w.units) {
      if (e.dead || !isAir(e.role) || !w.areEnemies(id, e.owner) || !w.inSight(id, e)) continue;
      seen++;
      const d = hypot(e.x - s.base.x, e.y - s.base.y);
      if (d < DEFENCE_RADIUS) near.push({ u: e, d });
    }
    this.enemyAir = Math.max(seen, this.enemyAir * 0.995);
    near.sort((a, b) => a.d - b.d || a.u.id - b.u.id);
    return near.map((n) => n.u);
  }

  private aircraft(s: AISnapshot, role: AirRole): Unit[] {
    return s.units.filter((u) => u.role === role);
  }

  // ------------------------------------------------------------- balloon

  /**
   * One balloon from the workshop. It hangs over the army when it marches
   * out, otherwise ahead of the base towards the nearest enemy.
   */
  private balloon(w: World, s: AISnapshot): void {
    const id = this.host.playerId;
    const balloons = this.aircraft(s, 'balloon');
    const workshop = s.buildings.find((b) => b.type === 'workshop' && b.built);
    // The workshop's siege queue does not hold the balloon up.
    if (!balloons.length && workshop && workshop.queue.length < 4 && !workshop.queue.some((q) => q.role === 'balloon')) {
      const tier = bestTier('balloon', s.player.epoch);
      // The one balloon is worth dipping into the savings for.
      if (tier >= 0 && canAfford(s.player.stock, unitStats('balloon', tier).cost)) w.issue({ type: 'train', player: id, buildingId: workshop.id, role: 'balloon' });
    }
    const b = balloons[0];
    if (!b || b.order.kind !== 'idle' || w.tick < this.nextBalloon) return;
    this.nextBalloon = w.tick + 6 * TICK_RATE;
    const away = s.army.filter((u) => hypot(u.x - s.base.x, u.y - s.base.y) > 15);
    let spot: Point | null = null;
    if (away.length >= 3) {
      spot = { x: away.reduce((n, u) => n + u.x, 0) / away.length, y: away.reduce((n, u) => n + u.y, 0) / away.length };
    } else {
      const enemy = this.nearestEnemyBuilding(w, s.base);
      if (enemy) {
        const d = hypot(enemy.x - s.base.x, enemy.y - s.base.y);
        const k = Math.min(0.4, 22 / Math.max(d, 1));
        spot = { x: s.base.x + (enemy.x - s.base.x) * k, y: s.base.y + (enemy.y - s.base.y) * k };
      }
    }
    if (spot && hypot(spot.x - b.x, spot.y - b.y) > 3) w.issue({ type: 'move', player: id, ids: [b.id], x: spot.x, y: spot.y });
  }

  // ------------------------------------------------------------- airfield

  /** The home airfield; builds one once the economy can carry it. */
  private airfield(w: World, s: AISnapshot, build: boolean): Building | null {
    const fields = s.buildings.filter((b) => b.type === 'airfield');
    const field = fields.find((b) => b.built) ?? fields[0] ?? null;
    if (field) {
      // New planes wait on the field itself instead of flying off to the rally point.
      if (field.built && (field.rally.length !== 1 || field.rally[0].x !== field.x || field.rally[0].y !== field.y)) field.rally = [{ x: field.x, y: field.y }];
      return field;
    }
    if (s.citizens.length < 18 || !w.buildingUnlocked(this.host.playerId, 'airfield')) return null;
    if (!build || !this.host.spendable(w, s, BUILDING_DEFS.airfield.cost)) return null;
    const builder = this.host.pickWorker(s, s.base);
    if (builder) this.host.placeNear(w, s, 'airfield', s.base, [builder], 7, 18);
    return null;
  }

  /** Fighters against what the enemy flies, bombers by the epoch. */
  private train(w: World, s: AISnapshot, field: Building): void {
    if (field.queue.length >= 2) return;
    const epoch = s.player.epoch;
    const have = (role: AirRole) => this.aircraft(s, role).length + field.queue.filter((q) => q.role === role).length;
    const wants: Array<[AirRole, number]> = [
      ['fighter', Math.min(10, 2 + Math.ceil(this.enemyAir * 1.2))],
      ['bomber', Math.min(8, 2 + epoch - ANTI_AIR_EPOCH)],
    ];
    // Whatever lags furthest behind its goal comes first.
    wants.sort((a, b) => have(a[0]) / a[1] - have(b[0]) / b[1]);
    for (const [role, want] of wants) {
      if (have(role) >= want) continue;
      const tier = bestTier(role, epoch);
      if (tier < 0) continue;
      // A pair of each even from the savings for the next epoch, the rest from the surplus.
      const cost = unitStats(role, tier).cost;
      if (have(role) < 2 ? !canAfford(s.player.stock, cost) : !this.host.spendable(w, s, cost)) continue;
      w.issue({ type: 'train', player: this.host.playerId, buildingId: field.id, role });
      return;
    }
  }

  /** Once the enemy has shown planes, two more towers guard the base. */
  private flak(w: World, s: AISnapshot): void {
    if (this.enemyAir < 1) return;
    if (s.count('tower') >= Math.min(3, Math.floor(s.player.epoch / 3)) + 2 || s.buildings.some((b) => b.type === 'tower' && !b.built)) return;
    const cost = buildingCost('tower', s.player.epoch);
    if (!canAfford(s.player.stock, cost) || !this.host.spendable(w, s, cost)) return;
    const builder = this.host.pickWorker(s, s.base);
    if (builder) this.host.placeNear(w, s, 'tower', s.base, [builder], 5, 10);
  }

  // ------------------------------------------------------------- missions

  /** Fighters and whatever can shoot at the sky go for planes over the base. */
  private defend(w: World, s: AISnapshot, intruders: Unit[]): void {
    const id = this.host.playerId;
    const target = intruders[0];
    const fighters = this.aircraft(s, 'fighter').filter((u) => u.order.kind !== 'refuel' && u.order.kind !== 'attack' && u.fuel > u.stats.fuel * 0.2);
    if (fighters.length) w.issue({ type: 'attack', player: id, ids: fighters.map((u) => u.id), targetId: target.id });
    const guns = s.army.filter((u) => u.order.kind !== 'attack' && hypot(u.x - s.base.x, u.y - s.base.y) < 16 && canHit(u, target)).map((u) => u.id);
    if (guns.length) w.issue({ type: 'attack', player: id, ids: guns, targetId: target.id });
  }

  /**
   * Bombers that are fuelled and loaded fly against an enemy building within
   * half a tank, preferring ones without flak nearby; idle fighters escort.
   */
  private raid(w: World, s: AISnapshot, field: Building): void {
    if (w.tick < this.nextRaid) return;
    const bombers = this.aircraft(s, 'bomber');
    const ready = bombers.filter((u) => u.order.kind === 'idle' && u.fuel >= u.stats.fuel * 0.8 && u.ammo >= u.stats.bombs);
    // A pair is a raid; the rest of the squadron joins when it is back on the field.
    if (ready.length < 2) return;
    const reach = 0.5 * ready[0].stats.fuel * ready[0].stats.speed;
    const target = this.raidTarget(w, field, reach);
    if (!target) return;
    const id = this.host.playerId;
    w.issue({ type: 'attack', player: id, ids: ready.map((u) => u.id), targetId: target.id });
    const escort = this.aircraft(s, 'fighter').filter((u) => u.order.kind === 'idle' && u.fuel >= u.stats.fuel * 0.6);
    if (escort.length) w.issue({ type: 'move', player: id, ids: escort.map((u) => u.id), x: target.x, y: target.y, attackMove: true });
    this.nextRaid = w.tick + 30 * TICK_RATE;
  }

  private raidTarget(w: World, field: Building, reach: number): Building | null {
    let best: Building | null = null;
    let bestScore = Infinity;
    for (const b of w.buildings) {
      if (b.dead || !w.areEnemies(this.host.playerId, b.owner) || BUILDING_DEFS[b.type].line) continue;
      const d = hypot(b.x - field.x, b.y - field.y);
      if (d > reach) continue;
      let flak = 0;
      for (const t of w.buildings) {
        if (!t.dead && t.type === 'tower' && t.built && t.epoch >= ANTI_AIR_EPOCH && t.owner === b.owner && hypot(t.x - b.x, t.y - b.y) < FLAK_RADIUS) flak++;
      }
      // Their airfield grounds their planes; the town center hurts most.
      const bonus = b.type === 'airfield' ? 10 : b.type === 'towncenter' ? 5 : 0;
      const score = d + flak * 12 - bonus;
      if (score < bestScore) {
        bestScore = score;
        best = b;
      }
    }
    return best;
  }

  private nearestEnemyBuilding(w: World, from: Point): Building | null {
    let best: Building | null = null;
    let bestD = Infinity;
    for (const b of w.buildings) {
      if (b.dead || !w.areEnemies(this.host.playerId, b.owner) || BUILDING_DEFS[b.type].line) continue;
      const d = hypot(b.x - from.x, b.y - from.y);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }
}
