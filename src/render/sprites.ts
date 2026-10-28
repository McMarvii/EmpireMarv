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

export const VEHICLE_LOOKS = new Set<Look>(['tank', 'mech', 'armoredcar', 'ram', 'catapult', 'trebuchet', 'cannon', 'rocket', 'beam', 'jeep', 'drone']);

export function drawUnit(ctx: Ctx, project: Project, scale: number, wx: number, wy: number, u: UnitLook, time: number): void {
  const [sx, sy] = project(wx, wy);
  if (VEHICLE_LOOKS.has(u.look)) {
    drawVehicle(ctx, project, scale, wx, wy, u, time);
    return;
  }
  const big = u.look === 'horse' || u.look === 'chariot' || u.look === 'scouthorse';
  const hero = HERO_SIZE[u.look];
  ellipse(ctx, sx, sy, (big ? 10 : 6) * scale, (big ? 4.5 : 3) * scale, 'rgba(0,0,0,0.28)');
  if (hero) {
    // Heroes stand out: a slowly pulsing golden ring at their feet.
    ctx.beginPath();
    ctx.ellipse(sx, sy, 8.5 * scale, 4.2 * scale, 0, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(242,200,75,${0.55 + 0.25 * Math.sin(time * 3 + u.seed)})`;
    ctx.lineWidth = 1.4 * scale;
    ctx.stroke();
  }
  const flip = screenDir(u.facing).dx < 0 ? -1 : 1;
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(scale * flip, scale);
  if (big) drawMounted(ctx, u, time);
  else drawHumanoid(ctx, u, time, 0, 0, hero ?? 1);
  ctx.restore();
}

/** Heroes are drawn a little larger than the rank and file. */
const HERO_SIZE: Partial<Record<Look, number>> = { strategist: 1.15, warrior: 1.2 };

/** Priests' robes by era: hide, linen, monk's habit, cassock, field grey, white. */
const PRIEST_ROBE: Record<EraStyle, string> = {
  stone: '#8a6a44',
  ancient: '#efe6cc',
  medieval: '#6b4a2b',
  imperial: '#26262b',
  modern: '#5c6340',
  future: '#eef4f7',
};

/** Headgear of heroes, priests and prophets (instead of a soldier's helmet). */
function specialHat(ctx: Ctx, look: Look, style: EraStyle, x: number, y: number, color: string, time: number): void {
  if (look === 'prophet') {
    // Deep hood; in the future era with a glowing seam.
    ctx.beginPath();
    ctx.arc(x - 0.6, y, 3.9, Math.PI * 0.75, Math.PI * 2.1);
    ctx.lineTo(x - 3.6, y + 3.4);
    ctx.closePath();
    ctx.fillStyle = style === 'future' ? '#3a2a6a' : '#4b2f73';
    ctx.fill();
    if (style === 'future') line(ctx, x - 3, y - 2.6, x + 2.6, y - 2.6, '#38d6f5', 0.8);
    return;
  }
  if (look === 'priest') {
    switch (style) {
      case 'stone':
        // Antlers.
        for (const s of [-1, 1]) {
          line(ctx, x + s * 1.2, y - 2.6, x + s * 3.6, y - 7.5, '#d9c7a0', 0.9);
          line(ctx, x + s * 2.6, y - 5.5, x + s * 4.8, y - 5.8, '#d9c7a0', 0.8);
        }
        break;
      case 'ancient':
        ctx.beginPath();
        ctx.arc(x, y - 0.6, 3.2, Math.PI * 1.05, Math.PI * 1.95);
        ctx.strokeStyle = '#5d8a3a';
        ctx.lineWidth = 1.3;
        ctx.stroke();
        break;
      case 'medieval':
        ctx.beginPath();
        ctx.arc(x - 0.5, y, 3.6, Math.PI * 0.8, Math.PI * 2.05);
        ctx.fillStyle = PRIEST_ROBE.medieval;
        ctx.fill();
        break;
      case 'imperial':
        ctx.fillStyle = '#1c1c20';
        ctx.fillRect(x - 2.8, y - 5.6, 5.6, 3.2);
        circle(ctx, x, y - 6, 0.9, '#b8322a');
        break;
      case 'modern':
        helmet(ctx, style, x, y, false);
        ctx.fillStyle = '#f4f4f4';
        ctx.fillRect(x - 0.4, y - 3.6, 0.8, 2.4);
        ctx.fillRect(x - 1.2, y - 2.8, 2.4, 0.8);
        break;
      case 'future':
        ctx.beginPath();
        ctx.ellipse(x, y - 5.5, 3.4, 1.1, 0, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(56,214,245,${0.6 + 0.3 * Math.sin(time * 4)})`;
        ctx.lineWidth = 0.9;
        ctx.stroke();
        break;
    }
    return;
  }
  if (look === 'strategist') {
    switch (style) {
      case 'stone':
        // Feather crown.
        for (const [dx, c] of [
          [-1.8, '#f4f0e6'],
          [0, '#c8322a'],
          [1.8, '#f4f0e6'],
        ] as Array<[number, string]>) {
          line(ctx, x + dx * 0.6, y - 2.8, x + dx, y - 8, c, 1.3);
        }
        ctx.fillStyle = color;
        ctx.fillRect(x - 3.1, y - 3.2, 6.2, 1.2);
        break;
      case 'ancient':
        helmet(ctx, style, x, y, false);
        line(ctx, x - 3, y - 4.4, x + 2.4, y - 5.2, '#f2c84b', 2);
        break;
      case 'medieval':
        helmet(ctx, style, x, y, false);
        for (const dx of [-2.4, 0, 2.4]) poly(ctx, [[x + dx - 0.9, y - 3.6], [x + dx + 0.9, y - 3.6], [x + dx, y - 6]], '#f2c84b');
        break;
      case 'imperial':
        // Bicorne with a cockade in the player's colour.
        ctx.beginPath();
        ctx.ellipse(x, y - 3.4, 5.2, 2, 0, Math.PI, 0);
        ctx.fillStyle = '#1c1c20';
        ctx.fill();
        circle(ctx, x + 1.5, y - 3.8, 0.9, color);
        break;
      case 'modern':
        ctx.beginPath();
        ctx.ellipse(x, y - 2.6, 3.4, 1.8, 0, Math.PI, 0);
        ctx.fillStyle = '#4f553a';
        ctx.fill();
        line(ctx, x, y - 2.4, x + 4.2, y - 2, '#1c1c20', 1.1);
        circle(ctx, x + 0.6, y - 3.4, 0.7, '#f2c84b');
        break;
      case 'future':
        helmet(ctx, style, x, y, false);
        line(ctx, x - 3, y - 2.6, x + 2.8, y - 3.2, '#f2c84b', 0.9);
        break;
    }
    return;
  }
  // Warrior: a soldier's helmet with a hero's touch.
  helmet(ctx, style, x, y, false);
  if (style === 'stone') {
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x + s * 2.6, y - 2.4);
      ctx.quadraticCurveTo(x + s * 5.2, y - 4, x + s * 4.4, y - 7.2);
      ctx.strokeStyle = '#efe6cc';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  } else if (style === 'medieval' || style === 'imperial') {
    line(ctx, x - 0.5, y - 3.6, x - 3, y - 7.5, color, 1.6);
  }
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
  // Scouts on foot travel light, dressed like civilians.
  const citizen = u.look === 'citizen' || u.look === 'runner';
  const phase = u.moving ? Math.sin(time * 11 + u.seed) : 0;
  const swing = u.attackAnim > 0 ? Math.sin((u.attackAnim / 0.35) * Math.PI) : 0;
  const workSwing = u.working ? Math.sin(time * 7 + u.seed) : 0;
  const body = citizen ? shade(u.color, 0.25) : u.color;
  const dark = '#2a2420';
  ctx.save();
  ctx.translate(ox, oy);
  ctx.scale(k, k);

  const robed = u.look === 'priest' || u.look === 'prophet';
  const special = robed || u.look === 'strategist' || u.look === 'warrior';
  if (u.look === 'strategist') {
    // Cape billowing behind, and the banner in the back hand.
    const flutter = Math.sin(time * 5 + u.seed) * 0.8 + (u.moving ? 1.2 : 0);
    poly(ctx, [[-3.2, -15.5], [0.5, -15.5], [-2.2 - flutter, -1.5], [-7 - flutter * 1.4, -2.5]], shade(u.color, -0.35));
    const pole = style === 'future' ? '#c3d0d8' : '#4a3020';
    line(ctx, -4.2, -3, -4.2, -31, pole, 1.2);
    const wave = Math.sin(time * 6 + u.seed) * 1.4;
    if (style === 'future') {
      poly(ctx, [[-4.2, -31], [5, -29 + wave], [5, -24 + wave], [-4.2, -25]], 'rgba(56,214,245,0.45)');
      line(ctx, -4.2, -31, 5, -29 + wave, '#bff4ff', 0.6);
    } else {
      poly(ctx, [[-4.2, -31], [5.5, -29.5 + wave], [3.5, -27 + wave * 0.6], [5.5, -24.5 + wave], [-4.2, -25]], u.color);
      circle(ctx, -4.2, -31.6, 0.9, '#f2c84b');
    }
  }
  if (robed) {
    const robe = u.look === 'priest' ? PRIEST_ROBE[style] : style === 'future' ? '#3a2a6a' : '#5b3a8a';
    const sway = phase * 1.1;
    poly(ctx, [[-3.4, -15.5], [3.4, -15.5], [4.8 + sway, 0], [-4.8 + sway, 0]], robe);
    poly(ctx, [[-3.4, -15.5], [-1.2, -15.5], [-2.4 + sway, 0], [-4.8 + sway, 0]], shade(robe, -0.18));
    // Stole or sash in the player's colour.
    line(ctx, -1, -15.2, 1.6 + sway * 0.5, -1, u.color, 1.4);
  } else {
    const legColor = style === 'modern' ? '#4f553a' : style === 'future' ? '#cfd8de' : dark;
    line(ctx, -1.5, -7, -1.5 + phase * 2.2, 0, legColor, 2.2);
    line(ctx, 1.5, -7, 1.5 - phase * 2.2, 0, legColor, 2.2);
    // Torso with era accent at the shoulders.
    ctx.fillStyle = body;
    ctx.fillRect(-3.6, -15.5, 7.2, 9);
    ctx.fillStyle = shade(body, -0.3);
    ctx.fillRect(-3.6, -8, 7.2, 1.4);
    if (!citizen && style !== 'stone') {
      ctx.fillStyle = u.look === 'strategist' || u.look === 'warrior' ? '#d8b04a' : ERA_PALETTE[style].metal;
      ctx.fillRect(-3.8, -15.8, 7.6, 2.2);
    }
  }
  if (citizen && u.carry) {
    circle(ctx, -4.5, -11, 2.6, RES_COLOR[u.carry], shade(RES_COLOR[u.carry], -0.4), 0.8);
  }
  circle(ctx, 0, -18.5, 3, SKIN);
  if (special) specialHat(ctx, u.look, style, 0, -18.5, u.color, time);
  else helmet(ctx, style, 0, -18.5, citizen);

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
    case 'runner': {
      // Signal pennant instead of a weapon.
      const wave = Math.sin(time * 6 + u.seed) * 1.2;
      line(ctx, hx, hy + 3, hx + 1, hy - 13, wood, 1.2);
      poly(ctx, [[hx + 1, hy - 13], [hx + 9, hy - 11 + wave], [hx + 1, hy - 8]], u.color);
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
    case 'strategist': {
      const a = -1.5 + swing * 1.7;
      if (style === 'modern') {
        // Pistol.
        line(ctx, hx, hy, hx + 5, hy - 0.6, '#1c1c20', 1.8);
        if (u.attackAnim > 0.2) circle(ctx, hx + 6, hy - 0.8, 1.8, '#ffd25a');
      } else if (style === 'future') {
        line(ctx, hx, hy, hx + Math.cos(a) * 7, hy + Math.sin(a) * 7, '#c3d0d8', 1.4);
        circle(ctx, hx + Math.cos(a) * 7.5, hy + Math.sin(a) * 7.5, 1.4, u.attackAnim > 0 ? '#ffffff' : '#38d6f5');
      } else if (style === 'imperial') {
        // Curved sabre.
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        ctx.quadraticCurveTo(hx + Math.cos(a - 0.3) * 6, hy + Math.sin(a - 0.3) * 6, hx + Math.cos(a) * 10, hy + Math.sin(a) * 10);
        ctx.strokeStyle = metal;
        ctx.lineWidth = 1.4;
        ctx.stroke();
      } else {
        line(ctx, hx, hy, hx + Math.cos(a) * 9, hy + Math.sin(a) * 9, style === 'stone' ? '#a3a29b' : metal, 1.7);
        line(ctx, hx - Math.sin(a) * 1.6, hy + Math.cos(a) * 1.6, hx + Math.sin(a) * 1.6, hy - Math.cos(a) * 1.6, '#d8b04a', 1.1);
      }
      break;
    }
    case 'warrior': {
      if (u.epoch >= 12) {
        // Commando: rifle with a bayonet; elite fighters carry an energy rifle.
        const laser = u.epoch >= 16;
        line(ctx, -2.5, hy + 0.8, 12, hy - 0.8, laser ? '#dfe6ea' : '#2b2b2b', 2.4);
        if (laser) line(ctx, 1, hy, 11, hy - 0.8, '#38d6f5', 1);
        else line(ctx, 12, hy - 0.8, 15, hy - 1.1, metal, 0.9);
        if (u.attackAnim > 0.2) circle(ctx, 13, hy - 1, 2.6, laser ? '#9ff3ff' : '#ffd25a');
        break;
      }
      // Shield on the back arm.
      const shieldCol = style === 'ancient' ? '#c49a45' : shade(u.color, -0.2);
      if (style === 'medieval') {
        poly(ctx, [[-7, -16], [-1.5, -16], [-1.5, -10], [-4.2, -5.5], [-7, -10]], shieldCol, '#d8b04a', 0.9);
      } else if (style !== 'imperial') {
        circle(ctx, -4.2, -11.5, 4.6, shieldCol, style === 'ancient' ? '#8a6a2a' : '#4a3020', 1);
        circle(ctx, -4.2, -11.5, 1.1, style === 'ancient' ? '#8a6a2a' : '#d9c7a0');
      }
      const a = -2 + swing * 2.2;
      const ex = hx + Math.cos(a) * 12;
      const ey = hy + Math.sin(a) * 12;
      switch (style) {
        case 'stone':
          line(ctx, hx, hy, ex, ey, wood, 3);
          circle(ctx, ex, ey, 2.6, shade(wood, -0.15));
          for (const d of [-1, 1]) line(ctx, ex, ey, ex + d * 2.4, ey - 2.2, '#efe6cc', 0.9);
          break;
        case 'ancient': {
          // Double axe.
          line(ctx, hx, hy, ex, ey, wood, 1.8);
          const nx = -Math.sin(a);
          const ny = Math.cos(a);
          const bx = hx + Math.cos(a) * 10;
          const by = hy + Math.sin(a) * 10;
          poly(ctx, [[bx, by], [bx + nx * 4 + Math.cos(a) * 2, by + ny * 4 + Math.sin(a) * 2], [bx + nx * 4 - Math.cos(a) * 2, by + ny * 4 - Math.sin(a) * 2]], metal);
          poly(ctx, [[bx, by], [bx - nx * 4 + Math.cos(a) * 2, by - ny * 4 + Math.sin(a) * 2], [bx - nx * 4 - Math.cos(a) * 2, by - ny * 4 - Math.sin(a) * 2]], metal);
          break;
        }
        default:
          // Greatsword, or the heavy sabre of a Haudegen.
          line(ctx, hx, hy, hx + Math.cos(a) * 14, hy + Math.sin(a) * 14, metal, 2);
          line(ctx, hx + Math.sin(a) * 2.2, hy - Math.cos(a) * 2.2, hx - Math.sin(a) * 2.2, hy + Math.cos(a) * 2.2, '#d8b04a', 1.3);
      }
      break;
    }
    case 'priest': {
      // Staff with the era's sign; it glows while praying or healing.
      const sx0 = hx + 1;
      line(ctx, sx0, -1, sx0, -24, style === 'future' ? '#c3d0d8' : wood, 1.2);
      const top = -25.5;
      if (u.attackAnim > 0 || u.working) {
        circle(ctx, sx0, top, 4.5 + Math.sin(time * 9) * 0.8, 'rgba(255,226,122,0.45)');
      }
      switch (style) {
        case 'stone':
          circle(ctx, sx0, top, 1.9, '#e9dcc0');
          line(ctx, sx0 - 1.6, top - 1, sx0 - 3, top - 3.4, '#e9dcc0', 0.8);
          line(ctx, sx0 + 1.6, top - 1, sx0 + 3, top - 3.4, '#e9dcc0', 0.8);
          break;
        case 'ancient':
          circle(ctx, sx0, top, 2.3, '#f2c84b', '#b48a45', 0.6);
          break;
        case 'modern':
          // Field chaplain: a book in the other hand instead of a sign on the staff.
          ctx.fillStyle = '#7a2a24';
          ctx.fillRect(-4.6, -12.5, 3.4, 4.2);
          line(ctx, sx0 - 1.6, top + 1, sx0 + 1.6, top + 1, '#d8d8d8', 1);
          line(ctx, sx0, top - 1, sx0, top + 3, '#d8d8d8', 1);
          break;
        case 'future':
          poly(ctx, [[sx0, top - 3.2], [sx0 + 1.8, top], [sx0, top + 3.2], [sx0 - 1.8, top]], '#38d6f5', '#bff4ff', 0.6);
          break;
        default: {
          const c = style === 'medieval' ? '#c9a24a' : '#e6c55a';
          line(ctx, sx0, top - 3, sx0, top + 3, c, 1.3);
          line(ctx, sx0 - 2, top - 1, sx0 + 2, top - 1, c, 1.3);
        }
      }
      break;
    }
    case 'prophet': {
      // Tall staff with a pulsing orb that flares when a calamity is called.
      const sx0 = hx + 1.5;
      const lift = u.attackAnim > 0 ? Math.sin((u.attackAnim / 0.35) * Math.PI) * 3 : 0;
      line(ctx, sx0, -1 - lift, sx0 + 0.5, -27 - lift, style === 'future' ? '#c3d0d8' : '#3d2a18', 1.3);
      const pulse = 0.5 + 0.5 * Math.sin(time * 3 + u.seed);
      const orb = style === 'future' ? '#9ff3ff' : '#c78bff';
      const glow = u.attackAnim > 0 ? 7 : 3.5 + pulse;
      circle(ctx, sx0 + 0.5, -29 - lift, glow, style === 'future' ? 'rgba(120,240,255,0.3)' : 'rgba(190,120,255,0.3)');
      circle(ctx, sx0 + 0.5, -29 - lift, 2, orb, '#ffffff', 0.5);
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
  if (u.look === 'scouthorse') {
    // Light saddle blanket in the player's colour.
    poly(ctx, [[-4, -13], [3, -13], [3.5, -9], [-4.5, -9]], u.color);
  }
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
    {
      ...u,
      look: u.look === 'scouthorse' ? 'runner' : style === 'stone' || style === 'ancient' ? 'spear' : u.epoch >= 10 ? 'gun' : 'sword',
      moving: false,
    },
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
    case 'jeep': {
      for (const [dl, dw] of [
        [0.22, 0.17],
        [-0.22, 0.17],
        [0.22, -0.17],
        [-0.22, -0.17],
      ]) {
        const [x, y] = project(wx + c * dl - s * dw, wy + s * dl + c * dw, 2);
        circle(ctx, x, y, 2.2 * scale, '#1e1e1e');
      }
      box3d(ctx, project, wx, wy, f, 0.3, 0.17, 2, 6, '#6f7550', '#5c6340');
      // Windscreen and a radio mast with a pennant in the player's colour.
      box3d(ctx, project, wx + c * 0.1, wy + s * 0.1, f, 0.02, 0.16, 6, 9, '#9cc3dd', '#7a9cb2');
      const [mx0, my0] = project(wx - c * 0.22, wy - s * 0.22, 6);
      const [mx1, my1] = project(wx - c * 0.22, wy - s * 0.22, 20);
      line(ctx, mx0, my0, mx1, my1, '#2b2b2b', 0.9 * scale);
      poly(ctx, [[mx1, my1], [mx1 + 7 * scale, my1 + 2 * scale], [mx1, my1 + 4 * scale]], u.color);
      break;
    }
    case 'drone': {
      const hover = 16 + Math.sin(time * 4 + u.seed) * 1.5;
      box3d(ctx, project, wx, wy, f, 0.12, 0.12, hover, hover + 3, u.color, '#3a4048');
      for (const [dl, dw] of [
        [0.2, 0.2],
        [-0.2, 0.2],
        [0.2, -0.2],
        [-0.2, -0.2],
      ]) {
        const px = wx + c * dl - s * dw;
        const py = wy + s * dl + c * dw;
        const [ax, ay] = project(wx, wy, hover + 2);
        const [bx, by] = project(px, py, hover + 2);
        line(ctx, ax, ay, bx, by, '#3a4048', 1.2 * scale);
        ellipse(ctx, bx, by - 1 * scale, 5 * scale, 2 * scale, 'rgba(200,215,225,0.55)');
      }
      const [lx, ly] = project(wx + c * 0.12, wy + s * 0.12, hover + 1);
      circle(ctx, lx, ly, 1.2 * scale, '#38d6f5');
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
  /** Walls: bitmask of connected neighbours (LINK_N | LINK_E | LINK_S | LINK_W). */
  links?: number;
  /** Gates: drawn open while friendly units pass. */
  open?: boolean;
  /** Wonders: the countdown to a wonder victory is running. */
  counting?: boolean;
}

export const LINK_N = 1;
export const LINK_E = 2;
export const LINK_S = 4;
export const LINK_W = 8;

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
  wall: { inset: 0, wall: 20 },
  gate: { inset: 0, wall: 20 },
  smithy: { inset: 0.3, wall: 30 },
  academy: { inset: 0.25, wall: 42 },
  temple: { inset: 0.3, wall: 40 },
  wonder: { inset: 0.35, wall: 70 },
  dock: { inset: 0.15, wall: 18 },
};

interface WallLook {
  h: number;
  /** Half thickness in tiles. */
  thick: number;
  body: string;
  top: string;
}

/** Palisade → mud brick → stone → bastion → concrete → energy barrier. */
const WALL_LOOK: Record<EraStyle, WallLook> = {
  stone: { h: 17, thick: 0.1, body: '#7a5634', top: '#a07a4c' },
  ancient: { h: 19, thick: 0.2, body: '#c4a26c', top: '#dcc092' },
  medieval: { h: 26, thick: 0.22, body: '#9c978a', top: '#c2bdb0' },
  imperial: { h: 23, thick: 0.3, body: '#aea691', top: '#d2cab5' },
  modern: { h: 19, thick: 0.2, body: '#8c9196', top: '#b0b5b9' },
  future: { h: 21, thick: 0.07, body: '#4e626e', top: '#38d6f5' },
};

const LINK_DIRS: Array<[number, number, number]> = [
  [LINK_N, 0, -1],
  [LINK_W, -1, 0],
  [LINK_E, 1, 0],
  [LINK_S, 0, 1],
];

/** One wall arm from the tile center towards a neighbour (dx, dy). */
function wallArm(ctx: Ctx, project: Project, cx: number, cy: number, dx: number, dy: number, style: EraStyle, h: number, scale: number, time: number): void {
  const L = WALL_LOOK[style];
  const facing = dx !== 0 ? 0 : Math.PI / 2;
  const mx = cx + dx * 0.25;
  const my = cy + dy * 0.25;
  switch (style) {
    case 'stone': {
      // Sharpened stakes.
      for (let t = 0.08; t <= 0.5; t += 0.105) {
        const px = cx + dx * t;
        const py = cy + dy * t;
        const [ax, ay] = project(px, py, 0);
        const [bx, by] = project(px, py, h);
        line(ctx, ax, ay, bx, by, L.body, 3.4 * scale);
        poly(ctx, [[bx - 1.7 * scale, by], [bx + 1.7 * scale, by], [bx, by - 4 * scale]], L.top);
      }
      break;
    }
    case 'future': {
      const [ax, ay] = project(cx, cy, 2);
      const [bx, by] = project(cx + dx * 0.5, cy + dy * 0.5, 2);
      const [cx2, cy2] = project(cx + dx * 0.5, cy + dy * 0.5, h);
      const [dx2, dy2] = project(cx, cy, h);
      const glow = 0.3 + 0.12 * Math.sin(time * 3 + cx + cy);
      poly(ctx, [[ax, ay], [bx, by], [cx2, cy2], [dx2, dy2]], `rgba(56,214,245,${glow})`);
      line(ctx, dx2, dy2, cx2, cy2, '#bff4ff', 1.2 * scale);
      break;
    }
    default: {
      box3d(ctx, project, mx, my, facing, 0.25 + L.thick * 0.5, L.thick, 0, h, L.top, L.body);
      if (style === 'imperial') {
        // Sloped glacis at the foot of the bastion wall.
        box3d(ctx, project, mx, my, facing, 0.25 + L.thick * 0.5, L.thick * 1.45, 0, h * 0.35, shade(L.body, -0.05), L.body);
      }
      if (style === 'medieval') {
        // Merlons.
        for (const t of [0.12, 0.38]) {
          box3d(ctx, project, cx + dx * t, cy + dy * t, facing, 0.06, L.thick, h, h + 5, L.top, L.body);
        }
      }
      if (style === 'modern') {
        // Barbed wire on top.
        const pts: Pt[] = [];
        for (let i = 0; i <= 6; i++) {
          const t = i / 12;
          pts.push(project(cx + dx * t, cy + dy * t, h + 2 + (i % 2) * 3));
        }
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (const [x, y] of pts.slice(1)) ctx.lineTo(x, y);
        ctx.strokeStyle = '#3a3f44';
        ctx.lineWidth = 0.9 * scale;
        ctx.stroke();
      }
    }
  }
}

/** Wall segment or gate: arms towards connected neighbours around a post in player colour. */
function drawWall(ctx: Ctx, project: Project, scale: number, b: BuildingLook, time: number): void {
  const style = epochStyle(b.epoch);
  const L = WALL_LOOK[style];
  const cx = b.tx + 0.5;
  const cy = b.ty + 0.5;
  poly(ctx, [project(b.tx + 0.08, b.ty + 0.08), project(b.tx + 0.92, b.ty + 0.08), project(b.tx + 0.92, b.ty + 0.92), project(b.tx + 0.08, b.ty + 0.92)], 'rgba(60,45,25,0.18)');
  const links = b.links ?? 0;
  if (!b.built && b.progress < 0.08) {
    poly(ctx, [project(b.tx + 0.2, b.ty + 0.2), project(b.tx + 0.8, b.ty + 0.2), project(b.tx + 0.8, b.ty + 0.8), project(b.tx + 0.2, b.ty + 0.8)], 'rgba(120,100,70,0.6)', '#e9d9a6', 1);
    return;
  }
  const h = b.built ? L.h : L.h * Math.min(1, b.progress * 1.2);
  if (!b.built) ctx.globalAlpha = 0.85;

  if (b.type === 'gate') {
    drawGate(ctx, project, scale, b, style, h, links, time);
  } else {
    // Arms behind the post first, then the post, then the arms in front.
    for (const [bit, dx, dy] of LINK_DIRS.slice(0, 2)) if (links & bit) wallArm(ctx, project, cx, cy, dx, dy, style, h, scale, time);
    const post = style === 'future' ? 0.09 : L.thick + 0.05;
    box3d(ctx, project, cx, cy, 0, post, post, 0, h + 3, b.color, style === 'future' ? '#5d707c' : L.body);
    for (const [bit, dx, dy] of LINK_DIRS.slice(2)) if (links & bit) wallArm(ctx, project, cx, cy, dx, dy, style, h, scale, time);
  }
  ctx.globalAlpha = 1;
}

function drawGate(ctx: Ctx, project: Project, scale: number, b: BuildingLook, style: EraStyle, h: number, links: number, time: number): void {
  const L = WALL_LOOK[style];
  // The gate runs along the wall: east-west unless only north/south neighbours exist.
  const alongX = (links & (LINK_E | LINK_W)) !== 0 || (links & (LINK_N | LINK_S)) === 0;
  const cx = b.tx + 0.5;
  const cy = b.ty + 0.5;
  const ax = alongX ? 1 : 0;
  const ay = alongX ? 0 : 1;
  const facing = alongX ? 0 : Math.PI / 2;
  const tall = h + 9;
  const post = Math.max(0.12, L.thick + 0.06);
  const pillar = (t: number) =>
    box3d(ctx, project, cx + ax * t, cy + ay * t, 0, post, post, 0, tall, b.color, style === 'future' ? '#5d707c' : L.body);
  pillar(-0.38);
  if (b.built && !b.open) {
    if (style === 'future') {
      const p0 = project(cx - ax * 0.32, cy - ay * 0.32, 2);
      const p1 = project(cx + ax * 0.32, cy + ay * 0.32, 2);
      const p2 = project(cx + ax * 0.32, cy + ay * 0.32, h);
      const p3 = project(cx - ax * 0.32, cy - ay * 0.32, h);
      poly(ctx, [p0, p1, p2, p3], `rgba(255,190,60,${0.35 + 0.1 * Math.sin(time * 4)})`);
    } else {
      const door = style === 'modern' ? '#c9b23a' : style === 'imperial' ? '#3f3a33' : '#6b4a2b';
      box3d(ctx, project, cx, cy, facing, 0.3, 0.05, 0, h * 0.85, shade(door, 0.15), door);
    }
  } else if (b.built && style !== 'future') {
    // Swung-open leaves along the passage.
    const door = '#6b4a2b';
    box3d(ctx, project, cx - ax * 0.3 + ay * 0.18, cy - ay * 0.3 + ax * 0.18, facing + Math.PI / 2, 0.16, 0.04, 0, h * 0.8, shade(door, 0.15), door);
    box3d(ctx, project, cx + ax * 0.3 + ay * 0.18, cy + ay * 0.3 + ax * 0.18, facing + Math.PI / 2, 0.16, 0.04, 0, h * 0.8, shade(door, 0.15), door);
  }
  // Lintel joining the pillars (a barrier arm for modern gates).
  if (style === 'modern') {
    const [x0, y0] = project(cx - ax * 0.38, cy - ay * 0.38, h * 0.7);
    const angle = b.open ? 0.9 : 0;
    const [x1, y1] = project(cx + ax * (0.38 - angle * 0.25), cy + ay * (0.38 - angle * 0.25), h * 0.7 + angle * 18);
    line(ctx, x0, y0, x1, y1, '#d23b2f', 2.2 * scale);
  } else if (style !== 'future' && style !== 'stone') {
    box3d(ctx, project, cx, cy, facing, 0.38 + post, post * 0.8, h, h + 5, L.top, L.body);
  }
  pillar(0.38);
}

type RoofKind = 'pyramid' | 'gable' | 'temple' | 'dome' | 'flat' | 'glass';

function roofOf(style: EraStyle, type: BuildingType, size: number): { kind: RoofKind; h: number } {
  switch (style) {
    case 'stone':
      return { kind: 'pyramid', h: size * (type === 'tower' ? 16 : 20) };
    case 'ancient':
      return type === 'towncenter' || type === 'barracks' || type === 'temple' ? { kind: 'temple', h: size * 9 } : { kind: 'pyramid', h: size * 11 };
    case 'medieval':
      return type === 'tower' ? { kind: 'pyramid', h: size * 26 } : { kind: 'gable', h: size * 15 };
    case 'imperial':
      if (type === 'towncenter' || type === 'temple') return { kind: 'dome', h: size * 5 };
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
  if (type === 'wall' || type === 'gate') return WALL_LOOK[style].h + (type === 'gate' ? 16 : 8);
  if (type === 'wonder') return WONDER_TOP[style];
  const roof = roofOf(style, type, size);
  const spire = type === 'temple' ? TEMPLE_SPIRE[style] : 0;
  return wallHeight(type, style) + (roof.kind === 'dome' || roof.kind === 'glass' ? roof.h * 0.9 : roof.h) + 14 + spire;
}

/** How far a temple's tower or halo rises above its roof. */
const TEMPLE_SPIRE: Record<EraStyle, number> = { stone: 0, ancient: 0, medieval: 26, imperial: 0, modern: 26, future: 12 };

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
  if (b.type === 'wall' || b.type === 'gate') {
    drawWall(ctx, project, scale, b, time);
    return;
  }
  if (b.type === 'wonder') {
    drawWonder(ctx, project, scale, b, time);
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
  if (b.type === 'smithy') {
    // Forge chimney with smoke, glowing hearth and an anvil out front.
    box3d(ctx, project, x0 + 0.35, y0 + 0.35, 0, 0.18, 0.18, 0, h + roof.h + 10, '#5a4a3e', '#4a3c32');
    const [cx0, cy0] = project(x0 + 0.35, y0 + 0.35, h + roof.h + 10);
    for (let i = 0; i < 2; i++) {
      const puff = (time * 0.5 + i * 0.5 + b.seed * 0.1) % 1;
      circle(ctx, cx0 + puff * 8 * scale, cy0 - puff * 22 * scale, (3 + puff * 6) * scale, `rgba(90,90,90,${0.55 * (1 - puff)})`);
    }
    const glow = 0.6 + 0.3 * Math.sin(time * 5 + b.seed);
    poly(ctx, [project(cx - 0.25, y1, 0), project(cx + 0.25, y1, 0), project(cx + 0.25, y1, 9), project(cx - 0.25, y1, 9)], `rgba(255,140,40,${glow})`);
    box3d(ctx, project, x1 + 0.12, cy + 0.35, 0, 0.12, 0.07, 3, 6, '#3a3a3a', '#2a2a2a');
    box3d(ctx, project, x1 + 0.12, cy + 0.35, 0, 0.04, 0.04, 0, 3, '#3a3a3a', '#2a2a2a');
  }
  if (b.type === 'academy') {
    if (style === 'stone') {
      // Standing stones of the ancestors.
      for (const [dx, dy] of [
        [0.15, 0.15],
        [0.5, 0.05],
        [0.85, 0.15],
      ]) {
        box3d(ctx, project, x0 + (x1 - x0) * dx, y1 + 0.25 + dy, 0, 0.07, 0.09, 0, 16, '#a3a29b', '#8d8c85');
      }
    } else if (style === 'future') {
      const [ax, ay] = project(cx, cy, h + roof.h);
      line(ctx, ax, ay, ax, ay - 14 * scale, '#c3d0d8', 1.5 * scale);
      ellipse(ctx, ax + 2 * scale, ay - 16 * scale, 7 * scale, 3 * scale, '#e8f0f4');
    } else {
      // Observatory dome on the roof.
      dome(ctx, project, cx, cy, h + roof.h * 0.6, 7, scale, style === 'modern' ? '#9cc3dd' : '#6d8fb3');
    }
  }
  if (b.type === 'temple') {
    const roofTop = roof.kind === 'dome' ? h + 10 + roof.h * 3.4 : roof.kind === 'glass' ? h + 3 + roof.h * 2.6 : h + roof.h;
    switch (style) {
      case 'stone':
      case 'ancient':
        if (style === 'stone') {
          // Totem pole with rings in the player's colour and spread wings.
          const tx = x1 + 0.12;
          const ty = y1 - 0.45;
          box3d(ctx, project, tx, ty, 0, 0.11, 0.11, 0, 62, '#8a6a42', '#6b4a2b');
          for (const z of [18, 34, 50]) box3d(ctx, project, tx, ty, 0, 0.13, 0.13, z, z + 4, b.color, shade(b.color, -0.2));
          const [wx, wy] = project(tx, ty, 58);
          poly(ctx, [[wx, wy], [wx - 11 * scale, wy - 6 * scale], [wx - 3 * scale, wy + 1 * scale]], '#c8322a');
          poly(ctx, [[wx, wy], [wx + 11 * scale, wy - 6 * scale], [wx + 3 * scale, wy + 1 * scale]], '#c8322a');
          circle(ctx, wx, wy - 4 * scale, 2.2 * scale, '#efe6cc');
        }
        // Fire bowls flanking the entrance.
        for (const t of [0.2, 0.8]) {
          const bx = x0 + (x1 - x0) * t;
          box3d(ctx, project, bx, y1 + 0.18, 0, 0.09, 0.09, 0, 7, '#8d8c85', '#6e6d67');
          const [fx, fy] = project(bx, y1 + 0.18, 8);
          const flick = Math.sin(time * 11 + b.seed + t * 7);
          circle(ctx, fx, fy - 2 * scale, (2.6 + flick * 0.5) * scale, 'rgba(255,150,40,0.85)');
          circle(ctx, fx, fy - 3.5 * scale, (1.4 + flick * 0.3) * scale, 'rgba(255,230,140,0.9)');
        }
        break;
      case 'medieval': {
        // Bell tower with a steep spire at the front corner.
        const tx = x1 - 0.32;
        const ty = y1 - 0.32;
        const towerTop = h + roof.h * 0.6;
        box3d(ctx, project, tx, ty, 0, 0.3, 0.3, 0, towerTop, shade(wall, 0.05), wall);
        const [wx, wy] = project(tx + 0.3, ty, towerTop - 9);
        ctx.fillStyle = '#2b2622';
        ctx.fillRect(wx - 1.4 * scale, wy - 4 * scale, 2.8 * scale, 6 * scale);
        roofPyramid(ctx, project, tx - 0.34, ty - 0.34, tx + 0.34, ty + 0.34, towerTop, 34, pal.roof);
        const [sx, sy] = project(tx, ty, towerTop + 34);
        line(ctx, sx, sy, sx, sy - 7 * scale, '#c9a24a', 1.2 * scale);
        line(ctx, sx - 2.4 * scale, sy - 4.6 * scale, sx + 2.4 * scale, sy - 4.6 * scale, '#c9a24a', 1.2 * scale);
        break;
      }
      case 'imperial': {
        // A lantern with a cross on the dome.
        const [lx, ly] = project(cx, cy, roofTop);
        ctx.fillStyle = pal.trim;
        ctx.fillRect(lx - 2.5 * scale, ly - 6 * scale, 5 * scale, 6 * scale);
        line(ctx, lx, ly - 6 * scale, lx, ly - 13 * scale, '#d8b04a', 1.2 * scale);
        line(ctx, lx - 2.4 * scale, ly - 10.5 * scale, lx + 2.4 * scale, ly - 10.5 * scale, '#d8b04a', 1.2 * scale);
        break;
      }
      case 'modern': {
        // Slim concrete bell tower.
        const tx = x1 + 0.05;
        const ty = y1 - 0.4;
        const towerTop = h + roof.h + 30;
        box3d(ctx, project, tx, ty, 0, 0.14, 0.14, 0, towerTop, '#c5c9cc', '#a3a8ad');
        const [sx, sy] = project(tx, ty, towerTop);
        line(ctx, sx, sy, sx, sy - 9 * scale, '#e8e8e8', 1.4 * scale);
        line(ctx, sx - 3 * scale, sy - 6 * scale, sx + 3 * scale, sy - 6 * scale, '#e8e8e8', 1.4 * scale);
        break;
      }
      case 'future': {
        // A halo of light hovering over the glass dome.
        const [hx, hy] = project(cx, cy, roofTop + 10 + Math.sin(time * 1.5 + b.seed) * 2);
        ctx.beginPath();
        ctx.ellipse(hx, hy, 14 * scale, 5 * scale, 0, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(56,214,245,${0.55 + 0.25 * Math.sin(time * 3)})`;
        ctx.lineWidth = 2.2 * scale;
        ctx.stroke();
        break;
      }
    }
  }
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

/** Highest point of each era's wonder (unzoomed pixels), for bars and picking. */
const WONDER_TOP: Record<EraStyle, number> = { stone: 58, ancient: 100, medieval: 178, imperial: 112, modern: 236, future: 150 };

/**
 * The six wonders. Each keeps the era it was founded in. While being built it
 * rises out of the ground inside a scaffold.
 */
function drawWonder(ctx: Ctx, project: Project, scale: number, b: BuildingLook, time: number): void {
  const style = epochStyle(b.epoch);
  const x0 = b.tx + 0.35;
  const y0 = b.ty + 0.35;
  const x1 = b.tx + b.size - 0.35;
  const y1 = b.ty + b.size - 0.35;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  poly(
    ctx,
    [project(b.tx + 0.1, b.ty + 0.1), project(b.tx + b.size - 0.1, b.ty + 0.1), project(b.tx + b.size - 0.1, b.ty + b.size - 0.1), project(b.tx + 0.1, b.ty + b.size - 0.1)],
    style === 'modern' || style === 'future' ? 'rgba(150,150,150,0.35)' : 'rgba(60,45,25,0.22)',
  );
  if (!b.built && b.progress < 0.05) {
    poly(ctx, [project(x0, y0), project(x1, y0), project(x1, y1), project(x0, y1)], 'rgba(120,100,70,0.6)', '#e9d9a6', 1);
    return;
  }
  // Rising out of the ground while under construction.
  const grow = b.built ? 1 : Math.min(1, 0.08 + b.progress * 0.95);
  const P: Project = (x, y, z = 0) => project(x, y, z * grow);
  const top = WONDER_TOP[style];
  if (b.counting) {
    // The wonder victory is running: a golden glow pulses around it.
    const pulse = 0.5 + 0.5 * Math.sin(time * 2.5);
    const [gx, gy] = project(cx, cy);
    ctx.beginPath();
    ctx.ellipse(gx, gy, (90 + pulse * 14) * scale, (45 + pulse * 7) * scale, 0, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(242,200,75,${0.1 + 0.08 * pulse})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(242,200,75,${0.45 + 0.3 * pulse})`;
    ctx.lineWidth = 2 * scale;
    ctx.stroke();
  }
  if (!b.built) ctx.globalAlpha = 0.9;
  switch (style) {
    case 'stone':
      stoneCircle(ctx, P, scale, cx, cy, b, time);
      break;
    case 'ancient':
      library(ctx, P, scale, x0, y0, x1, y1, b);
      break;
    case 'medieval':
      cathedral(ctx, P, scale, x0, y0, x1, y1, b, time);
      break;
    case 'imperial':
      palace(ctx, P, scale, x0, y0, x1, y1, b, time);
      break;
    case 'modern':
      broadcastTower(ctx, P, scale, cx, cy, b, time);
      break;
    case 'future':
      spaceElevator(ctx, P, scale, cx, cy, b, time);
      break;
  }
  ctx.globalAlpha = 1;
  if (!b.built) {
    // Scaffolding around the rising walls.
    const h = top * grow * 0.85 + 6;
    const wood = style === 'modern' || style === 'future' ? '#8c9196' : '#b08a50';
    const posts: Array<[number, number]> = [
      [x0 - 0.1, y1 + 0.1],
      [cx, y1 + 0.1],
      [x1 + 0.1, y1 + 0.1],
      [x1 + 0.1, cy],
      [x1 + 0.1, y0 - 0.1],
    ];
    for (const [px, py] of posts) {
      const [ax, ay] = project(px, py, 0);
      const [bx, by] = project(px, py, h);
      line(ctx, ax, ay, bx, by, wood, 1.6 * scale);
    }
    for (let z = 14; z < h; z += 16) {
      for (let i = 0; i + 1 < posts.length; i++) {
        const [ax, ay] = project(posts[i][0], posts[i][1], z);
        const [bx, by] = project(posts[i + 1][0], posts[i + 1][1], z);
        line(ctx, ax, ay, bx, by, wood, 1.1 * scale);
      }
    }
    return;
  }
  const [fx, fy] = project(cx, cy, top * 0.4);
  if (b.hpRatio < 0.5) {
    const n = b.hpRatio < 0.25 ? 4 : 2;
    for (let i = 0; i < n; i++) {
      const t = (time * 0.7 + i * 0.29 + b.seed * 0.13) % 1;
      const px = fx + (i - n / 2) * 18 * scale;
      circle(ctx, px, fy - t * 30 * scale, (5 + t * 8) * scale, `rgba(60,60,60,${0.55 * (1 - t)})`);
      circle(ctx, px, fy, 4 * scale, `rgba(255,${120 + Math.floor(t * 80)},40,0.85)`);
    }
  }
}

/** Steinkreis: a ring of trilithons around an altar stone. */
function stoneCircle(ctx: Ctx, P: Project, scale: number, cx: number, cy: number, b: BuildingLook, time: number): void {
  const items: Array<{ depth: number; draw: () => void }> = [];
  const top = '#bdbcb4';
  const side = '#8d8c85';
  const R = 1.75;
  for (let k = 0; k < 6; k++) {
    const base = (k * Math.PI) / 3 + 0.26;
    const pts = [base - 0.11, base + 0.11].map((a) => [cx + Math.cos(a) * R, cy + Math.sin(a) * R, a] as const);
    for (const [x, y, a] of pts) {
      items.push({ depth: x + y, draw: () => box3d(ctx, P, x, y, a + Math.PI / 2, 0.13, 0.12, 0, 34, top, side) });
    }
    const mx = cx + Math.cos(base) * R;
    const my = cy + Math.sin(base) * R;
    items.push({ depth: mx + my + 0.01, draw: () => box3d(ctx, P, mx, my, base + Math.PI / 2, 0.36, 0.13, 34, 40, top, side) });
  }
  // Inner ring of smaller blue stones.
  for (let i = 0; i < 9; i++) {
    const a = (i * Math.PI * 2) / 9;
    const x = cx + Math.cos(a) * 1.05;
    const y = cy + Math.sin(a) * 1.05;
    items.push({ depth: x + y, draw: () => box3d(ctx, P, x, y, a, 0.08, 0.08, 0, 15, '#9aa3ab', '#7d868e') });
  }
  items.push({
    depth: cx + cy,
    draw: () => {
      box3d(ctx, P, cx, cy, 0.3, 0.38, 0.2, 0, 6, '#c9c8c0', side);
      // Offering cloth in the player's colour and a small fire.
      const [ax, ay] = P(cx, cy, 6);
      ctx.fillStyle = b.color;
      ctx.fillRect(ax - 5 * scale, ay - 1.5 * scale, 10 * scale, 3 * scale);
      const flick = Math.sin(time * 10 + b.seed);
      circle(ctx, ax, ay - 4 * scale, (3 + flick * 0.6) * scale, 'rgba(255,150,40,0.85)');
      circle(ctx, ax, ay - 6 * scale, (1.6 + flick * 0.3) * scale, 'rgba(255,230,140,0.9)');
    },
  });
  items.sort((p, q) => p.depth - q.depth);
  for (const it of items) it.draw();
}

/** Große Bibliothek: a stepped podium, columned hall and pediment. */
function library(ctx: Ctx, P: Project, scale: number, x0: number, y0: number, x1: number, y1: number, b: BuildingLook): void {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const hw = (x1 - x0) / 2;
  const stone = '#dccaa0';
  box3d(ctx, P, cx, cy, 0, hw, hw, 0, 4, '#e6d6b0', stone);
  box3d(ctx, P, cx, cy, 0, hw - 0.2, hw - 0.2, 4, 8, '#e6d6b0', stone);
  box3d(ctx, P, cx, cy, 0, hw - 0.4, hw - 0.4, 8, 12, '#e6d6b0', stone);
  const inner = hw - 0.85;
  box3d(ctx, P, cx, cy, 0, inner, inner, 12, 56, '#efe3c2', '#cdb98c');
  // Doorway with scrolls.
  poly(ctx, [P(cx - 0.3, cy + inner, 12), P(cx + 0.3, cy + inner, 12), P(cx + 0.3, cy + inner, 38), P(cx - 0.3, cy + inner, 38)], '#3a2a1c');
  const outer = hw - 0.5;
  for (let t = 0; t <= 1.0001; t += 1 / 7) {
    for (const [px, py] of [
      [cx - outer + 2 * outer * t, cy + outer],
      [cx + outer, cy + outer - 2 * outer * t],
    ]) {
      const [ax, ay] = P(px, py, 12);
      const [bx, by] = P(px, py, 56);
      line(ctx, ax, ay, bx, by, '#f8f0dc', 3.2 * scale);
      line(ctx, ax + 1.2 * scale, ay, bx + 1.2 * scale, by, '#d9ccad', 0.8 * scale);
    }
  }
  box3d(ctx, P, cx, cy, 0, outer + 0.12, outer + 0.12, 56, 63, '#efe3c2', '#cdb98c');
  // Frieze in the player's colour.
  poly(ctx, [P(cx - outer - 0.12, cy + outer + 0.12, 58), P(cx + outer + 0.12, cy + outer + 0.12, 58), P(cx + outer + 0.12, cy + outer + 0.12, 61), P(cx - outer - 0.12, cy + outer + 0.12, 61)], b.color);
  roofGable(ctx, P, cx - outer - 0.2, cy - outer - 0.2, cx + outer + 0.2, cy + outer + 0.2, 63, 26, '#b4532d');
  // Gilded disc on the pediment.
  const [dx, dy] = P(cx + outer + 0.2, cy, 70);
  circle(ctx, dx, dy, 4 * scale, '#f2c84b', '#b48a45', 0.8 * scale);
}

/** Kathedrale: nave with buttresses, two front towers with spires, a rose window. */
function cathedral(ctx: Ctx, P: Project, scale: number, x0: number, y0: number, x1: number, y1: number, b: BuildingLook, time: number): void {
  const cy = (y0 + y1) / 2;
  const wall = '#e2d9c2';
  const slate = '#56606c';
  const nx0 = x0 + 0.1;
  const nx1 = x1 - 0.9;
  const nw = 0.95;
  box3d(ctx, P, (nx0 + nx1) / 2, cy, 0, (nx1 - nx0) / 2, nw, 0, 62, shade(wall, 0.05), wall);
  // Tall pointed windows and flying buttresses on the south side.
  for (let t = 0.12; t < 0.95; t += 0.19) {
    const x = nx0 + (nx1 - nx0) * t;
    poly(ctx, [P(x - 0.1, cy + nw, 18), P(x + 0.1, cy + nw, 18), P(x + 0.1, cy + nw, 46), P(x, cy + nw, 52), P(x - 0.1, cy + nw, 46)], '#3e5a8a');
    const [ax, ay] = P(x + 0.18, cy + nw + 0.55, 0);
    const [bx, by] = P(x + 0.18, cy + nw + 0.55, 34);
    const [tx, ty] = P(x + 0.18, cy + nw, 56);
    line(ctx, ax, ay, bx, by, shade(wall, -0.15), 3 * scale);
    line(ctx, bx, by, tx, ty, shade(wall, -0.15), 1.8 * scale);
  }
  roofGable(ctx, P, nx0 - 0.05, cy - nw - 0.08, nx1, cy + nw + 0.08, 62, 34, slate);
  // Facade between the towers, with the rose window.
  const fx = x1 - 0.55;
  box3d(ctx, P, fx, cy, 0, 0.42, nw * 0.62, 0, 84, shade(wall, 0.08), wall);
  const [rx, ry] = P(fx + 0.42, cy, 58);
  circle(ctx, rx, ry, 7 * scale, '#3e5a8a', '#c9a24a', 1.2 * scale);
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3 + time * 0.1;
    line(ctx, rx, ry, rx + Math.cos(a) * 6 * scale, ry + Math.sin(a) * 6 * scale, '#c9a24a', 0.7 * scale);
  }
  const [dx, dy] = P(fx + 0.42, cy, 0);
  poly(ctx, [[dx - 4 * scale, dy], [dx + 4 * scale, dy - 2 * scale], [dx + 4 * scale, dy - 24 * scale], [dx, dy - 30 * scale], [dx - 4 * scale, dy - 22 * scale]], '#3a2a1c');
  for (const ty of [cy - nw + 0.3, cy + nw - 0.3]) {
    box3d(ctx, P, fx, ty, 0, 0.42, 0.34, 0, 116, shade(wall, 0.08), wall);
    const [wx, wy] = P(fx + 0.42, ty, 96);
    ctx.fillStyle = '#2b2622';
    ctx.fillRect(wx - 1.5 * scale, wy - 6 * scale, 3 * scale, 9 * scale);
    roofPyramid(ctx, P, fx - 0.46, ty - 0.38, fx + 0.46, ty + 0.38, 116, 50, slate);
    const [sx, sy] = P(fx, ty, 166);
    line(ctx, sx, sy, sx, sy - 9 * scale, '#c9a24a', 1.3 * scale);
    line(ctx, sx - 3 * scale, sy - 6 * scale, sx + 3 * scale, sy - 6 * scale, '#c9a24a', 1.3 * scale);
  }
  const [bx, by] = P(nx0 + 0.4, cy, 96);
  flag(ctx, bx, by, scale * 1.6, b.color, time, b.seed);
}

/** Kaiserpalast: a long colonnaded block, corner pavilions and a gilded dome. */
function palace(ctx: Ctx, P: Project, scale: number, x0: number, y0: number, x1: number, y1: number, b: BuildingLook, time: number): void {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const hw = (x1 - x0) / 2;
  const wall = '#e8dcc4';
  box3d(ctx, P, cx, cy, 0, hw, hw - 0.3, 0, 36, shade(wall, 0.05), wall);
  windows(ctx, P, x0, y0 + 0.3, x1, y1 - 0.3, 4, 32, '#3b3f46', scale);
  // Balustrade and a band in the player's colour.
  box3d(ctx, P, cx, cy, 0, hw + 0.04, hw - 0.26, 36, 40, '#f4efe2', '#d9d0bb');
  poly(ctx, [P(x0, y1 - 0.3, 30), P(x1, y1 - 0.3, 30), P(x1, y1 - 0.3, 33), P(x0, y1 - 0.3, 33)], b.color);
  // Central portico with columns.
  for (let t = -0.6; t <= 0.61; t += 0.3) {
    const [ax, ay] = P(cx + t, y1 - 0.1, 0);
    const [bx, by] = P(cx + t, y1 - 0.1, 34);
    line(ctx, ax, ay, bx, by, '#f8f0dc', 3 * scale);
  }
  roofGable(ctx, P, cx - 0.75, y1 - 0.5, cx + 0.75, y1 - 0.05, 36, 10, '#efe9dc');
  // Drum and dome.
  box3d(ctx, P, cx, cy - 0.1, Math.PI / 4, 0.8, 0.8, 40, 58, '#efe9dc', '#cfc7b8');
  dome(ctx, P, cx, cy - 0.1, 58, 30, scale, '#d8b04a');
  const [lx, ly] = P(cx, cy - 0.1, 58);
  const domeTop = ly - 27 * scale;
  ctx.fillStyle = '#efe9dc';
  ctx.fillRect(lx - 3 * scale, domeTop - 8 * scale, 6 * scale, 8 * scale);
  flag(ctx, lx, domeTop - 8 * scale, scale * 1.4, b.color, time, b.seed);
  // Corner pavilions.
  for (const [px, py] of [
    [x0 + 0.35, y1 - 0.65],
    [x1 - 0.35, y0 + 0.65],
  ]) {
    box3d(ctx, P, px, py, 0, 0.38, 0.38, 0, 48, shade(wall, 0.08), wall);
    roofPyramid(ctx, P, px - 0.42, py - 0.42, px + 0.42, py + 0.42, 48, 14, '#4b5b6b');
  }
}

/** Sendeturm: a tapering lattice mast with a platform, dishes and a blinking light. */
function broadcastTower(ctx: Ctx, P: Project, scale: number, cx: number, cy: number, b: BuildingLook, time: number): void {
  const base = 1.55;
  const narrow = 0.16;
  const H = 190;
  box3d(ctx, P, cx + 0.6, cy + 0.6, 0, 0.75, 0.55, 0, 18, '#b0b5b9', '#8c9196');
  const legs: Array<[number, number]> = [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ];
  const at = (sx: number, sy: number, z: number): [number, number] => {
    const k = z / H;
    const r = base + (narrow - base) * k;
    return P(cx + sx * r, cy + sy * r, z);
  };
  const red = '#d2452f';
  const white = '#eeeeee';
  // Back legs first, then the bracing, then the front legs.
  const order = [0, 1, 2, 3].sort((i, j) => legs[i][0] + legs[i][1] - (legs[j][0] + legs[j][1]));
  const drawLeg = (i: number) => {
    const [sx, sy] = legs[i];
    for (let z = 0; z < H; z += 30) {
      const [ax, ay] = at(sx, sy, z);
      const [bx, by] = at(sx, sy, Math.min(H, z + 30));
      line(ctx, ax, ay, bx, by, (z / 30) % 2 === 0 ? red : white, 2.4 * scale);
    }
  };
  drawLeg(order[0]);
  for (let z = 0; z < H; z += 24) {
    for (const [p, q] of [
      [0, 1],
      [1, 3],
      [3, 2],
      [2, 0],
    ]) {
      const [ax, ay] = at(legs[p][0], legs[p][1], z);
      const [bx, by] = at(legs[q][0], legs[q][1], z + 24);
      line(ctx, ax, ay, bx, by, 'rgba(120,40,30,0.7)', 0.8 * scale);
    }
  }
  for (const i of order.slice(1)) drawLeg(i);
  // Platform with the player's colour band and two dishes.
  box3d(ctx, P, cx, cy, Math.PI / 4, 0.55, 0.55, 128, 136, '#d9dde0', '#a3a8ad');
  poly(ctx, [P(cx, cy + 0.78, 129), P(cx + 0.78, cy, 129), P(cx + 0.78, cy, 133), P(cx, cy + 0.78, 133)], b.color);
  for (const [dx, dy] of [
    [0.55, 0.15],
    [0.1, 0.55],
  ]) {
    const [ex, ey] = P(cx + dx, cy + dy, 146);
    ctx.beginPath();
    ctx.ellipse(ex, ey, 4 * scale, 6 * scale, -0.4, 0, Math.PI * 2);
    ctx.fillStyle = '#f2f4f5';
    ctx.fill();
    ctx.strokeStyle = '#8c9196';
    ctx.lineWidth = 0.8 * scale;
    ctx.stroke();
  }
  const [ax, ay] = P(cx, cy, H);
  const [tx, ty] = P(cx, cy, H + 42);
  line(ctx, ax, ay, tx, ty, '#5a626b', 1.6 * scale);
  const blink = Math.sin(time * 4 + b.seed) > 0.2;
  circle(ctx, tx, ty, (blink ? 3.2 : 1.8) * scale, blink ? '#ff3b30' : '#7a1d18');
  if (blink) circle(ctx, tx, ty, 7 * scale, 'rgba(255,59,48,0.25)');
}

/** Weltraumlift: base station, a cable into the sky, a ring and a climber going up and down. */
function spaceElevator(ctx: Ctx, P: Project, scale: number, cx: number, cy: number, b: BuildingLook, time: number): void {
  const ring = (z: number, r: number, color: string, w: number) => {
    const [x, y] = P(cx, cy, z);
    ctx.beginPath();
    ctx.ellipse(x, y, r * 32 * scale, r * 16 * scale, 0, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = w * scale;
    ctx.stroke();
  };
  const hw = 1.75;
  box3d(ctx, P, cx, cy, 0, hw, hw, 0, 12, '#f4fbff', '#c3d0d8');
  // Band in the player's colour on the visible faces.
  poly(ctx, [P(cx - hw, cy + hw, 7), P(cx + hw, cy + hw, 7), P(cx + hw, cy + hw, 10), P(cx - hw, cy + hw, 10)], b.color);
  poly(ctx, [P(cx + hw, cy + hw, 7), P(cx + hw, cy - hw, 7), P(cx + hw, cy - hw, 10), P(cx + hw, cy + hw, 10)], shade(b.color, -0.25));
  box3d(ctx, P, cx, cy, Math.PI / 4, 0.85, 0.85, 12, 34, '#e8f0f4', '#c3d0d8');
  const glow = 0.6 + 0.3 * Math.sin(time * 3 + b.seed);
  ring(34, 0.55, `rgba(56,214,245,${glow})`, 2);
  const [bx, by] = P(cx, cy, 30);
  const [tx, ty] = P(cx, cy, 2000);
  const grad = ctx.createLinearGradient(bx, by, tx, ty);
  grad.addColorStop(0, 'rgba(195,208,216,1)');
  grad.addColorStop(0.25, 'rgba(195,208,216,0.6)');
  grad.addColorStop(1, 'rgba(195,208,216,0)');
  ctx.beginPath();
  ctx.moveTo(bx, by);
  ctx.lineTo(tx, ty);
  ctx.strokeStyle = grad;
  ctx.lineWidth = 2.2 * scale;
  ctx.stroke();
  ring(110, 0.9, 'rgba(56,214,245,0.8)', 3);
  ring(110, 0.75, 'rgba(232,240,244,0.9)', 1.2);
  // The climber: up slowly, down a little faster.
  const cycle = (time * 0.08 + b.seed * 0.37) % 1;
  const z = 34 + (cycle < 0.6 ? cycle / 0.6 : 1 - (cycle - 0.6) / 0.4) * 220;
  const [kx, ky] = P(cx, cy, z);
  ctx.fillStyle = '#e8f0f4';
  ctx.fillRect(kx - 3.5 * scale, ky - 6 * scale, 7 * scale, 8 * scale);
  ctx.fillStyle = '#38d6f5';
  ctx.fillRect(kx - 3.5 * scale, ky - 3 * scale, 7 * scale, 1.6 * scale);
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
    case 'fish': {
      // A shoal under the surface: rings on the water, dark backs circling, now and then one jumps.
      const phase = time * 0.9 + n.variant * 1.7;
      ctx.lineWidth = Math.max(1, 0.8 * k);
      for (let i = 0; i < 2; i++) {
        const t = (phase * 0.5 + i * 0.5) % 1;
        ctx.strokeStyle = `rgba(220,240,255,${(0.55 * (1 - t)).toFixed(3)})`;
        ctx.beginPath();
        ctx.ellipse(x, y, (3 + t * 10) * k, (1.5 + t * 5) * k, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      const count = Math.max(1, Math.ceil(3 * n.ratio));
      for (let i = 0; i < count; i++) {
        const a = phase * 0.8 + (i * Math.PI * 2) / count;
        const fx = x + Math.cos(a) * 5 * k;
        const fy = y + Math.sin(a) * 2.5 * k;
        const dir = Math.cos(a + Math.PI / 2) >= 0 ? 1 : -1;
        poly(
          ctx,
          [
            [fx - 3 * k * dir, fy],
            [fx, fy - 1 * k],
            [fx + 2.5 * k * dir, fy],
            [fx + 4 * k * dir, fy - 1.2 * k],
            [fx + 4 * k * dir, fy + 1.2 * k],
            [fx + 2.5 * k * dir, fy],
            [fx, fy + 1 * k],
          ],
          'rgba(24,52,74,0.55)',
        );
      }
      // The jump: an arc every few seconds.
      const jump = (time * 0.35 + n.variant * 0.29) % 1;
      if (jump < 0.12) {
        const t = jump / 0.12;
        const jx = x + (t - 0.5) * 10 * k;
        const jy = y - 3 * k - Math.sin(t * Math.PI) * 9 * k;
        poly(ctx, [[jx - 3 * k, jy + 1 * k], [jx, jy - 1.3 * k], [jx + 3 * k, jy], [jx + 4.5 * k, jy - 1.5 * k], [jx + 4.5 * k, jy + 1.5 * k], [jx + 3 * k, jy + 0.6 * k], [jx, jy + 1.6 * k]], '#c9d7df', '#5d7a8c', 0.6);
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
