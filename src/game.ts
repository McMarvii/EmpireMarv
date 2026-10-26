import { GameAudio } from './audio/director';
import { BUILDING_DEFS, type BuildingType } from './data/buildings';
import { canAfford, type Stock } from './data/resources';
import type { Role } from './data/units';
import { Camera } from './render/camera';
import { Minimap } from './render/minimap';
import { Renderer, type Marker, type Placement } from './render/renderer';
import { AIController } from './sim/ai';
import type { Building, Entity, Unit } from './sim/entities';
import { DT, MAX_LINE, World, type GameSettings } from './sim/world';
import { Hud } from './ui/hud';
import { Input } from './ui/input';

export type Mode = 'normal' | 'place' | 'attackMove';

/**
 * Glue between the deterministic world and the browser: owns the main loop,
 * selection state and translates player intent into world commands.
 */
export class Game {
  readonly world: World;
  readonly camera = new Camera();
  readonly renderer: Renderer;
  readonly minimap: Minimap;
  readonly hud: Hud;
  readonly input: Input;
  readonly audio: GameAudio;
  readonly me = 0;
  selection = new Set<number>();
  /** Control groups (Strg+1–9), shown in the group bar. */
  readonly groups = new Map<string, number[]>();
  activeGroup = '';
  private lastGroupTap = { key: '', time: 0 };
  mode: Mode = 'normal';
  placement: Placement | null = null;
  paused = false;
  speed = 1;
  marker: Marker | null = null;
  lastAlert: { x: number; y: number; time: number } | null = null;
  animTime = 0;
  private acc = 0;
  private lastFrame = 0;
  private raf = 0;
  private gameOverShown = false;
  private idleIndex = 0;

  constructor(
    readonly root: HTMLElement,
    settings: Partial<GameSettings>,
    private onExit: () => void,
  ) {
    this.world = new World(settings);
    this.world.settings.players.forEach((p, id) => {
      if (p.isAI) this.world.controllers.push(new AIController(id, this.world.settings.aiDifficulty, this.world));
    });
    this.audio = new GameAudio(this);
    const canvas = root.querySelector<HTMLCanvasElement>('#game')!;
    this.renderer = new Renderer(canvas, this.world, this.camera, this.me);
    this.hud = new Hud(this);
    this.minimap = new Minimap(root.querySelector<HTMLCanvasElement>('#minimap')!, this.world, this.camera, this.me);
    this.input = new Input(this, canvas);
    this.resize();
    const start = this.world.startPositions[this.me];
    this.camera.centerOn(start.x + 2, start.y + 2);
    const tc = this.world.buildingsOf(this.me, 'towncenter')[0];
    if (tc) this.select([tc.id]);
    this.hud.message('info', 'Willkommen! Bürger sammeln Rohstoffe – steige im Dorfzentrum in neue Epochen auf.');
  }

  start(): void {
    this.lastFrame = performance.now();
    const loop = (now: number) => {
      this.frame(now);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.audio.stop();
    this.input.destroy();
    this.hud.destroy();
  }

  resize(): void {
    this.renderer.resize(window.innerWidth, window.innerHeight);
    this.minimap.resize();
  }

  private frame(now: number): void {
    const dt = Math.min(0.25, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    if (!this.paused && !this.world.over) {
      this.acc += dt * this.speed;
      let steps = 0;
      while (this.acc >= DT && steps < 12) {
        this.world.step();
        this.acc -= DT;
        steps++;
      }
      if (steps === 12) this.acc = 0;
      this.animTime += dt;
    }
    this.input.update(dt);
    this.camera.clamp(this.world.map.width);
    for (const id of [...this.selection]) if (!this.world.get(id)) this.selection.delete(id);
    if (this.placement) this.refreshPlacement();

    this.renderer.render({
      selection: this.selection,
      hoverId: this.input.hoverId,
      placement: this.placement,
      alpha: this.paused ? 1 : Math.min(1, this.acc / DT),
      time: this.animTime,
      marker: this.marker,
    });
    if (this.marker && (this.marker.t += dt) > 0.6) this.marker = null;
    this.minimap.render();
    this.audio.update(dt);
    if (this.lastAlert && this.animTime - this.lastAlert.time < 4) {
      this.minimap.ping(this.lastAlert.x, this.lastAlert.y, this.animTime);
    }
    this.hud.update();
    if (this.world.over && !this.gameOverShown) {
      this.gameOverShown = true;
      this.hud.showGameOver();
    }
  }

  // ------------------------------------------------------------- selection

  select(ids: number[], add = false): void {
    if (!add) this.selection.clear();
    for (const id of ids) this.selection.add(id);
    this.hud.selectionChanged();
    if (ids.length) this.audio.ack('select', this.selectedEntities());
  }

  selectedEntities(): Entity[] {
    const out: Entity[] = [];
    for (const id of this.selection) {
      const e = this.world.get(id);
      if (e) out.push(e);
    }
    return out;
  }

  saveGroup(key: string): void {
    const ids = this.selectedOwnUnits().map((u) => u.id);
    if (ids.length) this.groups.set(key, ids);
    else this.groups.delete(key);
    this.activeGroup = ids.length ? key : '';
    this.hud.message('info', ids.length ? `Gruppe ${key} gespeichert.` : `Gruppe ${key} geleert.`);
  }

  /** Living members of a control group. */
  groupUnits(key: string): Unit[] {
    const out: Unit[] = [];
    for (const id of this.groups.get(key) ?? []) {
      const e = this.world.get(id);
      if (e && e.kind === 'unit' && e.owner === this.me) out.push(e);
    }
    return out;
  }

  /** Selects a group; a second tap within 400 ms (or `center`) jumps to it. */
  recallGroup(key: string, center = false): void {
    const units = this.groupUnits(key);
    if (!units.length) return;
    const now = performance.now();
    if (center || (this.lastGroupTap.key === key && now - this.lastGroupTap.time < 400)) {
      const x = units.reduce((s, u) => s + u.x, 0) / units.length;
      const y = units.reduce((s, u) => s + u.y, 0) / units.length;
      this.centerOn(x, y);
    }
    this.lastGroupTap = { key, time: now };
    this.activeGroup = key;
    this.select(units.map((u) => u.id));
  }

  selectedOwnUnits(): Unit[] {
    return this.selectedEntities().filter((e): e is Unit => e.kind === 'unit' && e.owner === this.me);
  }

  selectedOwnBuilding(): Building | null {
    const ents = this.selectedEntities();
    const b = ents.find((e): e is Building => e.kind === 'building' && e.owner === this.me);
    return b ?? null;
  }

  // -------------------------------------------------------------- commands

  /** Context-sensitive right click, the heart of classic RTS controls. */
  rightClick(sx: number, sy: number): void {
    const world = this.world;
    const pos = this.camera.screenToWorld(sx, sy);
    const target = this.renderer.pick(sx, sy, 1);
    const units = this.selectedOwnUnits();
    if (units.length === 0) {
      const b = this.selectedOwnBuilding();
      if (b && BUILDING_DEFS[b.type].trains.length > 0) {
        const at = target && target.kind === 'resource' ? { x: target.x, y: target.y } : pos;
        world.issue({ type: 'rally', player: this.me, buildingId: b.id, x: at.x, y: at.y });
        this.setMarker(at.x, at.y, '#ffffff');
        this.audio.ack('move', [b]);
      }
      return;
    }
    const ids = units.map((u) => u.id);
    const citizens = units.filter((u) => u.role === 'citizen').map((u) => u.id);
    const others = units.filter((u) => u.role !== 'citizen').map((u) => u.id);
    if (target && target.kind !== 'resource' && world.areEnemies(this.me, target.owner)) {
      world.issue({ type: 'attack', player: this.me, ids, targetId: target.id });
      this.setMarker(target.x, target.y, '#ff5a4d');
      this.audio.ack('attack', units);
      return;
    }
    if (target && target.kind === 'resource' && citizens.length) {
      world.issue({ type: 'gather', player: this.me, ids: citizens, targetId: target.id });
      if (others.length) world.issue({ type: 'move', player: this.me, ids: others, x: pos.x, y: pos.y });
      this.setMarker(target.x, target.y, '#ffd24d');
      this.audio.ack('work', units);
      return;
    }
    if (target && target.kind === 'building' && target.owner === this.me && citizens.length) {
      if (!target.built || target.hp < target.maxHp) {
        world.issue({ type: 'construct', player: this.me, ids: citizens, targetId: target.id });
      } else if (target.type === 'farm') {
        world.issue({ type: 'gather', player: this.me, ids: citizens, targetId: target.id });
      } else if (BUILDING_DEFS[target.type].dropoff) {
        // Citizens with a load store it, the others just walk over.
        const carriers = units.filter((u) => u.role === 'citizen' && u.carryAmount > 0).map((u) => u.id);
        if (carriers.length) world.issue({ type: 'deposit', player: this.me, ids: carriers, targetId: target.id });
        const rest = citizens.filter((id) => !carriers.includes(id));
        if (rest.length) world.issue({ type: 'move', player: this.me, ids: rest, x: pos.x, y: pos.y });
      } else {
        world.issue({ type: 'move', player: this.me, ids: citizens, x: pos.x, y: pos.y });
      }
      if (others.length) world.issue({ type: 'move', player: this.me, ids: others, x: pos.x, y: pos.y });
      this.setMarker(target.x, target.y, '#8dff5a');
      this.audio.ack('work', units);
      return;
    }
    world.issue({ type: 'move', player: this.me, ids, x: pos.x, y: pos.y });
    this.setMarker(pos.x, pos.y, '#8dff5a');
    this.audio.ack('move', units);
  }

  attackMoveTo(sx: number, sy: number): void {
    const pos = this.camera.screenToWorld(sx, sy);
    const units = this.selectedOwnUnits();
    const ids = units.map((u) => u.id);
    if (ids.length) this.world.issue({ type: 'move', player: this.me, ids, x: pos.x, y: pos.y, attackMove: true });
    this.setMarker(pos.x, pos.y, '#ff5a4d');
    this.audio.ack('attack', units);
    this.mode = 'normal';
  }

  setMarker(x: number, y: number, color: string): void {
    this.marker = { x, y, t: 0, color };
  }

  beginPlacement(type: BuildingType): void {
    if (!this.world.buildingUnlocked(this.me, type)) return;
    this.mode = 'place';
    const c = this.camera.center();
    this.placement = { type, tx: Math.floor(c.x), ty: Math.floor(c.y), valid: false };
  }

  updatePlacement(sx: number, sy: number): void {
    if (!this.placement) return;
    const pos = this.camera.screenToWorld(sx, sy);
    const size = BUILDING_DEFS[this.placement.type].size;
    this.placement.tx = Math.round(pos.x - size / 2);
    this.placement.ty = Math.round(pos.y - size / 2);
    this.refreshPlacement();
  }

  /** Walls and gates: the mouse button went down, start a line there. */
  startLine(): void {
    const p = this.placement;
    if (!p || !BUILDING_DEFS[p.type].line) return;
    p.anchor = { tx: p.tx, ty: p.ty };
    this.refreshPlacement();
  }

  /** Re-checks the ghost (and every planned wall segment) against the world. */
  private refreshPlacement(): void {
    const p = this.placement;
    if (!p) return;
    p.valid = this.world.canPlace(this.me, p.type, p.tx, p.ty);
    if (!p.anchor) {
      p.line = null;
      return;
    }
    const cost = BUILDING_DEFS[p.type].cost;
    const stock: Stock = { ...this.world.players[this.me].stock };
    p.line = lineTiles(p.anchor.tx, p.anchor.ty, p.tx, p.ty).map(([tx, ty]) => {
      // Mirrors World.commandPlaceLine: blocked tiles are skipped, the rest is paid in order.
      const valid = this.world.canPlace(this.me, p.type, tx, ty) && canAfford(stock, cost);
      if (valid) for (const [r, v] of Object.entries(cost)) stock[r as keyof Stock] -= v ?? 0;
      return { tx, ty, valid };
    });
  }

  confirmPlacement(keepMode: boolean): void {
    const p = this.placement;
    if (!p) return;
    const citizens = this.selectedOwnUnits().filter((u) => u.role === 'citizen');
    if (!citizens.length) {
      this.cancelMode();
      return;
    }
    if (BUILDING_DEFS[p.type].line) {
      const tiles = (p.line ?? [{ tx: p.tx, ty: p.ty }]).map((t) => ({ x: t.tx, y: t.ty }));
      p.anchor = null;
      p.line = null;
      if (tiles.length === 1 && !this.world.canPlace(this.me, p.type, tiles[0].x, tiles[0].y)) {
        this.hud.message('warn', 'Hier kann nicht gebaut werden.');
        return;
      }
      this.world.issue({ type: 'placeLine', player: this.me, ids: citizens.map((u) => u.id), building: p.type, tiles });
      this.audio.ui('place');
      if (!keepMode) this.cancelMode();
      return;
    }
    if (!this.world.canPlace(this.me, p.type, p.tx, p.ty)) {
      this.hud.message('warn', 'Hier kann nicht gebaut werden.');
      return;
    }
    this.world.issue({ type: 'place', player: this.me, ids: citizens.map((u) => u.id), building: p.type, tx: p.tx, ty: p.ty });
    this.audio.ui('place');
    if (!keepMode) this.cancelMode();
  }

  cancelMode(): void {
    this.mode = 'normal';
    this.placement = null;
  }

  train(buildingId: number, role: Role, count: number): void {
    this.world.issue({ type: 'train', player: this.me, buildingId, role, count });
  }

  advance(buildingId: number): void {
    this.world.issue({ type: 'advance', player: this.me, buildingId });
  }

  research(buildingId: number, tech: string): void {
    this.world.issue({ type: 'research', player: this.me, buildingId, tech });
  }

  cancelTech(buildingId: number): void {
    this.world.issue({ type: 'cancelTech', player: this.me, buildingId });
  }

  cancelQueue(buildingId: number, index: number): void {
    this.world.issue({ type: 'cancel', player: this.me, buildingId, index });
  }

  stop(): void {
    const ids = this.selectedOwnUnits().map((u) => u.id);
    if (ids.length) this.world.issue({ type: 'stop', player: this.me, ids });
  }

  explore(): void {
    const ids = this.selectedOwnUnits().map((u) => u.id);
    if (ids.length) this.world.issue({ type: 'explore', player: this.me, ids });
  }

  /** Entf: demolishes own buildings and dismisses own units in the selection. */
  deleteSelection(): void {
    const ids = this.selectedEntities()
      .filter((e) => e.kind !== 'resource' && e.owner === this.me)
      .map((e) => e.id);
    if (ids.length) this.world.issue({ type: 'destroy', player: this.me, ids });
  }

  idleCitizens(): Unit[] {
    return this.world.unitsOf(this.me).filter((u) => u.role === 'citizen' && u.order.kind === 'idle');
  }

  selectNextIdle(): void {
    const idle = this.idleCitizens();
    if (!idle.length) {
      this.hud.message('info', 'Keine untätigen Bürger.');
      return;
    }
    const u = idle[this.idleIndex++ % idle.length];
    this.select([u.id]);
    this.centerOn(u.x, u.y);
  }

  centerOn(x: number, y: number): void {
    this.camera.centerOn(x, y);
  }

  togglePause(force?: boolean): void {
    this.paused = force ?? !this.paused;
    this.hud.setPaused(this.paused);
    this.audio.setPaused(this.paused);
  }

  changeSpeed(delta: number): void {
    const speeds = [0.5, 1, 1.5, 2, 3];
    const i = Math.max(0, Math.min(speeds.length - 1, speeds.indexOf(this.speed) + delta));
    this.speed = speeds[i];
    this.hud.message('info', `Spielgeschwindigkeit: ${this.speed}×`);
  }

  exitToMenu(): void {
    this.destroy();
    this.onExit();
  }
}

/** Tiles on a straight line between two tiles (Bresenham), at most MAX_LINE long. */
export function lineTiles(x0: number, y0: number, x1: number, y1: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    out.push([x, y]);
    if ((x === x1 && y === y1) || out.length >= MAX_LINE) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return out;
}
