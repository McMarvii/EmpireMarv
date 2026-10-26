import { BUILDING_DEFS, FARM_CAPACITY, type BuildingType } from '../data/buildings';
import { EPOCHS } from '../data/epochs';
import { canAfford, RESOURCES, type Cost, type Res } from '../data/resources';
import { bestTier, unitStats, type CombatRole, type Role } from '../data/units';
import type { Building, ResourceNode, Unit } from './entities';
import type { Point } from './pathfinding';
import { Rng } from './rng';
import type { Controller, Difficulty, World } from './world';

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
  assault: ['ranged'],
  pike: ['assault', 'ranged'],
  ranged: ['mounted', 'assault'],
  mounted: ['pike'],
  siege: ['mounted', 'assault'],
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
    this.military(w, s);
    this.scout(w, s);
  }

  /** Sends one soldier to uncover the map, so new deposits become known. */
  private scout(w: World, s: ReturnType<AIController['snapshot']>): void {
    if (w.tick < this.nextScout) return;
    this.nextScout = w.tick + 30 * 20;
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
      const d = Math.hypot(x - s.base.x, y - s.base.y);
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
    const army = units.filter((u) => u.role !== 'citizen');
    const count = (t: BuildingType) => buildings.filter((b) => b.type === t).length;
    return { player: w.players[id], units, buildings, tc, base, citizens, army, count };
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
    if (tc && !tc.research && citizens.length + queued < target && queued < 2) {
      if (canAfford(player.stock, { food: 50 })) w.issue({ type: 'train', player: this.playerId, buildingId: tc.id, role: 'citizen' });
      if (!tc.rally) tc.rally = { x: tc.x + 3, y: tc.y + 3 };
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
      let d = Math.hypot(n.x - s.base.x, n.y - s.base.y);
      for (const b of drops) d = Math.min(d, Math.hypot(n.x - b.x, n.y - b.y));
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
    const pending = buildings.filter((b) => !b.built && b.type !== 'farm');
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

    // Buildings the next epoch asks for come first (walls are handled by the wall plan).
    const required: Array<[BuildingType, boolean]> =
      player.epoch < w.settings.maxEpoch
        ? w.missingRequirements(id).flatMap((m): Array<[BuildingType, boolean]> => (BUILDING_DEFS[m.type].line ? [] : [[m.type, true]]))
        : [];
    const wants: Array<[BuildingType, boolean]> = [
      ...required,
      ['barracks', count('barracks') === 0 && citizens.length >= 8],
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

  /** A deposit with several workers but far from any drop-off. */
  private storehouseSpot(w: World, s: ReturnType<AIController['snapshot']>): Point | null {
    let best: Point | null = null;
    let bestScore = 0;
    for (const c of s.citizens) {
      if (c.order.kind !== 'gather' || c.order.res === 'food') continue;
      const node = w.get(c.order.targetId);
      if (!node) continue;
      const drop = w.nearestDropoff(this.playerId, node.x, node.y);
      const d = drop ? Math.hypot(drop.x - node.x, drop.y - node.y) : 99;
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
      const d = Math.hypot(c.x - near.x, c.y - near.y) + (c.carryAmount > 3 ? 4 : 0);
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
        const tx = Math.round(center.x + Math.cos(a) * r - size / 2);
        const ty = Math.round(center.y + Math.sin(a) * r - size / 2);
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
      if (!b.rally && s.tc) b.rally = { x: s.tc.x - 4 + (b.id % 3), y: s.tc.y + 4 };
      const roles = BUILDING_DEFS[b.type].trains.filter((r): r is CombatRole => r !== 'citizen' && bestTier(r, player.epoch) >= 0);
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
      (e) => w.areEnemies(id, e.owner) && w.inSight(id, e) && Math.hypot(e.x - s.base.x, e.y - s.base.y) < 18,
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
      const d = Math.hypot(b.x - from.x, b.y - from.y) - (b.type === 'towncenter' ? 6 : 0);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }
}
