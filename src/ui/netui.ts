import type { Game } from '../game';
import type { HostSession, NetClient, NetSession } from '../net/session';
import { downloadReplay } from '../replay';

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

const STATE_LABEL = { ok: '', lost: 'getrennt', ai: 'Computer', catching: 'holt auf', left: 'gegangen' } as const;

/**
 * The multiplayer parts of the screen: chat, the banner while the match
 * waits or is paused, the player list with latencies, and what happens
 * when the connection is gone.
 */
export class NetUi implements NetClient {
  private bar: HTMLElement;
  private banner: HTMLElement;
  private chatlog: HTMLElement;
  private form: HTMLFormElement;
  private input: HTMLInputElement;
  private to: HTMLElement;
  private list: HTMLElement;
  private team = false;
  private pausedBy = -1;
  private desyncText = '';
  private ended = false;

  constructor(
    private game: Game,
    private net: NetSession,
  ) {
    const q = <T extends HTMLElement>(id: string) => game.root.querySelector<T>(`#${id}`)!;
    this.bar = q('netbar');
    this.banner = q('net-banner');
    this.chatlog = q('chatlog');
    this.form = q<HTMLFormElement>('chatform');
    this.input = q<HTMLInputElement>('chat-input');
    this.to = q('chat-to');
    this.list = q('net-players');
    this.bar.hidden = false;
    this.chatlog.innerHTML = '';
    this.form.hidden = true;
    this.form.onsubmit = (ev) => {
      ev.preventDefault();
      const text = this.input.value.trim();
      if (text) this.net.chat(text, this.team);
      this.closeChat();
    };
    this.input.onkeydown = (ev) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        this.closeChat();
      } else if (ev.key === 'Tab') {
        ev.preventDefault();
        this.setTeam(!this.team);
      }
    };
    this.to.onclick = () => this.setTeam(!this.team);
    this.status();
  }

  destroy(): void {
    this.bar.hidden = true;
    this.chatlog.innerHTML = '';
    this.list.innerHTML = '';
    this.banner.hidden = true;
  }

  private name(player: number): string {
    return this.game.world.players[player]?.name ?? '?';
  }

  private color(player: number): string {
    return this.game.world.players[player]?.color ?? '#fff';
  }

  // --------------------------------------------------------------- chat

  /** Enter: to everyone; Shift+Enter: to the own team. Tab switches while typing. */
  openChat(team: boolean): void {
    this.setTeam(team);
    this.form.hidden = false;
    this.input.value = '';
    this.input.focus();
  }

  private setTeam(team: boolean): void {
    this.team = team;
    this.to.textContent = team ? 'An Team:' : 'An alle:';
    this.to.classList.toggle('team', team);
  }

  private closeChat(): void {
    this.form.hidden = true;
    this.input.blur();
  }

  get chatOpen(): boolean {
    return !this.form.hidden;
  }

  chat(from: number, text: string, team: boolean): void {
    const line = document.createElement('div');
    line.className = 'chat-line';
    line.innerHTML = `<b style="color:${this.color(from)}">${esc(this.name(from))}${team ? ' <span class="dim">(Team)</span>' : ''}:</b> ${esc(text)}`;
    this.chatlog.append(line);
    while (this.chatlog.children.length > 8) this.chatlog.firstElementChild!.remove();
    setTimeout(() => line.classList.add('fade'), 15_000);
    setTimeout(() => line.remove(), 16_000);
    this.game.recorder?.chat(this.game.world.tick, from, text);
    if (from !== this.game.me) this.game.audio.ui('click', 0);
  }

  mark(from: number, x: number, y: number): void {
    this.game.addMark(x, y, this.color(from));
    this.game.audio.ui('alarm', 0);
    if (from !== this.game.me) this.game.hud.message('info', `${this.name(from)} markiert eine Stelle.`, () => this.game.centerOn(x, y));
  }

  // ------------------------------------------------------------ state

  setPaused(paused: boolean, by: number): void {
    this.pausedBy = paused ? by : -1;
    this.game.setPaused(paused);
    this.renderBanner();
  }

  setSpeed(speed: number): void {
    this.game.setSpeed(speed);
    this.game.hud.message('info', `Spielgeschwindigkeit: ${speed}×`);
  }

  status(): void {
    const rows = this.game.world.players
      .map((p, i) => {
        const peer = this.net.players.find((s) => s.player === i);
        const self = i === this.net.me;
        let info = '';
        if (peer) info = peer.state === 'ok' ? `${peer.rtt} ms` : STATE_LABEL[peer.state];
        else if (p.isAI) info = 'KI';
        else if (this.net.kind === 'guest' && i === 0) info = 'Gastgeber';
        return `<div class="np-row${self ? ' self' : ''}"><i style="background:${p.color}"></i><span>${esc(p.name)}</span><span class="dim">T${p.team}</span><span class="np-info">${self ? 'du' : info}</span></div>`;
      })
      .join('');
    if (this.list.innerHTML !== rows) this.list.innerHTML = rows;
    this.renderBanner();
  }

  private renderBanner(): void {
    const parts: string[] = [];
    if (this.desyncText) parts.push(`<span class="warn">${this.desyncText}</span>`);
    if (this.net.waiting) parts.push(esc(this.net.waiting));
    else if (this.pausedBy >= 0) parts.push(`Pausiert von ${esc(this.name(this.pausedBy))} – P setzt fort.`);
    let html = parts.join('<br>');
    if (this.net.kind === 'host' && this.net.waiting && /Verbindung zu/.test(this.net.waiting)) {
      html += ` <button data-act="handover">Nicht warten – Computer übernimmt</button>`;
    }
    this.banner.hidden = !html;
    if (this.banner.innerHTML !== html) {
      this.banner.innerHTML = html;
      const btn = this.banner.querySelector<HTMLButtonElement>('[data-act="handover"]');
      if (btn) btn.onclick = () => this.handOverLost();
    }
  }

  private handOverLost(): void {
    const lost = this.net.players.find((p) => p.state === 'lost');
    if (lost && this.net.kind === 'host') (this.net as HostSession).handOver(lost.player);
  }

  desync(tick: number, player: number): void {
    const min = Math.floor(tick / 20 / 60);
    const sec = Math.floor(tick / 20) % 60;
    this.desyncText = `Spielstand von ${esc(this.name(player))} weicht ab (${min}:${String(sec).padStart(2, '0')}). Die Partie läuft nicht mehr synchron – bitte neu starten.`;
    this.renderBanner();
  }

  lost(reason: string): void {
    if (this.ended) return;
    this.ended = true;
    this.game.setPaused(true);
    this.game.hud.showNetLost(reason, () => {
      if (this.game.recorder) downloadReplay(this.game.recorder.replay);
    });
  }
}
