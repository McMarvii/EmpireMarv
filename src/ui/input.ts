import { BUILDING_DEFS } from '../data/buildings';
import type { Game } from '../game';
import type { Building, Unit } from '../sim/entities';

const EDGE = 14;
const PAN_SPEED = 900;
const DRAG_THRESHOLD = 5;

/** Mouse and keyboard handling for the battlefield. */
export class Input {
  hoverId = 0;
  private mouseX = -1;
  private mouseY = -1;
  private inWindow = false;
  private dragStart: { x: number; y: number } | null = null;
  private panDrag: { x: number; y: number; camX: number; camY: number } | null = null;
  /** Right button held: a drag pans the camera, a click without drag issues a command. */
  private rightDrag: { x: number; y: number; camX: number; camY: number; panning: boolean } | null = null;
  /** Right button held with own units selected: a drag sets target and facing instead of panning. */
  private orderDrag: { x: number; y: number; dragging: boolean } | null = null;
  private keys = new Set<string>();
  /** Tab pressed: the next letter picks a building type (until this time). */
  private prefixUntil = 0;
  private lastClick = { time: 0, id: 0 };
  private selbox: HTMLElement;
  private cleanup: Array<() => void> = [];

  constructor(
    private game: Game,
    private canvas: HTMLCanvasElement,
  ) {
    this.selbox = game.root.querySelector<HTMLElement>('#selbox')!;
    this.listen(canvas, 'mousedown', (e) => this.onMouseDown(e as MouseEvent));
    this.listen(window, 'mousemove', (e) => this.onMouseMove(e as MouseEvent));
    this.listen(window, 'mouseup', (e) => this.onMouseUp(e as MouseEvent));
    this.listen(canvas, 'contextmenu', (e) => e.preventDefault());
    this.listen(canvas, 'wheel', (e) => this.onWheel(e as WheelEvent), { passive: false });
    this.listen(window, 'keydown', (e) => this.onKeyDown(e as KeyboardEvent));
    this.listen(window, 'keyup', (e) => {
      const key = (e as KeyboardEvent).key;
      this.keys.delete(key);
      // Shift released after queuing patrol or attack-move points: done.
      if (key === 'Shift' && game.stickyMode) game.cancelMode();
    });
    this.listen(window, 'blur', () => {
      this.keys.clear();
      this.rightDrag = null;
      this.panDrag = null;
      this.orderDrag = null;
      game.preview = null;
    });
    this.listen(window, 'resize', () => game.resize());
    this.listen(document, 'mouseleave', () => (this.inWindow = false));
    this.listen(document, 'mouseenter', () => (this.inWindow = true));
    const minimap = game.root.querySelector<HTMLCanvasElement>('#minimap')!;
    const minimapJump = (e: Event) => {
      const me = e as MouseEvent;
      const r = minimap.getBoundingClientRect();
      const pos = game.minimap.toWorld(me.clientX - r.left, me.clientY - r.top);
      if (me.altKey && me.type === 'mousedown' && me.button === 0) {
        game.markSpot(pos.x, pos.y, true);
        return;
      }
      if (me.button === 2 || (me.type === 'contextmenu' && me.button !== 0)) {
        e.preventDefault();
        const ids = game.selectedOwnUnits().map((u) => u.id);
        if (ids.length) game.issue({ type: 'move', player: game.me, ids, x: pos.x, y: pos.y, queue: me.shiftKey });
        return;
      }
      if (me.buttons & 1 || me.type === 'mousedown') game.centerOn(pos.x, pos.y);
    };
    this.listen(minimap, 'mousedown', minimapJump);
    this.listen(minimap, 'mousemove', minimapJump);
    this.listen(minimap, 'contextmenu', (e) => e.preventDefault());
  }

  private listen(target: EventTarget, type: string, fn: (e: Event) => void, opts?: AddEventListenerOptions): void {
    target.addEventListener(type, fn, opts);
    this.cleanup.push(() => target.removeEventListener(type, fn, opts));
  }

  get shiftHeld(): boolean {
    return this.keys.has('Shift');
  }

  destroy(): void {
    for (const c of this.cleanup) c();
    this.selbox.hidden = true;
  }

  update(dt: number): void {
    const cam = this.game.camera;
    let dx = 0;
    let dy = 0;
    if (this.keys.has('ArrowLeft')) dx -= 1;
    if (this.keys.has('ArrowRight')) dx += 1;
    if (this.keys.has('ArrowUp')) dy -= 1;
    if (this.keys.has('ArrowDown')) dy += 1;
    if (this.inWindow && !this.dragStart && !this.panDrag && !this.rightDrag?.panning && this.mouseX >= 0) {
      if (this.mouseX < EDGE) dx -= 1;
      if (this.mouseX > window.innerWidth - EDGE) dx += 1;
      if (this.mouseY < EDGE) dy -= 1;
      if (this.mouseY > window.innerHeight - EDGE) dy += 1;
    }
    if (dx || dy) {
      cam.x += (dx * PAN_SPEED * dt) / cam.zoom;
      cam.y += (dy * PAN_SPEED * dt) / cam.zoom;
    }
    if (this.panDrag || this.rightDrag?.panning) {
      this.canvas.style.cursor = 'grabbing';
    } else if (this.mouseX >= 0 && !this.dragStart) {
      const over = this.overCanvas();
      const hit = over ? this.game.renderer.pick(this.mouseX, this.mouseY, 1) : null;
      this.hoverId = hit ? hit.id : 0;
      this.canvas.style.cursor = this.cursorFor(hit?.id ?? 0);
    }
  }

  private overCanvas(): boolean {
    const el = document.elementFromPoint(this.mouseX, this.mouseY);
    return el === this.canvas;
  }

  private cursorFor(hoverId: number): string {
    const game = this.game;
    if (game.mode === 'attackMove' || game.mode === 'patrol') return 'crosshair';
    if (game.mode === 'place') return 'copy';
    if (!hoverId || game.selectedOwnUnits().length === 0) return 'default';
    const e = game.world.get(hoverId);
    if (!e) return 'default';
    if (e.kind !== 'resource' && game.world.areEnemies(game.me, e.owner)) return 'crosshair';
    if (e.kind === 'resource') return 'pointer';
    if (e.kind === 'building' && e.owner === game.me && e.built && BUILDING_DEFS[e.type].dropoff) {
      if (game.selectedOwnUnits().some((u) => u.role === 'citizen' && u.carryAmount > 0)) return 'pointer';
    }
    return 'default';
  }

  private onMouseDown(e: MouseEvent): void {
    this.inWindow = true;
    const game = this.game;
    if (game.hud.overlayOpen()) return;
    if (e.button === 1) {
      e.preventDefault();
      this.panDrag = { x: e.clientX, y: e.clientY, camX: game.camera.x, camY: game.camera.y };
      return;
    }
    if (e.button === 2) {
      if (game.mode === 'normal' && game.selectedOwnUnits().length > 0) {
        this.orderDrag = { x: e.clientX, y: e.clientY, dragging: false };
      } else {
        this.rightDrag = { x: e.clientX, y: e.clientY, camX: game.camera.x, camY: game.camera.y, panning: false };
      }
      return;
    }
    if (e.button !== 0) return;
    if (e.altKey && game.net) {
      // Alt+click: point a spot out to the own team.
      game.markSpot(e.clientX, e.clientY);
      return;
    }
    if (game.mode === 'place') {
      game.updatePlacement(e.clientX, e.clientY);
      // Walls are dragged out as a line and placed on release.
      if (game.placement && BUILDING_DEFS[game.placement.type].line) game.startLine();
      else game.confirmPlacement(e.shiftKey);
      return;
    }
    if (game.mode === 'attackMove') {
      game.attackMoveTo(e.clientX, e.clientY, e.shiftKey);
      return;
    }
    if (game.mode === 'patrol') {
      game.patrolTo(e.clientX, e.clientY, e.shiftKey);
      return;
    }
    this.dragStart = { x: e.clientX, y: e.clientY };
  }

  private onMouseMove(e: MouseEvent): void {
    this.mouseX = e.clientX;
    this.mouseY = e.clientY;
    this.inWindow = true;
    const game = this.game;
    if (this.panDrag) {
      game.camera.x = this.panDrag.camX - (e.clientX - this.panDrag.x) / game.camera.zoom;
      game.camera.y = this.panDrag.camY - (e.clientY - this.panDrag.y) / game.camera.zoom;
      return;
    }
    const od = this.orderDrag;
    if (od) {
      if (!od.dragging && Math.hypot(e.clientX - od.x, e.clientY - od.y) > DRAG_THRESHOLD * 3) od.dragging = true;
      if (od.dragging) game.updateOrderPreview(od.x, od.y, e.clientX, e.clientY);
      return;
    }
    const rd = this.rightDrag;
    if (rd) {
      if (!rd.panning && (Math.abs(e.clientX - rd.x) > DRAG_THRESHOLD || Math.abs(e.clientY - rd.y) > DRAG_THRESHOLD)) rd.panning = true;
      if (rd.panning) {
        game.camera.x = rd.camX - (e.clientX - rd.x) / game.camera.zoom;
        game.camera.y = rd.camY - (e.clientY - rd.y) / game.camera.zoom;
        return;
      }
    }
    if (game.mode === 'place') game.updatePlacement(e.clientX, e.clientY);
    if (this.dragStart) {
      const x0 = Math.min(this.dragStart.x, e.clientX);
      const y0 = Math.min(this.dragStart.y, e.clientY);
      const w = Math.abs(e.clientX - this.dragStart.x);
      const h = Math.abs(e.clientY - this.dragStart.y);
      if (w > DRAG_THRESHOLD || h > DRAG_THRESHOLD) {
        Object.assign(this.selbox.style, { left: `${x0}px`, top: `${y0}px`, width: `${w}px`, height: `${h}px` });
        this.selbox.hidden = false;
      }
    }
  }

  private onMouseUp(e: MouseEvent): void {
    if (e.button === 1) {
      this.panDrag = null;
      return;
    }
    if (e.button === 2 && this.orderDrag) {
      const od = this.orderDrag;
      this.orderDrag = null;
      this.game.preview = null;
      if (this.game.hud.overlayOpen()) return;
      if (od.dragging) this.game.dragMove(od.x, od.y, e.clientX, e.clientY, e.shiftKey);
      else if (document.elementFromPoint(e.clientX, e.clientY) === this.canvas) this.game.rightClick(e.clientX, e.clientY, e.shiftKey);
      return;
    }
    if (e.button === 2) {
      const rd = this.rightDrag;
      this.rightDrag = null;
      // Released over the HUD: no command for the ground hidden behind it.
      if (!rd || rd.panning || this.game.hud.overlayOpen() || document.elementFromPoint(e.clientX, e.clientY) !== this.canvas) return;
      if (this.game.mode !== 'normal') this.game.cancelMode();
      else this.game.rightClick(e.clientX, e.clientY, e.shiftKey);
      return;
    }
    if (e.button === 0 && this.game.mode === 'place' && this.game.placement?.anchor) {
      this.game.confirmPlacement(e.shiftKey);
      return;
    }
    if (e.button !== 0 || !this.dragStart) return;
    const start = this.dragStart;
    this.dragStart = null;
    this.selbox.hidden = true;
    const game = this.game;
    const moved = Math.abs(e.clientX - start.x) > DRAG_THRESHOLD || Math.abs(e.clientY - start.y) > DRAG_THRESHOLD;
    if (moved) {
      this.boxSelect(start.x, start.y, e.clientX, e.clientY, e.shiftKey);
      return;
    }
    const hit = game.renderer.pick(e.clientX, e.clientY, 1);
    const now = performance.now();
    if (hit && hit.kind !== 'resource' && hit.owner === game.me && now - this.lastClick.time < 350 && this.lastClick.id === hit.id) {
      this.selectSameType(hit);
      this.lastClick = { time: 0, id: 0 };
      return;
    }
    this.lastClick = { time: now, id: hit?.id ?? 0 };
    if (!hit) {
      if (!e.shiftKey) game.select([]);
      return;
    }
    if (e.shiftKey && game.selection.has(hit.id)) {
      game.selection.delete(hit.id);
      game.hud.selectionChanged();
      return;
    }
    // Shift adds own units to units, or own buildings of the same type to buildings.
    const ownBuildings = game.selectedOwnBuildings();
    const add =
      e.shiftKey &&
      hit.kind !== 'resource' &&
      hit.owner === game.me &&
      ((hit.kind === 'unit' && game.selectedOwnUnits().length > 0) ||
        (hit.kind === 'building' && ownBuildings.length > 0 && ownBuildings.length === game.selection.size && ownBuildings[0].type === hit.type));
    game.select([hit.id], add);
  }

  private boxSelect(x0: number, y0: number, x1: number, y1: number, add: boolean): void {
    const game = this.game;
    const minX = Math.min(x0, x1);
    const maxX = Math.max(x0, x1);
    const minY = Math.min(y0, y1);
    const maxY = Math.max(y0, y1);
    const inside: Unit[] = [];
    for (const u of game.world.units) {
      if (u.dead || u.owner !== game.me) continue;
      const [sx, sy] = game.renderer.screenPosOf(u, 1);
      if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) inside.push(u);
    }
    // Soldiers take priority over workers, like in the classics.
    const military = inside.filter((u) => u.role !== 'citizen');
    const pick = military.length ? military : inside;
    if (pick.length) {
      game.select(pick.map((u) => u.id), add);
      return;
    }
    // No units in the box: own finished buildings of the most frequent type.
    const byType = new Map<string, Building[]>();
    for (const b of game.world.buildings) {
      if (b.dead || b.owner !== game.me || !b.built) continue;
      const [sx, sy] = game.renderer.screenPosOf(b, 1);
      if (sx < minX || sx > maxX || sy < minY || sy > maxY) continue;
      const list = byType.get(b.type) ?? [];
      list.push(b);
      byType.set(b.type, list);
    }
    const best = [...byType.values()].sort((a, b) => b.length - a.length)[0];
    if (best) game.select(best.map((b) => b.id));
    else if (!add) game.select([]);
  }

  /** Double click: every own unit of that kind (or building of that type) on screen. */
  private selectSameType(hit: Unit | Building): void {
    const game = this.game;
    const ids: number[] = [];
    const list: Array<Unit | Building> =
      hit.kind === 'unit'
        ? game.world.units.filter((u) => u.role === hit.role && u.tier === hit.tier)
        : game.world.buildings.filter((b) => b.type === hit.type && b.built === hit.built);
    for (const e of list) {
      if (e.dead || e.owner !== game.me) continue;
      const [sx, sy] = game.renderer.screenPosOf(e, 1);
      if (sx >= 0 && sy >= 0 && sx <= game.camera.viewW && sy <= game.camera.viewH) ids.push(e.id);
    }
    game.select(ids);
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    this.game.camera.zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 1 / 1.12);
  }

  private onKeyDown(e: KeyboardEvent): void {
    const game = this.game;
    if (e.key === 'Shift') this.keys.add('Shift');
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT')) {
      // A focused slider or checkbox (sound dialog) still lets Esc close and Ctrl+M mute.
      const type = (target as HTMLInputElement).type;
      const passive = target.tagName === 'INPUT' && (type === 'range' || type === 'checkbox');
      if (!passive || (e.key !== 'Escape' && !(e.ctrlKey && (e.key === 'm' || e.key === 'M')))) return;
    }
    if (e.key.startsWith('Arrow')) {
      this.keys.add(e.key);
      e.preventDefault();
      return;
    }
    // Tab, then a building's letter: select (and cycle through) buildings of that type.
    if (e.key === 'Tab') {
      e.preventDefault();
      if (game.hud.overlayOpen()) return;
      this.prefixUntil = performance.now() + 2500;
      game.hud.setPrefix(true);
      return;
    }
    if (this.prefixUntil > 0) {
      const active = performance.now() < this.prefixUntil;
      this.prefixUntil = 0;
      game.hud.setPrefix(false);
      if (active && e.key.length === 1 && /[a-z]/i.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        game.selectBuildingByKey(e.key);
        return;
      }
      if (e.key === 'Escape') return;
    }
    if (e.key === 'F1') {
      e.preventDefault();
      game.hud.showHelp();
      return;
    }
    if (e.key === 'F2') {
      e.preventDefault();
      if (game.hud.overlayOpen()) game.menuPause(false);
      else game.hud.showTechTree();
      return;
    }
    if (e.ctrlKey && (e.key === 'm' || e.key === 'M')) {
      e.preventDefault();
      game.hud.toggleMute();
      return;
    }
    if (e.key === 'Enter' && game.netUi && !game.hud.overlayOpen()) {
      // Enter: chat to everyone; Shift+Enter: to the own team.
      e.preventDefault();
      game.netUi.openChat(e.shiftKey);
      return;
    }
    if (e.key === 'Escape') {
      if (game.hud.overlayOpen()) {
        if (game.world.over) game.hud.closeOverlay();
        else game.menuPause(false);
      } else if (game.mode !== 'normal') game.cancelMode();
      else if (game.selection.size) game.select([]);
      else game.hud.showPauseMenu();
      return;
    }
    if (game.hud.overlayOpen()) return;
    if (e.key === 'p' || e.key === 'P' || e.key === 'Pause') {
      game.togglePause();
      return;
    }
    if (game.paused) return;
    if (e.key === '+' || e.key === '=') return game.changeSpeed(1);
    if (e.key === '-') return game.changeSpeed(-1);
    if (e.key === ' ') {
      e.preventDefault();
      if (game.lastAlert) game.centerOn(game.lastAlert.x, game.lastAlert.y);
      return;
    }
    if (e.key === 'Home') {
      const tc = game.world.buildingsOf(game.me, 'towncenter')[0];
      if (tc) {
        game.select([tc.id]);
        game.centerOn(tc.x, tc.y);
      }
      return;
    }
    if (e.key === '.') {
      game.selectNextIdle();
      return;
    }
    if (e.key === 'Delete') {
      e.preventDefault();
      game.deleteSelection();
      return;
    }
    const digit = e.code.startsWith('Digit') ? e.code.slice(5) : '';
    if (digit && digit !== '0') {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) game.saveGroup(digit);
      else game.recallGroup(digit);
      return;
    }
    if (e.key.length === 1 && /[a-z]/i.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (game.hud.hotkey(e.key, e.shiftKey)) e.preventDefault();
    }
  }
}
