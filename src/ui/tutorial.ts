import type { Game } from '../game';
import { TILE_W } from '../render/camera';
import { firstOpenStep, TUTORIAL_DONE_KEY, TUTORIAL_STEPS, type TutorialView } from '../tutorial';

/** How often the steps are checked, in seconds. */
const CHECK_EVERY = 0.15;
/** A step's spot on the map is pointed out again this often. */
const MARK_EVERY = 5;

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** Whether the tutorial was finished once (for the menu). */
export function tutorialDone(): boolean {
  try {
    return localStorage.getItem(TUTORIAL_DONE_KEY) === 'done';
  } catch {
    return false;
  }
}

/**
 * The tutorial's panel in the corner: the current step with its task,
 * the progress, and buttons to skip a step or leave. It never blocks the
 * map – the player plays the real game while it watches.
 */
export class TutorialPanel {
  private el: HTMLElement;
  /** -1: the welcome card; TUTORIAL_STEPS.length: done. */
  private index = -1;
  private time = 0;
  private nextCheck = 0;
  private nextMark = 0;
  private camStart: { x: number; y: number; zoom: number };
  private text = '';

  constructor(private game: Game) {
    this.el = document.createElement('div');
    this.el.id = 'tutorial';
    game.root.querySelector('#hud')!.appendChild(this.el);
    const c = game.camera;
    this.camStart = { x: c.x, y: c.y, zoom: c.zoom };
    this.render();
  }

  destroy(): void {
    this.el.remove();
    this.game.hud.hintKey = null;
  }

  private view(): TutorialView {
    const { game } = this;
    const c = game.camera;
    // Camera x/y are iso pixels: half a tile wide per tile step.
    const moved = Math.hypot(c.x - this.camStart.x, (c.y - this.camStart.y) * 2) / (TILE_W / 2);
    const zoomed = Math.abs(c.zoom - this.camStart.zoom) > 0.12 ? 3 : 0;
    return { world: game.world, me: game.me, selection: [...game.selection], cameraMoved: Math.max(moved, zoomed), groups: game.groups };
  }

  update(dt: number): void {
    this.time += dt;
    if (this.time < this.nextCheck || this.index < 0) return;
    this.nextCheck = this.time + CHECK_EVERY;
    const { world } = this.game;
    if (this.index >= TUTORIAL_STEPS.length) return;
    const v = this.view();
    const next = firstOpenStep(v, this.index);
    if (next !== this.index) {
      this.index = next;
      this.nextMark = 0;
      this.game.audio.ui('step', 0);
      if (this.index >= TUTORIAL_STEPS.length || (world.over && world.winnerTeam === world.players[this.game.me].team)) return this.finish();
    }
    const step = TUTORIAL_STEPS[this.index];
    this.game.hud.hintKey = step.key ?? null;
    if (step.mark && this.time >= this.nextMark) {
      this.nextMark = this.time + MARK_EVERY;
      const p = step.mark(v);
      if (p) this.game.addMark(p.x, p.y, '#ffd25a');
    }
    // Some texts count along (fighters ready, what the advance still needs).
    const text = typeof step.text === 'function' ? step.text(v) : step.text;
    if (text !== this.text) this.render();
  }

  private finish(): void {
    this.index = TUTORIAL_STEPS.length;
    this.game.hud.hintKey = null;
    try {
      localStorage.setItem(TUTORIAL_DONE_KEY, 'done');
    } catch {
      // Only the menu's tick depends on it.
    }
    this.render();
  }

  private render(): void {
    const total = TUTORIAL_STEPS.length;
    let body: string;
    if (this.index < 0) {
      body = `<h3>Willkommen bei EmpireMarv</h3>
        <p>In dieser Übungspartie lernst du in ${total} Schritten das Wichtigste: Rohstoffe sammeln, bauen, forschen, in die nächste Epoche aufsteigen und ein erstes Gefecht. Niemand greift dich an – nimm dir Zeit.</p>
        <p class="dim">Die Aufgabe steht immer hier oben rechts. Was du schon kannst, hakt das Tutorial von selbst ab.</p>
        <div class="tut-buttons"><button class="primary" data-act="go">Los geht's</button><button data-act="quit">Beenden</button></div>`;
    } else if (this.index >= total) {
      body = `<h3>Geschafft!</h3>
        <p>Das Räuberlager ist zerstört. Jetzt kennst du die Grundlagen – im Einzelspieler warten Computergegner, 18 Epochen, Wunder, See- und Luftkrieg.</p>
        <p class="dim">F1 zeigt jederzeit alle Tasten.</p>
        <div class="tut-buttons"><button class="primary" data-act="quit">Zum Hauptmenü</button></div>`;
    } else {
      const step = TUTORIAL_STEPS[this.index];
      this.text = typeof step.text === 'function' ? step.text(this.view()) : step.text;
      const dots = TUTORIAL_STEPS.map((_, i) => `<i class="${i < this.index ? 'done' : i === this.index ? 'now' : ''}"></i>`).join('');
      body = `<div class="tut-progress"><span>Schritt ${this.index + 1} / ${total}</span><span class="tut-dots">${dots}</span></div>
        <h3>${esc(step.title)}</h3>
        <p>${esc(this.text)}${step.key ? ` <kbd>${step.key}</kbd>` : ''}</p>
        <div class="tut-buttons"><button data-act="skip">Überspringen</button><button data-act="quit">Tutorial beenden</button></div>`;
    }
    this.el.innerHTML = body;
    this.el.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((b) => {
      b.onclick = () => {
        switch (b.dataset.act) {
          case 'go': {
            // Moving the camera counts from here (the game centred it on the town meanwhile).
            const c = this.game.camera;
            this.camStart = { x: c.x, y: c.y, zoom: c.zoom };
            this.index = firstOpenStep(this.view(), 0);
            this.nextCheck = 0;
            this.render();
            break;
          }
          case 'skip':
            this.index++;
            this.nextMark = 0;
            if (this.index >= total) this.finish();
            else this.render();
            break;
          case 'quit':
            this.game.exitToMenu();
            break;
        }
      };
    });
  }
}
