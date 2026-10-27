import { describe, expect, it } from 'vitest';
import { BUILDING_DEFS } from '../src/data/buildings';
import { WONDER_GATHER } from '../src/data/wonders';
import type { World } from '../src/sim/world';
import { TICK_RATE } from '../src/sim/world';
import { emptyWorld, run } from './helpers';

function rich(w: World): void {
  for (const p of w.players) for (const r of ['food', 'wood', 'stone', 'gold', 'iron'] as const) p.stock[r] = 50000;
}

/** A finished wonder of player 0, the way construction finishes it. */
function finishWonder(w: World, tx = 18, ty = 18) {
  const citizens = w.unitsOf(0).filter((u) => u.role === 'citizen');
  w.issue({ type: 'place', player: 0, ids: citizens.map((u) => u.id), building: 'wonder', tx, ty });
  const b = w.buildingsOf(0, 'wonder').find((x) => x.tx === tx && x.ty === ty)!;
  b.progress = 0.999;
  run(w, 30);
  return b;
}

describe('wonders', () => {
  it('can be founded once per era and are named after it', () => {
    const w = emptyWorld({ startEpoch: 4 });
    rich(w);
    const b = finishWonder(w);
    expect(b.built).toBe(true);
    expect(w.wonderProblem(0)).toMatch(/Große Bibliothek steht schon/);
    const before = w.buildingsOf(0, 'wonder').length;
    w.issue({ type: 'place', player: 0, ids: [], building: 'wonder', tx: 26, ty: 10 });
    expect(w.buildingsOf(0, 'wonder').length).toBe(before);
    // A new era, a new wonder.
    w.players[0].epoch = 6;
    expect(w.wonderProblem(0)).toBeNull();
    expect(BUILDING_DEFS.wonder.size).toBe(5);
  });

  it('keep their era when their owner advances', () => {
    const w = emptyWorld({ startEpoch: 0 });
    rich(w);
    const b = finishWonder(w);
    const tc = w.buildingsOf(0, 'towncenter')[0];
    tc.research = { targetEpoch: 3, progress: 0, total: 1 };
    run(w, 2);
    expect(w.players[0].epoch).toBe(3);
    expect(b.epoch).toBe(0);
    expect(w.wonderEffect(0, 'gather')).toBe(true);
    expect(w.wonderEffect(0, 'reveal')).toBe(false);
  });

  it('take effect while they stand: the library reveals the map, the stone circle speeds up gathering', () => {
    const w = emptyWorld({ startEpoch: 3, revealMap: false });
    rich(w);
    expect(w.players[0].vis.every((v) => v === 2)).toBe(false);
    // Only explored ground can be built on: right next to the town centre.
    const b = finishWonder(w, 5, 0);
    run(w, 1);
    expect(w.wonderEffect(0, 'reveal')).toBe(true);
    expect(w.players[0].vis.every((v) => v === 2)).toBe(true);
    expect(w.players[1].vis.every((v) => v === 2)).toBe(false);
    w.kill(b, 1);
    expect(w.wonderEffect(0, 'reveal')).toBe(false);
    expect(WONDER_GATHER).toBeGreaterThan(1);
  });

  it('win the match when held long enough', () => {
    const w = emptyWorld({ wonderVictory: 5 });
    rich(w);
    const b = finishWonder(w);
    expect(b.countdown).toBeGreaterThan(4 * 60 * TICK_RATE);
    expect(w.events.some((e) => e.type === 'wonder' && e.player === 1 && /Zerstört es in 5 Minuten/.test(e.text))).toBe(true);
    run(w, 5 * 60);
    expect(w.over).toBe(true);
    expect(w.victory).toBe('wonder');
    expect(w.winnerTeam).toBe(w.players[0].team);
  });

  it('stop the countdown when destroyed, and do nothing with wonder victory off', () => {
    const w = emptyWorld({ wonderVictory: 5 });
    rich(w);
    const b = finishWonder(w);
    run(w, 60);
    w.kill(b, 1);
    run(w, 5 * 60);
    expect(w.over).toBe(false);

    const off = emptyWorld({ wonderVictory: 0 });
    rich(off);
    const c = finishWonder(off);
    expect(c.countdown).toBe(0);
    run(off, 60);
    expect(off.over).toBe(false);
  });
});
