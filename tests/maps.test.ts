import { describe, expect, it } from 'vitest';
import { MAP_TYPES, resolveMapType, type MapType } from '../src/data/maps';
import { hypot } from '../src/sim/fmath';
import { Terrain } from '../src/sim/map';
import { shoreReach } from '../src/sim/mapgen';
import type { Point } from '../src/sim/pathfinding';
import { World } from '../src/sim/world';

function makeWorld(mapType: MapType, seed: number, mapSize: number, players: number): World {
  return new World({
    seed,
    mapSize,
    mapType,
    players: Array.from({ length: players }, (_, i) => ({ name: `P${i}`, color: '#fff', isAI: false, team: i })),
  });
}

/** Tiles reachable on foot from a point (buildings, trees and water block). */
function walkable(w: World, from: Point): Uint8Array {
  const { map } = w;
  const seen = new Uint8Array(map.width * map.height);
  const start = map.nearestPassable(from.x, from.y, 6)!;
  const stack = [map.idx(start.x, start.y)];
  seen[stack[0]] = 1;
  while (stack.length) {
    const cur = stack.pop()!;
    const x = cur % map.width;
    const y = (cur - x) / map.width;
    for (const [nx, ny] of [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ]) {
      if (!map.passable(nx, ny) || seen[map.idx(nx, ny)]) continue;
      seen[map.idx(nx, ny)] = 1;
      stack.push(map.idx(nx, ny));
    }
  }
  return seen;
}

/** A spot beside the town center, so the start itself (under the building) is not needed. */
function besideBase(w: World, player: number): Point {
  const tc = w.buildings.find((b) => b.owner === player && b.type === 'towncenter')!;
  return { x: tc.tx + tc.size + 0.5, y: tc.ty + tc.size + 0.5 };
}

function nodesNear(w: World, s: Point, type: string, radius: number): number {
  return w.resources.filter((n) => n.nodeType === type && hypot(n.x - s.x, n.y - s.y) <= radius).length;
}

function hasHarbourSite(w: World, s: Point, radius: number): boolean {
  const { map } = w;
  for (let y = Math.floor(s.y - radius); y <= s.y + radius; y++) {
    for (let x = Math.floor(s.x - radius); x <= s.x + radius; x++) {
      if (hypot(x + 1.5 - s.x, y + 1.5 - s.y) > radius) continue;
      if (map.shoreSite(x, y, 3)) return true;
    }
  }
  return false;
}

const CASES: Array<[number, number, number]> = [
  [1, 64, 2],
  [2, 96, 4],
  [5, 96, 3],
  [9, 128, 4],
];

describe('map types', () => {
  it('resolves "random" from the seed and defaults to the continent', () => {
    expect(resolveMapType(undefined, 4)).toBe('continent');
    expect(resolveMapType('rivers', 4)).toBe('rivers');
    const picks = new Set(Array.from({ length: 60 }, (_, seed) => resolveMapType('random', seed)));
    expect(picks.size).toBe(MAP_TYPES.length);
    expect(resolveMapType('random', 17)).toBe(resolveMapType('random', 17));
    expect(new World({ seed: 17, mapType: 'random' }).settings.mapType).toBe(resolveMapType('random', 17));
  });

  for (const def of MAP_TYPES) {
    describe(def.name, () => {
      for (const [seed, size, players] of CASES) {
        it(`is fair and sound (seed ${seed}, ${size}×${size}, ${players} players)`, () => {
          const w = makeWorld(def.id, seed, size, players);
          expect(w.settings.mapType).toBe(def.id);
          for (let p = 0; p < players; p++) {
            const s = w.startPositions[p];
            expect(w.map.terrainAt(Math.floor(s.x), Math.floor(s.y))).not.toBe(Terrain.Water);
            for (const mine of ['gold', 'stone', 'iron']) expect(nodesNear(w, s, mine, 17), `${mine} at ${p}`).toBeGreaterThanOrEqual(1);
            expect(nodesNear(w, s, 'tree', 18), `wood at ${p}`).toBeGreaterThanOrEqual(25);
            // The continent keeps the old recipe, which on small maps can lose half a bush cluster.
            expect(nodesNear(w, s, 'berries', 17), `berries at ${p}`).toBeGreaterThanOrEqual(def.id === 'continent' ? 5 : 10);
            if (def.water) {
              const reach = shoreReach(def.id, size);
              expect(nodesNear(w, s, 'fish', reach + 2), `fish at ${p}`).toBeGreaterThanOrEqual(2);
              expect(hasHarbourSite(w, s, reach), `harbour site at ${p}`).toBe(true);
            }
          }
          // Fish only ever lie on water.
          for (const n of w.resources) {
            if (n.nodeType === 'fish') expect(w.map.terrainAt(n.tx, n.ty)).toBe(Terrain.Water);
          }
          const reach = walkable(w, besideBase(w, 0));
          for (let p = 1; p < players; p++) {
            const s = besideBase(w, p);
            const t = w.map.nearestPassable(s.x, s.y, 6)!;
            const connected = reach[w.map.idx(t.x, t.y)] === 1;
            // Islands keep everybody apart; everywhere else there is a way on foot.
            expect(connected, `land route 0 → ${p}`).toBe(def.id !== 'islands');
          }
        });
      }
    });
  }

  it('gives every island its own land, with a mine island in the middle', () => {
    const w = makeWorld('islands', 4, 96, 4);
    const regions = w.startPositions.map((s) => w.map.landRegion[w.map.idx(Math.floor(s.x), Math.floor(s.y))]);
    expect(new Set(regions).size).toBe(4);
    const mid = w.map.landRegion[w.map.idx(48, 48)];
    expect(mid).toBeGreaterThan(0);
    expect(regions).not.toContain(mid);
    const mines = w.resources.filter((n) => n.size === 2 && w.map.landRegion[w.map.idx(n.tx, n.ty)] === mid);
    expect(mines.length).toBeGreaterThanOrEqual(3);
    expect(w.map.sameLand(w.startPositions[0].x, w.startPositions[0].y, 48, 48)).toBe(false);
  });

  it('builds the same map from the same seed', () => {
    for (const def of MAP_TYPES) {
      const a = makeWorld(def.id, 12, 96, 3);
      const b = makeWorld(def.id, 12, 96, 3);
      expect(Array.from(a.map.terrain)).toEqual(Array.from(b.map.terrain));
      expect(a.resources.map((n) => [n.nodeType, n.tx, n.ty])).toEqual(b.resources.map((n) => [n.nodeType, n.tx, n.ty]));
      expect(a.checksum()).toBe(b.checksum());
    }
  });

  it('keeps the continent exactly as before map types existed', () => {
    // Terrain and deposits of seed 7 (96×96, 2 players) as generated by 0.6.
    const w = makeWorld('continent', 7, 96, 2);
    let h = 2166136261;
    const add = (v: number) => {
      h = Math.imul(h ^ (v | 0), 16777619) >>> 0;
    };
    for (let i = 0; i < w.map.terrain.length; i++) add(w.map.terrain[i]);
    // Wild game came later and rolls its own dice; the rest must not move.
    for (const r of w.resources.filter((n) => n.nodeType !== 'deer')) {
      add(r.tx);
      add(r.ty);
      add(r.size);
      // Mines hold twice as much since 0.10.2; the layout is what this guards.
      add(r.nodeType === 'gold' || r.nodeType === 'stone' || r.nodeType === 'iron' ? r.amount / 2 : r.amount);
      add(r.variant);
    }
    expect(h).toBe(3312152833);
  });

  it('finds harbour sites only at the shore', () => {
    const w = makeWorld('coast', 3, 96, 2);
    const { map } = w;
    let shore = 0;
    for (let y = 0; y < 93; y++) {
      for (let x = 0; x < 93; x++) {
        if (!map.shoreSite(x, y, 3)) continue;
        shore++;
        let land = false;
        for (let dy = -1; dy <= 3; dy++) for (let dx = -1; dx <= 3; dx++) if (map.inBounds(x + dx, y + dy) && map.terrainAt(x + dx, y + dy) !== Terrain.Water) land = true;
        expect(land).toBe(true);
      }
    }
    expect(shore).toBeGreaterThan(20);
    // Dry land is never a harbour site.
    const s = w.startPositions[0];
    expect(map.shoreSite(Math.floor(s.x) - 1, Math.floor(s.y) - 1, 3)).toBe(false);
  });
});
