import { TILE_H, TILE_W, type Project } from '../camera';
import type { Box, SceneSprite } from '../scene';

/** Edge of one atlas layer in pixels. */
const SIZE = 2048;
/** Empty pixels around each cell, so filtering never bleeds into a neighbour. */
const PAD = 1;
/** Unzoomed pixels added around a measured outline (line widths, smoothing). */
const MARGIN = 3;
/** The canvas outlines are measured on, and where the anchor sits on it. */
const PROBE_W = 720;
const PROBE_H = 720;
const PROBE_AX = 360;
const PROBE_AY = 520;
/** Raster zooms per doubling: sprites are painted at the next step up and drawn slightly smaller. */
const ZOOM_STEPS = 4;
/** How often a live sprite (smoke, flags) is repainted at most. */
const LIVE_FPS = 12;
const TAU = Math.PI * 2;

/** One picture in the atlas. */
export interface Cell {
  layer: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Where the sprite's anchor lies in the cell (pixels). */
  ax: number;
  ay: number;
  /** Zoom times pixel ratio it was painted at. */
  scale: number;
  /** Last frame it was drawn in. */
  used: number;
  /** Animation time of the picture (live sprites). */
  painted: number;
  /** The sprite key it shows. */
  state: string;
  /** Its key in the cell map, and the key it is the latest picture for. */
  key: string;
  base: string;
}

interface Shelf {
  y: number;
  h: number;
  x: number;
}

interface Page {
  shelves: Shelf[];
  top: number;
  /** Last frame a cell on it was drawn. */
  used: number;
  cells: Set<Cell>;
}

/** The raster zoom a sprite is painted at for a camera zoom. */
export function rasterZoom(zoom: number): number {
  return 2 ** (Math.ceil(Math.log2(zoom) * ZOOM_STEPS - 1e-6) / ZOOM_STEPS);
}

/**
 * Pictures of sprites in a texture array. Sprites are painted with their own
 * canvas code into a small canvas and uploaded once; equal keys share a
 * picture. Looping animations keep a few frames per loop, live ones (smoke,
 * fire, flags on buildings) a picture per instance that is repainted a few
 * times a second. When the layers fill up the least recently drawn layer is
 * cleared and repainted on demand. Painting has a time budget per frame:
 * beyond it the atlas falls back to a picture at another zoom or frame.
 */
export class SpriteAtlas {
  readonly texture: WebGLTexture;
  readonly layers: number;
  private pages: Page[] = [];
  private cells = new Map<string, Cell>();
  /** The last picture painted for a sprite at any zoom or frame: shown while a better one waits for budget. */
  private latest = new Map<string, Cell>();
  private outlines = new Map<string, Box>();
  private moving = new Map<string, boolean>();
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private probeCanvas = document.createElement('canvas');
  private probeCtx: CanvasRenderingContext2D;
  private frame = 0;
  private softEnd = 0;
  private hardEnd = 0;
  /** Pictures painted this frame (for the debug readout). */
  paintedNow = 0;

  constructor(private gl: WebGL2RenderingContext) {
    // Four layers of 2048² (64 MB) hold even big battles; older pictures make room when they fill.
    this.layers = Math.max(1, Math.min(4, gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) as number));
    this.texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, SIZE, SIZE, this.layers);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    for (let i = 0; i < this.layers; i++) this.pages.push({ shelves: [], top: 0, used: -1, cells: new Set() });
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
    this.probeCanvas.width = PROBE_W;
    this.probeCanvas.height = PROBE_H;
    this.probeCtx = this.probeCanvas.getContext('2d', { willReadFrequently: true })!;
  }

  /** Starts a frame: `soft` ms may go to nicer pictures, missing ones are painted up to `hard` ms. */
  begin(soft: number, hard: number): void {
    this.frame++;
    this.paintedNow = 0;
    const now = performance.now();
    this.softEnd = now + soft;
    this.hardEnd = now + hard;
  }

  /** The picture to draw `s` with at this zoom, painting it if needed (null: none yet, skip it). */
  cell(s: SceneSprite, zoom: number, dpr: number, time: number): Cell | null {
    const scale = rasterZoom(zoom) * dpr;
    const anim = s.anim;
    const animated = anim.kind !== 'still' && this.isMoving(s);
    let base: string;
    let t = 0;
    if (!animated) base = s.key;
    else if (anim.kind === 'cycle') {
      const turn = (anim.omega * time + anim.phase) / TAU;
      const k = Math.floor((turn - Math.floor(turn)) * anim.frames) % anim.frames;
      base = `${s.key}#${k}`;
      t = ((TAU * k) / anim.frames - anim.phase) / anim.omega;
    } else {
      base = `L${s.id}`;
      t = time;
    }
    const key = `${base}@${scale}`;
    let c = this.cells.get(key);
    const now = performance.now();
    if (c) {
      if (anim.kind === 'live' && animated) {
        const changed = c.state !== s.key;
        // A new state (damage, construction) or the next animation step, if there is time for it.
        if ((changed && now < this.hardEnd) || ((changed || time - c.painted >= 1 / LIVE_FPS || time < c.painted) && now < this.softEnd)) {
          c = this.paint(s, key, base, scale, dpr, t, c) ?? c;
        }
      }
    } else {
      const fallback = this.latest.get(base);
      if (now < (fallback && this.cells.has(fallback.key) ? this.softEnd : this.hardEnd)) c = this.paint(s, key, base, scale, dpr, t) ?? undefined;
      if (!c && fallback && this.cells.has(fallback.key)) c = fallback;
    }
    if (!c) return null;
    c.used = this.frame;
    this.pages[c.layer].used = this.frame;
    return c;
  }

  /** Whether a sprite's pixels change over time (checked once per outline). */
  private isMoving(s: SceneSprite): boolean {
    // Colour and attack pose never decide whether a unit or tree moves, its outline class does;
    // a building may start to smoke when damaged, so it is checked per state.
    const id = typeof s.outline === 'string' && s.anim.kind === 'cycle' ? `${s.outline}|cycle` : s.key;
    const known = this.moving.get(id);
    if (known !== undefined) return known;
    const box = this.outline(s);
    const anim = s.anim;
    const times = anim.kind === 'cycle' ? [0, 0.25, 0.5].map((f) => ((TAU * Math.floor(f * anim.frames)) / anim.frames - anim.phase) / anim.omega) : [0, 0.37, 1.13];
    const w = Math.min(PROBE_W, Math.ceil(box.x1 - box.x0) + 2);
    const h = Math.min(PROBE_H, Math.ceil(box.y1 - box.y0) + 2);
    let first: Uint8ClampedArray | null = null;
    let moves = false;
    for (const t of times) {
      const px = this.probe(s, t, 1 - box.x0, 1 - box.y0, w, h);
      if (!first) first = px;
      else if (!moves) for (let i = 0; i < px.length; i++) if (px[i] !== first[i]) {
        moves = true;
        break;
      }
    }
    this.moving.set(id, moves);
    return moves;
  }

  /** Paints a sprite once at zoom 1 onto the probe canvas and reads back a w × h corner. */
  private probe(s: SceneSprite, t: number, ax: number, ay: number, w: number, h: number): Uint8ClampedArray {
    const ctx = this.probeCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    s.paint(ctx, this.project(s, 1, ax, ay), 1, t);
    ctx.restore();
    return ctx.getImageData(0, 0, w, h).data;
  }

  /** The box around the anchor a sprite may cover, unzoomed. */
  private outline(s: SceneSprite): Box {
    if (typeof s.outline !== 'string') {
      const b = s.outline;
      return { x0: b.x0 - MARGIN, y0: b.y0 - MARGIN, x1: b.x1 + MARGIN, y1: b.y1 + MARGIN };
    }
    const known = this.outlines.get(s.outline);
    if (known) return known;
    const ctx = this.probeCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, PROBE_W, PROBE_H);
    const anim = s.anim;
    const times = anim.kind === 'cycle' ? [0, 0.2, 0.4, 0.6, 0.8].map((f) => ((TAU * f) - anim.phase) / anim.omega) : [0, 0.41, 0.83, 1.27, 1.66, 2.5];
    const P = this.project(s, 1, PROBE_AX, PROBE_AY);
    for (const t of times) {
      ctx.save();
      (s.probe ?? s.paint)(ctx, P, 1, t);
      ctx.restore();
    }
    const data = ctx.getImageData(0, 0, PROBE_W, PROBE_H).data;
    let x0 = PROBE_W;
    let y0 = PROBE_H;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < PROBE_H; y++) {
      const row = y * PROBE_W * 4;
      for (let x = 0; x < PROBE_W; x++) {
        if (data[row + x * 4 + 3] === 0) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
    }
    const box =
      x1 < 0
        ? { x0: -1, y0: -1, x1: 1, y1: 1 }
        : { x0: x0 - PROBE_AX - MARGIN, y0: y0 - PROBE_AY - MARGIN, x1: x1 + 1 - PROBE_AX + MARGIN, y1: y1 + 1 - PROBE_AY + MARGIN };
    this.outlines.set(s.outline, box);
    return box;
  }

  /** World to pixels on a canvas where the sprite's anchor sits at (ax, ay). */
  private project(s: SceneSprite, zoom: number, ax: number, ay: number): Project {
    const isoX = ((s.x - s.y) * TILE_W) / 2;
    const isoY = ((s.x + s.y) * TILE_H) / 2 - s.z;
    return (wx, wy, z = 0) => [(((wx - wy) * TILE_W) / 2 - isoX) * zoom + ax, (((wx + wy) * TILE_H) / 2 - z - isoY) * zoom + ay];
  }

  private paint(s: SceneSprite, key: string, base: string, scale: number, dpr: number, t: number, into?: Cell): Cell | null {
    const box = this.outline(s);
    const w = Math.ceil((box.x1 - box.x0) * scale) + PAD * 2;
    const h = Math.ceil((box.y1 - box.y0) * scale) + PAD * 2;
    if (w > SIZE || h > SIZE) return null;
    let c = into && into.w === w && into.h === h ? into : null;
    if (!c) {
      const spot = this.alloc(w, h);
      if (!spot) return null;
      c = { ...spot, w, h, ax: PAD + Math.round(-box.x0 * scale), ay: PAD + Math.round(-box.y0 * scale), scale, used: this.frame, painted: t, state: s.key, key, base };
      this.pages[c.layer].cells.add(c);
      this.cells.set(key, c);
    }
    c.painted = t;
    c.state = s.key;
    this.latest.set(base, c);
    const canvas = this.canvas;
    if (canvas.width < w || canvas.height < h) {
      canvas.width = Math.max(canvas.width, w, 256);
      canvas.height = Math.max(canvas.height, h, 256);
    }
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const zoom = scale / dpr;
    s.paint(ctx, this.project(s, zoom, c.ax / dpr, c.ay / dpr), zoom, t);
    ctx.restore();
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, c.x, c.y, c.layer, w, h, 1, gl.RGBA, gl.UNSIGNED_BYTE, ctx.getImageData(0, 0, w, h));
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    this.paintedNow++;
    return c;
  }

  /** A free spot of w × h, clearing the least recently drawn layer when all are full. */
  private alloc(w: number, h: number): { layer: number; x: number; y: number } | null {
    const sh = Math.ceil(h / 8) * 8;
    for (let attempt = 0; attempt < 2; attempt++) {
      for (let l = 0; l < this.pages.length; l++) {
        const page = this.pages[l];
        for (const shelf of page.shelves) {
          if (shelf.h >= sh && shelf.h <= sh * 1.5 + 8 && SIZE - shelf.x >= w) {
            const spot = { layer: l, x: shelf.x, y: shelf.y };
            shelf.x += w;
            return spot;
          }
        }
        if (page.top + sh <= SIZE) {
          page.shelves.push({ y: page.top, h: sh, x: w });
          const spot = { layer: l, x: 0, y: page.top };
          page.top += sh;
          return spot;
        }
      }
      if (!this.evict()) return null;
    }
    return null;
  }

  /** Clears the layer drawn longest ago; never one drawn this frame. */
  private evict(): boolean {
    let best = -1;
    for (let l = 0; l < this.pages.length; l++) {
      if (this.pages[l].used >= this.frame) continue;
      if (best < 0 || this.pages[l].used < this.pages[best].used) best = l;
    }
    if (best < 0) return false;
    const page = this.pages[best];
    for (const c of page.cells) {
      this.cells.delete(c.key);
      if (this.latest.get(c.base) === c) this.latest.delete(c.base);
    }
    page.cells.clear();
    page.shelves = [];
    page.top = 0;
    return true;
  }

  /** Atlas fill for the debug readout. */
  usage(): { cells: number; layers: number; full: number } {
    let full = 0;
    for (const p of this.pages) full += p.top / SIZE;
    return { cells: this.cells.size, layers: this.layers, full: Math.round((full / this.layers) * 100) };
  }

  /** Texture coordinates (0..1) of a cell. */
  static readonly SIZE = SIZE;
}
