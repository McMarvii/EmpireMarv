import type { AbilityId, Status } from '../data/abilities';
import type { BuildingType } from '../data/buildings';
import type { Cost, Res, Stock } from '../data/resources';
import type { Mods } from '../data/techs';
import type { Role, UnitStats } from '../data/units';
import type { Formation } from './formation';
import type { Point, Rect } from './pathfinding';

export interface GatherOrder {
  kind: 'gather';
  targetId: number;
  res: Res;
  phase: 'toNode' | 'work' | 'toDrop';
  dropId: number;
  /** Last known node position, to find the next tree once one is felled. */
  lx: number;
  ly: number;
  /** Set once the worker has taken the last step up to the node's edge. */
  snug?: boolean;
}

export interface PatrolOrder {
  kind: 'patrol';
  /** Walked in a loop; enemies on the way are fought, then the round goes on. */
  points: Point[];
  index: number;
}

export type Order =
  | { kind: 'idle' }
  /** `pace` caps the speed so a group arrives together. */
  | { kind: 'move'; x: number; y: number; attackMove: boolean; pace?: number }
  /** `resume`: the walk to pick up again after the fight (attack-move or patrol). */
  | { kind: 'attack'; targetId: number; resume: Order | null; leash: Point | null }
  | GatherOrder
  | { kind: 'build'; targetId: number }
  /** Carry the load to a drop-off, then go back to `resume` (or idle). */
  | { kind: 'deposit'; targetId: number; resume: GatherOrder | null }
  /** Head for the nearest unexplored ground until the whole map is known. */
  | { kind: 'explore'; tx: number; ty: number; skip: number[] }
  | PatrolOrder
  /** Priest: win an enemy unit over; `progress` in seconds of channelling, `seenHit` the last hit already paid for. */
  | { kind: 'convert'; targetId: number; progress: number; seenHit: number }
  /** Priest: heal a friendly unit until it is whole. */
  | { kind: 'heal'; targetId: number }
  /** Prophet: walk within range of a spot, then call down a calamity. */
  | { kind: 'cast'; ability: AbilityId; x: number; y: number }
  /** Take shelter in a town center or tower; `resume` is the work to go back to afterwards. */
  | { kind: 'garrison'; targetId: number; resume: Order | null }
  /** Walk to the shore and go aboard a transport ship. */
  | { kind: 'board'; targetId: number }
  /** Transport ship: sail to the coast near a point and put everybody ashore. */
  | { kind: 'unload'; x: number; y: number }
  /**
   * Plane: fly home to an airfield (0: none yet), refuel, reload and get
   * repaired there, then pick `resume` up again. No fighting on the way.
   */
  | { kind: 'refuel'; targetId: number; resume: Order | null };

/** A queued command (Shift), turned into an order once the unit gets to it. */
export type Plan =
  | { kind: 'move'; x: number; y: number; attackMove: boolean; pace?: number }
  | { kind: 'attack'; targetId: number }
  | { kind: 'gather'; targetId: number; res: Res; lx: number; ly: number }
  | { kind: 'build'; targetId: number }
  | { kind: 'deposit'; targetId: number; resume: GatherOrder | null }
  | { kind: 'explore' }
  | { kind: 'patrol'; points: Point[] }
  | { kind: 'convert'; targetId: number }
  | { kind: 'heal'; targetId: number }
  | { kind: 'board'; targetId: number }
  | { kind: 'unload'; x: number; y: number }
  | { kind: 'refuel'; targetId: number };

interface BaseEntity {
  id: number;
  owner: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  dead: boolean;
  lastHitTick: number;
}

export interface Unit extends BaseEntity {
  kind: 'unit';
  role: Role;
  tier: number;
  stats: UnitStats;
  /** Position at the previous tick, for render interpolation. */
  px: number;
  py: number;
  facing: number;
  order: Order;
  /** Orders to carry out after the current one, oldest first. */
  queue: Plan[];
  formation: Formation;
  /** Marches in step with its group (slows down so everybody arrives together). */
  lockstep: boolean;
  /** Building or ship the unit is inside (0: outside). Units inside leave `World.units`. */
  inside: number;
  /** Transport ships: the units on board. */
  cargo: Unit[];
  /** Planes: seconds of flight left in the tank. */
  fuel: number;
  /** Bombers: bombs left for this sortie. */
  ammo: number;
  path: Point[];
  repathTick: number;
  scanTick: number;
  cooldown: number;
  carry: Res | null;
  carryAmount: number;
  morale: number;
  moving: boolean;
  attackAnim: number;
  stuckTime: number;
  /** Priests and prophets: faith points for conversions and calamities. */
  faith: number;
  /** Tick from which each used ability is ready again. */
  ready: Partial<Record<AbilityId, number>>;
  /** Timed states (stunned, hastened, shielded …) with the tick they end. */
  status: Partial<Record<Status, number>>;
  /** Hero auras on this unit, refreshed every second (AURA_LED, AURA_INSPIRED). */
  aura: number;
  /** Who infected it with the plague (for kill statistics). */
  plagueBy: number;
}

/** Near the own strategist: more morale, slow healing. */
export const AURA_LED = 1;
/** Near the own warrior: stronger attacks. */
export const AURA_INSPIRED = 2;

export interface QueueItem {
  role: Role;
  progress: number;
  /** What was paid, refunded on cancel. */
  cost: Cost;
}

export interface Building extends BaseEntity {
  kind: 'building';
  type: BuildingType;
  tx: number;
  ty: number;
  size: number;
  built: boolean;
  progress: number;
  /** Owner's epoch (updated on every advance); drives looks and hit points. */
  epoch: number;
  queue: QueueItem[];
  research: { targetEpoch: number; progress: number; total: number } | null;
  /** Technology being researched here; runs alongside unit training. */
  tech: { id: string; progress: number; total: number; cost: Cost } | null;
  /** Technologies waiting here, already paid; the first starts once its prerequisites are researched. */
  techQueue: Array<{ id: string; cost: Cost }>;
  /** Epoch advance (already paid) waiting for the first `ahead` units of the queue. */
  pendingAdvance: { targetEpoch: number; ahead: number } | null;
  /** Waypoints for new units; the last one is the gathering point. */
  rally: Point[];
  cooldown: number;
  scanTick: number;
  targetId: number;
  /** Bitmask of players who have seen this building (for fog of war). */
  seenBy: number;
  popBlocked: boolean;
  /** Wonders: ticks left until the wonder victory (only with it switched on, once finished). */
  countdown: number;
  /** Citizens sheltering inside (town center, tower); each one adds an arrow. */
  garrison: Unit[];
}

/** A calamity at work: deterministic, processed every tick until `until`. */
export interface Hazard {
  id: number;
  kind: 'plague' | 'quake' | 'firestorm' | 'storm';
  x: number;
  y: number;
  r: number;
  owner: number;
  start: number;
  until: number;
}

/** Fish lie on water and only boats can catch them. */
export type NodeType = 'tree' | 'berries' | 'stone' | 'gold' | 'iron' | 'fish';

export interface ResourceNode extends BaseEntity {
  kind: 'resource';
  nodeType: NodeType;
  res: Res;
  amount: number;
  tx: number;
  ty: number;
  size: number;
  variant: number;
  /** Tick until which gatherers skip this node because it could not be reached. */
  blockedUntil: number;
}

export type Entity = Unit | Building | ResourceNode;

export interface PlayerStats {
  gathered: Stock;
  unitsTrained: number;
  unitsLost: number;
  kills: number;
  buildingsBuilt: number;
  buildingsLost: number;
  /** Enemy units won over by priests. */
  converted: number;
}

export interface Player {
  id: number;
  name: string;
  color: string;
  team: number;
  isAI: boolean;
  stock: Stock;
  epoch: number;
  alive: boolean;
  /** Fog of war: 0 unexplored, 1 explored, 2 currently visible. */
  vis: Uint8Array;
  stats: PlayerStats;
  /** Resource multiplier, used for AI difficulty handicaps. */
  gatherBonus: number;
  /** Finished technologies and the bonuses they add up to. */
  techs: Set<string>;
  mods: Mods;
}

export function rectOf(e: Building | ResourceNode): Rect {
  return { x: e.tx, y: e.ty, w: e.size, h: e.size };
}

export const UNIT_RADIUS = 0.3;
