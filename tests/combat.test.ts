import { describe, expect, it } from 'vitest';
import type { Role } from '../src/data/units';
import { emptyWorld, run } from './helpers';

/** Fights n vs n at the same epoch in open field; returns surviving units per side. */
function duel(a: Role, b: Role, epoch: number, n = 4): [number, number] {
  const w = emptyWorld({ mapSize: 64, startEpoch: epoch });
  const ax: number[] = [];
  const bx: number[] = [];
  for (let i = 0; i < n; i++) {
    ax.push(w.spawnUnit(0, a, 26, 30 + i * 0.8).id);
    bx.push(w.spawnUnit(1, b, 34, 30 + i * 0.8).id);
  }
  w.issue({ type: 'move', player: 0, ids: ax, x: 34, y: 31, attackMove: true });
  w.issue({ type: 'move', player: 1, ids: bx, x: 26, y: 31, attackMove: true });
  run(w, 90);
  const alive = (ids: number[]) => ids.filter((id) => w.get(id)).length;
  return [alive(ax), alive(bx)];
}

describe('counter system', () => {
  it('assault infantry beats pikes', () => {
    const [a, b] = duel('assault', 'pike', 4);
    expect(a).toBeGreaterThan(0);
    expect(b).toBe(0);
  });

  it('pikes beat cavalry', () => {
    const [a, b] = duel('pike', 'mounted', 7);
    expect(a).toBeGreaterThan(0);
    expect(b).toBe(0);
  });

  it('cavalry beats archers', () => {
    const [a, b] = duel('mounted', 'ranged', 7);
    expect(a).toBeGreaterThan(0);
    expect(b).toBe(0);
  });

  it('archers beat assault infantry', () => {
    const [a, b] = duel('ranged', 'assault', 4);
    expect(a).toBeGreaterThan(0);
    expect(b).toBe(0);
  });

  it('a newer epoch wins against an older one of the same role', () => {
    const w = emptyWorld({ mapSize: 64 });
    const old = [0, 1, 2].map((i) => w.spawnUnit(0, 'ranged', 26, 30 + i, 0).id);
    const modern = [0, 1, 2].map((i) => w.spawnUnit(1, 'ranged', 33, 30 + i, 12).id);
    w.issue({ type: 'move', player: 0, ids: old, x: 33, y: 31, attackMove: true });
    run(w, 60);
    expect(old.filter((id) => w.get(id))).toHaveLength(0);
    expect(modern.filter((id) => w.get(id)).length).toBeGreaterThan(0);
  });

  it('siege tears down buildings much faster than infantry', () => {
    const hpAfter = (role: Role) => {
      const w = emptyWorld({ mapSize: 64, startEpoch: 5 });
      const target = w.addBuilding(1, 'house', 30, 30, true);
      const ids = [0, 1].map((i) => w.spawnUnit(0, role, 22, 30 + i).id);
      w.issue({ type: 'attack', player: 0, ids, targetId: target.id });
      run(w, 40);
      return w.get(target.id) ? target.hp / target.maxHp : 0;
    };
    expect(hpAfter('siege')).toBeLessThan(hpAfter('assault'));
  });

  it('houses give nearby units morale', () => {
    const w = emptyWorld({ mapSize: 64 });
    const u = w.spawnUnit(0, 'assault', 30, 30);
    w.addBuilding(0, 'house', 31, 33, true);
    w.addBuilding(0, 'house', 27, 33, true);
    run(w, 1.1);
    expect(u.morale).toBe(2);
  });

  it('defeats a player who loses all buildings and citizens', () => {
    const w = emptyWorld();
    for (const b of w.buildingsOf(1)) w.kill(b, 0);
    for (const u of w.unitsOf(1)) w.kill(u, 0);
    run(w, 1.1);
    expect(w.players[1].alive).toBe(false);
    expect(w.over).toBe(true);
    expect(w.winnerTeam).toBe(0);
  });
});
