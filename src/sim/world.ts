import { ABILITIES, ABILITY_BY_ID, STATUSES, type AbilityId } from '../data/abilities';
import {
  buildingAttack,
  buildingCost,
  BUILDING_DEFS,
  buildingMaxHp,
  buildingName,
  MORALE_MAX,
  MORALE_MAX_HOUSES,
  MORALE_RADIUS,
  type BuildingType,
} from '../data/buildings';
import { epochStyle, EPOCHS, LAST_EPOCH } from '../data/epochs';
import { canAfford, emptyStock, missingText, pay, refund, RESOURCES, multiplyCost, type Cost, type Res } from '../data/resources';
import { modsFor, TECH_BY_ID, TECHS, TECHS_FOR_ADVANCE, type Tech } from '../data/techs';
import {
  bestTier,
  CARRY_CAPACITY,
  domainOf,
  isAir,
  isConvertible,
  isHero,
  isNaval,
  isPlane,
  MAX_FAITH,
  ROLE_DEFS,
  TRANSPORT_CAPACITY,
  unitStats,
  type Look,
  type Projectile,
  type Role,
  type UnitStats,
} from '../data/units';
import { resolveMapType, type MapChoice } from '../data/maps';
import { WONDER_MORALE, WONDERS, type WonderEffect } from '../data/wonders';
import { canGather, isEndless, orderTarget, startPlan, updateBuilding, updateUnit, separateUnits } from './behavior';
import { canHit, updateProjectiles } from './combat';
import { rectOf, type Building, type Entity, type Hazard, type NodeType, type Order, type Plan, type Player, type ResourceNode, type Unit } from './entities';
import { hypot } from './fmath';
import { arrivalPace, DEFAULT_FORMATION, formationSlots, headingTo, type Formation } from './formation';
import { GameMap } from './map';
import { generateMap } from './mapgen';
import { distToRect, Pathfinder, type Point } from './pathfinding';
import { updateAuras, updateHazards, useAbility } from './powers';
import { Rng } from './rng';
import { updateVision } from './vision';

export const TICK_RATE = 20;
export const DT = 1 / TICK_RATE;
/** How far from a ship its passengers can step ashore. */
export const LANDING_REACH = 2.6;

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
  /** Minutes a finished wonder must stand to win (0 or missing: no wonder victory). */
  wonderVictory?: number;
  /** Land and water layout; missing: continent (the only layout before 0.7). */
  mapType?: MapChoice;
  /** A prepared match instead of the usual start: the tutorial gives the second player a robbers' camp. */
  scenario?: 'tutorial';
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
  type: 'info' | 'warn' | 'epoch' | 'attack' | 'built' | 'trained' | 'tech' | 'gameover' | 'wonder';
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
  /** Drawing only: shot from a plane (bombs fall) or at one (flak climbs). */
  fromAir?: boolean;
  toAir?: boolean;
}

/**
 * Something audible happened. The client turns cues into sound; the
 * simulation never reads them back, so they cannot affect determinism.
 */
export interface SoundCue {
  kind: 'shot' | 'melee' | 'impact' | 'blast' | 'death' | 'collapse' | 'work' | 'ability' | 'calamity' | 'convert' | 'heal' | 'board';
  x: number;
  y: number;
  owner: number;
  /** Epoch of the unit tier or building: decides the material (club, sword, rifle …). */
  epoch?: number;
  look?: Look;
  projectile?: Projectile;
  /** Work cues: what is being worked on. */
  work?: Res | 'build' | 'fish';
  size?: number;
  /** Ability and calamity cues: which one. */
  ability?: AbilityId;
}

/** Cues kept until the client drains them; headless runs simply stop recording. */
const MAX_CUES = 256;

export interface Effect {
  kind: 'explosion' | 'hit' | 'collapse' | 'dust' | 'laserhit' | 'ring' | 'convert' | 'heal' | 'sink' | 'crash';
  x: number;
  y: number;
  t: number;
  dur: number;
  size: number;
  /** Ring effects: the ability that caused it (decides the colour). */
  ability?: AbilityId;
}

export interface Controller {
  readonly playerId: number;
  update(world: World): void;
  /** Saved games: what the controller has in mind, as plain data. */
  saveState?(): unknown;
  loadState?(state: unknown): void;
}

/**
 * Everything a saved game needs to continue the match exactly where it
 * stopped. Units on board or in shelter are saved with their hosts as ids.
 */
export interface WorldSnapshot {
  tick: number;
  nextId: number;
  nextHazard: number;
  rng: number;
  map: { terrain: Uint8Array; blocked: Uint16Array; occupied: Uint16Array; shade: Uint8Array; gateTeam: Int16Array; version: number };
  players: Player[];
  startPositions: Point[];
  /** In the order of `entities`, with cargo and garrison as ids. */
  entities: unknown[];
  units: number[];
  buildings: number[];
  resources: number[];
  projectiles: ProjectileFx[];
  hazards: Hazard[];
  victory: World['victory'];
  victoryWonder: World['victoryWonder'];
  over: boolean;
  winnerTeam: number | null;
  lastAlertTick: number[];
  wonderFx: WonderEffect[][];
  controllers: Array<{ playerId: number; state: unknown }>;
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
  /** Marching in step (the group arrives together) on or off. */
  | { type: 'lockstep'; player: number; ids: number[]; on: boolean }
  /** Citizens take shelter in town centers and towers (on), or come out and go back to work (off). */
  | { type: 'shelter'; player: number; on: boolean }
  /** Land units go aboard a transport ship, which comes to the shore for them. */
  | { type: 'board'; player: number; ids: number[]; targetId: number; queue?: boolean }
  /** Transport ships sail to the coast near a point and put their passengers ashore. */
  | { type: 'unload'; player: number; ids: number[]; x: number; y: number; queue?: boolean }
  /** Planes fly to an own airfield to refuel, reload and get repaired. */
  | { type: 'refuel'; player: number; ids: number[]; targetId: number; queue?: boolean }
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
  | { type: 'destroy'; player: number; ids: number[] }
  /** The computer takes over a player's empire (they left) or hands it back. */
  | { type: 'control'; player: number; ai: boolean }
  /** Hero abilities (around the hero) and prophets' calamities (at x, y). */
  | { type: 'ability'; player: number; ids: number[]; ability: AbilityId; x?: number; y?: number }
  /** Priests: win an enemy unit over. */
  | { type: 'convert'; player: number; ids: number[]; targetId: number; queue?: boolean }
  /** Priests: heal a friendly unit. */
  | { type: 'heal'; player: number; ids: number[]; targetId: number; queue?: boolean };

const START_STOCK: Record<StartResources, Record<Res, number>> = {
  low: { food: 200, wood: 200, stone: 100, gold: 100, iron: 50 },
  standard: { food: 400, wood: 400, stone: 250, gold: 200, iron: 150 },
  high: { food: 2000, wood: 2000, stone: 1500, gold: 1500, iron: 1500 },
};

const GRID_CELL = 4;
/** Longest wall line one drag may place. */
export const MAX_LINE = 30;
/** Woodcutters sent together spread over trees up to this many tiles from the one clicked. */
export const TREE_SPREAD = 4;
/** A worker already on a tree or bush counts like this many tiles of extra way for the next one. */
export const CROWD_TILES = 3;
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
  /** Calamities at work. */
  hazards: Hazard[] = [];
  /** How the match was won, once it is over. */
  victory: 'conquest' | 'wonder' | null = null;
  /** Wonder victory: which wonder of whom. */
  victoryWonder: { name: string; owner: number } | null = null;
  /** Builds the computer player that takes over an empire whose human left. */
  makeAI: ((player: number) => Controller) | null = null;
  over = false;
  winnerTeam: number | null = null;

  private nextId = 1;
  /** Unit stats with each player's tech bonuses, per "role:tier". */
  private statCache: Array<Map<string, UnitStats>> = [];
  private grid: Unit[][];
  private gridCols: number;
  /** Cells of `grid` holding units, so rebuilding it skips the empty ones. */
  private gridUsed: number[] = [];
  private lastAlertTick: number[] = [];
  /** Not saved: only throttles a warning. */
  private lastFuelWarn: number[] = [];
  private nextHazard = 1;
  /** Effects of each player's standing wonders. */
  private wonderFx: Array<Set<WonderEffect>> = [];

  /** `generate`: false builds an empty world for a saved game to be poured into. */
  constructor(settings: Partial<GameSettings> = {}, generate = true) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    const s = this.settings;
    s.startEpoch = Math.max(0, Math.min(LAST_EPOCH, s.startEpoch));
    s.maxEpoch = Math.max(s.startEpoch, Math.min(LAST_EPOCH, s.maxEpoch));
    s.mapType = resolveMapType(s.mapType, s.seed);
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
          converted: 0,
          buildingsLost: 0,
        },
        gatherBonus: 1,
        techs: new Set(),
        mods: modsFor([]),
      });
      this.statCache.push(new Map());
      this.lastAlertTick.push(-1000);
      this.lastFuelWarn.push(-10000);
      this.wonderFx.push(new Set());
    });

    if (!generate) return;
    this.startPositions.push(...generateMap(this));
    this.setupStartingBases();
    this.rebuildGrid();
    updateVision(this);
  }

  // ------------------------------------------------------------- save games

  snapshot(): WorldSnapshot {
    const m = this.map;
    return {
      tick: this.tick,
      nextId: this.nextId,
      nextHazard: this.nextHazard,
      rng: this.rng.position,
      map: { terrain: m.terrain, blocked: m.blocked, occupied: m.occupied, shade: m.shade, gateTeam: m.gateTeam, version: m.version },
      players: this.players,
      startPositions: this.startPositions,
      entities: [...this.entities.values()].map((e) =>
        e.kind === 'unit' ? { ...e, cargo: e.cargo.map((c) => c.id) } : e.kind === 'building' ? { ...e, garrison: e.garrison.map((u) => u.id) } : e,
      ),
      units: this.units.map((u) => u.id),
      buildings: this.buildings.map((b) => b.id),
      resources: this.resources.map((n) => n.id),
      projectiles: this.projectiles,
      hazards: this.hazards,
      victory: this.victory,
      victoryWonder: this.victoryWonder,
      over: this.over,
      winnerTeam: this.winnerTeam,
      lastAlertTick: this.lastAlertTick,
      wonderFx: this.wonderFx.map((fx) => [...fx]),
      controllers: this.controllers.map((c) => ({ playerId: c.playerId, state: c.saveState?.() ?? null })),
    };
  }

  /** Pours a snapshot (decoded, not shared with a live world) into this empty world; controllers are the caller's job. */
  loadSnapshot(snap: WorldSnapshot): void {
    this.tick = snap.tick;
    this.nextId = snap.nextId;
    this.nextHazard = snap.nextHazard;
    this.rng.restore(snap.rng);
    const m = this.map;
    m.terrain.set(snap.map.terrain);
    m.blocked.set(snap.map.blocked);
    m.occupied.set(snap.map.occupied);
    m.shade.set(snap.map.shade);
    m.gateTeam.set(snap.map.gateTeam);
    m.version = snap.map.version;
    m.computeRegions();
    snap.players.forEach((p, i) => Object.assign(this.players[i], p));
    this.startPositions.length = 0;
    this.startPositions.push(...snap.startPositions);
    this.entities.clear();
    const cargo = new Map<Unit, number[]>();
    const garrison = new Map<Building, number[]>();
    for (const raw of snap.entities as Entity[]) {
      const e = { ...raw } as Entity;
      if (e.kind === 'unit') {
        cargo.set(e, e.cargo as unknown as number[]);
        e.cargo = [];
      } else if (e.kind === 'building') {
        garrison.set(e, e.garrison as unknown as number[]);
        e.garrison = [];
      }
      this.entities.set(e.id, e);
    }
    const unitById = (id: number) => this.entities.get(id) as Unit;
    for (const [u, ids] of cargo) u.cargo = ids.map(unitById);
    for (const [b, ids] of garrison) b.garrison = ids.map(unitById);
    this.units = snap.units.map(unitById);
    this.buildings = snap.buildings.map((id) => this.entities.get(id) as Building);
    this.resources = snap.resources.map((id) => this.entities.get(id) as ResourceNode);
    this.projectiles = snap.projectiles;
    this.hazards = snap.hazards;
    this.victory = snap.victory;
    this.victoryWonder = snap.victoryWonder;
    this.over = snap.over;
    this.winnerTeam = snap.winnerTeam;
    this.lastAlertTick = snap.lastAlertTick;
    this.wonderFx = snap.wonderFx.map((fx) => new Set(fx));
    for (const cache of this.statCache) cache.clear();
    this.rebuildGrid();
  }

  get time(): number {
    return this.tick / TICK_RATE;
  }

  private setupStartingBases(): void {
    const s = this.settings;
    this.players.forEach((p, i) => {
      const start = this.startPositions[i];
      if (s.scenario === 'tutorial' && i > 0) {
        this.setupCamp(p.id, start);
        return;
      }
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

  /**
   * Tutorial: two huts and a handful of club fighters and stone throwers in
   * the corner, no town center and no citizens. Burn the huts and the camp
   * is beaten.
   */
  private setupCamp(owner: number, start: Point): void {
    const x = Math.floor(start.x);
    const y = Math.floor(start.y);
    for (const [dx, dy] of [
      [-2, -2],
      [1, -1],
    ]) {
      if (this.canPlaceAt('house', x + dx, y + dy)) this.addBuilding(owner, 'house', x + dx, y + dy, true);
    }
    const roles: Role[] = ['assault', 'assault', 'assault', 'ranged'];
    roles.forEach((role, n) => {
      const spot = this.map.nearestPassable(x + 0.5 + (n % 3) - 1, y + 2.5 + Math.floor(n / 3), 6);
      if (spot) this.spawnUnit(owner, role, spot.x + 0.5, spot.y + 0.5, 0);
    });
  }

  /** Free dry ground for a building's footprint (no visibility rules: for setting up scenarios). */
  private canPlaceAt(type: BuildingType, tx: number, ty: number): boolean {
    const size = BUILDING_DEFS[type].size;
    for (let yy = ty; yy < ty + size; yy++) for (let xx = tx; xx < tx + size; xx++) if (!this.map.buildable(xx, yy)) return false;
    return true;
  }

  // ---------------------------------------------------------------- entities

  /** A living entity on the map; sheltered units count as away. */
  get(id: number): Entity | undefined {
    const e = this.entities.get(id);
    return e && !e.dead && !(e.kind === 'unit' && e.inside) ? e : undefined;
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
      lockstep: true,
      inside: 0,
      cargo: [],
      fuel: stats.fuel,
      ammo: stats.bombs,
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
      faith: (MAX_FAITH[role] ?? 0) / 2,
      ready: {},
      status: {},
      aura: 0,
      plagueBy: -1,
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
      countdown: 0,
      garrison: [],
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
      fuel: base.fuel * this.players[owner].mods.fuel,
      bombs: base.bombs > 0 ? base.bombs + this.players[owner].mods.bombs : 0,
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
    // Units on board or in shelter count too (they are only missing from `units`).
    for (const e of this.entities.values()) {
      if (e.kind !== 'unit' || e.dead || e.owner !== owner) continue;
      const u = e;
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
    const res: Res = nodeType === 'tree' ? 'wood' : nodeType === 'berries' || nodeType === 'fish' ? 'food' : nodeType;
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
      // Aircraft fly over the new roof.
      if (u.dead || isAir(u.role) || distToRect(u.x, u.y, r) > 0) continue;
      const free = this.map.nearestPassable(u.x, u.y, 8, isNaval(u.role));
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
    for (const u of this.units) if (u.owner === owner && !u.dead) n += 1 + u.cargo.length;
    for (const b of this.buildings) if (b.owner === owner && !b.dead) n += b.garrison.length;
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
    // Only the cells filled last time need emptying.
    for (const c of this.gridUsed) this.grid[c].length = 0;
    this.gridUsed.length = 0;
    const max = this.gridCols - 1;
    for (const u of this.units) {
      if (u.dead) continue;
      const cx = Math.max(0, Math.min(max, Math.floor(u.x / GRID_CELL)));
      const cy = Math.max(0, Math.min(max, Math.floor(u.y / GRID_CELL)));
      const c = cy * this.gridCols + cx;
      const cell = this.grid[c];
      if (cell.length === 0) this.gridUsed.push(c);
      cell.push(u);
    }
  }

  /** `fish`: where a fishing boat unloads (harbours) instead of a citizen's drop-off. */
  nearestDropoff(owner: number, x: number, y: number, fish = false): Building | null {
    let best: Building | null = null;
    let bestD = Infinity;
    for (const b of this.buildings) {
      if (b.dead || b.owner !== owner || !b.built || !(fish ? BUILDING_DEFS[b.type].fishDrop : BUILDING_DEFS[b.type].dropoff)) continue;
      const d = distToRect(x, y, rectOf(b));
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  /** `water`: fishing grounds (for boats) instead of deposits on land. */
  nearestResource(res: Res, x: number, y: number, maxDist: number, player = -1, excludeId = 0, water = false): ResourceNode | null {
    let best: ResourceNode | null = null;
    let bestD = maxDist;
    for (const n of this.resources) {
      if (n.dead || n.res !== res || n.id === excludeId || n.blockedUntil > this.tick || (n.nodeType === 'fish') !== water) continue;
      if (player >= 0 && !this.isVisibleTo(player, n)) continue;
      const d = hypot(n.x - x, n.y - y);
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    return best;
  }

  /**
   * The next node for a gatherer whose node ran out or could not be reached. Trees and bushes count
   * the owner's workers already on them (each one like `CROWD_TILES` of extra way), so the workers of
   * a felled tree spread over the next ones instead of all walking to the same. Mines take many workers
   * and go by distance alone.
   */
  nextNode(u: Unit, res: Res, x: number, y: number, maxDist: number, excludeId = 0, water = false): ResourceNode | null {
    const crowd = new Map<number, number>();
    for (const o of this.units) {
      if (o === u || o.dead || o.owner !== u.owner || o.order.kind !== 'gather') continue;
      crowd.set(o.order.targetId, (crowd.get(o.order.targetId) ?? 0) + 1);
    }
    let best: ResourceNode | null = null;
    let bestScore = Infinity;
    for (const n of this.resources) {
      if (n.dead || n.res !== res || n.id === excludeId || n.blockedUntil > this.tick || (n.nodeType === 'fish') !== water) continue;
      if (!this.isVisibleTo(u.owner, n)) continue;
      const d = hypot(n.x - x, n.y - y);
      if (d >= maxDist) continue;
      const small = n.nodeType === 'tree' || n.nodeType === 'berries';
      const score = small ? d + CROWD_TILES * (crowd.get(n.id) ?? 0) : d;
      if (score < bestScore) {
        bestScore = score;
        best = n;
      }
    }
    return best;
  }

  /**
   * A tree for each worker, in the workers' order: the clicked tree and the reachable trees around it
   * (nearest first), one worker each; with more workers than trees the round starts over. Each tree
   * goes to the nearest worker still free, so nobody walks past a tree to reach another.
   */
  spreadOverTrees(tree: ResourceNode, workers: Unit[], player: number): ResourceNode[] {
    const reach = TREE_SPREAD * TREE_SPREAD;
    const map = this.map;
    // A tree at the forest edge: some tile beside it is open.
    const open = (n: ResourceNode) => {
      for (let i = -1; i <= n.size; i++) {
        if (map.passable(n.tx + i, n.ty - 1) || map.passable(n.tx + i, n.ty + n.size)) return true;
        if (map.passable(n.tx - 1, n.ty + i) || map.passable(n.tx + n.size, n.ty + i)) return true;
      }
      return false;
    };
    const dist = (n: { x: number; y: number }, x: number, y: number) => (n.x - x) * (n.x - x) + (n.y - y) * (n.y - y);
    const trees = this.resources
      .filter(
        (n) =>
          n !== tree &&
          !n.dead &&
          n.nodeType === 'tree' &&
          n.blockedUntil <= this.tick &&
          dist(n, tree.x, tree.y) <= reach &&
          this.isVisibleTo(player, n) &&
          open(n),
      )
      .sort((a, b) => dist(a, tree.x, tree.y) - dist(b, tree.x, tree.y) || a.id - b.id);
    trees.unshift(tree);
    const out: ResourceNode[] = new Array(workers.length);
    const free = workers.map((_, i) => i);
    for (let t = 0; free.length > 0; t = (t + 1) % trees.length) {
      const n = trees[t];
      let best = 0;
      for (let k = 1; k < free.length; k++) {
        const a = workers[free[k]];
        const b = workers[free[best]];
        const d = dist(a, n.x, n.y) - dist(b, n.x, n.y);
        if (d < 0 || (d === 0 && a.id < b.id)) best = k;
      }
      out[free[best]] = n;
      free.splice(best, 1);
    }
    return out;
  }

  /** Nearest visible deposit of any kind, e.g. for builders of a new storehouse. */
  nearestAnyResource(x: number, y: number, maxDist: number, player: number): ResourceNode | null {
    let best: ResourceNode | null = null;
    let bestD = maxDist;
    for (const n of this.resources) {
      if (n.dead || n.nodeType === 'fish' || n.blockedUntil > this.tick || !this.isVisibleTo(player, n)) continue;
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
      if (hypot(b.x - x, b.y - y) <= MORALE_RADIUS) n++;
      if (n >= MORALE_MAX_HOUSES) break;
    }
    return n;
  }

  /**
   * Free tile next to a building, preferring the side facing `towards`;
   * ships come out on the water, aircraft start right on the airfield.
   */
  findSpawnPoint(b: Building, towards: Point, skip = 0, domain: 'land' | 'water' | 'air' = 'land'): Point | null {
    if (domain === 'air') return this.parkingSpot(b, skip);
    const naval = domain === 'water';
    const candidates: Array<Point & { d: number }> = [];
    for (let ring = 1; ring <= 4 && candidates.length <= skip; ring++) {
      for (let y = b.ty - ring; y < b.ty + b.size + ring; y++) {
        for (let x = b.tx - ring; x < b.tx + b.size + ring; x++) {
          const onRing = x === b.tx - ring || y === b.ty - ring || x === b.tx + b.size + ring - 1 || y === b.ty + b.size + ring - 1;
          if (!onRing || !this.map.passableFor(x, y, -1, naval)) continue;
          candidates.push({ x: x + 0.5, y: y + 0.5, d: hypot(x + 0.5 - towards.x, y + 0.5 - towards.y) });
        }
      }
    }
    if (candidates.length === 0) return null;
    candidates.sort((a, c) => a.d - c.d);
    const pick = candidates[Math.min(skip, candidates.length - 1)];
    return { x: pick.x, y: pick.y };
  }

  /** A place on an airfield (or above any building) for the n-th aircraft, so they don't stack. */
  parkingSpot(b: Building, n: number): Point {
    const cols = Math.max(1, b.size - 1);
    const i = n % (cols * cols);
    return { x: b.tx + 1 + (i % cols), y: b.ty + 1 + Math.floor(i / cols) };
  }

  /** The nearest finished airfield of a player, or null. */
  nearestAirfield(owner: number, x: number, y: number): Building | null {
    let best: Building | null = null;
    let bestD = Infinity;
    for (const b of this.buildings) {
      if (b.dead || b.owner !== owner || b.type !== 'airfield' || !b.built) continue;
      const d = distToRect(x, y, rectOf(b));
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  /** An own finished airfield the unit is right above, or null. */
  airfieldUnder(u: Unit): Building | null {
    for (const b of this.buildings) {
      if (b.dead || b.owner !== u.owner || b.type !== 'airfield' || !b.built) continue;
      if (distToRect(u.x, u.y, rectOf(b)) <= 0.3) return b;
    }
    return null;
  }

  /** Planes without fuel: one warning every half minute is enough. */
  warnNoAirfield(u: Unit): void {
    if (this.tick - this.lastFuelWarn[u.owner] < TICK_RATE * 30) return;
    this.lastFuelWarn[u.owner] = this.tick;
    this.emit({ type: 'warn', player: u.owner, text: 'Kein Flugplatz: Flugzeuge ohne Treibstoff sind kampfunfähig, bis einer steht.', x: u.x, y: u.y });
  }

  canPlace(owner: number, type: BuildingType, tx: number, ty: number): boolean {
    const size = BUILDING_DEFS[type].size;
    const vis = this.players[owner].vis;
    // Harbours stand in the water at the shore, everything else on dry land.
    if (BUILDING_DEFS[type].shore && !this.map.shoreSite(tx, ty, size)) return false;
    for (let y = ty; y < ty + size; y++) {
      for (let x = tx; x < tx + size; x++) {
        if (!BUILDING_DEFS[type].shore && !this.map.buildable(x, y)) return false;
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
        const units = this.ownUnits(cmd.player, cmd.ids);
        const fighters = units.filter((u) => u.role !== 'priest' && u.role !== 'prophet' && canHit(u, target));
        // In step up to the target: the group closes in together, at the slowest one's pace.
        const pace = cmd.queue ? null : this.groupPace(fighters, fighters, fighters.map(() => target));
        for (const u of units) {
          // Priests answer an attack order by converting; prophets do not fight at all.
          if (u.role === 'priest') {
            if (target.kind === 'unit' && isConvertible(target.role)) this.assign(u, { kind: 'convert', targetId: target.id }, cmd.queue ?? false);
          } else if (fighters.includes(u)) {
            this.assign(u, { kind: 'attack', targetId: target.id, pace: pace?.get(u.id) }, cmd.queue ?? false);
          }
        }
        break;
      }
      case 'convert': {
        const target = this.get(cmd.targetId);
        if (!target || target.kind !== 'unit' || !isConvertible(target.role) || !this.areEnemies(cmd.player, target.owner)) return;
        for (const u of this.ownUnits(cmd.player, cmd.ids)) {
          if (u.role === 'priest') this.assign(u, { kind: 'convert', targetId: target.id }, cmd.queue ?? false);
        }
        break;
      }
      case 'heal': {
        const target = this.get(cmd.targetId);
        // Aircraft are mended at the airfield, not by priests.
        if (!target || target.kind !== 'unit' || isAir(target.role) || this.areEnemies(cmd.player, target.owner)) return;
        for (const u of this.ownUnits(cmd.player, cmd.ids)) {
          if (u.role === 'priest' && u !== target) this.assign(u, { kind: 'heal', targetId: target.id }, cmd.queue ?? false);
        }
        break;
      }
      case 'ability':
        this.commandAbility(cmd.player, cmd.ids, cmd.ability, cmd.x, cmd.y);
        break;
      case 'patrol':
        this.commandPatrol(cmd.player, cmd.ids, cmd.x, cmd.y, cmd.queue ?? false);
        break;
      case 'formation':
        this.commandFormation(cmd.player, cmd.ids, cmd.formation);
        break;
      case 'lockstep':
        for (const u of this.ownUnits(cmd.player, cmd.ids)) u.lockstep = cmd.on;
        break;
      case 'shelter':
        if (cmd.on) this.commandShelter(cmd.player);
        else this.releaseShelter(cmd.player);
        break;
      case 'board':
        this.commandBoard(cmd.player, cmd.ids, cmd.targetId, cmd.queue ?? false);
        break;
      case 'unload':
        for (const u of this.ownUnits(cmd.player, cmd.ids)) {
          if (u.role === 'transport') this.assign(u, { kind: 'unload', x: cmd.x, y: cmd.y }, cmd.queue ?? false);
        }
        break;
      case 'refuel': {
        const field = this.get(cmd.targetId);
        if (!field || field.kind !== 'building' || field.type !== 'airfield' || field.owner !== cmd.player || !field.built) return;
        const units = this.ownUnits(cmd.player, cmd.ids);
        for (const u of units) if (isPlane(u.role)) this.assign(u, { kind: 'refuel', targetId: field.id }, cmd.queue ?? false);
        // Balloons need no fuel: they just fly there.
        const others = units.filter((u) => !isPlane(u.role)).map((u) => u.id);
        if (others.length) this.commandMove(cmd.player, others, field.x, field.y, false, cmd.queue ?? false);
        break;
      }
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
        // Citizens work the land, fishing boats the fish; everybody else just goes there.
        const workers = units.filter((u) => canGather(u, target));
        // Woodcutters spread over the trees around the one clicked instead of crowding a single trunk.
        const nodes: Array<Entity> =
          target.kind === 'resource' && target.nodeType === 'tree' && workers.length > 1 ? this.spreadOverTrees(target, workers, cmd.player) : workers.map(() => target);
        workers.forEach((u, i) => this.assign(u, { kind: 'gather', targetId: nodes[i].id, res, lx: nodes[i].x, ly: nodes[i].y }, cmd.queue ?? false));
        const others = units.filter((u) => !workers.includes(u) && u.role !== 'citizen' && u.role !== 'fisher').map((u) => u.id);
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
          if (e.kind === 'building' && !e.built) refund(player.stock, multiplyCost(buildingCost(e.type, e.epoch), 1 - e.progress));
          this.kill(e, -1);
        }
        break;
      case 'control':
        this.setControl(cmd.player, cmd.ai);
        break;
    }
  }

  private setControl(player: number, ai: boolean): void {
    const p = this.players[player];
    if (p.isAI === ai || (ai && !this.makeAI)) return;
    p.isAI = ai;
    if (ai) {
      // The stand-in plays without the bonus computer opponents get.
      const bonus = p.gatherBonus;
      this.controllers.push(this.makeAI!(player));
      // The computer does not know about the alarm: everybody back to work.
      this.releaseShelter(player);
      p.gatherBonus = bonus;
    } else {
      this.controllers = this.controllers.filter((c) => c.playerId !== player);
    }
    for (const q of this.players) {
      this.emit({ type: 'info', player: q.id, text: ai ? `Der Computer übernimmt das Reich von ${p.name}.` : `${p.name} übernimmt wieder selbst.` });
    }
  }

  private ownUnits(player: number, ids: number[]): Unit[] {
    const out: Unit[] = [];
    for (const id of ids) {
      const e = this.get(id);
      if (e && e.kind === 'unit' && e.owner === player && !e.inside) out.push(e);
    }
    return out;
  }

  /**
   * Starts a command now, or queues it behind the current order (Shift).
   * Orders that never end on their own (idle, gathering, exploring,
   * patrolling) give way at once, so a queued build doesn't wait forever.
   */
  private assign(u: Unit, plan: Plan, queue: boolean, route?: Point[]): void {
    if (queue && !isEndless(u.order)) {
      if (u.queue.length < MAX_QUEUE) u.queue.push(plan);
      return;
    }
    if (!queue) u.queue = [];
    startPlan(this, u, plan, route);
  }

  /**
   * Ways for a group setting off together: one search for all who walk (and
   * one for all who sail) instead of one each. Members with open ground to
   * their spot, aircraft and lone walkers get nothing and plan on their own,
   * which costs them next to nothing. Moves a member's spot (in `targets`)
   * when it cannot be reached.
   */
  private groupRoutes(units: Unit[], targets: Point[], x: number, y: number): Array<Point[] | undefined> {
    const routes: Array<Point[] | undefined> = units.map(() => undefined);
    for (const naval of [false, true]) {
      const team = this.teamOf(units[0].owner);
      const members = units.flatMap((u, i) =>
        !isAir(u.role) && isNaval(u.role) === naval && !this.pathfinder.lineClear(u, targets[i], team, naval) ? [i] : [],
      );
      if (members.length < 2) continue;
      const found = this.pathfinder.groupPaths(
        members.map((i) => units[i]),
        members.map((i) => targets[i]),
        { x, y },
        team,
        naval,
      );
      members.forEach((i, k) => {
        const r = found[k];
        if (!r) return;
        routes[i] = r;
        // A spot shut in by woods or walls gave way to the nearest one the member can reach.
        if (r.length > 0) targets[i] = r[r.length - 1];
      });
    }
    return routes;
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
      // Aircraft go anywhere on the map.
      if (isAir(u.role)) return { x: Math.max(0.5, Math.min(this.map.width - 0.5, slot.x)), y: Math.max(0.5, Math.min(this.map.height - 0.5, slot.y)) };
      const naval = isNaval(u.role);
      if (this.map.passableFor(Math.floor(slot.x), Math.floor(slot.y), team, naval)) return { x: slot.x, y: slot.y };
      // Ships sent ashore stop at the nearest water, walkers sent to sea at the nearest shore.
      const near = this.map.nearestPassable(slot.x, slot.y, naval ? 24 : 6, naval);
      return near ? { x: near.x + 0.5, y: near.y + 0.5 } : { x, y };
    });
  }

  private commandMove(player: number, ids: number[], x: number, y: number, attackMove: boolean, queue = false, facing?: number): void {
    const units = this.ownUnits(player, ids);
    if (units.length === 0) return;
    const starts = units.map((u) => (queue ? this.plannedEnd(u) : { x: u.x, y: u.y }));
    const targets = this.formationTargets(player, units, starts, x, y, facing);
    const pace = this.groupPace(units, starts, targets);
    // Queued moves set off later, from wherever the orders before them end.
    const routes = queue ? null : this.groupRoutes(units, targets, x, y);
    units.forEach((u, i) => {
      this.assign(u, { kind: 'move', x: targets[i].x, y: targets[i].y, attackMove, pace: pace?.get(u.id) }, queue, routes?.[i]);
    });
  }

  /**
   * Everybody marching in step goes at the pace of the slowest of them and arrives together (aircraft
   * fly ahead); null when fewer than two march in step.
   */
  private groupPace(units: Unit[], starts: Point[], targets: Point[]): Map<number, number> | null {
    const inStep = units.flatMap((u, i) => (u.lockstep && !isAir(u.role) ? [i] : []));
    if (inStep.length < 2) return null;
    return arrivalPace(
      inStep.map((i) => ({ id: units[i].id, x: starts[i].x, y: starts[i].y, speed: units[i].stats.speed })),
      inStep.map((i) => targets[i]),
    );
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

  /**
   * Alarm: every citizen heads for the nearest town center or tower that
   * still has room. Places are handed out shortest way first, so nobody
   * runs past a free shelter to a far one.
   */
  private commandShelter(player: number): void {
    const shelters = this.buildings.filter((b) => !b.dead && b.built && b.owner === player && BUILDING_DEFS[b.type].garrison);
    const room = new Map(shelters.map((b) => [b.id, BUILDING_DEFS[b.type].garrison! - b.garrison.length]));
    const citizens = this.units.filter((u) => !u.dead && u.owner === player && u.role === 'citizen' && u.order.kind !== 'garrison');
    const pairs: Array<{ u: Unit; b: Building; d: number }> = [];
    for (const u of citizens) for (const b of shelters) pairs.push({ u, b, d: distToRect(u.x, u.y, rectOf(b)) });
    pairs.sort((a, c) => a.d - c.d || a.u.id - c.u.id || a.b.id - c.b.id);
    const placed = new Set<Unit>();
    for (const { u, b } of pairs) {
      if (placed.has(u) || room.get(b.id)! <= 0) continue;
      placed.add(u);
      room.set(b.id, room.get(b.id)! - 1);
      const resume = u.order.kind === 'idle' ? null : u.order;
      u.order = { kind: 'garrison', targetId: b.id, resume };
      u.queue = [];
      u.path = [];
      u.repathTick = -1000;
    }
    const left = citizens.length - placed.size;
    if (shelters.length === 0) this.emit({ type: 'warn', player, text: 'Kein Dorfzentrum oder Turm als Zuflucht.' });
    else if (left > 0) this.emit({ type: 'warn', player, text: `${left} ${left === 1 ? 'Bürger findet' : 'Bürger finden'} keinen Platz in Dorfzentrum oder Türmen.` });
  }

  /** All clear: sheltered citizens come out, the ones on their way turn round. */
  private releaseShelter(player: number): void {
    for (const b of this.buildings) if (!b.dead && b.owner === player) this.ejectGarrison(b);
    for (const u of this.units) {
      if (u.dead || u.owner !== player || u.order.kind !== 'garrison') continue;
      this.resumeAfterShelter(u, u.order.resume);
    }
  }

  /** A citizen goes inside: its load is booked if the shelter takes it, then it leaves the map. */
  enterShelter(u: Unit, b: Building): void {
    if (BUILDING_DEFS[b.type].dropoff && u.carry && u.carryAmount > 0) {
      const p = this.players[u.owner];
      p.stock[u.carry] += u.carryAmount;
      p.stats.gathered[u.carry] += u.carryAmount;
      u.carryAmount = 0;
    }
    u.inside = b.id;
    u.path = [];
    u.moving = false;
    b.garrison.push(u);
  }

  /** Everybody inside steps out next to the building and goes back to work. */
  ejectGarrison(b: Building): void {
    const out = b.garrison;
    b.garrison = [];
    out.forEach((u, i) => {
      const spot = this.findSpawnPoint(b, { x: b.x + b.size, y: b.y + b.size }, i) ?? { x: b.x, y: b.y + b.size / 2 + 0.5 };
      u.inside = 0;
      u.x = u.px = spot.x;
      u.y = u.py = spot.y;
      // Went in this very tick: still listed until the end of the tick.
      if (!this.units.includes(u)) this.units.push(u);
      this.resumeAfterShelter(u, u.order.kind === 'garrison' ? u.order.resume : null);
    });
  }

  private resumeAfterShelter(u: Unit, resume: Order | null): void {
    u.path = [];
    u.repathTick = -1000;
    if (!resume) {
      u.order = { kind: 'idle' };
      return;
    }
    u.order = resume.kind === 'gather' ? { ...resume, phase: u.carryAmount > 0 ? 'toDrop' : 'toNode', dropId: 0, snug: false } : resume;
  }

  /**
   * Boarding: the land units head for the shore by the ship, the ship
   * (unless it already lies at the coast there) sails to the water's edge
   * nearest to them.
   */
  private commandBoard(player: number, ids: number[], targetId: number, queue: boolean): void {
    const ship = this.get(targetId);
    if (!ship || ship.kind !== 'unit' || ship.owner !== player || ship.role !== 'transport') return;
    // As many as there is room for; the rest stays ashore.
    const units = this.ownUnits(player, ids)
      .filter((u) => domainOf(u.role) === 'land')
      .slice(0, Math.max(0, TRANSPORT_CAPACITY - ship.cargo.length));
    if (units.length === 0) return;
    for (const u of units) this.assign(u, { kind: 'board', targetId }, queue);
    if (queue || (ship.order.kind !== 'idle' && ship.order.kind !== 'move')) return;
    let cx = 0;
    let cy = 0;
    for (const u of units) {
      cx += u.x / units.length;
      cy += u.y / units.length;
    }
    const spot = this.shoreSpot(cx, cy, ship);
    if (spot && hypot(spot.x - ship.x, spot.y - ship.y) > 1.5) this.assign(ship, { kind: 'move', x: spot.x, y: spot.y, attackMove: false }, false);
  }

  /** The water tile of a ship's sea that lies closest to a point on land (where to pick people up). */
  shoreSpot(x: number, y: number, ship: Unit): Point | null {
    const { map } = this;
    const sea = map.waterRegion[map.idx(Math.floor(ship.x), Math.floor(ship.y))];
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    for (let r = 0; r <= 30; r++) {
      let best: Point | null = null;
      let bestD = Infinity;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const tx = cx + dx;
          const ty = cy + dy;
          if (!map.passableFor(tx, ty, -1, true) || map.waterRegion[map.idx(tx, ty)] !== sea) continue;
          const d = hypot(tx + 0.5 - x, ty + 0.5 - y);
          if (d < bestD) {
            bestD = d;
            best = { x: tx + 0.5, y: ty + 0.5 };
          }
        }
      }
      if (best) return best;
    }
    return null;
  }

  /** A unit goes aboard: it leaves the map until the ship puts it ashore. */
  boardShip(u: Unit, ship: Unit): void {
    u.inside = ship.id;
    u.order = { kind: 'idle' };
    u.queue = [];
    u.path = [];
    u.moving = false;
    if (u.carry && u.carryAmount > 0 && u.role === 'citizen') u.carryAmount = 0;
    ship.cargo.push(u);
    this.cue({ kind: 'board', x: ship.x, y: ship.y, owner: ship.owner, epoch: ship.stats.epoch });
  }

  /** The `skip`-th free land tile within reach of a ship, nearest to where the passengers want to go. */
  landingSpot(ship: Unit, towards: Point, skip: number): Point | null {
    const { map } = this;
    const team = this.teamOf(ship.owner);
    const sx = Math.floor(ship.x);
    const sy = Math.floor(ship.y);
    const r = Math.ceil(LANDING_REACH);
    const spots: Array<Point & { d: number }> = [];
    for (let ty = sy - r; ty <= sy + r; ty++) {
      for (let tx = sx - r; tx <= sx + r; tx++) {
        if (!map.passableFor(tx, ty, team)) continue;
        if (hypot(tx + 0.5 - ship.x, ty + 0.5 - ship.y) > LANDING_REACH) continue;
        spots.push({ x: tx + 0.5, y: ty + 0.5, d: hypot(tx + 0.5 - towards.x, ty + 0.5 - towards.y) });
      }
    }
    if (spots.length === 0) return null;
    spots.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
    const pick = spots[skip % spots.length];
    return { x: pick.x, y: pick.y };
  }

  /** Everybody ashore by the ship, then on to the point. */
  unloadShip(ship: Unit, to: Point): void {
    const out = ship.cargo;
    ship.cargo = [];
    const ids: number[] = [];
    out.forEach((u, i) => {
      const spot = this.landingSpot(ship, to, i) ?? { x: ship.x, y: ship.y };
      u.inside = 0;
      u.x = u.px = spot.x;
      u.y = u.py = spot.y;
      u.order = { kind: 'idle' };
      u.path = [];
      u.repathTick = -1000;
      if (!this.units.includes(u)) this.units.push(u);
      ids.push(u.id);
    });
    this.cue({ kind: 'board', x: ship.x, y: ship.y, owner: ship.owner, epoch: ship.stats.epoch });
    if (ids.length && hypot(to.x - ship.x, to.y - ship.y) > LANDING_REACH + 1) {
      this.issue({ type: 'move', player: ship.owner, ids, x: to.x, y: to.y, attackMove: true });
    }
  }

  private commandPlace(player: number, ids: number[], type: BuildingType, tx: number, ty: number, queue: boolean): void {
    const p = this.players[player];
    if (!this.buildingUnlocked(player, type)) return;
    const wonder = type === 'wonder' ? this.wonderProblem(player) : null;
    if (wonder) {
      this.emit({ type: 'warn', player, text: wonder });
      return;
    }
    if (!this.canPlace(player, type, tx, ty)) {
      this.emit({ type: 'warn', player, text: 'Hier kann nicht gebaut werden.' });
      return;
    }
    const cost = buildingCost(type, p.epoch);
    if (!canAfford(p.stock, cost)) {
      this.emit({ type: 'warn', player, text: `Nicht genug Rohstoffe: ${missingText(p.stock, cost)}` });
      return;
    }
    pay(p.stock, cost);
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
    if (isHero(role) && this.hasHero(player, role)) {
      this.emit({ type: 'warn', player, text: `Es gibt schon einen ${ROLE_DEFS[role].label.replace('Held: ', '')}en – jeder Held nur einmal.` });
      return false;
    }
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

  /** A living hero of this kind, or one in a training queue. */
  hasHero(player: number, role: Role): boolean {
    if (this.units.some((u) => !u.dead && u.owner === player && u.role === role)) return true;
    return this.buildings.some((b) => !b.dead && b.owner === player && b.queue.some((q) => q.role === role));
  }

  private commandAbility(player: number, ids: number[], id: AbilityId, x?: number, y?: number): void {
    const a = ABILITY_BY_ID.get(id);
    if (!a) return;
    const units = this.ownUnits(player, ids).filter((u) => u.role === a.role);
    if (a.target === 'self') {
      for (const u of units) useAbility(this, u, id);
      return;
    }
    if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) return;
    // One prophet answers: the nearest one with enough faith.
    let best: Unit | null = null;
    let bestD = Infinity;
    for (const u of units) {
      if (u.faith < a.faith || this.players[player].epoch < a.minEpoch) continue;
      const d = hypot(u.x - x, u.y - y);
      if (d < bestD) {
        bestD = d;
        best = u;
      }
    }
    if (!best) {
      if (units.length) this.emit({ type: 'warn', player, text: `Zu wenig Glaube für ${a.name} (${a.faith} nötig).` });
      return;
    }
    best.queue = [];
    best.order = { kind: 'cast', ability: id, x, y };
    best.path = [];
    best.repathTick = -1000;
  }

  /** A priest won a unit over: it changes sides with its wounds, but forgets its orders. */
  convertUnit(u: Unit, owner: number): void {
    const old = u.owner;
    if (old === owner || u.dead) return;
    const ratio = u.hp / u.maxHp;
    u.owner = owner;
    u.stats = this.unitStatsFor(owner, u.role, u.tier);
    u.maxHp = u.stats.hp;
    u.hp = Math.max(1, ratio * u.maxHp);
    u.order = { kind: 'idle' };
    u.queue = [];
    u.path = [];
    u.status = {};
    u.aura = 0;
    // Whoever is on board changes sides with the ship.
    for (const c of u.cargo) {
      c.owner = owner;
      c.stats = this.unitStatsFor(owner, c.role, c.tier);
      c.maxHp = c.stats.hp;
      c.hp = Math.min(c.hp, c.maxHp);
    }
    this.players[old].stats.unitsLost++;
    this.players[owner].stats.converted++;
    this.effects.push({ kind: 'convert', x: u.x, y: u.y, t: 0, dur: 1.2, size: 1 });
    this.cue({ kind: 'convert', x: u.x, y: u.y, owner, epoch: u.stats.epoch });
    this.emit({ type: 'warn', player: old, text: `${u.stats.name} wurde bekehrt und kämpft jetzt für ${this.players[owner].name}!`, x: u.x, y: u.y });
    this.emit({ type: 'info', player: owner, text: `${u.stats.name} ist bekehrt und gehört jetzt zu dir.`, x: u.x, y: u.y });
  }

  addHazard(kind: Hazard['kind'], x: number, y: number, r: number, owner: number, seconds: number): void {
    this.hazards.push({ id: this.nextHazard++, kind, x, y, r, owner, start: this.tick, until: this.tick + Math.max(1, Math.round(seconds * TICK_RATE)) });
    const name = ABILITY_BY_ID.get(kind)!.name;
    // Everyone with something in the area hears about it once.
    const hit = new Set<number>();
    this.forUnitsNear(x, y, r, (u) => {
      if (!u.dead && this.areEnemies(owner, u.owner) && hypot(u.x - x, u.y - y) <= r) hit.add(u.owner);
    });
    for (const b of this.buildings) if (!b.dead && this.areEnemies(owner, b.owner) && distToRect(x, y, rectOf(b)) <= r) hit.add(b.owner);
    for (const p of hit) this.emit({ type: 'attack', player: p, text: `${name}! ${this.players[owner].name} ruft eine Katastrophe herbei.`, x, y });
  }

  // ---------------------------------------------------------------- wonders

  /** Whether a standing wonder of this player has the effect. */
  wonderEffect(owner: number, effect: WonderEffect): boolean {
    return owner >= 0 && this.wonderFx[owner].has(effect);
  }

  /** Recomputes wonder effects after a wonder was finished or lost. */
  refreshWonders(): void {
    for (const fx of this.wonderFx) fx.clear();
    for (const b of this.buildings) {
      if (b.dead || b.type !== 'wonder' || !b.built) continue;
      this.wonderFx[b.owner].add(WONDERS[epochStyle(b.epoch)].effect);
    }
  }

  /** Why the player cannot found a wonder now, or null. Each era's wonder once per player. */
  wonderProblem(player: number): string | null {
    const era = epochStyle(this.players[player].epoch);
    const has = this.buildings.some((b) => !b.dead && b.owner === player && b.type === 'wonder' && epochStyle(b.epoch) === era);
    return has ? `${WONDERS[era].name} steht schon – jedes Ära-Wunder nur einmal.` : null;
  }

  /** A wonder was finished: with wonder victory on, the countdown starts. Everyone sees it. */
  wonderFinished(b: Building): void {
    this.refreshWonders();
    for (const p of this.players) b.seenBy |= 1 << p.id;
    const name = buildingName(b.type, b.epoch);
    const owner = this.players[b.owner];
    const minutes = this.settings.wonderVictory ?? 0;
    if (minutes > 0) b.countdown = minutes * 60 * TICK_RATE;
    for (const p of this.players) {
      // The builder reads it in the second person (the local player is called "Du").
      const own = p.id === owner.id;
      const mine = this.teamOf(p.id) === owner.team;
      const head = own ? `Wunder vollendet: ${name}.` : `${owner.name} hat ein Wunder vollendet: ${name}.`;
      let tail = '';
      if (minutes > 0) {
        if (own) tail = ` Halte es ${minutes} Minuten, dann gewinnst du!`;
        else if (mine) tail = ` Haltet es ${minutes} Minuten für den Wundersieg!`;
        else tail = ` Zerstört es in ${minutes} Minuten, sonst gewinnt ${owner.name}!`;
      }
      this.emit({ type: 'wonder', player: p.id, text: head + tail, x: b.x, y: b.y });
    }
  }

  private updateWonders(): void {
    for (const b of this.buildings) {
      if (b.dead || b.type !== 'wonder' || !b.built || b.countdown <= 0) continue;
      b.countdown--;
      const left = b.countdown / TICK_RATE;
      if (left === 60) {
        for (const p of this.players) {
          const text = p.id === b.owner ? 'Noch 1 Minute bis zu deinem Wundersieg!' : `Noch 1 Minute bis zum Wundersieg von ${this.players[b.owner].name}!`;
          this.emit({ type: 'wonder', player: p.id, text, x: b.x, y: b.y });
        }
      }
      if (b.countdown === 0) {
        this.victoryWonder = { name: buildingName(b.type, b.epoch), owner: b.owner };
        this.finish(this.players[b.owner].team, 'wonder');
        return;
      }
    }
  }

  private finish(team: number | null, how: 'conquest' | 'wonder'): void {
    this.over = true;
    this.winnerTeam = team;
    this.victory = how;
    for (const q of this.players) {
      this.emit({ type: 'gameover', player: q.id, text: q.team === this.winnerTeam ? 'Sieg!' : 'Niederlage' });
    }
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
    for (const u of this.units) if (!u.dead && !u.inside) updateUnit(this, u);
    separateUnits(this);
    updateProjectiles(this);
    updateHazards(this);
    this.updateWonders();
    for (const fx of this.effects) fx.t += DT;
    this.effects = this.effects.filter((fx) => fx.t < fx.dur);

    if (this.tick % 20 === 0) {
      for (const u of this.units) {
        if (u.dead) continue;
        u.morale = this.moraleAt(u.owner, u.x, u.y) + (this.wonderEffect(u.owner, 'morale') ? WONDER_MORALE : 0);
        u.aura = 0;
      }
      updateAuras(this);
      for (const u of this.units) u.morale = Math.min(MORALE_MAX, u.morale);
      if (!this.over) this.checkVictory();
    }
    this.compact();
    this.rebuildGrid();
    if (this.tick % 5 === 0) updateVision(this);
  }

  /** Drops dead entities from the lookup tables. */
  compact(): void {
    let changed = false;
    for (const list of [this.units, this.buildings, this.resources] as Entity[][]) {
      for (const e of list) if (e.dead || (e.kind === 'unit' && e.inside)) changed = true;
    }
    if (!changed) return;
    for (const [id, e] of this.entities) if (e.dead) this.entities.delete(id);
    // Sheltered units stay in `entities` but leave the map.
    this.units = this.units.filter((u) => !u.dead && !u.inside);
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
      if (isNaval(e.role)) this.effects.push({ kind: 'sink', x: e.x, y: e.y, t: 0, dur: 2.6, size: e.role === 'fisher' ? 0.6 : 1 });
      if (isAir(e.role)) this.effects.push({ kind: 'crash', x: e.x, y: e.y, t: 0, dur: 1.8, size: e.role === 'bomber' ? 1.2 : e.role === 'balloon' ? 0.9 : 0.8 });
      if (isHero(e.role)) this.emit({ type: 'warn', player: e.owner, text: `${e.stats.name} ist gefallen.`, x: e.x, y: e.y });
      if (e.cargo.length) {
        // A sunk transport takes its passengers down with it.
        const lost = e.cargo;
        e.cargo = [];
        for (const c of lost) {
          c.x = e.x;
          c.y = e.y;
          c.inside = 0;
          this.kill(c, killerOwner);
        }
        this.emit({ type: 'warn', player: e.owner, text: `${e.stats.name} versenkt – ${lost.length} ${lost.length === 1 ? 'Einheit' : 'Einheiten'} an Bord verloren.`, x: e.x, y: e.y });
      }
    } else {
      owner.stats.buildingsLost++;
      // The people inside escape the ruins.
      if (e.garrison.length) this.ejectGarrison(e);
      this.cue({ kind: 'collapse', x: e.x, y: e.y, owner: e.owner, epoch: e.epoch, size: e.size });
      // Research that depended on what ran here can no longer come.
      if (e.tech || e.techQueue.length) this.pruneTechQueues(e.owner);
      this.effects.push({ kind: 'collapse', x: e.x, y: e.y, t: 0, dur: 1.6, size: e.size });
      if (e.type === 'towncenter') {
        this.emit({ type: 'warn', player: e.owner, text: `${buildingName(e.type, e.epoch)} wurde zerstört!`, x: e.x, y: e.y });
      }
      if (e.type === 'wonder') {
        this.refreshWonders();
        for (const p of this.players) {
          this.emit({ type: 'wonder', player: p.id, text: `${buildingName(e.type, e.epoch)} von ${owner.name} wurde zerstört.`, x: e.x, y: e.y });
        }
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
    if (teams.size <= 1) this.finish(teams.size === 1 ? [...teams][0] : null, 'conquest');
  }

  /**
   * Fingerprint of the game state. Lockstep peers compare it to notice a
   * desync, replays to notice they no longer match the recorded match.
   */
  checksum(): number {
    const h = new Hasher();
    h.add(this.tick);
    h.add(this.rng.position);
    for (const p of this.players) {
      h.add(p.epoch);
      h.add(p.alive ? 1 : 0);
      for (const r of RESOURCES) h.add(p.stock[r]);
    }
    for (const u of this.units) {
      if (u.dead) continue;
      h.add(u.id);
      h.add(u.x);
      h.add(u.y);
      h.add(u.hp);
      h.add(u.carryAmount);
      h.add(u.queue.length);
      h.add(u.owner);
      h.add(u.faith);
      h.add(u.tier);
      h.add(u.aura);
      for (const st of STATUSES) h.add(u.status[st] ?? 0);
      for (const a of ABILITIES) h.add(u.ready[a.id] ?? 0);
      if (u.order.kind === 'convert') h.add(u.order.progress);
      if (u.role === 'transport') for (const c of u.cargo) h.add(c.id);
      if (isPlane(u.role)) {
        h.add(u.fuel);
        h.add(u.ammo);
      }
    }
    for (const b of this.buildings) {
      if (b.dead) continue;
      h.add(b.id);
      h.add(b.hp);
      h.add(b.progress);
      h.add(b.queue.length);
      h.add(b.countdown);
      h.add(b.garrison.length);
    }
    for (const hz of this.hazards) {
      h.add(hz.id);
      h.add(hz.until);
      h.add(hz.x);
      h.add(hz.y);
    }
    h.add(this.victory === 'wonder' ? 2 : this.victory === 'conquest' ? 1 : 0);
    for (const n of this.resources) {
      if (n.dead) continue;
      h.add(n.id);
      h.add(n.amount);
    }
    return h.value;
  }

  /** Name of a unit role's current tier for a player (for buttons). */
  roleName(player: number, role: Role): string | null {
    const tier = bestTier(role, this.players[player].epoch);
    return tier < 0 ? null : ROLE_DEFS[role].tiers[tier].name;
  }
}

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);

/** FNV-1a over the exact bits of numbers. */
class Hasher {
  value = 0x811c9dc5;

  add(n: number): void {
    f64[0] = n;
    this.mix(u32[0]);
    this.mix(u32[1]);
  }

  private mix(word: number): void {
    for (let i = 0; i < 4; i++) {
      this.value = Math.imul(this.value ^ ((word >>> (i * 8)) & 0xff), 0x01000193) >>> 0;
    }
  }
}
