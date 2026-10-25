import { BUILDING_DEFS, type BuildingType } from './data/buildings';
import type { Role } from './data/units';
import { Camera } from './render/camera';
import { Minimap } from './render/minimap';
import { Renderer, type Marker, type Placement } from './render/renderer';
import { AIController } from './sim/ai';
import type { Building, Entity, Unit } from './sim/entities';
import { DT, World, type GameSettings } from './sim/world';
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
  readonly me = 0;
  selection = new Set<number>();
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
    if (this.placement) this.placement.valid = this.world.canPlace(this.me, this.placement.type, this.placement.tx, this.placement.ty);

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
  }

  selectedEntities(): Entity[] {
    const out: Entity[] = [];
    for (const id of this.selection) {
      const e = this.world.get(id);
      if (e) out.push(e);
    }
    return out;
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
      }
      return;
    }
    const ids = units.map((u) => u.id);
    const citizens = units.filter((u) => u.role === 'citizen').map((u) => u.id);
    const others = units.filter((u) => u.role !== 'citizen').map((u) => u.id);
    if (target && target.kind !== 'resource' && world.areEnemies(this.me, target.owner)) {
      world.issue({ type: 'attack', player: this.me, ids, targetId: target.id });
      this.setMarker(target.x, target.y, '#ff5a4d');
      return;
    }
    if (target && target.kind === 'resource' && citizens.length) {
      world.issue({ type: 'gather', player: this.me, ids: citizens, targetId: target.id });
      if (others.length) world.issue({ type: 'move', player: this.me, ids: others, x: pos.x, y: pos.y });
      this.setMarker(target.x, target.y, '#ffd24d');
      return;
    }
    if (target && target.kind === 'building' && target.owner === this.me && citizens.length) {
      if (!target.built || target.hp < target.maxHp) {
        world.issue({ type: 'construct', player: this.me, ids: citizens, targetId: target.id });
      } else if (target.type === 'farm') {
        world.issue({ type: 'gather', player: this.me, ids: citizens, targetId: target.id });
      } else {
        world.issue({ type: 'move', player: this.me, ids: citizens, x: pos.x, y: pos.y });
      }
      if (others.length) world.issue({ type: 'move', player: this.me, ids: others, x: pos.x, y: pos.y });
      this.setMarker(target.x, target.y, '#8dff5a');
      return;
    }
    world.issue({ type: 'move', player: this.me, ids, x: pos.x, y: pos.y });
    this.setMarker(pos.x, pos.y, '#8dff5a');
  }

  attackMoveTo(sx: number, sy: number): void {
    const pos = this.camera.screenToWorld(sx, sy);
    const ids = this.selectedOwnUnits().map((u) => u.id);
    if (ids.length) this.world.issue({ type: 'move', player: this.me, ids, x: pos.x, y: pos.y, attackMove: true });
    this.setMarker(pos.x, pos.y, '#ff5a4d');
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
  }

  confirmPlacement(keepMode: boolean): void {
    const p = this.placement;
    if (!p) return;
    const citizens = this.selectedOwnUnits().filter((u) => u.role === 'citizen');
    if (!citizens.length) {
      this.cancelMode();
      return;
    }
    if (!this.world.canPlace(this.me, p.type, p.tx, p.ty)) {
      this.hud.message('warn', 'Hier kann nicht gebaut werden.');
      return;
    }
    this.world.issue({ type: 'place', player: this.me, ids: citizens.map((u) => u.id), building: p.type, tx: p.tx, ty: p.ty });
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

  cancelQueue(buildingId: number, index: number): void {
    this.world.issue({ type: 'cancel', player: this.me, buildingId, index });
  }

  stop(): void {
    const ids = this.selectedOwnUnits().map((u) => u.id);
    if (ids.length) this.world.issue({ type: 'stop', player: this.me, ids });
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
