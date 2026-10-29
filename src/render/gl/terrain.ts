import { Terrain, type GameMap } from '../../sim/map';
import { TERRAIN_COLORS } from '../colors';
import { byteTexture, hexToRgb, program, type Program } from './util';

const VERTEX = `#version 300 es
void main() {
  // One triangle covering the screen.
  vec2 p = vec2(float((gl_VertexID & 1) << 2) - 1.0, float((gl_VertexID & 2) << 1) - 1.0);
  gl_Position = vec4(p, 0.0, 1.0);
}`;

/**
 * The ground and the fog, drawn per pixel from the map: each pixel finds its
 * world point, blends the four nearest tiles with a noisy edge (so borders
 * between grass, forest, sand and dirt run organically, not along the
 * grid), adds fine detail, and paints water with depth, waves, glints and
 * surf along the shore. Pass 1 draws the fog over the sprites, softly
 * blended between tiles.
 */
const FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 uBuf;
uniform float uDpr;
uniform vec2 uView;
uniform vec2 uCam;
uniform float uZoom;
uniform vec2 uMap;
uniform float uTime;
uniform int uPass;
uniform sampler2D uTiles;
uniform sampler2D uShore;
uniform sampler2D uVis;
uniform sampler2D uNoise;
uniform vec3 uPal[20];
out vec4 o;

vec2 worldAt(vec2 frag) {
  vec2 css = vec2(frag.x, uBuf.y - frag.y) / uDpr;
  vec2 iso = (css - uView * 0.5) / uZoom + uCam;
  return vec2(iso.x / 32.0 + iso.y / 16.0, iso.y / 16.0 - iso.x / 32.0) * 0.5;
}

// Screen derivatives of the world point, taken before any branch (filtering needs them).
vec2 dwx;
vec2 dwy;

/** Smooth noise of frequency f (per tile) at w, filtered for the zoom. */
float noise(vec2 w, float f, vec2 off, int ch) {
  vec4 n = textureGrad(uNoise, (w * f + off) / 64.0, dwx * f / 64.0, dwy * f / 64.0);
  return ch == 0 ? n.r : ch == 1 ? n.g : ch == 2 ? n.b : n.a;
}

ivec2 clampTile(ivec2 t) { return clamp(t, ivec2(0), ivec2(uMap) - 1); }

/** Shown fog at a point: 0 unexplored, 0.5 explored, 1 in sight; soft over tile edges. */
float visAt(vec2 w, float soft) {
  vec2 p = w - 0.5 + (vec2(noise(w, 1.7, vec2(uTime * 0.05), 2), noise(w, 1.7, vec2(-uTime * 0.05), 3)) - 0.5) * 0.45;
  vec2 i = floor(p);
  vec2 k = smoothstep(0.5 - soft, 0.5 + soft, p - i);
  ivec2 t = ivec2(i);
  float a = texelFetch(uVis, clampTile(t), 0).r;
  float b = texelFetch(uVis, clampTile(t + ivec2(1, 0)), 0).r;
  float c = texelFetch(uVis, clampTile(t + ivec2(0, 1)), 0).r;
  float d = texelFetch(uVis, clampTile(t + ivec2(1, 1)), 0).r;
  return mix(mix(a, b, k.x), mix(c, d, k.x), k.y);
}

void main() {
  vec2 w = worldAt(gl_FragCoord.xy);
  dwx = dFdx(w);
  dwy = dFdy(w);
  float edge = min(min(w.x, w.y), min(uMap.x - w.x, uMap.y - w.y));
  float inside = clamp(edge / max(fwidth(edge), 1e-4) + 0.5, 0.0, 1.0);
  if (inside <= 0.0) { o = vec4(0.0); return; }

  if (uPass == 1) {
    // Explored but out of sight: dimmed, as the canvas does.
    float v = visAt(w, 0.32);
    float a = 0.5 * (1.0 - smoothstep(0.5, 0.98, v)) * inside;
    o = vec4(vec3(5.0, 8.0, 12.0) / 255.0 * a, a);
    return;
  }

  // The four tiles around the point, blended with a warped, narrow edge.
  vec2 warp = (vec2(noise(w, 2.3, vec2(0.0), 0), noise(w, 2.3, vec2(17.0), 1)) - 0.5) * 0.55;
  vec2 p = w - 0.5 + warp;
  vec2 i = floor(p);
  vec2 k = smoothstep(0.5 - 0.2, 0.5 + 0.2, p - i);
  float wt[4] = float[4]((1.0 - k.x) * (1.0 - k.y), k.x * (1.0 - k.y), (1.0 - k.x) * k.y, k.x * k.y);
  ivec2 off[4] = ivec2[4](ivec2(0, 0), ivec2(1, 0), ivec2(0, 1), ivec2(1, 1));
  vec3 land = vec3(0.0);
  float landW = 0.0;
  float water = 0.0;
  float forest = 0.0;
  float sand = 0.0;
  for (int n = 0; n < 4; n++) {
    vec4 d = texelFetch(uTiles, clampTile(ivec2(i) + off[n]), 0);
    int ter = int(d.r * 255.0 + 0.5);
    int sh = int(d.g * 255.0 + 0.5);
    if (ter == ${Terrain.Water}) { water += wt[n]; continue; }
    if (ter == ${Terrain.Forest}) forest += wt[n];
    if (ter == ${Terrain.Sand}) sand += wt[n];
    land += uPal[ter * 4 + sh] * wt[n];
    landW += wt[n];
  }
  vec2 shore = texture(uShore, w / uMap).rg;
  vec3 col = vec3(0.0);
  if (landW > 0.0) {
    land /= landW;
    // Fine detail: patches, grain, and darker clumps under the trees.
    float d1 = noise(w, 0.9, vec2(0.0), 0) - 0.5;
    float d2 = noise(w, 4.1, vec2(0.0), 1) - 0.5;
    float d3 = noise(w, 13.0, vec2(0.0), 2) - 0.5;
    land *= 1.0 + d1 * 0.1 + d2 * 0.07 + d3 * (0.05 + sand * 0.05);
    land *= 1.0 - forest / landW * 0.08 * smoothstep(0.35, 0.75, noise(w, 2.7, vec2(0.0), 3));
    // Wet ground along the water.
    land *= 1.0 - 0.13 * smoothstep(0.35, 1.0, shore.g);
    col = land;
  }
  if (water > 0.0) {
    float t = uTime;
    float depth = smoothstep(0.0, 1.0, shore.r);
    vec3 deep = uPal[${Terrain.Water * 4}] * 0.82;
    vec3 shallow = mix(uPal[${Terrain.Water * 4 + 3}], vec3(0.33, 0.66, 0.70), 0.45);
    vec3 wcol = mix(deep, shallow, depth * 0.85);
    // Two layers of waves drifting against each other.
    float wave = noise(w, 1.3, vec2(t * 0.14, t * 0.09), 0) + noise(w, 3.1, -vec2(t * 0.4, -t * 0.28), 1) - 1.0;
    wcol *= 1.0 + wave * 0.16;
    // Sun glints.
    float g = noise(w, 5.0, vec2(t * 1.75, t * 1.1), 2) * noise(w, 3.3, -vec2(t * 0.9, t * 1.0), 3);
    wcol += vec3(0.85, 0.93, 1.0) * smoothstep(0.42, 0.6, g) * 0.35;
    // Surf rolling in along the shore.
    float band = 1.0 - abs(water - 0.55) * 2.2;
    float surf = smoothstep(0.0, 0.6, band) * (0.55 + 0.45 * sin(t * 1.6 + noise(w, 2.0, vec2(0.0), 1) * 9.0));
    surf += smoothstep(0.75, 1.0, depth) * smoothstep(0.55, 0.8, noise(w, 6.0, vec2(t * 1.2, 0.0), 0)) * 0.5 * (1.0 - water * 0.5);
    wcol = mix(wcol, vec3(0.9, 0.96, 1.0), clamp(surf, 0.0, 1.0) * 0.55);
    col = landW > 0.0 ? mix(col, wcol, smoothstep(0.25, 0.75, water)) : wcol;
  }

  // Unexplored ground fades to black.
  float v = visAt(w, 0.32);
  col = mix(vec3(7.0, 9.0, 12.0) / 255.0, col, smoothstep(0.02, 0.48, v));
  o = vec4(col * inside, inside);
}`;

/** Tileable smooth noise in four channels (blurred random bytes, wrapping around). */
function noiseTexture(size: number): Uint8Array {
  const n = size * size;
  const out = new Uint8Array(n * 4);
  let seed = 1234567;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) >>> 0;
    return (seed >>> 8) / 16777216;
  };
  for (let ch = 0; ch < 4; ch++) {
    let a = new Float32Array(n);
    for (let i = 0; i < n; i++) a[i] = rand();
    // Box blur passes turn white noise into soft blobs.
    const r = 3;
    for (let pass = 0; pass < 3; pass++) {
      const b = new Float32Array(n);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          let s = 0;
          for (let d = -r; d <= r; d++) s += a[y * size + ((x + d + size) % size)];
          b[y * size + x] = s / (2 * r + 1);
        }
      }
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          let s = 0;
          for (let d = -r; d <= r; d++) s += b[((y + d + size) % size) * size + x];
          a[y * size + x] = s / (2 * r + 1);
        }
      }
    }
    // Stretch to the full range again.
    let lo = 1;
    let hi = 0;
    for (const v of a) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    for (let i = 0; i < n; i++) out[i * 4 + ch] = Math.round(((a[i] - lo) / (hi - lo)) * 255);
    a = new Float32Array(0);
  }
  return out;
}

/** Steps (up to `reach`) from each tile to the nearest tile of the other kind (water vs land). */
function shoreTexture(map: GameMap, reach: number): Uint8Array {
  const n = map.width * map.height;
  const out = new Uint8Array(n * 2);
  for (const towardsLand of [true, false]) {
    const dist = new Int16Array(n).fill(-1);
    const queue: number[] = [];
    for (let i = 0; i < n; i++) {
      const isWater = map.terrain[i] === Terrain.Water;
      // Seeds: the other kind; distances grow into this kind.
      if (isWater !== towardsLand) {
        dist[i] = 0;
        queue.push(i);
      }
    }
    for (let q = 0; q < queue.length; q++) {
      const cur = queue[q];
      if (dist[cur] >= reach) continue;
      const x = cur % map.width;
      const y = (cur - x) / map.width;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (!map.inBounds(nx, ny)) continue;
          const ni = map.idx(nx, ny);
          if (dist[ni] >= 0) continue;
          dist[ni] = dist[cur] + 1;
          queue.push(ni);
        }
      }
    }
    for (let i = 0; i < n; i++) {
      const isWater = map.terrain[i] === Terrain.Water;
      if (isWater !== towardsLand) continue;
      const d = dist[i] < 0 ? reach + 1 : dist[i];
      out[i * 2 + (towardsLand ? 0 : 1)] = Math.round(Math.max(0, 1 - (d - 1) / reach) * 255);
    }
  }
  return out;
}

export interface CameraUniforms {
  bufW: number;
  bufH: number;
  dpr: number;
  viewW: number;
  viewH: number;
  camX: number;
  camY: number;
  zoom: number;
}

/** Ground and fog of one map. */
export class TerrainLayer {
  private prog: Program;
  private tiles: WebGLTexture;
  private shore: WebGLTexture;
  private noise: WebGLTexture;
  private vis: WebGLTexture;
  /** The fog as shown: eases towards the real one, so sight fades in and out. */
  private shown: Float32Array;
  private bytes: Uint8Array;
  private primed = false;
  private palette: Float32Array;

  constructor(
    private gl: WebGL2RenderingContext,
    private map: GameMap,
  ) {
    this.prog = program(gl, VERTEX, FRAGMENT);
    const n = map.width * map.height;
    const tiles = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      tiles[i * 4] = map.terrain[i];
      tiles[i * 4 + 1] = map.shade[i];
      tiles[i * 4 + 3] = 255;
    }
    this.tiles = byteTexture(gl, map.width, map.height, 4, false, tiles);
    this.shore = byteTexture(gl, map.width, map.height, 2, true, shoreTexture(map, 3));
    this.noise = byteTexture(gl, 256, 256, 4, true, noiseTexture(256));
    gl.bindTexture(gl.TEXTURE_2D, this.noise);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
    this.shown = new Float32Array(n);
    this.bytes = new Uint8Array(n);
    this.vis = byteTexture(gl, map.width, map.height, 1, false, this.bytes);
    this.palette = new Float32Array(TERRAIN_COLORS.flatMap((shades) => shades.flatMap(hexToRgb)));
  }

  /** Brings the shown fog towards `vis` (0 unexplored, 1 explored, 2 in sight) and uploads it. */
  updateFog(vis: Uint8Array, dt: number): void {
    const k = this.primed ? Math.min(1, dt * 7) : 1;
    this.primed = true;
    const shown = this.shown;
    const bytes = this.bytes;
    for (let i = 0; i < shown.length; i++) {
      const target = vis[i] * 0.5;
      const s = shown[i] + (target - shown[i]) * k;
      shown[i] = Math.abs(target - s) < 0.004 ? target : s;
      bytes[i] = Math.round(shown[i] * 255);
    }
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.vis);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.map.width, this.map.height, gl.RED, gl.UNSIGNED_BYTE, bytes);
  }

  /** Pass 0: the ground. Pass 1: the fog over everything on it. */
  draw(pass: 0 | 1, cam: CameraUniforms, time: number): void {
    const gl = this.gl;
    const { program: p, uniforms: u } = this.prog;
    gl.useProgram(p);
    gl.uniform2f(u.uBuf, cam.bufW, cam.bufH);
    gl.uniform1f(u.uDpr, cam.dpr);
    gl.uniform2f(u.uView, cam.viewW, cam.viewH);
    gl.uniform2f(u.uCam, cam.camX, cam.camY);
    gl.uniform1f(u.uZoom, cam.zoom);
    gl.uniform2f(u.uMap, this.map.width, this.map.height);
    // Long matches: keep the animation clock small enough for float precision.
    gl.uniform1f(u.uTime, time % 3600);
    gl.uniform1i(u.uPass, pass);
    gl.uniform3fv(u.uPal, this.palette);
    const units: Array<[string, WebGLTexture]> = [
      ['uTiles', this.tiles],
      ['uShore', this.shore],
      ['uVis', this.vis],
      ['uNoise', this.noise],
    ];
    units.forEach(([name, tex], i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(u[name], i);
    });
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);
  }
}
