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
  /**
   * Connected stretches of land and of water by terrain alone (1, 2, …; 0
   * on the other kind), so "is it reachable over land?" is a lookup.
   * Built once after map generation; buildings and trees do not count.
   */
  readonly landRegion: Int32Array;
  readonly waterRegion: Int32Array;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.terrain = new Uint8Array(width * height);
    this.blocked = new Uint16Array(width * height);
    this.occupied = new Uint16Array(width * height);
    this.shade = new Uint8Array(width * height);
    this.gateTeam = new Int16Array(width * height).fill(-1);
    this.landRegion = new Int32Array(width * height);
    this.waterRegion = new Int32Array(width * height);
  }

  computeRegions(): void {
    const n = this.width * this.height;
    this.landRegion.fill(0);
    this.waterRegion.fill(0);
    let nextLand = 1;
    let nextWater = 1;
    const stack: number[] = [];
    for (let start = 0; start < n; start++) {
      const water = this.terrain[start] === Terrain.Water;
      const regions = water ? this.waterRegion : this.landRegion;
      if (regions[start]) continue;
      const id = water ? nextWater++ : nextLand++;
      regions[start] = id;
      stack.push(start);
      while (stack.length) {
        const cur = stack.pop()!;
        const x = cur % this.width;
        const y = (cur - x) / this.width;
        for (const [nx, ny] of [
          [x + 1, y],
          [x - 1, y],
          [x, y + 1],
          [x, y - 1],
        ]) {
          if (!this.inBounds(nx, ny)) continue;
          const ni = this.idx(nx, ny);
          if (regions[ni] || (this.terrain[ni] === Terrain.Water) !== water) continue;
          regions[ni] = id;
          stack.push(ni);
        }
      }
    }
  }

  /** Same stretch of land (both points on land and connected by terrain). */
  sameLand(ax: number, ay: number, bx: number, by: number): boolean {
    if (!this.inBounds(Math.floor(ax), Math.floor(ay)) || !this.inBounds(Math.floor(bx), Math.floor(by))) return false;
    const a = this.landRegion[this.idx(Math.floor(ax), Math.floor(ay))];
    return a !== 0 && a === this.landRegion[this.idx(Math.floor(bx), Math.floor(by))];
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

  /**
   * Room for a harbour: the whole footprint on free water, touching land on
   * one side (for the builders) and open water on another (for the ships).
   */
  shoreSite(tx: number, ty: number, size: number): boolean {
    for (let y = ty; y < ty + size; y++) {
      for (let x = tx; x < tx + size; x++) {
        if (!this.inBounds(x, y)) return false;
        const i = this.idx(x, y);
        if (this.terrain[i] !== Terrain.Water || this.occupied[i] !== 0) return false;
      }
    }
    let land = 0;
    let water = 0;
    for (let k = 0; k < size; k++) {
      for (const [x, y] of [
        [tx + k, ty - 1],
        [tx + k, ty + size],
        [tx - 1, ty + k],
        [tx + size, ty + k],
      ]) {
        if (!this.inBounds(x, y)) continue;
        if (this.terrain[this.idx(x, y)] === Terrain.Water) {
          if (this.blocked[this.idx(x, y)] === 0) water++;
        } else land++;
      }
    }
    return land > 0 && water >= 2;
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
          const ex = tx + 0.5 - x;
          const ey = ty + 0.5 - y;
          const d = ex * ex + ey * ey;
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
