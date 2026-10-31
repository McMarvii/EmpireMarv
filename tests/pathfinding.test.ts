import { describe, expect, it } from 'vitest';
import { GameMap, Terrain } from '../src/sim/map';
import { distToRect, Pathfinder, type Point } from '../src/sim/pathfinding';
import { emptyWorld, run } from './helpers';

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

/** Blocks the ring of tiles around the square [x0, x0 + size) × [y0, y0 + size). */
function fence(m: GameMap, x0: number, y0: number, size: number): void {
  for (let y = y0 - 1; y <= y0 + size; y++) {
    for (let x = x0 - 1; x <= x0 + size; x++) {
      if (x === x0 - 1 || y === y0 - 1 || x === x0 + size || y === y0 + size) m.block(x, y, 1, 1, 1);
    }
  }
}

/** Whether every leg of a route, from the start on, is walkable. */
function walkable(pf: Pathfinder, start: Point, route: Point[]): boolean {
  let prev = start;
  for (const p of route) {
    if (!pf.lineClear(prev, p)) return false;
    prev = p;
  }
  return true;
}

function length(start: Point, route: Point[]): number {
  let prev = start;
  let sum = 0;
  for (const p of route) {
    sum += Math.hypot(p.x - prev.x, p.y - prev.y);
    prev = p;
  }
  return sum;
}

describe('straight walks', () => {
  it('need room for the unit on both sides', () => {
    const m = new GameMap(20, 20);
    m.block(10, 10, 1, 1, 1);
    const pf = new Pathfinder(m);
    expect(pf.lineClear({ x: 2.5, y: 2.5 }, { x: 17.5, y: 2.5 })).toBe(true);
    expect(pf.lineClear({ x: 2.5, y: 10.5 }, { x: 17.5, y: 10.5 })).toBe(false);
    // Grazing the blocked tile: the unit's shoulder would clip it.
    expect(pf.lineClear({ x: 2.5, y: 9.9 }, { x: 17.5, y: 9.9 })).toBe(false);
    expect(pf.lineClear({ x: 2.5, y: 9.5 }, { x: 17.5, y: 9.5 })).toBe(true);
    expect(pf.lineClear({ x: 6.5, y: 6.5 }, { x: 14.5, y: 14.5 })).toBe(false);
  });

  it('let a unit pressed against a wall walk away from it', () => {
    const m = new GameMap(20, 20);
    m.block(10, 5, 1, 10, 1);
    expect(new Pathfinder(m).lineClear({ x: 9.85, y: 8 }, { x: 3, y: 8 })).toBe(true);
  });

  it('go straight over open ground', () => {
    const path = new Pathfinder(new GameMap(30, 30)).find(2.5, 2.5, { kind: 'point', x: 27.3, y: 21.1 });
    expect(path).toEqual([{ x: 27.3, y: 21.1 }]);
  });
});

describe('goals out of reach', () => {
  it('lead to the nearest place in reach instead of a search in vain', () => {
    const m = new GameMap(40, 40);
    fence(m, 20, 20, 4);
    const pf = new Pathfinder(m);
    const path = pf.find(2.5, 2.5, { kind: 'point', x: 21.5, y: 21.5 });
    const end = path[path.length - 1];
    // Outside the fence (19 to 24), right next to it.
    expect(Math.max(Math.abs(end.x - 21.5), Math.abs(end.y - 21.5))).toBeLessThanOrEqual(3);
    expect(end.x < 19 || end.y < 19 || end.x > 25 || end.y > 25).toBe(true);
    expect(walkable(pf, { x: 2.5, y: 2.5 }, path)).toBe(true);
    // Arrived there: as close as it gets, no way further.
    expect(pf.find(end.x, end.y, { kind: 'point', x: 21.5, y: 21.5 })).toEqual([]);
  });

  it('end next to a fenced building site, then nowhere', () => {
    const m = new GameMap(40, 40);
    fence(m, 20, 20, 4);
    const site = { kind: 'rect' as const, rect: { x: 21, y: 21, w: 2, h: 2 }, reach: 0.85 };
    const pf = new Pathfinder(m);
    const path = pf.find(2.5, 30.5, site);
    expect(path.length).toBeGreaterThan(0);
    const end = path[path.length - 1];
    expect(pf.find(end.x, end.y, site)).toEqual([]);
  });

  it('are told by connected ground, with gates open to their own team only', () => {
    const m = wallMap();
    const pf = new Pathfinder(m);
    const left = m.idx(2, 2);
    const right = m.idx(17, 2);
    expect(pf.areas(-1, false)[left]).toBe(pf.areas(-1, false)[right]);
    // Close the gap with a gate of team 0.
    m.block(10, 18, 1, 2, 1);
    m.setGate(10, 18, 0);
    m.setGate(10, 19, 0);
    expect(pf.areas(-1, false)[left]).not.toBe(pf.areas(-1, false)[right]);
    expect(pf.areas(1, false)[left]).not.toBe(pf.areas(1, false)[right]);
    expect(pf.areas(0, false)[left]).toBe(pf.areas(0, false)[right]);
    expect(pf.areas(0, false)[m.idx(10, 5)]).toBe(0);
  });
});

describe('group routes', () => {
  /** Open ground with a belt of woods across it, passable in a few places. */
  function woods(): GameMap {
    const m = new GameMap(60, 60);
    for (let y = 0; y < 60; y++) {
      if (y % 17 === 5 || y % 17 === 6) continue;
      m.block(28, y, 4, 1, 1);
    }
    m.block(40, 20, 2, 20, 1);
    return m;
  }

  function group(cx: number, cy: number, n: number): Point[] {
    return Array.from({ length: n }, (_, i) => ({ x: cx + (i % 6) - 2.5, y: cy + Math.floor(i / 6) - 2.5 }));
  }

  it('bring every member to its own spot on a walkable route', () => {
    const m = woods();
    const pf = new Pathfinder(m);
    const starts = group(10, 30, 30);
    const goals = group(50, 30, 30);
    const routes = pf.groupPaths(starts, goals, { x: 50, y: 30 });
    routes.forEach((r, i) => {
      expect(r, `member ${i}`).not.toBeNull();
      expect(r![r!.length - 1]).toEqual(goals[i]);
      expect(walkable(pf, starts[i], r!), `member ${i}`).toBe(true);
    });
  });

  it('are about as short as a search for each member', () => {
    const m = woods();
    const pf = new Pathfinder(m);
    const starts = group(10, 30, 30);
    const goals = group(50, 30, 30);
    const routes = pf.groupPaths(starts, goals, { x: 50, y: 30 });
    let shared = 0;
    let single = 0;
    starts.forEach((s, i) => {
      shared += length(s, routes[i]!);
      single += length(s, pf.find(s.x, s.y, { kind: 'point', x: goals[i].x, y: goals[i].y }));
    });
    expect(shared / single).toBeLessThan(1.1);
  });

  it('move a spot shut in by woods to the nearest one in reach', () => {
    const m = new GameMap(60, 60);
    fence(m, 48, 28, 3);
    const pf = new Pathfinder(m);
    const starts = group(10, 30, 6);
    const goals = starts.map((_, i) => (i === 0 ? { x: 49.5, y: 29.5 } : { x: 44 + i, y: 36.5 }));
    // A belt to make the members search at all.
    for (let y = 0; y < 58; y++) m.block(30, y, 1, 1, 1);
    const routes = pf.groupPaths(starts, goals, { x: 46, y: 33 });
    const end = routes[0]![routes[0]!.length - 1];
    expect(Math.max(Math.abs(end.x - 49.5), Math.abs(end.y - 29.5))).toBeLessThanOrEqual(3);
    expect(m.passable(Math.floor(end.x), Math.floor(end.y))).toBe(true);
    expect(walkable(pf, starts[0], routes[0]!)).toBe(true);
    for (let i = 1; i < 6; i++) expect(routes[i]![routes[i]!.length - 1]).toEqual(goals[i]);
  });

  it('make for the nearest place in reach when the centre is shut in', () => {
    const m = new GameMap(60, 60);
    fence(m, 46, 26, 8);
    for (let y = 0; y < 58; y++) m.block(30, y, 1, 1, 1);
    const pf = new Pathfinder(m);
    const starts = group(10, 30, 6);
    const goals = group(50, 30, 6);
    const routes = pf.groupPaths(starts, goals, { x: 50, y: 30 });
    routes.forEach((r, i) => {
      expect(r, `member ${i}`).not.toBeNull();
      const end = r![r!.length - 1];
      // Outside the fence (45 to 54, 25 to 34), next to it.
      expect(end.x < 45 || end.x > 55 || end.y < 25 || end.y > 35).toBe(true);
      expect(distToRect(end.x, end.y, { x: 45, y: 25, w: 10, h: 10 })).toBeLessThan(3);
      expect(walkable(pf, starts[i], r!)).toBe(true);
    });
  });

  it('take members shut in elsewhere as close as they can get', () => {
    const m = new GameMap(60, 60);
    fence(m, 8, 8, 3);
    for (let y = 0; y < 58; y++) m.block(30, y, 1, 1, 1);
    const pf = new Pathfinder(m);
    const starts = [{ x: 8.5, y: 8.5 }, ...group(10, 30, 5)];
    const goals = group(50, 30, 6);
    const routes = pf.groupPaths(starts, goals, { x: 50, y: 30 });
    // The corner of its pen nearest to the goal.
    expect(routes[0]![routes[0]!.length - 1]).toEqual({ x: 10.5, y: 10.5 });
    for (let i = 1; i < 6; i++) expect(routes[i]![routes[i]!.length - 1]).toEqual(goals[i]);
  });
});

describe('marching in a world', () => {
  it('gets a whole army through the woods with one order', () => {
    const w = emptyWorld();
    for (let y = 0; y < 48; y++) if (y !== 12 && y !== 13 && y !== 34 && y !== 35) w.addResource('tree', 24, y, 1, 100);
    const army = Array.from({ length: 24 }, (_, i) => w.spawnUnit(0, 'assault', 6 + (i % 6), 20 + Math.floor(i / 6)));
    w.issue({ type: 'move', player: 0, ids: army.map((u) => u.id), x: 40, y: 24 });
    // Everyone has a way from the first tick on.
    for (const u of army) expect(u.path.length).toBeGreaterThan(0);
    run(w, 40);
    for (const u of army) {
      const o = u.order;
      expect(o.kind).toBe('idle');
      expect(u.x).toBeGreaterThan(30);
    }
  });

  it('walks on to the goal of an attack-move after each kill', () => {
    const w = emptyWorld();
    const army = [0, 1, 2].map((i) => w.spawnUnit(0, 'assault', 5, 22 + i));
    const foes = [w.spawnUnit(1, 'citizen', 20, 23), w.spawnUnit(1, 'citizen', 28, 25)];
    w.issue({ type: 'move', player: 0, ids: army.map((u) => u.id), x: 40, y: 24, attackMove: true });
    run(w, 60);
    for (const f of foes) expect(f.dead).toBe(true);
    for (const u of army) expect(Math.hypot(u.x - 40, u.y - 24)).toBeLessThan(4);
  });
});
