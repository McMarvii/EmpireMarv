import { describe, expect, it } from 'vitest';
import { shade } from '../src/render/colors';
import { rasterZoom } from '../src/render/gl/atlas';
import { buildingSprite, FACINGS, foldUnitLook, nodeSprite, unitSprite } from '../src/render/scene';
import type { BuildingLook, UnitLook } from '../src/render/sprites';

const soldier: UnitLook = { look: 'sword', epoch: 6, color: '#2f7de1', facing: 0.3, moving: true, attackAnim: 0.35, working: false, carry: null, seed: 17 };

describe('sprite atlas keys', () => {
  it('ignore what only shifts the animation phase', () => {
    const a = unitSprite(soldier, 10, 10, 1.8, true);
    const b = unitSprite({ ...soldier, seed: 99 }, 40, 3, 1.8, true);
    expect(a.key).toBe(b.key);
    expect(a.anim).not.toEqual(b.anim);
  });

  it('tell apart what changes the picture', () => {
    const base = unitSprite(soldier, 0, 0, 1.8, true).key;
    for (const change of [{ color: '#e14b2f' }, { epoch: 9 }, { moving: false }, { attackAnim: 0.1 }, { carry: 'wood' as const }, { facing: Math.PI }]) {
      expect(unitSprite({ ...soldier, ...change }, 0, 0, 1.8, true).key).not.toBe(base);
    }
  });

  it('mirror figures and turn models in fixed steps', () => {
    // Figures only ever face left or right.
    expect(foldUnitLook({ ...soldier, facing: 0.2 }).facing).toBe(foldUnitLook({ ...soldier, facing: -0.3 }).facing);
    expect(foldUnitLook({ ...soldier, facing: 0.2 }).facing).not.toBe(foldUnitLook({ ...soldier, facing: Math.PI }).facing);
    // Tanks keep FACINGS directions.
    const tank = { ...soldier, look: 'tank' as const };
    const step = (Math.PI * 2) / FACINGS;
    expect(foldUnitLook({ ...tank, facing: step * 3.2 }).facing).toBeCloseTo(step * 3);
    expect(foldUnitLook({ ...tank, facing: step * 3.2 }).facing).toBe(foldUnitLook({ ...tank, facing: step * 2.9 }).facing);
  });

  it('only hand the canvas exact looks', () => {
    const s = unitSprite({ ...soldier, look: 'tank', facing: 0.123 }, 0, 0, 1.8, false);
    expect(s.key).toBe('');
  });

  it('repaint buildings on damage and construction steps, not on every hit point', () => {
    const house: BuildingLook = { type: 'house', epoch: 4, color: '#2f7de1', tx: 3, ty: 4, size: 2, progress: 1, built: true, hpRatio: 1, seed: 5 };
    const key = (b: Partial<BuildingLook>) => buildingSprite({ ...house, ...b }, 0, 0, 1, true).key;
    expect(key({ hpRatio: 0.9 })).toBe(key({ hpRatio: 0.6 }));
    expect(key({ hpRatio: 0.4 })).not.toBe(key({ hpRatio: 0.6 }));
    expect(key({ tx: 30, ty: 2, seed: 8 })).toBe(key({}));
    expect(key({ built: false, progress: 0.5 })).not.toBe(key({ built: false, progress: 0.6 }));
    expect(key({ built: false, progress: 0.501 })).toBe(key({ built: false, progress: 0.5 }));
  });

  it('let every tree sway on its own but share the pictures', () => {
    const a = nodeSprite({ nodeType: 'tree', tx: 4, ty: 9, size: 1, ratio: 1, variant: 2 }, 4.5, 9.5, 1, true);
    const b = nodeSprite({ nodeType: 'tree', tx: 7, ty: 1, size: 1, ratio: 0.3, variant: 2 }, 7.5, 1.5, 2, true);
    expect(a.key).toBe(b.key);
    expect(a.anim.kind).toBe('cycle');
  });
});

describe('raster zoom', () => {
  it('rounds up to a quarter of a doubling', () => {
    expect(rasterZoom(1)).toBe(1);
    expect(rasterZoom(2)).toBe(2);
    expect(rasterZoom(0.5)).toBe(0.5);
    for (const z of [0.45, 0.61, 0.9, 1.05, 1.5, 2.2]) {
      const r = rasterZoom(z);
      expect(r).toBeGreaterThanOrEqual(z);
      expect(r / z).toBeLessThan(2 ** 0.25 + 1e-9);
    }
  });
});

describe('colours', () => {
  it('shade what shade returned', () => {
    const once = shade('#336699', 0.2);
    expect(once).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
    expect(shade(once, -0.5)).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
    expect(shade(once, -0.5)).not.toContain('NaN');
  });
});

describe('interface size', () => {
  it('grows with the window in quarter steps and never past what fits', async () => {
    const { uiScaleFor } = await import('../src/render/graphics');
    // Automatic: Full HD and smaller stay at 100 %, 1440p gets 150 %, 4K 200 %.
    expect(uiScaleFor(0, 1366, 768)).toBe(1);
    expect(uiScaleFor(0, 1920, 1080)).toBe(1);
    expect(uiScaleFor(0, 2560, 1440)).toBe(1.5);
    expect(uiScaleFor(0, 3840, 2160)).toBe(2);
    // An ultrawide screen goes by its height.
    expect(uiScaleFor(0, 3440, 1440)).toBe(1.5);
    // A fixed choice applies, but a small window caps it so the bars still fit.
    expect(uiScaleFor(1.25, 1920, 1080)).toBe(1.25);
    expect(uiScaleFor(2, 1920, 1080)).toBe(1.5);
    expect(uiScaleFor(2, 1280, 720)).toBe(1);
  });
});
