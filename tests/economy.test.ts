import { describe, expect, it } from 'vitest';
import { EPOCHS } from '../src/data/epochs';
import { rectOf } from '../src/sim/entities';
import { distToRect } from '../src/sim/pathfinding';
import { World } from '../src/sim/world';
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

  it('woodcutters sent together spread over the trees at the edge of a grove', () => {
    const w = emptyWorld();
    const tc = w.buildingsOf(0, 'towncenter')[0];
    // A 4×4 grove: the four trees in its middle have no open side.
    const grove = [];
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) grove.push(w.addResource('tree', tc.tx + 8 + x, tc.ty + y, 1, 200));
    const clicked = grove[4];
    const citizens = w.unitsOf(0).filter((u) => u.role === 'citizen');
    w.issue({ type: 'gather', player: 0, ids: citizens.map((u) => u.id), targetId: clicked.id });
    const targets = citizens.map((u) => (u.order as { targetId: number }).targetId);
    // One tree each, the clicked one among them, none buried inside the grove.
    expect(new Set(targets).size).toBe(citizens.length);
    expect(targets).toContain(clicked.id);
    const inner = new Set([grove[5].id, grove[6].id, grove[9].id, grove[10].id]);
    expect(targets.filter((t) => inner.has(t))).toEqual([]);
    const before = w.players[0].stock.wood;
    run(w, 60);
    expect(w.players[0].stock.wood).toBeGreaterThan(before + 60);
  });

  it('woodcutters of a felled tree spread over the next trees instead of crowding one', () => {
    const w = emptyWorld();
    const tc = w.buildingsOf(0, 'towncenter')[0];
    // An almost felled tree and a loose row of trees behind it.
    const last = w.addResource('tree', tc.tx + 8, tc.ty + 1, 1, 6);
    const row = [0, 1, 2, 3].map((i) => w.addResource('tree', tc.tx + 10 + i * 2, tc.ty + 1, 1, 200));
    const citizens = w.unitsOf(0).filter((u) => u.role === 'citizen').slice(0, 4);
    // One by one, so all four really work the same tree.
    for (const u of citizens) w.issue({ type: 'gather', player: 0, ids: [u.id], targetId: last.id });
    for (let i = 0; i < 20 * 40 && !last.dead; i++) w.step();
    expect(last.dead).toBe(true);
    w.step();
    const next = citizens.map((u) => (u.order as { targetId: number }).targetId);
    expect(next.every((id) => row.some((t) => t.id === id))).toBe(true);
    expect(new Set(next).size).toBeGreaterThanOrEqual(3);
  });

  it('mines hold 5000 each', () => {
    const w = new World({ seed: 5, mapSize: 64, players: [{ name: 'A', color: '#2f7de1', isAI: false, team: 0 }, { name: 'B', color: '#d9412b', isAI: false, team: 1 }] });
    const mines = w.resources.filter((n) => n.nodeType === 'gold' || n.nodeType === 'stone' || n.nodeType === 'iron');
    expect(mines.length).toBeGreaterThan(0);
    for (const m of mines) expect(m.amount).toBe(5000);
  });

  it('miners sent together still work the deposit they were sent to', () => {
    const w = emptyWorld();
    const tc = w.buildingsOf(0, 'towncenter')[0];
    const a = w.addResource('stone', tc.tx + 8, tc.ty, 2, 400);
    w.addResource('stone', tc.tx + 8, tc.ty + 3, 2, 400);
    const citizens = w.unitsOf(0).filter((u) => u.role === 'citizen');
    w.issue({ type: 'gather', player: 0, ids: citizens.map((u) => u.id), targetId: a.id });
    for (const u of citizens) expect((u.order as { targetId: number }).targetId).toBe(a.id);
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

  it('miners work right at the edge of the deposit', () => {
    const w = emptyWorld();
    const tc = w.buildingsOf(0, 'towncenter')[0];
    const mine = w.addResource('gold', tc.tx + 8, tc.ty + 1, 2, 800);
    const citizens = w.unitsOf(0).filter((u) => u.role === 'citizen');
    w.issue({ type: 'gather', player: 0, ids: citizens.map((u) => u.id), targetId: mine.id });
    let checked = 0;
    for (let t = 0; t < 40; t++) {
      run(w, 1);
      for (const u of citizens) {
        if (u.order.kind !== 'gather' || u.order.phase !== 'work') continue;
        expect(distToRect(u.x, u.y, rectOf(mine))).toBeLessThanOrEqual(0.35);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('right-click deposit stores the load and sends gatherers back', () => {
    const w = emptyWorld();
    const tc = w.buildingsOf(0, 'towncenter')[0];
    const tree = w.addResource('tree', tc.tx + 9, tc.ty + 1, 1, 400);
    const [c] = w.unitsOf(0).filter((u) => u.role === 'citizen');
    w.issue({ type: 'gather', player: 0, ids: [c.id], targetId: tree.id });
    for (let i = 0; i < 400 && c.carryAmount < 4; i++) w.step();
    const load = c.carryAmount;
    expect(load).toBeGreaterThanOrEqual(4);
    const wood = w.players[0].stock.wood;
    w.issue({ type: 'deposit', player: 0, ids: [c.id], targetId: tc.id });
    expect(c.order.kind).toBe('deposit');
    for (let i = 0; i < 400 && c.order.kind === 'deposit'; i++) w.step();
    expect(w.players[0].stock.wood).toBeCloseTo(wood + load, 5);
    expect(c.order.kind).toBe('gather');
    if (c.order.kind === 'gather') expect(c.order.targetId).toBe(tree.id);

    // Without a previous gather order the citizen just goes idle afterwards.
    c.order = { kind: 'idle' };
    c.carry = 'gold';
    c.carryAmount = 6;
    w.issue({ type: 'deposit', player: 0, ids: [c.id], targetId: tc.id });
    run(w, 15);
    expect(c.order.kind).toBe('idle');
    expect(c.carryAmount).toBe(0);
  });

  it('builders of a storehouse work the nearest deposit of any kind', () => {
    const w = emptyWorld();
    const tc = w.buildingsOf(0, 'towncenter')[0];
    const sx = tc.tx + 12;
    const sy = tc.ty;
    w.addResource('tree', sx + 6, sy, 1, 300);
    const gold = w.addResource('gold', sx + 3, sy, 2, 800);
    const [c] = w.unitsOf(0).filter((u) => u.role === 'citizen');
    w.issue({ type: 'place', player: 0, ids: [c.id], building: 'storehouse', tx: sx, ty: sy });
    run(w, 60);
    expect(w.buildingsOf(0, 'storehouse')[0].built).toBe(true);
    expect(c.order.kind).toBe('gather');
    if (c.order.kind === 'gather') expect(c.order.targetId).toBe(gold.id);
  });

  it('demolishing a construction site refunds what was not built yet', () => {
    const w = emptyWorld();
    const tc = w.buildingsOf(0, 'towncenter')[0];
    const [c] = w.unitsOf(0).filter((u) => u.role === 'citizen');
    const wood = w.players[0].stock.wood;
    w.issue({ type: 'place', player: 0, ids: [c.id], building: 'storehouse', tx: tc.tx + 7, ty: tc.ty });
    const site = w.buildingsOf(0, 'storehouse')[0];
    w.issue({ type: 'destroy', player: 0, ids: [site.id] });
    expect(w.players[0].stock.wood).toBe(wood);

    w.issue({ type: 'place', player: 0, ids: [c.id], building: 'storehouse', tx: tc.tx + 7, ty: tc.ty });
    const second = w.buildingsOf(0, 'storehouse')[0];
    for (let i = 0; i < 2000 && second.progress < 0.4; i++) w.step();
    w.issue({ type: 'destroy', player: 0, ids: [second.id] });
    const back = w.players[0].stock.wood - (wood - 100);
    expect(back).toBeGreaterThan(30);
    expect(back).toBeLessThan(70);
    expect(second.dead).toBe(true);
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
  it('advancing needs the buildings the next epoch asks for', () => {
    const w = emptyWorld();
    const p = w.players[0];
    for (const r of ['food', 'wood', 'stone', 'gold', 'iron'] as const) p.stock[r] = 5000;
    const tc = w.buildingsOf(0, 'towncenter')[0];
    expect(w.missingRequirements(0).map((m) => m.type).sort()).toEqual(['house', 'storehouse']);
    w.issue({ type: 'advance', player: 0, buildingId: tc.id });
    expect(tc.research).toBeNull();
    expect(p.stock.food).toBe(5000);
    // Construction sites do not count, finished buildings do.
    w.addBuilding(0, 'house', tc.tx + 7, tc.ty, false);
    w.addBuilding(0, 'house', tc.tx + 10, tc.ty, true);
    w.addBuilding(0, 'storehouse', tc.tx + 7, tc.ty + 4, true);
    expect(w.missingRequirements(0)).toEqual([{ type: 'house', have: 1, need: 2 }]);
    w.addBuilding(0, 'house', tc.tx + 10, tc.ty + 4, true);
    expect(w.missingRequirements(0)).toEqual([]);
    // Two technologies of the current epoch are needed as well.
    expect(w.missingTechs(0)).toEqual({ have: 0, need: 2 });
    w.issue({ type: 'advance', player: 0, buildingId: tc.id });
    expect(tc.research).toBeNull();
    w.completeTech(0, 'werkzeuge-0');
    w.completeTech(0, 'tragen-0');
    w.issue({ type: 'advance', player: 0, buildingId: tc.id });
    expect(tc.research).not.toBeNull();
  });

  it('advancing costs resources, takes time and unlocks new tiers', () => {
    const w = emptyWorld();
    const p = w.players[0];
    for (const r of ['food', 'wood', 'stone', 'gold', 'iron'] as const) p.stock[r] = 5000;
    const tc = w.buildingsOf(0, 'towncenter')[0];
    w.addBuilding(0, 'house', tc.tx + 7, tc.ty, true);
    w.addBuilding(0, 'house', tc.tx + 10, tc.ty, true);
    w.addBuilding(0, 'storehouse', tc.tx + 7, tc.ty + 4, true);
    w.completeTech(0, 'werkzeuge-0');
    w.completeTech(0, 'tragen-0');
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
