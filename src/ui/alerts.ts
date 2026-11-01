import { TICK_RATE, type World } from '../sim/world';

/** A place where own units or buildings are under fire right now. */
export interface Hotspot {
  x: number;
  y: number;
  units: number;
  buildings: number;
  /** Tick of the first hit since the fight began here. */
  since: number;
  /** Tick of the latest hit. */
  last: number;
}

/** A place counts as fought over this long after the last hit there. */
export const HOT_TICKS = TICK_RATE * 4;
/** Hits within this many tiles of each other belong to one fight. */
export const HOT_RADIUS = 10;

/**
 * Every place where the owner's units or buildings were hit in the last few seconds, the latest fight
 * first. Reads only what the simulation keeps anyway (each entity's last hit), so it changes nothing
 * there. `prev` carries `since` over, so a fight keeps its start while it goes on.
 */
export function findHotspots(w: World, owner: number, prev: readonly Hotspot[] = []): Hotspot[] {
  const r2 = HOT_RADIUS * HOT_RADIUS;
  const spots: Array<Hotspot & { sx: number; sy: number; n: number }> = [];
  const add = (e: { x: number; y: number; owner: number; dead: boolean; lastHitTick: number }, building: boolean) => {
    if (e.dead || e.owner !== owner || w.tick - e.lastHitTick > HOT_TICKS) return;
    let s = spots.find((p) => (p.x - e.x) * (p.x - e.x) + (p.y - e.y) * (p.y - e.y) <= r2);
    if (!s) {
      s = { x: e.x, y: e.y, units: 0, buildings: 0, since: e.lastHitTick, last: e.lastHitTick, sx: 0, sy: 0, n: 0 };
      spots.push(s);
    }
    s.sx += e.x;
    s.sy += e.y;
    s.n++;
    s.x = s.sx / s.n;
    s.y = s.sy / s.n;
    if (building) s.buildings++;
    else s.units++;
    s.last = Math.max(s.last, e.lastHitTick);
  };
  for (const u of w.units) add(u, false);
  for (const b of w.buildings) add(b, true);
  return spots
    .map(({ x, y, units, buildings, since, last }) => {
      const before = prev.find((p) => (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y) <= r2);
      return { x, y, units, buildings, since: before ? Math.min(before.since, since) : since, last };
    })
    .sort((a, b) => b.last - a.last || a.since - b.since);
}

/** Where along the edge of a screen rectangle the arrow towards an off-screen point sits. */
export function edgePoint(
  px: number,
  py: number,
  rect: { left: number; top: number; right: number; bottom: number },
  margin: number,
): { x: number; y: number; angle: number } | null {
  if (px >= rect.left && px <= rect.right && py >= rect.top && py <= rect.bottom) return null;
  const cx = (rect.left + rect.right) / 2;
  const cy = (rect.top + rect.bottom) / 2;
  const dx = px - cx;
  const dy = py - cy;
  const hw = (rect.right - rect.left) / 2 - margin;
  const hh = (rect.bottom - rect.top) / 2 - margin;
  // Scale the direction until it touches the inner rectangle.
  const k = Math.min(dx !== 0 ? hw / Math.abs(dx) : Infinity, dy !== 0 ? hh / Math.abs(dy) : Infinity);
  return { x: cx + dx * k, y: cy + dy * k, angle: Math.atan2(dy, dx) };
}
