import { describe, expect, it } from 'vitest';
import { EPOCHS } from '../src/data/epochs';
import { emptyWorld, run } from './helpers';

describe('economy', () => {
  it('citizens chop wood and bring it to the town center', () => {
    const w = emptyWorld();
    const tc = w.buildingsOf(0, 'towncenter')[0];
    const tree = w.addResource('tree', tc.tx + 7, tc.ty + 1, 1, 200);
    const before = w.players[0].stock.wood;
    const citizens = w.unitsOf(0).filter((u) => u.role === 'citizen').map((u) => u.id);
    w.issue({ type: 'gather', player: 0, ids: citizens, targetId: tree.id });
    run(w, 60);
    expect(w.players[0].stock.wood).toBeGreaterThan(before + 60);
    expect(tree.amount).toBeLessThan(200);
  });

  it('farms are endless and need to be built first', () => {
    const w = emptyWorld({ startEpoch: 1 });
    const tc = w.buildingsOf(0, 'towncenter')[0];
    const [c] = w.unitsOf(0).filter((u) => u.role === 'citizen');
    w.issue({ type: 'place', player: 0, ids: [c.id], building: 'farm', tx: tc.tx + 6, ty: tc.ty });
    const farm = w.buildingsOf(0, 'farm')[0];
    expect(farm).toBeDefined();
    expect(farm.built).toBe(false);
    const food = w.players[0].stock.food;
    run(w, 90);
    expect(farm.built).toBe(true);
    // The builder starts farming on its own once the field is ready.
    expect(w.players[0].stock.food).toBeGreaterThan(food);
  });

  it('refuses buildings from later epochs', () => {
    const w = emptyWorld();
    const tc = w.buildingsOf(0, 'towncenter')[0];
    const [c] = w.unitsOf(0);
    w.issue({ type: 'place', player: 0, ids: [c.id], building: 'stable', tx: tc.tx + 6, ty: tc.ty });
    expect(w.buildingsOf(0, 'stable')).toHaveLength(0);
  });

  it('trains citizens and respects the population limit', () => {
    const w = emptyWorld({ popLimit: 7 });
    const tc = w.buildingsOf(0, 'towncenter')[0];
    w.players[0].stock.food = 1000;
    w.issue({ type: 'train', player: 0, buildingId: tc.id, role: 'citizen', count: 5 });
    run(w, 80);
    expect(w.popCount(0)).toBe(7);
    expect(tc.popBlocked).toBe(true);
  });

  it('refunds cancelled training', () => {
    const w = emptyWorld();
    const tc = w.buildingsOf(0, 'towncenter')[0];
    const food = w.players[0].stock.food;
    w.issue({ type: 'train', player: 0, buildingId: tc.id, role: 'citizen' });
    expect(w.players[0].stock.food).toBe(food - 50);
    w.issue({ type: 'cancel', player: 0, buildingId: tc.id, index: 0 });
    expect(w.players[0].stock.food).toBe(food);
  });
});

describe('epochs', () => {
  it('advancing costs resources, takes time and unlocks new tiers', () => {
    const w = emptyWorld();
    const p = w.players[0];
    for (const r of ['food', 'wood', 'stone', 'gold', 'iron'] as const) p.stock[r] = 5000;
    const tc = w.buildingsOf(0, 'towncenter')[0];
    expect(w.roleName(0, 'assault')).toBe('Keulenkrieger');
    w.issue({ type: 'advance', player: 0, buildingId: tc.id });
    expect(p.stock.food).toBe(5000 - (EPOCHS[1].advanceCost.food ?? 0));
    run(w, EPOCHS[1].advanceTime - 1);
    expect(p.epoch).toBe(0);
    run(w, 2);
    expect(p.epoch).toBe(1);
    expect(w.roleName(0, 'assault')).toBe('Axtkämpfer');
    // Existing buildings move into the new era as well.
    expect(tc.epoch).toBe(1);
    expect(tc.hp).toBe(tc.maxHp);
  });

  it('stops at the last epoch chosen for the match', () => {
    const w = emptyWorld({ startEpoch: 2, maxEpoch: 2 });
    const p = w.players[0];
    for (const r of ['food', 'wood', 'stone', 'gold', 'iron'] as const) p.stock[r] = 50000;
    const tc = w.buildingsOf(0, 'towncenter')[0];
    w.issue({ type: 'advance', player: 0, buildingId: tc.id });
    expect(tc.research).toBeNull();
    run(w, 60);
    expect(p.epoch).toBe(2);
  });
});
