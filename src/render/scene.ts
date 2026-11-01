import type { Building } from '../sim/entities';
import { alpha as withAlpha } from './colors';
import type { Project } from './camera';
import { AIR_LOOKS, drawAirShadow, drawAircraft } from './planes';
import { SHIP_LOOKS } from './ships';
import { drawBuilding, drawNode, drawUnit, VEHICLE_LOOKS, type BuildingLook, type Ctx, type NodeLook, type UnitLook } from './sprites';

/**
 * One frame as a list of sprites: what the map shows, where and in which
 * order. Both outputs draw from it – the canvas paints every sprite afresh,
 * the WebGL renderer keeps pictures of them in a texture atlas and only
 * paints what it has not seen yet.
 */

/** Paints a sprite: `project` maps world points to pixels (the screen's or an atlas cell's), `zoom` is the camera's. */
export type Paint = (ctx: Ctx, project: Project, zoom: number, time: number) => void;

/** How a sprite changes with time – how the atlas may keep it. */
export type Anim =
  /** Never changes. */
  | { kind: 'still' }
  /** Loops at `omega` rad/s; the atlas keeps `frames` pictures of one loop, `phase` shifts it per instance. */
  | { kind: 'cycle'; omega: number; frames: number; phase: number }
  /** Too varied to share (smoke, flags, fire): one picture per instance, repainted a few times a second. */
  | { kind: 'live' };

/** A box around the anchor in unzoomed screen pixels. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface SceneSprite {
  /** Equal keys paint equal pixels at the same animation time and zoom (empty for the canvas). */
  key: string;
  /** Sprites with the same outline key share their measured size; or a known box. */
  outline: string | Box;
  /** Live sprites: the entity whose picture it is. */
  id: number;
  /** World point (and height in iso pixels) the sprite hangs from. */
  x: number;
  y: number;
  z: number;
  paint: Paint;
  /** For measuring the outline: everything the sprite may ever cover (default: paint). */
  probe?: Paint;
  anim: Anim;
  depth: number;
  alpha: number;
}

export interface Scene {
  /** Flat things on the ground, in order: farms, selection rings, footprints, shadows. */
  ground: SceneSprite[];
  /** Sorted back to front. */
  drawables: SceneSprite[];
  /** What stands behind a building, shown through it (half transparent, with a ring). */
  ghosts: SceneSprite[];
  /** Aircraft in the air, above the fog. */
  airborne: SceneSprite[];
  /** Selected own buildings whose rally chain is shown. */
  rally: Building[];
}

export const STILL: Anim = { kind: 'still' };
export const LIVE: Anim = { kind: 'live' };
const TAU = Math.PI * 2;
/** Vehicles, ships and aircraft turn in this many steps in the atlas. */
export const FACINGS = 32;

/** The look types drawn as rotated models rather than figures facing left or right. */
export function turns(look: UnitLook['look']): boolean {
  return VEHICLE_LOOKS.has(look) || SHIP_LOOKS.has(look) || AIR_LOOKS.has(look);
}

/**
 * The atlas' version of a look: facing folded to what the drawing can show
 * (left/right for figures, 32 steps for models), the attack timer to ticks.
 */
export function foldUnitLook(u: UnitLook): UnitLook {
  let facing: number;
  if (turns(u.look)) facing = (Math.round((u.facing / TAU) * FACINGS) / FACINGS) * TAU;
  else {
    // Figures are only ever mirrored: see screenDir in sprites.ts.
    const c = Math.cos(u.facing);
    const s = Math.sin(u.facing);
    facing = c - s < 0 ? Math.PI : 0;
  }
  return { ...u, facing, attackAnim: Math.round(u.attackAnim * 20) / 20 };
}

function unitKey(u: UnitLook, prefix: string): string {
  return `${prefix}${u.look}|${u.epoch}|${u.color}|${u.facing.toFixed(3)}|${u.moving ? 1 : 0}|${u.attackAnim}|${u.working ? 1 : 0}|${u.carry ?? ''}|${u.cargo ?? 0}`;
}

/** Which loop of a unit the atlas samples: walking, working or standing about. */
function unitAnim(u: UnitLook): Anim {
  const seed = u.seed;
  if (AIR_LOOKS.has(u.look)) return u.look === 'balloon' ? { kind: 'cycle', omega: 3, frames: 8, phase: seed } : { kind: 'cycle', omega: 5, frames: 8, phase: seed };
  if (SHIP_LOOKS.has(u.look)) return u.moving ? { kind: 'cycle', omega: 5, frames: 8, phase: seed } : { kind: 'cycle', omega: 1.8, frames: 12, phase: seed };
  if (VEHICLE_LOOKS.has(u.look)) return { kind: 'cycle', omega: u.moving ? 8 : 4, frames: 8, phase: seed };
  if (u.moving) return { kind: 'cycle', omega: u.look === 'horse' || u.look === 'chariot' || u.look === 'scouthorse' ? 14 : 11, frames: 8, phase: seed };
  if (u.working) return { kind: 'cycle', omega: 7, frames: 8, phase: seed };
  return { kind: 'cycle', omega: 3, frames: 12, phase: seed };
}

/** A unit standing at (x, y); `keyed` folds the look for the atlas. */
export function unitSprite(look: UnitLook, x: number, y: number, unitScale: number, keyed: boolean): SceneSprite {
  const u = keyed ? foldUnitLook(look) : look;
  return {
    key: keyed ? unitKey(u, 'U') : '',
    outline: keyed ? `U${u.look}|${u.epoch}|${u.facing.toFixed(3)}|${u.moving ? 1 : 0}|${u.working ? 1 : 0}|${u.carry ? 1 : 0}|${u.cargo ?? 0}` : '',
    id: 0,
    x,
    y,
    z: 0,
    paint: (ctx, P, zoom, time) => drawUnit(ctx, P, zoom * unitScale, x, y, u, time),
    probe: (ctx, P, zoom, time) => {
      // Weapons reach furthest mid-swing.
      for (const attackAnim of [0, 0.15, 0.3]) drawUnit(ctx, P, zoom * unitScale, x, y, { ...u, attackAnim }, time);
    },
    anim: unitAnim(u),
    depth: x + y,
    alpha: 1,
  };
}

/** An aircraft up in the air at (x, y, z). */
export function aircraftSprite(look: UnitLook, x: number, y: number, z: number, unitScale: number, keyed: boolean): SceneSprite {
  const u = keyed ? foldUnitLook(look) : look;
  return {
    key: keyed ? unitKey(u, 'A') : '',
    outline: keyed ? `A${u.look}|${u.epoch}|${u.facing.toFixed(3)}` : '',
    id: 0,
    x,
    y,
    z,
    paint: (ctx, P, zoom, time) => drawAircraft(ctx, P, zoom * unitScale, x, y, u, time, z),
    probe: (ctx, P, zoom, time) => {
      drawAircraft(ctx, P, zoom * unitScale, x, y, { ...u, moving: true, attackAnim: 0.35 }, time, z);
      drawAircraft(ctx, P, zoom * unitScale, x, y, { ...u, moving: false, attackAnim: 0 }, time, z);
    },
    anim: unitAnim(u),
    depth: x + y,
    alpha: 1,
  };
}

/** The shadow of an aircraft on the ground. */
export function airShadowSprite(look: UnitLook['look'], x: number, y: number, z: number, unitScale: number, keyed: boolean): SceneSprite {
  const zq = keyed ? Math.round(z / 2) * 2 : z;
  return {
    key: keyed ? `S${look}|${zq}` : '',
    outline: { x0: -16 * unitScale, y0: -8 * unitScale, x1: 16 * unitScale, y1: 8 * unitScale },
    id: 0,
    x,
    y,
    z: 0,
    paint: (ctx, P, zoom) => drawAirShadow(ctx, P, zoom * unitScale, look, x, y, zq),
    anim: STILL,
    depth: 0,
    alpha: 1,
  };
}

/** Damage and construction steps a building is drawn in (the atlas repaints on a change). */
function buildingKey(b: BuildingLook): string {
  const hp = b.hpRatio < 0.25 ? 2 : b.hpRatio < 0.5 ? 1 : 0;
  const progress = b.built ? 1 : Math.round(b.progress * 40) / 40;
  return `B${b.type}|${b.epoch}|${b.color}|${b.size}|${b.built ? 1 : 0}|${progress}|${hp}|${b.links ?? 0}|${b.open ? 1 : 0}|${b.counting ? 1 : 0}`;
}

export function buildingSprite(look: BuildingLook, x: number, y: number, id: number, keyed: boolean): SceneSprite {
  const b = keyed && !look.built ? { ...look, progress: Math.round(look.progress * 40) / 40 } : look;
  return {
    key: keyed ? buildingKey(b) : '',
    outline: keyed ? `B${b.type}|${b.epoch}|${b.size}|${b.built ? 1 : 0}|${b.links ?? 0}|${b.open ? 1 : 0}|${b.counting ? 1 : 0}` : '',
    id,
    x,
    y,
    z: 0,
    paint: (ctx, P, zoom, time) => drawBuilding(ctx, P, zoom, b, time),
    probe: (ctx, P, zoom, time) => {
      // Smoke of a burning building, and every stage of construction.
      for (const hpRatio of [1, 0.1]) drawBuilding(ctx, P, zoom, { ...b, hpRatio }, time);
      if (!b.built) for (const progress of [0.3, 0.7, 1]) drawBuilding(ctx, P, zoom, { ...b, progress }, time);
    },
    anim: LIVE,
    depth: 0,
    alpha: 1,
  };
}

export function nodeSprite(look: NodeLook, x: number, y: number, id: number, keyed: boolean): SceneSprite {
  const n = keyed ? { ...look, ratio: Math.round(look.ratio * 20) / 20 } : look;
  let anim: Anim = STILL;
  // Trees sway, each with its own phase; a shoal never rests.
  if (n.nodeType === 'tree') anim = { kind: 'cycle', omega: 1.3, frames: 12, phase: n.tx * 0.7 + n.ty };
  else if (n.nodeType === 'fish') anim = LIVE;
  // Deer graze: the head goes down to the grass and up again.
  else if (n.nodeType === 'deer' && n.ratio >= 1) anim = { kind: 'cycle', omega: 0.9, frames: 12, phase: n.variant * 1.9 + n.tx * 0.37 };
  return {
    key: keyed ? `N${n.nodeType}|${n.size}|${n.variant}|${n.nodeType === 'tree' ? 1 : n.ratio}` : '',
    outline: keyed ? `N${n.nodeType}|${n.size}|${n.variant}` : '',
    id,
    x,
    y,
    z: 0,
    paint: (ctx, P, zoom, time) => drawNode(ctx, P, zoom, n, time),
    probe: (ctx, P, zoom, time) => drawNode(ctx, P, zoom, { ...n, ratio: 1 }, time),
    anim,
    depth: n.tx + n.ty + n.size,
    alpha: 1,
  };
}

/** An ellipse outline on the ground, radii in unzoomed pixels. */
export function ringSprite(x: number, y: number, rx: number, ry: number, color: string, width: number, keyed: boolean): SceneSprite {
  const m = width + 1;
  return {
    key: keyed ? `E${rx.toFixed(2)}|${ry.toFixed(2)}|${color}|${width}` : '',
    outline: { x0: -rx - m, y0: -ry - m, x1: rx + m, y1: ry + m },
    id: 0,
    x,
    y,
    z: 0,
    paint: (ctx, P, zoom) => {
      const [sx, sy] = P(x, y);
      ctx.beginPath();
      ctx.ellipse(sx, sy, rx * zoom, ry * zoom, 0, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke();
    },
    anim: STILL,
    depth: 0,
    alpha: 1,
  };
}

/** The outline of a footprint: a diamond of `size` tiles. */
export function footprintSprite(tx: number, ty: number, size: number, color: string, width: number, keyed: boolean): SceneSprite {
  const m = width + 1;
  return {
    key: keyed ? `F${size}|${color}|${width}` : '',
    outline: { x0: -size * 32 - m, y0: -size * 16 - m, x1: size * 32 + m, y1: size * 16 + m },
    id: 0,
    x: tx + size / 2,
    y: ty + size / 2,
    z: 0,
    paint: (ctx, P) => paintFootprint(ctx, P, tx, ty, size, color, width),
    anim: STILL,
    depth: 0,
    alpha: 1,
  };
}

export function paintFootprint(ctx: Ctx, P: Project, tx: number, ty: number, size: number, color: string, width: number): void {
  ctx.beginPath();
  const pts = [P(tx, ty), P(tx + size, ty), P(tx + size, ty + size), P(tx, ty + size)];
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (const [x, y] of pts.slice(1)) ctx.lineTo(x, y);
  ctx.closePath();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

/** A circle of `r` tiles on the ground; dashed for reaches, solid for areas. */
export function paintAreaRing(ctx: Ctx, P: Project, zoom: number, x: number, y: number, r: number, color: string, strength: number, dashed: boolean, fill = 0.06): void {
  const [sx, sy] = P(x, y);
  const k = Math.SQRT2 * r * zoom;
  ctx.beginPath();
  ctx.ellipse(sx, sy, k * 32, k * 16, 0, 0, Math.PI * 2);
  if (fill > 0) {
    ctx.fillStyle = withAlpha(color, fill * strength);
    ctx.fill();
  }
  if (dashed) ctx.setLineDash([6, 5]);
  ctx.strokeStyle = withAlpha(color, 0.8 * strength);
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.setLineDash([]);
}

/** Dashed ground circle showing how far a house's morale bonus reaches. */
export function paintMoraleRing(ctx: Ctx, P: Project, zoom: number, x: number, y: number, radius: number, strength: number): void {
  const [sx, sy] = P(x, y);
  const k = Math.SQRT2 * radius * zoom;
  ctx.beginPath();
  ctx.ellipse(sx, sy, k * 32, k * 16, 0, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(242,200,75,${0.08 * strength})`;
  ctx.fill();
  ctx.setLineDash([6, 5]);
  ctx.strokeStyle = `rgba(242,200,75,${0.75 * strength})`;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.setLineDash([]);
}

export function moraleRingSprite(x: number, y: number, radius: number, strength: number, keyed: boolean): SceneSprite {
  const k = Math.SQRT2 * radius;
  return {
    key: keyed ? `M${radius}|${strength}` : '',
    outline: { x0: -k * 32 - 3, y0: -k * 16 - 3, x1: k * 32 + 3, y1: k * 16 + 3 },
    id: 0,
    x,
    y,
    z: 0,
    paint: (ctx, P, zoom) => paintMoraleRing(ctx, P, zoom, x, y, radius, strength),
    anim: STILL,
    depth: 0,
    alpha: 1,
  };
}

export function areaRingSprite(x: number, y: number, r: number, color: string, strength: number, dashed: boolean, keyed: boolean): SceneSprite {
  const k = Math.SQRT2 * r;
  return {
    key: keyed ? `R${r}|${color}|${strength}|${dashed ? 1 : 0}` : '',
    outline: { x0: -k * 32 - 3, y0: -k * 16 - 3, x1: k * 32 + 3, y1: k * 16 + 3 },
    id: 0,
    x,
    y,
    z: 0,
    paint: (ctx, P, zoom) => paintAreaRing(ctx, P, zoom, x, y, r, color, strength, dashed),
    anim: STILL,
    depth: 0,
    alpha: 1,
  };
}
