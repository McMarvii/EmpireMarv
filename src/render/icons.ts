import { BUILDING_DEFS, type BuildingType } from '../data/buildings';
import { epochNumeral, epochStyle, toRoman, type EraStyle } from '../data/epochs';
import type { Tech, TechGlyph } from '../data/techs';
import { bestTier, ROLE_DEFS, type Role } from '../data/units';
import { formationSlots, type Formation } from '../sim/formation';
import type { Project } from './camera';
import { ABILITY_COLOR, shade } from './colors';
import { drawBuilding, drawUnit, LINK_E, LINK_W, VEHICLE_LOOKS } from './sprites';

const cache = new Map<string, string>();

function render(key: string, size: number, paint: (ctx: CanvasRenderingContext2D) => void): string {
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = size * 2;
  canvas.height = size * 2;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(2, 2);
  paint(ctx);
  const url = canvas.toDataURL();
  cache.set(key, url);
  return url;
}

/** Portrait of a unit role at a given epoch, drawn with the in-game sprite code. */
export function unitIcon(role: Role, epoch: number, color: string, size = 44): string {
  const tier = Math.max(0, bestTier(role, epoch));
  const t = ROLE_DEFS[role].tiers[tier] ?? ROLE_DEFS[role].tiers[0];
  return render(`u:${role}:${tier}:${color}:${size}`, size, (ctx) => {
    const vehicle = VEHICLE_LOOKS.has(t.look);
    // Sized for a 44 px button; smaller and larger icons scale along so the figure always fits.
    const fit = size / 44;
    const scale = fit * (vehicle ? 0.9 : t.look === 'horse' || t.look === 'chariot' || t.look === 'scouthorse' ? 1.15 : 1.5);
    const cx = size / 2;
    const cy = size * (vehicle ? 0.68 : 0.88);
    const project: Project = (wx, wy, z = 0) => [cx + (wx - wy) * 32 * scale, cy + (wx + wy) * 16 * scale - z * scale];
    drawUnit(
      ctx,
      project,
      scale,
      0,
      0,
      { look: t.look, epoch: t.epoch, color, facing: Math.PI / 4 - 0.6, moving: false, attackAnim: 0, working: false, carry: null, seed: 1 },
      0.3,
    );
  });
}

export function buildingIcon(type: BuildingType, epoch: number, color: string, size = 44): string {
  return render(`b:${type}:${epoch}:${color}:${size}`, size, (ctx) => {
    const tiles = BUILDING_DEFS[type].size;
    const line = BUILDING_DEFS[type].line;
    const scale = (size / (tiles * 64)) * (line ? 0.78 : 0.95);
    const cx = size / 2;
    const cy = size * (type === 'farm' ? 0.2 : 0.42);
    const project: Project = (wx, wy, z = 0) => [cx + (wx - wy) * 32 * scale, cy + (wx + wy) * 16 * scale - z * scale];
    const links = line ? LINK_E | LINK_W : 0;
    drawBuilding(ctx, project, scale, { type, epoch, color, tx: 0, ty: 0, size: tiles, progress: 1, built: true, hpRatio: 1, seed: 3, links }, 0.5);
  });
}

interface EmblemLook {
  fill: string;
  ring: string;
  text: string;
}

/** Each style family gets its own emblem shape and colours. */
const EMBLEM: Record<EraStyle, EmblemLook> = {
  stone: { fill: '#7d5d3a', ring: '#4a3420', text: '#f3e3c3' },
  ancient: { fill: '#b4532d', ring: '#d8b45a', text: '#fff3d6' },
  medieval: { fill: '#2f4f7f', ring: '#c9ced4', text: '#f4f4f4' },
  imperial: { fill: '#7a1f2b', ring: '#e2c15a', text: '#fff4d0' },
  modern: { fill: '#4f553a', ring: '#a3a8ad', text: '#f0f0e0' },
  future: { fill: '#0f3a4a', ring: '#38d6f5', text: '#d8faff' },
};

function emblemPath(ctx: CanvasRenderingContext2D, style: EraStyle, c: number, r: number): void {
  ctx.beginPath();
  switch (style) {
    case 'stone': {
      // Rough hewn stone tablet.
      const jag = [1, 0.9, 0.97, 0.86, 1, 0.92, 0.95, 0.88];
      jag.forEach((k, i) => {
        const a = (i / jag.length) * Math.PI * 2 - Math.PI / 2;
        const x = c + Math.cos(a) * r * k;
        const y = c + Math.sin(a) * r * k;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      break;
    }
    case 'ancient':
      ctx.arc(c, c, r, 0, Math.PI * 2);
      break;
    case 'medieval':
      // Heater shield.
      ctx.moveTo(c - r * 0.85, c - r * 0.85);
      ctx.lineTo(c + r * 0.85, c - r * 0.85);
      ctx.quadraticCurveTo(c + r * 0.9, c + r * 0.35, c, c + r);
      ctx.quadraticCurveTo(c - r * 0.9, c + r * 0.35, c - r * 0.85, c - r * 0.85);
      break;
    case 'imperial': {
      // Sunburst medal.
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        const k = i % 2 === 0 ? 1 : 0.84;
        const x = c + Math.cos(a) * r * k;
        const y = c + Math.sin(a) * r * k;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      break;
    }
    case 'modern':
      ctx.roundRect(c - r * 0.92, c - r * 0.8, r * 1.84, r * 1.6, r * 0.28);
      break;
    case 'future':
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const x = c + Math.cos(a) * r;
        const y = c + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      break;
  }
  ctx.closePath();
}

/** Emblem of an epoch: style-family shape with the epoch's roman numeral. */
export function epochIcon(index: number, size = 32): string {
  return render(`e:${index}:${size}`, size, (ctx) => {
    const style = epochStyle(index);
    const look = EMBLEM[style];
    const c = size / 2;
    const r = size * 0.46;
    emblemPath(ctx, style, c, r);
    ctx.fillStyle = look.ring;
    ctx.fill();
    emblemPath(ctx, style, c, r * 0.84);
    ctx.fillStyle = look.fill;
    ctx.fill();
    if (style === 'future') {
      ctx.strokeStyle = 'rgba(56,214,245,0.6)';
      ctx.lineWidth = Math.max(1, size / 32);
      ctx.stroke();
    }
    const text = epochNumeral(index);
    const maxW = size * (style === 'medieval' ? 0.58 : 0.64);
    let font = size * 0.42;
    ctx.font = `700 ${font}px Georgia, 'Times New Roman', serif`;
    const w = ctx.measureText(text).width;
    if (w > maxW) {
      font *= maxW / w;
      ctx.font = `700 ${font}px Georgia, 'Times New Roman', serif`;
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const ty = c + (style === 'medieval' ? -size * 0.05 : size * 0.02);
    ctx.lineWidth = Math.max(1.5, size / 16);
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.strokeText(text, c, ty);
    ctx.fillStyle = look.text;
    ctx.fillText(text, c, ty);
  });
}

/** Simple white pictograms for tech branches, drawn around (c, c) with radius r. */
function glyph(ctx: CanvasRenderingContext2D, kind: TechGlyph, c: number, r: number): void {
  const L = (pts: Array<[number, number]>, close = false) => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(c + x * r, c + y * r) : ctx.moveTo(c + x * r, c + y * r)));
    if (close) ctx.closePath();
  };
  const stroke = () => ctx.stroke();
  const fill = () => ctx.fill();
  switch (kind) {
    case 'sword':
      L([[-0.7, 0.7], [0.6, -0.6]]);
      stroke();
      L([[-0.55, 0.15], [-0.15, 0.55]]);
      stroke();
      break;
    case 'bow':
      ctx.beginPath();
      ctx.arc(c - 0.3 * r, c, 0.75 * r, -1.2, 1.2);
      stroke();
      L([[-0.18, -0.7], [-0.18, 0.7]]);
      stroke();
      L([[-0.5, 0], [0.75, 0]]);
      stroke();
      L([[0.55, -0.15], [0.75, 0], [0.55, 0.15]]);
      stroke();
      break;
    case 'shield':
      L([[-0.6, -0.65], [0.6, -0.65], [0.55, 0.15], [0, 0.75], [-0.55, 0.15]], true);
      fill();
      break;
    case 'horse':
      L([[-0.5, 0.75], [-0.35, 0.05], [-0.1, -0.5], [0.15, -0.75], [0.25, -0.5], [0.7, -0.2], [0.6, 0.0], [0.15, -0.05], [0.05, 0.75]], true);
      fill();
      break;
    case 'horseshoe':
      ctx.beginPath();
      ctx.arc(c, c - 0.05 * r, 0.6 * r, Math.PI * 0.85, Math.PI * 2.15);
      ctx.lineWidth = r * 0.3;
      stroke();
      break;
    case 'hammer':
      L([[-0.55, 0.7], [0.25, -0.1]]);
      stroke();
      L([[-0.05, -0.65], [0.65, 0.05], [0.4, 0.3], [-0.3, -0.4]], true);
      fill();
      break;
    case 'wall':
      for (const [x, y] of [
        [-0.7, 0.1],
        [0.05, 0.1],
        [-0.35, -0.4],
        [-0.35, 0.6],
        [0.4, -0.4],
        [0.4, 0.6],
      ]) {
        ctx.fillRect(c + x * r, c + (y - 0.2) * r, 0.65 * r, 0.4 * r);
      }
      break;
    case 'angle':
      L([[-0.7, 0.6], [0.7, 0.6], [-0.7, -0.7]], true);
      stroke();
      ctx.beginPath();
      ctx.arc(c - 0.7 * r, c + 0.6 * r, 0.55 * r, -0.75, 0);
      stroke();
      break;
    case 'cross':
      ctx.fillRect(c - 0.22 * r, c - 0.7 * r, 0.44 * r, 1.4 * r);
      ctx.fillRect(c - 0.7 * r, c - 0.22 * r, 1.4 * r, 0.44 * r);
      break;
    case 'book':
      L([[0, -0.45], [-0.75, -0.6], [-0.75, 0.55], [0, 0.7], [0.75, 0.55], [0.75, -0.6]], true);
      stroke();
      L([[0, -0.45], [0, 0.7]]);
      stroke();
      break;
    case 'eye':
      ctx.beginPath();
      ctx.ellipse(c, c, 0.8 * r, 0.45 * r, 0, 0, Math.PI * 2);
      stroke();
      ctx.beginPath();
      ctx.arc(c, c, 0.25 * r, 0, Math.PI * 2);
      fill();
      break;
    case 'crown':
      L([[-0.7, 0.5], [-0.7, -0.4], [-0.35, 0.05], [0, -0.6], [0.35, 0.05], [0.7, -0.4], [0.7, 0.5]], true);
      fill();
      break;
    case 'pick':
      ctx.beginPath();
      ctx.arc(c, c + 0.5 * r, 0.9 * r, -2.4, -0.75);
      stroke();
      L([[0, -0.35], [0, 0.75]]);
      stroke();
      break;
    case 'basket':
      L([[-0.7, -0.15], [0.7, -0.15], [0.5, 0.65], [-0.5, 0.65]], true);
      fill();
      ctx.beginPath();
      ctx.arc(c, c - 0.15 * r, 0.5 * r, Math.PI, 0);
      stroke();
      break;
    case 'people':
      for (const x of [-0.4, 0.4]) {
        ctx.beginPath();
        ctx.arc(c + x * r, c - 0.35 * r, 0.22 * r, 0, Math.PI * 2);
        fill();
        ctx.beginPath();
        ctx.arc(c + x * r, c + 0.55 * r, 0.38 * r, Math.PI, 0);
        fill();
      }
      break;
    case 'helmet':
      ctx.beginPath();
      ctx.arc(c, c + 0.15 * r, 0.65 * r, Math.PI, 0);
      fill();
      ctx.fillRect(c - 0.8 * r, c + 0.1 * r, 1.6 * r, 0.22 * r);
      ctx.fillRect(c - 0.08 * r, c - 0.8 * r, 0.16 * r, 0.4 * r);
      break;
    case 'boot':
      L([[-0.35, -0.7], [0.15, -0.7], [0.15, 0.2], [0.7, 0.35], [0.7, 0.7], [-0.35, 0.7]], true);
      fill();
      break;
    case 'wheel':
      ctx.beginPath();
      ctx.arc(c, c, 0.68 * r, 0, Math.PI * 2);
      stroke();
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 4;
        L([[Math.cos(a) * 0.68, Math.sin(a) * 0.68], [-Math.cos(a) * 0.68, -Math.sin(a) * 0.68]]);
        stroke();
      }
      break;
    case 'cannon':
      ctx.beginPath();
      ctx.arc(c - 0.25 * r, c + 0.4 * r, 0.32 * r, 0, Math.PI * 2);
      fill();
      ctx.save();
      ctx.translate(c, c);
      ctx.rotate(-0.45);
      ctx.fillRect(-0.55 * r, -0.2 * r, 1.35 * r, 0.4 * r);
      ctx.restore();
      break;
    case 'crosshair':
      ctx.beginPath();
      ctx.arc(c, c, 0.5 * r, 0, Math.PI * 2);
      stroke();
      L([[-0.8, 0], [-0.25, 0]]);
      stroke();
      L([[0.25, 0], [0.8, 0]]);
      stroke();
      L([[0, -0.8], [0, -0.25]]);
      stroke();
      L([[0, 0.25], [0, 0.8]]);
      stroke();
      break;
    case 'tower':
      L([[-0.4, 0.75], [-0.3, -0.45], [0.3, -0.45], [0.4, 0.75]], true);
      fill();
      for (const x of [-0.42, -0.07, 0.28]) ctx.fillRect(c + x * r, c - 0.75 * r, 0.16 * r, 0.32 * r);
      break;
    case 'axe':
      L([[-0.55, 0.7], [0.35, -0.55]]);
      stroke();
      L([[0.05, -0.75], [0.7, -0.35], [0.45, 0.05], [0.15, -0.3]], true);
      fill();
      break;
    case 'ore':
      L([[-0.7, 0.55], [-0.45, -0.2], [0, -0.6], [0.5, -0.3], [0.7, 0.55]], true);
      fill();
      break;
    case 'anchor':
      ctx.beginPath();
      ctx.arc(c, c - 0.6 * r, 0.16 * r, 0, Math.PI * 2);
      stroke();
      L([[0, -0.44], [0, 0.75]]);
      stroke();
      L([[-0.35, -0.2], [0.35, -0.2]]);
      stroke();
      ctx.beginPath();
      ctx.arc(c, c + 0.15 * r, 0.6 * r, 0.25, Math.PI - 0.25);
      stroke();
      L([[-0.72, 0.15], [-0.58, 0.38], [-0.4, 0.22]]);
      stroke();
      L([[0.72, 0.15], [0.58, 0.38], [0.4, 0.22]]);
      stroke();
      break;
    case 'fish':
      ctx.beginPath();
      ctx.ellipse(c - 0.1 * r, c, 0.55 * r, 0.3 * r, 0, 0, Math.PI * 2);
      fill();
      L([[0.4, 0], [0.8, -0.35], [0.8, 0.35]], true);
      fill();
      break;
    case 'wheat':
      L([[0, 0.8], [0, -0.7]]);
      stroke();
      for (const y of [-0.5, -0.15, 0.2]) {
        ctx.beginPath();
        ctx.ellipse(c - 0.2 * r, c + y * r, 0.2 * r, 0.1 * r, -0.6, 0, Math.PI * 2);
        ctx.ellipse(c + 0.2 * r, c + y * r, 0.2 * r, 0.1 * r, 0.6, 0, Math.PI * 2);
        fill();
      }
      break;
  }
}

/** Icon of one tech level: era-coloured tile, branch pictogram, level numeral. */
export function techIcon(tech: Tech, size = 44): string {
  return render(`t:${tech.id}:${size}`, size, (ctx) => {
    const look = EMBLEM[epochStyle(tech.epoch)];
    const pad = size * 0.06;
    ctx.beginPath();
    ctx.roundRect(pad, pad, size - pad * 2, size - pad * 2, size * 0.16);
    ctx.fillStyle = look.fill;
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, size / 22);
    ctx.strokeStyle = look.ring;
    ctx.stroke();
    ctx.fillStyle = '#f6f1e4';
    ctx.strokeStyle = '#f6f1e4';
    ctx.lineWidth = Math.max(1.5, size / 16);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    glyph(ctx, tech.branch.glyph, size / 2, size * 0.3);
    const text = toRoman(tech.level + 1);
    ctx.font = `700 ${Math.round(size * 0.26)}px Georgia, 'Times New Roman', serif`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.lineWidth = Math.max(1.5, size / 18);
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.strokeText(text, size - pad * 2, size - pad * 2);
    ctx.fillStyle = look.text;
    ctx.fillText(text, size - pad * 2, size - pad * 2);
  });
}

/**
 * Formation button: the real slot layout of a small army seen from above,
 * front up – infantry gold, archers blue behind them.
 */
export function formationIcon(kind: Formation, size = 44): string {
  return render(`f:${kind}:${size}`, size, (ctx) => {
    const members = [
      ...Array.from({ length: 6 }, (_, i) => ({ id: i + 1, role: 'assault' as const, x: i, y: 0 })),
      ...Array.from({ length: 4 }, (_, i) => ({ id: i + 7, role: 'ranged' as const, x: i, y: 1 })),
    ];
    const slots = formationSlots(members, kind, 0, 0, -Math.PI / 2);
    const xs = slots.map((s) => s.x);
    const ys = slots.map((s) => s.y);
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1);
    const k = (size * 0.62) / span;
    const cx = size / 2 - ((Math.max(...xs) + Math.min(...xs)) / 2) * k;
    const cy = size * 0.58 - ((Math.max(...ys) + Math.min(...ys)) / 2) * k;
    // Arrow pointing to the front.
    ctx.strokeStyle = 'rgba(240,231,211,0.75)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(size / 2, size * 0.2);
    ctx.lineTo(size / 2, size * 0.04);
    ctx.moveTo(size / 2 - 4, size * 0.12);
    ctx.lineTo(size / 2, size * 0.04);
    ctx.lineTo(size / 2 + 4, size * 0.12);
    ctx.stroke();
    for (const s of slots) {
      ctx.beginPath();
      ctx.arc(cx + s.x * k, cy + s.y * k, Math.max(2, size * 0.055), 0, Math.PI * 2);
      ctx.fillStyle = s.id <= 6 ? '#e0ad4a' : '#6fb7ff';
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  });
}

/** Button picture of an ability, a calamity or a priestly act: a coloured disc with a sign. */
export function abilityIcon(kind: string, size = 44): string {
  return render(`a:${kind}:${size}`, size, (ctx) => {
    const c = size / 2;
    const r = size * 0.42;
    const color = ABILITY_COLOR[kind] ?? '#e0ad4a';
    const g = ctx.createRadialGradient(c, c - r * 0.3, r * 0.1, c, c, r);
    g.addColorStop(0, shade(color, 0.35));
    g.addColorStop(1, shade(color, -0.45));
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.strokeStyle = '#fff8e8';
    ctx.fillStyle = '#fff8e8';
    ctx.lineWidth = size * 0.07;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const k = size / 44;
    const path = (pts: Array<[number, number]>) => {
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(c + x * k, c + y * k) : ctx.moveTo(c + x * k, c + y * k)));
      ctx.stroke();
    };
    switch (kind) {
      case 'rally':
        path([[-9, -7], [-2, 0], [-9, 7]]);
        path([[1, -7], [8, 0], [1, 7]]);
        break;
      case 'shieldwall':
        ctx.beginPath();
        ctx.moveTo(c, c - 10 * k);
        ctx.lineTo(c + 8 * k, c - 6 * k);
        ctx.quadraticCurveTo(c + 7 * k, c + 6 * k, c, c + 11 * k);
        ctx.quadraticCurveTo(c - 7 * k, c + 6 * k, c - 8 * k, c - 6 * k);
        ctx.closePath();
        ctx.stroke();
        break;
      case 'fieldheal':
      case 'heal':
        ctx.fillRect(c - 3 * k, c - 9 * k, 6 * k, 18 * k);
        ctx.fillRect(c - 9 * k, c - 3 * k, 18 * k, 6 * k);
        break;
      case 'warcry':
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.arc(c - 6 * k, c, (5 + i * 5) * k, -0.7, 0.7);
          ctx.stroke();
        }
        break;
      case 'whirlwind':
      case 'storm':
        ctx.beginPath();
        for (let t = 0; t < 4 * Math.PI; t += 0.2) {
          const rr = (1.5 + t * 0.85) * k;
          const x = c + Math.cos(t) * rr;
          const y = c + Math.sin(t) * rr;
          if (t === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        break;
      case 'frenzy':
      case 'firestorm':
        ctx.beginPath();
        ctx.moveTo(c, c - 11 * k);
        ctx.quadraticCurveTo(c + 10 * k, c - 1 * k, c + 5 * k, c + 9 * k);
        ctx.quadraticCurveTo(c, c + 12 * k, c - 5 * k, c + 9 * k);
        ctx.quadraticCurveTo(c - 10 * k, c - 1 * k, c, c - 11 * k);
        ctx.fill();
        break;
      case 'plague':
        for (const [x, y, rr] of [[-4, 2, 5], [5, -1, 4], [1, -7, 3], [3, 7, 3]] as Array<[number, number, number]>) {
          ctx.beginPath();
          ctx.arc(c + x * k, c + y * k, rr * k, 0, Math.PI * 2);
          ctx.stroke();
        }
        break;
      case 'quake':
        path([[-10, -4], [-4, 0], [-6, 4], [1, 2], [0, 7], [6, 3], [10, 6]]);
        path([[-10, -9], [10, -9]]);
        break;
      case 'convert':
        ctx.beginPath();
        ctx.ellipse(c, c - 7 * k, 7 * k, 2.5 * k, 0, 0, Math.PI * 2);
        ctx.stroke();
        path([[-6, 9], [6, -1]]);
        path([[1, -1], [6, -1], [6, 4]]);
        break;
      default:
        ctx.beginPath();
        ctx.arc(c, c, 5 * k, 0, Math.PI * 2);
        ctx.fill();
    }
  });
}

export type CommandGlyph = 'attack' | 'patrol' | 'explore' | 'stop' | 'cancel' | 'demolish' | 'dismiss' | 'lockstep' | 'shelter' | 'allclear';

/** Pictograms for the order buttons that have no unit, building or tech to show. */
export function commandIcon(kind: CommandGlyph, size = 44): string {
  return render(`c:${kind}:${size}`, size, (ctx) => {
    const c = size / 2;
    const r = size * 0.32;
    const P = (x: number, y: number): [number, number] => [c + x * r, c + y * r];
    const line = (pts: Array<[number, number]>, close = false) => {
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(...P(x, y)) : ctx.moveTo(...P(x, y))));
      if (close) ctx.closePath();
    };
    const arrowHead = (x: number, y: number, angle: number, len = 0.35) => {
      line([
        [x + Math.cos(angle + 2.5) * len, y + Math.sin(angle + 2.5) * len],
        [x, y],
        [x + Math.cos(angle - 2.5) * len, y + Math.sin(angle - 2.5) * len],
      ]);
      ctx.stroke();
    };
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1.5, size / 14);
    const light = '#f0e7d3';
    ctx.strokeStyle = light;
    ctx.fillStyle = light;
    switch (kind) {
      case 'attack':
        // Two crossed swords.
        ctx.strokeStyle = '#ff8a73';
        for (const s of [1, -1]) {
          line([[-0.8 * s, 0.8], [0.75 * s, -0.75]]);
          ctx.stroke();
          line([[-0.65 * s, 0.25], [-0.25 * s, 0.65]]);
          ctx.stroke();
        }
        break;
      case 'patrol':
        // Two arrows chasing each other round.
        ctx.beginPath();
        ctx.arc(c, c, r * 0.75, Math.PI * 1.1, Math.PI * 1.9);
        ctx.stroke();
        arrowHead(0.75 * Math.cos(Math.PI * 1.9), 0.75 * Math.sin(Math.PI * 1.9), Math.PI * 0.4);
        ctx.beginPath();
        ctx.arc(c, c, r * 0.75, Math.PI * 0.1, Math.PI * 0.9);
        ctx.stroke();
        arrowHead(0.75 * Math.cos(Math.PI * 0.9), 0.75 * Math.sin(Math.PI * 0.9), Math.PI * 1.4);
        break;
      case 'explore':
        // Compass rose.
        ctx.beginPath();
        ctx.arc(c, c, r * 0.95, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#e0533f';
        line([[0, -0.8], [0.22, 0], [-0.22, 0]], true);
        ctx.fill();
        ctx.fillStyle = light;
        line([[0, 0.8], [0.22, 0], [-0.22, 0]], true);
        ctx.fill();
        break;
      case 'stop':
        // Raised hand: palm and fingers.
        ctx.beginPath();
        ctx.roundRect(c - r * 0.55, c - r * 0.1, r * 1.1, r * 0.95, r * 0.25);
        ctx.fill();
        for (const x of [-0.42, -0.14, 0.14, 0.42]) {
          ctx.beginPath();
          ctx.roundRect(c + (x - 0.11) * r, c - 0.85 * r, 0.22 * r, 0.9 * r, 0.11 * r);
          ctx.fill();
        }
        ctx.save();
        ctx.translate(c - 0.55 * r, c + 0.15 * r);
        ctx.rotate(-0.6);
        ctx.beginPath();
        ctx.roundRect(-0.11 * r, -0.6 * r, 0.22 * r, 0.65 * r, 0.11 * r);
        ctx.fill();
        ctx.restore();
        break;
      case 'cancel':
      case 'dismiss':
        ctx.strokeStyle = '#ff8a73';
        ctx.lineWidth = Math.max(2, size / 9);
        line([[-0.6, -0.6], [0.6, 0.6]]);
        ctx.stroke();
        line([[0.6, -0.6], [-0.6, 0.6]]);
        ctx.stroke();
        break;
      case 'demolish':
        // Cracked wall under a falling hammer blow.
        for (const [x, y] of [
          [-0.8, 0.15],
          [0, 0.15],
          [-0.4, 0.55],
          [0.4, 0.55],
        ]) {
          ctx.fillRect(c + x * r, c + y * r, 0.75 * r, 0.35 * r);
        }
        ctx.strokeStyle = '#ff8a73';
        line([[-0.1, -0.9], [0.15, -0.4], [-0.1, -0.1], [0.1, 0.1]]);
        ctx.stroke();
        line([[0.4, -0.95], [0.85, -0.5]]);
        ctx.stroke();
        break;
      case 'lockstep':
        // Three marchers, feet in line.
        for (const x of [-0.6, 0, 0.6]) {
          ctx.beginPath();
          ctx.arc(c + x * r, c - 0.55 * r, 0.17 * r, 0, Math.PI * 2);
          ctx.fill();
          line([[x, -0.35], [x, 0.25]]);
          ctx.stroke();
          line([[x - 0.18, 0.75], [x, 0.25], [x + 0.18, 0.75]]);
          ctx.stroke();
        }
        ctx.strokeStyle = '#e0ad4a';
        ctx.lineWidth = Math.max(1, size / 30);
        line([[-0.95, 0.9], [0.95, 0.9]]);
        ctx.stroke();
        break;
      case 'shelter':
      case 'allclear': {
        // Bell (alarm) or bell crossed out (all clear).
        ctx.fillStyle = kind === 'shelter' ? '#f2c84b' : light;
        ctx.beginPath();
        ctx.moveTo(...P(-0.7, 0.5));
        ctx.quadraticCurveTo(...P(-0.45, 0.35), ...P(-0.45, -0.25));
        ctx.quadraticCurveTo(...P(-0.4, -0.75), ...P(0, -0.75));
        ctx.quadraticCurveTo(...P(0.4, -0.75), ...P(0.45, -0.25));
        ctx.quadraticCurveTo(...P(0.45, 0.35), ...P(0.7, 0.5));
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.arc(c, c + 0.65 * r, 0.16 * r, 0, Math.PI * 2);
        ctx.fill();
        if (kind === 'allclear') {
          ctx.strokeStyle = '#6fdc5b';
          ctx.lineWidth = Math.max(2, size / 11);
          line([[-0.55, 0.05], [-0.15, 0.45], [0.65, -0.45]]);
          ctx.stroke();
        }
        break;
      }
    }
  });
}
