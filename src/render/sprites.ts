import type { BuildingType } from '../data/buildings';
import { epochStyle, type EraStyle } from '../data/epochs';
import { RES_COLOR, type Res } from '../data/resources';
import type { Look } from '../data/units';
import type { NodeType } from '../sim/entities';
import type { Project } from './camera';
import { ERA_PALETTE, shade, SKIN } from './colors';

type Ctx = CanvasRenderingContext2D;
type Pt = [number, number];

export interface UnitLook {
  look: Look;
  epoch: number;
  color: string;
  facing: number;
  moving: boolean;
  attackAnim: number;
  working: boolean;
  carry: Res | null;
  seed: number;
}

// ------------------------------------------------------------------ helpers

function poly(ctx: Ctx, pts: Pt[], fill: string, stroke?: string, lw = 1): void {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw;
    ctx.stroke();
  }
}

function line(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, color: string, w: number): void {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.stroke();
}

function circle(ctx: Ctx, x: number, y: number, r: number, fill: string, stroke?: string, lw = 1): void {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0.1, r), 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw;
    ctx.stroke();
  }
}

function ellipse(ctx: Ctx, x: number, y: number, rx: number, ry: number, fill: string): void {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

/**
 * Extruded quad in world space: a box whose ground corners are rotated by
 * `facing` around (cx, cy). Sides are depth-sorted so it reads as solid.
 */
function box3d(
  ctx: Ctx,
  project: Project,
  cx: number,
  cy: number,
  facing: number,
  hl: number,
  hw: number,
  z0: number,
  z1: number,
  top: string,
  side: string,
): Pt[] {
  const c = Math.cos(facing);
  const s = Math.sin(facing);
  const corners: Array<[number, number]> = [
    [cx + c * hl - s * hw, cy + s * hl + c * hw],
    [cx + c * hl + s * hw, cy + s * hl - c * hw],
    [cx - c * hl + s * hw, cy - s * hl - c * hw],
    [cx - c * hl - s * hw, cy - s * hl + c * hw],
  ];
  const sides = [0, 1, 2, 3].map((i) => {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    return { a, b, depth: a[0] + a[1] + b[0] + b[1] };
  });
  sides.sort((p, q) => p.depth - q.depth);
  for (const { a, b } of sides) {
    // Only faces turned towards the viewer (south-east) are visible.
    const nx = b[1] - a[1];
    const ny = a[0] - b[0];
    const lit = nx + ny < 0 ? -0.18 : -0.32;
    poly(ctx, [project(a[0], a[1], z0), project(b[0], b[1], z0), project(b[0], b[1], z1), project(a[0], a[1], z1)], shade(side, lit));
  }
  const topPts = corners.map(([x, y]) => project(x, y, z1));
  poly(ctx, topPts, top);
  return topPts;
}

function screenDir(facing: number): { dx: number; dy: number } {
  const c = Math.cos(facing);
  const s = Math.sin(facing);
  return { dx: c - s, dy: (c + s) / 2 };
}

// -------------------------------------------------------------------- units

const VEHICLE_LOOKS = new Set<Look>(['tank', 'mech', 'armoredcar', 'ram', 'catapult', 'trebuchet', 'cannon', 'rocket', 'beam']);

export function drawUnit(ctx: Ctx, project: Project, scale: number, wx: number, wy: number, u: UnitLook, time: number): void {
  const [sx, sy] = project(wx, wy);
  if (VEHICLE_LOOKS.has(u.look)) {
    drawVehicle(ctx, project, scale, wx, wy, u, time);
    return;
  }
  const big = u.look === 'horse' || u.look === 'chariot';
  ellipse(ctx, sx, sy, (big ? 10 : 6) * scale, (big ? 4.5 : 3) * scale, 'rgba(0,0,0,0.28)');
  const flip = screenDir(u.facing).dx < 0 ? -1 : 1;
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(scale * flip, scale);
  if (big) drawMounted(ctx, u, time);
  else drawHumanoid(ctx, u, time, 0, 0, 1);
  ctx.restore();
}

function helmet(ctx: Ctx, style: EraStyle, x: number, y: number, citizen: boolean): void {
  const pal = ERA_PALETTE[style];
  if (citizen) {
    if (style === 'modern') {
      ctx.beginPath();
      ctx.arc(x, y - 0.5, 3.3, Math.PI, 0);
      ctx.fillStyle = '#f2c230';
      ctx.fill();
    } else if (style === 'future') {
      line(ctx, x - 1, y - 0.5, x + 3, y - 0.5, '#38d6f5', 1.4);
    } else {
      ctx.beginPath();
      ctx.arc(x, y - 0.8, 3.1, Math.PI * 1.05, Math.PI * 1.95);
      ctx.fillStyle = '#4a3020';
      ctx.fill();
    }
    return;
  }
  switch (style) {
    case 'stone':
      ctx.beginPath();
      ctx.arc(x, y - 0.8, 3.2, Math.PI * 1.0, Math.PI * 2.0);
      ctx.fillStyle = '#3b2a1a';
      ctx.fill();
      break;
    case 'ancient':
      ctx.beginPath();
      ctx.arc(x, y - 0.5, 3.4, Math.PI, 0);
      ctx.fillStyle = pal.metal;
      ctx.fill();
      line(ctx, x - 2.5, y - 4.5, x + 2, y - 4.8, '#b8322a', 1.6);
      break;
    case 'medieval':
      ctx.fillStyle = pal.metal;
      ctx.fillRect(x - 3.2, y - 3.6, 6.4, 4.4);
      line(ctx, x - 1, y - 0.8, x + 3.2, y - 0.8, '#222', 0.9);
      break;
    case 'imperial':
      ctx.fillStyle = pal.metal;
      ctx.fillRect(x - 3, y - 6, 6, 4.2);
      ctx.fillStyle = '#d8b04a';
      ctx.fillRect(x - 3, y - 2.6, 6, 0.9);
      break;
    case 'modern':
      ctx.beginPath();
      ctx.ellipse(x, y - 1, 3.9, 2.8, 0, Math.PI, 0);
      ctx.fillStyle = pal.metal;
      ctx.fill();
      break;
    case 'future':
      ctx.beginPath();
      ctx.arc(x, y - 0.2, 3.5, Math.PI * 0.95, Math.PI * 2.05);
      ctx.fillStyle = '#e8f0f4';
      ctx.fill();
      line(ctx, x, y - 0.4, x + 3.3, y - 0.4, '#38d6f5', 1.3);
      break;
  }
}

/** Upright figure facing right; feet at (ox, oy). */
function drawHumanoid(ctx: Ctx, u: UnitLook, time: number, ox: number, oy: number, k: number): void {
  const style = epochStyle(u.epoch);
  const citizen = u.look === 'citizen';
  const phase = u.moving ? Math.sin(time * 11 + u.seed) : 0;
  const swing = u.attackAnim > 0 ? Math.sin((u.attackAnim / 0.35) * Math.PI) : 0;
  const workSwing = u.working ? Math.sin(time * 7 + u.seed) : 0;
  const body = citizen ? shade(u.color, 0.25) : u.color;
  const dark = '#2a2420';
  ctx.save();
  ctx.translate(ox, oy);
  ctx.scale(k, k);

  const legColor = style === 'modern' ? '#4f553a' : style === 'future' ? '#cfd8de' : dark;
  line(ctx, -1.5, -7, -1.5 + phase * 2.2, 0, legColor, 2.2);
  line(ctx, 1.5, -7, 1.5 - phase * 2.2, 0, legColor, 2.2);
  // Torso with era accent at the shoulders.
  ctx.fillStyle = body;
  ctx.fillRect(-3.6, -15.5, 7.2, 9);
  ctx.fillStyle = shade(body, -0.3);
  ctx.fillRect(-3.6, -8, 7.2, 1.4);
  if (!citizen && style !== 'stone') {
    ctx.fillStyle = ERA_PALETTE[style].metal;
    ctx.fillRect(-3.8, -15.8, 7.6, 2.2);
  }
  if (citizen && u.carry) {
    circle(ctx, -4.5, -11, 2.6, RES_COLOR[u.carry], shade(RES_COLOR[u.carry], -0.4), 0.8);
  }
  circle(ctx, 0, -18.5, 3, SKIN);
  helmet(ctx, style, 0, -18.5, citizen);

  const hx = 3;
  const hy = -11.5;
  const metal = '#c9ced4';
  const wood = '#6b4a2b';
  switch (u.look) {
    case 'citizen': {
      if (u.working) {
        const a = -1.2 + workSwing * 0.9;
        const ex = hx + Math.cos(a) * 8;
        const ey = hy + Math.sin(a) * 8;
        line(ctx, hx, hy, ex, ey, wood, 1.6);
        line(ctx, ex - 1.5, ey - 1, ex + 1.5, ey + 1, '#9aa0a6', 2);
      } else {
        line(ctx, hx - 1, hy, hx + 1, hy + 4, SKIN, 1.6);
      }
      break;
    }
    case 'club': {
      const a = -1.9 + swing * 1.9;
      const ex = hx + Math.cos(a) * 8;
      const ey = hy + Math.sin(a) * 8;
      line(ctx, hx, hy, ex, ey, wood, 2.4);
      circle(ctx, ex, ey, 1.8, shade(wood, -0.2));
      break;
    }
    case 'sword': {
      ellipse(ctx, -3.6, -11.5, 2.4, 4.2, shade(u.color, -0.25));
      ctx.strokeStyle = ERA_PALETTE[style].metal;
      ctx.lineWidth = 0.8;
      ctx.stroke();
      const a = -1.6 + swing * 1.8;
      line(ctx, hx, hy, hx + Math.cos(a) * 10, hy + Math.sin(a) * 10, metal, 1.6);
      break;
    }
    case 'spear': {
      ellipse(ctx, -3.6, -11.5, 2.6, 4.5, shade(u.color, -0.25));
      const thrust = swing * 4;
      line(ctx, -2 + thrust, -3, 9 + thrust, -24, wood, 1.4);
      poly(ctx, [[9 + thrust, -24], [7.4 + thrust, -21.6], [10.6 + thrust, -21.4]], metal);
      break;
    }
    case 'sling': {
      const a = time * (u.attackAnim > 0 ? 25 : 3);
      line(ctx, hx, hy, hx + Math.cos(a) * 5, hy - 4 + Math.sin(a) * 3, '#8a7a5a', 1);
      break;
    }
    case 'bow': {
      ctx.beginPath();
      ctx.arc(hx + 1, hy, 7, -1.25, 1.25);
      ctx.strokeStyle = wood;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      const pull = swing * 3;
      line(ctx, hx + 1 + Math.cos(-1.25) * 7, hy + Math.sin(-1.25) * 7, hx - pull, hy, '#ddd', 0.6);
      line(ctx, hx - pull, hy, hx + 1 + Math.cos(1.25) * 7, hy + Math.sin(1.25) * 7, '#ddd', 0.6);
      break;
    }
    case 'gun':
    case 'rifle':
    case 'trooper':
    case 'laser': {
      const len = u.look === 'gun' ? 13 : 11;
      const col = u.look === 'laser' ? '#dfe6ea' : u.look === 'gun' ? wood : '#2b2b2b';
      line(ctx, -2, hy + 0.5, len - 2, hy - 0.8, col, u.look === 'trooper' ? 2 : 1.6);
      if (u.look === 'laser') line(ctx, 2, hy - 0.2, len - 1, hy - 1, '#38d6f5', 0.8);
      if (u.look === 'gun' && style !== 'stone') line(ctx, len - 3, hy - 0.6, len + 1, hy - 1, metal, 0.8);
      if (u.attackAnim > 0.2) circle(ctx, len - 1, hy - 1, 2.2, u.look === 'laser' ? '#9ff3ff' : '#ffd25a');
      break;
    }
    case 'rocketeer': {
      ctx.save();
      ctx.translate(-4, -16.5);
      ctx.rotate(-0.08);
      ctx.fillStyle = '#4c5532';
      ctx.fillRect(0, -1.8, 14, 3.6);
      ctx.fillStyle = '#2a2f1c';
      ctx.fillRect(12.5, -2.2, 2, 4.4);
      ctx.restore();
      if (u.attackAnim > 0.2) circle(ctx, -5, -16.5, 2.5, '#f7a540');
      break;
    }
    default:
      break;
  }
  ctx.restore();
}

function drawMounted(ctx: Ctx, u: UnitLook, time: number): void {
  const style = epochStyle(u.epoch);
  const phase = u.moving ? Math.sin(time * 14 + u.seed) : 0;
  const horse = '#7a4e2d';
  const legs: Array<[number, number]> = [
    [-6, phase],
    [-3.5, -phase],
    [4, -phase],
    [6.5, phase],
  ];
  for (const [x, p] of legs) line(ctx, x, -8, x + p * 2.5, 0, shade(horse, -0.25), 1.8);
  if (u.look === 'chariot') {
    // Cart behind the horse.
    ctx.fillStyle = shade(u.color, -0.15);
    ctx.fillRect(-15, -12, 8, 6);
    circle(ctx, -11, -4.5, 4, 'rgba(0,0,0,0)', '#4a3020', 1.6);
    line(ctx, -7, -9, -3, -9.5, '#4a3020', 1.2);
  }
  ellipse(ctx, 0, -10, 8.5, 4, horse);
  // Caparison in the player's colour from the high middle ages on.
  if (u.epoch >= 7 && u.look === 'horse') {
    poly(ctx, [[-7, -12], [6, -12], [7, -6], [-8, -6]], u.color);
  }
  poly(ctx, [[5, -12], [9, -19], [12.5, -18], [9.5, -11]], horse);
  line(ctx, -8, -11, -11, -5 + phase, shade(horse, -0.4), 1.6);
  const riderX = u.look === 'chariot' ? -11 : -1;
  const riderY = u.look === 'chariot' ? -11 : -11;
  drawHumanoid(
    ctx,
    { ...u, look: style === 'stone' || style === 'ancient' ? 'spear' : u.epoch >= 10 ? 'gun' : 'sword', moving: false },
    time,
    riderX,
    riderY + 5,
    0.85,
  );
}

/** Vehicles are modelled in world units; this enlarges them around their center. */
const VEHICLE_SIZE = 1.6;

function drawVehicle(ctx: Ctx, baseProject: Project, scale: number, wx: number, wy: number, u: UnitLook, time: number): void {
  const project: Project = (x, y, z = 0) => baseProject(wx + (x - wx) * VEHICLE_SIZE, wy + (y - wy) * VEHICLE_SIZE, z * VEHICLE_SIZE);
  const f = u.facing;
  const c = Math.cos(f);
  const s = Math.sin(f);
  const [sx, sy] = project(wx, wy);
  const fire = u.attackAnim > 0.2;
  const hull = shade(u.color, -0.1);
  ellipse(ctx, sx, sy, 13 * scale, 6 * scale, 'rgba(0,0,0,0.28)');
  switch (u.look) {
    case 'tank': {
      box3d(ctx, project, wx, wy, f, 0.42, 0.28, 0, 4, '#3a3a33', '#2c2c27');
      box3d(ctx, project, wx, wy, f, 0.38, 0.24, 4, 9, hull, u.color);
      box3d(ctx, project, wx - c * 0.05, wy - s * 0.05, f, 0.16, 0.14, 9, 13, shade(u.color, 0.1), u.color);
      const [bx0, by0] = project(wx + c * 0.1, wy + s * 0.1, 11);
      const [bx1, by1] = project(wx + c * 0.62, wy + s * 0.62, 11.5);
      line(ctx, bx0, by0, bx1, by1, '#2b2b2b', 2.4 * scale);
      if (fire) circle(ctx, bx1, by1, 3.5 * scale, '#ffcf5a');
      break;
    }
    case 'armoredcar': {
      for (const [dl, dw] of [
        [0.25, 0.22],
        [-0.25, 0.22],
        [0.25, -0.22],
        [-0.25, -0.22],
      ]) {
        const [x, y] = project(wx + c * dl - s * dw, wy + s * dl + c * dw, 2);
        circle(ctx, x, y, 2.6 * scale, '#1e1e1e');
      }
      box3d(ctx, project, wx, wy, f, 0.36, 0.2, 2, 9, hull, u.color);
      box3d(ctx, project, wx, wy, f, 0.1, 0.1, 9, 12, shade(u.color, 0.15), u.color);
      const [bx1, by1] = project(wx + c * 0.38, wy + s * 0.38, 10.5);
      const [bx0, by0] = project(wx, wy, 10.5);
      line(ctx, bx0, by0, bx1, by1, '#2b2b2b', 1.4 * scale);
      if (fire) circle(ctx, bx1, by1, 2.5 * scale, '#ffcf5a');
      break;
    }
    case 'mech': {
      const step = u.moving ? Math.sin(time * 8 + u.seed) * 0.08 : 0;
      for (const side of [-1, 1]) {
        const lx = wx - s * side * 0.14 + c * step * side;
        const ly = wy + c * side * 0.14 + s * step * side;
        const [x0, y0] = project(lx, ly, 0);
        const [x1, y1] = project(lx, ly, 12);
        line(ctx, x0, y0, x1, y1, '#4a5058', 3 * scale);
      }
      box3d(ctx, project, wx, wy, f, 0.22, 0.2, 12, 22, '#e8f0f4', u.color);
      box3d(ctx, project, wx, wy, f, 0.08, 0.08, 22, 26, u.color, u.color);
      for (const side of [-1, 1]) {
        const ax = wx - s * side * 0.26;
        const ay = wy + c * side * 0.26;
        const [x0, y0] = project(ax, ay, 17);
        const [x1, y1] = project(ax + c * 0.45, ay + s * 0.45, 17);
        line(ctx, x0, y0, x1, y1, '#5a626b', 2.6 * scale);
        line(ctx, x0, y0, x1, y1, '#38d6f5', 0.8 * scale);
        if (fire) circle(ctx, x1, y1, 3 * scale, '#9ff3ff');
      }
      break;
    }
    case 'ram': {
      box3d(ctx, project, wx, wy, f, 0.42, 0.26, 0, 10, '#7a5530', '#6b4a2b');
      const [lx0, ly0] = project(wx + c * 0.2, wy + s * 0.2, 6);
      const [lx1, ly1] = project(wx + c * (0.62 + u.attackAnim), wy + s * (0.62 + u.attackAnim), 6);
      line(ctx, lx0, ly0, lx1, ly1, '#4a3020', 3.5 * scale);
      const [px, py] = project(wx, wy, 10);
      poly(ctx, [[px - 4 * scale, py], [px + 4 * scale, py], [px, py - 5 * scale]], u.color);
      break;
    }
    case 'catapult':
    case 'trebuchet': {
      const treb = u.look === 'trebuchet';
      box3d(ctx, project, wx, wy, f, 0.4, 0.26, 0, 4, '#7a5530', '#6b4a2b');
      for (const [dl, dw] of [
        [0.3, 0.24],
        [-0.3, 0.24],
        [0.3, -0.24],
        [-0.3, -0.24],
      ]) {
        const [x, y] = project(wx + c * dl - s * dw, wy + s * dl + c * dw, 2);
        circle(ctx, x, y, 2.4 * scale, '#3d2a18');
      }
      const pivotZ = treb ? 20 : 9;
      const [px, py] = project(wx, wy, pivotZ);
      const [gx, gy] = project(wx, wy, 4);
      line(ctx, gx - 3 * scale, gy, px, py, '#5a3e22', 2 * scale);
      line(ctx, gx + 3 * scale, gy, px, py, '#5a3e22', 2 * scale);
      const throwT = u.attackAnim > 0 ? 1 - u.attackAnim / 0.35 : 1;
      const armBack = treb ? 0.55 : 0.45;
      const tipW = { x: wx - c * armBack * (2 * throwT - 1), y: wy - s * armBack * (2 * throwT - 1) };
      const [ax, ay] = project(tipW.x, tipW.y, pivotZ + (treb ? 10 : 7) * (1 - Math.abs(2 * throwT - 1)) + 3);
      line(ctx, px, py, ax, ay, '#6b4a2b', 2 * scale);
      circle(ctx, ax, ay, 2.2 * scale, '#555');
      if (treb) circle(ctx, px + (px - ax) * 0.25, py + (py - ay) * 0.25 + 3 * scale, 3.2 * scale, '#4a4a4a');
      const [fx, fy] = project(wx, wy, 5);
      ctx.fillStyle = u.color;
      ctx.fillRect(fx - 2 * scale, fy - 2 * scale, 4 * scale, 3 * scale);
      break;
    }
    case 'cannon': {
      const modern = u.epoch >= 12;
      for (const side of [-1, 1]) {
        const [x, y] = project(wx - s * side * 0.22, wy + c * side * 0.22, 4);
        circle(ctx, x, y, 4.5 * scale, 'rgba(0,0,0,0)', modern ? '#262626' : '#5a3e22', 1.8 * scale);
      }
      const [bx0, by0] = project(wx - c * 0.3, wy - s * 0.3, 3);
      const [bx1, by1] = project(wx + c * 0.45, wy + s * 0.45, modern ? 11 : 7);
      line(ctx, bx0, by0, bx1, by1, modern ? '#4b5132' : '#2e2e2e', (modern ? 3 : 4) * scale);
      const [tx, ty] = project(wx - c * 0.15, wy - s * 0.15, 5);
      circle(ctx, tx, ty, 2.4 * scale, u.color);
      if (fire) {
        circle(ctx, bx1, by1, 4.5 * scale, '#ffcf5a');
        circle(ctx, bx1, by1 - 4 * scale, 4 * scale, 'rgba(200,200,200,0.6)');
      }
      break;
    }
    case 'rocket': {
      box3d(ctx, project, wx, wy, f, 0.45, 0.24, 2, 9, '#5a6040', '#4b5132');
      box3d(ctx, project, wx + c * 0.3, wy + s * 0.3, f, 0.12, 0.22, 9, 15, u.color, u.color);
      box3d(ctx, project, wx - c * 0.15, wy - s * 0.15, f, 0.22, 0.2, 9, 17, '#3d4229', '#3d4229');
      for (const [dl, dw] of [
        [0.3, 0.22],
        [-0.3, 0.22],
        [0.3, -0.22],
        [-0.3, -0.22],
      ]) {
        const [x, y] = project(wx + c * dl - s * dw, wy + s * dl + c * dw, 2);
        circle(ctx, x, y, 2.4 * scale, '#1e1e1e');
      }
      if (fire) {
        const [x, y] = project(wx - c * 0.4, wy - s * 0.4, 14);
        circle(ctx, x, y, 4 * scale, '#f7a540');
      }
      break;
    }
    case 'beam': {
      const hover = Math.sin(time * 3 + u.seed) * 1.5;
      const [x, y] = project(wx, wy, 6 + hover);
      ellipse(ctx, x, y, 12 * scale, 5.5 * scale, '#cfd8de');
      ellipse(ctx, x, y - 1.2 * scale, 10 * scale, 4.2 * scale, u.color);
      box3d(ctx, project, wx, wy, f, 0.15, 0.12, 8 + hover, 16 + hover, '#e8f0f4', '#c3d0d8');
      const [ex, ey] = project(wx + c * 0.45, wy + s * 0.45, 13 + hover);
      const [ox, oy] = project(wx, wy, 13 + hover);
      line(ctx, ox, oy, ex, ey, '#8a96a0', 2.5 * scale);
      circle(ctx, ex, ey, (fire ? 4 : 1.8) * scale, '#9ff3ff');
      break;
    }
  }
}

// ---------------------------------------------------------------- buildings

export interface BuildingLook {
  type: BuildingType;
  epoch: number;
  color: string;
  tx: number;
  ty: number;
  size: number;
  progress: number;
  built: boolean;
  hpRatio: number;
  seed: number;
}

function roofPyramid(ctx: Ctx, project: Project, x0: number, y0: number, x1: number, y1: number, z: number, h: number, color: string): void {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const apex = project(cx, cy, z + h);
  const a = project(x0, y0, z);
  const b = project(x1, y0, z);
  const c = project(x1, y1, z);
  const d = project(x0, y1, z);
  poly(ctx, [a, b, apex], shade(color, 0.1));
  poly(ctx, [d, a, apex], shade(color, -0.05));
  poly(ctx, [b, c, apex], shade(color, -0.12));
  poly(ctx, [c, d, apex], shade(color, -0.25));
}

function roofGable(ctx: Ctx, project: Project, x0: number, y0: number, x1: number, y1: number, z: number, h: number, color: string): void {
  const my = (y0 + y1) / 2;
  const r0 = project(x0, my, z + h);
  const r1 = project(x1, my, z + h);
  poly(ctx, [project(x0, y0, z), project(x1, y0, z), r1, r0], shade(color, 0.08));
  poly(ctx, [project(x1, y0, z), project(x1, y1, z), r1], shade(color, -0.3));
  poly(ctx, [project(x0, y1, z), project(x1, y1, z), r1, r0], shade(color, -0.12));
}

function dome(ctx: Ctx, project: Project, cx: number, cy: number, z: number, r: number, scale: number, color: string): void {
  const [x, y] = project(cx, cy, z);
  ctx.beginPath();
  ctx.ellipse(x, y, r * scale, r * scale * 0.55, 0, 0, Math.PI);
  ctx.ellipse(x, y, r * scale, r * scale * 0.9, 0, Math.PI, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x - r * scale * 0.3, y - r * scale * 0.45, r * scale * 0.25, r * scale * 0.18, -0.5, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fill();
}

function flag(ctx: Ctx, x: number, y: number, scale: number, color: string, time: number, seed: number): void {
  line(ctx, x, y, x, y - 14 * scale, '#3a2a1a', 1.2 * scale);
  const wave = Math.sin(time * 4 + seed) * 1.5 * scale;
  poly(ctx, [[x, y - 14 * scale], [x + 9 * scale, y - 12 * scale + wave], [x, y - 9 * scale]], color);
}

/** Window rows on the two visible walls. */
function windows(ctx: Ctx, project: Project, x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, color: string, scale: number): void {
  const rows = Math.max(1, Math.floor((z1 - z0) / 10));
  for (let r = 0; r < rows; r++) {
    const z = z0 + ((r + 0.5) * (z1 - z0)) / rows;
    for (let t = 0.2; t < 0.9; t += 0.3) {
      const [ax, ay] = project(x0 + (x1 - x0) * t, y1, z);
      ctx.fillStyle = color;
      ctx.fillRect(ax - 1.6 * scale, ay - 2 * scale, 3.2 * scale, 3.6 * scale);
      const [bx, by] = project(x1, y1 - (y1 - y0) * t, z);
      ctx.fillRect(bx - 1.6 * scale, by - 2 * scale, 3.2 * scale, 3.6 * scale);
    }
  }
}

interface Geometry {
  inset: number;
  wall: number;
}

const GEOMETRY: Record<BuildingType, Geometry> = {
  towncenter: { inset: 0.3, wall: 54 },
  house: { inset: 0.3, wall: 26 },
  barracks: { inset: 0.25, wall: 38 },
  stable: { inset: 0.25, wall: 32 },
  workshop: { inset: 0.25, wall: 40 },
  storehouse: { inset: 0.3, wall: 26 },
  farm: { inset: 0.1, wall: 0 },
  tower: { inset: 0.55, wall: 84 },
};

type RoofKind = 'pyramid' | 'gable' | 'temple' | 'dome' | 'flat' | 'glass';

function roofOf(style: EraStyle, type: BuildingType, size: number): { kind: RoofKind; h: number } {
  switch (style) {
    case 'stone':
      return { kind: 'pyramid', h: size * (type === 'tower' ? 16 : 20) };
    case 'ancient':
      return type === 'towncenter' || type === 'barracks' ? { kind: 'temple', h: size * 9 } : { kind: 'pyramid', h: size * 11 };
    case 'medieval':
      return type === 'tower' ? { kind: 'pyramid', h: size * 26 } : { kind: 'gable', h: size * 15 };
    case 'imperial':
      if (type === 'towncenter') return { kind: 'dome', h: size * 5 };
      return type === 'tower' ? { kind: 'flat', h: 4 } : { kind: 'pyramid', h: size * 12 };
    case 'modern':
      return { kind: 'flat', h: 3 };
    case 'future':
      return { kind: 'glass', h: size * (type === 'tower' ? 4 : 6) };
  }
}

function wallHeight(type: BuildingType, style: EraStyle): number {
  return GEOMETRY[type].wall * (style === 'modern' || style === 'future' ? 1.2 : 1);
}

/** Height of a building's highest point in unzoomed pixels (for bars and picking). */
export function buildingTopZ(type: BuildingType, epoch: number, size: number): number {
  if (type === 'farm') return 12;
  const style = epochStyle(epoch);
  const roof = roofOf(style, type, size);
  return wallHeight(type, style) + (roof.kind === 'dome' || roof.kind === 'glass' ? roof.h * 0.9 : roof.h) + 14;
}

function palisade(ctx: Ctx, project: Project, b: BuildingLook, front: boolean, scale: number): void {
  const n = b.size * 3;
  const posts: Array<[number, number]> = [];
  for (let i = 0; i <= n; i++) {
    const t = b.size * (i / n);
    if (front) posts.push([b.tx + t, b.ty + b.size - 0.08], [b.tx + b.size - 0.08, b.ty + t]);
    else posts.push([b.tx + t, b.ty + 0.08], [b.tx + 0.08, b.ty + t]);
  }
  for (const [x, y] of posts) {
    const [ax, ay] = project(x, y, 0);
    const [bx, by] = project(x, y, 12);
    line(ctx, ax, ay, bx, by, '#6b4a2b', 2.6 * scale);
    circle(ctx, bx, by, 1.3 * scale, '#8a6a42');
  }
}

export function drawBuilding(ctx: Ctx, project: Project, scale: number, b: BuildingLook, time: number): void {
  const style = epochStyle(b.epoch);
  const pal = ERA_PALETTE[style];
  if (b.type === 'farm') {
    drawFarm(ctx, project, b, style);
    return;
  }
  const geo = GEOMETRY[b.type];
  const x0 = b.tx + geo.inset;
  const y0 = b.ty + geo.inset;
  const x1 = b.tx + b.size - geo.inset;
  const y1 = b.ty + b.size - geo.inset;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const hw = (x1 - x0) / 2;

  // Foundation.
  poly(
    ctx,
    [project(b.tx + 0.1, b.ty + 0.1), project(b.tx + b.size - 0.1, b.ty + 0.1), project(b.tx + b.size - 0.1, b.ty + b.size - 0.1), project(b.tx + 0.1, b.ty + b.size - 0.1)],
    style === 'modern' || style === 'future' ? 'rgba(150,150,150,0.35)' : 'rgba(60,45,25,0.22)',
  );
  if (!b.built && b.progress < 0.08) {
    poly(ctx, [project(x0, y0), project(x1, y0), project(x1, y1), project(x0, y1)], 'rgba(120,100,70,0.6)', '#e9d9a6', 1);
    return;
  }
  const palisaded = style === 'stone' && b.type === 'towncenter' && b.built;
  if (palisaded) palisade(ctx, project, b, false, scale);

  const fullH = wallHeight(b.type, style);
  const h = b.built ? fullH : fullH * Math.min(1, b.progress * 1.2);
  const wall = pal.wall;

  if (!b.built) ctx.globalAlpha = 0.85;
  box3d(ctx, project, cx, cy, 0, hw, (y1 - y0) / 2, 0, h, shade(wall, 0.05), wall);
  // Player colour band under the eaves.
  const band = Math.max(0, h - 5);
  poly(ctx, [project(x0, y1, band), project(x1, y1, band), project(x1, y1, h), project(x0, y1, h)], b.color);
  poly(ctx, [project(x1, y1, band), project(x1, y0, band), project(x1, y0, h), project(x1, y1, h)], shade(b.color, -0.25));

  if (b.built) {
    if (style === 'medieval') {
      for (let t = 0.2; t < 1; t += 0.2) {
        const [ax, ay] = project(x0 + (x1 - x0) * t, y1, 0);
        const [bx, by] = project(x0 + (x1 - x0) * t, y1, band);
        line(ctx, ax, ay, bx, by, pal.trim, 1.3 * scale);
        const [cx2, cy2] = project(x1, y1 - (y1 - y0) * t, 0);
        const [dx2, dy2] = project(x1, y1 - (y1 - y0) * t, band);
        line(ctx, cx2, cy2, dx2, dy2, pal.trim, 1.3 * scale);
      }
      const [ax, ay] = project(x0, y1, band * 0.5);
      const [bx, by] = project(x1, y1, band * 0.5);
      line(ctx, ax, ay, bx, by, pal.trim, 1.3 * scale);
    }
    if ((style === 'imperial' || style === 'modern' || style === 'future') && b.type !== 'tower') {
      windows(ctx, project, x0, y0, x1, y1, 4, band - 3, style === 'future' ? '#38d6f5' : style === 'modern' ? '#9cc3dd' : '#3b3f46', scale);
    }
    if (b.type !== 'tower') {
      // Door on the south-west face.
      const dw = Math.min(0.35, hw * 0.35);
      const doorH = Math.min(h * 0.55, 22);
      poly(ctx, [project(cx - dw, y1, 0), project(cx + dw, y1, 0), project(cx + dw, y1, doorH), project(cx - dw, y1, doorH)], style === 'future' ? '#2a6f80' : '#3a2a1c');
    }
  }

  if (!b.built) {
    for (const [px, py] of [
      [x0, y1],
      [x1, y1],
      [x1, y0],
    ]) {
      const [ax, ay] = project(px, py, 0);
      const [bx, by] = project(px, py, fullH);
      line(ctx, ax, ay, bx, by, '#b08a50', 1.4 * scale);
    }
    ctx.globalAlpha = 1;
    return;
  }

  const roof = roofOf(style, b.type, b.size);
  switch (roof.kind) {
    case 'pyramid':
      roofPyramid(ctx, project, x0 - 0.12, y0 - 0.12, x1 + 0.12, y1 + 0.12, h, roof.h, pal.roof);
      break;
    case 'gable':
      roofGable(ctx, project, x0 - 0.08, y0 - 0.08, x1 + 0.08, y1 + 0.08, h, roof.h, pal.roof);
      break;
    case 'temple': {
      box3d(ctx, project, cx, cy, 0, hw + 0.08, (y1 - y0) / 2 + 0.08, h, h + 4, '#efe3c2', pal.wall);
      roofGable(ctx, project, x0 - 0.08, y0 - 0.08, x1 + 0.08, y1 + 0.08, h + 4, roof.h, pal.roof);
      for (let t = 0.08; t < 1; t += 0.14) {
        const [ax, ay] = project(x0 + (x1 - x0) * t, y1 + 0.12, 0);
        const [bx, by] = project(x0 + (x1 - x0) * t, y1 + 0.12, h);
        line(ctx, ax, ay, bx, by, '#f8f0dc', 2.4 * scale);
      }
      break;
    }
    case 'dome':
      box3d(ctx, project, cx, cy, 0, hw * 0.7, ((y1 - y0) / 2) * 0.7, h, h + 10, pal.trim, pal.wall);
      dome(ctx, project, cx, cy, h + 10, roof.h * 4, scale, '#5b8a72');
      break;
    case 'flat': {
      box3d(ctx, project, cx, cy, 0, hw + 0.04, (y1 - y0) / 2 + 0.04, h, h + roof.h, pal.roof, pal.wallDark);
      if (style === 'imperial') {
        // Crenellations on bastions.
        for (let t = 0; t <= 1; t += 0.34) {
          box3d(ctx, project, x0 + (x1 - x0) * t, y1, 0, 0.08, 0.08, h + roof.h, h + roof.h + 5, pal.wall, pal.wallDark);
          box3d(ctx, project, x1, y1 - (y1 - y0) * t, 0, 0.08, 0.08, h + roof.h, h + roof.h + 5, pal.wall, pal.wallDark);
        }
      }
      if (b.type === 'workshop' || b.type === 'stable') {
        const [ax, ay] = project(x0 + 0.4, y0 + 0.4, h + roof.h);
        ctx.fillStyle = '#6b4a3a';
        ctx.fillRect(ax - 3 * scale, ay - 22 * scale, 6 * scale, 22 * scale);
        const puff = (time * 0.6 + b.seed * 0.17) % 1;
        circle(ctx, ax + puff * 6 * scale, ay - (24 + puff * 18) * scale, (4 + puff * 6) * scale, `rgba(120,120,120,${0.5 * (1 - puff)})`);
      }
      break;
    }
    case 'glass':
      box3d(ctx, project, cx, cy, 0, hw + 0.04, (y1 - y0) / 2 + 0.04, h, h + 3, '#f4fbff', pal.wall);
      dome(ctx, project, cx, cy, h + 3, roof.h * 3, scale, 'rgba(143,208,224,0.88)');
      break;
  }

  if (palisaded) palisade(ctx, project, b, true, scale);
  if (b.type === 'storehouse') {
    for (const [dx, dy] of [
      [0.2, 0.28],
      [0.55, 0.22],
    ]) {
      box3d(ctx, project, x0 + (x1 - x0) * dx, y1 + dy, 0, 0.14, 0.14, 0, 10, '#b08850', '#8a6a3a');
    }
  }
  if (b.type === 'stable' && style !== 'modern' && style !== 'future') {
    for (let t = 0; t <= 1.001; t += 0.25) {
      const [ax, ay] = project(x1 + 0.2, y0 + (y1 - y0) * t, 0);
      line(ctx, ax, ay, ax, ay - 9 * scale, '#6b4a2b', 1.6 * scale);
    }
  }
  if (b.type === 'tower' && b.epoch >= 15) {
    const [tx, ty] = project(cx, cy, h + roof.h * 2);
    line(ctx, tx, ty, tx + 14 * scale, ty + 4 * scale, '#5a626b', 4 * scale);
  }
  const top = roof.kind === 'dome' ? h + 10 + roof.h * 3.4 : roof.kind === 'glass' ? h + 3 + roof.h * 2.6 : h + roof.h;
  const [fx, fy] = project(cx, cy, top);
  flag(ctx, fx, fy, scale * 1.4, b.color, time, b.seed);

  // Damage: smoke and fire below half health.
  if (b.hpRatio < 0.5) {
    const n = b.hpRatio < 0.25 ? 3 : 1;
    for (let i = 0; i < n; i++) {
      const t = (time * 0.7 + i * 0.37 + b.seed * 0.13) % 1;
      const [px, py] = project(x0 + (x1 - x0) * (0.3 + i * 0.2), y0 + (y1 - y0) * 0.6, h);
      circle(ctx, px, py - t * 26 * scale, (4 + t * 7) * scale, `rgba(60,60,60,${0.55 * (1 - t)})`);
      circle(ctx, px, py, 3.5 * scale, `rgba(255,${120 + Math.floor(t * 80)},40,0.85)`);
    }
  }
}

function drawFarm(ctx: Ctx, project: Project, b: BuildingLook, style: EraStyle): void {
  const x0 = b.tx + 0.1;
  const y0 = b.ty + 0.1;
  const x1 = b.tx + b.size - 0.1;
  const y1 = b.ty + b.size - 0.1;
  poly(ctx, [project(x0, y0), project(x1, y0), project(x1, y1), project(x0, y1)], b.built ? '#7a5c34' : 'rgba(122,92,52,0.6)', '#5e4426', 1);
  if (!b.built) return;
  const crop = style === 'modern' || style === 'future' ? '#9ccf4a' : '#c8b04a';
  for (let i = 1; i < 6; i++) {
    const t = i / 6;
    const [ax, ay] = project(x0 + (x1 - x0) * t, y0);
    const [bx, by] = project(x0 + (x1 - x0) * t, y1);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.strokeStyle = crop;
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }
  // Fence posts in the player's colour on the near corner.
  const [px, py] = project(x1, y1);
  circle(ctx, px, py - 2, 2, b.color);
}

// ---------------------------------------------------------------- resources

export interface NodeLook {
  nodeType: NodeType;
  tx: number;
  ty: number;
  size: number;
  ratio: number;
  variant: number;
}

export function drawNode(ctx: Ctx, project: Project, scale: number, n: NodeLook, time: number): void {
  const cx = n.tx + n.size / 2;
  const cy = n.ty + n.size / 2;
  const [x, y] = project(cx, cy);
  const k = scale * 1.9;
  switch (n.nodeType) {
    case 'tree': {
      ellipse(ctx, x, y + 1 * k, 9 * k, 4 * k, 'rgba(0,0,0,0.25)');
      ctx.fillStyle = '#5b3d22';
      ctx.fillRect(x - 1.5 * k, y - 12 * k, 3 * k, 12 * k);
      const sway = Math.sin(time * 1.3 + n.tx * 0.7 + n.ty) * 0.8 * k;
      if (n.variant % 2 === 0) {
        const greens = ['#2c6528', '#33742d', '#3b8233'];
        for (let i = 0; i < 3; i++) {
          poly(
            ctx,
            [
              [x + sway * (0.4 + i * 0.3), y - (30 - i * 7) * k - 6 * k],
              [x - (9 - i * 1.5) * k, y - (12 + i * 7) * k],
              [x + (9 - i * 1.5) * k, y - (12 + i * 7) * k],
            ],
            greens[i],
          );
        }
      } else {
        const g = n.variant === 1 ? '#3e7d32' : '#4a8a36';
        circle(ctx, x - 5 * k + sway * 0.5, y - 17 * k, 6.5 * k, shade(g, -0.18));
        circle(ctx, x + 5 * k + sway * 0.5, y - 18 * k, 6.5 * k, shade(g, -0.06));
        circle(ctx, x + sway, y - 24 * k, 7.5 * k, g);
        circle(ctx, x - 2.5 * k + sway, y - 26.5 * k, 3 * k, shade(g, 0.2));
      }
      break;
    }
    case 'berries': {
      const r = (4.5 + 2.5 * n.ratio) * k;
      ellipse(ctx, x, y + 1 * k, r * 1.2, r * 0.5, 'rgba(0,0,0,0.2)');
      circle(ctx, x, y - r * 0.8, r, '#3f7a2e');
      circle(ctx, x - r * 0.4, y - r * 1.1, r * 0.55, '#4b8a36');
      const count = Math.ceil(7 * n.ratio);
      for (let i = 0; i < count; i++) {
        const a = i * 2.1 + n.variant;
        circle(ctx, x + Math.cos(a) * r * 0.6, y - r * 0.8 + Math.sin(a) * r * 0.5, 1.2 * k, '#c9283c');
      }
      break;
    }
    default: {
      const base = n.nodeType === 'gold' ? '#8d8576' : n.nodeType === 'iron' ? '#6e6a68' : '#a3a29b';
      const fleck = n.nodeType === 'gold' ? '#f2c84b' : n.nodeType === 'iron' ? '#b5603a' : '#d9d8d2';
      // Rocks fill the whole footprint and only shrink a little while mined out.
      const amount = (0.75 + 0.25 * n.ratio) * 0.9 * n.size;
      const bulk = 0.6 + 0.4 * n.size;
      const rocks: Array<[number, number, number]> = [
        [-0.35, -0.3, 0.55],
        [0.3, -0.35, 0.5],
        [0, 0.05, 0.75],
        [-0.4, 0.35, 0.45],
        [0.4, 0.3, 0.5],
      ];
      for (const [dx, dy, r] of rocks) {
        const [rx, ry] = project(cx + dx * amount, cy + dy * amount);
        const rr = r * (amount / (0.9 * n.size)) * bulk * 13 * k * 0.8;
        poly(
          ctx,
          [
            [rx - rr, ry],
            [rx - rr * 0.6, ry - rr * 0.95],
            [rx + rr * 0.3, ry - rr * 1.15],
            [rx + rr, ry - rr * 0.3],
            [rx + rr * 0.8, ry + rr * 0.3],
            [rx - rr * 0.5, ry + rr * 0.35],
          ],
          base,
          shade(base, -0.35),
          0.8,
        );
        poly(ctx, [[rx - rr * 0.6, ry - rr * 0.95], [rx + rr * 0.3, ry - rr * 1.15], [rx + rr * 0.1, ry - rr * 0.4], [rx - rr * 0.5, ry - rr * 0.3]], shade(base, 0.18));
        circle(ctx, rx - rr * 0.15, ry - rr * 0.55, rr * 0.16, fleck);
        circle(ctx, rx + rr * 0.45, ry - rr * 0.25, rr * 0.13, fleck);
        circle(ctx, rx - rr * 0.55, ry - rr * 0.05, rr * 0.1, fleck);
      }
      break;
    }
  }
}
