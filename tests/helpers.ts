import { World, type GameSettings } from '../src/sim/world';

/** Two-player world without AI, all deposits removed, fully revealed. */
export function emptyWorld(overrides: Partial<GameSettings> = {}): World {
  const w = new World({
    seed: 3,
    mapSize: 48,
    revealMap: true,
    players: [
      { name: 'A', color: '#2f7de1', isAI: false, team: 0 },
      { name: 'B', color: '#d9412b', isAI: false, team: 1 },
    ],
    ...overrides,
  });
  for (const n of w.resources) w.remove(n);
  w.compact();
  // Flatten the battlefield so tests never depend on generated lakes.
  w.map.terrain.fill(0);
  w.map.version++;
  return w;
}

export function run(w: World, seconds: number): void {
  for (let i = 0; i < seconds * 20; i++) w.step();
}
