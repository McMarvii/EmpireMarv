import { buildingAttack, BUILDING_DEFS, buildingMaxHp, buildingName, MORALE_MAX_HOUSES, MORALE_RADIUS, type BuildingType } from '../data/buildings';
import { EPOCHS, LAST_EPOCH } from '../data/epochs';
import { canAfford, emptyStock, missingText, pay, refund, RESOURCES, multiplyCost, type Cost, type Res } from '../data/resources';
import { modsFor, TECH_BY_ID, TECHS, TECHS_FOR_ADVANCE, type Tech } from '../data/techs';
import { bestTier, CARRY_CAPACITY, ROLE_DEFS, unitStats, type Look, type Projectile, type Role, type UnitStats } from '../data/units';
import { isEndless, orderTarget, startPlan, updateBuilding, updateUnit, separateUnits } from './behavior';
import { updateProjectiles } from './combat';
import { rectOf, type Building, type Entity, type NodeType, type Plan, type Player, type ResourceNode, type Unit } from './entities';
import { arrivalPace, DEFAULT_FORMATION, formationSlots, headingTo, type Formation } from './formation';
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
  type: 'info' | 'warn' | 'epoch' | 'attack' | 'built' | 'trained' | 'tech' | 'gameover';
  player: number;
  text: string;
  /** Epoch events: the epoch that was reached. */
  epoch?: number;
  /** Tech events: the finished technology. */
  tech?: string;
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

/**
 * Something audible happened. The client turns cues into sound; the
 * simulation never reads them back, so they cannot affect determinism.
 */
export interface SoundCue {
  kind: 'shot' | 'melee' | 'impact' | 'blast' | 'death' | 'collapse' | 'work';
  x: number;
  y: number;
  owner: number;
  /** Epoch of the unit tier or building: decides the material (club, sword, rifle …). */
  epoch?: number;
  look?: Look;
  projectile?: Projectile;
  /** Work cues: what is being worked on. */
  work?: Res | 'build';
  size?: number;
}

/** Cues kept until the client drains them; headless runs simply stop recording. */
const MAX_CUES = 256;

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

/**
 * Everything players and the AI can do. `queue` (Shift) appends a command
 * to the units' order queue instead of replacing what they are doing.
 */
export type Command =
  /** `facing`: direction the formation's front points to (radians); default is the walking direction. */
  | { type: 'move'; player: number; ids: number[]; x: number; y: number; attackMove?: boolean; queue?: boolean; facing?: number }
  | { type: 'attack'; player: number; ids: number[]; targetId: number; queue?: boolean }
  | { type: 'gather'; player: number; ids: number[]; targetId: number; queue?: boolean }
  | { type: 'construct'; player: number; ids: number[]; targetId: number; queue?: boolean }
  | { type: 'place'; player: number; ids: number[]; building: BuildingType; tx: number; ty: number; queue?: boolean }
  /** A line of wall or gate segments, placed from the first tile on as far as resources allow. */
  | { type: 'placeLine'; player: number; ids: number[]; building: BuildingType; tiles: Point[]; queue?: boolean }
  /** Walk between where the units are (or will be) and this point, fighting what comes along. */
  | { type: 'patrol'; player: number; ids: number[]; x: number; y: number; queue?: boolean }
  | { type: 'formation'; player: number; ids: number[]; formation: Formation }
  | { type: 'train'; player: number; buildingId: number; role: Role; count?: number }
  | { type: 'cancel'; player: number; buildingId: number; index: number }
  | { type: 'advance'; player: number; buildingId: number }
  | { type: 'research'; player: number; buildingId: number; tech: string }
  /** Cancels the running tech (no index) or a waiting one (index into the tech queue). */
  | { type: 'cancelTech'; player: number; buildingId: number; index?: number }
  | { type: 'rally'; player: number; buildingId: number; x: number; y: number; queue?: boolean }
  | { type: 'deposit'; player: number; ids: number[]; targetId: number; queue?: boolean }
  | { type: 'explore'; player: number; ids: number[]; queue?: boolean }
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
/** Queued orders per unit (enough for a full wall line). */
export const MAX_QUEUE = 40;
/** Rally waypoints per building. */
export const MAX_RALLY = 8;
/** Technologies that may wait in one building's research queue. */
export const MAX_TECH_QUEUE = 5;

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
  cues: SoundCue[] = [];
  controllers: Controller[] = [];
  over = false;
  winnerTeam: number | null = null;

  private nextId = 1;
  /** Unit stats with each player's tech bonuses, per "role:tier". */
  private statCache: Array<Map<string, UnitStats>> = [];
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
        techs: new Set(),
        mods: modsFor([]),
      });
      this.statCache.push(new Map());
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
      const scoutSpot = this.findSpawnPoint(tc, { x: start.x + 4, y: start.y - 4 });
      if (scoutSpot) this.spawnUnit(p.id, 'scout', scoutSpot.x, scoutSpot.y);
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
    const stats = this.unitStatsFor(owner, role, Math.max(0, tier));
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
      queue: [],
      formation: DEFAULT_FORMATION,
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
    const maxHp = this.buildingMaxHpFor(owner, type, epoch);
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
      tech: null,
      techQueue: [],
      pendingAdvance: null,
      rally: [],
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

  // ------------------------------------------------------------ tech bonuses

  /** A role's stats at a tier, with the owner's researched bonuses. */
  unitStatsFor(owner: number, role: Role, tier: number): UnitStats {
    const base = unitStats(role, tier);
    if (owner < 0) return base;
    const cache = this.statCache[owner];
    const key = `${role}:${tier}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const m = this.players[owner].mods.unit[role];
    const range = base.range + m.range;
    const stats: UnitStats = {
      ...base,
      hp: Math.round(base.hp * m.hp),
      dmg: Math.round(base.dmg * m.dmg * 10) / 10,
      // Armor bonuses grow with the tier's epoch, like the base value does.
      armor: Math.round((base.armor + m.armor * (1 + 0.22 * base.epoch)) * 10) / 10,
      speed: base.speed * m.speed,
      range,
      sight: Math.max(base.sight + m.sight, range + 1.5),
    };
    cache.set(key, stats);
    return stats;
  }

  buildingMaxHpFor(owner: number, type: BuildingType, epoch: number): number {
    const m = this.players[owner].mods;
    return Math.round(buildingMaxHp(type, epoch) * m.buildingHpAll * (m.buildingHp[type] ?? 1));
  }

  /** Tower and town center fire, with Mathematik and Wachdienst. */
  buildingAttackFor(owner: number, type: BuildingType) {
    const a = buildingAttack(type, this.players[owner].epoch);
    if (!a) return undefined;
    const m = this.players[owner].mods;
    return { dmg: a.dmg * m.towerDmg, range: a.range + m.towerRange, cooldown: a.cooldown };
  }

  carryCapacity(owner: number): number {
    return CARRY_CAPACITY + this.players[owner].mods.carry;
  }

  /** Whether a tech can be started now (epoch, prerequisites, not done, running or queued). */
  techAvailable(owner: number, tech: Tech): boolean {
    const p = this.players[owner];
    if (p.techs.has(tech.id) || tech.epoch > p.epoch) return false;
    if (!tech.requires.every((r) => p.techs.has(r))) return false;
    return !this.plannedTechs(owner).has(tech.id);
  }

  /** Researched, running and queued techs of a player. */
  plannedTechs(owner: number): Set<string> {
    const out = new Set(this.players[owner].techs);
    for (const b of this.buildings) {
      if (b.dead || b.owner !== owner) continue;
      if (b.tech) out.add(b.tech.id);
      for (const q of b.techQueue) out.add(q.id);
    }
    return out;
  }

  /** Whether a tech may be queued: like available, but prerequisites may still be running or queued. */
  techPlannable(owner: number, tech: Tech): boolean {
    const planned = this.plannedTechs(owner);
    return tech.epoch <= this.players[owner].epoch && !planned.has(tech.id) && tech.requires.every((r) => planned.has(r));
  }

  /** Starts the first waiting tech of a building once the building is free and its prerequisites are done. */
  startQueuedTech(b: Building): void {
    if (b.tech || b.research || !b.built || b.techQueue.length === 0) return;
    const head = b.techQueue[0];
    const tech = TECH_BY_ID.get(head.id)!;
    if (!tech.requires.every((r) => this.players[b.owner].techs.has(r))) return;
    b.techQueue.shift();
    b.tech = { id: tech.id, progress: 0, total: tech.time, cost: head.cost };
  }

  /**
   * Drops (and refunds) queued techs whose prerequisites can no longer come,
   * e.g. after a cancel or when the building researching them was destroyed.
   */
  private pruneTechQueues(owner: number): void {
    const p = this.players[owner];
    for (let changed = true; changed; ) {
      changed = false;
      const planned = this.plannedTechs(owner);
      for (const b of this.buildings) {
        if (b.dead || b.owner !== owner) continue;
        for (let i = b.techQueue.length - 1; i >= 0; i--) {
          if (TECH_BY_ID.get(b.techQueue[i].id)!.requires.every((r) => planned.has(r))) continue;
          refund(p.stock, b.techQueue[i].cost);
          b.techQueue.splice(i, 1);
          changed = true;
        }
      }
    }
  }

  /** Techs of the current epoch still missing for the next advance. */
  missingTechs(owner: number): { have: number; need: number } {
    const p = this.players[owner];
    let have = 0;
    for (const id of p.techs) if (TECH_BY_ID.get(id)?.epoch === p.epoch) have++;
    const offered = TECHS.filter((t) => t.epoch === p.epoch).length;
    return { have, need: Math.min(TECHS_FOR_ADVANCE, offered) };
  }

  /** Applies a finished tech: new bonuses for every unit and building of the player. */
  completeTech(owner: number, id: string): void {
    const p = this.players[owner];
    if (p.techs.has(id) || !TECH_BY_ID.has(id)) return;
    p.techs.add(id);
    p.mods = modsFor(p.techs);
    this.statCache[owner].clear();
    for (const u of this.units) {
      if (u.dead || u.owner !== owner) continue;
      const ratio = u.hp / u.maxHp;
      u.stats = this.unitStatsFor(owner, u.role, u.tier);
      u.maxHp = u.stats.hp;
      u.hp = Math.max(1, ratio * u.maxHp);
    }
    for (const b of this.buildings) {
      if (b.dead || b.owner !== owner) continue;
      const ratio = b.hp / b.maxHp;
      b.maxHp = this.buildingMaxHpFor(owner, b.type, b.epoch);
      b.hp = Math.max(1, ratio * b.maxHp);
    }
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
      blockedUntil: 0,
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
      if (n.dead || n.res !== res || n.id === excludeId || n.blockedUntil > this.tick) continue;
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
      if (n.dead || n.blockedUntil > this.tick || !this.isVisibleTo(player, n)) continue;
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

  /** Buildings still missing for the next epoch's advance (finished ones count). */
  missingRequirements(owner: number): Array<{ type: BuildingType; have: number; need: number }> {
    const p = this.players[owner];
    if (p.epoch >= LAST_EPOCH) return [];
    const out: Array<{ type: BuildingType; have: number; need: number }> = [];
    for (const [type, need] of Object.entries(EPOCHS[p.epoch + 1].requires) as Array<[BuildingType, number]>) {
      const have = this.buildings.filter((b) => !b.dead && b.built && b.owner === owner && b.type === type).length;
      if (have < need) out.push({ type, have, need });
    }
    return out;
  }

  isResearching(owner: number): boolean {
    return this.buildings.some((b) => !b.dead && b.owner === owner && (b.research !== null || b.pendingAdvance !== null));
  }

  emit(ev: GameEvent): void {
    this.events.push(ev);
  }

  cue(c: SoundCue): void {
    if (this.cues.length < MAX_CUES) this.cues.push(c);
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
        this.commandMove(cmd.player, cmd.ids, cmd.x, cmd.y, cmd.attackMove ?? false, cmd.queue ?? false, cmd.facing);
        break;
      case 'attack': {
        const target = this.get(cmd.targetId);
        if (!target || target.kind === 'resource' || !this.areEnemies(cmd.player, target.owner)) return;
        for (const u of this.ownUnits(cmd.player, cmd.ids)) this.assign(u, { kind: 'attack', targetId: target.id }, cmd.queue ?? false);
        break;
      }
      case 'patrol':
        this.commandPatrol(cmd.player, cmd.ids, cmd.x, cmd.y, cmd.queue ?? false);
        break;
      case 'formation':
        this.commandFormation(cmd.player, cmd.ids, cmd.formation);
        break;
      case 'gather': {
        const target = this.get(cmd.targetId);
        if (!target) return;
        const isFarm = target.kind === 'building' && target.type === 'farm' && target.owner === cmd.player;
        if (target.kind !== 'resource' && !isFarm) return;
        if (isFarm && !(target as Building).built) {
          this.issue({ type: 'construct', player: cmd.player, ids: cmd.ids, targetId: target.id, queue: cmd.queue });
          return;
        }
        const res: Res = target.kind === 'resource' ? target.res : 'food';
        const units = this.ownUnits(cmd.player, cmd.ids);
        for (const u of units) {
          if (u.role === 'citizen') this.assign(u, { kind: 'gather', targetId: target.id, res, lx: target.x, ly: target.y }, cmd.queue ?? false);
        }
        const others = units.filter((u) => u.role !== 'citizen').map((u) => u.id);
        if (others.length) this.commandMove(cmd.player, others, target.x, target.y, false, cmd.queue ?? false);
        break;
      }
      case 'construct': {
        const target = this.get(cmd.targetId);
        if (!target || target.kind !== 'building' || target.owner !== cmd.player) return;
        if (target.built && target.hp >= target.maxHp) return;
        for (const u of this.ownUnits(cmd.player, cmd.ids)) {
          if (u.role === 'citizen') this.assign(u, { kind: 'build', targetId: target.id }, cmd.queue ?? false);
        }
        break;
      }
      case 'place':
        this.commandPlace(cmd.player, cmd.ids, cmd.building, cmd.tx, cmd.ty, cmd.queue ?? false);
        break;
      case 'placeLine':
        this.commandPlaceLine(cmd.player, cmd.ids, cmd.building, cmd.tiles, cmd.queue ?? false);
        break;
      case 'train':
        for (let i = 0; i < (cmd.count ?? 1); i++) if (!this.commandTrain(cmd.player, cmd.buildingId, cmd.role)) break;
        break;
      case 'cancel': {
        const b = this.get(cmd.buildingId);
        if (!b || b.kind !== 'building' || b.owner !== cmd.player) return;
        if (cmd.index < 0) {
          const target = b.research?.targetEpoch ?? b.pendingAdvance?.targetEpoch;
          if (target !== undefined) refund(player.stock, EPOCHS[target].advanceCost);
          b.research = null;
          b.pendingAdvance = null;
          return;
        }
        const item = b.queue[cmd.index];
        if (!item) return;
        b.queue.splice(cmd.index, 1);
        refund(player.stock, item.cost);
        // One unit fewer to wait for before the advance.
        if (b.pendingAdvance && cmd.index < b.pendingAdvance.ahead) b.pendingAdvance.ahead--;
        break;
      }
      case 'advance':
        this.commandAdvance(cmd.player, cmd.buildingId);
        break;
      case 'research':
        this.commandResearch(cmd.player, cmd.buildingId, cmd.tech);
        break;
      case 'cancelTech': {
        const b = this.get(cmd.buildingId);
        if (!b || b.kind !== 'building' || b.owner !== cmd.player) return;
        if (cmd.index === undefined || cmd.index < 0) {
          if (!b.tech) return;
          refund(player.stock, b.tech.cost);
          b.tech = null;
        } else {
          const job = b.techQueue[cmd.index];
          if (!job) return;
          refund(player.stock, job.cost);
          b.techQueue.splice(cmd.index, 1);
        }
        this.pruneTechQueues(cmd.player);
        this.startQueuedTech(b);
        break;
      }
      case 'rally': {
        const b = this.get(cmd.buildingId);
        if (!b || b.kind !== 'building' || b.owner !== cmd.player) return;
        if (!cmd.queue) b.rally = [];
        if (b.rally.length < MAX_RALLY) b.rally.push({ x: cmd.x, y: cmd.y });
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
          this.assign(u, { kind: 'deposit', targetId: target.id, resume }, cmd.queue ?? false);
        }
        break;
      }
      case 'explore':
        for (const u of this.ownUnits(cmd.player, cmd.ids)) this.assign(u, { kind: 'explore' }, cmd.queue ?? false);
        break;
      case 'stop':
        for (const u of this.ownUnits(cmd.player, cmd.ids)) {
          u.order = { kind: 'idle' };
          u.queue = [];
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

  /**
   * Starts a command now, or queues it behind the current order (Shift).
   * Orders that never end on their own (idle, gathering, exploring,
   * patrolling) give way at once, so a queued build doesn't wait forever.
   */
  private assign(u: Unit, plan: Plan, queue: boolean): void {
    if (queue && !isEndless(u.order)) {
      if (u.queue.length < MAX_QUEUE) u.queue.push(plan);
      return;
    }
    if (!queue) u.queue = [];
    startPlan(this, u, plan);
  }

  /** Where a unit will be once its current and queued orders are done. */
  private plannedEnd(u: Unit): Point {
    for (let i = u.queue.length - 1; i >= 0; i--) {
      const t = orderTarget(this, u.queue[i]);
      if (t) return t;
    }
    const t = isEndless(u.order) ? null : orderTarget(this, u.order);
    return t ?? { x: u.x, y: u.y };
  }

  /**
   * Slots for a group in the formation most of its units use, around (x, y).
   * Slots on blocked ground move to the nearest free tile.
   */
  private formationTargets(player: number, units: Unit[], starts: Point[], x: number, y: number, facing?: number): Point[] {
    const members = units.map((u, i) => ({ id: u.id, role: u.role, x: starts[i].x, y: starts[i].y, facing: u.facing }));
    const votes = new Map<Formation, number>();
    for (const u of units) votes.set(u.formation, (votes.get(u.formation) ?? 0) + 1);
    let kind = units[0].formation;
    for (const [f, n] of votes) if (n > (votes.get(kind) ?? 0)) kind = f;
    const slots = new Map(formationSlots(members, kind, x, y, facing ?? headingTo(members, x, y)).map((s) => [s.id, s]));
    const team = this.teamOf(player);
    return units.map((u) => {
      const slot = slots.get(u.id)!;
      if (this.map.passableFor(Math.floor(slot.x), Math.floor(slot.y), team)) return { x: slot.x, y: slot.y };
      const near = this.map.nearestPassable(slot.x, slot.y, 6);
      return near ? { x: near.x + 0.5, y: near.y + 0.5 } : { x, y };
    });
  }

  private commandMove(player: number, ids: number[], x: number, y: number, attackMove: boolean, queue = false, facing?: number): void {
    const units = this.ownUnits(player, ids);
    if (units.length === 0) return;
    const starts = units.map((u) => (queue ? this.plannedEnd(u) : { x: u.x, y: u.y }));
    const targets = this.formationTargets(player, units, starts, x, y, facing);
    // Everybody arrives together: the fast ones slow down to the group's pace.
    const pace = units.length > 1 ? arrivalPace(units.map((u, i) => ({ id: u.id, x: starts[i].x, y: starts[i].y, speed: u.stats.speed })), targets) : null;
    units.forEach((u, i) => {
      this.assign(u, { kind: 'move', x: targets[i].x, y: targets[i].y, attackMove, pace: pace?.get(u.id) }, queue);
    });
  }

  private commandPatrol(player: number, ids: number[], x: number, y: number, queue: boolean): void {
    const units = this.ownUnits(player, ids);
    if (units.length === 0) return;
    const starts = units.map((u) => (queue ? this.plannedEnd(u) : { x: u.x, y: u.y }));
    const targets = this.formationTargets(player, units, starts, x, y);
    units.forEach((u, i) => {
      const p = targets[i];
      // Shift on a patrol adds a point to the round.
      const last = u.queue[u.queue.length - 1];
      if (queue && last?.kind === 'patrol') {
        if (last.points.length < MAX_RALLY) last.points.push(p);
      } else if (queue && u.queue.length === 0 && u.order.kind === 'patrol') {
        if (u.order.points.length < MAX_RALLY) u.order.points.push(p);
      } else {
        this.assign(u, { kind: 'patrol', points: [{ ...starts[i] }, p] }, queue);
      }
    });
  }

  /** Sets the formation and lets idle or walking groups take it up right away. */
  private commandFormation(player: number, ids: number[], formation: Formation): void {
    const units = this.ownUnits(player, ids);
    for (const u of units) u.formation = formation;
    const idle = units.filter((u) => u.order.kind === 'idle' && u.queue.length === 0);
    if (idle.length > 1) {
      const cx = idle.reduce((s, u) => s + u.x, 0) / idle.length;
      const cy = idle.reduce((s, u) => s + u.y, 0) / idle.length;
      this.commandMove(player, idle.map((u) => u.id), cx, cy, false);
    }
    const walking = units.filter((u) => u.order.kind === 'move' && u.queue.length === 0);
    if (walking.length > 1) {
      const goals = walking.map((u) => orderTarget(this, u.order)!);
      const gx = goals.reduce((s, p) => s + p.x, 0) / goals.length;
      const gy = goals.reduce((s, p) => s + p.y, 0) / goals.length;
      const attackMove = walking.some((u) => u.order.kind === 'move' && u.order.attackMove);
      this.commandMove(player, walking.map((u) => u.id), gx, gy, attackMove);
    }
  }

  private commandPlace(player: number, ids: number[], type: BuildingType, tx: number, ty: number, queue: boolean): void {
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
    this.issue({ type: 'construct', player, ids, targetId: b.id, queue });
  }

  private commandPlaceLine(player: number, ids: number[], type: BuildingType, tiles: Point[], queue: boolean): void {
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
    const builders = this.ownUnits(player, ids).filter((u) => u.role === 'citizen');
    if (queue) {
      // Queued: the whole crew works the line segment by segment after its other jobs.
      for (const u of builders) for (const seg of placed) this.assign(u, { kind: 'build', targetId: seg.id }, true);
      return;
    }
    // Spread the builders along the line; each walks on to the nearest open segment.
    builders.forEach((u, i) => {
      const seg = placed[Math.floor((i * placed.length) / builders.length)];
      this.assign(u, { kind: 'build', targetId: seg.id }, false);
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

  private commandResearch(player: number, buildingId: number, id: string): void {
    const p = this.players[player];
    const b = this.get(buildingId);
    const tech = TECH_BY_ID.get(id);
    if (!tech || !b || b.kind !== 'building' || b.owner !== player || !b.built || b.type !== tech.building) return;
    if (!this.techPlannable(player, tech)) return;
    if (b.techQueue.length >= MAX_TECH_QUEUE) {
      this.emit({ type: 'warn', player, text: 'Die Forschungs-Warteschlange ist voll.' });
      return;
    }
    if (!canAfford(p.stock, tech.cost)) {
      this.emit({ type: 'warn', player, text: `Nicht genug Rohstoffe: ${missingText(p.stock, tech.cost)}` });
      return;
    }
    pay(p.stock, tech.cost);
    // Queued behind what runs here; starts right away when the building is free.
    b.techQueue.push({ id, cost: tech.cost });
    this.startQueuedTech(b);
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
    const missing = this.missingRequirements(player);
    const techs = this.missingTechs(player);
    if (missing.length || techs.have < techs.need) {
      const list = missing.map((m) => `${m.need - m.have}× ${buildingName(m.type, p.epoch)}`);
      if (techs.have < techs.need) list.push(`${techs.need - techs.have} Technik(en) dieser Epoche`);
      this.emit({ type: 'warn', player, text: `Für den Aufstieg fehlt: ${list.join(', ')}` });
      return;
    }
    if (!canAfford(p.stock, next.advanceCost)) {
      this.emit({ type: 'warn', player, text: `Nicht genug Rohstoffe: ${missingText(p.stock, next.advanceCost)}` });
      return;
    }
    pay(p.stock, next.advanceCost);
    // Units already queued are finished first; later ones wait for the new epoch.
    if (b.queue.length) b.pendingAdvance = { targetEpoch: next.index, ahead: b.queue.length };
    else b.research = { targetEpoch: next.index, progress: 0, total: next.advanceTime };
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
      this.cue({ kind: 'death', x: e.x, y: e.y, owner: e.owner, epoch: e.stats.epoch, look: e.stats.look });
    } else {
      owner.stats.buildingsLost++;
      this.cue({ kind: 'collapse', x: e.x, y: e.y, owner: e.owner, epoch: e.epoch, size: e.size });
      // Research that depended on what ran here can no longer come.
      if (e.tech || e.techQueue.length) this.pruneTechQueues(e.owner);
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
