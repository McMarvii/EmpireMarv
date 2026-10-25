import type { GameMap } from './map';

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type PathGoal = { kind: 'point'; x: number; y: number } | { kind: 'rect'; rect: Rect; reach: number };

/** Distance from a point to the closest point of a rectangle (0 inside). */
export function distToRect(px: number, py: number, r: Rect): number {
  const dx = Math.max(r.x - px, 0, px - (r.x + r.w));
  const dy = Math.max(r.y - py, 0, py - (r.y + r.h));
  return Math.hypot(dx, dy);
}

const SQRT2 = Math.SQRT2;
const PROBES: Array<[number, number]> = [
  [0, 0],
  [0.3, 0.3],
  [-0.3, -0.3],
  [0.3, -0.3],
  [-0.3, 0.3],
];
const DIRS: Array<[number, number, number]> = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, SQRT2],
  [1, -1, SQRT2],
  [-1, 1, SQRT2],
  [-1, -1, SQRT2],
];

/**
 * A* on the 8-connected tile grid without corner cutting. Buffers are reused
 * between searches via a generation counter, so pathing stays allocation-free
 * apart from the returned waypoints.
 */
export class Pathfinder {
  private g: Float32Array;
  private parent: Int32Array;
  private gen: Uint32Array;
  private closed: Uint32Array;
  private heap: Int32Array;
  private heapF: Float32Array;
  private heapSize = 0;
  private generation = 0;

  constructor(private map: GameMap) {
    const n = map.width * map.height;
    this.g = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.gen = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.heap = new Int32Array(n * 8);
    this.heapF = new Float32Array(n * 8);
  }

  /**
   * Returns waypoints (tile centers, the last one is the exact goal for point
   * goals) or a partial path towards the closest reachable tile when the goal
   * cannot be reached within the node budget.
   */
  find(sx: number, sy: number, goal: PathGoal, maxNodes = 8000): Point[] {
    const map = this.map;
    const W = map.width;
    const startX = Math.max(0, Math.min(W - 1, Math.floor(sx)));
    const startY = Math.max(0, Math.min(map.height - 1, Math.floor(sy)));

    let goalTileX = -1;
    let goalTileY = -1;
    if (goal.kind === 'point') {
      const near = map.nearestPassable(goal.x, goal.y, 20);
      if (!near) return [];
      goalTileX = near.x;
      goalTileY = near.y;
    }

    const isGoal = (x: number, y: number): boolean => {
      if (goal.kind === 'point') return x === goalTileX && y === goalTileY;
      return distToRect(x + 0.5, y + 0.5, goal.rect) <= goal.reach;
    };
    const heuristic = (x: number, y: number): number => {
      if (goal.kind === 'point') {
        const dx = Math.abs(x - goalTileX);
        const dy = Math.abs(y - goalTileY);
        return Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy);
      }
      return Math.max(0, distToRect(x + 0.5, y + 0.5, goal.rect) - goal.reach);
    };

    if (isGoal(startX, startY)) {
      return goal.kind === 'point' ? [{ x: goal.x, y: goal.y }] : [];
    }

    const gen = ++this.generation;
    this.heapSize = 0;
    const startIdx = startY * W + startX;
    this.gen[startIdx] = gen;
    this.g[startIdx] = 0;
    this.parent[startIdx] = -1;
    this.push(startIdx, heuristic(startX, startY));

    let bestIdx = startIdx;
    let bestH = heuristic(startX, startY);
    let found = -1;
    let expanded = 0;

    while (this.heapSize > 0 && expanded < maxNodes) {
      const cur = this.pop();
      if (this.closed[cur] === gen) continue;
      this.closed[cur] = gen;
      expanded++;
      const cx = cur % W;
      const cy = (cur - cx) / W;
      if (isGoal(cx, cy)) {
        found = cur;
        break;
      }
      const h = heuristic(cx, cy);
      if (h < bestH) {
        bestH = h;
        bestIdx = cur;
      }
      for (const [dx, dy, cost] of DIRS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (!map.passable(nx, ny)) continue;
        if (dx !== 0 && dy !== 0 && (!map.passable(cx + dx, cy) || !map.passable(cx, cy + dy))) continue;
        const ni = ny * W + nx;
        if (this.closed[ni] === gen) continue;
        const ng = this.g[cur] + cost;
        if (this.gen[ni] !== gen || ng < this.g[ni]) {
          this.gen[ni] = gen;
          this.g[ni] = ng;
          this.parent[ni] = cur;
          this.push(ni, ng + heuristic(nx, ny) * 1.001);
        }
      }
    }

    const end = found >= 0 ? found : bestIdx;
    if (end === startIdx) return [];
    const tiles: Point[] = [];
    for (let i = end; i !== -1 && i !== startIdx; i = this.parent[i]) {
      const x = i % W;
      tiles.push({ x: x + 0.5, y: (i - x) / W + 0.5 });
    }
    tiles.reverse();
    if (found >= 0 && goal.kind === 'point' && map.passable(Math.floor(goal.x), Math.floor(goal.y))) {
      tiles[tiles.length - 1] = { x: goal.x, y: goal.y };
    }
    return this.smooth({ x: sx, y: sy }, tiles);
  }

  /** Drops waypoints that are visible from an earlier one (string pulling). */
  private smooth(start: Point, pts: Point[]): Point[] {
    if (pts.length <= 2) return pts;
    const out: Point[] = [];
    let anchor = start;
    let i = 0;
    while (i < pts.length) {
      let j = pts.length - 1;
      while (j > i && !this.lineClear(anchor, pts[j])) j--;
      out.push(pts[j]);
      anchor = pts[j];
      i = j + 1;
    }
    return out;
  }

  lineClear(a: Point, b: Point): boolean {
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.ceil(dist / 0.2);
    // Sample the line and a slightly widened corridor so units don't clip corners.
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      for (const [ox, oy] of PROBES) {
        if (!this.map.passable(Math.floor(x + ox), Math.floor(y + oy))) return false;
      }
    }
    return true;
  }

  private push(idx: number, f: number): void {
    let i = this.heapSize++;
    this.heap[i] = idx;
    this.heapF[i] = f;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.heapF[p] <= this.heapF[i]) break;
      this.swap(i, p);
      i = p;
    }
  }

  private pop(): number {
    const top = this.heap[0];
    const last = --this.heapSize;
    if (last > 0) {
      this.heap[0] = this.heap[last];
      this.heapF[0] = this.heapF[last];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < last && this.heapF[l] < this.heapF[m]) m = l;
        if (r < last && this.heapF[r] < this.heapF[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    const t = this.heap[a];
    this.heap[a] = this.heap[b];
    this.heap[b] = t;
    const f = this.heapF[a];
    this.heapF[a] = this.heapF[b];
    this.heapF[b] = f;
  }
}
