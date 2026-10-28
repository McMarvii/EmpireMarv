import { describe, expect, it } from 'vitest';
import { buildingCost, BUILDING_DEFS } from '../src/data/buildings';
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

  it('cost more in every era and are seen by everyone once finished', () => {
    const totals = [2, 5, 8, 11, 14, 17].map((e) => Object.values(buildingCost('wonder', e)).reduce((a, b) => a + (b ?? 0), 0));
    for (let i = 1; i < totals.length; i++) expect(totals[i]).toBeGreaterThan(totals[i - 1]);
    const w = emptyWorld({ startEpoch: 2, revealMap: false });
    rich(w);
    const b = finishWonder(w, 5, 0);
    expect(w.isVisibleTo(1, b)).toBe(true);
    // Wonders shrug off calamities (builders off, or they would repair it meanwhile).
    w.issue({ type: 'stop', player: 0, ids: w.unitsOf(0).map((u) => u.id) });
    const hp = b.hp;
    w.addHazard('quake', b.x, b.y, 5, 1, 3);
    run(w, 4);
    expect(b.hp).toBe(hp);
  });

  it('keep their era when their owner advances', () => {
    const w = emptyWorld({ startEpoch: 2 });
    rich(w);
    const b = finishWonder(w);
    expect(b.built).toBe(true);
    const tc = w.buildingsOf(0, 'towncenter')[0];
    tc.research = { targetEpoch: 3, progress: 0, total: 1 };
    run(w, 2);
    expect(w.players[0].epoch).toBe(3);
    expect(b.epoch).toBe(2);
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
    const w = emptyWorld({ startEpoch: 2, wonderVictory: 5 });
    rich(w);
    const b = finishWonder(w);
    expect(b.countdown).toBeGreaterThan(4 * 60 * TICK_RATE);
    expect(w.events.some((e) => e.type === 'wonder' && e.player === 1 && /Zerstört es in 5 Minuten/.test(e.text))).toBe(true);
    run(w, 5 * 60);
    expect(w.over).toBe(true);
    expect(w.victory).toBe('wonder');
    expect(w.victoryWonder).toEqual({ name: 'Steinkreis', owner: 0 });
    expect(w.events.some((e) => e.type === 'wonder' && e.player === 0 && /Halte es 5 Minuten, dann gewinnst du/.test(e.text))).toBe(true);
    expect(w.winnerTeam).toBe(w.players[0].team);
  });

  it('stop the countdown when destroyed, and do nothing with wonder victory off', () => {
    const w = emptyWorld({ startEpoch: 2, wonderVictory: 5 });
    rich(w);
    const b = finishWonder(w);
    run(w, 60);
    w.kill(b, 1);
    run(w, 5 * 60);
    expect(w.over).toBe(false);

    const off = emptyWorld({ startEpoch: 2, wonderVictory: 0 });
    rich(off);
    const c = finishWonder(off);
    expect(c.countdown).toBe(0);
    run(off, 60);
    expect(off.over).toBe(false);
  });
});
