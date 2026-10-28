import { describe, expect, it } from 'vitest';
import { bestTier, TRANSPORT_CAPACITY, type Role } from '../src/data/units';
import type { Unit } from '../src/sim/entities';
import { Terrain } from '../src/sim/map';
import { normalize } from '../src/replay';
import type { Command, World } from '../src/sim/world';
import { emptyWorld, run } from './helpers';

/** Land on the left (x < 20) and right (x > 34), a strait of water in between. */
function strait(): World {
  const w = emptyWorld();
  for (let y = 0; y < 48; y++) for (let x = 20; x <= 34; x++) w.map.terrain[w.map.idx(x, y)] = Terrain.Water;
  w.map.computeRegions();
  w.map.version++;
  for (const u of [...w.units]) w.remove(u);
  w.compact();
  return w;
}

function spawn(w: World, owner: number, role: Role, x: number, y: number, epoch = 9): Unit {
  return w.spawnUnit(owner, role, x, y, Math.max(0, bestTier(role, epoch)));
}

const onWater = (w: World, u: Unit) => w.map.terrainAt(Math.floor(u.x), Math.floor(u.y)) === Terrain.Water;

describe('ships', () => {
  it('sail on water only and stop at the shore when sent inland', () => {
    const w = strait();
    const ship = spawn(w, 0, 'warship', 27.5, 10.5);
    w.issue({ type: 'move', player: 0, ids: [ship.id], x: 8, y: 30, attackMove: false });
    for (let i = 0; i < 20 * 30; i++) {
      w.step();
      expect(onWater(w, ship)).toBe(true);
    }
    expect(ship.x).toBeLessThan(22);
    expect(ship.y).toBeGreaterThan(26);
  });

  it('keep walkers off the water', () => {
    const w = strait();
    const soldier = spawn(w, 0, 'assault', 10.5, 10.5);
    w.issue({ type: 'move', player: 0, ids: [soldier.id], x: 27, y: 10, attackMove: false });
    run(w, 15);
    expect(onWater(w, soldier)).toBe(false);
    expect(soldier.x).toBeGreaterThan(18);
  });

  it('come out of a harbour, which only stands at the shore', () => {
    const w = strait();
    w.players[0].stock.wood = 5000;
    w.players[0].stock.gold = 5000;
    // The first warship (war canoe) comes with the second epoch.
    w.players[0].epoch = 1;
    expect(w.canPlace(0, 'dock', 20, 20)).toBe(true);
    expect(w.canPlace(0, 'dock', 10, 20)).toBe(false);
    expect(w.canPlace(0, 'dock', 26, 20)).toBe(false);
    const dock = w.addBuilding(0, 'dock', 20, 20, true);
    w.issue({ type: 'train', player: 0, buildingId: dock.id, role: 'warship' });
    run(w, 30);
    const ship = w.units.find((u) => u.role === 'warship');
    expect(ship).toBeDefined();
    expect(onWater(w, ship!)).toBe(true);
  });

  it('let fishing boats bring their catch to the harbour, citizens leave fish alone', () => {
    const w = strait();
    const dock = w.addBuilding(0, 'dock', 20, 14, true);
    const fish = w.addResource('fish', 25, 8, 1, 400);
    const boat = spawn(w, 0, 'fisher', 24.5, 15.5, 0);
    const citizen = spawn(w, 0, 'citizen', 18.5, 9.5, 0);
    const before = w.players[0].stats.gathered.food;
    w.issue({ type: 'gather', player: 0, ids: [boat.id, citizen.id], targetId: fish.id });
    expect(citizen.order.kind).not.toBe('gather');
    run(w, 90);
    expect(w.players[0].stats.gathered.food).toBeGreaterThan(before + 20);
    expect(fish.amount).toBeLessThan(400);
    expect(dock.dead).toBe(false);
    expect(onWater(w, boat)).toBe(true);
  });

  it('warships beat bombard ships', () => {
    const w = strait();
    w.players[0].epoch = w.players[1].epoch = 9;
    const warship = spawn(w, 0, 'warship', 24.5, 10.5);
    const bombard = spawn(w, 1, 'bombard', 30.5, 14.5);
    w.issue({ type: 'attack', player: 0, ids: [warship.id], targetId: bombard.id });
    run(w, 60);
    expect(bombard.dead).toBe(true);
    expect(warship.dead).toBe(false);
  });

  it('are hit from the shore by towers and archers, never by swords', () => {
    const w = strait();
    const tower = w.addBuilding(1, 'tower', 36, 10, true);
    const target = spawn(w, 0, 'transport', 33.5, 11.5, 0);
    const sword = spawn(w, 1, 'assault', 19.5, 30.5, 0);
    const bow = spawn(w, 1, 'ranged', 19.5, 25.5, 0);
    const prey = spawn(w, 0, 'transport', 21.5, 25.5, 0);
    w.issue({ type: 'attack', player: 1, ids: [sword.id], targetId: prey.id });
    expect(sword.order.kind).toBe('idle');
    run(w, 6);
    expect(target.hp).toBeLessThan(target.maxHp);
    expect(prey.hp).toBeLessThan(prey.maxHp);
    expect(sword.order.kind === 'attack' && sword.order.targetId === prey.id).toBe(false);
    expect(tower.dead).toBe(false);
    expect(bow.dead).toBe(false);
  });
});

describe('transport ships', () => {
  function ferry(w: World): { ship: Unit; troops: Unit[] } {
    const ship = spawn(w, 0, 'transport', 26.5, 30.5, 0);
    const troops = [0, 1, 2, 3, 4].map((i) => spawn(w, 0, i === 0 ? 'citizen' : 'assault', 12.5 + i, 18.5, 0));
    return { ship, troops };
  }

  it('take units aboard, carry them over and put them ashore', () => {
    const w = strait();
    const { ship, troops } = ferry(w);
    const pop = w.popCount(0);
    w.issue({ type: 'board', player: 0, ids: troops.map((u) => u.id), targetId: ship.id });
    run(w, 25);
    expect(ship.cargo.length).toBe(5);
    expect(troops.every((u) => u.inside === ship.id)).toBe(true);
    expect(w.units).not.toContain(troops[0]);
    expect(w.get(troops[0].id)).toBeUndefined();
    expect(w.popCount(0)).toBe(pop);
    w.issue({ type: 'unload', player: 0, ids: [ship.id], x: 40, y: 20 });
    run(w, 30);
    expect(ship.cargo.length).toBe(0);
    for (const u of troops) {
      expect(u.inside).toBe(0);
      expect(w.units).toContain(u);
      expect(u.x).toBeGreaterThan(34);
      expect(onWater(w, u)).toBe(false);
    }
  });

  it('carry at most their capacity', () => {
    const w = strait();
    const ship = spawn(w, 0, 'transport', 21.5, 18.5, 0);
    const crowd = Array.from({ length: TRANSPORT_CAPACITY + 3 }, (_, i) => spawn(w, 0, 'assault', 10.5 + (i % 6), 14.5 + Math.floor(i / 6), 0));
    w.issue({ type: 'board', player: 0, ids: crowd.map((u) => u.id), targetId: ship.id });
    run(w, 30);
    expect(ship.cargo.length).toBe(TRANSPORT_CAPACITY);
    expect(crowd.filter((u) => u.inside === 0).length).toBe(3);
  });

  it('take their passengers down when sunk', () => {
    const w = strait();
    const { ship, troops } = ferry(w);
    w.issue({ type: 'board', player: 0, ids: troops.map((u) => u.id), targetId: ship.id });
    run(w, 25);
    expect(ship.cargo.length).toBe(5);
    const lost = w.players[0].stats.unitsLost;
    w.kill(ship, 1);
    w.step();
    expect(troops.every((u) => u.dead)).toBe(true);
    expect(w.players[0].stats.unitsLost).toBe(lost + 6);
    expect(w.players[1].stats.kills).toBe(6);
  });

  it('replay from the recorded commands, as over the network', () => {
    const log: Array<[number, Command]> = [];
    const live = strait();
    const { ship, troops } = ferry(live);
    const say = (c: Command) => {
      log.push([live.tick, normalize(c)]);
      live.issue(c);
    };
    say({ type: 'board', player: 0, ids: troops.map((u) => u.id), targetId: ship.id });
    run(live, 20);
    say({ type: 'unload', player: 0, ids: [ship.id], x: 41, y: 30 });
    run(live, 25);
    const copy = strait();
    ferry(copy);
    while (copy.tick < live.tick) {
      for (const [tick, c] of log) if (tick === copy.tick) copy.issue(c);
      copy.step();
    }
    expect(copy.checksum()).toBe(live.checksum());
  });

  it('play out the same way twice', () => {
    const play = () => {
      const w = strait();
      const { ship, troops } = ferry(w);
      w.issue({ type: 'board', player: 0, ids: troops.map((u) => u.id), targetId: ship.id });
      run(w, 20);
      w.issue({ type: 'unload', player: 0, ids: [ship.id], x: 42, y: 12 });
      run(w, 25);
      return w.checksum();
    };
    expect(play()).toBe(play());
  });
});
