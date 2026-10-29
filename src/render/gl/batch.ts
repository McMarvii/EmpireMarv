import { program, type Program } from './util';

const VERTEX = `#version 300 es
layout(location = 0) in vec4 aRect;
layout(location = 1) in vec4 aUv;
layout(location = 2) in vec2 aLayerAlpha;
uniform vec2 uBuf;
out vec3 vUv;
out float vAlpha;
void main() {
  vec2 c = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  vec2 p = aRect.xy + c * aRect.zw;
  gl_Position = vec4(p.x / uBuf.x * 2.0 - 1.0, 1.0 - p.y / uBuf.y * 2.0, 0.0, 1.0);
  vUv = vec3(mix(aUv.xy, aUv.zw, c), aLayerAlpha.x);
  vAlpha = aLayerAlpha.y;
}`;

const FRAGMENT = `#version 300 es
precision mediump float;
precision mediump sampler2DArray;
uniform sampler2DArray uAtlas;
in vec3 vUv;
in float vAlpha;
out vec4 o;
void main() {
  o = texture(uAtlas, vUv) * vAlpha;
}`;

/** Floats per sprite: rectangle (x, y, w, h), texture box (u0, v0, u1, v1), layer, alpha. */
const FLOATS = 10;

/**
 * All sprites of a frame in one buffer, drawn as instanced quads from the
 * atlas. Ranges of it are drawn between the ground and fog passes.
 */
export class SpriteBatch {
  private prog: Program;
  private vao: WebGLVertexArrayObject;
  private buffer: WebGLBuffer;
  private data = new Float32Array(FLOATS * 2048);
  count = 0;

  constructor(private gl: WebGL2RenderingContext) {
    this.prog = program(gl, VERTEX, FRAGMENT);
    this.vao = gl.createVertexArray()!;
    this.buffer = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    for (let i = 0; i < 3; i++) {
      gl.enableVertexAttribArray(i);
      gl.vertexAttribDivisor(i, 1);
    }
    gl.bindVertexArray(null);
  }

  reset(): void {
    this.count = 0;
  }

  push(x: number, y: number, w: number, h: number, u0: number, v0: number, u1: number, v1: number, layer: number, alpha: number): void {
    if ((this.count + 1) * FLOATS > this.data.length) {
      const grown = new Float32Array(this.data.length * 2);
      grown.set(this.data);
      this.data = grown;
    }
    const d = this.data;
    const o = this.count * FLOATS;
    d[o] = x;
    d[o + 1] = y;
    d[o + 2] = w;
    d[o + 3] = h;
    d[o + 4] = u0;
    d[o + 5] = v0;
    d[o + 6] = u1;
    d[o + 7] = v1;
    d[o + 8] = layer;
    d[o + 9] = alpha;
    this.count++;
  }

  /** Sends this frame's sprites to the GPU. */
  upload(): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.subarray(0, this.count * FLOATS), gl.STREAM_DRAW);
  }

  /** Draws sprites [from, to) with the atlas texture. */
  draw(from: number, to: number, atlas: WebGLTexture, bufW: number, bufH: number): void {
    if (to <= from) return;
    const gl = this.gl;
    const { program: p, uniforms: u } = this.prog;
    gl.useProgram(p);
    gl.uniform2f(u.uBuf, bufW, bufH);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, atlas);
    gl.uniform1i(u.uAtlas, 0);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    // WebGL has no base instance: the attribute pointers start at the range instead.
    const stride = FLOATS * 4;
    const base = from * stride;
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, stride, base);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, base + 16);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, base + 32);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, to - from);
    gl.bindVertexArray(null);
  }
}
