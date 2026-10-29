import type { Role } from '../data/units';
import { atan2, cos, hypot, sin } from './fmath';
import type { Point } from './pathfinding';

/**
 * Formations: where each unit of a group stands around a target point.
 * Infantry forms the front, riders follow, ranged units stand behind them
 * and siege engines at the very back – in every formation. Pure functions,
 * so the renderer can preview exactly the slots the simulation will use.
 */
export type Formation = 'line' | 'block' | 'wedge';

export const FORMATIONS: Formation[] = ['line', 'block', 'wedge'];
export const FORMATION_LABEL: Record<Formation, string> = { line: 'Linie', block: 'Block', wedge: 'Keil' };
export const DEFAULT_FORMATION: Formation = 'block';

/** Rank from front to back. Units of one rank fill their own rows. */
const RANK: Record<Role, number> = {
  pike: 0,
  assault: 0,
  warrior: 0,
  mounted: 1,
  strategist: 2,
  citizen: 2,
  scout: 2,
  ranged: 3,
  priest: 3,
  prophet: 3,
  siege: 4,
  // Ships keep their own formation: warships ahead, the rest behind.
  warship: 1,
  fisher: 2,
  transport: 3,
  bombard: 4,
  // Aircraft fly to the group's goal without taking a place in the ranks.
  balloon: 2,
  fighter: 1,
  bomber: 2,
};
/** Distance between neighbours of a rank; riders and engines need more room. */
const SPACING = [0.9, 1.2, 0.9, 0.9, 1.3];

export interface Member {
  id: number;
  role: Role;
  x: number;
  y: number;
}

export interface Slot {
  id: number;
  x: number;
  y: number;
}

/** Row widths: a broad front, a square, or a wedge that widens towards the back. */
function rowWidth(kind: Formation, total: number, row: number): number {
  switch (kind) {
    case 'line':
      return Math.min(total, Math.max(8, Math.ceil(total / 3)));
    case 'block':
      return Math.ceil(Math.sqrt(total));
    case 'wedge':
      return 2 * row + 1;
  }
}

/**
 * Slots for a group standing in `kind` formation around (tx, ty), front
 * towards `facing` (radians, world coordinates). Units keep their side:
 * whoever is further left ends up further left, the ones ahead fill the
 * front rows of their rank. Deterministic for equal input.
 */
export function formationSlots(members: Member[], kind: Formation, tx: number, ty: number, facing: number): Slot[] {
  if (members.length === 0) return [];
  if (members.length === 1) return [{ id: members[0].id, x: tx, y: ty }];
  const fx = cos(facing);
  const fy = sin(facing);
  // Lateral axis, pointing to the left of the front.
  const lx = -fy;
  const ly = fx;
  const cx = members.reduce((s, m) => s + m.x, 0) / members.length;
  const cy = members.reduce((s, m) => s + m.y, 0) / members.length;
  const ahead = (m: Member) => (m.x - cx) * fx + (m.y - cy) * fy;
  const side = (m: Member) => (m.x - cx) * lx + (m.y - cy) * ly;

  const ranks: Member[][] = [];
  for (const m of members) (ranks[RANK[m.role]] ??= []).push(m);

  // Lay out rows front to back: [rank, members of the row, lateral spacing].
  const rows: Array<{ rank: number; members: Member[] }> = [];
  for (let r = 0; r < ranks.length; r++) {
    const list = ranks[r];
    if (!list) continue;
    list.sort((a, b) => ahead(b) - ahead(a) || a.id - b.id);
    let i = 0;
    while (i < list.length) {
      const width = Math.max(1, rowWidth(kind, members.length, rows.length));
      rows.push({ rank: r, members: list.slice(i, i + width) });
      i += width;
    }
  }

  const depth: number[] = [];
  rows.forEach((row, i) => {
    depth.push(i === 0 ? 0 : depth[i - 1] + Math.max(SPACING[rows[i - 1].rank], SPACING[row.rank]));
  });
  const half = depth[depth.length - 1] / 2;

  const slots: Slot[] = [];
  rows.forEach((row, i) => {
    const spacing = SPACING[row.rank];
    const forward = half - depth[i];
    const n = row.members.length;
    // Within a row: left to right, so paths don't cross.
    const sorted = [...row.members].sort((a, b) => side(b) - side(a) || a.id - b.id);
    sorted.forEach((m, k) => {
      const lateral = ((n - 1) / 2 - k) * spacing;
      slots.push({ id: m.id, x: tx + fx * forward + lx * lateral, y: ty + fy * forward + ly * lateral });
    });
  });
  return slots;
}

/** Direction a group faces when walking from its centre to a target. */
export function headingTo(members: Array<{ x: number; y: number; facing?: number }>, tx: number, ty: number): number {
  const cx = members.reduce((s, m) => s + m.x, 0) / members.length;
  const cy = members.reduce((s, m) => s + m.y, 0) / members.length;
  if (hypot(tx - cx, ty - cy) > 0.5) return atan2(ty - cy, tx - cx);
  // Already there: keep the way the group looks now.
  let sx = 0;
  let sy = 0;
  for (const m of members) {
    sx += cos(m.facing ?? 0);
    sy += sin(m.facing ?? 0);
  }
  return sx === 0 && sy === 0 ? 0 : atan2(sy, sx);
}

/** Slowest a unit is slowed down to keep pace, as a share of its own speed. */
export const MIN_PACE = 0.35;

/**
 * Marching speed per unit so that everybody reaches their slot at the same
 * time: the unit with the longest way (measured in its own speed) sets the
 * time, the others slow down to match. Nobody gets faster than they are.
 */
export function arrivalPace(from: Array<{ id: number; x: number; y: number; speed: number }>, to: Point[]): Map<number, number> {
  const pace = new Map<number, number>();
  let time = 0;
  from.forEach((m, i) => {
    time = Math.max(time, hypot(to[i].x - m.x, to[i].y - m.y) / m.speed);
  });
  from.forEach((m, i) => {
    const d = hypot(to[i].x - m.x, to[i].y - m.y);
    const v = time > 0 ? d / time : m.speed;
    pace.set(m.id, Math.min(m.speed, Math.max(m.speed * MIN_PACE, v)));
  });
  return pace;
}
