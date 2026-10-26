import { describe, expect, it } from 'vitest';
import { EPOCHS } from '../src/data/epochs';
import { TECH_BY_ID } from '../src/data/techs';
import type { World } from '../src/sim/world';
import { MAX_TECH_QUEUE } from '../src/sim/world';
import { emptyWorld, run } from './helpers';

function rich(w: World): void {
  for (const r of ['food', 'wood', 'stone', 'gold', 'iron'] as const) w.players[0].stock[r] = 50000;
}

/** Two levels of one branch, both open in epoch 3. */
const first = 'infwaffen-0';
const second = 'infwaffen-1';

describe('research queues', () => {
  it('queues techs behind the running one, paid up front, the next level after its prerequisite', () => {
    const w = emptyWorld({ startEpoch: 3 });
    rich(w);
    const smithy = w.addBuilding(0, 'smithy', 18, 18, true);
    const food = w.players[0].stock.food;
    w.issue({ type: 'research', player: 0, buildingId: smithy.id, tech: first });
    w.issue({ type: 'research', player: 0, buildingId: smithy.id, tech: second });
    w.issue({ type: 'research', player: 0, buildingId: smithy.id, tech: 'ruestung-0' });
    expect(smithy.tech?.id).toBe(first);
    expect(smithy.techQueue.map((j) => j.id)).toEqual([second, 'ruestung-0']);
    const paid = [first, second, 'ruestung-0'].reduce((s, id) => s + (TECH_BY_ID.get(id)!.cost.food ?? 0), 0);
    expect(w.players[0].stock.food).toBe(food - paid);
    // Queued techs are taken: nobody (the AI included) starts them twice.
    expect(w.techAvailable(0, TECH_BY_ID.get(second)!)).toBe(false);

    run(w, TECH_BY_ID.get(first)!.time + 1);
    expect(w.players[0].techs.has(first)).toBe(true);
    expect(smithy.tech?.id).toBe(second);
    run(w, TECH_BY_ID.get(second)!.time + TECH_BY_ID.get('ruestung-0')!.time + 2);
    expect([first, second, 'ruestung-0'].every((id) => w.players[0].techs.has(id))).toBe(true);
    expect(smithy.tech).toBeNull();
  });

  it('refuses a full queue without taking resources', () => {
    const w = emptyWorld({ startEpoch: 8 });
    rich(w);
    const academy = w.addBuilding(0, 'academy', 18, 18, true);
    const ids = ['baukunst-0', 'mauerwerk-0', 'mathematik-0', 'medizin-0', 'schrift-0', 'kartografie-0', 'staatskunst-0'].filter((id) => TECH_BY_ID.has(id));
    for (const id of ids) w.issue({ type: 'research', player: 0, buildingId: academy.id, tech: id });
    expect(academy.techQueue).toHaveLength(MAX_TECH_QUEUE);
    const left = ids.slice(1 + MAX_TECH_QUEUE);
    expect(left.length).toBeGreaterThan(0);
    for (const id of left) expect(w.plannedTechs(0).has(id)).toBe(false);
  });

  it('cancelling a tech refunds it and drops queued techs that needed it, in every building', () => {
    const w = emptyWorld({ startEpoch: 3 });
    rich(w);
    const a = w.addBuilding(0, 'smithy', 14, 18, true);
    const b = w.addBuilding(0, 'smithy', 20, 18, true);
    const before = { ...w.players[0].stock };
    w.issue({ type: 'research', player: 0, buildingId: a.id, tech: first });
    w.issue({ type: 'research', player: 0, buildingId: b.id, tech: 'ruestung-0' });
    // The next level waits in the other smithy for the first one.
    w.issue({ type: 'research', player: 0, buildingId: b.id, tech: second });
    expect(b.techQueue.map((j) => j.id)).toEqual([second]);
    w.issue({ type: 'cancelTech', player: 0, buildingId: a.id });
    expect(a.tech).toBeNull();
    expect(b.techQueue).toHaveLength(0);
    // Only the tech still running is paid for.
    const ruestung = TECH_BY_ID.get('ruestung-0')!.cost;
    for (const r of ['food', 'wood', 'stone', 'gold', 'iron'] as const) expect(w.players[0].stock[r]).toBe(before[r] - (ruestung[r] ?? 0));
  });

  it('cancels a waiting tech by its place in the queue', () => {
    const w = emptyWorld({ startEpoch: 3 });
    rich(w);
    const s = w.addBuilding(0, 'smithy', 18, 18, true);
    w.issue({ type: 'research', player: 0, buildingId: s.id, tech: first });
    w.issue({ type: 'research', player: 0, buildingId: s.id, tech: 'ruestung-0' });
    w.issue({ type: 'research', player: 0, buildingId: s.id, tech: 'fernwaffen-0' });
    w.issue({ type: 'cancelTech', player: 0, buildingId: s.id, index: 0 });
    expect(s.tech?.id).toBe(first);
    expect(s.techQueue.map((j) => j.id)).toEqual(['fernwaffen-0']);
  });

  it('a destroyed smithy takes its research along and frees what waited for it', () => {
    const w = emptyWorld({ startEpoch: 3 });
    rich(w);
    const a = w.addBuilding(0, 'smithy', 14, 18, true);
    const b = w.addBuilding(0, 'smithy', 20, 18, true);
    w.issue({ type: 'research', player: 0, buildingId: a.id, tech: first });
    w.issue({ type: 'research', player: 0, buildingId: b.id, tech: second });
    expect(b.techQueue).toHaveLength(1);
    w.kill(a, 1);
    expect(b.techQueue).toHaveLength(0);
    expect(w.techAvailable(0, TECH_BY_ID.get(first)!)).toBe(true);
  });
});

describe('epoch advance in the queue', () => {
  function ready(): World {
    const w = emptyWorld({ startResources: 'high' });
    rich(w);
    const tc = w.buildingsOf(0, 'towncenter')[0];
    w.addBuilding(0, 'house', tc.tx + 7, tc.ty, true);
    w.addBuilding(0, 'house', tc.tx + 10, tc.ty, true);
    w.addBuilding(0, 'storehouse', tc.tx + 7, tc.ty + 4, true);
    w.completeTech(0, 'werkzeuge-0');
    w.completeTech(0, 'tragen-0');
    return w;
  }

  it('waits for the units queued before it; units queued after it wait for the new epoch', () => {
    const w = ready();
    const tc = w.buildingsOf(0, 'towncenter')[0];
    w.issue({ type: 'train', player: 0, buildingId: tc.id, role: 'citizen', count: 2 });
    w.issue({ type: 'advance', player: 0, buildingId: tc.id });
    w.issue({ type: 'train', player: 0, buildingId: tc.id, role: 'citizen' });
    expect(tc.research).toBeNull();
    expect(tc.pendingAdvance).toEqual({ targetEpoch: 1, ahead: 2 });
    expect(w.isResearching(0)).toBe(true);
    const citizens = () => w.units.filter((u) => u.owner === 0 && u.role === 'citizen').length;
    const start = citizens();
    run(w, 30);
    // Two trained, then the advance started; the third citizen waits.
    expect(citizens()).toBe(start + 2);
    expect(tc.research?.targetEpoch).toBe(1);
    run(w, EPOCHS[1].advanceTime + 1);
    expect(w.players[0].epoch).toBe(1);
    run(w, 20);
    expect(citizens()).toBe(start + 3);
  });

  it('cancelling a unit ahead moves the advance up, cancelling the advance refunds it', () => {
    const w = ready();
    const tc = w.buildingsOf(0, 'towncenter')[0];
    w.issue({ type: 'train', player: 0, buildingId: tc.id, role: 'citizen', count: 2 });
    const food = w.players[0].stock.food;
    const unitFood = tc.queue[1].cost.food ?? 0;
    w.issue({ type: 'advance', player: 0, buildingId: tc.id });
    w.issue({ type: 'cancel', player: 0, buildingId: tc.id, index: 1 });
    expect(tc.pendingAdvance?.ahead).toBe(1);
    w.issue({ type: 'cancel', player: 0, buildingId: tc.id, index: -1 });
    expect(tc.pendingAdvance).toBeNull();
    // Back to where we were, plus the cancelled unit.
    expect(w.players[0].stock.food).toBe(food + unitFood);
  });

  it('starts at once when nothing is queued', () => {
    const w = ready();
    const tc = w.buildingsOf(0, 'towncenter')[0];
    w.issue({ type: 'advance', player: 0, buildingId: tc.id });
    expect(tc.research).not.toBeNull();
    expect(tc.pendingAdvance).toBeNull();
  });
});
