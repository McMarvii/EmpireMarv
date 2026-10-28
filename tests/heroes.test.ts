import { describe, expect, it } from 'vitest';
import { FIELDHEAL_SHARE, SHIELD_TAKEN, STRATEGIST_MORALE, WARRIOR_BOOST } from '../src/data/abilities';
import { bestTier, ROLE_DEFS } from '../src/data/units';
import { applyDamage } from '../src/sim/combat';
import { AURA_INSPIRED, AURA_LED } from '../src/sim/entities';
import { hasStatus } from '../src/sim/status';
import type { World } from '../src/sim/world';
import { emptyWorld, run } from './helpers';

function rich(w: World): void {
  for (const r of ['food', 'wood', 'stone', 'gold', 'iron'] as const) {
    w.players[0].stock[r] = 50000;
    w.players[1].stock[r] = 50000;
  }
}

describe('heroes', () => {
  it('are trained at the town centre from epoch II, each kind only once', () => {
    const w = emptyWorld({ startEpoch: 1 });
    rich(w);
    const tc = w.buildingsOf(0, 'towncenter')[0];
    w.issue({ type: 'train', player: 0, buildingId: tc.id, role: 'strategist' });
    w.issue({ type: 'train', player: 0, buildingId: tc.id, role: 'strategist' });
    w.issue({ type: 'train', player: 0, buildingId: tc.id, role: 'warrior' });
    expect(tc.queue.map((q) => q.role)).toEqual(['strategist', 'warrior']);
    run(w, ROLE_DEFS.strategist.trainTime + ROLE_DEFS.warrior.trainTime + 2);
    expect(w.unitsOf(0).filter((u) => u.role === 'strategist')).toHaveLength(1);
    // Still alive: no second one.
    w.issue({ type: 'train', player: 0, buildingId: tc.id, role: 'strategist' });
    expect(tc.queue).toHaveLength(0);
    // Fallen heroes can be trained again.
    const hero = w.unitsOf(0).find((u) => u.role === 'strategist')!;
    w.kill(hero, 1);
    w.compact();
    w.issue({ type: 'train', player: 0, buildingId: tc.id, role: 'strategist' });
    expect(tc.queue).toHaveLength(1);
  });

  it('take the next title when their people reach a new epoch', () => {
    const w = emptyWorld({ startEpoch: 2, startResources: 'high' });
    rich(w);
    const hero = w.spawnUnit(0, 'warrior', 20, 20);
    expect(hero.stats.name).toBe('Recke');
    const tc = w.buildingsOf(0, 'towncenter')[0];
    tc.research = { targetEpoch: 3, progress: 0, total: 1 };
    run(w, 2);
    expect(w.players[0].epoch).toBe(3);
    expect(hero.tier).toBe(bestTier('warrior', 3));
    expect(hero.stats.name).toBe('Kriegsheld');
    expect(hero.maxHp).toBeGreaterThan(ROLE_DEFS.warrior.hp);
  });

  it('lead with auras: morale and healing near the strategist, attack near the warrior', () => {
    const w = emptyWorld();
    const s = w.spawnUnit(0, 'strategist', 20, 20);
    const k = w.spawnUnit(0, 'warrior', 22, 20);
    const near = w.spawnUnit(0, 'assault', 21, 21);
    const far = w.spawnUnit(0, 'assault', 40, 12);
    const enemy = w.spawnUnit(1, 'citizen', 20.5, 21);
    near.hp = near.maxHp / 2;
    run(w, 1.1);
    expect(near.aura & AURA_LED).toBeTruthy();
    expect(near.aura & AURA_INSPIRED).toBeTruthy();
    expect(near.morale).toBe(STRATEGIST_MORALE);
    expect(far.aura).toBe(0);
    // Enemies get nothing, the heroes not from themselves.
    expect(enemy.aura).toBe(0);
    expect(s.aura & AURA_LED).toBe(0);
    expect(k.aura & AURA_INSPIRED).toBe(0);
    expect(near.hp).toBeGreaterThan(near.maxHp / 2);
    expect(WARRIOR_BOOST).toBeGreaterThan(1);
  });

  it('use abilities with a cooldown: war cry stuns, shield wall softens hits', () => {
    const w = emptyWorld();
    const k = w.spawnUnit(0, 'warrior', 20, 20);
    const foe = w.spawnUnit(1, 'assault', 22, 20);
    const friend = w.spawnUnit(1, 'assault', 30, 30);
    // Abilities find their targets on the unit grid, which every tick rebuilds.
    run(w, 0.05);
    w.issue({ type: 'ability', player: 0, ids: [k.id], ability: 'warcry' });
    expect(hasStatus(w, foe, 'stun')).toBe(true);
    expect(hasStatus(w, friend, 'stun')).toBe(false);
    // A stunned unit stands still.
    w.issue({ type: 'move', player: 1, ids: [foe.id], x: 30, y: 20 });
    const x = foe.x;
    run(w, 1);
    expect(foe.x).toBe(x);
    // On cooldown: the second cry does nothing.
    const ready = k.ready.warcry!;
    w.issue({ type: 'ability', player: 0, ids: [k.id], ability: 'warcry' });
    expect(k.ready.warcry).toBe(ready);
    run(w, 3);
    expect(hasStatus(w, foe, 'stun')).toBe(false);
  });

  it('shield wall and field hospital protect and heal allies', () => {
    const w = emptyWorld();
    const s = w.spawnUnit(0, 'strategist', 20, 20);
    const a = w.spawnUnit(0, 'pike', 21, 20);
    const b = w.spawnUnit(0, 'pike', 30, 30);
    run(w, 0.05);
    w.issue({ type: 'ability', player: 0, ids: [s.id], ability: 'shieldwall' });
    expect(hasStatus(w, a, 'shield')).toBe(true);
    expect(hasStatus(w, b, 'shield')).toBe(false);
    // Equal hits: the shielded unit loses less.
    applyDamage(w, a, 30, 'assault', 1, -1);
    applyDamage(w, b, 30, 'assault', 1, -1);
    expect(a.maxHp - a.hp).toBeCloseTo((b.maxHp - b.hp) * SHIELD_TAKEN, 5);
    a.hp = a.maxHp / 4;
    w.issue({ type: 'ability', player: 0, ids: [s.id], ability: 'fieldheal' });
    expect(a.hp).toBeCloseTo(a.maxHp / 4 + a.maxHp * FIELDHEAL_SHARE, 5);
  });

  it('whirlwind hurts every enemy around the warrior', () => {
    const w = emptyWorld();
    const k = w.spawnUnit(0, 'warrior', 20, 20);
    const foes = [w.spawnUnit(1, 'ranged', 21, 20), w.spawnUnit(1, 'ranged', 19, 21), w.spawnUnit(1, 'ranged', 20, 25)];
    run(w, 0.05);
    const hp = foes.map((f) => f.hp);
    w.issue({ type: 'ability', player: 0, ids: [k.id], ability: 'whirlwind' });
    expect(foes[0].hp).toBeLessThan(hp[0]);
    expect(foes[1].hp).toBeLessThan(hp[1]);
    expect(foes[2].hp).toBe(hp[2]);
  });
});
