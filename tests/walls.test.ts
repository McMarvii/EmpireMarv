import { describe, expect, it } from 'vitest';
import { lineTiles } from '../src/game';
import { GameMap } from '../src/sim/map';
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
});
