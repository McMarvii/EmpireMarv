import { describe, expect, it } from 'vitest';
import { edgePoint, findHotspots, HOT_TICKS } from '../src/ui/alerts';
import { emptyWorld, run } from './helpers';

describe('fights for the overview', () => {
  it('finds every place where own units are under fire, the latest first, and forgets quiet ones', () => {
    const w = emptyWorld();
    const a = [w.spawnUnit(0, 'assault', 10, 30), w.spawnUnit(0, 'assault', 11, 30)];
    const b = w.spawnUnit(0, 'citizen', 35, 12);
    const far = w.spawnUnit(0, 'citizen', 40, 40);
    w.tick = 100;
    a[0].lastHitTick = 95;
    a[1].lastHitTick = 99;
    b.lastHitTick = 98;
    far.lastHitTick = 100 - HOT_TICKS - 1;
    const spots = findHotspots(w, 0);
    expect(spots.map((s) => [s.units, s.last])).toEqual([
      [2, 99],
      [1, 98],
    ]);
    expect(spots[0].x).toBeCloseTo(10.5);
    // A fight keeps its start while it goes on.
    w.tick = 200;
    a[0].lastHitTick = 198;
    const again = findHotspots(w, 0, spots);
    expect(again.length).toBe(1);
    expect(again[0].since).toBe(95);
    // The enemy's losses are not ours to report.
    expect(findHotspots(w, 1)).toEqual([]);
  });

  it('sees a real skirmish', () => {
    const w = emptyWorld();
    w.spawnUnit(0, 'assault', 20, 20);
    w.spawnUnit(1, 'assault', 21.5, 20);
    run(w, 2);
    const [spot] = findHotspots(w, 0);
    expect(spot).toBeDefined();
    expect(Math.hypot(spot.x - 20, spot.y - 20)).toBeLessThan(3);
  });

  it('puts the arrow on the edge of the map area, pointing at the fight', () => {
    const rect = { left: 0, top: 40, right: 1000, bottom: 600 };
    expect(edgePoint(500, 300, rect, 20)).toBeNull();
    const right = edgePoint(5000, 320, rect, 20)!;
    expect(right.x).toBeCloseTo(980);
    expect(right.angle).toBeCloseTo(0, 1);
    const below = edgePoint(500, 3000, rect, 20)!;
    expect(below.y).toBeCloseTo(580);
    expect(below.angle).toBeCloseTo(Math.PI / 2);
  });
});
