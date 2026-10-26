import { BUILDING_DEFS, type BuildingType } from '../data/buildings';
import { rectOf, type Building, type Entity, type ResourceNode, type Unit } from '../sim/entities';
import { Terrain } from '../sim/map';
import type { World } from '../sim/world';
import { Camera, TILE_W } from './camera';
import { TERRAIN_COLORS } from './colors';
import { buildingTopZ, drawBuilding, drawNode, drawUnit, LINK_E, LINK_N, LINK_S, LINK_W } from './sprites';

export interface LineSegment {
  tx: number;
  ty: number;
  valid: boolean;
}

export interface Placement {
  type: BuildingType;
  tx: number;
  ty: number;
  valid: boolean;
  /** Walls and gates: where the drag started, and the segments planned so far. */
  anchor?: { tx: number; ty: number } | null;
  line?: LineSegment[] | null;
}

/** Neighbour bitmask of a wall tile, from a tile → owner lookup. */
function linkMask(at: (x: number, y: number) => boolean, tx: number, ty: number): number {
  let m = 0;
  if (at(tx, ty - 1)) m |= LINK_N;
  if (at(tx + 1, ty)) m |= LINK_E;
  if (at(tx, ty + 1)) m |= LINK_S;
  if (at(tx - 1, ty)) m |= LINK_W;
  return m;
}

/** Short-lived click feedback ring at a world position. */
export interface Marker {
  x: number;
  y: number;
  t: number;
  color: string;
}

export interface RenderState {
  selection: Set<number>;
  hoverId: number;
  placement: Placement | null;
  /** Interpolation factor between the previous and the current tick. */
  alpha: number;
  time: number;
  marker: Marker | null;
}

export const UNIT_SCALE = 1.8;

/** Draws the world isometrically onto a canvas, honouring the local player's fog of war. */
export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;

  constructor(
    private canvas: HTMLCanvasElement,
    private world: World,
    readonly camera: Camera,
    private me: number,
  ) {
    this.ctx = canvas.getContext('2d')!;
  }

  resize(width: number, height: number): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.camera.viewW = width;
    this.camera.viewH = height;
  }

  private unitPos(u: Unit, alpha: number): [number, number] {
    return [u.px + (u.x - u.px) * alpha, u.py + (u.y - u.py) * alpha];
  }

  /** Tile range covering the screen, with a margin for tall sprites. */
  private visibleRange() {
    const cam = this.camera;
    const corners = [
      cam.screenToWorld(0, 0),
      cam.screenToWorld(cam.viewW, 0),
      cam.screenToWorld(0, cam.viewH + 160 * cam.zoom),
      cam.screenToWorld(cam.viewW, cam.viewH + 160 * cam.zoom),
    ];
    const size = this.world.map.width;
    return {
      x0: Math.max(0, Math.floor(Math.min(...corners.map((c) => c.x))) - 2),
      x1: Math.min(size - 1, Math.ceil(Math.max(...corners.map((c) => c.x))) + 2),
      y0: Math.max(0, Math.floor(Math.min(...corners.map((c) => c.y))) - 2),
      y1: Math.min(size - 1, Math.ceil(Math.max(...corners.map((c) => c.y))) + 2),
    };
  }

  private onScreen(sx: number, sy: number, margin: number): boolean {
    return sx > -margin && sy > -margin && sx < this.camera.viewW + margin && sy < this.camera.viewH + margin * 2;
  }

  render(state: RenderState): void {
    const { ctx, world, camera } = this;
    const project = camera.project;
    const zoom = camera.zoom;
    const vis = world.players[this.me].vis;
    const map = world.map;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // The canvas has a CSS background, so clearing is enough (and much cheaper than a fill).
    ctx.clearRect(0, 0, camera.viewW, camera.viewH);

    // --- terrain, batched per colour ---------------------------------------
    const range = this.visibleRange();
    const paths = new Map<string, Path2D>();
    const fogPath = new Path2D();
    const blackPath = new Path2D();
    const addTile = (path: Path2D, x: number, y: number) => {
      const [ax, ay] = project(x, y);
      const [bx, by] = project(x + 1, y);
      const [cx, cy] = project(x + 1, y + 1);
      const [dx, dy] = project(x, y + 1);
      path.moveTo(ax, ay - 0.5);
      path.lineTo(bx + 0.5, by);
      path.lineTo(cx, cy + 0.5);
      path.lineTo(dx - 0.5, dy);
      path.closePath();
    };
    const waterPhase = Math.floor(state.time * 1.2);
    for (let y = range.y0; y <= range.y1; y++) {
      for (let x = range.x0; x <= range.x1; x++) {
        const i = map.idx(x, y);
        const [sx, sy] = project(x + 0.5, y + 0.5);
        if (!this.onScreen(sx, sy, TILE_W * zoom)) continue;
        const v = vis[i];
        if (v === 0) {
          addTile(blackPath, x, y);
          continue;
        }
        const t = map.terrain[i];
        const shadeIdx = t === Terrain.Water ? (map.shade[i] + waterPhase + ((x + y) >> 2)) % 4 : map.shade[i];
        const color = TERRAIN_COLORS[t][shadeIdx];
        let p = paths.get(color);
        if (!p) {
          p = new Path2D();
          paths.set(color, p);
        }
        addTile(p, x, y);
        if (v === 1) addTile(fogPath, x, y);
      }
    }
    for (const [color, p] of paths) {
      ctx.fillStyle = color;
      ctx.fill(p);
    }
    // Unexplored ground goes black before sprites, so trees on the border keep their crowns.
    ctx.fillStyle = '#07090c';
    ctx.fill(blackPath);

    // --- ground layer: farms, selection rings, rally points ---------------
    const drawables: Array<{ depth: number; draw: () => void }> = [];
    const time = state.time;
    // Tiles of visible walls, gates and towers, so wall segments can join up.
    const joins = new Map<number, number>();
    for (const b of world.buildings) {
      if (b.dead || !(BUILDING_DEFS[b.type].line || b.type === 'tower') || !world.isVisibleTo(this.me, b)) continue;
      for (let y = b.ty; y < b.ty + b.size; y++) for (let x = b.tx; x < b.tx + b.size; x++) joins.set(y * map.width + x, b.owner);
    }
    for (const b of world.buildings) {
      if (!world.isVisibleTo(this.me, b)) continue;
      const [sx, sy] = project(b.x, b.y);
      if (!this.onScreen(sx, sy, b.size * TILE_W * zoom)) continue;
      const line = BUILDING_DEFS[b.type].line;
      const look = {
        type: b.type,
        epoch: b.epoch,
        color: world.players[b.owner].color,
        tx: b.tx,
        ty: b.ty,
        size: b.size,
        progress: b.progress,
        built: b.built,
        hpRatio: b.hp / b.maxHp,
        seed: b.id,
        links: line ? linkMask((x, y) => map.inBounds(x, y) && joins.get(y * map.width + x) === b.owner, b.tx, b.ty) : 0,
        open: BUILDING_DEFS[b.type].gate ? this.gateOpen(b) : false,
      };
      const selected = state.selection.has(b.id) || state.hoverId === b.id;
      if (selected) this.footprint(b.tx, b.ty, b.size, this.ringColor(b.owner), state.selection.has(b.id) ? 2 : 1);
      if (BUILDING_DEFS[b.type].walkable) {
        drawBuilding(ctx, project, zoom, look, time);
      } else {
        drawables.push({ depth: b.tx + b.ty + b.size, draw: () => drawBuilding(ctx, project, zoom, look, time) });
      }
      if (state.selection.has(b.id) && b.owner === this.me && b.rally) {
        const [rx, ry] = project(b.rally.x, b.rally.y);
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(rx, ry);
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(rx, ry);
        ctx.lineTo(rx, ry - 16 * zoom);
        ctx.strokeStyle = '#eee';
        ctx.stroke();
        ctx.fillStyle = world.players[this.me].color;
        ctx.fillRect(rx, ry - 16 * zoom, 9 * zoom, 6 * zoom);
      }
    }

    for (const n of world.resources) {
      if (n.dead) continue;
      const i = map.idx(Math.floor(n.x), Math.floor(n.y));
      if (vis[i] === 0) continue;
      const [sx, sy] = project(n.x, n.y);
      if (!this.onScreen(sx, sy, 80 * zoom)) continue;
      if (state.hoverId === n.id || state.selection.has(n.id)) this.footprint(n.tx, n.ty, n.size, '#ffd24d', 1);
      const look = { nodeType: n.nodeType, tx: n.tx, ty: n.ty, size: n.size, ratio: n.amount / n.maxHp, variant: n.variant };
      drawables.push({ depth: n.tx + n.ty + n.size, draw: () => drawNode(ctx, project, zoom, look, time) });
    }

    const unitScale = zoom * UNIT_SCALE;
    for (const u of world.units) {
      if (u.dead || (u.owner !== this.me && !world.inSight(this.me, u))) continue;
      const [x, y] = this.unitPos(u, state.alpha);
      const [sx, sy] = project(x, y);
      if (!this.onScreen(sx, sy, 60 * zoom)) continue;
      if (state.selection.has(u.id) || state.hoverId === u.id) {
        ctx.beginPath();
        ctx.ellipse(sx, sy, 9 * unitScale * (u.role === 'mounted' || u.role === 'siege' ? 1.4 : 1), 4.5 * unitScale, 0, 0, Math.PI * 2);
        ctx.strokeStyle = this.ringColor(u.owner);
        ctx.lineWidth = state.selection.has(u.id) ? 2 : 1;
        ctx.stroke();
      }
      const working = (u.order.kind === 'gather' && u.order.phase === 'work') || (u.order.kind === 'build' && u.attackAnim > 0);
      const look = {
        look: u.stats.look,
        epoch: u.stats.epoch,
        color: world.players[u.owner].color,
        facing: u.facing,
        moving: u.moving,
        attackAnim: u.order.kind === 'attack' ? u.attackAnim : 0,
        working,
        carry: u.carryAmount > 0 ? u.carry : null,
        seed: u.id,
      };
      drawables.push({ depth: x + y, draw: () => drawUnit(ctx, project, unitScale, x, y, look, time) });
    }

    drawables.sort((a, b) => a.depth - b.depth);
    for (const d of drawables) d.draw();

    this.drawProjectiles(state);
    this.drawEffects();

    // Explored but unseen ground (and what is remembered there) is dimmed.
    ctx.fillStyle = 'rgba(5,8,12,0.5)';
    ctx.fill(fogPath);

    this.drawBars(state);
    if (state.placement) this.drawPlacement(state.placement, time);
    if (state.marker) {
      const m = state.marker;
      const [sx, sy] = project(m.x, m.y);
      const r = Math.max(0, 1 - m.t / 0.6) * 14 * zoom;
      ctx.beginPath();
      ctx.ellipse(sx, sy, r, r / 2, 0, 0, Math.PI * 2);
      ctx.strokeStyle = m.color;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  /** Gates swing open while a unit of the owner's team is close. */
  private gateOpen(b: Building): boolean {
    const team = this.world.teamOf(b.owner);
    let open = false;
    this.world.forUnitsNear(b.x, b.y, 1.5, (u) => {
      if (!open && this.world.teamOf(u.owner) === team && Math.hypot(u.x - b.x, u.y - b.y) < 1.4) open = true;
    });
    return open;
  }

  private tileVisible(x: number, y: number): boolean {
    const map = this.world.map;
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    return map.inBounds(tx, ty) && this.world.players[this.me].vis[map.idx(tx, ty)] === 2;
  }

  private ringColor(owner: number): string {
    if (owner === this.me) return '#8dff5a';
    if (owner < 0) return '#ffd24d';
    return this.world.areEnemies(this.me, owner) ? '#ff5a4d' : '#5ad1ff';
  }

  private footprint(tx: number, ty: number, size: number, color: string, width: number): void {
    const p = this.camera.project;
    const ctx = this.ctx;
    ctx.beginPath();
    const pts = [p(tx, ty), p(tx + size, ty), p(tx + size, ty + size), p(tx, ty + size)];
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (const [x, y] of pts.slice(1)) ctx.lineTo(x, y);
    ctx.closePath();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  private drawProjectiles(state: RenderState): void {
    const { ctx, camera } = this;
    const project = camera.project;
    const zoom = camera.zoom;
    for (const p of this.world.projectiles) {
      const t = Math.min(1, (p.t + state.alpha * 0.05) / p.dur);
      const x = p.x0 + (p.x1 - p.x0) * t;
      const y = p.y0 + (p.y1 - p.y0) * t;
      const dist = Math.hypot(p.x1 - p.x0, p.y1 - p.y0);
      const arcH = p.kind === 'boulder' || p.kind === 'shell' ? dist * 9 : p.kind === 'arrow' || p.kind === 'stone' ? dist * 4 : 0;
      const z = 14 + arcH * 4 * t * (1 - t);
      const [sx, sy] = project(x, y, z);
      if (p.owner !== this.me && !this.tileVisible(x, y)) continue;
      switch (p.kind) {
        case 'arrow': {
          const [px, py] = project(x - (p.x1 - p.x0) * 0.04, y - (p.y1 - p.y0) * 0.04, z - arcH * 0.1 * (1 - 2 * t));
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(sx, sy);
          ctx.strokeStyle = '#3a2a1a';
          ctx.lineWidth = 1.4 * zoom;
          ctx.stroke();
          break;
        }
        case 'bullet': {
          const [px, py] = project(x - (p.x1 - p.x0) * 0.06, y - (p.y1 - p.y0) * 0.06, z);
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(sx, sy);
          ctx.strokeStyle = '#ffe28a';
          ctx.lineWidth = 1.5 * zoom;
          ctx.stroke();
          break;
        }
        case 'laser': {
          const [ax, ay] = project(p.x0, p.y0, 16);
          const [bx, by] = project(p.x1, p.y1, 10);
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
          ctx.strokeStyle = 'rgba(120,240,255,0.85)';
          ctx.lineWidth = 2.5 * zoom;
          ctx.stroke();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 0.8 * zoom;
          ctx.stroke();
          break;
        }
        default: {
          const r = p.kind === 'boulder' ? 3.5 : p.kind === 'shell' ? 2.2 : 1.6;
          ctx.beginPath();
          ctx.arc(sx, sy, r * zoom, 0, Math.PI * 2);
          ctx.fillStyle = p.kind === 'shell' ? '#2b2b2b' : '#7d776c';
          ctx.fill();
        }
      }
    }
  }

  private drawEffects(): void {
    const { ctx, camera } = this;
    const zoom = camera.zoom;
    for (const fx of this.world.effects) {
      const [sx, sy] = camera.project(fx.x, fx.y, 6);
      const k = fx.t / fx.dur;
      switch (fx.kind) {
        case 'explosion': {
          const r = (8 + fx.size * 18 * k) * zoom;
          ctx.beginPath();
          ctx.arc(sx, sy, r, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255,${Math.round(200 - 140 * k)},60,${0.8 * (1 - k)})`;
          ctx.fill();
          ctx.beginPath();
          ctx.arc(sx, sy - r * 0.6, r * 0.8, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(80,80,80,${0.45 * (1 - k)})`;
          ctx.fill();
          break;
        }
        case 'laserhit':
          ctx.beginPath();
          ctx.arc(sx, sy, (4 + 10 * k) * zoom, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(150,245,255,${0.8 * (1 - k)})`;
          ctx.fill();
          break;
        case 'hit':
          ctx.beginPath();
          ctx.arc(sx, sy, (2 + 4 * k) * zoom, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255,240,200,${0.7 * (1 - k)})`;
          ctx.fill();
          break;
        case 'collapse':
        case 'dust': {
          for (let i = 0; i < 6; i++) {
            const a = i * 1.05;
            const r = fx.size * 14 * zoom * (0.4 + k);
            ctx.beginPath();
            ctx.arc(sx + Math.cos(a) * r, sy + Math.sin(a) * r * 0.5 - k * 20 * zoom, (6 + 10 * k) * zoom * fx.size * 0.5, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(140,125,100,${0.5 * (1 - k)})`;
            ctx.fill();
          }
          break;
        }
      }
    }
  }

  private drawBars(state: RenderState): void {
    const { ctx, camera, world } = this;
    const zoom = camera.zoom;
    const bar = (sx: number, sy: number, w: number, ratio: number, color: string) => {
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(sx - w / 2 - 1, sy - 1, w + 2, 5);
      ctx.fillStyle = color;
      ctx.fillRect(sx - w / 2, sy, w * Math.max(0, Math.min(1, ratio)), 3);
    };
    const hpColor = (r: number) => (r > 0.6 ? '#5ee05a' : r > 0.3 ? '#f2c84b' : '#ef4b3c');
    for (const u of world.units) {
      if (u.dead) continue;
      const selected = state.selection.has(u.id);
      const damaged = u.hp < u.maxHp && world.tick - u.lastHitTick < 100;
      if (!selected && !damaged) continue;
      if (u.owner !== this.me && !world.inSight(this.me, u)) continue;
      const [x, y] = this.unitPos(u, state.alpha);
      const tall = u.role === 'mounted' || u.role === 'siege' ? 34 : 30;
      const [sx, sy] = camera.project(x, y, tall * UNIT_SCALE);
      bar(sx, sy, 22 * zoom, u.hp / u.maxHp, hpColor(u.hp / u.maxHp));
    }
    for (const b of world.buildings) {
      if (b.dead || !world.isVisibleTo(this.me, b)) continue;
      const selected = state.selection.has(b.id);
      if (!selected && b.built && (b.hp >= b.maxHp || world.tick - b.lastHitTick > 100)) continue;
      const [sx, sy] = camera.project(b.x, b.y, buildingTopZ(b.type, b.epoch, b.size));
      const w = Math.min(90, b.size * 22) * zoom;
      if (!b.built) bar(sx, sy - 7, w, b.progress, '#d7b46a');
      bar(sx, sy, w, b.hp / b.maxHp, hpColor(b.hp / b.maxHp));
      if (selected && b.research) bar(sx, sy + 6, w, b.research.progress / b.research.total, '#7fb6ff');
    }
  }

  private drawPlacement(p: Placement, time: number): void {
    if (p.line && p.line.length) {
      const planned = new Set(p.line.map((s) => `${s.tx},${s.ty}`));
      for (const seg of p.line) {
        const links = linkMask((x, y) => planned.has(`${x},${y}`), seg.tx, seg.ty);
        this.drawGhost(p.type, seg.tx, seg.ty, seg.valid, time, links);
      }
      return;
    }
    this.drawGhost(p.type, p.tx, p.ty, p.valid, time, BUILDING_DEFS[p.type].line ? LINK_E | LINK_W : 0);
  }

  private drawGhost(type: BuildingType, tx: number, ty: number, valid: boolean, time: number, links: number): void {
    const p = { type, tx, ty, valid };
    const size = BUILDING_DEFS[p.type].size;
    const ctx = this.ctx;
    const project = this.camera.project;
    ctx.save();
    ctx.globalAlpha = 0.55;
    drawBuilding(
      ctx,
      project,
      this.camera.zoom,
      {
        type: p.type,
        epoch: this.world.players[this.me].epoch,
        color: this.world.players[this.me].color,
        tx: p.tx,
        ty: p.ty,
        size,
        progress: 1,
        built: true,
        hpRatio: 1,
        seed: 0,
        links,
      },
      time,
    );
    ctx.restore();
    const pts = [project(p.tx, p.ty), project(p.tx + size, p.ty), project(p.tx + size, p.ty + size), project(p.tx, p.ty + size)];
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (const [x, y] of pts.slice(1)) ctx.lineTo(x, y);
    ctx.closePath();
    ctx.fillStyle = p.valid ? 'rgba(90,230,90,0.25)' : 'rgba(240,70,60,0.35)';
    ctx.fill();
    ctx.strokeStyle = p.valid ? '#8dff5a' : '#ff5a4d';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  /**
   * Entity under a screen point. Units win over buildings, buildings over
   * resources, and among equals the one drawn in front.
   */
  pick(sx: number, sy: number, alpha: number): Entity | null {
    const { world, camera } = this;
    const zoom = camera.zoom;
    let best: Entity | null = null;
    let bestDepth = -Infinity;
    for (const u of world.units) {
      if (u.dead || (u.owner !== this.me && !world.inSight(this.me, u))) continue;
      const [x, y] = this.unitPos(u, alpha);
      const [px, py] = camera.project(x, y);
      const w = (u.role === 'mounted' || u.role === 'siege' ? 14 : 9) * UNIT_SCALE * zoom;
      const h = (u.role === 'siege' ? 22 : 28) * UNIT_SCALE * zoom;
      if (sx >= px - w && sx <= px + w && sy >= py - h && sy <= py + 4 * zoom && x + y > bestDepth) {
        best = u;
        bestDepth = x + y;
      }
    }
    if (best) return best;
    const world2 = camera.screenToWorld(sx, sy);
    const hitsSprite = (e: Building | ResourceNode, height: number) => {
      const r = rectOf(e);
      const left = camera.project(r.x, r.y + r.h)[0];
      const right = camera.project(r.x + r.w, r.y)[0];
      const top = camera.project(r.x, r.y, height)[1];
      const bottom = camera.project(r.x + r.w, r.y + r.h)[1];
      if (sx < left || sx > right || sy < top || sy > bottom) return false;
      // Inside the footprint, or above it within the sprite's height.
      const inside = world2.x >= r.x && world2.x <= r.x + r.w && world2.y >= r.y && world2.y <= r.y + r.h;
      const [cx] = camera.project(e.x, e.y);
      return inside || Math.abs(sx - cx) < ((right - left) / 2) * 0.75;
    };
    for (const b of world.buildings) {
      if (b.dead || !world.isVisibleTo(this.me, b)) continue;
      const depth = b.tx + b.ty + b.size;
      if (depth > bestDepth && hitsSprite(b, buildingTopZ(b.type, b.epoch, b.size))) {
        best = b;
        bestDepth = depth;
      }
    }
    if (best) return best;
    const vis = world.players[this.me].vis;
    for (const n of world.resources) {
      if (n.dead || vis[world.map.idx(Math.floor(n.x), Math.floor(n.y))] === 0) continue;
      const depth = n.tx + n.ty + n.size;
      if (depth > bestDepth && hitsSprite(n, n.nodeType === 'tree' ? 64 : 28)) {
        best = n;
        bestDepth = depth;
      }
    }
    return best;
  }

  /** Screen position of a unit, used for box selection. */
  screenPosOf(u: Unit, alpha: number): [number, number] {
    const [x, y] = this.unitPos(u, alpha);
    return this.camera.project(x, y, 10);
  }
}

