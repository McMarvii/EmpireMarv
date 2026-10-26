import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { run } from './helpers';

function scoutWorld(): World {
  const w = new World({
    seed: 3,
    mapSize: 48,
    players: [
      { name: 'A', color: '#2f7de1', isAI: false, team: 0 },
      { name: 'B', color: '#d9412b', isAI: false, team: 1 },
    ],
  });
  // No enemy town center that could shoot the scout; B's citizens keep B in the game.
  w.remove(w.buildingsOf(1, 'towncenter')[0]);
  return w;
}

describe('scouts and exploring', () => {
  it('every player starts with a scout that does not pick fights', () => {
    const w = scoutWorld();
    for (const p of w.players) expect(w.unitsOf(p.id).filter((u) => u.role === 'scout')).toHaveLength(1);
    const scout = w.unitsOf(0).find((u) => u.role === 'scout')!;
    expect(scout.stats.sight).toBeGreaterThan(w.unitsOf(0).find((u) => u.role === 'citizen')!.stats.sight);
  });

  it('explores the map on its own and stops once everything is known', () => {
    const w = scoutWorld();
    const vis = w.players[0].vis;
    const explored = () => vis.reduce((n, v) => n + (v !== 0 ? 1 : 0), 0);
    const scout = w.unitsOf(0).find((u) => u.role === 'scout')!;
    const before = explored();
    w.issue({ type: 'explore', player: 0, ids: [scout.id] });
    run(w, 60);
    expect(explored()).toBeGreaterThan(before * 2);
    for (let t = 0; t < 900 && scout.order.kind === 'explore'; t++) run(w, 1);
    expect(scout.order.kind).toBe('idle');
    expect(explored() / vis.length).toBeGreaterThan(0.9);
  }, 30000);

  it('the town center trains scouts', () => {
    const w = scoutWorld();
    const tc = w.buildingsOf(0, 'towncenter')[0];
    w.issue({ type: 'train', player: 0, buildingId: tc.id, role: 'scout' });
    run(w, 20);
    expect(w.unitsOf(0).filter((u) => u.role === 'scout')).toHaveLength(2);
  });
});
