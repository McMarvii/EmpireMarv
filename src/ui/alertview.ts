import type { Game } from '../game';
import { currentUiScale } from '../render/graphics';
import { edgePoint, findHotspots, type Hotspot } from './alerts';

/** Pressing Space again within this many seconds goes on to the next fight instead of the latest. */
const CYCLE_WINDOW = 4;

/**
 * Shows every fight of the own side at once: a pulsing ring per fight on the minimap and, for fights
 * outside the view, a red arrow at the screen edge that jumps there on a click. Space walks through them.
 */
export class AlertView {
  hotspots: Hotspot[] = [];
  private readonly el: HTMLElement;
  private readonly arrows: HTMLButtonElement[] = [];
  private lastScan = -1;
  private cycle = 0;
  private lastJump = -Infinity;
  /** The map area between the bars, in screen pixels. */
  private rect = { left: 0, top: 0, right: 0, bottom: 0 };

  constructor(private readonly game: Game) {
    this.el = document.createElement('div');
    this.el.id = 'alerts';
    game.root.querySelector('#hud')!.append(this.el);
    this.measure();
  }

  /** The bars may change size (window, interface size): the arrows stay between them. */
  measure(): void {
    const top = this.game.root.querySelector('#topbar')?.getBoundingClientRect().bottom ?? 0;
    const bottom = this.game.root.querySelector('#bottombar')?.getBoundingClientRect().top ?? window.innerHeight;
    this.rect = { left: 0, top, right: window.innerWidth, bottom };
  }

  update(time: number): void {
    const game = this.game;
    if (time - this.lastScan > 0.2 || time < this.lastScan) {
      this.lastScan = time;
      this.hotspots = findHotspots(game.world, game.view.me, this.hotspots);
    }
    this.hotspots.forEach((s, i) => game.minimap.ping(s.x, s.y, time * 1.2 + i * 0.37));
    // Measured once the bars are on screen (the HUD starts hidden).
    if (this.rect.bottom - this.rect.top < 100) this.measure();
    const scale = currentUiScale();
    let shown = 0;
    for (const s of this.hotspots) {
      const [sx, sy] = game.camera.project(s.x, s.y);
      const at = edgePoint(sx, sy, this.rect, 26 * scale);
      if (!at) continue;
      const arrow = this.arrow(shown++);
      arrow.style.left = `${at.x}px`;
      arrow.style.top = `${at.y}px`;
      arrow.style.setProperty('--a', `${at.angle}rad`);
      const what = [s.buildings ? `${s.buildings} Gebäude` : '', s.units ? `${s.units} ${s.units === 1 ? 'Einheit' : 'Einheiten'}` : '']
        .filter(Boolean)
        .join(' und ');
      const title = `Angriff: ${what} unter Beschuss – Klick: hinspringen (Leertaste: nächster)`;
      if (arrow.title !== title) arrow.title = title;
      const x = s.x;
      const y = s.y;
      arrow.onclick = () => game.centerOn(x, y);
      arrow.hidden = false;
    }
    for (let i = shown; i < this.arrows.length; i++) this.arrows[i].hidden = true;
  }

  /** Space: the latest fight, then on through the others; false when nothing is under attack. */
  jump(time: number): boolean {
    if (this.hotspots.length === 0) return false;
    this.cycle = time - this.lastJump < CYCLE_WINDOW ? (this.cycle + 1) % this.hotspots.length : 0;
    this.lastJump = time;
    const s = this.hotspots[this.cycle];
    this.game.centerOn(s.x, s.y);
    return true;
  }

  destroy(): void {
    this.el.remove();
  }

  private arrow(i: number): HTMLButtonElement {
    while (this.arrows.length <= i) {
      const b = document.createElement('button');
      b.className = 'alert-arrow';
      b.innerHTML = '<i></i>';
      b.hidden = true;
      this.el.append(b);
      this.arrows.push(b);
    }
    return this.arrows[i];
  }
}
