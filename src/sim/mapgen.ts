import { resolveMapType, type MapType } from '../data/maps';
import type { NodeType } from './entities';
import { cos, hypot, sin } from './fmath';
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
  fish: 400,
};

type Noise = (x: number, y: number) => number;
/** Land margin at a point: below 0 is water, just above 0 is beach. */
type Shape = (x: number, y: number) => number;

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
  const type = resolveMapType(settings.mapType, seed);
  // The continent keeps its exact recipe (old seeds give the old maps); the others place more carefully.
  const strict = type !== 'continent';
  const steppe = type === 'steppe';
  const m = type === 'coast' ? Math.round(W * 0.25) : Math.max(11, Math.round(W * 0.16));
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
  const distStart = (x: number, y: number) => Math.min(...starts.map((s) => hypot(s.x - x, s.y - y)));

  const water1 = valueNoise(seed * 7 + 1, 14);
  const water2 = valueNoise(seed * 7 + 2, 5);
  const forest1 = valueNoise(seed * 7 + 3, 9);
  const forest2 = valueNoise(seed * 7 + 4, 3.5);
  const shadeN = valueNoise(seed * 7 + 5, 2.5);
  const shape = waterShape(type, W, H, m, starts, water1, valueNoise(seed * 7 + 6, 16));
  // Steppe: fewer and smaller lakes.
  const lakeAt = steppe ? 0.77 : 0.7;
  const shoreAt = steppe ? 0.72 : 0.64;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = map.idx(x, y);
      const ds = distStart(x + 0.5, y + 0.5);
      let t: Terrain = Terrain.Grass;
      if (shape) {
        const lv = ds < 8 ? 99 : shape(x + 0.5, y + 0.5);
        if (lv < 0) t = Terrain.Water;
        else if (lv < 1.4) t = Terrain.Sand;
        else if (ds < 5.5 + shadeN(x, y) * 2) t = Terrain.Dirt;
      } else {
        const wv = water1(x, y) * 0.75 + water2(x, y) * 0.25;
        if (ds > 15 && wv > lakeAt) t = Terrain.Water;
        else if (ds > 14 && wv > shoreAt) t = Terrain.Sand;
        else if (ds < 5.5 + shadeN(x, y) * 2) t = Terrain.Dirt;
      }
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
      if (placeNode(type, Math.floor(s.x + cos(a) * d) - 1, Math.floor(s.y + sin(a) * d) - 1, 2)) return;
    }
    // Water in the way: anywhere around the base will do.
    for (let attempt = 0; strict && attempt < 80; attempt++) {
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(7, 15);
      if (placeNode(type, Math.floor(s.x + cos(a) * d) - 1, Math.floor(s.y + sin(a) * d) - 1, 2)) return;
    }
  };

  const placeCluster = (type: NodeType, s: Point, dist: number, angle: number, count: number): void => {
    let placed = 0;
    for (let round = 0; round < (strict ? 6 : 1) && placed < count; round++) {
      const a = angle + round * 1.1;
      const cx = s.x + cos(a) * dist;
      const cy = s.y + sin(a) * dist;
      for (let attempt = 0; attempt < 60 && placed < count; attempt++) {
        if (placeNode(type, Math.floor(cx + rng.range(-2, 2)), Math.floor(cy + rng.range(-2, 2)), 1)) placed++;
      }
    }
  };

  const placeForest = (s: Point, dist: number, angle: number, radius: number): void => {
    // On water maps a forest that mostly fell into the sea grows somewhere else.
    const wanted = strict ? radius * radius * 1.4 : 0;
    let placed = 0;
    for (let round = 0; round < (strict ? 6 : 1) && placed <= wanted; round++) {
      const a = angle + round * 1.3;
      const cx = s.x + cos(a) * dist;
      const cy = s.y + sin(a) * dist;
      for (let y = Math.floor(cy - radius); y <= cy + radius; y++) {
        for (let x = Math.floor(cx - radius); x <= cx + radius; x++) {
          if (hypot(x + 0.5 - cx, y + 0.5 - cy) > radius || rng.next() > 0.85) continue;
          if (placeNode('tree', x, y, 1)) {
            map.terrain[map.idx(x, y)] = Terrain.Forest;
            placed++;
          }
        }
      }
    }
  };

  /** Fish on open water: never next to other fish, so boats always get through. */
  const placeFish = (tx: number, ty: number): boolean => {
    if (!map.inBounds(tx, ty) || map.terrainAt(tx, ty) !== Terrain.Water) return false;
    for (let y = ty - 1; y <= ty + 1; y++) {
      for (let x = tx - 1; x <= tx + 1; x++) {
        if (map.inBounds(x, y) && map.blocked[map.idx(x, y)]) return false;
      }
    }
    w.addResource('fish', tx, ty, 1, NODE_AMOUNT.fish);
    return true;
  };

  /** Fishing grounds off the nearest shore of a base. */
  const placeFishing = (s: Point, grounds: number, maxDist: number): void => {
    const coast: Array<{ x: number; y: number; d: number }> = [];
    const r = Math.ceil(maxDist);
    for (let y = Math.floor(s.y) - r; y <= s.y + r; y++) {
      for (let x = Math.floor(s.x) - r; x <= s.x + r; x++) {
        if (!map.inBounds(x, y) || map.terrainAt(x, y) !== Terrain.Water) continue;
        const d = hypot(x + 0.5 - s.x, y + 0.5 - s.y);
        if (d < 7 || d > maxDist || landWithin(x, y, 2) === 0) continue;
        coast.push({ x, y, d });
      }
    }
    coast.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
    const centers: Point[] = [];
    for (const c of coast) {
      if (centers.length >= grounds) break;
      if (centers.some((o) => hypot(o.x - c.x, o.y - c.y) < 7)) continue;
      centers.push(c);
    }
    for (const c of centers) {
      let placed = 0;
      for (let attempt = 0; attempt < 40 && placed < 3; attempt++) {
        if (placeFish(c.x + rng.int(-2, 3), c.y + rng.int(-2, 3))) placed++;
      }
    }
  };

  /** Land tiles in the square around a tile, to tell shore from open sea. */
  const landWithin = (tx: number, ty: number, r: number): number => {
    let n = 0;
    for (let y = ty - r; y <= ty + r; y++) {
      for (let x = tx - r; x <= tx + r; x++) {
        if (map.inBounds(x, y) && map.terrainAt(x, y) !== Terrain.Water) n++;
      }
    }
    return n;
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

  // The mine island in the middle of the island map.
  if (type === 'islands') {
    const reach = W * 0.055;
    for (const t of ['gold', 'iron', 'stone'] as NodeType[]) {
      for (let attempt = 0; attempt < 60; attempt++) {
        const x = Math.floor(W / 2 + rng.range(-reach, reach)) - 1;
        const y = Math.floor(H / 2 + rng.range(-reach, reach)) - 1;
        if (placeNode(t, x, y, 2)) break;
      }
    }
  }

  // Fish: grounds near every base, more out on the open water.
  if (type === 'coast' || type === 'inlandSea' || type === 'islands' || type === 'rivers') {
    for (const s of starts) placeFishing(s, type === 'rivers' ? 1 : 2, shoreReach(type, W) + 2);
    let water = 0;
    for (let i = 0; i < W * H; i++) if (map.terrain[i] === Terrain.Water) water++;
    const want = Math.round(water / 260);
    let placed = 0;
    for (let attempt = 0; attempt < want * 30 && placed < want; attempt++) {
      const x = rng.int(1, W - 1);
      const y = rng.int(1, H - 1);
      if (distStart(x, y) < 12 || landWithin(x, y, 2) > 0) continue;
      if (placeFish(x, y)) placed++;
    }
  }

  // Open-map forests.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (map.terrainAt(x, y) !== Terrain.Grass || distStart(x + 0.5, y + 0.5) < 11) continue;
      const f = forest1(x, y) * 0.7 + forest2(x, y) * 0.3;
      if (f > (steppe ? 0.73 : 0.64) && rng.next() < 0.9 && placeNode('tree', x, y, 1)) map.terrain[map.idx(x, y)] = Terrain.Forest;
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
  // The steppe makes up for its few trees with more to dig and pick.
  const plenty = steppe ? 1.6 : 1;
  scatter('gold', Math.round((area / 1500) * plenty), 2);
  scatter('stone', Math.round((area / 1800) * plenty), 2);
  scatter('iron', Math.round((area / 1500) * plenty), 2);
  scatter('berries', Math.round((area / 2200) * plenty), 1);

  // Islands stay apart: that is the point of them.
  if (type !== 'islands') ensureConnected(w, starts);
  w.compact();
  map.computeRegions();
  return starts;
}

/** How far from its base every player finds a shore (harbour site and fish) on water maps. */
export function shoreReach(type: MapType, W: number): number {
  return type === 'rivers' ? W * 0.34 + 6 : W * 0.16 + 6;
}

/**
 * Where the water lies on the map types with a fixed layout, as a land
 * margin per point (below 0: water). Continent and steppe use lakes from
 * noise instead and get null.
 */
function waterShape(type: MapType, W: number, H: number, m: number, starts: Point[], noise: Noise, bends: Noise): Shape | null {
  const edge = (x: number, y: number) => Math.min(x, y, W - x, H - y);
  const center = (x: number, y: number) => hypot(x - W / 2, y - H / 2);
  switch (type) {
    case 'continent':
    case 'steppe':
      return null;
    case 'coast':
      // An ocean all round, a little ragged.
      return (x, y) => edge(x, y) - (W * 0.1 + noise(x, y) * W * 0.06);
    case 'inlandSea': {
      // The shore runs at the same distance from every corner base, a little further on bigger maps.
      const base = (W / 2 - m) * Math.SQRT2;
      return (x, y) => center(x, y) - (base - (W * 0.14 + 2) + (noise(x, y) - 0.5) * W * 0.07);
    }
    case 'islands': {
      // One island per player, kept apart by a strait (Voronoi with a gap), plus a small one in the middle.
      const rMid = W * 0.055 + 1;
      return (x, y) => {
        let d1 = Infinity;
        let d2 = Infinity;
        for (const s of starts) {
          const d = hypot(x - s.x, y - s.y);
          if (d < d1) {
            d2 = d1;
            d1 = d;
          } else if (d < d2) d2 = d;
        }
        const radius = W * 0.19 + 4 + noise(x, y) * W * 0.09 + (bends(x * 3, y * 3) - 0.5) * 3;
        const dc = center(x, y);
        const own = Math.min(radius - d1, (d2 - d1 - 7) / 2, edge(x, y) - 5, dc - (rMid + 1.5 + 7));
        const mid = rMid + noise(x * 1.7, y * 1.7) * 1.5 - dc;
        return Math.max(own, mid);
      };
    }
    case 'rivers': {
      // Two winding rivers cross in the middle; every arm has fords.
      const arms = [0, 1, 2, 3].map((k) => W * (0.17 + bends(k * 13.7, 3.3) * 0.13));
      return (x, y) => {
        const rx = W / 2 + (bends(0.5, y) - 0.5) * 12;
        const ry = H / 2 + (bends(x, 40.5) - 0.5) * 12;
        const half = 1.9 + bends(x * 0.5 + 7, y * 0.5 + 7) * 0.6;
        const dv = Math.abs(x - rx);
        const dh = Math.abs(y - ry);
        if (dv < half + 1) {
          const along = y < H / 2 ? H / 2 - y : y - H / 2;
          if (Math.abs(along - arms[y < H / 2 ? 0 : 1]) < 1.6) return 0.5;
        }
        if (dh < half + 1) {
          const along = x < W / 2 ? W / 2 - x : x - W / 2;
          if (Math.abs(along - arms[x < W / 2 ? 2 : 3]) < 1.6) return 0.5;
        }
        return Math.min(dv, dh) - half;
      };
    }
  }
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
    const len = hypot(target.x - a.x, target.y - a.y);
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
