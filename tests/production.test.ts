import { describe, expect, it } from 'vitest';
import { EPOCHS } from '../src/data/epochs';
import { TECH_BY_ID, TECHS } from '../src/data/techs';
import { bestTier, ROLE_DEFS } from '../src/data/units';
import type { Building } from '../src/sim/entities';
import type { World } from '../src/sim/world';
import { MAX_JOBS, upgradeGold } from '../src/sim/world';
import { emptyWorld, run } from './helpers';

function rich(w: World): void {
  for (const r of ['food', 'wood', 'stone', 'gold', 'iron'] as const) w.players[0].stock[r] = 50000;
}

/** Two levels of one branch, both open in epoch 3. */
const first = 'infwaffen-0';
const second = 'infwaffen-1';

/** The technologies in a building's queue, in order. */
const techsIn = (b: Building) => b.queue.flatMap((q) => (q.tech !== undefined ? [q.tech] : []));
/** The job a building works on, by unit role or technology id. */
const working = (w: World, b: Building) => {
  const i = w.activeJob(b);
  return i < 0 ? null : (b.queue[i].tech ?? b.queue[i].role);
};

describe('one queue for units and research', () => {
  it('research waits its turn behind units, and units behind research', () => {
    const w = emptyWorld({ startEpoch: 3 });
    rich(w);
    const tc = w.buildingsOf(0, 'towncenter')[0];
    const tech = TECHS.find((t) => t.building === 'towncenter' && t.epoch <= 3 && t.requires.length === 0)!;
    w.issue({ type: 'train', player: 0, buildingId: tc.id, role: 'citizen' });
    w.issue({ type: 'research', player: 0, buildingId: tc.id, tech: tech.id });
    w.issue({ type: 'train', player: 0, buildingId: tc.id, role: 'citizen' });
    expect(tc.queue.map((q) => q.tech ?? q.role)).toEqual(['citizen', tech.id, 'citizen']);
    // First the citizen: the research does not run alongside it.
    w.step();
    expect(working(w, tc)).toBe('citizen');
    expect(tc.queue[1].progress).toBe(0);
    const trained = w.players[0].stats.unitsTrained;
    run(w, ROLE_DEFS.citizen.trainTime + 0.5);
    expect(w.players[0].stats.unitsTrained).toBe(trained + 1);
    // Then the research, while the second citizen waits.
    expect(working(w, tc)).toBe(tech.id);
    run(w, tech.time + 0.5);
    expect(w.players[0].techs.has(tech.id)).toBe(true);
    expect(w.players[0].stats.unitsTrained).toBe(trained + 1);
    run(w, ROLE_DEFS.citizen.trainTime + 0.5);
    expect(w.players[0].stats.unitsTrained).toBe(trained + 2);
  });

  it('queues techs in order, paid up front, the next level after its prerequisite', () => {
    const w = emptyWorld({ startEpoch: 3 });
    rich(w);
    const smithy = w.addBuilding(0, 'smithy', 18, 18, true);
    const food = w.players[0].stock.food;
    w.issue({ type: 'research', player: 0, buildingId: smithy.id, tech: first });
    w.issue({ type: 'research', player: 0, buildingId: smithy.id, tech: second });
    w.issue({ type: 'research', player: 0, buildingId: smithy.id, tech: 'ruestung-0' });
    expect(techsIn(smithy)).toEqual([first, second, 'ruestung-0']);
    expect(working(w, smithy)).toBe(first);
    const paid = [first, second, 'ruestung-0'].reduce((s, id) => s + (TECH_BY_ID.get(id)!.cost.food ?? 0), 0);
    expect(w.players[0].stock.food).toBe(food - paid);
    // Queued techs are taken: nobody (the AI included) starts them twice.
    expect(w.techAvailable(0, TECH_BY_ID.get(second)!)).toBe(false);

    run(w, TECH_BY_ID.get(first)!.time + 1);
    expect(w.players[0].techs.has(first)).toBe(true);
    expect(working(w, smithy)).toBe(second);
    run(w, TECH_BY_ID.get(second)!.time + TECH_BY_ID.get('ruestung-0')!.time + 2);
    expect([first, second, 'ruestung-0'].every((id) => w.players[0].techs.has(id))).toBe(true);
    expect(smithy.queue).toHaveLength(0);
  });

  it('a tech waiting for a prerequisite elsewhere lets the next job go first', () => {
    const w = emptyWorld({ startEpoch: 3 });
    rich(w);
    const a = w.addBuilding(0, 'smithy', 14, 18, true);
    const b = w.addBuilding(0, 'smithy', 20, 18, true);
    w.issue({ type: 'research', player: 0, buildingId: a.id, tech: first });
    w.issue({ type: 'research', player: 0, buildingId: b.id, tech: second });
    w.issue({ type: 'research', player: 0, buildingId: b.id, tech: 'ruestung-0' });
    w.step();
    expect(working(w, b)).toBe('ruestung-0');
    expect(b.queue[0].progress).toBe(0);
  });

  it('refuses a full queue without taking resources', () => {
    const w = emptyWorld({ startEpoch: 8 });
    rich(w);
    const tc = w.buildingsOf(0, 'towncenter')[0];
    for (let i = 0; i < MAX_JOBS - 1; i++) w.issue({ type: 'train', player: 0, buildingId: tc.id, role: 'citizen' });
    const tech = TECHS.find((t) => t.building === 'towncenter' && t.epoch <= 8 && t.requires.length === 0)!;
    const other = TECHS.find((t) => t.building === 'towncenter' && t.epoch <= 8 && t.requires.length === 0 && t.id !== tech.id)!;
    w.issue({ type: 'research', player: 0, buildingId: tc.id, tech: tech.id });
    expect(tc.queue).toHaveLength(MAX_JOBS);
    const stock = { ...w.players[0].stock };
    w.issue({ type: 'research', player: 0, buildingId: tc.id, tech: other.id });
    w.issue({ type: 'train', player: 0, buildingId: tc.id, role: 'citizen' });
    expect(tc.queue).toHaveLength(MAX_JOBS);
    expect(w.players[0].stock).toEqual(stock);
    expect(w.plannedTechs(0).has(other.id)).toBe(false);
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
    expect(techsIn(b)).toEqual(['ruestung-0', second]);
    w.step();
    w.issue({ type: 'cancel', player: 0, buildingId: a.id, index: 0 });
    expect(a.queue).toHaveLength(0);
    expect(techsIn(b)).toEqual(['ruestung-0']);
    // Only the tech still queued is paid for.
    const ruestung = TECH_BY_ID.get('ruestung-0')!.cost;
    for (const r of ['food', 'wood', 'stone', 'gold', 'iron'] as const) expect(w.players[0].stock[r]).toBe(before[r] - (ruestung[r] ?? 0));
  });

  it('cancelTech still cancels the tech worked on, or one by its place among the techs', () => {
    const w = emptyWorld({ startEpoch: 3 });
    rich(w);
    const s = w.addBuilding(0, 'smithy', 18, 18, true);
    w.issue({ type: 'research', player: 0, buildingId: s.id, tech: first });
    w.issue({ type: 'research', player: 0, buildingId: s.id, tech: 'ruestung-0' });
    w.issue({ type: 'research', player: 0, buildingId: s.id, tech: 'fernwaffen-0' });
    w.step();
    w.issue({ type: 'cancelTech', player: 0, buildingId: s.id, index: 1 });
    expect(techsIn(s)).toEqual([first, 'fernwaffen-0']);
    w.issue({ type: 'cancelTech', player: 0, buildingId: s.id });
    expect(techsIn(s)).toEqual(['fernwaffen-0']);
  });

  it('a destroyed smithy takes its research along and frees what waited for it', () => {
    const w = emptyWorld({ startEpoch: 3 });
    rich(w);
    const a = w.addBuilding(0, 'smithy', 14, 18, true);
    const b = w.addBuilding(0, 'smithy', 20, 18, true);
    w.issue({ type: 'research', player: 0, buildingId: a.id, tech: first });
    w.issue({ type: 'research', player: 0, buildingId: b.id, tech: second });
    expect(techsIn(b)).toHaveLength(1);
    w.kill(a, 1);
    expect(techsIn(b)).toHaveLength(0);
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

describe('re-equipping outdated units', () => {
  it('brings old units near a barracks up to the current epoch for gold, not the ones far away', () => {
    const w = emptyWorld({ startEpoch: 1 });
    const barracks = w.addBuilding(0, 'barracks', 14, 14, true);
    const near = [0, 1].map((i) => w.spawnUnit(0, 'assault', 18 + i, 18));
    const far = w.spawnUnit(0, 'assault', 40, 40);
    const old = near[0].tier;
    near[0].hp = near[0].maxHp / 2;
    w.players[0].epoch = 7;
    w.players[0].stock.gold = 1000;
    const tier = bestTier('assault', 7);
    expect(tier).toBeGreaterThan(old);
    expect(w.upgradable(barracks).map((o) => o.unit.id)).toEqual(near.map((u) => u.id));
    w.issue({ type: 'upgrade', player: 0, buildingId: barracks.id });
    for (const u of near) {
      expect(u.tier).toBe(tier);
      expect(u.stats.dmg).toBe(w.unitStatsFor(0, 'assault', tier).dmg);
    }
    // Wounds stay in proportion.
    expect(near[0].hp / near[0].maxHp).toBeCloseTo(0.5);
    expect(far.tier).toBe(old);
    expect(w.players[0].stock.gold).toBe(1000 - 2 * upgradeGold('assault', tier));
  });

  it('stops where the gold runs out', () => {
    const w = emptyWorld({ startEpoch: 1 });
    const barracks = w.addBuilding(0, 'barracks', 14, 14, true);
    const units = [0, 1, 2].map((i) => w.spawnUnit(0, 'assault', 18 + i, 18));
    w.players[0].epoch = 7;
    const price = upgradeGold('assault', bestTier('assault', 7));
    w.players[0].stock.gold = price + 5;
    w.issue({ type: 'upgrade', player: 0, buildingId: barracks.id });
    expect(units.filter((u) => u.tier === bestTier('assault', 7))).toHaveLength(1);
    expect(w.players[0].stock.gold).toBe(5);
    expect(w.events.some((e) => e.type === 'warn' && e.text.includes('Nicht genug Gold'))).toBe(true);
  });
});
