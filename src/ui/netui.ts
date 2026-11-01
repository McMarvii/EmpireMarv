import type { Game } from '../game';
import { createInvite } from '../net/rtc';
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
  /** The host's panel to bring back a player who dropped out (link or a fresh code). */
  private invitePanel: HTMLElement | null = null;
  private invite: Awaited<ReturnType<typeof createInvite>> | null = null;
  private bannerText: HTMLElement | null = null;
  private bannerButtons: HTMLElement | null = null;

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
    this.list.onclick = (ev) => {
      if ((ev.target as HTMLElement).closest('[data-act="rejoin"]')) this.openInvite();
    };
    this.status();
  }

  destroy(): void {
    this.closeInvite();
    this.bar.hidden = true;
    this.chatlog.innerHTML = '';
    this.list.innerHTML = '';
    this.list.onclick = null;
    this.list.classList.remove('with-rejoin');
    this.banner.innerHTML = '';
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
    // The button sits in the list and is only rebuilt when the list changes, so clicks reach it.
    const away = this.someoneAway();
    const html = rows + (away ? '<button class="np-rejoin" data-act="rejoin" title="Einen Mitspieler, der die Verbindung verloren hat, wieder ins Spiel holen (Link oder Code)">Zurückholen …</button>' : '');
    if (this.list.innerHTML !== html) this.list.innerHTML = html;
    this.list.classList.toggle('with-rejoin', away);
    this.renderBanner();
  }

  // ------------------------------------------------------------ rejoin (host)

  /** Somebody of this match is not connected: the host can bring them back. */
  private someoneAway(): boolean {
    return this.net.kind === 'host' && this.net.players.some((p) => p.state === 'lost' || p.state === 'ai' || p.state === 'left');
  }

  openInvite(): void {
    if (this.net.kind !== 'host' || this.invitePanel) return;
    const host = this.net as HostSession;
    const panel = document.createElement('div');
    panel.id = 'net-invite';
    const link = host.rejoinLink;
    panel.innerHTML = `<h3>Mitspieler zurückholen</h3>
      <p class="dim">Wer die Verbindung verloren hat, kommt auf seinen alten Platz – mit demselben Namen wie vorher.</p>
      ${
        link
          ? `<label>Einladungslink<span class="invite-row"><input class="ni-link" readonly value="${esc(link)}"><button data-act="copylink">Kopieren</button></span></label>`
          : '<p class="warn">Kein Link: Das Spiel lief ohne Vermittlungsserver, oder er ist gerade nicht erreichbar. Nimm einen Code.</p>'
      }
      <p class="dim">Ohne Vermittlungsserver (oder wenn der Link nicht klappt): Code erstellen und schicken, den Antwortcode hier einfügen. Jeder Code verbindet nur einmal.</p>
      <button data-act="mkcode">Code erstellen</button>
      <div class="code-box" hidden>
        <label>Dein Code<span class="invite-row"><input class="code-out" readonly><button data-act="copycode">Kopieren</button></span></label>
        <label>Antwortcode deines Mitspielers<span class="invite-row"><input class="code-in" spellcheck="false"><button data-act="accept">Verbinden</button></span></label>
      </div>
      <p class="code-status dim"></p>
      <div class="dialog-buttons"><button data-act="close">Schließen</button></div>`;
    this.bar.append(panel);
    this.invitePanel = panel;
    const q = <T extends HTMLElement>(sel: string) => panel.querySelector<T>(sel)!;
    const status = q('.code-status');
    const copy = async (input: string, btn: string) => {
      const b = q<HTMLButtonElement>(btn);
      try {
        await navigator.clipboard.writeText(q<HTMLInputElement>(input).value);
        b.textContent = 'Kopiert ✓';
      } catch {
        q<HTMLInputElement>(input).select();
        b.textContent = 'Markiert – Strg+C';
      }
      setTimeout(() => (b.textContent = 'Kopieren'), 2000);
    };
    const actions: Record<string, () => void> = {
      copylink: () => void copy('.ni-link', '[data-act="copylink"]'),
      copycode: () => void copy('.code-out', '[data-act="copycode"]'),
      mkcode: async () => {
        this.invite?.cancel();
        status.textContent = 'Erstelle Code …';
        try {
          const invite = await createInvite();
          if (this.invitePanel !== panel) return invite.cancel();
          this.invite = invite;
          q<HTMLInputElement>('.code-out').value = `${location.origin}${location.pathname}${location.search}#code=${invite.code}`;
          q('.code-box').hidden = false;
          status.textContent = 'Schicke diesen Link (oder Code). Dein Mitspieler bekommt einen Antwortcode, den du darunter einfügst.';
        } catch (e) {
          status.textContent = (e as Error).message;
        }
      },
      accept: async () => {
        const invite = this.invite;
        if (!invite) return;
        status.textContent = 'Verbinde …';
        try {
          const t = await invite.accept(q<HTMLInputElement>('.code-in').value);
          this.invite = null;
          host.addPeer(t);
          status.textContent = 'Verbunden – er steigt gleich wieder ein.';
          setTimeout(() => this.invitePanel === panel && this.closeInvite(), 1500);
        } catch (e) {
          status.innerHTML = `<span class="warn">${esc((e as Error).message)}</span>`;
        }
      },
      close: () => this.closeInvite(),
    };
    panel.querySelectorAll<HTMLElement>('[data-act]').forEach((b) => (b.onclick = () => actions[b.dataset.act!]?.()));
  }

  private closeInvite(): void {
    this.invite?.cancel();
    this.invite = null;
    this.invitePanel?.remove();
    this.invitePanel = null;
  }

  private renderBanner(): void {
    const parts: string[] = [];
    if (this.desyncText) parts.push(`<span class="warn">${this.desyncText}</span>`);
    if (this.net.waiting) parts.push(esc(this.net.waiting));
    else if (this.pausedBy >= 0) parts.push(`Pausiert von ${esc(this.name(this.pausedBy))} – P setzt fort.`);
    const html = parts.join('<br>');
    // The text counts down every second; the buttons stay the same elements, so no click gets lost.
    if (!this.bannerText) {
      this.banner.innerHTML = `<span class="nb-text"></span><span class="nb-buttons" hidden><button data-act="invite">Zurückholen …</button><button data-act="handover">Nicht warten – Computer übernimmt</button></span>`;
      this.bannerText = this.banner.querySelector<HTMLElement>('.nb-text')!;
      this.bannerButtons = this.banner.querySelector<HTMLElement>('.nb-buttons')!;
      this.banner.querySelector<HTMLButtonElement>('[data-act="handover"]')!.onclick = () => this.handOverLost();
      this.banner.querySelector<HTMLButtonElement>('[data-act="invite"]')!.onclick = () => this.openInvite();
    }
    if (this.bannerText.innerHTML !== html) this.bannerText.innerHTML = html;
    this.bannerButtons!.hidden = !(this.net.kind === 'host' && this.net.waiting && /Verbindung zu/.test(this.net.waiting));
    this.banner.hidden = !html;
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

  lost(reason: string, final = false): void {
    if (this.ended) return;
    this.ended = true;
    this.game.setPaused(true);
    const rejoin = !final && this.game.options.rejoin ? () => this.game.rejoin() : undefined;
    this.game.hud.showNetLost(
      reason,
      () => {
        if (this.game.recorder) downloadReplay(this.game.recorder.replay);
      },
      rejoin,
    );
  }

  /** The connection is gone for good (the match cannot go on in this tab). */
  get isLost(): boolean {
    return this.ended;
  }
}
