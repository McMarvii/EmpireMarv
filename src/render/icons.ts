import { BUILDING_DEFS, type BuildingType } from '../data/buildings';
import { bestTier, ROLE_DEFS, type Role } from '../data/units';
import type { Project } from './camera';
import { drawBuilding, drawUnit } from './sprites';

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
    const vehicle = ['tank', 'mech', 'armoredcar', 'ram', 'catapult', 'trebuchet', 'cannon', 'rocket', 'beam'].includes(t.look);
    const scale = vehicle ? 0.9 : t.look === 'horse' || t.look === 'chariot' ? 1.15 : 1.5;
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
    const cy = size * (type === 'farm' ? 0.2 : 0.42);
    const project: Project = (wx, wy, z = 0) => [cx + (wx - wy) * 32 * scale, cy + (wx + wy) * 16 * scale - z * scale];
    drawBuilding(ctx, project, scale, { type, epoch, color, tx: 0, ty: 0, size: tiles, progress: 1, built: true, hpRatio: 1, seed: 3 }, 0.5);
  });
}
