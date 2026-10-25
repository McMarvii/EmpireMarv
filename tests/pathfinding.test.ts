import { describe, expect, it } from 'vitest';
import { GameMap, Terrain } from '../src/sim/map';
import { distToRect, Pathfinder } from '../src/sim/pathfinding';

function wallMap(): GameMap {
  const m = new GameMap(20, 20);
  // Vertical wall at x = 10 with a gap at y = 18.
  for (let y = 0; y < 18; y++) m.terrain[m.idx(10, y)] = Terrain.Water;
  return m;
}

describe('pathfinder', () => {
  it('walks around obstacles', () => {
    const m = wallMap();
    const path = new Pathfinder(m).find(2.5, 2.5, { kind: 'point', x: 17.5, y: 2.5 });
    expect(path.length).toBeGreaterThan(0);
    const end = path[path.length - 1];
    expect(end.x).toBeCloseTo(17.5);
    expect(end.y).toBeCloseTo(2.5);
    // The route has to pass through the gap.
    expect(path.some((p) => p.y > 17)).toBe(true);
  });

  it('never steps onto blocked tiles', () => {
    const m = wallMap();
    const pf = new Pathfinder(m);
    const path = pf.find(2.5, 2.5, { kind: 'point', x: 17.5, y: 2.5 });
    let prev = { x: 2.5, y: 2.5 };
    for (const p of path) {
      expect(pf.lineClear(prev, p)).toBe(true);
      prev = p;
    }
  });

  it('returns a partial path towards unreachable goals', () => {
    const m = new GameMap(20, 20);
    for (let y = 0; y < 20; y++) m.terrain[m.idx(10, y)] = Terrain.Water;
    const path = new Pathfinder(m).find(2.5, 2.5, { kind: 'point', x: 17.5, y: 2.5 });
    expect(path.length).toBeGreaterThan(0);
    expect(path[path.length - 1].x).toBeLessThan(10);
  });

  it('stops next to rectangular targets', () => {
    const m = new GameMap(20, 20);
    m.block(8, 8, 3, 3, 1);
    const path = new Pathfinder(m).find(1.5, 1.5, { kind: 'rect', rect: { x: 8, y: 8, w: 3, h: 3 }, reach: 0.9 });
    const end = path[path.length - 1];
    expect(m.passable(Math.floor(end.x), Math.floor(end.y))).toBe(true);
    expect(distToRect(end.x, end.y, { x: 8, y: 8, w: 3, h: 3 })).toBeLessThanOrEqual(0.9);
  });
});
