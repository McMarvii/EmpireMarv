import { describe, expect, it } from 'vitest';
import { BUILDING_DEFS } from '../src/data/buildings';
import { lineTiles } from '../src/game';
import { GameMap } from '../src/sim/map';
import { linkMask, LINK_E, LINK_N, LINK_NE, LINK_S, LINK_SW, LINK_W } from '../src/render/sprites';
import { Pathfinder } from '../src/sim/pathfinding';
import type { World } from '../src/sim/world';
import { emptyWorld, run } from './helpers';

/** A column of tiles that is free from top to bottom, for a wall across the whole map. */
function freeColumn(w: World, from: number): number {
  for (let x = from; x < w.map.width - 2; x++) {
    let ok = true;
    for (let y = 0; y < w.map.height && ok; y++) ok = w.map.buildable(x, y);
    if (ok) return x;
  }
  throw new Error('no free column');
}

describe('walls and gates', () => {
  it('a gate is open for its team and closed for everyone else', () => {
    const m = new GameMap(20, 20);
    for (let y = 0; y < 20; y++) m.block(10, y, 1, 1, 1);
    m.setGate(10, 9, 0);
    const pf = new Pathfinder(m);
    const own = pf.find(2.5, 2.5, { kind: 'point', x: 17.5, y: 2.5 }, 8000, 0);
    expect(own[own.length - 1].x).toBeCloseTo(17.5);
    const enemy = pf.find(2.5, 2.5, { kind: 'point', x: 17.5, y: 2.5 }, 8000, 1);
    expect(enemy[enemy.length - 1].x).toBeLessThan(10);
    // Without a team nobody passes (placement, spawning and other team-free checks).
    expect(m.passable(10, 9)).toBe(false);
  });

  it('lets own units through the gate and keeps enemies out', () => {
    const w = emptyWorld();
    const x = freeColumn(w, 26);
    for (let y = 0; y < w.map.height; y++) w.addBuilding(0, y === 20 ? 'gate' : 'wall', x, y, true);
    // Citizens, so neither side stops to fight the other across the wall.
    const friend = w.spawnUnit(0, 'citizen', x - 4, 10);
    const foe = w.spawnUnit(1, 'citizen', x - 4, 12);
    w.issue({ type: 'move', player: 0, ids: [friend.id], x: x + 4, y: 10 });
    w.issue({ type: 'move', player: 1, ids: [foe.id], x: x + 4, y: 12 });
    run(w, 40);
    expect(friend.x).toBeGreaterThan(x + 1);
    expect(foe.x).toBeLessThan(x);
  });

  it('soldiers cannot step through a wall to reach a target right behind it', () => {
    const w = emptyWorld();
    const x = freeColumn(w, 26);
    for (let y = 0; y < w.map.height; y++) w.addBuilding(0, 'wall', x, y, true);
    const target = w.spawnUnit(0, 'citizen', x + 1.5, 12.5);
    const foe = w.spawnUnit(1, 'assault', x - 0.5, 12.5);
    w.issue({ type: 'attack', player: 1, ids: [foe.id], targetId: target.id });
    run(w, 10);
    expect(foe.x).toBeLessThan(x);
    expect(target.hp).toBe(target.maxHp);
  });

  it('a gate set onto a finished wall replaces the segment and lets own units through', () => {
    const w = emptyWorld({ startEpoch: 3 });
    w.players[0].stock.stone = 5000;
    w.players[0].stock.wood = 5000;
    const x = freeColumn(w, 26);
    for (let y = 0; y < w.map.height; y++) w.addBuilding(0, 'wall', x, y, true);
    const [builder] = w.unitsOf(0).filter((u) => u.role === 'citizen');
    expect(w.canPlace(0, 'gate', x, 20)).toBe(true);
    // Only into own walls: the enemy cannot set a gate into this one.
    expect(w.canPlace(1, 'gate', x, 20)).toBe(false);
    w.issue({ type: 'place', player: 0, ids: [builder.id], building: 'gate', tx: x, ty: 20 });
    const at = w.buildings.filter((b) => !b.dead && b.tx === x && b.ty === 20);
    expect(at.map((b) => b.type)).toEqual(['gate']);
    run(w, 90);
    expect(at[0].built).toBe(true);
    const friend = w.spawnUnit(0, 'citizen', x - 4, 18);
    const foe = w.spawnUnit(1, 'citizen', x - 4, 22);
    w.issue({ type: 'move', player: 0, ids: [friend.id], x: x + 4, y: 18 });
    w.issue({ type: 'move', player: 1, ids: [foe.id], x: x + 4, y: 22 });
    run(w, 40);
    expect(friend.x).toBeGreaterThan(x + 1);
    expect(foe.x).toBeLessThan(x);
  });

  it('a tower set into a wall takes the place of the segments under it', () => {
    const w = emptyWorld({ startEpoch: 3 });
    w.players[0].stock.stone = 5000;
    w.players[0].stock.wood = 5000;
    const x = freeColumn(w, 26);
    for (let y = 10; y < 20; y++) w.addBuilding(0, 'wall', x, y, true);
    const [builder] = w.unitsOf(0).filter((u) => u.role === 'citizen');
    expect(w.canPlace(0, 'tower', x, 14)).toBe(true);
    w.issue({ type: 'place', player: 0, ids: [builder.id], building: 'tower', tx: x, ty: 14 });
    const live = w.buildings.filter((b) => !b.dead);
    // Nothing overlaps: the two wall tiles under the 2×2 tower are gone, the rest stands.
    for (let y = 10; y < 20; y++) {
      const here = live.filter((b) => b.tx <= x && x < b.tx + b.size && b.ty <= y && y < b.ty + b.size);
      expect(here).toHaveLength(1);
      expect(here[0].type).toBe(y === 14 || y === 15 ? 'tower' : 'wall');
    }
  });

  it('walls are dragged out as a line, gates are placed one at a time', () => {
    expect(BUILDING_DEFS.wall.drag).toBe(true);
    expect(BUILDING_DEFS.gate.drag).toBeFalsy();
  });

  it('builds a dragged wall line segment by segment', () => {
    const w = emptyWorld({ startEpoch: 1 });
    const tc = w.buildingsOf(0, 'towncenter')[0];
    const citizens = w.unitsOf(0).filter((u) => u.role === 'citizen');
    const tiles = lineTiles(tc.tx - 3, tc.ty + 8, tc.tx + 4, tc.ty + 8).map(([x, y]) => ({ x, y }));
    expect(tiles).toHaveLength(8);
    w.issue({ type: 'placeLine', player: 0, ids: citizens.slice(0, 2).map((u) => u.id), building: 'wall', tiles });
    expect(w.buildingsOf(0, 'wall')).toHaveLength(8);
    run(w, 120);
    expect(w.buildingsOf(0, 'wall').every((b) => b.built)).toBe(true);
  });

  it('only places as many segments as the player can pay for', () => {
    const w = emptyWorld({ startEpoch: 1 });
    w.players[0].stock.wood = 10;
    const [c] = w.unitsOf(0).filter((u) => u.role === 'citizen');
    const tc = w.buildingsOf(0, 'towncenter')[0];
    const tiles = lineTiles(tc.tx, tc.ty + 8, tc.tx + 9, tc.ty + 8).map(([x, y]) => ({ x, y }));
    w.issue({ type: 'placeLine', player: 0, ids: [c.id], building: 'wall', tiles });
    expect(w.buildingsOf(0, 'wall')).toHaveLength(2);
  });

  it('walls alone do not keep a player alive', () => {
    const w = emptyWorld({ startEpoch: 1 });
    w.addBuilding(1, 'wall', 5, 5, true);
    for (const b of w.buildingsOf(1)) if (b.type !== 'wall') w.kill(b, 0);
    for (const u of w.unitsOf(1)) if (u.role === 'citizen') w.kill(u, 0);
    run(w, 2);
    expect(w.players[1].alive).toBe(false);
  });

  it('nobody squeezes through the corner between two diagonal wall segments', () => {
    const m = new GameMap(4, 4);
    m.block(0, 0, 1, 1, 1);
    m.block(1, 1, 1, 1, 1);
    // From (0,1) to (1,0) the only way past is the corner both walls touch.
    expect(m.stepClear(0, 1, 1, 0, -1)).toBe(false);
    expect(m.stepClear(1, 0, 0, 1, -1)).toBe(false);
    // Past a single corner, and straight on, a step is fine.
    expect(m.stepClear(2, 1, 1, 2, -1)).toBe(true);
    expect(m.stepClear(0, 1, 0, 2, -1)).toBe(true);
  });

  it('a diagonal wall holds back a crowd that presses against it', () => {
    const w = emptyWorld();
    // Across the map along x + y = 60, the way a dragged line steps diagonally.
    const k = 60;
    for (let x = k - (w.map.height - 1); x < w.map.width; x++) w.addBuilding(0, 'wall', x, k - x, true);
    const ids: number[] = [];
    for (let i = 0; i < 40; i++) ids.push(w.spawnUnit(1, 'citizen', 20 + (i % 8) * 0.6, 20 + Math.floor(i / 8) * 0.6).id);
    w.issue({ type: 'move', player: 1, ids, x: 40.5, y: 40.5 });
    run(w, 150);
    const through = ids.filter((id) => {
      const u = w.get(id)!;
      return Math.floor(u.x) + Math.floor(u.y) >= k;
    });
    expect(through).toEqual([]);
  });

  it('joins diagonal segments, but never cuts across a staircase', () => {
    const tiles = (list: Array<[number, number]>) => {
      const set = new Set(list.map(([x, y]) => `${x},${y}`));
      return (x: number, y: number) => set.has(`${x},${y}`);
    };
    // A diagonal line: each segment joins its two diagonal neighbours.
    const diagonal = tiles(lineTiles(0, 4, 4, 0));
    expect(linkMask(diagonal, 2, 2)).toBe(LINK_NE | LINK_SW);
    // A staircase is joined through the step, not across it.
    const stairs = tiles([[0, 1], [1, 1], [1, 0]]);
    expect(linkMask(stairs, 0, 1)).toBe(LINK_E);
    expect(linkMask(stairs, 1, 0)).toBe(LINK_S);
    expect(linkMask(stairs, 1, 1)).toBe(LINK_N | LINK_W);
  });
});
