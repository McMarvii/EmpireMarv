import { describe, expect, it } from 'vitest';
import { CALAMITY_DAMAGE, CONVERT_CLASS, CONVERT_SETBACK, CONVERT_TIME } from '../src/data/abilities';
import { MAX_FAITH } from '../src/data/units';
import { hasStatus } from '../src/sim/status';
import type { World } from '../src/sim/world';
import { emptyWorld, run } from './helpers';

function rich(w: World): void {
  for (const p of w.players) for (const r of ['food', 'wood', 'stone', 'gold', 'iron'] as const) p.stock[r] = 50000;
}

describe('temple', () => {
  it('trains priests and prophets from their epochs on', () => {
    const w = emptyWorld({ startEpoch: 2 });
    rich(w);
    const temple = w.addBuilding(0, 'temple', 18, 18, true);
    w.issue({ type: 'train', player: 0, buildingId: temple.id, role: 'priest' });
    w.issue({ type: 'train', player: 0, buildingId: temple.id, role: 'prophet' });
    expect(temple.queue.map((q) => q.role)).toEqual(['priest', 'prophet']);
    run(w, 75);
    const names = w.unitsOf(0).filter((u) => u.role === 'priest' || u.role === 'prophet').map((u) => u.stats.name);
    expect(names).toEqual(['Schamane', 'Seher']);
  });
});

describe('priests', () => {
  function setup() {
    const w = emptyWorld({ startEpoch: 4 });
    const priest = w.spawnUnit(0, 'priest', 20, 20);
    priest.faith = MAX_FAITH.priest!;
    // A target that does not fight back or walk off.
    const target = w.spawnUnit(1, 'citizen', 23, 20);
    run(w, 0.05);
    return { w, priest, target };
  }

  it('convert an enemy unit after channelling, spending their faith', () => {
    const { w, priest, target } = setup();
    const time = CONVERT_TIME * CONVERT_CLASS.citizen!;
    w.issue({ type: 'convert', player: 0, ids: [priest.id], targetId: target.id });
    run(w, time - 1);
    expect(target.owner).toBe(1);
    run(w, 2);
    expect(target.owner).toBe(0);
    expect(priest.faith).toBeLessThan(MAX_FAITH.priest!);
    expect(target.order.kind).toBe('idle');
    expect(w.players[1].stats.unitsLost).toBe(1);
  });

  it('are thrown back by hits and cannot convert heroes', () => {
    const { w, priest, target } = setup();
    w.issue({ type: 'convert', player: 0, ids: [priest.id], targetId: target.id });
    run(w, CONVERT_TIME * CONVERT_CLASS.citizen! - 1.5);
    // Two stones hit the priest: the prayer loses ground.
    priest.lastHitTick = w.tick;
    run(w, 0.5);
    priest.lastHitTick = w.tick;
    run(w, 1.5);
    expect(target.owner).toBe(1);
    run(w, CONVERT_SETBACK * 2);
    expect(target.owner).toBe(0);

    const hero = w.spawnUnit(1, 'warrior', 22, 22);
    priest.faith = MAX_FAITH.priest!;
    run(w, 0.05);
    w.issue({ type: 'convert', player: 0, ids: [priest.id], targetId: hero.id });
    expect(priest.order.kind).toBe('idle');
  });

  it('take longer against Glaubensschutz', () => {
    const { w, priest, target } = setup();
    w.completeTech(1, 'glaubensschutz-0');
    w.completeTech(1, 'glaubensschutz-1');
    w.issue({ type: 'convert', player: 0, ids: [priest.id], targetId: target.id });
    const time = CONVERT_TIME * CONVERT_CLASS.citizen!;
    run(w, time + 1);
    expect(target.owner).toBe(1);
    run(w, time * 0.8 + 1);
    expect(target.owner).toBe(0);
  });

  it('heal wounded friends by order and on their own', () => {
    const w = emptyWorld({ startEpoch: 4 });
    const priest = w.spawnUnit(0, 'priest', 20, 20);
    const hurt = w.spawnUnit(0, 'assault', 24, 20);
    hurt.hp = hurt.maxHp / 3;
    run(w, 2);
    // Idle priests notice the wounded.
    expect(priest.order.kind).toBe('heal');
    run(w, 30);
    expect(hurt.hp).toBe(hurt.maxHp);
    expect(priest.order.kind).toBe('idle');
  });

  it('never attack, and an attack order on a unit becomes a conversion', () => {
    const w = emptyWorld({ startEpoch: 4 });
    const priest = w.spawnUnit(0, 'priest', 20, 20);
    const foe = w.spawnUnit(1, 'citizen', 22, 20);
    run(w, 2);
    expect(priest.order.kind).toBe('idle');
    w.issue({ type: 'attack', player: 0, ids: [priest.id], targetId: foe.id });
    expect(priest.order.kind).toBe('convert');
  });
});

describe('prophets', () => {
  function setup(epoch = 9) {
    const w = emptyWorld({ startEpoch: epoch });
    const prophet = w.spawnUnit(0, 'prophet', 15, 20);
    prophet.faith = MAX_FAITH.prophet!;
    // Citizens: nobody starts a fight that would blur the calamity's damage.
    const foes = [w.spawnUnit(1, 'citizen', 30, 20), w.spawnUnit(1, 'citizen', 31, 21)];
    const friend = w.spawnUnit(0, 'citizen', 30, 21);
    run(w, 0.05);
    return { w, prophet, foes, friend };
  }

  it('walk into range and call down a plague that only hurts enemies', () => {
    const { w, prophet, foes, friend } = setup();
    w.issue({ type: 'ability', player: 0, ids: [prophet.id], ability: 'plague', x: 30.5, y: 20.5 });
    expect(prophet.order.kind).toBe('cast');
    run(w, 6);
    expect(prophet.faith).toBeLessThan(MAX_FAITH.prophet!);
    expect(foes.every((f) => hasStatus(w, f, 'plague') || f.hp < f.maxHp)).toBe(true);
    expect(hasStatus(w, friend, 'plague')).toBe(false);
    run(w, 13);
    for (const f of foes) expect(f.maxHp - f.hp).toBeGreaterThan(f.maxHp * CALAMITY_DAMAGE.plague.units * 0.9);
    expect(friend.hp).toBe(friend.maxHp);
  });

  it('shake buildings with an earthquake, less with Katastrophenschutz', () => {
    const { w, prophet } = setup();
    const a = w.addBuilding(1, 'house', 28, 26, true);
    const b = w.addBuilding(1, 'house', 31, 26, true);
    w.completeTech(1, 'katastrophenschutz-0');
    w.completeTech(1, 'katastrophenschutz-1');
    w.issue({ type: 'ability', player: 0, ids: [prophet.id], ability: 'quake', x: 30, y: 27 });
    run(w, 10);
    const lost = (x: typeof a) => (x.maxHp - x.hp) / x.maxHp;
    expect(lost(a)).toBeGreaterThan(CALAMITY_DAMAGE.quake.buildings * 0.6);
    expect(lost(a)).toBeLessThan(CALAMITY_DAMAGE.quake.buildings * 0.75);
    expect(lost(b)).toBeCloseTo(lost(a), 5);
  });

  it('need enough faith and the epoch of the calamity', () => {
    const { w, prophet } = setup(2);
    // Feuersturm comes later.
    w.issue({ type: 'ability', player: 0, ids: [prophet.id], ability: 'firestorm', x: 30, y: 20 });
    expect(prophet.order.kind).toBe('idle');
    prophet.faith = 50;
    w.issue({ type: 'ability', player: 0, ids: [prophet.id], ability: 'plague', x: 30, y: 20 });
    expect(prophet.order.kind).toBe('idle');
  });

  it('storm slows enemies down', () => {
    const { w, prophet, foes } = setup();
    w.issue({ type: 'ability', player: 0, ids: [prophet.id], ability: 'storm', x: 30.5, y: 20.5 });
    run(w, 6);
    expect(hasStatus(w, foes[0], 'slow')).toBe(true);
  });
});
