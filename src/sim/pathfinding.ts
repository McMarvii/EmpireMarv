import { hypot } from './fmath';
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
  return hypot(dx, dy);
}

const SQRT2 = Math.SQRT2;
/** How far string pulling looks ahead along a path, in waypoints. */
const SMOOTH_AHEAD = 24;
/** How much farther than its farthest member a group search still looks for the members' spots, in tiles. */
const SPOT_SLACK = 24;
/** How far from a spot out of reach a group search looks for a reachable one instead. */
const SPOT_RADIUS = 6;
/** Nodes a search expands before it checks whether its goal can be reached at all. */
const PROBE_NODES = 1024;
/** How far from a goal out of reach the nearest reachable place is looked for, in tiles. */
const AREA_RADIUS = 24;
/** Half the width of the corridor a straight walk needs, in tiles. */
const CLEARANCE = 0.3;
/** A straight walk is checked from this far along on. */
const LINE_STEP = 0.2;
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
 * apart from the returned waypoints. Besides single searches: open ground
 * is taken in a straight line without one, a group sent somewhere shares a
 * single search, and goals that cannot be reached at all are told by the
 * map's connected areas instead of a search through everything in reach.
 */
export class Pathfinder {
  private g: Float32Array;
  private parent: Int32Array;
  private gen: Uint32Array;
  private closed: Uint32Array;
  /** Tiles a group search still has to reach, marked with its generation. */
  private wanted: Uint32Array;
  /** Marks one branch of a group search's tree while a route is read off it. */
  private onWay: Uint32Array;
  private stamp = 0;
  private areaCache = new Map<number, { version: number; id: Int32Array }>();
  private queue: Int32Array;
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
    this.wanted = new Uint32Array(n);
    this.onWay = new Uint32Array(n);
    this.queue = new Int32Array(n);
    this.heap = new Int32Array(n * 8);
    this.heapF = new Float32Array(n * 8);
  }

  /**
   * Returns waypoints (tile centers, the last one is the exact goal for point
   * goals). For a goal that cannot be reached, the way to the nearest place
   * in reach (none when standing there already), or, failing that, a partial
   * path towards the closest tile found within the node budget.
   */
  find(sx: number, sy: number, goal: PathGoal, maxNodes = 8000, team = -1, naval = false): Point[] {
    const res = this.search(sx, sy, goal, maxNodes, team, naval);
    return res.direct ? res.tiles : this.smooth({ x: sx, y: sy }, res.tiles, team, naval);
  }

  /**
   * A* proper: the unsmoothed tiles to the goal, or towards the closest
   * reachable tile when the goal is out of reach. `direct`: nothing to
   * smooth (open ground all the way, or no way at all).
   */
  private search(sx: number, sy: number, goal: PathGoal, maxNodes: number, team: number, naval: boolean): { tiles: Point[]; direct: boolean } {
    const map = this.map;
    const pass = (x: number, y: number) => map.passableFor(x, y, team, naval);
    const W = map.width;
    const startX = Math.max(0, Math.min(W - 1, Math.floor(sx)));
    const startY = Math.max(0, Math.min(map.height - 1, Math.floor(sy)));

    let goalTileX = -1;
    let goalTileY = -1;
    if (goal.kind === 'point') {
      // Ships sent inland stop at the nearest water.
      const near = map.nearestPassable(goal.x, goal.y, naval ? 40 : 20, naval);
      if (!near) return { tiles: [], direct: true };
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
      return { tiles: goal.kind === 'point' ? [{ x: goal.x, y: goal.y }] : [], direct: true };
    }
    // Open ground between here and there: the search would end in this very line.
    if (goal.kind === 'point' && goalTileX === Math.floor(goal.x) && goalTileY === Math.floor(goal.y) && this.lineClear({ x: sx, y: sy }, goal, team, naval)) {
      return { tiles: [{ x: goal.x, y: goal.y }], direct: true };
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
    // Most ways are short. A search that runs on asks first whether the goal can be reached at all.
    let limit = Math.min(maxNodes, PROBE_NODES);

    for (;;) {
      if (this.heapSize === 0) break;
      if (expanded >= limit) {
        if (limit === maxNodes) break;
        limit = maxNodes;
        const away = this.outOfReach(startX, startY, goal, goalTileX, goalTileY, team, naval);
        if (away === startIdx) return { tiles: [], direct: true };
        if (away >= 0) return this.search(sx, sy, { kind: 'point', x: (away % W) + 0.5, y: Math.floor(away / W) + 0.5 }, maxNodes, team, naval);
      }
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
        if (!pass(nx, ny)) continue;
        if (dx !== 0 && dy !== 0 && (!pass(cx + dx, cy) || !pass(cx, cy + dy))) continue;
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
    if (end === startIdx) return { tiles: [], direct: true };
    const tiles: Point[] = [];
    for (let i = end; i !== -1 && i !== startIdx; i = this.parent[i]) {
      const x = i % W;
      tiles.push({ x: x + 0.5, y: (i - x) / W + 0.5 });
    }
    tiles.reverse();
    if (found >= 0 && goal.kind === 'point' && pass(Math.floor(goal.x), Math.floor(goal.y))) {
      tiles[tiles.length - 1] = { x: goal.x, y: goal.y };
    }
    return { tiles, direct: false };
  }

  /**
   * Routes for a group sent to one place, each member to its own spot
   * (`goals[i]`, its slot in the formation) around `centre`. Instead of a
   * search per member, one search runs backwards from the centre until it
   * has reached every member and every spot. Each route is read off the
   * tree it leaves: up from the member to where its branch meets the
   * spot's, then down to the spot. A spot out of reach gives way to the
   * nearest reached tile, a centre out of reach (a clearing shut in by
   * woods) to the reachable tile closest to it. Members the search does not
   * reach get null and search on their own.
   */
  groupPaths(starts: Point[], goals: Point[], centre: Point, team = -1, naval = false): Array<Point[] | null> {
    const map = this.map;
    const goalTile = map.nearestPassable(centre.x, centre.y, naval ? 40 : 20, naval);
    if (!goalTile) return starts.map(() => null);
    const goalIdx = goalTile.y * map.width + goalTile.x;
    const out = this.groupTree(starts, goals, goalIdx, team, naval);
    // Members cut off from the centre head for the nearest place they can reach instead.
    const lost = out.flatMap((r, k) => (r ? [] : [k]));
    if (lost.length === 0) return out;
    const near = this.closestReachable(lost.map((k) => starts[k]), goalTile.x, goalTile.y, team, naval);
    if (near < 0 || near === goalIdx) return out;
    const more = this.groupTree(lost.map((k) => starts[k]), lost.map((k) => goals[k]), near, team, naval);
    lost.forEach((k, j) => (out[k] = more[j]));
    return out;
  }

  /**
   * The tile nearest to (gx, gy) that any of the starts can walk to: one
   * search from all of them at once.
   */
  private closestReachable(starts: Point[], gx: number, gy: number, team: number, naval: boolean): number {
    const map = this.map;
    const W = map.width;
    const pass = (x: number, y: number) => map.passableFor(x, y, team, naval);
    const heuristic = (x: number, y: number) => {
      const dx = Math.abs(x - gx);
      const dy = Math.abs(y - gy);
      return Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy);
    };
    const gen = ++this.generation;
    this.heapSize = 0;
    for (const p of starts) {
      const x = Math.floor(p.x);
      const y = Math.floor(p.y);
      if (!pass(x, y)) continue;
      const i = y * W + x;
      if (this.gen[i] === gen) continue;
      this.gen[i] = gen;
      this.g[i] = 0;
      this.push(i, heuristic(x, y));
    }
    let best = -1;
    let bestH = Infinity;
    let expanded = 0;
    while (this.heapSize > 0 && expanded < 8000) {
      const cur = this.pop();
      if (this.closed[cur] === gen) continue;
      this.closed[cur] = gen;
      expanded++;
      const cx = cur % W;
      const cy = (cur - cx) / W;
      const h = heuristic(cx, cy);
      if (h < bestH) {
        bestH = h;
        best = cur;
        if (h === 0) break;
      }
      for (const [dx, dy, cost] of DIRS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (!pass(nx, ny)) continue;
        if (dx !== 0 && dy !== 0 && (!pass(cx + dx, cy) || !pass(cx, cy + dy))) continue;
        const ni = ny * W + nx;
        if (this.closed[ni] === gen) continue;
        const ng = this.g[cur] + cost;
        if (this.gen[ni] !== gen || ng < this.g[ni]) {
          this.gen[ni] = gen;
          this.g[ni] = ng;
          this.push(ni, ng + heuristic(nx, ny) * 1.001);
        }
      }
    }
    return best;
  }

  /** One search back from the goal tile and the routes read off it (null for members it did not reach). */
  private groupTree(starts: Point[], goals: Point[], goalIdx: number, team: number, naval: boolean): Array<Point[] | null> {
    const map = this.map;
    const W = map.width;
    const out: Array<Point[] | null> = starts.map(() => null);
    const pass = (x: number, y: number) => map.passableFor(x, y, team, naval);
    const goalTile = { x: goalIdx % W, y: Math.floor(goalIdx / W) };

    const gen = ++this.generation;
    // Tiles still to reach: members' (marked gen) and spots' (marked gen + 1, unless a member stands there too).
    let members = 0;
    let spots = 0;
    const want = (p: Point, box: Rect, mark: number): number => {
      const x = Math.floor(p.x);
      const y = Math.floor(p.y);
      if (!pass(x, y)) return -1;
      const i = y * W + x;
      if (this.wanted[i] !== gen && this.wanted[i] !== gen + 1) {
        this.wanted[i] = mark;
        if (mark === gen) members++;
        else spots++;
      } else if (this.wanted[i] === gen + 1 && mark === gen) {
        this.wanted[i] = gen;
        spots--;
        members++;
      }
      // Grows the box (kept as corners in x, y, w, h until done).
      box.x = Math.min(box.x, x);
      box.y = Math.min(box.y, y);
      box.w = Math.max(box.w, x);
      box.h = Math.max(box.h, y);
      return i;
    };
    const from: Rect = { x: Infinity, y: Infinity, w: -Infinity, h: -Infinity };
    const to: Rect = { x: Infinity, y: Infinity, w: -Infinity, h: -Infinity };
    const startIdx = starts.map((p) => want(p, from, gen));
    const spotIdx = goals.map((p) => want(p, to, gen + 1));
    // The spots' marks must not be mistaken for the next search's generation.
    this.generation++;
    if (members === 0) return out;
    for (const b of [from, to]) {
      b.w -= b.x;
      b.h -= b.y;
      b.x += 0.5;
      b.y += 0.5;
    }
    // Straight-line distance to the nearer box: never more than the way, so the search stays exact.
    const heuristic = (x: number, y: number) => Math.min(distToRect(x + 0.5, y + 0.5, from), distToRect(x + 0.5, y + 0.5, to));

    this.heapSize = 0;
    this.gen[goalIdx] = gen;
    this.g[goalIdx] = 0;
    this.parent[goalIdx] = -1;
    this.push(goalIdx, heuristic(goalTile.x, goalTile.y));
    // At most the whole map: one search, however large the group.
    const maxNodes = W * map.height;
    let expanded = 0;
    // Spots not reached a little beyond the farthest member lie in pockets cut off (by woods, walls) or only reached the long way round.
    let lastF = Infinity;
    while (this.heapSize > 0 && expanded < maxNodes && (members > 0 || spots > 0)) {
      const f = this.heapF[0];
      const cur = this.pop();
      if (this.closed[cur] === gen) continue;
      if (members === 0 && f > lastF + SPOT_SLACK) break;
      this.closed[cur] = gen;
      expanded++;
      if (this.wanted[cur] === gen) {
        this.wanted[cur] = 0;
        if (--members === 0) lastF = f;
      } else if (this.wanted[cur] === gen + 1) {
        this.wanted[cur] = 0;
        spots--;
      }
      const cx = cur % W;
      const cy = (cur - cx) / W;
      for (const [dx, dy, cost] of DIRS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (!pass(nx, ny)) continue;
        if (dx !== 0 && dy !== 0 && (!pass(cx + dx, cy) || !pass(cx, cy + dy))) continue;
        const ni = ny * W + nx;
        if (this.closed[ni] === gen) continue;
        const ng = this.g[cur] + cost;
        if (this.gen[ni] !== gen || ng < this.g[ni]) {
          this.gen[ni] = gen;
          this.g[ni] = ng;
          this.parent[ni] = cur;
          this.push(ni, ng + heuristic(nx, ny));
        }
      }
    }

    const tile = (i: number): Point => {
      const x = i % W;
      return { x: x + 0.5, y: (i - x) / W + 0.5 };
    };
    const reached = (i: number) => i >= 0 && this.closed[i] === gen;
    for (let k = 0; k < starts.length; k++) {
      const s = startIdx[k];
      if (!reached(s)) continue;
      let e = spotIdx[k];
      let goal = goals[k];
      if (!reached(e)) {
        // The spot is out of reach: the nearest reached tile next to it instead, else the centre.
        e = this.nearestReached(goal, gen);
        if (e < 0) e = goalIdx;
        goal = tile(e);
      }
      // Mark the spot's branch, climb the member's until it meets it, then walk down to the spot.
      const stamp = ++this.stamp;
      for (let i = e; i !== -1; i = this.parent[i]) this.onWay[i] = stamp;
      const route: Point[] = [];
      let meet = s;
      while (this.onWay[meet] !== stamp) {
        meet = this.parent[meet];
        route.push(tile(meet));
      }
      const down: Point[] = [];
      for (let i = e; i !== meet; i = this.parent[i]) down.push(tile(i));
      for (let i = down.length - 1; i >= 0; i--) route.push(down[i]);
      if (route.length === 0) route.push({ x: goal.x, y: goal.y });
      else route[route.length - 1] = { x: goal.x, y: goal.y };
      out[k] = this.smooth(starts[k], route, team, naval);
    }
    return out;
  }

  /**
   * Which stretch of open ground (or water) each tile belongs to, for a
   * team (its gates are open to it): 1, 2, …, and 0 where it cannot go.
   * Two tiles with the same number are connected, so a search between two
   * different numbers would be in vain. Redone when the map changes.
   */
  areas(team: number, naval: boolean): Int32Array {
    const map = this.map;
    const key = naval ? -2 : team;
    let a = this.areaCache.get(key);
    if (a && a.version === map.version) return a.id;
    const W = map.width;
    const H = map.height;
    if (!a) {
      a = { version: -1, id: new Int32Array(W * H) };
      this.areaCache.set(key, a);
    }
    const id = a.id;
    id.fill(0);
    const queue = this.queue;
    let next = 0;
    for (let start = 0; start < W * H; start++) {
      if (id[start] !== 0 || !map.passableFor(start % W, Math.floor(start / W), team, naval)) continue;
      // Diagonal steps need both sides open, so four neighbours connect the same tiles as eight.
      next++;
      id[start] = next;
      let head = 0;
      let tail = 0;
      queue[tail++] = start;
      while (head < tail) {
        const cur = queue[head++];
        const x = cur % W;
        const y = (cur - x) / W;
        for (let k = 0; k < 4; k++) {
          const nx = k === 0 ? x + 1 : k === 1 ? x - 1 : x;
          const ny = k === 2 ? y + 1 : k === 3 ? y - 1 : y;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const ni = ny * W + nx;
          if (id[ni] !== 0 || !map.passableFor(nx, ny, team, naval)) continue;
          id[ni] = next;
          queue[tail++] = ni;
        }
      }
    }
    a.version = map.version;
    return id;
  }

  /**
   * For a goal that cannot be reached from the start (a clearing shut in by
   * woods, another island): the reachable tile nearest to it, to make for
   * instead of searching in vain (the start itself when that is as close as
   * it gets). -1 when the goal can be reached, or nothing nearby can.
   */
  private outOfReach(startX: number, startY: number, goal: PathGoal, goalTileX: number, goalTileY: number, team: number, naval: boolean): number {
    const W = this.map.width;
    const area = this.areas(team, naval);
    const home = area[startY * W + startX];
    if (home === 0) return -1;
    if (goal.kind === 'point' ? area[goalTileY * W + goalTileX] === home : this.rectInArea(area, home, goal.rect, goal.reach)) return -1;
    const cx = goal.kind === 'point' ? goalTileX + 0.5 : goal.rect.x + goal.rect.w / 2;
    const cy = goal.kind === 'point' ? goalTileY + 0.5 : goal.rect.y + goal.rect.h / 2;
    return this.nearestInArea(area, home, cx, cy);
  }

  /** Whether some tile within reach of the rectangle lies in the given area. */
  private rectInArea(area: Int32Array, home: number, r: Rect, reach: number): boolean {
    const W = this.map.width;
    const H = this.map.height;
    const x0 = Math.max(0, Math.floor(r.x - reach - 1));
    const x1 = Math.min(W - 1, Math.ceil(r.x + r.w + reach));
    const y0 = Math.max(0, Math.floor(r.y - reach - 1));
    const y1 = Math.min(H - 1, Math.ceil(r.y + r.h + reach));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (area[y * W + x] === home && distToRect(x + 0.5, y + 0.5, r) <= reach) return true;
      }
    }
    return false;
  }

  /** The tile of an area nearest to a point (by rings, as `nearestPassable`), within AREA_RADIUS; -1 if none. */
  private nearestInArea(area: Int32Array, home: number, px: number, py: number): number {
    const W = this.map.width;
    const H = this.map.height;
    const cx = Math.floor(px);
    const cy = Math.floor(py);
    for (let r = 0; r <= AREA_RADIUS; r++) {
      let best = -1;
      let bestD = Infinity;
      for (let y = cy - r; y <= cy + r; y++) {
        if (y < 0 || y >= H) continue;
        const edge = y === cy - r || y === cy + r;
        for (let x = cx - r; x <= cx + r; x += edge ? 1 : 2 * r) {
          if (x < 0 || x >= W || area[y * W + x] !== home) continue;
          const dx = x + 0.5 - px;
          const dy = y + 0.5 - py;
          const d = dx * dx + dy * dy;
          if (d < bestD) {
            bestD = d;
            best = y * W + x;
          }
          if (r === 0) break;
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  /** The tile closest to a point that the last group search reached, within SPOT_RADIUS; -1 if none. */
  private nearestReached(p: Point, gen: number): number {
    const W = this.map.width;
    const cx = Math.floor(p.x);
    const cy = Math.floor(p.y);
    let best = -1;
    let bestD = Infinity;
    for (let y = Math.max(0, cy - SPOT_RADIUS); y <= Math.min(this.map.height - 1, cy + SPOT_RADIUS); y++) {
      for (let x = Math.max(0, cx - SPOT_RADIUS); x <= Math.min(W - 1, cx + SPOT_RADIUS); x++) {
        const i = y * W + x;
        if (this.closed[i] !== gen) continue;
        const dx = x + 0.5 - p.x;
        const dy = y + 0.5 - p.y;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    }
    return best;
  }

  /**
   * Drops waypoints that are visible from an earlier one (string pulling).
   * Looks at most SMOOTH_AHEAD tiles ahead: on a long winding road the
   * tries from the far end would cost more than the search itself.
   */
  private smooth(start: Point, pts: Point[], team: number, naval: boolean): Point[] {
    if (pts.length <= 2) return pts;
    const out: Point[] = [];
    let anchor = start;
    let i = 0;
    while (i < pts.length) {
      let j = Math.min(pts.length - 1, i + SMOOTH_AHEAD);
      while (j > i && !this.lineClear(anchor, pts[j], team, naval)) j--;
      out.push(pts[j]);
      anchor = pts[j];
      i = j + 1;
    }
    return out;
  }

  /**
   * Whether a unit can walk straight from a to b: every tile the unit's
   * square (CLEARANCE to each side) touches on the way is open, so it does
   * not clip corners. Checks each touched tile once, row by row, from the
   * first step on (a unit nudged against a wall can still walk away from it).
   */
  lineClear(a: Point, b: Point, team = -1, naval = false): boolean {
    const map = this.map;
    const R = CLEARANCE;
    const dist = hypot(b.x - a.x, b.y - a.y);
    const lead = dist > LINE_STEP ? LINE_STEP / dist : 1;
    const ax = a.x + (b.x - a.x) * lead;
    const ay = a.y + (b.y - a.y) * lead;
    const dx = b.x - ax;
    const dy = b.y - ay;
    const r0 = Math.floor(Math.min(ay, b.y) - R);
    const r1 = Math.floor(Math.max(ay, b.y) + R);
    for (let row = r0; row <= r1; row++) {
      // The stretch of the line whose square reaches into this row.
      let xa = Math.min(ax, b.x);
      let xb = Math.max(ax, b.x);
      if (dy !== 0) {
        let t0 = (row - R - ay) / dy;
        let t1 = (row + 1 + R - ay) / dy;
        if (t0 > t1) {
          const t = t0;
          t0 = t1;
          t1 = t;
        }
        t0 = Math.max(0, t0);
        t1 = Math.min(1, t1);
        if (t0 > t1) continue;
        const x0 = ax + dx * t0;
        const x1 = ax + dx * t1;
        xa = Math.min(x0, x1);
        xb = Math.max(x0, x1);
      }
      const c1 = Math.floor(xb + R);
      for (let col = Math.floor(xa - R); col <= c1; col++) {
        if (!map.passableFor(col, row, team, naval)) return false;
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
