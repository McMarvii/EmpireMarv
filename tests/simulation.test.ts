import { describe, expect, it } from 'vitest';
import { AIController } from '../src/sim/ai';
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
});
