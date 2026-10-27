import type { Game } from '../game';
import { TICK_RATE } from '../sim/world';

function fmt(ticks: number): string {
  const s = Math.floor(ticks / TICK_RATE);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** Replay controls: play/pause, speed, jumping, whose view and the fog. */
export class ReplayBar {
  private el: HTMLElement;
  private seek: HTMLInputElement;
  private dragging = false;
  private sig = '';

  constructor(private game: Game) {
    this.el = game.root.querySelector<HTMLElement>('#replaybar')!;
    const r = game.replay!.replay;
    const options = game.world.players.map((p, i) => `<option value="${i}"${i === game.me ? ' selected' : ''}>Sicht: ${esc(p.name)}</option>`).join('');
    this.el.innerHTML = `
      <span class="rb-title">Wiedergabe</span>
      <button data-rb="restart" title="Von vorn">⏮</button>
      <button data-rb="back" title="30 s zurück">−30 s</button>
      <button data-rb="play" class="rb-play" title="Pause / weiter (P)">❚❚</button>
      <button data-rb="fwd" title="30 s vor">+30 s</button>
      <span class="rb-speed-group"><button data-rb="slower" title="Langsamer (−)">−</button><span class="rb-speed"></span><button data-rb="faster" title="Schneller (+)">+</button></span>
      <input class="rb-seek" type="range" min="0" max="${r.ticks}" step="${TICK_RATE}" value="0" aria-label="Zeitpunkt">
      <span class="rb-time"></span>
      <select class="rb-view" aria-label="Sicht">${options}</select>
      <label class="rb-fog"><input type="checkbox"${game.view.revealAll ? ' checked' : ''}> Alles zeigen</label>
      <span class="rb-warn" hidden></span>
      <button data-rb="quit">Beenden</button>`;
    this.el.hidden = false;
    this.seek = this.el.querySelector<HTMLInputElement>('.rb-seek')!;
    this.seek.oninput = () => {
      this.dragging = true;
      this.el.querySelector('.rb-time')!.textContent = `${fmt(Number(this.seek.value))} / ${fmt(r.ticks)}`;
    };
    this.seek.onchange = () => {
      this.dragging = false;
      this.seek.blur();
      game.seek(Number(this.seek.value));
    };
    const view = this.el.querySelector<HTMLSelectElement>('.rb-view')!;
    view.onchange = () => {
      game.setPerspective(Number(view.value));
      view.blur();
    };
    const fog = this.el.querySelector<HTMLInputElement>('.rb-fog input')!;
    fog.onchange = () => {
      game.setPerspective(game.me, fog.checked);
      fog.blur();
    };
    const actions: Record<string, () => void> = {
      restart: () => game.seek(0),
      back: () => game.seek(game.world.tick - 30 * TICK_RATE),
      fwd: () => game.seek(game.world.tick + 30 * TICK_RATE),
      play: () => {
        // At the end, play starts over.
        if (game.world.tick >= r.ticks || game.world.over) game.seek(0);
        else game.togglePause();
      },
      slower: () => game.changeSpeed(-1),
      faster: () => game.changeSpeed(1),
      quit: () => game.exitToMenu(),
    };
    this.el.querySelectorAll<HTMLButtonElement>('[data-rb]').forEach((btn) => {
      btn.onclick = () => {
        actions[btn.dataset.rb!]();
        btn.blur();
      };
    });
  }

  update(): void {
    const { game } = this;
    const r = game.replay!;
    const tick = game.catchUpTo ?? game.world.tick;
    if (!this.dragging) this.seek.value = String(tick);
    const ended = game.world.tick >= r.replay.ticks || game.world.over;
    const warn = r.diverged !== null ? `Läuft anders als aufgezeichnet ab ${fmt(r.diverged)} (Version ${esc(r.replay.game)})` : '';
    const sig = `${tick}|${game.paused}|${game.speed}|${ended}|${warn}|${game.catchUpTo}`;
    if (sig === this.sig) return;
    this.sig = sig;
    if (!this.dragging) {
      const ff = game.catchUpTo !== null ? ' · spult …' : '';
      this.el.querySelector('.rb-time')!.textContent = `${fmt(tick)} / ${fmt(r.replay.ticks)}${ff}`;
    }
    this.el.querySelector('.rb-play')!.textContent = ended ? '↻' : game.paused ? '▶' : '❚❚';
    this.el.querySelector('.rb-speed')!.textContent = `${game.speed}×`;
    const w = this.el.querySelector<HTMLElement>('.rb-warn')!;
    w.hidden = !warn;
    w.textContent = warn;
  }

  destroy(): void {
    this.el.hidden = true;
    this.el.innerHTML = '';
  }
}
