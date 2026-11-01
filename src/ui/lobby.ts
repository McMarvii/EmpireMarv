import { MAP_TYPE_BY_ID } from '../data/maps';
import { MAX_PLAYERS, parseInvite, type LobbySlot, type MatchOptions } from '../net/protocol';
import { answerInvite, createInvite, dial, listen } from '../net/rtc';
import { GuestSession, HostSession } from '../net/session';
import { openSignal, roomId, type Signal } from '../net/signal';
import type { Transport } from '../net/transport';
import { esc, loadName, loadValues, matchOptions, options, readValues, saveName, saveValues, settingsFields, type MenuValues } from './menu';

export interface LobbyExit {
  /** Back to the main menu. */
  menu(): void;
  /** The match starts: the host and every guest create their game with the session. */
  play(session: HostSession | GuestSession): void;
}

const CLOCK = { now: () => performance.now(), timers: true };

function inviteLink(param: string): string {
  return `${location.origin}${location.pathname}${location.search}#${param}`;
}

function tokenKey(room: string): string {
  return `empiremarv.token.${room}`;
}

function rememberToken(room: string, token: string): void {
  try {
    sessionStorage.setItem(tokenKey(room), token);
  } catch {
    // Without it, a reload cannot rejoin; the match itself is unaffected.
  }
}

function storedToken(room: string): string | undefined {
  try {
    return sessionStorage.getItem(tokenKey(room)) ?? undefined;
  } catch {
    return undefined;
  }
}

async function copy(text: string, btn: HTMLElement): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = 'Kopiert ✓';
  } catch {
    btn.textContent = 'Bitte von Hand kopieren';
  }
  setTimeout(() => (btn.textContent = 'Kopieren'), 2000);
}

function card(root: HTMLElement, html: string): HTMLElement {
  const el = root.querySelector<HTMLElement>('#menu')!;
  el.innerHTML = `<div class="menu-card lobby">${html}</div>`;
  el.hidden = false;
  return el;
}

const KIND_LABEL: Record<string, string> = { open: 'Offen (Mensch)', ai: 'Computer', closed: 'Geschlossen' };

function slotRows(slots: LobbySlot[], editable: boolean, connected: (i: number) => boolean, me = -1): string {
  return slots
    .map((s, i) => {
      const teams = options(
        [1, 2, 3, 4].map((t) => [t, `Team ${t}`] as [number, string]),
        s.team,
      );
      let who: string;
      if (s.kind === 'host' || (s.kind === 'human' && !editable)) {
        who = `<b>${esc(s.name)}</b>${s.kind === 'host' ? ' <span class="dim">Gastgeber</span>' : ''}${i === me ? ' <span class="dim">(du)</span>' : ''}`;
      } else if (s.kind === 'human') {
        who = `<b>${esc(s.name)}</b> ${connected(i) ? '' : '<span class="warn">getrennt</span>'} <button data-kick="${i}" title="Platz wieder freigeben">Entfernen</button>`;
      } else if (editable) {
        who = `<select data-kind="${i}">${options(
          (['open', 'ai', 'closed'] as const).map((k) => [k, KIND_LABEL[k]] as [string, string]),
          s.kind,
        )}</select>`;
      } else {
        who = `<span class="dim">${s.kind === 'ai' ? esc(s.name) + ' (Computer)' : KIND_LABEL[s.kind]}</span>`;
      }
      const team = editable && s.kind !== 'closed' ? `<select data-team="${i}">${teams}</select>` : s.kind === 'closed' ? '' : `Team ${s.team}`;
      return `<div class="slot${s.kind === 'closed' ? ' closed' : ''}"><i style="background:${s.color}"></i><div class="slot-who">${who}</div><div class="slot-team">${team}</div></div>`;
    })
    .join('');
}

function optionsSummary(o: MatchOptions): string {
  const res = { low: 'wenig', standard: 'Standard', high: 'viel' }[o.startResources];
  const ki = { easy: 'leicht', normal: 'mittel', hard: 'schwer' }[o.difficulty];
  const wonder = o.wonderVictory ? ` · Wundersieg ${o.wonderVictory} min` : ' · kein Wundersieg';
  const type = o.mapType === 'random' ? 'Zufallskarte' : (MAP_TYPE_BY_ID.get(o.mapType ?? 'continent')?.name ?? 'Kontinent');
  return `${type} ${o.mapSize}×${o.mapSize} · Epochen ${o.startEpoch + 1}–${o.maxEpoch + 1} · Bevölkerung ${o.popLimit} · Rohstoffe ${res} · KI ${ki}${o.reveal ? ' · aufgedeckt' : ''}${wonder}`;
}

// ------------------------------------------------------------------- host

/** The host's lobby: link, slots, settings, start. */
export function hostLobby(root: HTMLElement, name: string, exit: LobbyExit): void {
  const values: MenuValues = loadValues();
  const session = new HostSession(name, matchOptions(values), CLOCK);
  const room = roomId();
  let signal: Signal | null = null;
  let stopListening: (() => void) | null = null;
  let invite: Awaited<ReturnType<typeof createInvite>> | null = null;
  let left = false;

  const el = card(
    root,
    `<h2>Mehrspieler – Gastgeber</h2>
     <div class="invite">
       <label>Einladungslink<span class="invite-row"><input class="invite-link" readonly value="Verbinde mit dem Vermittlungsserver …"><button data-act="copy" disabled>Kopieren</button></span></label>
       <p class="invite-status dim"></p>
     </div>
     <details class="code-invite">
       <summary>Ohne Vermittlungsserver: Einladung per Code</summary>
       <p class="dim">Für jeden Mitspieler: Code erstellen und schicken, seinen Antwortcode hier einfügen.</p>
       <button data-act="code">Code erstellen</button>
       <div class="code-box" hidden>
         <label>Dein Code<span class="invite-row"><input class="code-out" readonly><button data-act="copycode">Kopieren</button></span></label>
         <label>Antwortcode deines Mitspielers<span class="invite-row"><input class="code-in" spellcheck="false"><button data-act="accept">Verbinden</button></span></label>
       </div>
       <p class="code-status dim"></p>
     </details>
     <h3>Plätze</h3>
     <div class="slots"></div>
     <h3>Einstellungen</h3>
     <form class="settings-grid lobby-settings">${settingsFields(values, false)}</form>
     <p class="lobby-problem warn"></p>
     <div class="dialog-buttons"><button data-act="back">Zurück</button><button data-act="start" class="primary">Spiel starten</button></div>`,
  );
  const q = <T extends HTMLElement>(sel: string) => el.querySelector<T>(sel)!;
  const linkInput = q<HTMLInputElement>('.invite-link');
  const status = q('.invite-status');

  const render = () => {
    q('.slots').innerHTML = slotRows(session.slots, true, (i) => session.connected(i));
    el.querySelectorAll<HTMLSelectElement>('[data-kind]').forEach((s) => {
      s.onchange = () => session.setSlot(Number(s.dataset.kind), { kind: s.value as LobbySlot['kind'] });
    });
    el.querySelectorAll<HTMLSelectElement>('[data-team]').forEach((s) => {
      s.onchange = () => session.setSlot(Number(s.dataset.team), { team: Number(s.value) });
    });
    el.querySelectorAll<HTMLButtonElement>('[data-kick]').forEach((b) => {
      b.onclick = () => session.setSlot(Number(b.dataset.kick), { kind: 'open' });
    });
    const problem = session.problem();
    q('.lobby-problem').textContent = problem ?? '';
    q<HTMLButtonElement>('[data-act="start"]').disabled = problem !== null;
  };
  session.onLobby = render;
  render();

  const form = q<HTMLFormElement>('.lobby-settings');
  form.onchange = () => {
    const v = readValues(form, values);
    saveValues({ ...v, opponents: values.opponents });
    session.setOptions(matchOptions(v));
  };

  const leave = () => {
    left = true;
    stopListening?.();
    signal?.close();
    invite?.cancel();
    session.close();
  };

  openSignal(room).then(
    (s) => {
      if (left) return s.close();
      signal = s;
      stopListening = listen(s, (t: Transport) => session.addPeer(t));
      linkInput.value = inviteLink(`join=${room}`);
      q<HTMLButtonElement>('[data-act="copy"]').disabled = false;
      status.textContent = 'Bereit. Schicke den Link an deine Mitspieler – wer ihn öffnet, landet auf einem offenen Platz.';
    },
    (err: Error) => {
      linkInput.value = '–';
      status.innerHTML = `<span class="warn">${esc(err.message)}</span> Nutze die Einladung per Code darunter.`;
      q<HTMLDetailsElement>('.code-invite').open = true;
    },
  );

  const codeStatus = q('.code-status');
  const actions: Record<string, () => void> = {
    copy: () => void copy(linkInput.value, q('[data-act="copy"]')),
    code: async () => {
      invite?.cancel();
      codeStatus.textContent = 'Erstelle Code …';
      try {
        invite = await createInvite();
        q<HTMLInputElement>('.code-out').value = inviteLink(`code=${invite.code}`);
        q('.code-box').hidden = false;
        codeStatus.textContent = 'Schicke diesen Link (oder Code). Dein Mitspieler bekommt einen Antwortcode, den du darunter einfügst.';
      } catch (e) {
        codeStatus.textContent = (e as Error).message;
      }
    },
    copycode: () => void copy(q<HTMLInputElement>('.code-out').value, q('[data-act="copycode"]')),
    accept: async () => {
      if (!invite) return;
      codeStatus.textContent = 'Verbinde …';
      try {
        const t = await invite.accept(q<HTMLInputElement>('.code-in').value);
        session.addPeer(t);
        invite = null;
        q('.code-box').hidden = true;
        q<HTMLInputElement>('.code-in').value = '';
        codeStatus.textContent = 'Verbunden. Für einen weiteren Mitspieler einen neuen Code erstellen.';
      } catch (e) {
        codeStatus.textContent = (e as Error).message;
      }
    },
    back: () => {
      leave();
      exit.menu();
    },
    start: () => {
      if (session.problem()) return;
      // The lobby is done: new players cannot join a running match.
      stopListening?.();
      invite?.cancel();
      session.start();
      el.hidden = true;
      exit.play(session);
      // Rejoins still need the signalling server.
      if (signal) stopListening = listen(signal, (t) => session.addPeer(t));
    },
  };
  el.querySelectorAll<HTMLElement>('[data-act]').forEach((b) => (b.onclick = () => actions[b.dataset.act!]?.()));
}

// ------------------------------------------------------------------ guest

/** Joining by link or code: name, connect, then the lobby until the host starts. */
export function joinGame(root: HTMLElement, inviteText: string, exit: LobbyExit): void {
  const invite = parseInvite(inviteText);
  if (!invite) {
    const el = card(root, `<h2>Beitreten</h2><p class="warn">Das ist kein gültiger Einladungslink oder -code.</p><div class="dialog-buttons"><button data-act="back" class="primary">Zurück</button></div>`);
    el.querySelector<HTMLElement>('[data-act="back"]')!.onclick = () => exit.menu();
    return;
  }
  const room = invite.room ?? 'code';
  const token = storedToken(room);
  const el = card(
    root,
    `<h2>Mehrspieler – Beitreten</h2>
     ${token ? '<p class="dim">Du warst schon in diesem Spiel – Beitreten bringt dich auf deinen Platz zurück.</p>' : ''}
     <label class="mp-name">Dein Name<input name="name" maxlength="16" placeholder="Name" value="${esc(loadName())}"></label>
     <div class="code-box" hidden>
       <p>Schicke diesen Antwortcode an den Gastgeber; sobald er ihn eingefügt hat, bist du verbunden.</p>
       <span class="invite-row"><input class="code-out" readonly><button data-act="copycode">Kopieren</button></span>
     </div>
     <p class="join-status dim"></p>
     <div class="dialog-buttons"><button data-act="back">Abbrechen</button><button data-act="join" class="primary">Beitreten</button></div>`,
  );
  const q = <T extends HTMLElement>(sel: string) => el.querySelector<T>(sel)!;
  const status = q('.join-status');
  let cancelled = false;
  let signal: Signal | null = null;
  const nameInput = q<HTMLInputElement>('input[name="name"]');
  nameInput.focus();
  // A handler that returns false swallows the key, so typing would not reach the field.
  nameInput.onkeydown = (ev) => {
    if (ev.key === 'Enter') void connect();
  };

  async function connect(): Promise<void> {
    const name = nameInput.value.trim() || 'Gast';
    saveName(nameInput.value.trim());
    q<HTMLButtonElement>('[data-act="join"]').disabled = true;
    nameInput.disabled = true;
    try {
      let transport: Transport;
      if (invite!.room) {
        status.textContent = 'Verbinde mit dem Vermittlungsserver …';
        signal = await openSignal(roomId());
        status.textContent = 'Verbinde mit dem Gastgeber …';
        transport = await dial(signal, invite!.room);
        signal.close();
      } else {
        status.textContent = 'Erstelle Antwortcode …';
        const answer = await answerInvite(invite!.code!);
        q<HTMLInputElement>('.code-out').value = answer.code;
        q('.code-box').hidden = false;
        status.textContent = 'Warte auf den Gastgeber …';
        transport = await answer.transport;
      }
      if (cancelled) return transport.close();
      guestLobby(root, transport, name, room, exit);
    } catch (e) {
      signal?.close();
      status.innerHTML = `<span class="warn">${esc((e as Error).message)}</span>`;
      q<HTMLButtonElement>('[data-act="join"]').disabled = false;
      nameInput.disabled = false;
    }
  }

  const actions: Record<string, () => void> = {
    join: () => void connect(),
    copycode: () => void copy(q<HTMLInputElement>('.code-out').value, q('[data-act="copycode"]')),
    back: () => {
      cancelled = true;
      signal?.close();
      exit.menu();
    },
  };
  el.querySelectorAll<HTMLElement>('[data-act]').forEach((b) => (b.onclick = () => actions[b.dataset.act!]?.()));
}

function guestLobby(root: HTMLElement, transport: Transport, name: string, room: string, exit: LobbyExit): void {
  const session = new GuestSession(transport, name, storedToken(room), CLOCK);
  const el = card(
    root,
    `<h2>Mehrspieler – Lobby</h2>
     <p class="dim">Verbunden. Der Gastgeber stellt die Partie ein und startet sie.</p>
     <h3>Plätze</h3>
     <div class="slots"><p class="dim">Lade …</p></div>
     <p class="lobby-options dim"></p>
     <div class="dialog-buttons"><button data-act="back">Verlassen</button></div>`,
  );
  const q = <T extends HTMLElement>(sel: string) => el.querySelector<T>(sel)!;
  const fail = (reason: string) => {
    const box = card(root, `<h2>Mehrspieler</h2><p class="warn">${esc(reason)}</p><div class="dialog-buttons"><button data-act="back" class="primary">Hauptmenü</button></div>`);
    box.querySelector<HTMLElement>('[data-act="back"]')!.onclick = () => exit.menu();
  };
  session.onLobby = () => {
    q('.slots').innerHTML = slotRows(session.slots.slice(0, MAX_PLAYERS), false, () => true, session.slot);
    if (session.options) q('.lobby-options').textContent = optionsSummary(session.options);
  };
  session.onStart = () => {
    if (session.token) rememberToken(room, session.token);
    el.hidden = true;
    exit.play(session);
  };
  session.onRefused = (reason) => {
    session.close();
    fail(reason);
  };
  session.onLost = (reason) => fail(reason);
  q<HTMLElement>('[data-act="back"]').onclick = () => {
    session.leave();
    exit.menu();
  };
}
