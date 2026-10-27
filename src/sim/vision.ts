import { BUILDING_DEFS } from '../data/buildings';
import type { World } from './world';

const circles = new Map<number, Int16Array>();

/** Tile offsets (dx, dy pairs) of a filled circle, cached per radius. */
function circle(radius: number): Int16Array {
  const r = Math.round(radius * 2) / 2;
  const cached = circles.get(r);
  if (cached) return cached;
  const out: number[] = [];
  const ri = Math.ceil(r);
  for (let dy = -ri; dy <= ri; dy++) {
    for (let dx = -ri; dx <= ri; dx++) {
      if (dx * dx + dy * dy <= r * r + 0.5) out.push(dx, dy);
    }
  }
  const arr = Int16Array.from(out);
  circles.set(r, arr);
  return arr;
}

function reveal(w: World, vis: Uint8Array, x: number, y: number, radius: number): void {
  const offs = circle(radius);
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  const W = w.map.width;
  const H = w.map.height;
  for (let i = 0; i < offs.length; i += 2) {
    const tx = cx + offs[i];
    const ty = cy + offs[i + 1];
    if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
    vis[ty * W + tx] = 2;
  }
}

/** Recomputes fog of war: visible tiles fade to "explored", then sight is re-applied. */
export function updateVision(w: World): void {
  for (const p of w.players) {
    const vis = p.vis;
    if (w.settings.revealMap) {
      vis.fill(2);
      continue;
    }
    for (let i = 0; i < vis.length; i++) if (vis[i] === 2) vis[i] = 1;
  }
  if (w.settings.revealMap) return;
  for (const u of w.units) {
    if (!u.dead) reveal(w, w.players[u.owner].vis, u.x, u.y, u.stats.sight);
  }
  for (const b of w.buildings) {
    if (b.dead) continue;
    const sight = b.built ? BUILDING_DEFS[b.type].sight + b.size / 2 : b.size;
    reveal(w, w.players[b.owner].vis, b.x, b.y, sight);
  }
  shareWithAllies(w);
  for (const b of w.buildings) {
    if (b.dead) continue;
    for (const p of w.players) {
      if (b.seenBy & (1 << p.id)) continue;
      if (w.inSight(p.id, b)) b.seenBy |= 1 << p.id;
    }
  }
}

/** Players of one team see and remember what any of them sees, the fallen included. */
function shareWithAllies(w: World): void {
  const teams = new Map<number, Uint8Array[]>();
  for (const p of w.players) {
    const list = teams.get(p.team);
    if (list) list.push(p.vis);
    else teams.set(p.team, [p.vis]);
  }
  for (const list of teams.values()) {
    if (list.length < 2) continue;
    for (let i = 0; i < list[0].length; i++) {
      let v = 0;
      for (const vis of list) if (vis[i] > v) v = vis[i];
      for (const vis of list) vis[i] = v;
    }
  }
}
