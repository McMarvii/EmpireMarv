import { Terrain } from '../sim/map';
import type { World } from '../sim/world';
import type { Camera } from './camera';
import type { View } from './view';

const TERRAIN_RGB: Record<number, [number, number, number]> = {
  [Terrain.Grass]: [92, 140, 58],
  [Terrain.Forest]: [44, 88, 34],
  [Terrain.Sand]: [214, 195, 137],
  [Terrain.Water]: [42, 106, 158],
  [Terrain.Dirt]: [142, 124, 82],
};

const NODE_RGB: Record<string, string> = {
  gold: '#f2c84b',
  stone: '#c9c9c4',
  iron: '#c0714a',
  berries: '#d2404f',
};

const HAZARD_RGBA: Record<string, string> = {
  plague: 'rgba(156,207,60,0.55)',
  quake: 'rgba(176,132,78,0.6)',
  firestorm: 'rgba(255,138,30,0.6)',
  storm: 'rgba(111,214,232,0.55)',
};

/** Diamond-shaped overview map, like the classic isometric RTS minimaps. */
export class Minimap {
  private ctx: CanvasRenderingContext2D;
  private image: ImageData | null = null;
  private lastBake = -Infinity;
  private w = 0;
  private h = 0;
  private k = 1;

  constructor(
    private canvas: HTMLCanvasElement,
    private world: World,
    private camera: Camera,
    private view: View,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.resize();
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.w = Math.max(80, Math.round(rect.width || 240));
    this.h = Math.round(this.w / 2);
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    this.k = this.w / (2 * this.world.map.width);
    this.image = null;
  }

  private toMini(x: number, y: number): [number, number] {
    return [(x - y) * this.k + this.w / 2, ((x + y) * this.k) / 2];
  }

  toWorld(mx: number, my: number): { x: number; y: number } {
    const a = (mx - this.w / 2) / this.k;
    const b = (2 * my) / this.k;
    return { x: (a + b) / 2, y: (b - a) / 2 };
  }

  /** Re-renders terrain and fog into an image; cheap enough twice a second. */
  private bake(): void {
    const { world, w, h } = this;
    const map = world.map;
    const vis = this.view.vis();
    const img = this.image ?? this.ctx.createImageData(w, h);
    const data = img.data;
    for (let my = 0; my < h; my++) {
      for (let mx = 0; mx < w; mx++) {
        const p = (my * w + mx) * 4;
        const { x, y } = this.toWorld(mx + 0.5, my + 0.5);
        const tx = Math.floor(x);
        const ty = Math.floor(y);
        if (!map.inBounds(tx, ty)) {
          data[p + 3] = 0;
          continue;
        }
        const i = map.idx(tx, ty);
        const v = vis[i];
        if (v === 0) {
          data[p] = 12;
          data[p + 1] = 14;
          data[p + 2] = 18;
          data[p + 3] = 255;
          continue;
        }
        let rgb = TERRAIN_RGB[map.terrain[i]];
        if (map.blocked[i] && map.terrain[i] === Terrain.Forest) rgb = [34, 72, 28];
        const f = v === 1 ? 0.55 : 1;
        data[p] = rgb[0] * f;
        data[p + 1] = rgb[1] * f;
        data[p + 2] = rgb[2] * f;
        data[p + 3] = 255;
      }
    }
    this.image = img;
  }

  render(): void {
    const { ctx, world } = this;
    if (world.time - this.lastBake > 0.5 || !this.image) {
      this.bake();
      this.lastBake = world.time;
    }
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.putImageData(this.image!, 0, 0);
    const dot = Math.max(2, this.k * 1.6);
    const vis = this.view.vis();
    for (const n of world.resources) {
      if (n.dead || n.nodeType === 'tree') continue;
      if (vis[world.map.idx(Math.floor(n.x), Math.floor(n.y))] === 0) continue;
      const [x, y] = this.toMini(n.x, n.y);
      ctx.fillStyle = NODE_RGB[n.nodeType];
      ctx.fillRect(x - dot / 2, y - dot / 2, dot, dot);
    }
    for (const b of world.buildings) {
      if (b.dead || !this.view.sees(b)) continue;
      const [x, y] = this.toMini(b.x, b.y);
      const s = Math.max(3, b.size * this.k * 1.4);
      ctx.fillStyle = world.players[b.owner].color;
      ctx.fillRect(x - s / 2, y - s / 2, s, s);
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.strokeRect(x - s / 2, y - s / 2, s, s);
      if (b.type === 'wonder') {
        // Wonders stand out; a running victory countdown pulses.
        const pulse = b.countdown > 0 ? 0.5 + 0.5 * Math.sin(world.time * 5) : 0;
        ctx.beginPath();
        ctx.arc(x, y, s * 0.9 + 2 + pulse * 3, 0, Math.PI * 2);
        ctx.strokeStyle = b.built ? '#f2c84b' : 'rgba(242,200,75,0.5)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
    for (const hz of world.hazards) {
      if (hz.owner !== this.view.me && vis[world.map.idx(Math.floor(hz.x), Math.floor(hz.y))] !== 2) continue;
      const [x, y] = this.toMini(hz.x, hz.y);
      ctx.beginPath();
      ctx.arc(x, y, Math.max(2, hz.r * this.k), 0, Math.PI * 2);
      ctx.fillStyle = HAZARD_RGBA[hz.kind];
      ctx.fill();
    }
    for (const u of world.units) {
      if (u.dead || !this.view.seesUnit(u)) continue;
      const [x, y] = this.toMini(u.x, u.y);
      ctx.fillStyle = world.players[u.owner].color;
      ctx.fillRect(x - dot / 2, y - dot / 2, dot, dot);
    }
    // Camera frustum.
    const cam = this.camera;
    const corners = [
      cam.screenToWorld(0, 0),
      cam.screenToWorld(cam.viewW, 0),
      cam.screenToWorld(cam.viewW, cam.viewH),
      cam.screenToWorld(0, cam.viewH),
    ].map((c) => this.toMini(c.x, c.y));
    ctx.beginPath();
    ctx.moveTo(corners[0][0], corners[0][1]);
    for (const [x, y] of corners.slice(1)) ctx.lineTo(x, y);
    ctx.closePath();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  /** Pulsing ring at a world position: attack alerts (red) and allies' marks (in their colour). */
  ping(x: number, y: number, t: number, color = '#ff503c'): void {
    const [mx, my] = this.toMini(x, y);
    this.ctx.beginPath();
    this.ctx.arc(mx, my, 4 + (t % 1) * 8, 0, Math.PI * 2);
    this.ctx.globalAlpha = 1 - (t % 1);
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = 2;
    this.ctx.stroke();
    this.ctx.globalAlpha = 1;
  }
}
