import { GameAudio } from './audio/director';
import { BUILDING_DEFS, buildingName, type BuildingType } from './data/buildings';
import { canAfford, type Stock } from './data/resources';
import type { Role } from './data/units';
import type { NetSession } from './net/session';
import { Camera } from './render/camera';
import { Minimap } from './render/minimap';
import { MARK_TIME, Renderer, type Mark, type Marker, type OrderPreview, type Placement } from './render/renderer';
import { View } from './render/view';
import { normalize, Recorder, storeLastReplay, type Replay } from './replay';
import { LocalSession, ReplaySession, type Session } from './session';
import type { Building, Entity, Unit } from './sim/entities';
import { formationSlots, type Formation } from './sim/formation';
import { createWorld } from './sim/setup';
import { DT, MAX_LINE, World, type Command, type GameSettings } from './sim/world';
import { Hud } from './ui/hud';
import { Input } from './ui/input';
import { NetUi } from './ui/netui';
import { ReplayBar } from './ui/replaybar';

export type Mode = 'normal' | 'place' | 'attackMove' | 'patrol';

export interface GameOptions {
  settings: Partial<GameSettings>;
  /** Slot of the local player (lockstep guests sit in other slots than 0). */
  me?: number;
  /** Multiplayer: the lockstep session that feeds every peer the same commands. */
  net?: NetSession;
  /** Watch a recorded match instead of playing. */
  replay?: Replay;
  /** Fast-forward to this tick before showing the match (replay seek, rejoin). */
  startAt?: number;
}

/** Steps run per frame at most, so a slow frame cannot snowball. */
const MAX_STEPS = 12;
/** Time per frame spent fast-forwarding (rejoin, replay seek). */
const CATCH_UP_BUDGET = 30;

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
  readonly view: View;
  readonly session: Session;
  readonly net: NetSession | null;
  readonly replay: ReplaySession | null;
  /** Records every match for "Letzte Partie ansehen" and the replay download. */
  readonly recorder: Recorder | null;
  readonly netUi: NetUi | null;
  readonly replayBar: ReplayBar | null;
  marks: Mark[] = [];
  selection = new Set<number>();
  /** Control groups (Strg+1–9), shown in the group bar. */
  readonly groups = new Map<string, number[]>();
  activeGroup = '';
  private lastGroupTap = { key: '', time: 0 };
  private lastBuildingTap = { type: '', time: 0 };
  mode: Mode = 'normal';
  /** Attack-move or patrol kept open by Shift for more points; ends when Shift is released. */
  stickyMode = false;
  placement: Placement | null = null;
  paused = false;
  speed = 1;
  marker: Marker | null = null;
  /** Right-drag with units: where they will stand and which way they will face. */
  preview: OrderPreview | null = null;
  lastAlert: { x: number; y: number; time: number } | null = null;
  animTime = 0;
  /** Fast-forwarding up to this tick (rejoin, replay seek); the screen shows progress meanwhile. */
  catchUpTo: number | null = null;
  /** The world waits for commands that have not arrived (lockstep). */
  stalled = false;
  private acc = 0;
  private lastFrame = 0;
  private raf = 0;
  private hiddenTimer = 0;
  private gameOverShown = false;
  private idleIndex = 0;
  /** Closing the tab, the end of the match or leaving keeps it as "Letzte Partie". */
  private keepReplay = () => {
    if (this.recorder) storeLastReplay(this.recorder.replay);
  };

  constructor(
    readonly root: HTMLElement,
    readonly options: GameOptions,
    private onExit: () => void,
  ) {
    const settings = options.replay?.settings ?? options.settings;
    this.world = createWorld(settings);
    this.view = new View(this.world, options.me ?? options.replay?.me ?? 0);
    // Replays usually want to see what everybody did.
    this.view.revealAll = Boolean(options.replay);
    this.net = options.net ?? null;
    this.replay = options.replay ? new ReplaySession(options.replay) : null;
    this.session = this.net ?? this.replay ?? new LocalSession((cmd) => this.apply(cmd));
    this.recorder = this.replay ? null : new Recorder(this.world.settings, this.me);
    if (this.replay) this.speed = 2;
    this.audio = new GameAudio(this);
    const canvas = root.querySelector<HTMLCanvasElement>('#game')!;
    this.renderer = new Renderer(canvas, this.world, this.camera, this.view);
    this.hud = new Hud(this);
    this.minimap = new Minimap(root.querySelector<HTMLCanvasElement>('#minimap')!, this.world, this.camera, this.view);
    this.input = new Input(this, canvas);
    this.netUi = this.net ? new NetUi(this, this.net) : null;
    this.replayBar = this.replay ? new ReplayBar(this) : null;
    if (this.net) {
      this.net.attach(this.netUi!);
      this.speed = this.net.speed;
      if (this.net.paused) this.setPaused(true);
    }
    this.resize();
    const start = this.world.startPositions[this.me];
    this.camera.centerOn(start.x + 2, start.y + 2);
    const tc = this.world.buildingsOf(this.me, 'towncenter')[0];
    if (tc && !this.replay) this.select([tc.id]);
    if (options.startAt) this.catchUpTo = options.startAt;
    if (!this.replay && !options.startAt) {
      this.hud.message('info', 'Willkommen! Bürger sammeln Rohstoffe – steige im Dorfzentrum in neue Epochen auf.');
    }
  }

  /** The player whose empire this screen shows (and, outside replays, commands). */
  get me(): number {
    return this.view.me;
  }

  /** Watching a replay: nothing can be commanded. */
  get viewer(): boolean {
    return this.replay !== null;
  }

  start(): void {
    this.lastFrame = performance.now();
    const loop = (now: number) => {
      this.frame(now);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    // Hidden tabs get no animation frames; a network match must keep ticking or everyone waits.
    this.hiddenTimer = window.setInterval(() => {
      if (document.hidden && this.net) this.frame(performance.now(), false);
    }, 100);
    window.addEventListener('pagehide', this.keepReplay);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    clearInterval(this.hiddenTimer);
    window.removeEventListener('pagehide', this.keepReplay);
    this.audio.stop();
    this.input.destroy();
    this.hud.destroy();
    this.netUi?.destroy();
    this.replayBar?.destroy();
  }

  resize(): void {
    this.renderer.resize(window.innerWidth, window.innerHeight);
    this.minimap.resize();
  }

  private frame(now: number, draw = true): void {
    const dt = Math.min(draw ? 0.25 : 2, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    if (this.catchUpTo !== null) this.catchUp();
    else if (!this.paused && !this.world.over) this.runFor(dt, draw ? MAX_STEPS : Math.ceil(dt / DT) + 2);
    if (!draw) {
      // Nobody hears a hidden tab; the backlog would all sound at once on return.
      this.world.cues.length = 0;
      return;
    }
    this.input.update(dt);
    this.camera.clamp(this.world.map.width);
    for (const id of [...this.selection]) if (!this.world.get(id)) this.selection.delete(id);
    if (this.placement) this.refreshPlacement();

    this.renderer.render({
      selection: this.selection,
      hoverId: this.input.hoverId,
      placement: this.placement,
      alpha: this.paused || this.stalled ? 1 : Math.min(1, this.acc / DT),
      time: this.animTime,
      marker: this.marker,
      showPlans: this.input.shiftHeld,
      preview: this.preview,
      marks: this.marks,
    });
    if (this.marker && (this.marker.t += dt) > 0.6) this.marker = null;
    for (const m of this.marks) m.age += dt;
    this.marks = this.marks.filter((m) => m.age < MARK_TIME);
    this.minimap.render();
    for (const m of this.marks) this.minimap.ping(m.x, m.y, m.age, m.color);
    if (this.catchUpTo === null) this.audio.update(dt);
    if (this.lastAlert && this.animTime - this.lastAlert.time < 4) {
      this.minimap.ping(this.lastAlert.x, this.lastAlert.y, this.animTime);
    }
    this.hud.update();
    if (this.replay) {
      for (const [, from, text] of this.replay.chatUntil(this.world.tick)) {
        this.hud.message('info', `${this.world.players[from]?.name ?? '?'}: ${text}`);
      }
      this.replayBar!.update();
    }
    if (this.world.over && !this.gameOverShown && this.catchUpTo === null) {
      this.gameOverShown = true;
      this.keepReplay();
      this.hud.showGameOver();
    }
  }

  /** Runs the simulation for `dt` seconds of game time, as far as the session lets it. */
  private runFor(dt: number, maxSteps: number): void {
    this.acc += dt * this.speed;
    // A lockstep guest that fell behind the host catches up a little faster.
    const behind = this.session.behind?.(this.world.tick) ?? 0;
    if (behind > 2) this.acc += Math.min(behind - 2, 6) * DT;
    let steps = 0;
    this.stalled = false;
    while (this.acc >= DT && steps < maxSteps) {
      if (!this.stepOnce()) {
        this.stalled = true;
        this.acc = Math.min(this.acc, DT);
        break;
      }
      this.acc -= DT;
      steps++;
    }
    if (steps === maxSteps) this.acc = 0;
    if (!this.stalled) this.animTime += dt;
    if (this.replay && this.world.tick >= this.replay.replay.ticks && !this.paused) this.togglePause(true);
  }

  /** One tick: the commands due now, then the world. False while they have not arrived. */
  private stepOnce(): boolean {
    if (this.world.over) return false;
    const cmds = this.session.commandsAt(this.world.tick);
    if (!cmds) return false;
    for (const cmd of cmds) this.apply(cmd);
    this.world.step();
    this.recorder?.stepped(this.world);
    this.session.stepped(this.world);
    return true;
  }

  /** Fast-forward in slices, so the page stays responsive and can show progress. */
  private catchUp(): void {
    const target = this.catchUpTo!;
    const until = performance.now() + CATCH_UP_BUDGET;
    while (this.world.tick < target && !this.world.over && performance.now() < until) {
      if (!this.stepOnce()) break;
    }
    // What happened on the way is history: no sounds, no flood of messages.
    this.world.events.length = 0;
    this.world.cues.length = 0;
    this.world.effects.length = 0;
    if (this.world.tick >= target || this.world.over) {
      this.catchUpTo = null;
      this.acc = 0;
      this.hud.message('info', this.replay ? 'Wiedergabe läuft.' : 'Spielstand aufgeholt.');
    }
  }

  /** Every command of the local player goes through here – never straight into the world. */
  issue(cmd: Command): void {
    if (this.viewer) return;
    this.session.submit(cmd);
  }

  /** A command takes effect: exactly as it would arrive over the network, and recorded. */
  private apply(cmd: Command): void {
    const c = normalize(cmd);
    this.recorder?.command(this.world.tick, c);
    this.world.issue(c);
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

  /** Units the local player may command (none while watching a replay). */
  selectedOwnUnits(): Unit[] {
    if (this.viewer) return [];
    return this.selectedEntities().filter((e): e is Unit => e.kind === 'unit' && e.owner === this.me);
  }

  selectedOwnBuilding(): Building | null {
    return this.selectedOwnBuildings()[0] ?? null;
  }

  selectedOwnBuildings(): Building[] {
    if (this.viewer) return [];
    return this.selectedEntities().filter((e): e is Building => e.kind === 'building' && e.owner === this.me);
  }

  /**
   * Tab, then a building letter: selects the next own building of that type,
   * idle ones first. The same keys again within 0.8 s jump the camera there.
   */
  selectBuildingByKey(key: string): void {
    const type = (Object.keys(BUILDING_DEFS) as BuildingType[]).find((t) => BUILDING_DEFS[t].hotkey === key.toUpperCase());
    if (!type || BUILDING_DEFS[type].line) return;
    const list = this.world
      .buildingsOf(this.me, type)
      .filter((b) => b.built)
      .sort((a, b) => Number(isBusy(a)) - Number(isBusy(b)) || a.id - b.id);
    if (!list.length) {
      this.hud.message('info', `Kein Gebäude vom Typ ${buildingName(type, this.world.players[this.me].epoch)}.`);
      return;
    }
    const now = performance.now();
    const current = this.selectedOwnBuildings().find((b) => b.type === type);
    if (current && this.lastBuildingTap.type === type && now - this.lastBuildingTap.time < 800) {
      this.centerOn(current.x, current.y);
      this.lastBuildingTap = { type: '', time: 0 };
      return;
    }
    this.lastBuildingTap = { type, time: now };
    const at = current ? list.findIndex((b) => b.id === current.id) : -1;
    const next = list[(at + 1) % list.length];
    this.select([next.id]);
  }

  // -------------------------------------------------------------- commands

  /** Context-sensitive right click, the heart of classic RTS controls. Shift (`queue`) appends to the orders. */
  rightClick(sx: number, sy: number, queue = false): void {
    const world = this.world;
    const pos = this.camera.screenToWorld(sx, sy);
    const target = this.renderer.pick(sx, sy, 1);
    const units = this.selectedOwnUnits();
    if (units.length === 0) {
      const producers = this.selectedOwnBuildings().filter((b) => BUILDING_DEFS[b.type].trains.length > 0);
      if (producers.length) {
        const at = target && target.kind === 'resource' ? { x: target.x, y: target.y } : pos;
        for (const b of producers) this.issue({ type: 'rally', player: this.me, buildingId: b.id, x: at.x, y: at.y, queue });
        this.setMarker(at.x, at.y, '#ffffff');
        this.audio.ack('move', producers);
      }
      return;
    }
    const ids = units.map((u) => u.id);
    const citizens = units.filter((u) => u.role === 'citizen').map((u) => u.id);
    const others = units.filter((u) => u.role !== 'citizen').map((u) => u.id);
    if (target && target.kind !== 'resource' && world.areEnemies(this.me, target.owner)) {
      this.issue({ type: 'attack', player: this.me, ids, targetId: target.id, queue });
      this.setMarker(target.x, target.y, '#ff5a4d');
      this.audio.ack('attack', units);
      return;
    }
    if (target && target.kind === 'resource' && citizens.length) {
      this.issue({ type: 'gather', player: this.me, ids: citizens, targetId: target.id, queue });
      if (others.length) this.issue({ type: 'move', player: this.me, ids: others, x: pos.x, y: pos.y, queue });
      this.setMarker(target.x, target.y, '#ffd24d');
      this.audio.ack('work', units);
      return;
    }
    if (target && target.kind === 'building' && target.owner === this.me && citizens.length) {
      if (!target.built || target.hp < target.maxHp) {
        this.issue({ type: 'construct', player: this.me, ids: citizens, targetId: target.id, queue });
      } else if (target.type === 'farm') {
        this.issue({ type: 'gather', player: this.me, ids: citizens, targetId: target.id, queue });
      } else if (BUILDING_DEFS[target.type].dropoff) {
        // Citizens with a load store it, the others just walk over.
        const carriers = units.filter((u) => u.role === 'citizen' && u.carryAmount > 0).map((u) => u.id);
        if (carriers.length) this.issue({ type: 'deposit', player: this.me, ids: carriers, targetId: target.id, queue });
        const rest = citizens.filter((id) => !carriers.includes(id));
        if (rest.length) this.issue({ type: 'move', player: this.me, ids: rest, x: pos.x, y: pos.y, queue });
      } else {
        this.issue({ type: 'move', player: this.me, ids: citizens, x: pos.x, y: pos.y, queue });
      }
      if (others.length) this.issue({ type: 'move', player: this.me, ids: others, x: pos.x, y: pos.y, queue });
      this.setMarker(target.x, target.y, '#8dff5a');
      this.audio.ack('work', units);
      return;
    }
    this.issue({ type: 'move', player: this.me, ids, x: pos.x, y: pos.y, queue });
    this.setMarker(pos.x, pos.y, '#8dff5a');
    this.audio.ack('move', units);
  }

  /** Front direction from a right-drag between two screen points (world radians). */
  private dragFacing(sx0: number, sy0: number, sx1: number, sy1: number): { from: { x: number; y: number }; to: { x: number; y: number }; facing: number } {
    const from = this.camera.screenToWorld(sx0, sy0);
    const to = this.camera.screenToWorld(sx1, sy1);
    return { from, to, facing: Math.atan2(to.y - from.y, to.x - from.x) };
  }

  /** Slots the selected units would take for a right-drag, for the preview. */
  updateOrderPreview(sx0: number, sy0: number, sx1: number, sy1: number): void {
    const units = this.selectedOwnUnits();
    if (!units.length) {
      this.preview = null;
      return;
    }
    const { from, to, facing } = this.dragFacing(sx0, sy0, sx1, sy1);
    const slots = formationSlots(units, this.selectionFormation(units), from.x, from.y, facing);
    this.preview = { from, to, slots };
  }

  /** Right-drag released: walk to where the drag started, front towards where it ended. */
  dragMove(sx0: number, sy0: number, sx1: number, sy1: number, queue: boolean): void {
    this.preview = null;
    const units = this.selectedOwnUnits();
    if (!units.length) return;
    const { from, facing } = this.dragFacing(sx0, sy0, sx1, sy1);
    this.issue({ type: 'move', player: this.me, ids: units.map((u) => u.id), x: from.x, y: from.y, queue, facing });
    this.setMarker(from.x, from.y, '#8dff5a');
    this.audio.ack('move', units);
  }

  attackMoveTo(sx: number, sy: number, queue = false): void {
    const pos = this.camera.screenToWorld(sx, sy);
    const units = this.selectedOwnUnits();
    const ids = units.map((u) => u.id);
    if (ids.length) this.issue({ type: 'move', player: this.me, ids, x: pos.x, y: pos.y, attackMove: true, queue });
    this.setMarker(pos.x, pos.y, '#ff5a4d');
    this.audio.ack('attack', units);
    // With Shift held the mode stays, so more waypoints can follow.
    if (!queue) this.mode = 'normal';
    this.stickyMode = queue;
  }

  /** Patrol mode click: walk between here and there; Shift adds more points to the round. */
  patrolTo(sx: number, sy: number, queue = false): void {
    const pos = this.camera.screenToWorld(sx, sy);
    const units = this.selectedOwnUnits();
    if (units.length) this.issue({ type: 'patrol', player: this.me, ids: units.map((u) => u.id), x: pos.x, y: pos.y, queue });
    this.setMarker(pos.x, pos.y, '#ff5a4d');
    this.audio.ack('attack', units);
    if (!queue) this.mode = 'normal';
    this.stickyMode = queue;
  }

  /** The formation most of the units use (what the buttons show as active). */
  selectionFormation(units = this.selectedOwnUnits()): Formation {
    const votes = new Map<Formation, number>();
    for (const u of units) votes.set(u.formation, (votes.get(u.formation) ?? 0) + 1);
    let best: Formation = units[0]?.formation ?? 'block';
    for (const [f, n] of votes) if (n > (votes.get(best) ?? 0)) best = f;
    return best;
  }

  setFormation(formation: Formation): void {
    const units = this.selectedOwnUnits();
    if (!units.length) return;
    this.issue({ type: 'formation', player: this.me, ids: units.map((u) => u.id), formation });
    this.audio.ack('move', units);
  }

  setMarker(x: number, y: number, color: string): void {
    this.marker = { x, y, t: 0, color };
  }

  /** Alt+click: points a spot out to the own team. */
  markSpot(sx: number, sy: number, onMinimap = false): void {
    if (!this.net) return;
    const pos = onMinimap ? { x: sx, y: sy } : this.camera.screenToWorld(sx, sy);
    this.net.mark(pos.x, pos.y);
  }

  addMark(x: number, y: number, color: string): void {
    this.marks.push({ x, y, color, age: 0 });
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
      // Shift keeps placing and queues the work, so builders take one job after the other.
      this.issue({ type: 'placeLine', player: this.me, ids: citizens.map((u) => u.id), building: p.type, tiles, queue: keepMode });
      this.audio.ui('place');
      if (!keepMode) this.cancelMode();
      return;
    }
    if (!this.world.canPlace(this.me, p.type, p.tx, p.ty)) {
      this.hud.message('warn', 'Hier kann nicht gebaut werden.');
      return;
    }
    this.issue({ type: 'place', player: this.me, ids: citizens.map((u) => u.id), building: p.type, tx: p.tx, ty: p.ty, queue: keepMode });
    this.audio.ui('place');
    if (!keepMode) this.cancelMode();
  }

  cancelMode(): void {
    this.mode = 'normal';
    this.stickyMode = false;
    this.placement = null;
    this.preview = null;
  }

  /**
   * Trains `count` units, each in the building with the shortest queue. The
   * split is planned here: in a network match the queues only grow once the
   * command has gone round. The world stops at what is affordable.
   */
  train(buildings: Building[], role: Role, count: number): void {
    const planned = new Map(buildings.map((b) => [b, 0]));
    const load = (b: Building) => b.queue.length + planned.get(b)!;
    for (let i = 0; i < count; i++) {
      const b = [...buildings].sort((a, c) => load(a) - load(c) || a.id - c.id)[0];
      if (!b) return;
      planned.set(b, planned.get(b)! + 1);
    }
    for (const [b, n] of planned) if (n) this.issue({ type: 'train', player: this.me, buildingId: b.id, role, count: n });
  }

  advance(buildingId: number): void {
    this.issue({ type: 'advance', player: this.me, buildingId });
  }

  /** Researches in the least busy of the given buildings. */
  research(buildings: Building[], tech: string): void {
    const load = (b: Building) => (b.tech ? 1 : 0) + b.techQueue.length + (b.research ? 1 : 0);
    const b = [...buildings].filter((x) => x.built).sort((a, c) => load(a) - load(c) || a.id - c.id)[0];
    if (b) this.issue({ type: 'research', player: this.me, buildingId: b.id, tech });
  }

  cancelTech(buildingId: number, index?: number): void {
    this.issue({ type: 'cancelTech', player: this.me, buildingId, index });
  }

  cancelQueue(buildingId: number, index: number): void {
    this.issue({ type: 'cancel', player: this.me, buildingId, index });
  }

  stop(): void {
    const ids = this.selectedOwnUnits().map((u) => u.id);
    if (ids.length) this.issue({ type: 'stop', player: this.me, ids });
  }

  /** Marching in step on or off for the selected units. */
  setLockstep(on: boolean): void {
    const units = this.selectedOwnUnits();
    if (!units.length) return;
    this.issue({ type: 'lockstep', player: this.me, ids: units.map((u) => u.id), on });
    this.hud.message('info', on ? 'Gleichschritt an: Die Gruppe kommt gemeinsam an.' : 'Gleichschritt aus: Jede Einheit läuft so schnell sie kann.');
  }

  /** Alarm (on) or all clear (off) for every citizen of the player. */
  shelter(on: boolean): void {
    this.issue({ type: 'shelter', player: this.me, on });
  }

  /** Whether citizens are sheltering or on their way to a shelter. */
  sheltering(): boolean {
    const { world, me } = this;
    return world.buildings.some((b) => b.owner === me && b.garrison.length > 0) || world.units.some((u) => u.owner === me && !u.dead && u.order.kind === 'garrison');
  }

  explore(): void {
    const ids = this.selectedOwnUnits().map((u) => u.id);
    if (ids.length) this.issue({ type: 'explore', player: this.me, ids });
  }

  /** Entf: demolishes own buildings and dismisses own units in the selection. */
  deleteSelection(): void {
    const ids = this.selectedEntities()
      .filter((e) => e.kind !== 'resource' && e.owner === this.me)
      .map((e) => e.id);
    if (ids.length) this.issue({ type: 'destroy', player: this.me, ids });
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

  /** P, the pause button: in a network match every player pauses (and resumes) for all. */
  togglePause(force?: boolean): void {
    const paused = force ?? !this.paused;
    if (this.net) this.net.requestPause(paused);
    else this.setPaused(paused);
  }

  /** Pause state as it applies (in a network match: as the host announced it). */
  setPaused(paused: boolean): void {
    this.paused = paused;
    this.hud.setPaused(paused);
    this.audio.setPaused(paused);
  }

  /** Menus and dialogs stop the clock in single player; a network match keeps running. */
  menuPause(on: boolean): void {
    if (this.net) {
      if (!on) this.hud.closeOverlay();
      return;
    }
    this.togglePause(on);
  }

  changeSpeed(delta: number): void {
    if (this.net && this.net.kind !== 'host') {
      this.hud.message('info', 'Nur der Gastgeber kann die Spielgeschwindigkeit ändern.');
      return;
    }
    const speeds = this.replay ? [0.5, 1, 2, 4, 8, 16] : [0.5, 1, 1.5, 2, 3];
    const i = Math.max(0, Math.min(speeds.length - 1, speeds.indexOf(this.speed) + delta));
    this.setSpeed(speeds[i]);
    this.net?.setSpeed(this.speed);
    this.hud.message('info', `Spielgeschwindigkeit: ${this.speed}×`);
  }

  setSpeed(speed: number): void {
    this.speed = speed;
  }

  /** Replays: whose eyes to watch through, and whether the fog is lifted. */
  setPerspective(player: number, revealAll = this.view.revealAll): void {
    this.view.me = player;
    this.view.revealAll = revealAll;
    this.selection.clear();
    this.hud.selectionChanged();
  }

  /**
   * Replays: jump to a tick. Forward runs the simulation ahead; backward
   * starts the match over, since a deterministic world cannot run in reverse.
   */
  seek(tick: number): void {
    if (!this.replay) return;
    const target = Math.max(0, Math.min(this.replay.replay.ticks, Math.round(tick)));
    if (target >= this.world.tick) {
      this.catchUpTo = target;
      return;
    }
    // The old screen goes first: both use the same DOM elements.
    this.destroy();
    const next = new Game(this.root, { ...this.options, startAt: target }, this.onExit);
    next.camera.centerOn(this.camera.center().x, this.camera.center().y);
    next.camera.zoom = this.camera.zoom;
    next.setPerspective(this.view.me, this.view.revealAll);
    next.speed = this.speed;
    if (this.paused) next.setPaused(true);
    next.start();
    (window as unknown as { game: Game }).game = next;
  }

  /** Leaves the match; it stays available as "Letzte Partie ansehen". */
  exitToMenu(): void {
    this.keepReplay();
    this.net?.leave();
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

/** Whether a building is producing or researching anything. */
export function isBusy(b: Building): boolean {
  return b.queue.length > 0 || b.tech !== null || b.techQueue.length > 0 || b.research !== null || b.pendingAdvance !== null;
}
