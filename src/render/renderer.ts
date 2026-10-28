import { STATUSES, STRATEGIST_AURA, WARRIOR_AURA } from '../data/abilities';
import { BUILDING_DEFS, MORALE_RADIUS, type BuildingType } from '../data/buildings';
import { isNaval, MAX_FAITH } from '../data/units';
import { convertTime, orderTarget } from '../sim/behavior';
import { rectOf, type Building, type Entity, type Hazard, type Order, type Plan, type ResourceNode, type Unit } from '../sim/entities';
import { hasStatus } from '../sim/status';
import { Terrain } from '../sim/map';
import type { Point } from '../sim/pathfinding';
import type { World } from '../sim/world';
import { Camera, TILE_W } from './camera';
import { ABILITY_COLOR, alpha as withAlpha, TERRAIN_COLORS } from './colors';
import { buildingTopZ, drawBuilding, drawNode, drawUnit, LINK_E, LINK_N, LINK_S, LINK_W } from './sprites';
import type { View } from './view';

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

/** Whether a point lies inside a convex polygon given in either winding. */
function inConvex(pts: Array<[number, number]>, [px, py]: [number, number]): boolean {
  let sign = 0;
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[(i + 1) % pts.length];
    const cross = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
    if (cross === 0) continue;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return true;
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

/** How long an ally's mark stays on the map (s). */
export const MARK_TIME = 6;

/** A spot an ally pointed out (Alt+click). */
export interface Mark {
  x: number;
  y: number;
  color: string;
  /** Seconds since it was set. */
  age: number;
}

/** Cast mode: the area under the cursor and how far the casters reach. */
export interface CastPreview {
  at: Point | null;
  /** Area radius in tiles (0: a single target). */
  r: number;
  color: string;
  casters: Point[];
  range: number;
}

/** Right-drag with units: target, direction arrow and the planned slots. */
export interface OrderPreview {
  from: Point;
  to: Point;
  slots: Point[];
}

export interface RenderState {
  selection: Set<number>;
  hoverId: number;
  placement: Placement | null;
  /** Interpolation factor between the previous and the current tick. */
  alpha: number;
  time: number;
  marker: Marker | null;
  /** Shift held: show every selected unit's plans, not only queues and patrols. */
  showPlans: boolean;
  preview: OrderPreview | null;
  marks: Mark[];
  cast: CastPreview | null;
}

/** Waypoint colours by what happens there. */
function planColor(o: Order | Plan): string {
  switch (o.kind) {
    case 'move':
      return o.attackMove ? '#ff7a5a' : '#8dff5a';
    case 'attack':
    case 'patrol':
      return '#ff5a4d';
    case 'gather':
    case 'deposit':
      return '#ffd24d';
    case 'build':
      return '#5ab4ff';
    default:
      return '#c9a6ff';
  }
}

export const UNIT_SCALE = 1.8;

/** Riders and vehicles get wider selection rings and hit boxes. */
function wide(u: Unit): boolean {
  return u.role === 'mounted' || u.role === 'siege' || u.stats.look === 'scouthorse' || u.stats.look === 'jeep' || u.stats.look === 'drone';
}

/** Draws the world isometrically onto a canvas, honouring the local player's fog of war. */
export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;

  constructor(
    private canvas: HTMLCanvasElement,
    private world: World,
    readonly camera: Camera,
    private view: View,
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
    const vis = this.view.vis();
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
    // Screen outlines of solid buildings, and things that may hide behind them.
    const hulls: Array<{ depth: number; pts: Array<[number, number]> }> = [];
    const ghosts: Array<{ depth: number; probes: Array<[number, number]>; draw: () => void; ring?: string }> = [];
    const time = state.time;
    // Tiles of visible walls, gates and towers, so wall segments can join up.
    const joins = new Map<number, number>();
    for (const b of world.buildings) {
      if (b.dead || !(BUILDING_DEFS[b.type].line || b.type === 'tower') || !this.view.sees(b)) continue;
      for (let y = b.ty; y < b.ty + b.size; y++) for (let x = b.tx; x < b.tx + b.size; x++) joins.set(y * map.width + x, b.owner);
    }
    for (const b of world.buildings) {
      if (!this.view.sees(b)) continue;
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
        counting: b.type === 'wonder' && b.built && b.countdown > 0,
      };
      const selected = state.selection.has(b.id) || state.hoverId === b.id;
      if (selected) this.footprint(b.tx, b.ty, b.size, this.ringColor(b.owner), state.selection.has(b.id) ? 2 : 1);
      // Morale reach of houses: when one is selected and while a new one is being placed.
      if (b.type === 'house' && b.owner === this.view.me && b.built && (state.selection.has(b.id) || state.placement?.type === 'house')) {
        this.moraleRing(b.x, b.y, state.selection.has(b.id) ? 0.9 : 0.5);
      }
      if (BUILDING_DEFS[b.type].walkable) {
        drawBuilding(ctx, project, zoom, look, time);
      } else {
        drawables.push({ depth: b.tx + b.ty + b.size, draw: () => drawBuilding(ctx, project, zoom, look, time) });
        const top = buildingTopZ(b.type, b.epoch, b.size) * (b.built ? 1 : Math.min(1, b.progress * 1.2));
        const e = b.size;
        hulls.push({
          depth: b.tx + b.ty + e,
          pts: [
            project(b.tx, b.ty + e),
            project(b.tx + e, b.ty + e),
            project(b.tx + e, b.ty),
            project(b.tx + e, b.ty, top),
            project(b.tx, b.ty, top),
            project(b.tx, b.ty + e, top),
          ],
        });
      }
      if (state.selection.has(b.id) && b.owner === this.view.me && b.rally.length) {
        // Rally chain: dashed line through the waypoints, flag at the end.
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        for (const p of b.rally) ctx.lineTo(...project(p.x, p.y));
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.setLineDash([]);
        for (const p of b.rally.slice(0, -1)) {
          const [wx, wy] = project(p.x, p.y);
          ctx.beginPath();
          ctx.ellipse(wx, wy, 3 * zoom, 1.5 * zoom, 0, 0, Math.PI * 2);
          ctx.fillStyle = '#eee';
          ctx.fill();
        }
        const last = b.rally[b.rally.length - 1];
        const [rx, ry] = project(last.x, last.y);
        ctx.beginPath();
        ctx.moveTo(rx, ry);
        ctx.lineTo(rx, ry - 16 * zoom);
        ctx.strokeStyle = '#eee';
        ctx.stroke();
        ctx.fillStyle = world.players[this.view.me].color;
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
      const drawIt = () => drawNode(ctx, project, zoom, look, time);
      drawables.push({ depth: n.tx + n.ty + n.size, draw: drawIt });
      if (n.nodeType !== 'tree') ghosts.push({ depth: n.tx + n.ty + n.size, probes: [project(n.x, n.y, 4), project(n.x, n.y, 14)], draw: drawIt });
    }

    const unitScale = zoom * UNIT_SCALE;
    for (const u of world.units) {
      if (u.dead || !this.view.seesUnit(u)) continue;
      const [x, y] = this.unitPos(u, state.alpha);
      const [sx, sy] = project(x, y);
      if (!this.onScreen(sx, sy, 60 * zoom)) continue;
      if (state.selection.has(u.id) || state.hoverId === u.id) {
        ctx.beginPath();
        const ring = isNaval(u.role) ? 2.3 : wide(u) ? 1.4 : 1;
        ctx.ellipse(sx, sy, 9 * unitScale * ring, 4.5 * unitScale * (ring > 2 ? 1.6 : 1), 0, 0, Math.PI * 2);
        ctx.strokeStyle = this.ringColor(u.owner);
        ctx.lineWidth = state.selection.has(u.id) ? 2 : 1;
        ctx.stroke();
      }
      if (state.selection.has(u.id) && u.owner === this.view.me && (u.role === 'strategist' || u.role === 'warrior')) {
        this.areaRing(x, y, u.role === 'strategist' ? STRATEGIST_AURA : WARRIOR_AURA, u.role === 'strategist' ? '#f2c84b' : '#ff7a3c', 0.55, true);
      }
      const working = (u.order.kind === 'gather' && u.order.phase === 'work') || (u.order.kind === 'build' && u.attackAnim > 0);
      const look = {
        look: u.stats.look,
        epoch: u.stats.epoch,
        color: world.players[u.owner].color,
        facing: u.facing,
        moving: u.moving,
        // Gatherers and builders use the timer for their tool swing.
        attackAnim: u.order.kind === 'gather' || u.order.kind === 'build' ? 0 : u.attackAnim,
        working,
        carry: u.carryAmount > 0 ? u.carry : null,
        seed: u.id,
        cargo: u.cargo.length,
      };
      const drawIt = () => drawUnit(ctx, project, unitScale, x, y, look, time);
      drawables.push({ depth: x + y, draw: drawIt });
      ghosts.push({ depth: x + y, probes: [project(x, y, 4), project(x, y, 14 * UNIT_SCALE)], draw: drawIt, ring: world.players[u.owner].color });
    }

    drawables.sort((a, b) => a.depth - b.depth);
    for (const d of drawables) d.draw();

    // X-ray: whatever stands behind a building shows through it.
    for (const g of ghosts) {
      if (!hulls.some((h) => h.depth > g.depth && g.probes.some((p) => inConvex(h.pts, p)))) continue;
      ctx.save();
      ctx.globalAlpha = 0.5;
      g.draw();
      ctx.restore();
      if (g.ring) {
        const [fx, fy] = g.probes[0];
        ctx.beginPath();
        ctx.ellipse(fx, fy + 4 * zoom, 7 * unitScale, 3.5 * unitScale, 0, 0, Math.PI * 2);
        ctx.strokeStyle = g.ring;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    this.drawHazards(time);
    this.drawBeams(state, time);
    this.drawStatuses(state, time);
    this.drawProjectiles(state);
    this.drawEffects();

    // Explored but unseen ground (and what is remembered there) is dimmed.
    ctx.fillStyle = 'rgba(5,8,12,0.5)';
    ctx.fill(fogPath);

    this.drawPlans(state);
    this.drawBars(state);
    if (state.placement) this.drawPlacement(state.placement, time);
    if (state.preview) this.drawPreview(state.preview);
    if (state.cast) this.drawCast(state.cast, time);
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
    for (const m of state.marks) this.drawMark(m);
  }

  /** A circle of `r` tiles on the ground; dashed for reaches, solid for areas. */
  private areaRing(x: number, y: number, r: number, color: string, strength: number, dashed: boolean, fill = 0.06): void {
    const { ctx, camera } = this;
    const [sx, sy] = camera.project(x, y);
    const k = Math.SQRT2 * r * camera.zoom;
    ctx.beginPath();
    ctx.ellipse(sx, sy, k * 32, k * 16, 0, 0, Math.PI * 2);
    if (fill > 0) {
      ctx.fillStyle = withAlpha(color, fill * strength);
      ctx.fill();
    }
    if (dashed) ctx.setLineDash([6, 5]);
    ctx.strokeStyle = withAlpha(color, 0.8 * strength);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /** Calamities at work: plague clouds, earthquake cracks, fire and storms. */
  private drawHazards(time: number): void {
    const { ctx, camera, world } = this;
    const zoom = camera.zoom;
    for (const hz of world.hazards) {
      if (hz.until <= world.tick) continue;
      if (hz.owner !== this.view.me && !this.tileVisible(hz.x, hz.y)) continue;
      const life = (world.tick - hz.start) / Math.max(1, hz.until - hz.start);
      const fade = Math.min(1, (hz.until - world.tick) / 12, (world.tick - hz.start + 1) / 6);
      ctx.save();
      ctx.globalAlpha = Math.max(0, fade);
      this.drawHazard(hz, life, time, zoom);
      ctx.restore();
    }
  }

  private drawHazard(hz: Hazard, life: number, time: number, zoom: number): void {
    const { ctx, camera } = this;
    const [sx, sy] = camera.project(hz.x, hz.y);
    const k = Math.SQRT2 * hz.r * zoom;
    const rx = k * 32;
    const ry = k * 16;
    // Stable pseudo-random spots inside the area, per hazard.
    const spot = (i: number): [number, number] => {
      const a = (hz.id * 7.13 + i * 2.39) % (Math.PI * 2);
      const d = 0.25 + (((hz.id * 13 + i * 37) % 70) / 100);
      return [sx + Math.cos(a) * rx * d, sy + Math.sin(a) * ry * d];
    };
    const ground = (color: string) => {
      ctx.beginPath();
      ctx.ellipse(sx, sy, rx, ry, 0, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    };
    switch (hz.kind) {
      case 'plague': {
        ground('rgba(120,170,40,0.16)');
        for (let i = 0; i < 9; i++) {
          const [px, py] = spot(i);
          const drift = Math.sin(time * 0.8 + i) * 6 * zoom;
          const r = (10 + 5 * Math.sin(time * 1.3 + i * 1.7)) * zoom;
          ctx.beginPath();
          ctx.arc(px + drift, py - 10 * zoom, r, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(150,200,60,0.22)';
          ctx.fill();
        }
        break;
      }
      case 'quake': {
        ground('rgba(90,60,30,0.2)');
        // Cracks spreading from the centre as the quake goes on.
        ctx.strokeStyle = 'rgba(40,25,10,0.85)';
        ctx.lineWidth = 2 * zoom;
        const reach = Math.min(1, 0.3 + life * 1.5);
        for (let i = 0; i < 7; i++) {
          const a = (i * Math.PI * 2) / 7 + hz.id;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          for (let j = 1; j <= 4; j++) {
            const d = (j / 4) * reach;
            const wob = (((hz.id + i * 5 + j * 11) % 9) - 4) * 0.05;
            ctx.lineTo(sx + Math.cos(a + wob) * rx * d, sy + Math.sin(a + wob) * ry * d);
          }
          ctx.stroke();
        }
        for (let i = 0; i < 5; i++) {
          const [px, py] = spot(i);
          const t = (time * 1.4 + i * 0.3) % 1;
          ctx.beginPath();
          ctx.arc(px, py - t * 14 * zoom, (5 + t * 8) * zoom, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(140,115,80,${0.45 * (1 - t)})`;
          ctx.fill();
        }
        break;
      }
      case 'firestorm': {
        ground('rgba(255,110,20,0.2)');
        const flame = (px: number, py: number, h: number, w: number, color: string) => {
          ctx.beginPath();
          ctx.moveTo(px, py - h);
          ctx.quadraticCurveTo(px + w, py - h * 0.35, px, py);
          ctx.quadraticCurveTo(px - w, py - h * 0.35, px, py - h);
          ctx.fillStyle = color;
          ctx.fill();
        };
        for (let i = 0; i < 14; i++) {
          const [px, py] = spot(i);
          const h = (16 + 8 * Math.sin(time * 9 + i * 1.3)) * zoom;
          flame(px, py, h, 6 * zoom, 'rgba(255,100,20,0.85)');
          flame(px, py, h * 0.6, 3.5 * zoom, 'rgba(255,220,110,0.95)');
          // Embers drifting up.
          const t = (time * 1.2 + i * 0.27) % 1;
          ctx.beginPath();
          ctx.arc(px + Math.sin(time * 3 + i) * 4 * zoom, py - h - t * 20 * zoom, 1.4 * zoom, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255,180,60,${1 - t})`;
          ctx.fill();
        }
        break;
      }
      case 'storm': {
        ground('rgba(90,140,170,0.16)');
        ctx.strokeStyle = 'rgba(200,235,245,0.7)';
        ctx.lineWidth = 2 * zoom;
        for (let i = 0; i < 3; i++) {
          const a0 = time * 2.4 + (i * Math.PI * 2) / 3;
          ctx.beginPath();
          ctx.ellipse(sx, sy - 6 * zoom, rx * (0.35 + i * 0.22), ry * (0.35 + i * 0.22), 0, a0, a0 + 2.2);
          ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(170,200,230,0.5)';
        ctx.lineWidth = 1 * zoom;
        for (let i = 0; i < 14; i++) {
          const [px, py] = spot(i);
          const t = (time * 2.5 + i * 0.19) % 1;
          ctx.beginPath();
          ctx.moveTo(px + 4 * zoom, py - (40 - t * 36) * zoom);
          ctx.lineTo(px, py - (30 - t * 36) * zoom);
          ctx.stroke();
        }
        break;
      }
    }
  }

  /** Priests at work: a golden beam to the unit they pray for, a green one to their patient. */
  private drawBeams(state: RenderState, time: number): void {
    const { ctx, camera, world } = this;
    const zoom = camera.zoom;
    for (const u of world.units) {
      if (u.dead || (u.order.kind !== 'convert' && u.order.kind !== 'heal') || u.attackAnim <= 0) continue;
      const t = world.get(u.order.targetId);
      if (!t || t.kind !== 'unit' || !this.view.seesUnit(u) || !this.view.seesUnit(t)) continue;
      const [ux, uy] = this.unitPos(u, state.alpha);
      const [tx, ty] = this.unitPos(t, state.alpha);
      const [ax, ay] = camera.project(ux, uy, 26 * UNIT_SCALE);
      const [bx, by] = camera.project(tx, ty, 12 * UNIT_SCALE);
      const convert = u.order.kind === 'convert';
      const color = convert ? ABILITY_COLOR.convert : ABILITY_COLOR.heal;
      const pulse = 0.5 + 0.5 * Math.sin(time * 8 + u.id);
      ctx.beginPath();
      const mx = (ax + bx) / 2;
      const my = (ay + by) / 2 - 12 * zoom;
      ctx.moveTo(ax, ay);
      ctx.quadraticCurveTo(mx + Math.sin(time * 5) * 6 * zoom, my, bx, by);
      ctx.strokeStyle = withAlpha(color, 0.35 + 0.35 * pulse);
      ctx.lineWidth = (3 + pulse * 2) * zoom;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 1 * zoom;
      ctx.stroke();
      if (u.order.kind === 'convert' && u.order.progress > 0) {
        // Progress ring around the unit being won over.
        const [cx, cy] = camera.project(tx, ty);
        const share = Math.min(1, u.order.progress / convertTime(world, t));
        ctx.beginPath();
        ctx.ellipse(cx, cy, 10 * UNIT_SCALE * zoom, 5 * UNIT_SCALE * zoom, 0, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * share);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }

  /** Stunned, shielded, plagued, hastened, raging and slowed units show it. */
  private drawStatuses(state: RenderState, time: number): void {
    const { ctx, camera, world } = this;
    const zoom = camera.zoom;
    const s = UNIT_SCALE * zoom;
    for (const u of world.units) {
      if (u.dead || !this.view.seesUnit(u)) continue;
      let any = false;
      for (const st of STATUSES) if ((u.status[st] ?? 0) > world.tick) any = true;
      if (!any) continue;
      const [x, y] = this.unitPos(u, state.alpha);
      const [fx, fy] = camera.project(x, y);
      if (!this.onScreen(fx, fy, 60 * zoom)) continue;
      if (hasStatus(world, u, 'shield')) {
        ctx.beginPath();
        ctx.ellipse(fx, fy - 11 * s, 9 * s, 13 * s, 0, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(127,178,255,${0.12 + 0.06 * Math.sin(time * 4 + u.id)})`;
        ctx.fill();
        ctx.strokeStyle = 'rgba(160,200,255,0.65)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
      if (hasStatus(world, u, 'frenzy')) {
        ctx.beginPath();
        ctx.ellipse(fx, fy - 10 * s, 7 * s, 12 * s, 0, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,59,59,${0.16 + 0.1 * Math.sin(time * 10 + u.id)})`;
        ctx.fill();
      }
      if (hasStatus(world, u, 'haste')) {
        ctx.strokeStyle = 'rgba(242,200,75,0.8)';
        ctx.lineWidth = 1.2;
        for (let i = 0; i < 2; i++) {
          const t = (time * 3 + i * 0.5 + u.id * 0.1) % 1;
          ctx.beginPath();
          ctx.moveTo(fx - (6 + t * 6) * s, fy - (4 + i * 6) * s);
          ctx.lineTo(fx - (12 + t * 6) * s, fy - (4 + i * 6) * s);
          ctx.stroke();
        }
      }
      if (hasStatus(world, u, 'slow')) {
        ctx.beginPath();
        const a = time * 4 + u.id;
        ctx.ellipse(fx, fy - 1 * s, 8 * s, 3.5 * s, 0, a, a + 4);
        ctx.strokeStyle = 'rgba(111,214,232,0.8)';
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }
      if (hasStatus(world, u, 'plague')) {
        for (let i = 0; i < 3; i++) {
          const t = (time * 0.9 + i * 0.33 + u.id * 0.07) % 1;
          ctx.beginPath();
          ctx.arc(fx + (i - 1) * 4 * s, fy - (10 + t * 16) * s, (1.2 + t * 1.6) * s, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(156,207,60,${0.8 * (1 - t)})`;
          ctx.fill();
        }
      }
      if (hasStatus(world, u, 'stun')) {
        const hy = fy - 26 * s * (u.role === 'warrior' || u.role === 'strategist' ? 1.18 : 1);
        for (let i = 0; i < 3; i++) {
          const a = time * 5 + (i * Math.PI * 2) / 3;
          const px = fx + Math.cos(a) * 6 * s;
          const py = hy + Math.sin(a) * 2 * s;
          ctx.fillStyle = '#ffe27a';
          ctx.beginPath();
          for (let j = 0; j < 8; j++) {
            const r = (j % 2 === 0 ? 2.2 : 0.9) * s;
            const b = (j * Math.PI) / 4;
            if (j === 0) ctx.moveTo(px + Math.cos(b) * r, py + Math.sin(b) * r);
            else ctx.lineTo(px + Math.cos(b) * r, py + Math.sin(b) * r);
          }
          ctx.closePath();
          ctx.fill();
        }
      }
    }
  }

  /** Cast mode: the reach of the selected casters and the area under the cursor. */
  private drawCast(c: CastPreview, time: number): void {
    for (const p of c.casters.slice(0, 8)) this.areaRing(p.x, p.y, c.range, c.color, 0.45, true, 0);
    if (!c.at || c.r <= 0) return;
    const inReach = c.casters.some((p) => Math.hypot(p.x - c.at!.x, p.y - c.at!.y) <= c.range);
    this.areaRing(c.at.x, c.at.y, c.r, c.color, inReach ? 0.9 + 0.1 * Math.sin(time * 6) : 0.55, false, 0.28);
  }

  /** An ally's mark: rings pulsing outwards around a small flag. */
  private drawMark(m: Mark): void {
    const { ctx, camera } = this;
    const [sx, sy] = camera.project(m.x, m.y);
    const zoom = camera.zoom;
    ctx.save();
    ctx.globalAlpha = Math.min(1, (MARK_TIME - m.age) / 1.5);
    ctx.strokeStyle = m.color;
    ctx.lineWidth = 2.5;
    for (let i = 0; i < 2; i++) {
      const t = (m.age * 0.8 + i * 0.5) % 1;
      ctx.globalAlpha = Math.min(1, (MARK_TIME - m.age) / 1.5) * (1 - t);
      ctx.beginPath();
      ctx.ellipse(sx, sy, (6 + t * 30) * zoom, (3 + t * 15) * zoom, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = Math.min(1, (MARK_TIME - m.age) / 1.5);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx, sy - 34 * zoom);
    ctx.stroke();
    ctx.fillStyle = m.color;
    ctx.beginPath();
    ctx.moveTo(sx, sy - 34 * zoom);
    ctx.lineTo(sx + 16 * zoom, sy - 28 * zoom);
    ctx.lineTo(sx, sy - 22 * zoom);
    ctx.fill();
    ctx.restore();
  }

  /** Dashed ground circle showing how far a house's morale bonus reaches. */
  private moraleRing(x: number, y: number, strength: number): void {
    const { ctx, camera } = this;
    const [sx, sy] = camera.project(x, y);
    const k = Math.SQRT2 * MORALE_RADIUS * camera.zoom;
    ctx.beginPath();
    ctx.ellipse(sx, sy, k * 32, k * 16, 0, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(242,200,75,${0.08 * strength})`;
    ctx.fill();
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = `rgba(242,200,75,${0.75 * strength})`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
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
    return map.inBounds(tx, ty) && this.view.vis()[map.idx(tx, ty)] === 2;
  }

  private ringColor(owner: number): string {
    if (owner === this.view.me) return '#8dff5a';
    if (owner < 0) return '#ffd24d';
    return this.world.areEnemies(this.view.me, owner) ? '#ff5a4d' : '#5ad1ff';
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
      if (p.owner !== this.view.me && !this.tileVisible(x, y)) continue;
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
        case 'sink': {
          // A hull going down: spreading rings, bubbles, a few planks left floating.
          const [gx, gy] = camera.project(fx.x, fx.y);
          for (let i = 0; i < 3; i++) {
            const t = Math.min(1, k * 1.4 + i * 0.12);
            ctx.beginPath();
            ctx.ellipse(gx, gy, (8 + 30 * t) * zoom * fx.size, (4 + 15 * t) * zoom * fx.size, 0, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(225,242,255,${(0.6 * (1 - t)).toFixed(3)})`;
            ctx.lineWidth = 1.5 * zoom;
            ctx.stroke();
          }
          if (k < 0.45) {
            // The last of the hull, tipping under.
            const d = k / 0.45;
            ctx.save();
            ctx.translate(gx, gy + d * 6 * zoom);
            ctx.rotate(-0.5 * d);
            ctx.fillStyle = `rgba(90,62,34,${(1 - d).toFixed(3)})`;
            ctx.fillRect(-14 * zoom * fx.size, -6 * zoom * (1 - d), 28 * zoom * fx.size, 6 * zoom * (1 - d));
            ctx.restore();
          }
          for (let i = 0; i < 6; i++) {
            const a = i * 1.9 + fx.x;
            const bx = gx + Math.cos(a) * (6 + 14 * k) * zoom * fx.size;
            const by = gy + Math.sin(a) * (3 + 7 * k) * zoom * fx.size;
            if (i % 2) {
              ctx.fillStyle = `rgba(120,86,52,${(0.9 * (1 - k)).toFixed(3)})`;
              ctx.fillRect(bx - 3 * zoom, by - 1 * zoom, 6 * zoom, 2 * zoom);
            } else {
              ctx.beginPath();
              ctx.arc(bx, by - k * 6 * zoom, (1 + 1.5 * (1 - k)) * zoom, 0, Math.PI * 2);
              ctx.fillStyle = `rgba(235,248,255,${(0.7 * (1 - k)).toFixed(3)})`;
              ctx.fill();
            }
          }
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
        case 'ring': {
          const color = fx.ability ? ABILITY_COLOR[fx.ability] : '#ffffff';
          const [gx, gy] = camera.project(fx.x, fx.y);
          const r = Math.SQRT2 * fx.size * (0.25 + 0.75 * k) * zoom;
          ctx.beginPath();
          ctx.ellipse(gx, gy, r * 32, r * 16, 0, 0, Math.PI * 2);
          ctx.strokeStyle = withAlpha(color, 0.9 * (1 - k));
          ctx.lineWidth = 3 * (1 - k) + 1;
          ctx.stroke();
          ctx.fillStyle = withAlpha(color, 0.15 * (1 - k));
          ctx.fill();
          break;
        }
        case 'convert': {
          // A burst of golden light and rays.
          const [gx, gy] = camera.project(fx.x, fx.y, 14 * UNIT_SCALE);
          ctx.beginPath();
          ctx.arc(gx, gy, (6 + 18 * k) * zoom, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255,226,122,${0.55 * (1 - k)})`;
          ctx.fill();
          ctx.strokeStyle = `rgba(255,240,180,${0.9 * (1 - k)})`;
          ctx.lineWidth = 1.5;
          for (let i = 0; i < 8; i++) {
            const a = (i * Math.PI) / 4;
            ctx.beginPath();
            ctx.moveTo(gx + Math.cos(a) * 8 * zoom, gy + Math.sin(a) * 8 * zoom);
            ctx.lineTo(gx + Math.cos(a) * (12 + 22 * k) * zoom, gy + Math.sin(a) * (12 + 22 * k) * zoom);
            ctx.stroke();
          }
          break;
        }
        case 'heal': {
          // Small green crosses rising.
          ctx.fillStyle = `rgba(125,255,138,${0.9 * (1 - k)})`;
          for (let i = 0; i < 3; i++) {
            const [gx, gy] = camera.project(fx.x, fx.y, (12 + k * 26 + i * 6) * UNIT_SCALE * 0.6);
            const px = gx + (i - 1) * 7 * zoom;
            const a = 1.2 * zoom;
            const b = 3.5 * zoom;
            ctx.fillRect(px - a, gy - b, a * 2, b * 2);
            ctx.fillRect(px - b, gy - a, b * 2, a * 2);
          }
          break;
        }
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

  /**
   * Waypoints of selected own units: the current target and every queued
   * order, joined by dashed lines in the colour of what happens there.
   * Patrols are drawn as a closed loop. Larger groups get one line through
   * the middle of their slots and a dot per unit, instead of a web.
   */
  private drawPlans(state: RenderState): void {
    const { ctx, world, camera } = this;
    const zoom = camera.zoom;
    const routes: Array<{ start: Point; steps: Array<{ p: Point; color: string }>; loop: Point[] }> = [];
    for (const id of state.selection) {
      const u = world.get(id);
      if (!u || u.kind !== 'unit' || u.owner !== this.view.me) continue;
      const patrol = u.order.kind === 'patrol' ? u.order : u.order.kind === 'attack' && u.order.resume?.kind === 'patrol' ? u.order.resume : null;
      if (!state.showPlans && u.queue.length === 0 && !patrol) continue;
      const steps: Array<{ p: Point; color: string }> = [];
      const current = orderTarget(world, u.order);
      if (current) steps.push({ p: current, color: planColor(u.order) });
      for (const plan of u.queue) {
        const t = orderTarget(world, plan);
        if (t) steps.push({ p: t, color: planColor(plan) });
      }
      routes.push({ start: { x: u.x, y: u.y }, steps, loop: patrol && patrol.points.length > 1 ? patrol.points : [] });
    }
    if (!routes.length) return;
    const line = (pts: Point[], color: string, alpha: number, width: number, close = false) => {
      ctx.beginPath();
      pts.forEach((p, i) => {
        const [x, y] = camera.project(p.x, p.y);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      if (close) ctx.closePath();
      ctx.strokeStyle = color;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = width;
      ctx.stroke();
    };
    const dot = (p: Point, color: string, r: number) => {
      const [x, y] = camera.project(p.x, p.y);
      ctx.beginPath();
      ctx.ellipse(x, y, r * zoom, (r / 2) * zoom, 0, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.9;
      ctx.fill();
    };
    const mid = (pts: Point[]) => ({ x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length });
    ctx.setLineDash([5, 4]);
    if (routes.length <= 4) {
      for (const r of routes) {
        let from = r.start;
        for (const s of r.steps) {
          line([from, s.p], s.color, 0.7, 1.5);
          from = s.p;
        }
        if (r.loop.length) line(r.loop, '#ff5a4d', 0.45, 1.5, true);
      }
    } else {
      // One route through the middle of the group's slots.
      let from = mid(routes.map((r) => r.start));
      const longest = Math.max(...routes.map((r) => r.steps.length));
      for (let i = 0; i < longest; i++) {
        const at = routes.filter((r) => r.steps.length > i);
        const to = mid(at.map((r) => r.steps[i].p));
        line([from, to], at[0].steps[i].color, 0.8, 2.5);
        from = to;
      }
      const loops = routes.filter((r) => r.loop.length);
      const n = loops[0]?.loop.length ?? 0;
      if (n && loops.every((r) => r.loop.length === n)) {
        line(
          Array.from({ length: n }, (_, j) => mid(loops.map((r) => r.loop[j]))),
          '#ff5a4d',
          0.5,
          2,
          true,
        );
      }
    }
    ctx.setLineDash([]);
    for (const r of routes) for (const s of r.steps) dot(s.p, s.color, routes.length <= 4 ? 4 : 2.5);
    ctx.globalAlpha = 1;
  }

  /** Right-drag preview: an arrow along the front direction and the slots each unit will take. */
  private drawPreview(pv: OrderPreview): void {
    const { ctx, camera } = this;
    const zoom = camera.zoom;
    for (const s of pv.slots) {
      const [x, y] = camera.project(s.x, s.y);
      ctx.beginPath();
      ctx.ellipse(x, y, 6 * zoom, 3 * zoom, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(141,255,90,0.18)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(141,255,90,0.85)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    const [ax, ay] = camera.project(pv.from.x, pv.from.y);
    const [bx, by] = camera.project(pv.to.x, pv.to.y);
    const ang = Math.atan2(by - ay, bx - ax);
    const head = 14 * Math.max(0.7, zoom);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.moveTo(bx, by);
    ctx.lineTo(bx - head * Math.cos(ang - 0.45), by - head * Math.sin(ang - 0.45));
    ctx.moveTo(bx, by);
    ctx.lineTo(bx - head * Math.cos(ang + 0.45), by - head * Math.sin(ang + 0.45));
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.strokeStyle = '#8dff5a';
    ctx.lineWidth = 2.5;
    ctx.stroke();
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
      if (!this.view.seesUnit(u)) continue;
      const [x, y] = this.unitPos(u, state.alpha);
      const tall = wide(u) ? 34 : 30;
      const [sx, sy] = camera.project(x, y, tall * UNIT_SCALE);
      bar(sx, sy, 22 * zoom, u.hp / u.maxHp, hpColor(u.hp / u.maxHp));
      const maxFaith = MAX_FAITH[u.role];
      if (selected && maxFaith && !this.world.areEnemies(this.view.me, u.owner)) bar(sx, sy + 5, 22 * zoom, u.faith / maxFaith, '#c78bff');
      // Morale: one gold pip per house in reach, right of the bar.
      if (selected && u.morale > 0 && u.owner === this.view.me) {
        for (let i = 0; i < u.morale; i++) {
          const px = sx + 11 * zoom + 3 + i * 4;
          ctx.fillStyle = 'rgba(0,0,0,0.65)';
          ctx.fillRect(px - 1, sy - 1, 5, 5);
          ctx.fillStyle = '#f2c84b';
          ctx.fillRect(px, sy, 3, 3);
        }
      }
    }
    for (const b of world.buildings) {
      if (b.dead || !this.view.sees(b)) continue;
      const selected = state.selection.has(b.id);
      if (!selected && b.built && (b.hp >= b.maxHp || world.tick - b.lastHitTick > 100)) continue;
      const [sx, sy] = camera.project(b.x, b.y, buildingTopZ(b.type, b.epoch, b.size));
      const w = Math.min(90, b.size * 22) * zoom;
      if (!b.built) bar(sx, sy - 7, w, b.progress, '#d7b46a');
      bar(sx, sy, w, b.hp / b.maxHp, hpColor(b.hp / b.maxHp));
      if (selected && b.research) bar(sx, sy + 6, w, b.research.progress / b.research.total, '#7fb6ff');
      if (selected && b.tech) bar(sx, sy + 6, w, b.tech.progress / b.tech.total, '#b48cff');
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
    if (p.type === 'house') {
      const size = BUILDING_DEFS.house.size;
      this.moraleRing(p.tx + size / 2, p.ty + size / 2, 1);
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
        epoch: this.world.players[this.view.me].epoch,
        color: this.world.players[this.view.me].color,
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
   * Entity under a screen point. Units win over mines and bushes (which show
   * through buildings), those over buildings, buildings over trees, and
   * among equals the one drawn in front.
   */
  pick(sx: number, sy: number, alpha: number): Entity | null {
    const { world, camera } = this;
    const zoom = camera.zoom;
    let best: Entity | null = null;
    let bestDepth = -Infinity;
    for (const u of world.units) {
      if (u.dead || !this.view.seesUnit(u)) continue;
      const [x, y] = this.unitPos(u, alpha);
      const [px, py] = camera.project(x, y);
      const w = (wide(u) ? 14 : 9) * UNIT_SCALE * zoom;
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
    const vis = this.view.vis();
    const nodes = (trees: boolean) => {
      for (const n of world.resources) {
        if (n.dead || (n.nodeType === 'tree') !== trees || vis[world.map.idx(Math.floor(n.x), Math.floor(n.y))] === 0) continue;
        const depth = n.tx + n.ty + n.size;
        if (depth > bestDepth && hitsSprite(n, trees ? 64 : 28)) {
          best = n;
          bestDepth = depth;
        }
      }
    };
    nodes(false);
    if (best) return best;
    for (const b of world.buildings) {
      if (b.dead || !this.view.sees(b)) continue;
      const depth = b.tx + b.ty + b.size;
      if (depth > bestDepth && hitsSprite(b, buildingTopZ(b.type, b.epoch, b.size))) {
        best = b;
        bestDepth = depth;
      }
    }
    if (best) return best;
    nodes(true);
    return best;
  }

  /** Screen position of a unit (or a building's centre), used for box selection. */
  screenPosOf(e: Unit | Building, alpha: number): [number, number] {
    if (e.kind === 'building') return this.camera.project(e.x, e.y, 10);
    const [x, y] = this.unitPos(e, alpha);
    return this.camera.project(x, y, 10);
  }
}

