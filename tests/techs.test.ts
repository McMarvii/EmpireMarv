import { describe, expect, it } from 'vitest';
import { BUILDING_DEFS } from '../src/data/buildings';
import { EPOCH_COUNT } from '../src/data/epochs';
import { BRANCHES, TECH_BY_ID, TECHS } from '../src/data/techs';
import { CARRY_CAPACITY } from '../src/data/units';
import { emptyWorld, run } from './helpers';

describe('tech tree data', () => {
  it('is large and has unique ids', () => {
    expect(TECHS.length).toBeGreaterThanOrEqual(120);
    expect(new Set(TECHS.map((t) => t.id)).size).toBe(TECHS.length);
  });

  it('offers a choice of techs in every epoch', () => {
    for (let e = 0; e < EPOCH_COUNT; e++) {
      const here = TECHS.filter((t) => t.epoch === e);
      expect(here.length, `epoch ${e}`).toBeGreaterThanOrEqual(4);
      // Never only one building: the advance must not hinge on a single site.
      expect(new Set(here.map((t) => t.building)).size, `epoch ${e}`).toBeGreaterThanOrEqual(2);
    }
  });

  it('only depends on techs from the same or earlier epochs', () => {
    for (const t of TECHS) {
      for (const r of t.requires) {
        const req = TECH_BY_ID.get(r);
        expect(req, `${t.id} needs ${r}`).toBeDefined();
        expect(req!.epoch, `${t.id} needs ${r}`).toBeLessThanOrEqual(t.epoch);
      }
    }
  });

  it('keeps every branch in epoch order and researchable where it is built', () => {
    for (const b of BRANCHES) {
      for (let i = 1; i < b.levels.length; i++) expect(b.levels[i][0], b.id).toBeGreaterThan(b.levels[i - 1][0]);
      expect(BUILDING_DEFS[b.building].minEpoch, b.id).toBeLessThanOrEqual(b.levels[0][0]);
    }
  });
});

describe('research', () => {
  function withSmithy() {
    const w = emptyWorld();
    for (const r of ['food', 'wood', 'stone', 'gold', 'iron'] as const) w.players[0].stock[r] = 5000;
    const tc = w.buildingsOf(0, 'towncenter')[0];
    const smithy = w.addBuilding(0, 'smithy', tc.tx + 7, tc.ty, true);
    return { w, tc, smithy };
  }

  it('makes existing and new soldiers stronger', () => {
    const { w, smithy } = withSmithy();
    const old = w.spawnUnit(0, 'assault', 20, 20);
    const before = old.stats.dmg;
    w.issue({ type: 'research', player: 0, buildingId: smithy.id, tech: 'infwaffen-0' });
    expect(smithy.queue[0]?.tech).toBe('infwaffen-0');
    run(w, TECH_BY_ID.get('infwaffen-0')!.time + 1);
    expect(w.players[0].techs.has('infwaffen-0')).toBe(true);
    expect(old.stats.dmg).toBeGreaterThan(before);
    expect(w.spawnUnit(0, 'assault', 21, 20).stats.dmg).toBe(old.stats.dmg);
    // The enemy does not profit.
    expect(w.spawnUnit(1, 'assault', 30, 30).stats.dmg).toBe(before);
  });

  it('needs the previous level, the right epoch and pays up front', () => {
    const { w, smithy } = withSmithy();
    const wood = w.players[0].stock.wood;
    w.issue({ type: 'research', player: 0, buildingId: smithy.id, tech: 'infwaffen-1' });
    expect(smithy.queue).toHaveLength(0);
    w.completeTech(0, 'infwaffen-0');
    w.issue({ type: 'research', player: 0, buildingId: smithy.id, tech: 'infwaffen-1' });
    expect(smithy.queue).toHaveLength(0); // Kupferguss belongs to the copper age
    w.issue({ type: 'research', player: 0, buildingId: smithy.id, tech: 'fernwaffen-0' });
    expect(smithy.queue[0]?.tech).toBe('fernwaffen-0');
    expect(w.players[0].stock.wood).toBeLessThan(wood);
    w.issue({ type: 'cancelTech', player: 0, buildingId: smithy.id });
    expect(smithy.queue).toHaveLength(0);
    expect(w.players[0].stock.wood).toBe(wood);
  });

  it('economy techs raise carrying, gathering and building speed', () => {
    const { w } = withSmithy();
    expect(w.carryCapacity(0)).toBe(CARRY_CAPACITY);
    w.completeTech(0, 'tragen-0');
    expect(w.carryCapacity(0)).toBe(CARRY_CAPACITY + 2);
    w.completeTech(0, 'werkzeuge-0');
    expect(w.players[0].mods.gather.gold).toBeCloseTo(1.06);
    w.completeTech(0, 'baukunst-0');
    expect(w.players[0].mods.build).toBeCloseTo(1.12);
  });

  it('masonry makes buildings and walls sturdier, keeping their damage share', () => {
    const { w, tc } = withSmithy();
    tc.hp = tc.maxHp / 2;
    const max = tc.maxHp;
    w.completeTech(0, 'mauerwerk-0');
    expect(tc.maxHp).toBeGreaterThan(max);
    expect(tc.hp / tc.maxHp).toBeCloseTo(0.5);
  });

  it('medicine heals units that are out of combat', () => {
    const { w } = withSmithy();
    const u = w.spawnUnit(0, 'assault', 20, 20);
    u.hp = 20;
    run(w, 10);
    expect(u.hp).toBe(20);
    w.completeTech(0, 'medizin-0');
    run(w, 10);
    expect(u.hp).toBeGreaterThan(20);
  });
});
