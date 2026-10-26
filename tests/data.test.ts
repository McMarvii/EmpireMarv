import { describe, expect, it } from 'vitest';
import { BUILDING_DEFS, BUILDABLE, type BuildingType } from '../src/data/buildings';
import { damageMultiplier } from '../src/data/combat';
import { epochNumeral, EPOCHS, EPOCH_COUNT, toRoman } from '../src/data/epochs';
import { bestTier, COMBAT_ROLES, ROLE_DEFS, unitStats } from '../src/data/units';

describe('epochs', () => {
  it('has 18 epochs from the stone age to space', () => {
    expect(EPOCH_COUNT).toBe(18);
    expect(EPOCHS[0].name).toBe('Urzeit');
    expect(EPOCHS[EPOCH_COUNT - 1].name).toBe('Weltraumzeitalter');
  });

  it('writes epoch numbers in roman numerals', () => {
    expect([1, 4, 9, 14, 18].map(toRoman)).toEqual(['I', 'IV', 'IX', 'XIV', 'XVIII']);
    expect(epochNumeral(0)).toBe('I');
    expect(epochNumeral(EPOCH_COUNT - 1)).toBe('XVIII');
  });

  it('only requires buildings that are unlocked before the advance', () => {
    for (const e of EPOCHS.slice(1)) {
      expect(Object.keys(e.requires).length, e.name).toBeGreaterThan(0);
      for (const type of Object.keys(e.requires) as BuildingType[]) {
        expect(BUILDING_DEFS[type].minEpoch, `${e.name}: ${type}`).toBeLessThan(e.index);
      }
    }
  });

  it('makes every advance cost more than the previous one', () => {
    const total = (i: number) => Object.values(EPOCHS[i].advanceCost).reduce((a, b) => a + (b ?? 0), 0);
    for (let i = 2; i < EPOCH_COUNT; i++) expect(total(i)).toBeGreaterThan(total(i - 1));
  });
});

describe('units', () => {
  it('lists tiers in ascending epoch order', () => {
    for (const def of Object.values(ROLE_DEFS)) {
      for (let i = 1; i < def.tiers.length; i++) expect(def.tiers[i].epoch).toBeGreaterThan(def.tiers[i - 1].epoch);
    }
  });

  it('offers at least three combat roles in every epoch', () => {
    for (let e = 0; e < EPOCH_COUNT; e++) {
      const available = COMBAT_ROLES.filter((r) => bestTier(r, e) >= 0);
      expect(available.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('makes later tiers stronger', () => {
    for (const role of COMBAT_ROLES) {
      const tiers = ROLE_DEFS[role].tiers;
      const first = unitStats(role, 0);
      const last = unitStats(role, tiers.length - 1);
      expect(last.hp).toBeGreaterThan(first.hp);
      expect(last.dmg).toBeGreaterThan(first.dmg);
    }
  });

  it('keeps the counter loop intact', () => {
    expect(damageMultiplier('assault', 'pike')).toBeGreaterThan(1);
    expect(damageMultiplier('pike', 'mounted')).toBeGreaterThan(1);
    expect(damageMultiplier('mounted', 'ranged')).toBeGreaterThan(1);
    expect(damageMultiplier('ranged', 'assault')).toBeGreaterThan(1);
    expect(damageMultiplier('siege', 'building')).toBeGreaterThan(2);
    expect(damageMultiplier('pike', 'assault')).toBeLessThan(1);
  });
});

describe('buildings', () => {
  it('has a hotkey for every buildable type and no duplicates', () => {
    const keys = BUILDABLE.map((t) => BUILDING_DEFS[t].hotkey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('only lets buildings train roles that exist', () => {
    for (const def of Object.values(BUILDING_DEFS)) for (const role of def.trains) expect(ROLE_DEFS[role]).toBeDefined();
  });
});
