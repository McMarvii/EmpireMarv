import { describe, expect, it } from 'vitest';
import { bestTier, type Role } from '../src/data/units';
import { normalize } from '../src/replay';
import type { Unit } from '../src/sim/entities';
import { Terrain } from '../src/sim/map';
import { restoreWorld } from '../src/sim/setup';
import { decodeState, encodeState } from '../src/sim/snapshot';
import type { Command, World, WorldSnapshot } from '../src/sim/world';
import { emptyWorld, run } from './helpers';

/** Land on the left (x < 20) and right (x > 34), a strait of water in between; both sides in the world wars. */
function strait(epoch = 13): World {
  const w = emptyWorld();
  for (let y = 0; y < 48; y++) for (let x = 20; x <= 34; x++) w.map.terrain[w.map.idx(x, y)] = Terrain.Water;
  w.map.computeRegions();
  w.map.version++;
  for (const u of [...w.units]) w.remove(u);
  // No town centers shooting into the tests: a hut in a far corner keeps each empire alive.
  for (const b of [...w.buildings]) w.remove(b);
  w.compact();
  w.addBuilding(0, 'house', 0, 46, true);
  w.addBuilding(1, 'house', 46, 0, true);
  w.players[0].epoch = w.players[1].epoch = epoch;
  w.players[0].stock.wood = w.players[0].stock.gold = w.players[0].stock.iron = w.players[0].stock.stone = 9000;
  return w;
}

function spawn(w: World, owner: number, role: Role, x: number, y: number): Unit {
  return w.spawnUnit(owner, role, x, y, Math.max(0, bestTier(role, w.players[owner].epoch)));
}

describe('aircraft', () => {
  it('fly straight over water, woods and buildings', () => {
    const w = strait();
    w.addBuilding(1, 'barracks', 26, 18, true);
    for (let x = 12; x < 18; x++) w.addResource('tree', x, 19, 1, 100);
    const plane = spawn(w, 0, 'fighter', 6.5, 20.5);
    w.issue({ type: 'move', player: 0, ids: [plane.id], x: 44, y: 20.5 });
    let maxOff = 0;
    for (let i = 0; i < 20 * 12; i++) {
      w.step();
      maxOff = Math.max(maxOff, Math.abs(plane.y - 20.5));
    }
    expect(plane.x).toBeGreaterThan(43);
    // Straight across: no detour round the trees, the strait or the barracks.
    expect(maxOff).toBeLessThan(0.3);
  });

  it('can only be hit by anti-aircraft: fighters, anti-tank troops and towers from the world wars on', () => {
    const w = strait();
    const plane = spawn(w, 1, 'fighter', 10.5, 10.5);
    const rifle = spawn(w, 0, 'ranged', 13.5, 10.5);
    const trooper = spawn(w, 0, 'assault', 12.5, 12.5);
    w.issue({ type: 'attack', player: 0, ids: [rifle.id, trooper.id], targetId: plane.id });
    expect(rifle.order.kind).toBe('idle');
    expect(trooper.order.kind).toBe('idle');
    const flak = spawn(w, 0, 'pike', 13.5, 8.5);
    w.issue({ type: 'attack', player: 0, ids: [flak.id], targetId: plane.id });
    expect(flak.order.kind).toBe('attack');
    run(w, 4);
    expect(plane.hp).toBeLessThan(plane.maxHp);

    // A tower built before the world wars does not reach planes, one built after does.
    const v = strait(12);
    const tower = v.addBuilding(0, 'tower', 8, 30, true);
    const bomber = v.spawnUnit(1, 'bomber', 9.5, 33.5, 0);
    run(v, 4);
    expect(bomber.hp).toBe(bomber.maxHp);
    v.remove(tower);
    v.players[0].epoch = 13;
    v.addBuilding(0, 'tower', 8, 30, true);
    run(v, 4);
    expect(bomber.hp).toBeLessThan(bomber.maxHp);
  });

  it('balloons fly low: any gun and tower hits them, swords do not', () => {
    const w = strait(11);
    const balloon = spawn(w, 1, 'balloon', 10.5, 10.5);
    const sword = w.spawnUnit(0, 'assault', 11.5, 11.5, bestTier('assault', 9));
    w.issue({ type: 'attack', player: 0, ids: [sword.id], targetId: balloon.id });
    expect(sword.order.kind).toBe('idle');
    const musket = spawn(w, 0, 'ranged', 14.5, 10.5);
    w.issue({ type: 'attack', player: 0, ids: [musket.id], targetId: balloon.id });
    run(w, 4);
    expect(balloon.hp).toBeLessThan(balloon.maxHp);
    const other = spawn(w, 1, 'balloon', 10.5, 30.5);
    w.addBuilding(0, 'tower', 8, 28, true);
    run(w, 4);
    expect(other.hp).toBeLessThan(other.maxHp);
  });

  it('are not hurt by blasts on the ground', () => {
    const w = strait();
    const target = w.addBuilding(1, 'house', 10, 10, true);
    const balloon = w.spawnUnit(1, 'balloon', 11, 11, 0);
    const gun = spawn(w, 0, 'siege', 10.5, 17.5);
    w.issue({ type: 'attack', player: 0, ids: [gun.id], targetId: target.id });
    run(w, 15);
    expect(target.hp).toBeLessThan(target.maxHp);
    expect(balloon.hp).toBe(balloon.maxHp);
  });

  it('bombers drop their load, fly home to reload and come back to finish the job', () => {
    const w = strait();
    const field = w.addBuilding(0, 'airfield', 4, 18, true);
    const house = w.addBuilding(1, 'house', 40, 20, true);
    const bomber = w.spawnUnit(0, 'bomber', field.x, field.y, 0);
    const load = bomber.stats.bombs;
    expect(bomber.ammo).toBe(load);
    w.issue({ type: 'attack', player: 0, ids: [bomber.id], targetId: house.id });
    let wentHome = false;
    let reloaded = false;
    for (let i = 0; i < 20 * 120 && !house.dead; i++) {
      w.step();
      if (bomber.order.kind === 'refuel') wentHome = true;
      if (wentHome && bomber.ammo === load) reloaded = true;
    }
    expect(wentHome).toBe(true);
    expect(reloaded).toBe(true);
    expect(house.dead).toBe(true);
    expect(bomber.dead).toBe(false);
  });

  it('turn for home with an empty tank and fight no more until refuelled', () => {
    const w = strait();
    const field = w.addBuilding(0, 'airfield', 4, 18, true);
    const flak = spawn(w, 1, 'pike', 40.5, 20.5);
    const plane = w.spawnUnit(0, 'fighter', 38.5, 20.5, 0);
    plane.fuel = 0.5;
    w.issue({ type: 'attack', player: 0, ids: [plane.id], targetId: flak.id });
    run(w, 1);
    expect(plane.order.kind).toBe('refuel');
    const hp = flak.hp;
    // An order on the way home waits until the plane is back in the air.
    w.issue({ type: 'attack', player: 0, ids: [plane.id], targetId: flak.id });
    let back = false;
    for (let i = 0; i < 20 * 60 && !back; i++) {
      w.step();
      if (plane.order.kind === 'attack') back = true;
      else expect(flak.hp).toBe(hp);
    }
    expect(back).toBe(true);
    expect(plane.fuel).toBeGreaterThan(plane.stats.fuel * 0.8);
    expect(Math.abs(plane.x - field.x)).toBeLessThan(4);
    run(w, 15);
    expect(flak.hp).toBeLessThan(hp);
  });

  it('wait unable to fight without an airfield, then fly to the first one built', () => {
    const w = strait();
    const enemy = spawn(w, 1, 'ranged', 12.5, 12.5);
    const plane = w.spawnUnit(0, 'fighter', 10.5, 10.5, 0);
    plane.fuel = 0;
    run(w, 3);
    expect(plane.order.kind).toBe('refuel');
    expect(w.events.some((e) => e.type === 'warn' && e.text.includes('Flugplatz'))).toBe(true);
    expect(plane.x).toBeCloseTo(10.5, 1);
    expect(enemy.hp).toBe(enemy.maxHp);
    const field = w.addBuilding(0, 'airfield', 30, 36, true);
    run(w, 20);
    expect(plane.fuel).toBe(plane.stats.fuel);
    expect(Math.hypot(plane.x - field.x, plane.y - field.y)).toBeLessThan(3);
  });

  it('carry more fuel with the Reichweite research', () => {
    const w = strait();
    const old = spawn(w, 0, 'fighter', 10.5, 10.5);
    const base = old.stats.fuel;
    w.completeTech(0, 'reichweite-0');
    expect(old.stats.fuel).toBeCloseTo(base * 1.15);
    expect(spawn(w, 0, 'fighter', 11.5, 10.5).fuel).toBeCloseTo(base * 1.15);
    // Bordwaffen: one bomb more per sortie.
    w.completeTech(0, 'bordwaffen-0');
    expect(spawn(w, 0, 'bomber', 12.5, 10.5).ammo).toBe(5);
  });

  it('fighters shoot down bombers, flak troops hold off a bomber raid', () => {
    const w = strait();
    const fighters = [0, 1, 2].map((i) => spawn(w, 0, 'fighter', 8.5, 8.5 + i));
    const bombers = [0, 1, 2].map((i) => spawn(w, 1, 'bomber', 14.5, 8.5 + i));
    w.issue({ type: 'attack', player: 0, ids: fighters.map((u) => u.id), targetId: bombers[0].id });
    run(w, 30);
    expect(bombers.every((u) => u.dead)).toBe(true);
    expect(fighters.every((u) => !u.dead)).toBe(true);

    const v = strait();
    const flak = [0, 1, 2, 3].map((i) => spawn(v, 0, 'pike', 10.5 + (i % 2), 30.5 + Math.floor(i / 2)));
    const raid = [0, 1].map((i) => spawn(v, 1, 'bomber', 10.5 + i, 40.5));
    v.issue({ type: 'attack', player: 1, ids: raid.map((u) => u.id), targetId: flak[0].id });
    run(v, 40);
    expect(raid.every((u) => u.dead)).toBe(true);
    expect(flak.filter((u) => !u.dead).length).toBeGreaterThanOrEqual(2);
  });

  it('stay out of transports and are not converted', () => {
    const w = strait(14);
    const ship = spawn(w, 0, 'transport', 21.5, 18.5);
    const plane = spawn(w, 0, 'fighter', 18.5, 18.5);
    const soldier = spawn(w, 0, 'assault', 18.5, 16.5);
    w.issue({ type: 'board', player: 0, ids: [plane.id, soldier.id], targetId: ship.id });
    expect(plane.order.kind).not.toBe('board');
    expect(soldier.order.kind).toBe('board');
    const priest = spawn(w, 1, 'priest', 15.5, 18.5);
    priest.faith = 100;
    w.issue({ type: 'convert', player: 1, ids: [priest.id], targetId: plane.id });
    expect(priest.order.kind).toBe('idle');
  });

  it('replay from the recorded commands, refuelling included', () => {
    const play = (record: Array<[number, Command]> | null) => {
      const w = strait();
      const field = w.addBuilding(0, 'airfield', 4, 18, true);
      const house = w.addBuilding(1, 'house', 40, 20, true);
      const bomber = w.spawnUnit(0, 'bomber', field.x, field.y, 0);
      const fighter = w.spawnUnit(0, 'fighter', field.x + 1, field.y, 0);
      const flak = spawn(w, 1, 'pike', 41.5, 24.5);
      const log: Array<[number, Command]> = [];
      const say = (c: Command) => {
        log.push([w.tick, normalize(c)]);
        w.issue(c);
      };
      if (record) {
        while (w.tick < 20 * 70 && !w.over) {
          for (const [tick, c] of record) if (tick === w.tick) w.issue(c);
          w.step();
        }
        return { sum: w.checksum(), log };
      }
      say({ type: 'attack', player: 0, ids: [bomber.id], targetId: house.id });
      say({ type: 'attack', player: 0, ids: [fighter.id], targetId: flak.id });
      run(w, 20);
      say({ type: 'refuel', player: 0, ids: [fighter.id], targetId: field.id });
      while (w.tick < 20 * 70 && !w.over) w.step();
      return { sum: w.checksum(), log };
    };
    const live = play(null);
    expect(play(live.log).sum).toBe(live.sum);
  });

  it('continue from a saved game in mid-flight exactly as before', () => {
    const w = strait();
    const field = w.addBuilding(0, 'airfield', 4, 18, true);
    const house = w.addBuilding(1, 'house', 40, 20, true);
    const bomber = w.spawnUnit(0, 'bomber', field.x, field.y, 0);
    w.issue({ type: 'attack', player: 0, ids: [bomber.id], targetId: house.id });
    run(w, 25);
    const copy = restoreWorld(w.settings, decodeState<WorldSnapshot>(encodeState(w.snapshot())));
    expect(copy.checksum()).toBe(w.checksum());
    for (let i = 1; i <= 20 * 40; i++) {
      w.step();
      copy.step();
      if (i % 100 === 0) expect(copy.checksum()).toBe(w.checksum());
    }
  });
});
