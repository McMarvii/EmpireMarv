import { describe, expect, it } from 'vitest';
import { bestTier } from '../src/data/units';
import { Recorder } from '../src/replay';
import { makeSave, parseSave, serializeSave } from '../src/saves';
import { Terrain } from '../src/sim/map';
import { createWorld, restoreWorld } from '../src/sim/setup';
import { decodeState, encodeState } from '../src/sim/snapshot';
import type { World, WorldSnapshot } from '../src/sim/world';
import { SIM_VERSION } from '../src/version';
import { emptyWorld, run } from './helpers';

/** Save, then load from the text, as a saved game would be. */
function reload(w: World): World {
  const text = encodeState(w.snapshot());
  return restoreWorld(w.settings, decodeState<WorldSnapshot>(text));
}

/** Both worlds run on side by side and must stay identical, checked every 100 ticks. */
function runTwin(a: World, b: World, seconds: number): void {
  for (let i = 1; i <= seconds * 20; i++) {
    a.step();
    b.step();
    a.events.length = b.events.length = 0;
    a.cues.length = b.cues.length = 0;
    if (i % 100 === 0) expect(b.checksum(), `tick ${a.tick}`).toBe(a.checksum());
  }
}

describe('saved games', () => {
  it('encode what plain JSON loses: typed arrays, sets, maps, -0 and infinities', () => {
    const value = { a: new Uint8Array([1, 2, 255]), b: new Int16Array([-1, 7]), s: new Set(['x', 'y']), m: new Map([[1, { z: -0 }]]), n: [-0, Infinity, -Infinity, 0.1] };
    const back = decodeState<typeof value>(encodeState(value));
    expect([...back.a]).toEqual([1, 2, 255]);
    expect(back.b).toBeInstanceOf(Int16Array);
    expect([...back.b]).toEqual([-1, 7]);
    expect([...back.s]).toEqual(['x', 'y']);
    expect(Object.is(back.m.get(1)!.z, -0)).toBe(true);
    expect(Object.is(back.n[0], -0)).toBe(true);
    expect(back.n.slice(1)).toEqual([Infinity, -Infinity, 0.1]);
  });

  it('continue an air war exactly as if it had never stopped', () => {
    const w = createWorld({
      seed: 5,
      mapSize: 96,
      startEpoch: 13,
      startResources: 'high',
      aiDifficulty: 'hard',
      players: [
        { name: 'A', color: '#2f7de1', isAI: true, team: 0 },
        { name: 'B', color: '#d9412b', isAI: true, team: 1 },
      ],
    });
    // Five minutes in: airfields up, the first planes in the air.
    run(w, 5 * 60);
    expect(w.units.some((u) => u.role === 'fighter' || u.role === 'bomber')).toBe(true);
    const copy = reload(w);
    expect(copy.checksum()).toBe(w.checksum());
    runTwin(w, copy, 2 * 60);
  }, 60000);

  it('continue an AI match exactly as if it had never stopped', () => {
    const w = createWorld({
      seed: 7,
      mapSize: 96,
      mapType: 'islands',
      startEpoch: 4,
      startResources: 'high',
      aiDifficulty: 'hard',
      players: [
        { name: 'A', color: '#2f7de1', isAI: true, team: 0 },
        { name: 'B', color: '#d9412b', isAI: true, team: 1 },
      ],
    });
    // Seven minutes in: harbours, fishing boats, fleets and the first landings under way.
    run(w, 7 * 60);
    const copy = reload(w);
    expect(copy.checksum()).toBe(w.checksum());
    runTwin(w, copy, 3 * 60);
  }, 60000);

  it('keep passengers, shelters, calamities, states and wonder countdowns', () => {
    const w = emptyWorld({ wonderVictory: 5 });
    for (let y = 0; y < 48; y++) for (let x = 20; x <= 34; x++) w.map.terrain[w.map.idx(x, y)] = Terrain.Water;
    w.map.computeRegions();
    w.map.version++;
    w.players[0].epoch = w.players[1].epoch = 9;
    const ship = w.spawnUnit(0, 'transport', 21.5, 18.5, bestTier('transport', 9));
    const troops = [0, 1, 2].map((i) => w.spawnUnit(0, 'assault', 16.5 + i, 18.5, bestTier('assault', 9)));
    w.issue({ type: 'board', player: 0, ids: troops.map((u) => u.id), targetId: ship.id });
    w.issue({ type: 'shelter', player: 1, on: true });
    const wonder = w.addBuilding(1, 'wonder', 38, 30, true);
    w.wonderFinished(wonder);
    const hero = w.spawnUnit(1, 'warrior', 40.5, 10.5, bestTier('warrior', 9));
    w.issue({ type: 'ability', player: 1, ids: [hero.id], ability: 'frenzy' });
    w.addHazard('storm', 25, 25, 5, 0, 30);
    w.completeTech(0, 'schiffbau-0');
    hero.facing = -0;
    run(w, 12);
    expect(ship.cargo.length).toBe(3);
    expect(w.buildings.some((b) => b.garrison.length > 0)).toBe(true);
    expect(wonder.countdown).toBeGreaterThan(0);
    const copy = reload(w);
    const ship2 = copy.get(ship.id)!;
    expect(ship2.kind === 'unit' && ship2.cargo.map((u) => u.id)).toEqual(ship.cargo.map((u) => u.id));
    expect(copy.get(troops[0].id)).toBeUndefined();
    expect(copy.players[0].techs.has('schiffbau-0')).toBe(true);
    expect(copy.hazards.length).toBe(1);
    expect(Object.is((copy.get(hero.id) as typeof hero).facing, -0)).toBe(true);
    w.issue({ type: 'unload', player: 0, ids: [ship.id], x: 42, y: 18 });
    copy.issue({ type: 'unload', player: 0, ids: [ship.id], x: 42, y: 18 });
    runTwin(w, copy, 40);
  });

  it('save the same thing again after loading', () => {
    const w = createWorld({ seed: 3, mapSize: 64, mapType: 'coast', startEpoch: 2, players: [
      { name: 'A', color: '#2f7de1', isAI: true, team: 0 },
      { name: 'B', color: '#d9412b', isAI: true, team: 1 },
    ] });
    run(w, 90);
    const text = encodeState(w.snapshot());
    const copy = restoreWorld(w.settings, decodeState<WorldSnapshot>(text));
    expect(encodeState(copy.snapshot())).toBe(text);
  });

  it('go into a save file with summary and recording, and refuse other versions', () => {
    const w = createWorld({ seed: 5, mapSize: 64, mapType: 'rivers', players: [
      { name: 'Du', color: '#2f7de1', isAI: false, team: 0 },
      { name: 'KI', color: '#d9412b', isAI: true, team: 1 },
    ] });
    const rec = new Recorder(w.settings, 0);
    run(w, 30);
    rec.stepped(w);
    const text = serializeSave(makeSave(w, 0, rec.replay, { x: 10, y: 20, zoom: 1.2 }, 'Test'));
    const save = parseSave(text);
    expect(save.summary).toMatchObject({ name: 'Test', map: 'Flüsse', epoch: 0, ticks: 600, game: SIM_VERSION });
    expect(save.camera).toEqual({ x: 10, y: 20, zoom: 1.2 });
    expect(save.replay.ticks).toBe(600);
    expect(restoreWorld(save.settings, save.world).checksum()).toBe(w.checksum());
    expect(() => parseSave(text.replace(`"game":"${SIM_VERSION}"`, '"game":"0.1.0"'))).toThrow(/Version 0\.1\.0/);
    expect(() => parseSave('{"format":"empiremarv-replay"}')).toThrow(/kein EmpireMarv-Spielstand/);
    expect(() => parseSave('kein json')).toThrow(/kein EmpireMarv-Spielstand/);
  });
});
