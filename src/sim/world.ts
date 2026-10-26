import { BUILDING_DEFS, buildingMaxHp, buildingName, MORALE_MAX_HOUSES, MORALE_RADIUS, type BuildingType } from '../data/buildings';
import { EPOCHS, LAST_EPOCH } from '../data/epochs';
import { canAfford, emptyStock, missingText, pay, refund, RESOURCES, multiplyCost, type Cost, type Res } from '../data/resources';
import { bestTier, ROLE_DEFS, unitStats, type Projectile, type Role } from '../data/units';
import { updateBuilding, updateUnit, separateUnits, setPathTo } from './behavior';
import { updateProjectiles } from './combat';
import { rectOf, type Building, type Entity, type NodeType, type Player, type ResourceNode, type Unit } from './entities';
import { GameMap } from './map';
import { generateMap } from './mapgen';
import { distToRect, Pathfinder, type Point } from './pathfinding';
import { Rng } from './rng';
import { updateVision } from './vision';

export const TICK_RATE = 20;
export const DT = 1 / TICK_RATE;

export type Difficulty = 'easy' | 'normal' | 'hard';
export type StartResources = 'low' | 'standard' | 'high';

export interface PlayerSetup {
  name: string;
  color: string;
  isAI: boolean;
  team: number;
}

export interface GameSettings {
  seed: number;
  mapSize: number;
  startEpoch: number;
  maxEpoch: number;
  popLimit: number;
  startResources: StartResources;
  aiDifficulty: Difficulty;
  players: PlayerSetup[];
  revealMap?: boolean;
}

export const DEFAULT_SETTINGS: GameSettings = {
  seed: 1,
  mapSize: 96,
  startEpoch: 0,
  maxEpoch: LAST_EPOCH,
  popLimit: 120,
  startResources: 'standard',
  aiDifficulty: 'normal',
  players: [
    { name: 'Du', color: '#2f7de1', isAI: false, team: 0 },
    { name: 'Rivale', color: '#d9412b', isAI: true, team: 1 },
  ],
};

export interface GameEvent {
  type: 'info' | 'warn' | 'epoch' | 'attack' | 'built' | 'trained' | 'gameover';
  player: number;
  text: string;
  x?: number;
  y?: number;
}

export interface ProjectileFx {
  kind: Projectile;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  t: number;
  dur: number;
  targetId: number;
  homing: boolean;
  owner: number;
  attackerId: number;
  attackerRole: Role | 'tower';
  dmg: number;
  splash: number;
}

export interface Effect {
  kind: 'explosion' | 'hit' | 'collapse' | 'dust' | 'laserhit';
  x: number;
  y: number;
  t: number;
  dur: number;
  size: number;
}

export interface Controller {
  readonly playerId: number;
  update(world: World): void;
}

export type Command =
  | { type: 'move'; player: number; ids: number[]; x: number; y: number; attackMove?: boolean }
  | { type: 'attack'; player: number; ids: number[]; targetId: number }
  | { type: 'gather'; player: number; ids: number[]; targetId: number }
  | { type: 'construct'; player: number; ids: number[]; targetId: number }
  | { type: 'place'; player: number; ids: number[]; building: BuildingType; tx: number; ty: number }
  /** A line of wall or gate segments, placed from the first tile on as far as resources allow. */
  | { type: 'placeLine'; player: number; ids: number[]; building: BuildingType; tiles: Point[] }
  | { type: 'train'; player: number; buildingId: number; role: Role; count?: number }
  | { type: 'cancel'; player: number; buildingId: number; index: number }
  | { type: 'advance'; player: number; buildingId: number }
  | { type: 'rally'; player: number; buildingId: number; x: number; y: number }
  | { type: 'deposit'; player: number; ids: number[]; targetId: number }
  | { type: 'stop'; player: number; ids: number[] }
  | { type: 'destroy'; player: number; ids: number[] };

const START_STOCK: Record<StartResources, Record<Res, number>> = {
  low: { food: 200, wood: 200, stone: 100, gold: 100, iron: 50 },
  standard: { food: 400, wood: 400, stone: 250, gold: 200, iron: 150 },
  high: { food: 2000, wood: 2000, stone: 1500, gold: 1500, iron: 1500 },
};

const GRID_CELL = 4;
/** Longest wall line one drag may place. */
export const MAX_LINE = 30;

/**
 * The complete, deterministic game state. Rendering and input only read
 * from it and talk to it through `issue()`, so the same simulation runs
 * headless in tests and could run in lockstep for multiplayer.
 */
export class World {
  readonly settings: GameSettings;
  readonly map: GameMap;
  readonly pathfinder: Pathfinder;
  readonly rng: Rng;
  readonly players: Player[] = [];
  readonly startPositions: Point[] = [];
  tick = 0;
  entities = new Map<number, Entity>();
  units: Unit[] = [];
  buildings: Building[] = [];
  resources: ResourceNode[] = [];
  projectiles: ProjectileFx[] = [];
  effects: Effect[] = [];
  events: GameEvent[] = [];
  controllers: Controller[] = [];
  over = false;
  winnerTeam: number | null = null;

  private nextId = 1;
  private grid: Unit[][];
  private gridCols: number;
  private lastAlertTick: number[] = [];

  constructor(settings: Partial<GameSettings> = {}) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    const s = this.settings;
    s.startEpoch = Math.max(0, Math.min(LAST_EPOCH, s.startEpoch));
    s.maxEpoch = Math.max(s.startEpoch, Math.min(LAST_EPOCH, s.maxEpoch));
    this.rng = new Rng(s.seed);
    this.map = new GameMap(s.mapSize, s.mapSize);
    this.pathfinder = new Pathfinder(this.map);
    this.gridCols = Math.ceil(s.mapSize / GRID_CELL);
    this.grid = Array.from({ length: this.gridCols * this.gridCols }, () => []);

    s.players.forEach((p, id) => {
      const stock = emptyStock();
      const factor = 1 + 0.6 * s.startEpoch;
      for (const r of RESOURCES) stock[r] = Math.round(START_STOCK[s.startResources][r] * factor);
      this.players.push({
        id,
        name: p.name,
        color: p.color,
        team: p.team,
        isAI: p.isAI,
        stock,
        epoch: s.startEpoch,
        alive: true,
        vis: new Uint8Array(s.mapSize * s.mapSize),
        stats: {
          gathered: emptyStock(),
          unitsTrained: 0,
          unitsLost: 0,
          kills: 0,
          buildingsBuilt: 0,
          buildingsLost: 0,
        },
        gatherBonus: 1,
      });
      this.lastAlertTick.push(-1000);
    });

    this.startPositions.push(...generateMap(this));
    this.setupStartingBases();
    this.rebuildGrid();
    updateVision(this);
  }

  get time(): number {
    return this.tick / TICK_RATE;
  }

  private setupStartingBases(): void {
    const s = this.settings;
    this.players.forEach((p, i) => {
      const start = this.startPositions[i];
      const tc = this.addBuilding(p.id, 'towncenter', Math.floor(start.x) - 2, Math.floor(start.y) - 2, true);
      const citizens = 5 + Math.min(4, s.startEpoch);
      for (let n = 0; n < citizens; n++) {
        const spot = this.findSpawnPoint(tc, { x: start.x + 4, y: start.y + 4 }, n);
        if (spot) this.spawnUnit(p.id, 'citizen', spot.x, spot.y);
      }
      // Later start epochs come with a small garrison, like the classic "start units" setting.
      if (s.startEpoch >= 2) {
        const roles: Role[] = ['assault', 'ranged', 'pike'];
        roles.forEach((role, n) => {
          if (bestTier(role, p.epoch) < 0) return;
          const spot = this.findSpawnPoint(tc, { x: start.x - 4, y: start.y + 4 }, n);
          if (spot) this.spawnUnit(p.id, role, spot.x, spot.y);
        });
      }
    });
  }

  // ---------------------------------------------------------------- entities

  get(id: number): Entity | undefined {
    const e = this.entities.get(id);
    return e && !e.dead ? e : undefined;
  }

  spawnUnit(owner: number, role: Role, x: number, y: number, tier = bestTier(role, this.players[owner].epoch)): Unit {
    const stats = unitStats(role, Math.max(0, tier));
    const u: Unit = {
      kind: 'unit',
      id: this.nextId++,
      owner,
      x,
      y,
      px: x,
      py: y,
      hp: stats.hp,
      maxHp: stats.hp,
      dead: false,
      lastHitTick: -1000,
      role,
      tier: Math.max(0, tier),
      stats,
      facing: Math.PI / 4,
      order: { kind: 'idle' },
      path: [],
      repathTick: -1000,
      scanTick: 0,
      cooldown: 0,
      carry: null,
      carryAmount: 0,
      morale: 0,
      moving: false,
      attackAnim: 0,
      stuckTime: 0,
    };
    this.entities.set(u.id, u);
    this.units.push(u);
    return u;
  }

  addBuilding(owner: number, type: BuildingType, tx: number, ty: number, built: boolean): Building {
    const def = BUILDING_DEFS[type];
    const epoch = this.players[owner].epoch;
    const maxHp = buildingMaxHp(type, epoch);
    const b: Building = {
      kind: 'building',
      id: this.nextId++,
      owner,
      type,
      tx,
      ty,
      size: def.size,
      x: tx + def.size / 2,
      y: ty + def.size / 2,
      hp: built ? maxHp : Math.max(1, maxHp * 0.05),
      maxHp,
      dead: false,
      lastHitTick: -1000,
      built,
      progress: built ? 1 : 0,
      epoch,
      queue: [],
      research: null,
      rally: null,
      cooldown: 0,
      scanTick: 0,
      targetId: 0,
      seenBy: 1 << owner,
      popBlocked: false,
    };
    this.entities.set(b.id, b);
    this.buildings.push(b);
    this.map.block(tx, ty, def.size, def.size, 1, def.walkable);
    this.displaceUnits(b);
    if (built) this.openGate(b);
    return b;
  }

  /** A finished gate opens for its owner's team. */
  openGate(b: Building): void {
    if (BUILDING_DEFS[b.type].gate) this.map.setGate(b.tx, b.ty, this.teamOf(b.owner));
  }

  teamOf(owner: number): number {
    return owner >= 0 ? this.players[owner].team : -1;
  }

  addResource(nodeType: NodeType, tx: number, ty: number, size: number, amount: number): ResourceNode {
    const res: Res = nodeType === 'tree' ? 'wood' : nodeType === 'berries' ? 'food' : nodeType;
    const n: ResourceNode = {
      kind: 'resource',
      id: this.nextId++,
      owner: -1,
      nodeType,
      res,
      amount,
      tx,
      ty,
      size,
      x: tx + size / 2,
      y: ty + size / 2,
      hp: amount,
      maxHp: amount,
      dead: false,
      lastHitTick: -1000,
      variant: this.rng.int(0, 4),
    };
    this.entities.set(n.id, n);
    this.resources.push(n);
    this.map.block(tx, ty, size, size, 1);
    return n;
  }

  /** Marks an entity dead and frees its tiles; lists are compacted at tick end. */
  remove(e: Entity): void {
    if (e.dead) return;
    e.dead = true;
    if (e.kind === 'building') {
      this.map.block(e.tx, e.ty, e.size, e.size, -1, BUILDING_DEFS[e.type].walkable);
      if (BUILDING_DEFS[e.type].gate) this.map.setGate(e.tx, e.ty, -1);
    } else if (e.kind === 'resource') {
      this.map.block(e.tx, e.ty, e.size, e.size, -1);
    }
  }

  /** Pushes units standing inside a new footprint out to the nearest free tile. */
  private displaceUnits(b: Building): void {
    if (BUILDING_DEFS[b.type].walkable) return;
    const r = rectOf(b);
    for (const u of this.units) {
      if (u.dead || distToRect(u.x, u.y, r) > 0) continue;
      const free = this.map.nearestPassable(u.x, u.y, 8);
      if (free) {
        u.x = u.px = free.x + 0.5;
        u.y = u.py = free.y + 0.5;
        u.path = [];
      }
    }
  }

  // ----------------------------------------------------------------- queries

  unitsOf(owner: number): Unit[] {
    return this.units.filter((u) => u.owner === owner && !u.dead);
  }

  buildingsOf(owner: number, type?: BuildingType): Building[] {
    return this.buildings.filter((b) => b.owner === owner && !b.dead && (!type || b.type === type));
  }

  popCount(owner: number): number {
    let n = 0;
    for (const u of this.units) if (u.owner === owner && !u.dead) n++;
    return n;
  }

  /** Units queued in buildings count toward the limit only once they spawn. */
  popLimit(): number {
    return this.settings.popLimit;
  }

  areEnemies(a: number, b: number): boolean {
    if (a < 0 || b < 0 || a === b) return false;
    return this.players[a].team !== this.players[b].team;
  }

  isVisibleTo(player: number, e: Entity): boolean {
    if (e.owner === player) return true;
    const vis = this.players[player].vis;
    if (e.kind === 'building') {
      if (e.seenBy & (1 << player)) return true;
    }
    const tx = Math.floor(e.x);
    const ty = Math.floor(e.y);
    if (!this.map.inBounds(tx, ty)) return false;
    return vis[this.map.idx(tx, ty)] === 2 || (e.kind === 'resource' && vis[this.map.idx(tx, ty)] >= 1);
  }

  /** Whether an enemy entity is currently in sight (not just remembered). */
  inSight(player: number, e: Entity): boolean {
    if (e.kind === 'building') {
      const r = rectOf(e);
      const vis = this.players[player].vis;
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) {
          if (this.map.inBounds(x, y) && vis[this.map.idx(x, y)] === 2) return true;
        }
      }
      return false;
    }
    const tx = Math.floor(e.x);
    const ty = Math.floor(e.y);
    return this.map.inBounds(tx, ty) && this.players[player].vis[this.map.idx(tx, ty)] === 2;
  }

  /** Iterates units whose grid cell overlaps the circle; callers check exact distance. */
  forUnitsNear(x: number, y: number, r: number, fn: (u: Unit) => void): void {
    const c0 = Math.max(0, Math.floor((x - r) / GRID_CELL));
    const c1 = Math.min(this.gridCols - 1, Math.floor((x + r) / GRID_CELL));
    const r0 = Math.max(0, Math.floor((y - r) / GRID_CELL));
    const r1 = Math.min(this.gridCols - 1, Math.floor((y + r) / GRID_CELL));
    for (let cy = r0; cy <= r1; cy++) {
      for (let cx = c0; cx <= c1; cx++) {
        for (const u of this.grid[cy * this.gridCols + cx]) if (!u.dead) fn(u);
      }
    }
  }

  private rebuildGrid(): void {
    for (const cell of this.grid) cell.length = 0;
    const max = this.gridCols - 1;
    for (const u of this.units) {
      if (u.dead) continue;
      const cx = Math.max(0, Math.min(max, Math.floor(u.x / GRID_CELL)));
      const cy = Math.max(0, Math.min(max, Math.floor(u.y / GRID_CELL)));
      this.grid[cy * this.gridCols + cx].push(u);
    }
  }

  nearestDropoff(owner: number, x: number, y: number): Building | null {
    let best: Building | null = null;
    let bestD = Infinity;
    for (const b of this.buildings) {
      if (b.dead || b.owner !== owner || !b.built || !BUILDING_DEFS[b.type].dropoff) continue;
      const d = distToRect(x, y, rectOf(b));
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  nearestResource(res: Res, x: number, y: number, maxDist: number, player = -1, excludeId = 0): ResourceNode | null {
    let best: ResourceNode | null = null;
    let bestD = maxDist;
    for (const n of this.resources) {
      if (n.dead || n.res !== res || n.id === excludeId) continue;
      if (player >= 0 && !this.isVisibleTo(player, n)) continue;
      const d = Math.hypot(n.x - x, n.y - y);
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    return best;
  }

  /** Nearest visible deposit of any kind, e.g. for builders of a new storehouse. */
  nearestAnyResource(x: number, y: number, maxDist: number, player: number): ResourceNode | null {
    let best: ResourceNode | null = null;
    let bestD = maxDist;
    for (const n of this.resources) {
      if (n.dead || !this.isVisibleTo(player, n)) continue;
      const d = distToRect(x, y, rectOf(n));
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    return best;
  }

  farmWorkers(farm: Building, except?: Unit): number {
    let n = 0;
    for (const u of this.units) {
      if (u.dead || u === except || u.order.kind !== 'gather' || u.order.targetId !== farm.id) continue;
      n++;
    }
    return n;
  }

  /** Number of own, finished houses near a point (capped), for the morale bonus. */
  moraleAt(owner: number, x: number, y: number): number {
    let n = 0;
    for (const b of this.buildings) {
      if (b.dead || b.owner !== owner || b.type !== 'house' || !b.built) continue;
      if (Math.hypot(b.x - x, b.y - y) <= MORALE_RADIUS) n++;
      if (n >= MORALE_MAX_HOUSES) break;
    }
    return n;
  }

  /** Free tile next to a building, preferring the side facing `towards`. */
  findSpawnPoint(b: Building, towards: Point, skip = 0): Point | null {
    const candidates: Array<Point & { d: number }> = [];
    for (let ring = 1; ring <= 4 && candidates.length <= skip; ring++) {
      for (let y = b.ty - ring; y < b.ty + b.size + ring; y++) {
        for (let x = b.tx - ring; x < b.tx + b.size + ring; x++) {
          const onRing = x === b.tx - ring || y === b.ty - ring || x === b.tx + b.size + ring - 1 || y === b.ty + b.size + ring - 1;
          if (!onRing || !this.map.passable(x, y)) continue;
          candidates.push({ x: x + 0.5, y: y + 0.5, d: Math.hypot(x + 0.5 - towards.x, y + 0.5 - towards.y) });
        }
      }
    }
    if (candidates.length === 0) return null;
    candidates.sort((a, c) => a.d - c.d);
    const pick = candidates[Math.min(skip, candidates.length - 1)];
    return { x: pick.x, y: pick.y };
  }

  canPlace(owner: number, type: BuildingType, tx: number, ty: number): boolean {
    const size = BUILDING_DEFS[type].size;
    const vis = this.players[owner].vis;
    for (let y = ty; y < ty + size; y++) {
      for (let x = tx; x < tx + size; x++) {
        if (!this.map.buildable(x, y)) return false;
        if (!this.settings.revealMap && vis[this.map.idx(x, y)] === 0) return false;
      }
    }
    // Keep a one-tile gap to other buildings so units never get walled in.
    // Walls are meant to connect: to each other and to towers.
    const line = BUILDING_DEFS[type].line;
    for (const b of this.buildings) {
      if (b.dead || BUILDING_DEFS[b.type].walkable || type === 'farm') continue;
      const otherLine = BUILDING_DEFS[b.type].line;
      if ((line && (otherLine || b.type === 'tower')) || (type === 'tower' && otherLine)) continue;
      if (tx < b.tx + b.size + 1 && tx + size + 1 > b.tx && ty < b.ty + b.size + 1 && ty + size + 1 > b.ty) return false;
    }
    return true;
  }

  /** Whether a player may currently build a type (epoch requirement). */
  buildingUnlocked(owner: number, type: BuildingType): boolean {
    return this.players[owner].epoch >= BUILDING_DEFS[type].minEpoch;
  }

  isResearching(owner: number): boolean {
    return this.buildings.some((b) => !b.dead && b.owner === owner && b.research !== null);
  }

  emit(ev: GameEvent): void {
    this.events.push(ev);
  }

  alertAttack(owner: number, x: number, y: number): void {
    if (owner < 0 || this.tick - this.lastAlertTick[owner] < TICK_RATE * 12) return;
    this.lastAlertTick[owner] = this.tick;
    this.emit({ type: 'attack', player: owner, text: 'Wir werden angegriffen!', x, y });
  }

  // ---------------------------------------------------------------- commands

  issue(cmd: Command): void {
    if (this.over) return;
    const player = this.players[cmd.player];
    if (!player || !player.alive) return;
    switch (cmd.type) {
      case 'move':
        this.commandMove(cmd.player, cmd.ids, cmd.x, cmd.y, cmd.attackMove ?? false);
        break;
      case 'attack': {
        const target = this.get(cmd.targetId);
        if (!target || target.kind === 'resource' || !this.areEnemies(cmd.player, target.owner)) return;
        for (const u of this.ownUnits(cmd.player, cmd.ids)) {
          u.order = { kind: 'attack', targetId: target.id, resume: null, leash: null };
          u.path = [];
          u.repathTick = -1000;
        }
        break;
      }
      case 'gather': {
        const target = this.get(cmd.targetId);
        if (!target) return;
        const isFarm = target.kind === 'building' && target.type === 'farm' && target.owner === cmd.player;
        if (target.kind !== 'resource' && !isFarm) return;
        if (isFarm && !(target as Building).built) {
          this.issue({ type: 'construct', player: cmd.player, ids: cmd.ids, targetId: target.id });
          return;
        }
        const res: Res = target.kind === 'resource' ? target.res : 'food';
        const units = this.ownUnits(cmd.player, cmd.ids);
        for (const u of units) {
          if (u.role !== 'citizen') continue;
          u.order = { kind: 'gather', targetId: target.id, res, phase: 'toNode', dropId: 0, lx: target.x, ly: target.y };
          u.path = [];
          u.repathTick = -1000;
        }
        const others = units.filter((u) => u.role !== 'citizen').map((u) => u.id);
        if (others.length) this.commandMove(cmd.player, others, target.x, target.y, false);
        break;
      }
      case 'construct': {
        const target = this.get(cmd.targetId);
        if (!target || target.kind !== 'building' || target.owner !== cmd.player) return;
        if (target.built && target.hp >= target.maxHp) return;
        for (const u of this.ownUnits(cmd.player, cmd.ids)) {
          if (u.role !== 'citizen') continue;
          u.order = { kind: 'build', targetId: target.id };
          u.path = [];
          u.repathTick = -1000;
        }
        break;
      }
      case 'place':
        this.commandPlace(cmd.player, cmd.ids, cmd.building, cmd.tx, cmd.ty);
        break;
      case 'placeLine':
        this.commandPlaceLine(cmd.player, cmd.ids, cmd.building, cmd.tiles);
        break;
      case 'train':
        for (let i = 0; i < (cmd.count ?? 1); i++) if (!this.commandTrain(cmd.player, cmd.buildingId, cmd.role)) break;
        break;
      case 'cancel': {
        const b = this.get(cmd.buildingId);
        if (!b || b.kind !== 'building' || b.owner !== cmd.player) return;
        if (cmd.index < 0) {
          if (b.research) {
            refund(player.stock, EPOCHS[b.research.targetEpoch].advanceCost);
            b.research = null;
          }
          return;
        }
        const item = b.queue[cmd.index];
        if (!item) return;
        b.queue.splice(cmd.index, 1);
        refund(player.stock, item.cost);
        break;
      }
      case 'advance':
        this.commandAdvance(cmd.player, cmd.buildingId);
        break;
      case 'rally': {
        const b = this.get(cmd.buildingId);
        if (b && b.kind === 'building' && b.owner === cmd.player) b.rally = { x: cmd.x, y: cmd.y };
        break;
      }
      case 'deposit': {
        const target = this.get(cmd.targetId);
        if (!target || target.kind !== 'building' || target.owner !== cmd.player || !target.built) return;
        if (!BUILDING_DEFS[target.type].dropoff) return;
        for (const u of this.ownUnits(cmd.player, cmd.ids)) {
          if (u.role !== 'citizen' || !u.carry || u.carryAmount <= 0) continue;
          // Gatherers go back to their node afterwards.
          const o = u.order;
          const resume = o.kind === 'gather' ? { ...o } : o.kind === 'deposit' ? o.resume : null;
          u.order = { kind: 'deposit', targetId: target.id, resume };
          u.path = [];
          u.repathTick = -1000;
        }
        break;
      }
      case 'stop':
        for (const u of this.ownUnits(cmd.player, cmd.ids)) {
          u.order = { kind: 'idle' };
          u.path = [];
        }
        break;
      case 'destroy':
        for (const id of cmd.ids) {
          const e = this.get(id);
          if (!e || e.kind === 'resource' || e.owner !== cmd.player) continue;
          // Construction sites give back what has not been built yet.
          if (e.kind === 'building' && !e.built) refund(player.stock, multiplyCost(BUILDING_DEFS[e.type].cost, 1 - e.progress));
          this.kill(e, -1);
        }
        break;
    }
  }

  private ownUnits(player: number, ids: number[]): Unit[] {
    const out: Unit[] = [];
    for (const id of ids) {
      const e = this.get(id);
      if (e && e.kind === 'unit' && e.owner === player) out.push(e);
    }
    return out;
  }

  private commandMove(player: number, ids: number[], x: number, y: number, attackMove: boolean): void {
    const units = this.ownUnits(player, ids);
    if (units.length === 0) return;
    // Square formation around the target, closest slots go to the closest units.
    const cols = Math.ceil(Math.sqrt(units.length));
    const spacing = 0.85;
    const slots: Point[] = [];
    for (let i = 0; i < units.length; i++) {
      const cx = (i % cols) - (cols - 1) / 2;
      const cy = Math.floor(i / cols) - (Math.ceil(units.length / cols) - 1) / 2;
      slots.push({ x: x + cx * spacing, y: y + cy * spacing });
    }
    const cx = units.reduce((s, u) => s + u.x, 0) / units.length;
    const cy = units.reduce((s, u) => s + u.y, 0) / units.length;
    const dir = Math.atan2(y - cy, x - cx);
    units.sort((a, b) => Math.cos(dir) * (a.x - b.x) + Math.sin(dir) * (a.y - b.y));
    slots.sort((a, b) => Math.cos(dir) * (a.x - b.x) + Math.sin(dir) * (a.y - b.y));
    units.forEach((u, i) => {
      let slot = slots[i];
      if (!this.map.passableFor(Math.floor(slot.x), Math.floor(slot.y), this.teamOf(player))) {
        const near = this.map.nearestPassable(slot.x, slot.y, 6);
        slot = near ? { x: near.x + 0.5, y: near.y + 0.5 } : { x, y };
      }
      u.order = { kind: 'move', x: slot.x, y: slot.y, attackMove };
      setPathTo(this, u, { kind: 'point', x: slot.x, y: slot.y });
    });
  }

  private commandPlace(player: number, ids: number[], type: BuildingType, tx: number, ty: number): void {
    const p = this.players[player];
    const def = BUILDING_DEFS[type];
    if (!this.buildingUnlocked(player, type)) return;
    if (!this.canPlace(player, type, tx, ty)) {
      this.emit({ type: 'warn', player, text: 'Hier kann nicht gebaut werden.' });
      return;
    }
    if (!canAfford(p.stock, def.cost)) {
      this.emit({ type: 'warn', player, text: `Nicht genug Rohstoffe: ${missingText(p.stock, def.cost)}` });
      return;
    }
    pay(p.stock, def.cost);
    const b = this.addBuilding(player, type, tx, ty, false);
    this.issue({ type: 'construct', player, ids, targetId: b.id });
  }

  private commandPlaceLine(player: number, ids: number[], type: BuildingType, tiles: Point[]): void {
    const p = this.players[player];
    const def = BUILDING_DEFS[type];
    if (!def.line || !this.buildingUnlocked(player, type)) return;
    const placed: Building[] = [];
    let short = false;
    for (const t of tiles.slice(0, MAX_LINE)) {
      if (!this.canPlace(player, type, t.x, t.y)) continue;
      if (!canAfford(p.stock, def.cost)) {
        short = true;
        break;
      }
      pay(p.stock, def.cost);
      placed.push(this.addBuilding(player, type, t.x, t.y, false));
    }
    if (short) this.emit({ type: 'warn', player, text: `Nicht genug Rohstoffe: ${missingText(p.stock, def.cost)}` });
    else if (placed.length === 0) this.emit({ type: 'warn', player, text: 'Hier kann nicht gebaut werden.' });
    if (placed.length === 0) return;
    // Spread the builders along the line; each walks on to the nearest open segment.
    const builders = this.ownUnits(player, ids).filter((u) => u.role === 'citizen');
    builders.forEach((u, i) => {
      const seg = placed[Math.floor((i * placed.length) / builders.length)];
      u.order = { kind: 'build', targetId: seg.id };
      u.path = [];
      u.repathTick = -1000;
    });
  }

  private commandTrain(player: number, buildingId: number, role: Role): boolean {
    const p = this.players[player];
    const b = this.get(buildingId);
    if (!b || b.kind !== 'building' || b.owner !== player || !b.built) return false;
    if (!BUILDING_DEFS[b.type].trains.includes(role)) return false;
    const tier = bestTier(role, p.epoch);
    if (tier < 0) return false;
    if (b.queue.length >= 10) {
      this.emit({ type: 'warn', player, text: 'Die Warteschlange ist voll.' });
      return false;
    }
    const cost: Cost = unitStats(role, tier).cost;
    if (!canAfford(p.stock, cost)) {
      this.emit({ type: 'warn', player, text: `Nicht genug Rohstoffe: ${missingText(p.stock, cost)}` });
      return false;
    }
    pay(p.stock, cost);
    b.queue.push({ role, progress: 0, cost });
    return true;
  }

  private commandAdvance(player: number, buildingId: number): void {
    const p = this.players[player];
    const b = this.get(buildingId);
    if (!b || b.kind !== 'building' || b.owner !== player || b.type !== 'towncenter' || !b.built) return;
    if (p.epoch >= this.settings.maxEpoch) {
      this.emit({ type: 'warn', player, text: 'Die letzte Epoche dieses Spiels ist erreicht.' });
      return;
    }
    if (this.isResearching(player)) return;
    const next = EPOCHS[p.epoch + 1];
    if (!canAfford(p.stock, next.advanceCost)) {
      this.emit({ type: 'warn', player, text: `Nicht genug Rohstoffe: ${missingText(p.stock, next.advanceCost)}` });
      return;
    }
    pay(p.stock, next.advanceCost);
    b.research = { targetEpoch: next.index, progress: 0, total: next.advanceTime };
  }

  // -------------------------------------------------------------- simulation

  step(): void {
    if (this.over) return;
    this.tick++;
    for (const c of this.controllers) {
      if (this.players[c.playerId].alive) c.update(this);
    }
    for (const u of this.units) {
      u.px = u.x;
      u.py = u.y;
    }
    for (const b of this.buildings) if (!b.dead) updateBuilding(this, b);
    for (const u of this.units) if (!u.dead) updateUnit(this, u);
    separateUnits(this);
    updateProjectiles(this);
    for (const fx of this.effects) fx.t += DT;
    this.effects = this.effects.filter((fx) => fx.t < fx.dur);

    if (this.tick % 20 === 0) {
      for (const u of this.units) if (!u.dead) u.morale = this.moraleAt(u.owner, u.x, u.y);
      this.checkVictory();
    }
    this.compact();
    this.rebuildGrid();
    if (this.tick % 5 === 0) updateVision(this);
  }

  /** Drops dead entities from the lookup tables. */
  compact(): void {
    let changed = false;
    for (const list of [this.units, this.buildings, this.resources] as Entity[][]) {
      for (const e of list) if (e.dead) changed = true;
    }
    if (!changed) return;
    for (const [id, e] of this.entities) if (e.dead) this.entities.delete(id);
    this.units = this.units.filter((u) => !u.dead);
    this.buildings = this.buildings.filter((b) => !b.dead);
    this.resources = this.resources.filter((r) => !r.dead);
  }

  kill(e: Unit | Building, killerOwner: number): void {
    if (e.dead) return;
    this.remove(e);
    const owner = this.players[e.owner];
    if (killerOwner >= 0 && killerOwner !== e.owner) this.players[killerOwner].stats.kills++;
    if (e.kind === 'unit') {
      owner.stats.unitsLost++;
    } else {
      owner.stats.buildingsLost++;
      this.effects.push({ kind: 'collapse', x: e.x, y: e.y, t: 0, dur: 1.6, size: e.size });
      if (e.type === 'towncenter') {
        this.emit({ type: 'warn', player: e.owner, text: `${buildingName(e.type, e.epoch)} wurde zerstört!`, x: e.x, y: e.y });
      }
    }
  }

  private checkVictory(): void {
    for (const p of this.players) {
      if (!p.alive) continue;
      // Walls alone do not keep an empire alive.
      const hasBuilding = this.buildings.some((b) => !b.dead && b.owner === p.id && !BUILDING_DEFS[b.type].line);
      const hasCitizen = this.units.some((u) => !u.dead && u.owner === p.id && u.role === 'citizen');
      if (!hasBuilding && !hasCitizen) {
        p.alive = false;
        for (const u of this.units) if (u.owner === p.id) this.remove(u);
        for (const q of this.players) {
          this.emit({ type: 'info', player: q.id, text: q.id === p.id ? 'Dein Reich ist gefallen.' : `${p.name} wurde besiegt.` });
        }
      }
    }
    const teams = new Set(this.players.filter((p) => p.alive).map((p) => p.team));
    if (teams.size <= 1) {
      this.over = true;
      this.winnerTeam = teams.size === 1 ? [...teams][0] : null;
      for (const q of this.players) {
        this.emit({ type: 'gameover', player: q.id, text: q.team === this.winnerTeam ? 'Sieg!' : 'Niederlage' });
      }
    }
  }

  /** Name of a unit role's current tier for a player (for buttons). */
  roleName(player: number, role: Role): string | null {
    const tier = bestTier(role, this.players[player].epoch);
    return tier < 0 ? null : ROLE_DEFS[role].tiers[tier].name;
  }
}
