import type { NodeType } from './entities';
import { Terrain } from './map';
import type { Point } from './pathfinding';
import { valueNoise } from './rng';
import type { World } from './world';

const NODE_AMOUNT: Record<NodeType, number> = {
  tree: 120,
  berries: 200,
  stone: 2500,
  gold: 2500,
  iron: 2500,
};

/**
 * Builds terrain, forests and resource deposits and returns the start
 * positions. Every base gets the same "fair" set of nearby resources,
 * like the classic random maps; the rest of the map is noise-driven.
 */
export function generateMap(w: World): Point[] {
  const { map, rng, settings } = w;
  const W = map.width;
  const H = map.height;
  const seed = settings.seed;
  const m = Math.max(11, Math.round(W * 0.16));
  const corners: Point[] = [
    { x: m, y: m },
    { x: W - m, y: H - m },
    { x: W - m, y: m },
    { x: m, y: H - m },
  ];
  const starts = corners.slice(0, settings.players.length).map((c) => ({
    x: c.x + rng.int(-2, 3) + 0.5,
    y: c.y + rng.int(-2, 3) + 0.5,
  }));
  const distStart = (x: number, y: number) => Math.min(...starts.map((s) => Math.hypot(s.x - x, s.y - y)));

  const water1 = valueNoise(seed * 7 + 1, 14);
  const water2 = valueNoise(seed * 7 + 2, 5);
  const forest1 = valueNoise(seed * 7 + 3, 9);
  const forest2 = valueNoise(seed * 7 + 4, 3.5);
  const shadeN = valueNoise(seed * 7 + 5, 2.5);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = map.idx(x, y);
      const ds = distStart(x + 0.5, y + 0.5);
      const wv = water1(x, y) * 0.75 + water2(x, y) * 0.25;
      let t: Terrain = Terrain.Grass;
      if (ds > 15 && wv > 0.7) t = Terrain.Water;
      else if (ds > 14 && wv > 0.64) t = Terrain.Sand;
      else if (ds < 5.5 + shadeN(x, y) * 2) t = Terrain.Dirt;
      map.terrain[i] = t;
      map.shade[i] = Math.min(3, Math.floor(shadeN(x * 0.9, y * 0.9) * 4));
    }
  }

  const placeNode = (type: NodeType, tx: number, ty: number, size: number): boolean => {
    for (let y = ty; y < ty + size; y++) {
      for (let x = tx; x < tx + size; x++) {
        if (!map.buildable(x, y) || map.terrainAt(x, y) === Terrain.Sand) return false;
        if (distStart(x + 0.5, y + 0.5) < 5.5) return false;
      }
    }
    // Bushes and mines keep a free ring so they can never be fenced in.
    if (type !== 'tree') {
      for (let y = ty - 1; y <= ty + size; y++) {
        for (let x = tx - 1; x <= tx + size; x++) {
          if (!map.passable(x, y)) return false;
        }
      }
    }
    const amount = type === 'tree' ? NODE_AMOUNT.tree + rng.int(-20, 30) : NODE_AMOUNT[type];
    w.addResource(type, tx, ty, size, amount);
    return true;
  };

  const placeMine = (type: NodeType, s: Point, dist: number, angle: number): void => {
    for (let attempt = 0; attempt < 40; attempt++) {
      const a = angle + rng.range(-0.5, 0.5) * (1 + attempt / 10);
      const d = dist + rng.range(-1.5, 1.5);
      if (placeNode(type, Math.floor(s.x + Math.cos(a) * d) - 1, Math.floor(s.y + Math.sin(a) * d) - 1, 2)) return;
    }
  };

  const placeCluster = (type: NodeType, s: Point, dist: number, angle: number, count: number): void => {
    const cx = s.x + Math.cos(angle) * dist;
    const cy = s.y + Math.sin(angle) * dist;
    let placed = 0;
    for (let attempt = 0; attempt < 60 && placed < count; attempt++) {
      if (placeNode(type, Math.floor(cx + rng.range(-2, 2)), Math.floor(cy + rng.range(-2, 2)), 1)) placed++;
    }
  };

  const placeForest = (s: Point, dist: number, angle: number, radius: number): void => {
    const cx = s.x + Math.cos(angle) * dist;
    const cy = s.y + Math.sin(angle) * dist;
    for (let y = Math.floor(cy - radius); y <= cy + radius; y++) {
      for (let x = Math.floor(cx - radius); x <= cx + radius; x++) {
        if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > radius || rng.next() > 0.85) continue;
        if (placeNode('tree', x, y, 1)) map.terrain[map.idx(x, y)] = Terrain.Forest;
      }
    }
  };

  // Fair start resources for every player.
  for (const s of starts) {
    const base = rng.range(0, Math.PI * 2);
    placeCluster('berries', s, 7, base, 7);
    placeMine('gold', s, 10, base + 1.25);
    placeMine('stone', s, 10, base + 2.5);
    placeMine('iron', s, 11, base + 3.75);
    placeForest(s, 12, base + 5, 3.6);
    placeForest(s, 13, base + 3.1, 2.6);
    placeCluster('berries', s, 14, base + 0.6, 6);
  }

  // Open-map forests.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (map.terrainAt(x, y) !== Terrain.Grass || distStart(x + 0.5, y + 0.5) < 11) continue;
      const f = forest1(x, y) * 0.7 + forest2(x, y) * 0.3;
      if (f > 0.64 && rng.next() < 0.9 && placeNode('tree', x, y, 1)) map.terrain[map.idx(x, y)] = Terrain.Forest;
    }
  }

  // Contested deposits across the map.
  const area = W * H;
  const scatter = (type: NodeType, count: number, size: number) => {
    let placed = 0;
    for (let attempt = 0; attempt < count * 40 && placed < count; attempt++) {
      const x = rng.int(2, W - 3);
      const y = rng.int(2, H - 3);
      if (distStart(x, y) < 18) continue;
      if (size === 1) {
        placeCluster(type, { x, y }, 0, 0, 5);
        placed++;
      } else if (placeNode(type, x, y, size)) {
        placed++;
      }
    }
  };
  scatter('gold', Math.round(area / 1500), 2);
  scatter('stone', Math.round(area / 1800), 2);
  scatter('iron', Math.round(area / 1500), 2);
  scatter('berries', Math.round(area / 2200), 1);

  ensureConnected(w, starts);
  w.compact();
  return starts;
}

/** Carves a land bridge between bases that ended up separated by water or forest. */
function ensureConnected(w: World, starts: Point[]): void {
  const { map } = w;
  const W = map.width;
  for (let i = 1; i < starts.length; i++) {
    const seen = new Uint8Array(W * map.height);
    const queue: number[] = [];
    const s0 = map.idx(Math.floor(starts[0].x), Math.floor(starts[0].y));
    queue.push(s0);
    seen[s0] = 1;
    while (queue.length) {
      const cur = queue.pop()!;
      const cx = cur % W;
      const cy = (cur - cx) / W;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (!map.passable(nx, ny)) continue;
        const ni = map.idx(nx, ny);
        if (seen[ni]) continue;
        seen[ni] = 1;
        queue.push(ni);
      }
    }
    const target = starts[i];
    if (seen[map.idx(Math.floor(target.x), Math.floor(target.y))]) continue;
    const a = starts[0];
    const len = Math.hypot(target.x - a.x, target.y - a.y);
    for (let s = 0; s <= len; s += 0.5) {
      const px = a.x + ((target.x - a.x) * s) / len;
      const py = a.y + ((target.y - a.y) * s) / len;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const tx = Math.floor(px) + dx;
          const ty = Math.floor(py) + dy;
          if (!map.inBounds(tx, ty)) continue;
          if (map.terrainAt(tx, ty) === Terrain.Water) map.terrain[map.idx(tx, ty)] = Terrain.Sand;
          for (const n of w.resources) {
            if (!n.dead && tx >= n.tx && tx < n.tx + n.size && ty >= n.ty && ty < n.ty + n.size) w.remove(n);
          }
        }
      }
    }
  }
}
