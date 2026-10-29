import type { GameMap } from '../../sim/map';
import type { Camera } from '../camera';
import type { Scene, SceneSprite } from '../scene';
import { SpriteAtlas } from './atlas';
import { SpriteBatch } from './batch';
import { TerrainLayer, type CameraUniforms } from './terrain';

/** Renderer names of WebGL emulated on the processor. */
const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render/i;

/**
 * The WebGL picture of the map, on its own canvas under the 2D one: ground
 * and fog from the terrain shader, every sprite from the atlas in one
 * instanced draw per pass. Effects and everything on top stay on the 2D
 * canvas above.
 */
export class GlLayer {
  readonly canvas: HTMLCanvasElement;
  private atlas: SpriteAtlas;
  private batch: SpriteBatch;
  private terrain: TerrainLayer;
  private dpr = 1;
  private lastTime: number | null = null;
  /** The context went away (driver reset, too many contexts): the caller falls back to the canvas. */
  lost = false;
  onLost: (() => void) | null = null;
  /** Milliseconds per frame for nicer pictures (sharper after zooming, the next animation step) … */
  softBudget = 3;
  /** … and for pictures that are missing altogether. */
  hardBudget = 25;

  /** A layer for this map, or null without WebGL 2 (or, unless forced, with WebGL only in software). */
  static create(map: GameMap, force: boolean): GlLayer | null {
    const canvas = document.createElement('canvas');
    canvas.id = 'game-gl';
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance', failIfMajorPerformanceCaveat: !force });
    if (!gl) return null;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    if (!force && SOFTWARE.test(name)) {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return null;
    }
    try {
      return new GlLayer(canvas, gl, map);
    } catch (err) {
      console.warn('WebGL nicht nutzbar, zeichne mit Canvas:', err);
      return null;
    }
  }

  private constructor(
    canvas: HTMLCanvasElement,
    private gl: WebGL2RenderingContext,
    map: GameMap,
  ) {
    this.canvas = canvas;
    this.atlas = new SpriteAtlas(gl);
    this.batch = new SpriteBatch(gl);
    this.terrain = new TerrainLayer(gl, map);
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
      this.onLost?.();
    });
  }

  resize(width: number, height: number, dpr: number): void {
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
  }

  /** Frees the GPU memory at once rather than whenever the browser collects the canvas. */
  destroy(): void {
    this.canvas.remove();
    if (!this.lost) this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  draw(scene: Scene, camera: Camera, vis: Uint8Array, time: number): void {
    if (this.lost) return;
    const gl = this.gl;
    // Wall-clock time: the fog fades in even while the game is paused.
    const now = performance.now() / 1000;
    const dt = this.lastTime === null ? 0 : Math.max(0, Math.min(0.25, now - this.lastTime));
    this.lastTime = now;
    const bufW = this.canvas.width;
    const bufH = this.canvas.height;
    const cam: CameraUniforms = { bufW, bufH, dpr: this.dpr, viewW: camera.viewW, viewH: camera.viewH, camX: camera.x, camY: camera.y, zoom: camera.zoom };
    this.terrain.updateFog(vis, dt);
    this.atlas.begin(this.softBudget, this.hardBudget);
    const batch = this.batch;
    batch.reset();
    for (const s of scene.ground) this.add(s, camera, time);
    for (const s of scene.drawables) this.add(s, camera, time);
    for (const s of scene.ghosts) this.add(s, camera, time);
    const belowFog = batch.count;
    for (const s of scene.airborne) this.add(s, camera, time);
    batch.upload();

    gl.viewport(0, 0, bufW, bufH);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this.terrain.draw(0, cam, time);
    batch.draw(0, belowFog, this.atlas.texture, bufW, bufH);
    this.terrain.draw(1, cam, time);
    batch.draw(belowFog, batch.count, this.atlas.texture, bufW, bufH);
  }

  private add(s: SceneSprite, camera: Camera, time: number): void {
    const c = this.atlas.cell(s, camera.zoom, this.dpr, time);
    if (!c) return;
    const dpr = this.dpr;
    const f = (camera.zoom * dpr) / c.scale;
    const [sx, sy] = camera.project(s.x, s.y, s.z);
    let x = sx * dpr - c.ax * f;
    let y = sy * dpr - c.ay * f;
    // At the raster zoom itself, pixels land on pixels and stay crisp.
    if (f === 1) {
      x = Math.round(x);
      y = Math.round(y);
    }
    const size = SpriteAtlas.SIZE;
    this.batch.push(x, y, c.w * f, c.h * f, c.x / size, c.y / size, (c.x + c.w) / size, (c.y + c.h) / size, c.layer, s.alpha);
  }

  /** For the debug readout. */
  stats(): { painted: number; sprites: number; cells: number; full: number } {
    const u = this.atlas.usage();
    return { painted: this.atlas.paintedNow, sprites: this.batch.count, cells: u.cells, full: u.full };
  }
}
