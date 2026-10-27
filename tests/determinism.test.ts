import { describe, expect, it } from 'vitest';
import { atan2, cos, hypot, sin } from '../src/sim/fmath';
import { createWorld } from '../src/sim/setup';
import type { GameSettings } from '../src/sim/world';
import { emptyWorld, run } from './helpers';

describe('browser-independent maths', () => {
  it('matches Math closely', () => {
    for (let i = -5000; i <= 5000; i++) {
      const a = i * 0.0071;
      expect(Math.abs(sin(a) - Math.sin(a))).toBeLessThan(1e-10);
      expect(Math.abs(cos(a) - Math.cos(a))).toBeLessThan(1e-10);
      const y = Math.sin(i * 0.731) * (1 + (i % 7));
      const x = Math.cos(i * 0.417) * (1 + (i % 5));
      if (x !== 0 || y !== 0) expect(Math.abs(atan2(y, x) - Math.atan2(y, x))).toBeLessThan(1e-10);
      expect(Math.abs(hypot(x, y) - Math.hypot(x, y))).toBeLessThan(1e-12);
    }
    expect(atan2(0, -1)).toBeCloseTo(Math.PI, 12);
    expect(atan2(-1, 0)).toBeCloseTo(-Math.PI / 2, 12);
    expect(atan2(0, 0)).toBe(0);
  });

  it('keeps engine-specific functions out of the simulation', () => {
    // Their last bits differ between Chrome, Firefox and Safari: lockstep peers would drift apart.
    const banned = /Math\.(sin|cos|tan|asin|acos|atan|atan2|hypot|exp|expm1|log|log1p|log2|log10|pow|cbrt|sinh|cosh|tanh|random)\b|[\w)\]]\s*\*\*\s*[\w(]/;
    const sources = import.meta.glob<string>(['../src/sim/*.ts', '../src/data/*.ts', '!../src/sim/fmath.ts'], { query: '?raw', import: 'default', eager: true });
    expect(Object.keys(sources).length).toBeGreaterThan(15);
    for (const [file, text] of Object.entries(sources)) {
      text.split('\n').forEach((line, i) => {
        const code = line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
        expect(banned.test(code), `${file}:${i + 1}: ${line.trim()}`).toBe(false);
      });
    }
  });
});

const FOUR: Partial<GameSettings> = {
  seed: 12,
  mapSize: 80,
  players: [
    { name: 'A', color: '#2f7de1', isAI: true, team: 0 },
    { name: 'B', color: '#d9412b', isAI: true, team: 1 },
    { name: 'C', color: '#e3b322', isAI: false, team: 0 },
    { name: 'D', color: '#3fa34d', isAI: true, team: 1 },
  ],
};

describe('state checksum', () => {
  it('is equal for the same match and changes with the state', () => {
    const a = createWorld(FOUR);
    const b = createWorld(FOUR);
    run(a, 60);
    run(b, 60);
    expect(a.checksum()).toBe(b.checksum());
    b.units[0].x += 1e-9;
    expect(a.checksum()).not.toBe(b.checksum());
  });
});

describe('allies', () => {
  it('share their sight, enemies do not', () => {
    const w = emptyWorld({
      revealMap: false,
      players: [
        { name: 'A', color: '#2f7de1', isAI: false, team: 0 },
        { name: 'B', color: '#d9412b', isAI: false, team: 1 },
        { name: 'C', color: '#e3b322', isAI: false, team: 0 },
      ],
    });
    // A tile nobody sees yet.
    const W = w.map.width;
    let spot = 0;
    while (w.players.some((p) => p.vis[spot] || p.vis[spot + 3] || p.vis[spot + 3 * W])) spot++;
    const scout = w.spawnUnit(2, 'scout', (spot % W) + 0.5, Math.floor(spot / W) + 0.5);
    run(w, 1);
    expect(w.isVisibleTo(2, scout)).toBe(true);
    expect(w.isVisibleTo(0, scout)).toBe(true);
    expect(w.isVisibleTo(1, scout)).toBe(false);
    expect(w.areEnemies(0, 2)).toBe(false);
  });
});

describe('computer takes over', () => {
  it('plays for a player who left and hands the empire back', () => {
    const w = createWorld({ ...FOUR, players: FOUR.players!.map((p) => ({ ...p, isAI: false })) });
    expect(w.controllers).toHaveLength(0);
    const citizens = () => w.unitsOf(1).filter((u) => u.role === 'citizen').length;
    const before = citizens();
    w.issue({ type: 'control', player: 1, ai: true });
    expect(w.players[1].isAI).toBe(true);
    expect(w.players[1].gatherBonus).toBe(1);
    run(w, 40);
    // It works the economy: idle citizens gather and the town centre trains more.
    expect(citizens()).toBeGreaterThan(before);
    expect(w.players[1].stats.gathered.food + w.players[1].stats.gathered.wood).toBeGreaterThan(0);
    w.issue({ type: 'control', player: 1, ai: false });
    expect(w.players[1].isAI).toBe(false);
    expect(w.controllers).toHaveLength(0);
  });

  it('stays deterministic when the takeover happens mid-match', () => {
    const play = () => {
      const w = createWorld(FOUR);
      run(w, 30);
      w.issue({ type: 'control', player: 2, ai: true });
      run(w, 60);
      return w.checksum();
    };
    expect(play()).toBe(play());
  });
});
