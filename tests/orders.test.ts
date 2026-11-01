import { describe, expect, it } from 'vitest';
import type { Unit } from '../src/sim/entities';
import { arrivalPace, formationSlots, FORMATIONS, MIN_PACE, type Formation, type Member } from '../src/sim/formation';
import type { World } from '../src/sim/world';
import { emptyWorld, run } from './helpers';

// The test world has town centres at (10, 7) and (35, 33); the fights below stay clear of both.

function army(infantry: number, archers: number, siege = 0): Member[] {
  const out: Member[] = [];
  let id = 1;
  for (let i = 0; i < infantry; i++) out.push({ id: id++, role: 'assault', x: i, y: 0 });
  for (let i = 0; i < archers; i++) out.push({ id: id++, role: 'ranged', x: i, y: 1 });
  for (let i = 0; i < siege; i++) out.push({ id: id++, role: 'siege', x: i, y: 2 });
  return out;
}

/** How far a slot lies towards the front (positive) or the back. */
const ahead = (p: { x: number; y: number }, facing: number) => p.x * Math.cos(facing) + p.y * Math.sin(facing);

describe('formation geometry', () => {
  it.each(FORMATIONS)('%s gives every unit its own slot with room to stand', (kind) => {
    const members = army(9, 6, 2);
    const slots = formationSlots(members, kind, 20, 20, 0.7);
    expect(new Set(slots.map((s) => s.id)).size).toBe(members.length);
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        expect(Math.hypot(slots[i].x - slots[j].x, slots[i].y - slots[j].y)).toBeGreaterThan(0.85);
      }
    }
    // Centred on the target.
    const cx = slots.reduce((s, p) => s + p.x, 0) / slots.length;
    const cy = slots.reduce((s, p) => s + p.y, 0) / slots.length;
    expect(Math.hypot(cx - 20, cy - 20)).toBeLessThan(2);
  });

  it.each(FORMATIONS)('%s puts infantry in front, archers behind and siege at the back', (kind) => {
    for (const facing of [0, Math.PI / 2, -2.4]) {
      const members = army(8, 5, 2);
      const slots = formationSlots(members, kind, 0, 0, facing);
      const of = (role: string) => slots.filter((s) => members.find((m) => m.id === s.id)!.role === role).map((s) => ahead(s, facing));
      expect(Math.min(...of('assault'))).toBeGreaterThan(Math.max(...of('ranged')));
      expect(Math.min(...of('ranged'))).toBeGreaterThan(Math.max(...of('siege')));
    }
  });

  it('shapes: the line is wide, the block square, the wedge has a single tip', () => {
    const members = army(16, 0);
    const extent = (kind: Formation) => {
      const slots = formationSlots(members, kind, 0, 0, 0);
      const front = slots.map((s) => s.x);
      const side = slots.map((s) => s.y);
      return { depth: Math.max(...front) - Math.min(...front), width: Math.max(...side) - Math.min(...side), slots };
    };
    const line = extent('line');
    expect(line.width).toBeGreaterThan(line.depth * 3);
    const block = extent('block');
    expect(block.width).toBeCloseTo(block.depth, 5);
    const wedge = extent('wedge');
    const tip = Math.max(...wedge.slots.map((s) => s.x));
    expect(wedge.slots.filter((s) => s.x > tip - 0.1)).toHaveLength(1);
  });

  it('keeps units on their side so paths do not cross', () => {
    // Facing +x, the left is -y... members spread along y keep their order.
    const members: Member[] = [0, 1, 2, 3, 4].map((i) => ({ id: i + 1, role: 'assault', x: 0, y: i * 2 }));
    const slots = formationSlots(members, 'line', 10, 4, 0);
    const y = (id: number) => slots.find((s) => s.id === id)!.y;
    for (let i = 1; i < 5; i++) expect(y(i + 1)).toBeGreaterThan(y(i));
  });

  it('paces a group at its slowest member so all arrive together', () => {
    const from = [
      { id: 1, x: 0, y: 0, speed: 1.75 },
      { id: 2, x: 0, y: 1, speed: 2.8 },
      { id: 3, x: 6, y: 0, speed: 1.6 },
    ];
    const to = [
      { x: 20, y: 0 },
      { x: 20, y: 1 },
      { x: 7, y: 0 },
    ];
    const pace = arrivalPace(from, to);
    const time = (i: number) => Math.hypot(to[i].x - from[i].x, to[i].y - from[i].y) / pace.get(from[i].id)!;
    expect(time(1)).toBeCloseTo(time(0), 5);
    // The slowest (1.6) sets the pace: the riders do not run ahead of it.
    expect(pace.get(1)!).toBeCloseTo(1.6);
    expect(pace.get(2)!).toBeCloseTo(1.6);
    // A unit already close only slows down so far.
    expect(pace.get(3)).toBeCloseTo(1.6 * MIN_PACE);
    for (const m of from) expect(pace.get(m.id)!).toBeLessThanOrEqual(1.6);
  });
});

/** Ticks until each unit has stopped walking. */
function arrivals(w: World, units: Unit[], seconds: number): Map<number, number> {
  const done = new Map<number, number>();
  for (let t = 0; t < seconds * 20; t++) {
    w.step();
    for (const u of units) if (!done.has(u.id) && u.order.kind === 'idle') done.set(u.id, t);
  }
  return done;
}

describe('marching', () => {
  it('a mixed group arrives together instead of the riders running ahead', () => {
    const w = emptyWorld();
    const units = [0, 1, 2].flatMap((i) => [w.spawnUnit(0, 'assault', 4, 18 + i * 1.5), w.spawnUnit(0, 'mounted', 5.5, 18 + i * 1.5)]);
    w.issue({ type: 'move', player: 0, ids: units.map((u) => u.id), x: 24, y: 21 });
    const t = arrivals(w, units, 30);
    expect(t.size).toBe(units.length);
    const times = [...t.values()];
    // Within 1.5 s on a 12 s march (paths and pushing make up the rest).
    expect(Math.max(...times) - Math.min(...times)).toBeLessThan(30);
    // On their own the riders would have been there much earlier.
    const solo = emptyWorld();
    const rider = solo.spawnUnit(0, 'mounted', 5.5, 18);
    solo.issue({ type: 'move', player: 0, ids: [rider.id], x: 24, y: 20 });
    const alone = arrivals(solo, [rider], 30).get(rider.id)!;
    expect(Math.min(...times)).toBeGreaterThan(alone * 1.3);
  });

  it('siege engines set the pace: in step nobody is faster than the catapult', () => {
    const w = emptyWorld({ startEpoch: 3 });
    // The catapult has the shorter way: by time alone the riders would hurry.
    const siege = w.spawnUnit(0, 'siege', 16, 20);
    const riders = [0, 1, 2].map((i) => w.spawnUnit(0, 'mounted', 4 + i, 18));
    const foot = [0, 1, 2].map((i) => w.spawnUnit(0, 'assault', 4 + i, 22));
    const group = [siege, ...riders, ...foot];
    expect(riders[0].stats.speed).toBeGreaterThan(siege.stats.speed * 1.5);
    w.issue({ type: 'move', player: 0, ids: group.map((u) => u.id), x: 34, y: 20 });
    let fastest = 0;
    for (let t = 0; t < 20 * 30; t++) {
      const before = group.map((u) => [u.x, u.y]);
      w.step();
      group.forEach((u, i) => {
        if (u.order.kind === 'move') fastest = Math.max(fastest, Math.hypot(u.x - before[i][0], u.y - before[i][1]) * 20);
      });
    }
    // A little pushing in the crowd aside, nobody outruns the siege engine.
    expect(fastest).toBeLessThan(siege.stats.speed * 1.15);
  });

  it('an attack-move keeps the group pace in the fight and after it', () => {
    const w = emptyWorld({ startEpoch: 3 });
    const siege = w.spawnUnit(0, 'siege', 6, 20);
    const rider = w.spawnUnit(0, 'mounted', 6, 22);
    const foe = w.spawnUnit(1, 'citizen', 18, 22);
    w.issue({ type: 'move', player: 0, ids: [siege.id, rider.id], x: 36, y: 21, attackMove: true });
    let attacked = false;
    for (let t = 0; t < 20 * 30 && !foe.dead; t++) {
      w.step();
      if (rider.order.kind === 'attack') {
        attacked = true;
        const o = rider.order;
        // Closing in at the group's pace until the last few tiles.
        if (Math.hypot(foe.x - rider.x, foe.y - rider.y) > rider.stats.range + 4) expect(o.pace).toBeDefined();
        expect(o.resume?.kind === 'move' && o.resume.pace).toBeTruthy();
      }
    }
    expect(attacked).toBe(true);
    // Back on the march: still in step.
    for (let t = 0; t < 40 && rider.order.kind !== 'move'; t++) w.step();
    expect(rider.order.kind === 'move' && rider.order.pace).toBeLessThanOrEqual(siege.stats.speed);
  });

  it('when the target falls first, the others go on to where it fell', () => {
    const w = emptyWorld();
    const foe = w.spawnUnit(1, 'citizen', 20, 20);
    // One arrow is enough: it falls long before the swordsmen get there.
    foe.hp = 1;
    const near = w.spawnUnit(0, 'ranged', 15, 20);
    const far = [0, 1, 2].map((i) => w.spawnUnit(0, 'assault', 4, 18 + i * 2));
    w.issue({ type: 'attack', player: 0, ids: [near.id, ...far.map((u) => u.id)], targetId: foe.id });
    for (let t = 0; t < 20 * 20 && !foe.dead; t++) w.step();
    expect(foe.dead).toBe(true);
    w.step();
    for (const u of far) {
      expect(u.order.kind).toBe('move');
      if (u.order.kind === 'move') {
        expect(u.order.attackMove).toBe(true);
        expect(Math.hypot(u.order.x - foe.x, u.order.y - foe.y)).toBeLessThan(0.5);
      }
    }
    run(w, 15);
    for (const u of far) expect(Math.hypot(u.x - foe.x, u.y - foe.y)).toBeLessThan(3);
  });

  it('a right-drag facing turns the front, archers end up behind', () => {
    const w = emptyWorld();
    const infantry = [0, 1, 2, 3].map((i) => w.spawnUnit(0, 'assault', 8 + i, 20));
    const archers = [0, 1, 2, 3].map((i) => w.spawnUnit(0, 'ranged', 8 + i, 21));
    const ids = [...infantry, ...archers].map((u) => u.id);
    // Walk east but face south (+y).
    w.issue({ type: 'move', player: 0, ids, x: 20, y: 20, facing: Math.PI / 2 });
    run(w, 15);
    const meanY = (us: Unit[]) => us.reduce((s, u) => s + u.y, 0) / us.length;
    expect(meanY(infantry)).toBeGreaterThan(meanY(archers) + 0.5);
  });

  it('the formation command re-forms an idle group on the spot', () => {
    const w = emptyWorld();
    const units = [0, 1, 2, 3, 4, 5].map((i) => w.spawnUnit(0, 'pike', 15 + (i % 3), 20 + Math.floor(i / 3)));
    w.issue({ type: 'formation', player: 0, ids: units.map((u) => u.id), formation: 'line' });
    expect(units.every((u) => u.formation === 'line')).toBe(true);
    run(w, 8);
    // Six pikes in a line: a single row.
    const spread = Math.max(...units.flatMap((a) => units.map((b) => Math.hypot(a.x - b.x, a.y - b.y))));
    expect(spread).toBeGreaterThan(3.5);
  });
});

describe('command queues', () => {
  it('walks queued waypoints in order', () => {
    const w = emptyWorld();
    const u = w.spawnUnit(0, 'scout', 6, 20);
    const points = [
      { x: 14, y: 20 },
      { x: 14, y: 27 },
      { x: 6, y: 27 },
    ];
    w.issue({ type: 'move', player: 0, ids: [u.id], ...points[0] });
    w.issue({ type: 'move', player: 0, ids: [u.id], ...points[1], queue: true });
    w.issue({ type: 'move', player: 0, ids: [u.id], ...points[2], queue: true });
    expect(u.queue).toHaveLength(2);
    const reached: number[] = [];
    for (let t = 0; t < 20 * 20; t++) {
      w.step();
      points.forEach((p, i) => {
        if (!reached.includes(i) && Math.hypot(u.x - p.x, u.y - p.y) < 0.5) reached.push(i);
      });
    }
    expect(reached).toEqual([0, 1, 2]);
    expect(u.order.kind).toBe('idle');
  });

  it('a new order without Shift replaces the queue, Halt clears it', () => {
    const w = emptyWorld();
    const u = w.spawnUnit(0, 'assault', 6, 20);
    w.issue({ type: 'move', player: 0, ids: [u.id], x: 20, y: 20 });
    w.issue({ type: 'move', player: 0, ids: [u.id], x: 20, y: 26, queue: true });
    w.issue({ type: 'move', player: 0, ids: [u.id], x: 8, y: 26 });
    expect(u.queue).toHaveLength(0);
    w.issue({ type: 'move', player: 0, ids: [u.id], x: 20, y: 26, queue: true });
    expect(u.queue).toHaveLength(1);
    w.issue({ type: 'stop', player: 0, ids: [u.id] });
    expect(u.queue).toHaveLength(0);
    expect(u.order.kind).toBe('idle');
  });

  it('Shift-placed buildings are built one after the other, even by gatherers', () => {
    const w = emptyWorld();
    const tree = w.addResource('tree', 20, 16, 1, 400);
    const c = w.spawnUnit(0, 'citizen', 19, 17);
    w.issue({ type: 'gather', player: 0, ids: [c.id], targetId: tree.id });
    run(w, 3);
    w.issue({ type: 'place', player: 0, ids: [c.id], building: 'house', tx: 16, ty: 20, queue: true });
    w.issue({ type: 'place', player: 0, ids: [c.id], building: 'house', tx: 22, ty: 22, queue: true });
    // Gathering never ends, so the first job starts at once; the second waits.
    expect(c.order.kind).toBe('build');
    expect(c.queue).toHaveLength(1);
    const [first, second] = w.buildingsOf(0, 'house');
    let overlap = false;
    for (let t = 0; t < 120 * 20; t++) {
      w.step();
      if (first.progress < 1 && second.progress > 0) overlap = true;
    }
    expect(overlap).toBe(false);
    expect(first.built && second.built).toBe(true);
  });

  it('queued wall segments are worked off by the whole crew', () => {
    const w = emptyWorld({ startEpoch: 1, startResources: 'high' });
    const crew = [0, 1].map((i) => w.spawnUnit(0, 'citizen', 16 + i, 18));
    const tiles = [16, 17, 18, 19].map((x) => ({ x, y: 22 }));
    w.issue({ type: 'move', player: 0, ids: crew.map((u) => u.id), x: 24, y: 18 });
    w.issue({ type: 'placeLine', player: 0, ids: crew.map((u) => u.id), building: 'wall', tiles, queue: true });
    expect(crew.every((u) => u.queue.length === 4)).toBe(true);
    run(w, 90);
    expect(w.buildingsOf(0, 'wall').filter((b) => b.built)).toHaveLength(4);
  });
});

describe('patrol', () => {
  it('walks the round, fights what it meets and goes on', () => {
    const w = emptyWorld({ startEpoch: 4 });
    const guard = w.spawnUnit(0, 'assault', 6, 22);
    w.issue({ type: 'patrol', player: 0, ids: [guard.id], x: 22, y: 22 });
    w.issue({ type: 'patrol', player: 0, ids: [guard.id], x: 14, y: 28, queue: true });
    expect(guard.order.kind).toBe('patrol');
    if (guard.order.kind === 'patrol') expect(guard.order.points).toHaveLength(3);
    let visits = 0;
    let near = false;
    for (let t = 0; t < 60 * 20; t++) {
      w.step();
      const d = Math.hypot(guard.x - 22, guard.y - 22);
      if (d < 1 && !near) visits++;
      near = d < 1;
    }
    expect(visits).toBeGreaterThanOrEqual(2);

    const foe = w.spawnUnit(1, 'citizen', 20, 22);
    run(w, 40);
    expect(w.get(foe.id)).toBeUndefined();
    run(w, 2);
    expect(['patrol', 'attack']).toContain(guard.order.kind);
  });
});

describe('rally chains', () => {
  it('sends new units along every waypoint to the last one', () => {
    const w = emptyWorld({ startResources: 'high' });
    const barracks = w.addBuilding(0, 'barracks', 14, 16, true);
    const via = { x: 24, y: 18 };
    const end = { x: 24, y: 26 };
    w.issue({ type: 'rally', player: 0, buildingId: barracks.id, ...via });
    w.issue({ type: 'rally', player: 0, buildingId: barracks.id, ...end, queue: true });
    expect(barracks.rally).toEqual([via, end]);
    w.issue({ type: 'train', player: 0, buildingId: barracks.id, role: 'assault' });
    let soldier: Unit | undefined;
    let passed = false;
    for (let t = 0; t < 60 * 20; t++) {
      w.step();
      soldier ??= w.units.find((u) => u.owner === 0 && u.role === 'assault');
      if (soldier && Math.hypot(soldier.x - via.x, soldier.y - via.y) < 1) passed = true;
    }
    expect(passed).toBe(true);
    expect(Math.hypot(soldier!.x - end.x, soldier!.y - end.y)).toBeLessThan(1);
    // A plain right click starts a new chain.
    w.issue({ type: 'rally', player: 0, buildingId: barracks.id, x: 18, y: 24 });
    expect(barracks.rally).toEqual([{ x: 18, y: 24 }]);
  });
});
