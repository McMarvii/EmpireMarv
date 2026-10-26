import type { BuildingType } from '../data/buildings';
import type { Cost, Res, Stock } from '../data/resources';
import type { Role, UnitStats } from '../data/units';
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

export type Order =
  | { kind: 'idle' }
  | { kind: 'move'; x: number; y: number; attackMove: boolean }
  | { kind: 'attack'; targetId: number; resume: Point | null; leash: Point | null }
  | GatherOrder
  | { kind: 'build'; targetId: number }
  /** Carry the load to a drop-off, then go back to `resume` (or idle). */
  | { kind: 'deposit'; targetId: number; resume: GatherOrder | null };

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
}

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
  rally: Point | null;
  cooldown: number;
  scanTick: number;
  targetId: number;
  /** Bitmask of players who have seen this building (for fog of war). */
  seenBy: number;
  popBlocked: boolean;
}

export type NodeType = 'tree' | 'berries' | 'stone' | 'gold' | 'iron';

export interface ResourceNode extends BaseEntity {
  kind: 'resource';
  nodeType: NodeType;
  res: Res;
  amount: number;
  tx: number;
  ty: number;
  size: number;
  variant: number;
}

export type Entity = Unit | Building | ResourceNode;

export interface PlayerStats {
  gathered: Stock;
  unitsTrained: number;
  unitsLost: number;
  kills: number;
  buildingsBuilt: number;
  buildingsLost: number;
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
}

export function rectOf(e: Building | ResourceNode): Rect {
  return { x: e.tx, y: e.ty, w: e.size, h: e.size };
}

export const UNIT_RADIUS = 0.3;
