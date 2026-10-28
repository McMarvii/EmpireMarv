import { describe, expect, it } from 'vitest';
import { AIController } from '../src/sim/ai';
import { createWorld } from '../src/sim/setup';
import { World } from '../src/sim/world';
import { run } from './helpers';

function aiMatch(seed: number) {
  const w = new World({
    seed,
    mapSize: 80,
    players: [
      { name: 'A', color: '#2f7de1', isAI: true, team: 0 },
      { name: 'B', color: '#d9412b', isAI: true, team: 1 },
    ],
  });
  w.controllers.push(new AIController(0, 'normal', w), new AIController(1, 'normal', w));
  return w;
}

function fingerprint(w: World): string {
  return [
    w.tick,
    ...w.players.map((p) => `${p.epoch}:${Object.values(p.stock).map(Math.round).join(',')}`),
    ...w.units.map((u) => `${u.id}:${u.x.toFixed(3)}:${u.y.toFixed(3)}:${u.hp.toFixed(2)}`),
  ].join('|');
}

describe('simulation', () => {
  it('generates the same map for the same seed', () => {
    const a = new World({ seed: 99, mapSize: 64 });
    const b = new World({ seed: 99, mapSize: 64 });
    expect(Array.from(a.map.terrain)).toEqual(Array.from(b.map.terrain));
    expect(a.resources.map((r) => `${r.nodeType}${r.tx},${r.ty}`)).toEqual(b.resources.map((r) => `${r.nodeType}${r.tx},${r.ty}`));
  });

  it('gives every base nearby gold, stone, iron, food and wood', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const w = new World({ seed, mapSize: 96 });
      for (const s of w.startPositions) {
        for (const res of ['gold', 'stone', 'iron', 'food', 'wood'] as const) {
          expect(w.nearestResource(res, s.x, s.y, 18), `seed ${seed} ${res}`).not.toBeNull();
        }
      }
    }
  });

  it('connects all bases by land', () => {
    for (const seed of [1, 7, 11, 23]) {
      const w = new World({ seed, mapSize: 96 });
      const [a, b] = w.startPositions;
      const path = w.pathfinder.find(a.x + 3, a.y + 3, { kind: 'point', x: b.x + 3, y: b.y + 3 }, 20000);
      const end = path[path.length - 1];
      expect(Math.hypot(end.x - (b.x + 3), end.y - (b.y + 3)), `seed ${seed}`).toBeLessThan(2);
    }
  });

  it('is deterministic: same seed and inputs give the same match', () => {
    const a = aiMatch(5);
    const b = aiMatch(5);
    run(a, 120);
    run(b, 120);
    expect(fingerprint(a)).toBe(fingerprint(b));
  });

  it('lets the AI wall in its base, with gates for its own units', () => {
    const w = new World({
      seed: 7,
      mapSize: 80,
      startEpoch: 2,
      startResources: 'high',
      players: [
        { name: 'A', color: '#2f7de1', isAI: true, team: 0 },
        { name: 'B', color: '#d9412b', isAI: false, team: 1 },
      ],
    });
    w.controllers.push(new AIController(0, 'normal', w));
    run(w, 420);
    const built = (t: 'wall' | 'gate') => w.buildingsOf(0, t).filter((b) => b.built).length;
    // Walls compete with research and the epoch reserve for wood, so the ring grows over time.
    expect(built('wall')).toBeGreaterThanOrEqual(8);
    expect(built('gate')).toBeGreaterThanOrEqual(2);
    const citizens = w.unitsOf(0).filter((u) => u.role === 'citizen');
    expect(citizens.filter((u) => u.order.kind === 'idle').length / citizens.length).toBeLessThan(0.3);
  }, 60000);

  it('does not let an unreachable construction site block the AI', () => {
    const w = new World({
      seed: 7,
      mapSize: 80,
      startResources: 'high',
      players: [
        { name: 'A', color: '#2f7de1', isAI: true, team: 0 },
        { name: 'B', color: '#d9412b', isAI: false, team: 1 },
      ],
    });
    w.controllers.push(new AIController(0, 'normal', w));
    // A house site fenced in by trees on every side.
    const tc = w.buildingsOf(0, 'towncenter')[0];
    const hx = tc.tx + 9;
    const hy = tc.ty + 9;
    for (let y = hy - 1; y <= hy + 2; y++) {
      for (let x = hx - 1; x <= hx + 2; x++) {
        for (const n of w.resources) if (!n.dead && x >= n.tx && x < n.tx + n.size && y >= n.ty && y < n.ty + n.size) w.remove(n);
      }
    }
    w.compact();
    for (let y = hy - 1; y <= hy + 2; y++) {
      for (let x = hx - 1; x <= hx + 2; x++) if (x === hx - 1 || x === hx + 2 || y === hy - 1 || y === hy + 2) w.addResource('tree', x, y, 1, 100);
    }
    const site = w.addBuilding(0, 'house', hx, hy, false);
    run(w, 80);
    expect(site.dead).toBe(true);
    // And the AI went on building elsewhere.
    expect(w.buildingsOf(0).filter((b) => b.built && b.type !== 'towncenter').length).toBeGreaterThan(0);
  }, 60000);

  it('lets two AIs build an economy, advance and fight', () => {
    const w = aiMatch(7);
    run(w, 600);
    for (const p of w.players) {
      expect(p.epoch, p.name).toBeGreaterThanOrEqual(2);
      const citizens = w.unitsOf(p.id).filter((u) => u.role === 'citizen');
      expect(citizens.length).toBeGreaterThanOrEqual(15);
      const idle = citizens.filter((u) => u.order.kind === 'idle').length;
      expect(idle / citizens.length).toBeLessThan(0.3);
      expect(w.unitsOf(p.id).length - citizens.length, `${p.name} army`).toBeGreaterThanOrEqual(4);
    }
    run(w, 300);
    expect(w.players.reduce((s, p) => s + p.stats.kills, 0)).toBeGreaterThan(0);
  }, 60000);

  it('lets the AI fish, build a fleet and land armies on other islands', () => {
    const play = () => {
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
      const home = w.startPositions.map((p) => w.map.landRegion[w.map.idx(Math.floor(p.x), Math.floor(p.y))]);
      let landed = 0;
      for (let i = 0; i < 9 * 60 * 20 && !w.over; i++) {
        w.step();
        w.cues.length = 0;
        w.events.length = 0;
        if (i % 100 !== 0) continue;
        let n = 0;
        for (const u of w.units) {
          const r = w.map.landRegion[w.map.idx(Math.floor(u.x), Math.floor(u.y))];
          if (r && r === home[1 - u.owner]) n++;
        }
        landed = Math.max(landed, n);
      }
      return { w, landed };
    };
    const { w, landed } = play();
    for (const p of [0, 1]) {
      expect(w.buildings.some((b) => b.owner === p && b.type === 'dock' && b.built)).toBe(true);
      expect(w.units.filter((u) => u.owner === p && u.role === 'fisher').length).toBeGreaterThanOrEqual(3);
      expect(w.players[p].stats.gathered.food).toBeGreaterThan(1000);
    }
    // Armies went ashore on the other island and fought there.
    expect(landed).toBeGreaterThanOrEqual(5);
    expect(w.players[0].stats.kills + w.players[1].stats.kills).toBeGreaterThan(10);
    expect(play().w.checksum()).toBe(w.checksum());
  }, 120000);

  it('lets the AI fight in the air: airfields, fighters, bombing raids and flak', () => {
    const play = (mapType: 'continent' | 'islands') => {
      const w = createWorld({
        seed: 7,
        mapSize: 96,
        mapType,
        startEpoch: 13,
        startResources: 'high',
        aiDifficulty: 'hard',
        players: [
          { name: 'A', color: '#2f7de1', isAI: true, team: 0 },
          { name: 'B', color: '#d9412b', isAI: true, team: 1 },
        ],
      });
      const home = w.startPositions.map((p) => w.map.landRegion[w.map.idx(Math.floor(p.x), Math.floor(p.y))]);
      const trained = new Set<string>();
      let bombs = 0;
      let overseas = 0;
      let downed = 0;
      for (let i = 0; i < 10 * 60 * 20 && !w.over; i++) {
        w.step();
        for (const c of w.cues) {
          if (c.kind === 'blast' && c.projectile === 'bomb') {
            bombs++;
            const r = w.map.landRegion[w.map.idx(Math.floor(c.x), Math.floor(c.y))];
            if (r && r === home[1 - c.owner]) overseas++;
          }
          if (c.kind === 'death' && (c.look === 'fighter' || c.look === 'bomber')) downed++;
        }
        for (const u of w.units) if (u.role === 'fighter' || u.role === 'bomber') trained.add(`${u.owner}:${u.role}`);
        w.cues.length = 0;
        w.events.length = 0;
      }
      return { w, trained, bombs, overseas, downed };
    };
    const land = play('continent');
    for (const p of [0, 1]) {
      expect(land.w.buildings.some((b) => b.owner === p && b.type === 'airfield' && b.built)).toBe(true);
      expect(land.trained.has(`${p}:fighter`)).toBe(true);
      expect(land.trained.has(`${p}:bomber`)).toBe(true);
    }
    expect(land.bombs).toBeGreaterThan(5);
    expect(land.downed).toBeGreaterThan(3);
    expect(play('continent').w.checksum()).toBe(land.w.checksum());
    // No landing needed: bombers reach the other island on their own.
    const sea = play('islands');
    expect(sea.overseas).toBeGreaterThan(3);
  }, 180000);

  it('lets the AI use heroes, faith and wonders', () => {
    const play = () => {
      const w = createWorld({
        seed: 7,
        mapSize: 96,
        startEpoch: 6,
        startResources: 'high',
        wonderVictory: 10,
        aiDifficulty: 'hard',
        players: [
          { name: 'A', color: '#2f7de1', isAI: true, team: 0 },
          { name: 'B', color: '#d9412b', isAI: true, team: 1 },
        ],
      });
      const seen = { hero: false, priest: false, prophet: false, ability: 0, calamity: 0 };
      for (let i = 0; i < 11 * 60 * 20 && !w.over; i++) {
        w.step();
        for (const c of w.cues) {
          if (c.kind === 'ability') seen.ability++;
          if (c.kind === 'calamity') seen.calamity++;
        }
        w.cues.length = 0;
        w.events.length = 0;
        for (const u of w.units) {
          if (u.role === 'warrior' || u.role === 'strategist') seen.hero = true;
          if (u.role === 'priest') seen.priest = true;
          if (u.role === 'prophet') seen.prophet = true;
        }
      }
      return { w, seen };
    };
    const { w, seen } = play();
    expect(w.buildings.filter((b) => b.type === 'temple' && b.built).length).toBeGreaterThanOrEqual(2);
    expect(seen).toMatchObject({ hero: true, priest: true, prophet: true });
    expect(seen.ability).toBeGreaterThan(0);
    expect(seen.calamity).toBeGreaterThan(0);
    expect(w.buildings.some((b) => b.type === 'wonder')).toBe(true);
    // All of it stays deterministic.
    expect(play().w.checksum()).toBe(w.checksum());
  }, 120000);
});

