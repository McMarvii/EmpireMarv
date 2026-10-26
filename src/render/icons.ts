import { BUILDING_DEFS, type BuildingType } from '../data/buildings';
import { epochNumeral, epochStyle, type EraStyle } from '../data/epochs';
import { bestTier, ROLE_DEFS, type Role } from '../data/units';
import type { Project } from './camera';
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
    const scale = vehicle ? 0.9 : t.look === 'horse' || t.look === 'chariot' || t.look === 'scouthorse' ? 1.15 : 1.5;
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
    const scale = (size / (tiles * 64)) * 0.95;
    const cx = size / 2;
    const line = BUILDING_DEFS[type].line;
    const cy = size * (type === 'farm' ? 0.2 : line ? 0.3 : 0.42);
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
    const maxW = size * 0.74;
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
