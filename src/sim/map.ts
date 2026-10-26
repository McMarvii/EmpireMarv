export const Terrain = {
  Grass: 0,
  Forest: 1,
  Sand: 2,
  Water: 3,
  Dirt: 4,
} as const;
export type Terrain = (typeof Terrain)[keyof typeof Terrain];

/**
 * Tile grid. `blocked` counts how many static entities (buildings, trees,
 * mines) cover a tile; water is impassable through the terrain itself.
 * `occupied` also counts walkable buildings like farms, for placement checks.
 */
export class GameMap {
  readonly terrain: Uint8Array;
  readonly blocked: Uint16Array;
  readonly occupied: Uint16Array;
  /** Per-tile shade variation 0..3 for rendering. */
  readonly shade: Uint8Array;
  /** Team whose units may pass a finished gate on this tile, or -1. */
  readonly gateTeam: Int16Array;
  /** Bumped whenever passability changes, so caches can invalidate. */
  version = 0;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.terrain = new Uint8Array(width * height);
    this.blocked = new Uint16Array(width * height);
    this.occupied = new Uint16Array(width * height);
    this.shade = new Uint8Array(width * height);
    this.gateTeam = new Int16Array(width * height).fill(-1);
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  idx(x: number, y: number): number {
    return y * this.width + x;
  }

  terrainAt(x: number, y: number): Terrain {
    return this.terrain[this.idx(x, y)] as Terrain;
  }

  passable(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false;
    const i = this.idx(x, y);
    return this.terrain[i] !== Terrain.Water && this.blocked[i] === 0;
  }

  /** Like `passable`, but a team's own gates are open to its units. */
  passableFor(x: number, y: number, team: number): boolean {
    if (!this.inBounds(x, y)) return false;
    const i = this.idx(x, y);
    if (this.terrain[i] === Terrain.Water) return false;
    return this.blocked[i] === 0 || (team >= 0 && this.blocked[i] === 1 && this.gateTeam[i] === team);
  }

  setGate(x: number, y: number, team: number): void {
    if (!this.inBounds(x, y)) return;
    this.gateTeam[this.idx(x, y)] = team;
    this.version++;
  }

  /** Passable or only blocked by a building (for placing units into ghosts). */
  walkableTerrain(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.terrain[this.idx(x, y)] !== Terrain.Water;
  }

  block(tx: number, ty: number, w: number, h: number, delta: 1 | -1, walkable = false): void {
    for (let y = ty; y < ty + h; y++) {
      for (let x = tx; x < tx + w; x++) {
        if (!this.inBounds(x, y)) continue;
        const i = this.idx(x, y);
        this.occupied[i] = Math.max(0, this.occupied[i] + delta);
        if (!walkable) this.blocked[i] = Math.max(0, this.blocked[i] + delta);
      }
    }
    this.version++;
  }

  /** Free for a new building: dry land, nothing standing there. */
  buildable(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false;
    const i = this.idx(x, y);
    return this.terrain[i] !== Terrain.Water && this.occupied[i] === 0;
  }

  /** Nearest passable tile to a point, searching outward ring by ring. */
  nearestPassable(x: number, y: number, maxRadius = 12): { x: number; y: number } | null {
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    if (this.passable(cx, cy)) return { x: cx, y: cy };
    for (let r = 1; r <= maxRadius; r++) {
      let best: { x: number; y: number } | null = null;
      let bestD = Infinity;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const tx = cx + dx;
          const ty = cy + dy;
          if (!this.passable(tx, ty)) continue;
          const d = (tx + 0.5 - x) ** 2 + (ty + 0.5 - y) ** 2;
          if (d < bestD) {
            bestD = d;
            best = { x: tx, y: ty };
          }
        }
      }
      if (best) return best;
    }
    return null;
  }
}
