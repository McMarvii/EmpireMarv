import { BUILDING_DEFS, FARM_CAPACITY, type BuildingType } from '../data/buildings';
import { EPOCHS } from '../data/epochs';
import { canAfford, RESOURCES, type Cost, type Res } from '../data/resources';
import { RESEARCH_BUILDINGS, TECHS, type Tech } from '../data/techs';
import { bestTier, COMBAT_ROLES, unitStats, type CombatRole, type Role } from '../data/units';
import type { Building, ResourceNode, Unit } from './entities';
import { cos, hypot, sin } from './fmath';
import type { Point } from './pathfinding';
import { Rng } from './rng';
import type { Controller, Difficulty, World } from './world';

interface WallTile {
  x: number;
  y: number;
  type: 'wall' | 'gate';
  side: number;
  d: number;
}

const RING_RADIUS = 12;

interface Profile {
  think: number;
  gatherBonus: number;
  firstAttack: number;
  waveSize: number;
  waveInterval: number;
}

const PROFILES: Record<Difficulty, Profile> = {
  easy: { think: 40, gatherBonus: 0.8, firstAttack: 600, waveSize: 6, waveInterval: 200 },
  normal: { think: 20, gatherBonus: 1, firstAttack: 420, waveSize: 9, waveInterval: 150 },
  hard: { think: 12, gatherBonus: 1.25, firstAttack: 300, waveSize: 12, waveInterval: 110 },
};

/** Counter picks: what to build more of when the enemy fields a role. */
const COUNTERS: Record<Role, CombatRole[]> = {
  citizen: [],
  scout: [],
  assault: ['ranged'],
  pike: ['assault', 'ranged'],
  ranged: ['mounted', 'assault'],
  mounted: ['pike'],
  siege: ['mounted', 'assault'],
  strategist: ['ranged'],
  warrior: ['ranged'],
  priest: ['mounted'],
  prophet: ['mounted'],
};

/**
 * Computer opponent. It plays by the same rules as a human – it only acts
 * through `world.issue()` – but knows where enemy buildings are (classic
 * RTS AI behaviour). Decisions run a few times per second.
 */
export class AIController implements Controller {
  private nextThink: number;
  private nextWave: number;
  private nextRebalance = 0;
  private profile: Profile;
  private attackers = new Set<number>();
  private rng: Rng;
  private nextScout = 0;
  private scoutId = 0;
  /** Planned ring wall around the town center: gates first, then the walls. */
  private wallPlan: WallTile[] | null = null;
  private ringCenter: Point = { x: 0, y: 0 };
  /** Last progress seen per construction site, to spot sites nobody can reach. */
  private siteProgress = new Map<number, { progress: number; tick: number }>();

  constructor(
    readonly playerId: number,
    difficulty: Difficulty,
    world: World,
  ) {
    this.profile = PROFILES[difficulty];
    this.nextThink = playerId * 3;
    this.nextWave = this.profile.firstAttack * 20;
    this.rng = new Rng(world.settings.seed * 31 + playerId);
    world.players[playerId].gatherBonus = this.profile.gatherBonus;
  }

  update(w: World): void {
    if (w.tick < this.nextThink) return;
    this.nextThink = w.tick + this.profile.think;
    const s = this.snapshot(w);
    if (!s.tc && s.citizens.length === 0) return;
    this.economy(w, s);
    this.construction(w, s);
    this.epoch(w, s);
    this.research(w, s);
    this.military(w, s);
    this.scout(w, s);
  }

  /**
   * Uncovers the map so new deposits become known: scouts explore on their
   * own, without one a soldier is sent to unexplored spots now and then.
   */
  private scout(w: World, s: ReturnType<AIController['snapshot']>): void {
    if (w.tick < this.nextScout) return;
    this.nextScout = w.tick + 30 * 20;
    if (s.scouts.length) {
      const idle = s.scouts.filter((u) => u.order.kind === 'idle').map((u) => u.id);
      if (idle.length) w.issue({ type: 'explore', player: this.playerId, ids: idle });
      return;
    }
    let scout = this.scoutId ? w.get(this.scoutId) : undefined;
    if (!scout || scout.kind !== 'unit' || scout.order.kind !== 'idle') {
      const candidates = s.army.filter((u) => !this.attackers.has(u.id) && u.order.kind === 'idle');
      scout = candidates.find((u) => u.role === 'mounted') ?? candidates[0];
    }
    if (!scout) return;
    const vis = s.player.vis;
    const size = w.map.width;
    let best: Point | null = null;
    let bestD = Infinity;
    for (let i = 0; i < 24; i++) {
      const x = this.rng.int(2, size - 2);
      const y = this.rng.int(2, size - 2);
      if (vis[w.map.idx(x, y)] !== 0) continue;
      const d = hypot(x - s.base.x, y - s.base.y);
      if (d < bestD) {
        bestD = d;
        best = { x: x + 0.5, y: y + 0.5 };
      }
    }
    if (!best) return;
    this.scoutId = scout.id;
    w.issue({ type: 'move', player: this.playerId, ids: [scout.id], x: best.x, y: best.y });
  }

  private snapshot(w: World) {
    const id = this.playerId;
    const units = w.unitsOf(id);
    const buildings = w.buildingsOf(id);
    const tc = buildings.find((b) => b.type === 'towncenter' && b.built) ?? null;
    const base: Point = tc ? { x: tc.x, y: tc.y } : w.startPositions[id];
    const citizens = units.filter((u) => u.role === 'citizen');
    const army = units.filter((u) => u.role !== 'citizen' && u.role !== 'scout');
    const scouts = units.filter((u) => u.role === 'scout');
    const count = (t: BuildingType) => buildings.filter((b) => b.type === t).length;
    return { player: w.players[id], units, buildings, tc, base, citizens, army, scouts, count };
  }

  // -------------------------------------------------------------- economy

  private desiredShares(epoch: number): Record<Res, number> {
    if (epoch <= 1) return { food: 0.5, wood: 0.4, stone: 0.1, gold: 0, iron: 0 };
    if (epoch <= 3) return { food: 0.38, wood: 0.32, stone: 0.15, gold: 0.1, iron: 0.05 };
    return { food: 0.3, wood: 0.24, stone: 0.12, gold: 0.18, iron: 0.16 };
  }

  private economy(w: World, s: ReturnType<AIController['snapshot']>): void {
    const { player, tc, citizens } = s;
    const target = Math.min(Math.floor(w.popLimit() * 0.45), 16 + 3 * player.epoch, 48);
    const queued = tc ? tc.queue.length : 0;
    if (tc && !tc.research && !tc.pendingAdvance && citizens.length + queued < target && queued < 2) {
      if (canAfford(player.stock, { food: 50 })) w.issue({ type: 'train', player: this.playerId, buildingId: tc.id, role: 'citizen' });
      if (!tc.rally.length) tc.rally = [{ x: tc.x + 3, y: tc.y + 3 }];
    }

    const shares = this.desiredShares(player.epoch);
    const workers: Record<Res, Unit[]> = { food: [], wood: [], stone: [], gold: [], iron: [] };
    const idle: Unit[] = [];
    for (const c of citizens) {
      if (c.order.kind === 'gather') workers[c.order.res].push(c);
      else if (c.order.kind === 'idle') idle.push(c);
    }
    const want = (r: Res) => shares[r] * citizens.length;
    const advance = player.epoch < w.settings.maxEpoch ? EPOCHS[player.epoch + 1].advanceCost : {};
    /** Resources ordered by how badly more workers are needed. */
    const neediest = (): Res[] => {
      const gaps = RESOURCES.map((r) => {
        const shortage = Math.max(0, (advance[r] ?? 0) - player.stock[r]);
        // Big stockpiles count as partial workers, shortages for the next epoch as extra demand.
        const gap = want(r) - workers[r].length - player.stock[r] / 400 + shortage / 60;
        return { r, gap: shares[r] === 0 && shortage === 0 ? -Infinity : gap };
      });
      return gaps.sort((a, b) => b.gap - a.gap).map((g) => g.r);
    };

    for (const c of idle) {
      // Fall back to other resources when no deposit of the neediest one is known.
      for (const r of neediest()) {
        if (this.sendToGather(w, s, c, r)) {
          workers[r].push(c);
          break;
        }
      }
    }

    if (w.tick >= this.nextRebalance) {
      this.nextRebalance = w.tick + 200;
      const r = neediest().find((res) => res === 'food' || this.bestNode(w, s, res)) ?? 'food';
      if (want(r) - workers[r].length >= 1.5) {
        let donor: Res | null = null;
        let surplus = 1;
        for (const o of RESOURCES) {
          const extra = workers[o].length - want(o);
          if (o !== r && extra > surplus) {
            surplus = extra;
            donor = o;
          }
        }
        if (donor) {
          const c = workers[donor].find((u) => u.carryAmount < 1) ?? workers[donor][0];
          if (c) this.sendToGather(w, s, c, r);
        }
      }
    }
  }

  private sendToGather(w: World, s: ReturnType<AIController['snapshot']>, c: Unit, res: Res): boolean {
    const id = this.playerId;
    if (res === 'food') {
      const berries = w.nearestResource('food', s.base.x, s.base.y, 18, id);
      if (berries) {
        w.issue({ type: 'gather', player: id, ids: [c.id], targetId: berries.id });
        return true;
      }
      // Unfinished farms count their builders, who start farming once done.
      const load = (b: Building) =>
        w.farmWorkers(b) + w.units.filter((u) => u.order.kind === 'build' && u.order.targetId === b.id).length;
      const farm = s.buildings.find((b) => b.type === 'farm' && load(b) < FARM_CAPACITY);
      if (farm) {
        w.issue({ type: farm.built ? 'gather' : 'construct', player: id, ids: [c.id], targetId: farm.id });
        return true;
      }
      if (w.buildingUnlocked(id, 'farm') && canAfford(s.player.stock, BUILDING_DEFS.farm.cost)) {
        return this.placeNear(w, s, 'farm', s.base, [c], 4, 12);
      }
      const far = w.nearestResource('food', s.base.x, s.base.y, 60, id);
      if (far) {
        w.issue({ type: 'gather', player: id, ids: [c.id], targetId: far.id });
        return true;
      }
      return this.sendToGather(w, s, c, 'wood');
    }
    const node = this.bestNode(w, s, res);
    if (!node) return false;
    w.issue({ type: 'gather', player: id, ids: [c.id], targetId: node.id });
    return true;
  }

  /** Nearest known deposit, measured from the closest drop-off. */
  private bestNode(w: World, s: ReturnType<AIController['snapshot']>, res: Res): ResourceNode | null {
    const drops = s.buildings.filter((b) => b.built && BUILDING_DEFS[b.type].dropoff);
    let best: ResourceNode | null = null;
    let bestD = 80;
    for (const n of w.resources) {
      if (n.dead || n.res !== res || n.blockedUntil > w.tick || !w.isVisibleTo(this.playerId, n)) continue;
      let d = hypot(n.x - s.base.x, n.y - s.base.y);
      for (const b of drops) d = Math.min(d, hypot(n.x - b.x, n.y - b.y));
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    return best;
  }

  // ---------------------------------------------------------- construction

  private construction(w: World, s: ReturnType<AIController['snapshot']>): void {
    const { player, count, citizens, buildings } = s;
    const id = this.playerId;
    const sites = buildings.filter((b) => !b.built);
    this.clearStuckSites(w, sites);
    // A wall line only needs a small crew walking it, not one citizen per segment,
    // and it does not hold up other construction.
    const segments = sites.filter((b) => BUILDING_DEFS[b.type].line);
    const crew = citizens.filter((c) => c.order.kind === 'build' && segments.some((b) => b.id === (c.order as { targetId: number }).targetId));
    if (segments.length && crew.length < 2) {
      const helper = this.pickWorker(s, segments[0]);
      if (helper) w.issue({ type: 'construct', player: id, ids: [helper.id], targetId: segments[0].id });
    }
    const pending = sites.filter((b) => b.type !== 'farm' && !BUILDING_DEFS[b.type].line);
    if (pending.length > 0) {
      // Make sure someone is actually working on unfinished buildings.
      for (const b of pending) {
        const builders = citizens.filter((c) => c.order.kind === 'build' && c.order.targetId === b.id);
        if (builders.length === 0) {
          const helper = this.pickWorker(s, b);
          if (helper) w.issue({ type: 'construct', player: id, ids: [helper.id], targetId: b.id });
        }
      }
      return;
    }
    if (citizens.length < 6) return;
    if (segments.length === 0 && this.walls(w, s)) return;

    // Buildings the next epoch asks for come first (walls are handled by the wall plan).
    const required: Array<[BuildingType, boolean]> =
      player.epoch < w.settings.maxEpoch
        ? w.missingRequirements(id).flatMap((m): Array<[BuildingType, boolean]> => (BUILDING_DEFS[m.type].line ? [] : [[m.type, true]]))
        : [];
    const wants: Array<[BuildingType, boolean]> = [
      ...required,
      ['barracks', count('barracks') === 0 && citizens.length >= 8],
      ['smithy', count('smithy') === 0 && citizens.length >= 12],
      ['academy', count('academy') === 0 && citizens.length >= 15],
      ['storehouse', count('storehouse') < Math.min(3, 1 + Math.floor(citizens.length / 12))],
      ['house', count('house') < Math.min(6, 1 + Math.floor(s.army.length / 6))],
      ['workshop', count('workshop') === 0 && player.epoch >= 2 && citizens.length >= 14],
      ['stable', count('stable') === 0 && player.epoch >= 3],
      ['tower', count('tower') < Math.min(3, Math.floor(player.epoch / 3)) && player.stock.stone > 300],
      ['barracks', count('barracks') < 2 && player.epoch >= 5 && citizens.length >= 24],
      ['stable', count('stable') < 2 && player.epoch >= 9 && citizens.length >= 30],
    ];
    for (const [type, wanted] of wants) {
      if (!wanted || !w.buildingUnlocked(id, type)) continue;
      if (!canAfford(player.stock, BUILDING_DEFS[type].cost)) continue;
      const where = type === 'storehouse' ? this.storehouseSpot(w, s) : s.base;
      if (!where) continue;
      const builder = this.pickWorker(s, where);
      if (!builder) return;
      const [minR, maxR] = type === 'storehouse' ? [2, 6] : type === 'tower' ? [7, 11] : [5, 14];
      this.placeNear(w, s, type, where, [builder], minR, maxR);
      return;
    }
  }

  /**
   * A construction site without progress for 45 s cannot be reached (or has
   * no one left to build it); tearing it down refunds the unbuilt share and
   * frees the AI to build elsewhere.
   */
  private clearStuckSites(w: World, sites: Building[]): void {
    for (const b of sites) {
      const seen = this.siteProgress.get(b.id);
      if (!seen || b.progress > seen.progress + 1e-6) {
        this.siteProgress.set(b.id, { progress: b.progress, tick: w.tick });
      } else if (w.tick - seen.tick > 45 * 20) {
        w.issue({ type: 'destroy', player: this.playerId, ids: [b.id] });
        this.siteProgress.delete(b.id);
      }
    }
    for (const id of [...this.siteProgress.keys()]) if (!sites.some((b) => b.id === id)) this.siteProgress.delete(id);
  }

  /**
   * Builds a square ring wall around the town center in batches, with a gate
   * in the middle of every side. Tiles that cannot take a wall (forest,
   * water, buildings) are skipped – they block on their own or stay a gap.
   */
  private walls(w: World, s: ReturnType<AIController['snapshot']>): boolean {
    const { player, tc, citizens } = s;
    const id = this.playerId;
    if (!tc || !w.buildingUnlocked(id, 'wall')) return false;
    const needed = w.missingRequirements(id).some((m) => BUILDING_DEFS[m.type].line);
    if (!needed && (player.epoch < 2 || citizens.length < 18)) return false;
    if (!this.wallPlan) this.wallPlan = this.planRing(w, tc);
    const batch: WallTile[] = [];
    let type: 'wall' | 'gate' = 'wall';
    const later: WallTile[] = [];
    while (this.wallPlan.length && batch.length < 8) {
      const next = this.wallPlan[0];
      if (batch.length && next.type !== type) break;
      this.wallPlan.shift();
      // Unexplored tiles wait until someone has seen them; blocked ones are dropped.
      if (player.vis[w.map.idx(next.x, next.y)] === 0) later.push(next);
      else if (w.canPlace(id, next.type, next.x, next.y)) {
        type = next.type;
        batch.push(next);
      } else if (next.type === 'gate') {
        // A gate must exist on every side: slide it along the wall to a free tile.
        const moved = this.shiftGate(w, next);
        if (moved) this.wallPlan.unshift(moved);
      }
    }
    this.wallPlan.push(...later);
    if (batch.length === 0) return false;
    const cost: Cost = {};
    for (const r of RESOURCES) if (BUILDING_DEFS[type].cost[r]) cost[r] = (BUILDING_DEFS[type].cost[r] ?? 0) * batch.length;
    // Walls the next advance asks for are not optional: no saving up against them.
    if (needed ? !canAfford(player.stock, cost) : !this.spendable(w, s, cost)) {
      this.wallPlan.unshift(...batch);
      return false;
    }
    const builders: Unit[] = [];
    for (let i = 0; i < 2; i++) {
      const b = this.pickWorker({ ...s, citizens: citizens.filter((c) => !builders.includes(c)) }, batch[0]);
      if (b) builders.push(b);
    }
    if (!builders.length) return false;
    w.issue({ type: 'placeLine', player: id, ids: builders.map((b) => b.id), building: type, tiles: batch.map((t) => ({ x: t.x, y: t.y })) });
    return true;
  }

  /** Tile `d` steps along one side of the ring (sides go clockwise from the north). */
  private ringTile(side: number, d: number): Point {
    const { x: cx, y: cy } = this.ringCenter;
    const R = RING_RADIUS;
    switch (side) {
      case 0:
        return { x: cx + d, y: cy - R };
      case 1:
        return { x: cx + R, y: cy + d };
      case 2:
        return { x: cx - d, y: cy + R };
      default:
        return { x: cx - R, y: cy - d };
    }
  }

  private shiftGate(w: World, gate: WallTile): WallTile | null {
    for (let k = 2; k <= 8; k++) {
      for (const d of [gate.d + k, gate.d - k]) {
        if (Math.abs(d) >= RING_RADIUS) continue;
        const t = this.ringTile(gate.side, d);
        if (!w.map.inBounds(t.x, t.y) || !w.canPlace(this.playerId, 'gate', t.x, t.y)) continue;
        // The tile becomes a gate instead of a wall.
        this.wallPlan = this.wallPlan!.filter((p) => p.x !== t.x || p.y !== t.y);
        return { ...t, type: 'gate', side: gate.side, d };
      }
    }
    return null;
  }

  private planRing(w: World, tc: Building): WallTile[] {
    const R = RING_RADIUS;
    this.ringCenter = { x: Math.floor(tc.x), y: Math.floor(tc.y) };
    const gates: WallTile[] = [];
    const walls: WallTile[] = [];
    for (let d = -R; d <= R; d++) {
      // Walk the four sides; the gate sits in the middle of each one.
      for (let side = 0; side < 4; side++) {
        const { x, y } = this.ringTile(side, d);
        if (!w.map.inBounds(x, y)) continue;
        if (Math.abs(d) === R && walls.some((t) => t.x === x && t.y === y)) continue;
        if (d === 0 || d === 1) gates.push({ x, y, type: 'gate', side, d });
        else walls.push({ x, y, type: 'wall', side, d });
      }
    }
    const cx = this.ringCenter.x;
    const cy = this.ringCenter.y;
    // Close the ring outwards from the gates, so early segments already protect the entrances.
    walls.sort((a, b) => Math.min(Math.abs(a.x - cx), Math.abs(a.y - cy)) - Math.min(Math.abs(b.x - cx), Math.abs(b.y - cy)));
    return [...gates, ...walls];
  }

  /** A deposit with several workers but far from any drop-off. */
  private storehouseSpot(w: World, s: ReturnType<AIController['snapshot']>): Point | null {
    let best: Point | null = null;
    let bestScore = 0;
    for (const c of s.citizens) {
      if (c.order.kind !== 'gather' || c.order.res === 'food') continue;
      const node = w.get(c.order.targetId);
      if (!node) continue;
      const drop = w.nearestDropoff(this.playerId, node.x, node.y);
      const d = drop ? hypot(drop.x - node.x, drop.y - node.y) : 99;
      if (d > 9 && d > bestScore) {
        bestScore = d;
        best = { x: node.x, y: node.y };
      }
    }
    return best;
  }

  private pickWorker(s: ReturnType<AIController['snapshot']>, near: Point): Unit | null {
    let best: Unit | null = null;
    let bestD = Infinity;
    for (const c of s.citizens) {
      if (c.order.kind === 'build') continue;
      const d = hypot(c.x - near.x, c.y - near.y) + (c.carryAmount > 3 ? 4 : 0);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  /** Spiral search for a valid spot in a ring around a point. */
  private placeNear(
    w: World,
    s: ReturnType<AIController['snapshot']>,
    type: BuildingType,
    center: Point,
    builders: Unit[],
    minR: number,
    maxR: number,
  ): boolean {
    const size = BUILDING_DEFS[type].size;
    // Rotate the start angle per player and building count so bases spread out.
    const offset = (this.playerId * 1.7 + s.buildings.length * 2.39) % (Math.PI * 2);
    for (let r = minR; r <= maxR; r++) {
      const steps = Math.max(8, Math.round(r * 6));
      for (let i = 0; i < steps; i++) {
        const a = offset + (i / steps) * Math.PI * 2;
        const tx = Math.round(center.x + cos(a) * r - size / 2);
        const ty = Math.round(center.y + sin(a) * r - size / 2);
        if (!w.canPlace(this.playerId, type, tx, ty)) continue;
        if (type !== 'storehouse' && this.blocksResources(w, tx, ty, size)) continue;
        w.issue({ type: 'place', player: this.playerId, ids: builders.map((b) => b.id), building: type, tx, ty });
        return true;
      }
    }
    return false;
  }

  private blocksResources(w: World, tx: number, ty: number, size: number): boolean {
    for (const n of w.resources) {
      if (n.dead) continue;
      if (n.x > tx - 2 && n.x < tx + size + 2 && n.y > ty - 2 && n.y < ty + size + 2) return true;
    }
    return false;
  }

  // ----------------------------------------------------------------- epochs

  private epoch(w: World, s: ReturnType<AIController['snapshot']>): void {
    const { player, tc, citizens } = s;
    if (!tc || tc.research || player.epoch >= w.settings.maxEpoch || w.isResearching(this.playerId)) return;
    if (citizens.length < Math.min(10 + player.epoch, 28)) return;
    const cost = EPOCHS[player.epoch + 1].advanceCost;
    if (canAfford(player.stock, cost)) w.issue({ type: 'advance', player: this.playerId, buildingId: tc.id });
  }

  /**
   * Keeps every research building busy. Techs of the current epoch come first
   * while the next advance still needs them; otherwise economy before
   * military, and military only once there is an army to profit from it.
   */
  private research(w: World, s: ReturnType<AIController['snapshot']>): void {
    const id = this.playerId;
    const { player } = s;
    const gap = w.missingTechs(id);
    const urgent = player.epoch < w.settings.maxEpoch && gap.have < gap.need;
    const total = (t: Tech) => RESOURCES.reduce((n, r) => n + (t.cost[r] ?? 0), 0);
    // Needed for the advance: techs of this epoch and the earlier levels leading up to them.
    const isNeeded = (t: Tech) => urgent && t.branch.levels.some(([e], i) => e === player.epoch && i >= t.level);
    const score = (t: Tech) => {
      let v = total(t) / 100;
      if (isNeeded(t)) v -= t.epoch === player.epoch ? 1010 : 1000;
      const kinds = t.branch.effects.map((e) => e.kind);
      if (kinds.some((k) => k === 'gather' || k === 'farm' || k === 'carry' || k === 'build')) v -= 3;
      else if (kinds.includes('unit')) v += s.army.length >= 6 ? -1 : 4;
      return v;
    };
    for (const b of s.buildings) {
      if (!b.built || b.tech || b.research || !RESEARCH_BUILDINGS.includes(b.type)) continue;
      const military = (t: Tech) => t.branch.effects.some((e) => e.kind === 'unit' && !e.roles.includes('citizen'));
      const options = TECHS.filter((t) => t.building === b.type && w.techAvailable(id, t) && (isNeeded(t) || !military(t) || s.army.length >= 6)).sort(
        (a, c) => score(a) - score(c),
      );
      const pick = options[0];
      if (!pick) continue;
      const needed = isNeeded(pick);
      // Optional research only from a surplus, so the army does not starve.
      const double: Cost = {};
      for (const r of RESOURCES) if (pick.cost[r]) double[r] = (pick.cost[r] ?? 0) * 2;
      if (needed ? canAfford(player.stock, pick.cost) : this.spendable(w, s, pick.cost) && canAfford(player.stock, double)) {
        w.issue({ type: 'research', player: id, buildingId: b.id, tech: pick.id });
      }
    }
  }

  /** While saving for the next epoch, only spend what exceeds its price. */
  private spendable(w: World, s: ReturnType<AIController['snapshot']>, cost: Cost): boolean {
    const { player } = s;
    if (!canAfford(player.stock, cost)) return false;
    if (player.epoch >= w.settings.maxEpoch || s.army.length < 4 + player.epoch) return true;
    const reserve = EPOCHS[player.epoch + 1].advanceCost;
    for (const r of RESOURCES) {
      if ((cost[r] ?? 0) > 0 && player.stock[r] - (cost[r] ?? 0) < (reserve[r] ?? 0)) return false;
    }
    return true;
  }

  // --------------------------------------------------------------- military

  private military(w: World, s: ReturnType<AIController['snapshot']>): void {
    const id = this.playerId;
    const { player, buildings, army } = s;

    // Production with a counter-aware mix.
    const weights: Record<CombatRole, number> = { assault: 3, pike: 2, ranged: 3, mounted: 2, siege: army.length > 6 ? 1 : 0 };
    for (const e of w.units) {
      if (!w.areEnemies(id, e.owner) || !w.inSight(id, e)) continue;
      for (const c of COUNTERS[e.role]) weights[c] += 0.5;
    }
    const military = buildings.filter((b) => b.built && b.type !== 'towncenter' && BUILDING_DEFS[b.type].trains.length > 0);
    for (const b of military) {
      if (b.queue.length >= 2) continue;
      if (!b.rally.length && s.tc) b.rally = [{ x: s.tc.x - 4 + (b.id % 3), y: s.tc.y + 4 }];
      const roles = BUILDING_DEFS[b.type].trains.filter((r): r is CombatRole => COMBAT_ROLES.includes(r as CombatRole) && bestTier(r, player.epoch) >= 0);
      if (roles.length === 0) continue;
      const counts: Record<string, number> = {};
      for (const u of army) counts[u.role] = (counts[u.role] ?? 0) + 1;
      // Pick the role that is most under-represented relative to its weight.
      let pick = roles[0];
      let bestNeed = -Infinity;
      for (const r of roles) {
        const need = weights[r] - (counts[r] ?? 0) * 0.5;
        if (need > bestNeed) {
          bestNeed = need;
          pick = r;
        }
      }
      const cost = unitStats(pick, bestTier(pick, player.epoch)).cost;
      if (this.spendable(w, s, cost)) w.issue({ type: 'train', player: id, buildingId: b.id, role: pick });
    }

    // Defence: anything hostile near the base pulls the home army.
    const threat = w.units.find(
      (e) => w.areEnemies(id, e.owner) && w.inSight(id, e) && hypot(e.x - s.base.x, e.y - s.base.y) < 18,
    );
    for (const id2 of [...this.attackers]) if (!w.get(id2)) this.attackers.delete(id2);
    const home = army.filter((u) => !this.attackers.has(u.id));
    if (threat) {
      const idleHome = home.filter((u) => u.order.kind !== 'attack').map((u) => u.id);
      if (idleHome.length) w.issue({ type: 'move', player: id, ids: idleHome, x: threat.x, y: threat.y, attackMove: true });
      return;
    }

    // Offence: waves grow with the epoch.
    const waveSize = this.profile.waveSize + player.epoch;
    if (w.tick >= this.nextWave && home.length >= waveSize) {
      const target = this.attackTarget(w, s.base);
      if (target) {
        const ids = home.map((u) => u.id);
        ids.forEach((i) => this.attackers.add(i));
        w.issue({ type: 'move', player: id, ids, x: target.x, y: target.y, attackMove: true });
        this.nextWave = w.tick + this.profile.waveInterval * 20;
      }
    }
    // Attackers that finished their march push on to the next building.
    const loose = army.filter((u) => this.attackers.has(u.id) && u.order.kind === 'idle');
    if (loose.length) {
      const target = this.attackTarget(w, { x: loose[0].x, y: loose[0].y });
      if (target) w.issue({ type: 'move', player: id, ids: loose.map((u) => u.id), x: target.x, y: target.y, attackMove: true });
    }
  }

  private attackTarget(w: World, from: Point): Building | null {
    let best: Building | null = null;
    let bestD = Infinity;
    for (const b of w.buildings) {
      if (b.dead || !w.areEnemies(this.playerId, b.owner)) continue;
      // Walls are only attacked when they stand in the way, not marched to.
      const d = hypot(b.x - from.x, b.y - from.y) - (b.type === 'towncenter' ? 6 : 0) + (BUILDING_DEFS[b.type].line ? 40 : 0);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }
}
