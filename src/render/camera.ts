export const TILE_W = 64;
export const TILE_H = 32;

/** Projects world tile coordinates (+ height in pixels) to screen pixels. */
export type Project = (wx: number, wy: number, z?: number) => [number, number];

/**
 * Isometric camera. Camera x/y are in unzoomed "iso pixels"; the world point
 * (wx, wy) maps to iso pixels ((wx - wy) * TILE_W / 2, (wx + wy) * TILE_H / 2).
 */
export class Camera {
  x = 0;
  y = 0;
  zoom = 1;
  viewW = 800;
  viewH = 600;

  readonly project: Project = (wx, wy, z = 0) => [
    (((wx - wy) * TILE_W) / 2 - this.x) * this.zoom + this.viewW / 2,
    (((wx + wy) * TILE_H) / 2 - z - this.y) * this.zoom + this.viewH / 2,
  ];

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    const ix = (sx - this.viewW / 2) / this.zoom + this.x;
    const iy = (sy - this.viewH / 2) / this.zoom + this.y;
    return {
      x: (ix / (TILE_W / 2) + iy / (TILE_H / 2)) / 2,
      y: (iy / (TILE_H / 2) - ix / (TILE_W / 2)) / 2,
    };
  }

  centerOn(wx: number, wy: number): void {
    this.x = ((wx - wy) * TILE_W) / 2;
    this.y = ((wx + wy) * TILE_H) / 2;
  }

  /** World coordinates of the screen center. */
  center(): { x: number; y: number } {
    return this.screenToWorld(this.viewW / 2, this.viewH / 2);
  }

  /** Keeps the view center inside the map diamond. */
  clamp(mapSize: number): void {
    const c = this.center();
    const x = Math.max(0, Math.min(mapSize, c.x));
    const y = Math.max(0, Math.min(mapSize, c.y));
    if (x !== c.x || y !== c.y) this.centerOn(x, y);
  }

  zoomAt(sx: number, sy: number, factor: number): void {
    const before = this.screenToWorld(sx, sy);
    this.zoom = Math.max(0.45, Math.min(2.2, this.zoom * factor));
    const after = this.screenToWorld(sx, sy);
    const c = this.center();
    this.centerOn(c.x + before.x - after.x, c.y + before.y - after.y);
  }
}
