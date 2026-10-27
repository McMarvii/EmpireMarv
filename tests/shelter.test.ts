import { describe, expect, it } from 'vitest';
import { findTarget } from '../src/sim/behavior';
import { emptyWorld, run } from './helpers';

describe('target choice', () => {
  it('prefers an enemy unit further away over a building next door', () => {
    const w = emptyWorld({ mapSize: 64 });
    const house = w.addBuilding(1, 'house', 30, 30, true);
    const enemy = w.spawnUnit(1, 'assault', 36, 31);
    run(w, 0.3);
    expect(findTarget(w, 0, 29.4, 31, 9)).toBe(enemy);
    w.kill(enemy, 0);
    expect(findTarget(w, 0, 29.4, 31, 9)).toBe(house);
  });

  it('siege weapons still go for buildings', () => {
    const w = emptyWorld({ mapSize: 64, startEpoch: 5 });
    const house = w.addBuilding(1, 'house', 30, 30, true);
    w.spawnUnit(1, 'assault', 36, 31);
    run(w, 0.3);
    expect(findTarget(w, 0, 29.4, 31, 9, true)).toBe(house);
  });

  it('after a kill soldiers take on the next unit, not the nearest building', () => {
    const w = emptyWorld({ mapSize: 64, startEpoch: 4 });
    w.addBuilding(1, 'house', 30, 28, true);
    const first = w.spawnUnit(1, 'citizen', 29.5, 30.6);
    first.hp = 1;
    const second = w.spawnUnit(1, 'citizen', 34, 33);
    const soldier = w.spawnUnit(0, 'assault', 28.5, 31);
    w.issue({ type: 'attack', player: 0, ids: [soldier.id], targetId: first.id });
    for (let i = 0; i < 200 && w.get(first.id); i++) w.step();
    expect(w.get(first.id)).toBeUndefined();
    run(w, 0.6);
    expect(soldier.order).toMatchObject({ kind: 'attack', targetId: second.id });
  });
});

describe('marching in step', () => {
  it('can be switched off: everybody walks at full speed', () => {
    const w = emptyWorld({ mapSize: 64, startEpoch: 4 });
    const foot = w.spawnUnit(0, 'assault', 20, 30);
    const rider = w.spawnUnit(0, 'mounted', 20, 31);
    const ids = [foot.id, rider.id];
    w.issue({ type: 'move', player: 0, ids, x: 40, y: 30 });
    expect(rider.order.kind === 'move' && rider.order.pace).toBeLessThan(rider.stats.speed);
    w.issue({ type: 'lockstep', player: 0, ids, on: false });
    w.issue({ type: 'move', player: 0, ids, x: 40, y: 30 });
    expect(rider.order.kind === 'move' && rider.order.pace).toBeFalsy();
    expect(foot.lockstep).toBe(false);
  });
});

describe('shelter', () => {
  it('sends citizens into the town center and towers, five per building', () => {
    const w = emptyWorld();
    const tc = w.buildingsOf(0, 'towncenter')[0];
    const tower = w.addBuilding(0, 'tower', tc.tx + 7, tc.ty, true);
    for (let i = 0; i < 3; i++) w.spawnUnit(0, 'citizen', tc.x + 4, tc.y + 3 + i * 0.5);
    const citizens = w.unitsOf(0).filter((u) => u.role === 'citizen');
    expect(citizens.length).toBe(8);
    const pop = w.popCount(0);
    w.issue({ type: 'shelter', player: 0, on: true });
    run(w, 20);
    expect(tc.garrison.length).toBe(5);
    expect(tower.garrison.length).toBe(3);
    // Inside: off the map, but still part of the population.
    expect(w.units.some((u) => u.inside)).toBe(false);
    expect(w.get(citizens[0].id)).toBeUndefined();
    expect(w.popCount(0)).toBe(pop);
  });

  it('fires an extra arrow for every citizen inside', () => {
    const w = emptyWorld();
    const tc = w.buildingsOf(0, 'towncenter')[0];
    w.issue({ type: 'shelter', player: 0, on: true });
    run(w, 15);
    const inside = tc.garrison.length;
    expect(inside).toBeGreaterThan(0);
    w.spawnUnit(1, 'assault', tc.x + 4, tc.y);
    let shots = 0;
    for (let i = 0; i < 60 && shots === 0; i++) {
      w.step();
      shots = w.projectiles.filter((p) => p.attackerId === tc.id).length;
    }
    expect(shots).toBe(1 + inside);
  });

  it('all clear: citizens come out and go back to their work', () => {
    const w = emptyWorld();
    const tc = w.buildingsOf(0, 'towncenter')[0];
    const tree = w.addResource('tree', tc.tx + 7, tc.ty + 1, 1, 100);
    const worker = w.unitsOf(0).find((u) => u.role === 'citizen')!;
    w.issue({ type: 'gather', player: 0, ids: [worker.id], targetId: tree.id });
    run(w, 5);
    w.issue({ type: 'shelter', player: 0, on: true });
    run(w, 10);
    expect(worker.inside).toBe(tc.id);
    w.issue({ type: 'shelter', player: 0, on: false });
    expect(tc.garrison.length).toBe(0);
    expect(worker.inside).toBe(0);
    expect(worker.order).toMatchObject({ kind: 'gather', targetId: tree.id });
    run(w, 1);
    expect(w.units).toContain(worker);
  });

  it('a destroyed shelter lets its people out', () => {
    const w = emptyWorld();
    const tc = w.buildingsOf(0, 'towncenter')[0];
    w.issue({ type: 'shelter', player: 0, on: true });
    run(w, 15);
    const inside = [...tc.garrison];
    expect(inside.length).toBeGreaterThan(0);
    w.kill(tc, 1);
    run(w, 0.1);
    for (const u of inside) {
      expect(u.inside).toBe(0);
      expect(w.get(u.id)).toBe(u);
    }
  });
});
