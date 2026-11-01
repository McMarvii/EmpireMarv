import type { Session } from '../session';
import type { Command, GameSettings, World } from '../sim/world';
import { GAME_VERSION } from '../version';
import {
  ACK_EVERY,
  delayFor,
  GRACE_MS,
  GUEST_COMMANDS,
  HASH_EVERY,
  lobbyProblem,
  matchSettings,
  MAX_CHAT,
  MAX_LAG,
  MAX_PLAYERS,
  MIN_DELAY,
  PLAYER_COLORS,
  type GuestMessage,
  type HostMessage,
  type LobbySlot,
  type MatchOptions,
  type PeerStatus,
} from './protocol';
import type { Transport } from './transport';

/** What a running match hears from the session. The game implements it. */
export interface NetClient {
  setPaused(paused: boolean, by: number): void;
  setSpeed(speed: number): void;
  chat(from: number, text: string, team: boolean): void;
  mark(from: number, x: number, y: number): void;
  /** Players or the waiting state changed. */
  status(): void;
  desync(tick: number, player: number): void;
  /** The match cannot go on here (connection lost); `final`: the match itself is over (the host left). */
  lost(reason: string, final?: boolean): void;
}

export interface SessionClock {
  now(): number;
  /** Runs `update` regularly (the browser); tests call `update` themselves. */
  timers: boolean;
}

const NONE: Command[] = [];
/** A peer that has not been heard from this long counts as gone (ms). */
const SILENCE_MS = 8000;
const STATUS_MS = 1000;

export function randomToken(): string {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => (b % 36).toString(36)).join('');
}

export function cleanName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, 16) || 'Spieler';
}

/** Shared by host and guest: the parts of a lockstep peer the game talks to. */
export abstract class NetSession implements Session {
  abstract readonly kind: 'host' | 'guest';
  /** Player index of the local player once the match runs. */
  me = -1;
  delay = MIN_DELAY;
  speed = 1;
  paused = false;
  players: PeerStatus[] = [];
  /** Why the match is waiting, shown to everyone; null while it runs. */
  waiting: string | null = null;
  protected client: NetClient | null = null;
  private timer = 0;
  /** Closing or reloading the tab hangs up at once, so the others need not wait for a timeout. */
  private onHide = () => this.hangUp();

  constructor(protected clock: SessionClock) {
    if (!clock.timers) return;
    this.timer = window.setInterval(() => this.update(), 250);
    window.addEventListener('pagehide', this.onHide);
  }

  attach(client: NetClient): void {
    this.client = client;
  }

  abstract submit(cmd: Command): void;
  abstract commandsAt(tick: number): Command[] | null;
  abstract stepped(world: World): void;
  abstract requestPause(paused: boolean): void;
  abstract setSpeed(speed: number): void;
  abstract chat(text: string, team: boolean): void;
  abstract mark(x: number, y: number): void;
  /** Leaving on purpose: the others continue without waiting. */
  abstract leave(): void;
  abstract update(): void;
  protected abstract hangUp(): void;

  abstract behind(tick: number): number;

  /** Runs once when the session closes (the lobby hangs up the signalling server). */
  onClose: (() => void) | null = null;

  close(): void {
    clearInterval(this.timer);
    if (this.clock.timers) window.removeEventListener('pagehide', this.onHide);
    const done = this.onClose;
    this.onClose = null;
    done?.();
  }
}

// ------------------------------------------------------------------- host

interface Peer {
  transport: Transport | null;
  name: string;
  token: string;
  /** Lobby slot. */
  slot: number;
  /** Player index in the match, -1 in the lobby. */
  player: number;
  state: PeerStatus['state'];
  /** Last tick the peer reported as done. */
  ack: number;
  rtt: number;
  lastSeen: number;
  droppedAt: number;
  /** Rejoin: the frame the peer has to reach before the match goes on. */
  catchUpTo: number;
  /** The computer plays for this peer's empire. */
  ai: boolean;
  desynced: boolean;
}

/**
 * The host: owns the lobby, puts every command into a frame for a tick a
 * few ticks ahead and sends the frames to all guests. It is a player like
 * the others, its own commands take the same detour.
 */
export class HostSession extends NetSession {
  readonly kind = 'host';
  slots: LobbySlot[];
  options: MatchOptions;
  inGame = false;
  settings: GameSettings | null = null;
  /** Lobby changed (someone joined, left, renamed). */
  onLobby: (() => void) | null = null;
  /** The invitation link while the signalling server is reachable: players who dropped out come back with it. */
  rejoinLink: string | null = null;
  private peers: Peer[] = [];
  private pending: Command[] = [];
  private frames = new Map<number, Command[]>();
  /** Every frame with commands, for players who rejoin. */
  private log: Array<[number, Command[]]> = [];
  private nextFrame = 0;
  private hashes = new Map<number, number>();
  private lastStatus = -Infinity;
  private lastRttPing = -Infinity;
  private tick = 0;
  private hostName: string;

  constructor(name: string, options: MatchOptions, clock: SessionClock) {
    super(clock);
    this.hostName = cleanName(name);
    this.options = options;
    this.slots = [
      { kind: 'host', name: this.hostName, team: 1, color: PLAYER_COLORS[0] },
      { kind: 'open', name: '', team: 2, color: PLAYER_COLORS[1] },
      { kind: 'closed', name: '', team: 3, color: PLAYER_COLORS[2] },
      { kind: 'closed', name: '', team: 4, color: PLAYER_COLORS[3] },
    ].slice(0, MAX_PLAYERS) as LobbySlot[];
  }

  // ------------------------------------------------------------ lobby

  /** A new connection; it introduces itself with a hello. */
  addPeer(transport: Transport): void {
    const peer: Peer = {
      transport,
      name: 'Spieler',
      token: '',
      slot: -1,
      player: -1,
      state: 'ok',
      ack: -1,
      rtt: 0,
      lastSeen: this.clock.now(),
      droppedAt: 0,
      catchUpTo: -1,
      ai: false,
      desynced: false,
    };
    transport.onmessage = (msg) => this.receive(peer, msg as GuestMessage);
    transport.onclose = () => this.dropped(peer);
  }

  setSlot(i: number, patch: Partial<LobbySlot>): void {
    const slot = this.slots[i];
    if (!slot || this.inGame || (slot.kind === 'host' && patch.kind)) return;
    if (patch.kind && slot.kind === 'human') {
      // Turning an occupied slot into something else sends its player away.
      const peer = this.peers.find((p) => p.slot === i);
      if (peer) {
        this.send(peer, { t: 'refuse', reason: 'Der Gastgeber hat deinen Platz anders vergeben.' });
        peer.transport?.close();
        this.peers = this.peers.filter((p) => p !== peer);
      }
    }
    Object.assign(slot, patch);
    if (slot.kind === 'ai' && !slot.name) slot.name = `KI ${i + 1}`;
    if (slot.kind === 'open' || slot.kind === 'closed') slot.name = '';
    this.lobbyChanged();
  }

  setOptions(options: MatchOptions): void {
    this.options = options;
    this.lobbyChanged();
  }

  problem(): string | null {
    return lobbyProblem(this.slots);
  }

  /** Starts the match for everybody; returns the settings the host's game uses. */
  start(): GameSettings {
    const { settings, playerOf } = matchSettings(this.slots, this.options);
    this.settings = settings;
    this.inGame = true;
    this.me = playerOf[0];
    for (const p of this.peers) {
      p.player = playerOf[p.slot];
      p.ack = -1;
      p.lastSeen = this.clock.now();
    }
    this.peers = this.peers.filter((p) => p.player >= 0);
    for (const p of this.peers) this.sendStart(p, false);
    this.refreshStatus(true);
    return settings;
  }

  private lobbyChanged(): void {
    for (const p of this.peers) this.send(p, { t: 'lobby', slots: this.slots, options: this.options });
    this.onLobby?.();
  }

  private sendStart(p: Peer, rejoin: boolean): void {
    this.send(p, {
      t: 'start',
      settings: this.settings!,
      me: p.player,
      delay: this.delay,
      speed: this.speed,
      paused: this.paused,
      log: rejoin ? this.log : [],
      upTo: rejoin ? this.nextFrame - 1 : -1,
    });
  }

  // ------------------------------------------------------------ messages

  private send(p: Peer, msg: HostMessage): void {
    p.transport?.send(msg);
  }

  private broadcast(msg: HostMessage, to: (p: Peer) => boolean = () => true): void {
    for (const p of this.peers) if (p.transport && to(p)) this.send(p, msg);
  }

  private receive(peer: Peer, msg: GuestMessage): void {
    if (!msg || typeof msg !== 'object') return;
    peer.lastSeen = this.clock.now();
    if (msg.t === 'hello') {
      if (peer.slot < 0) this.hello(peer, msg.name, msg.token, msg.v);
      return;
    }
    if (peer.slot < 0) return;
    switch (msg.t) {
      case 'name':
        if (this.inGame) return;
        peer.name = cleanName(msg.name);
        this.slots[peer.slot].name = peer.name;
        this.lobbyChanged();
        return;
      case 'cmd':
        // The host decides who sent it: a guest can only command its own empire.
        if (!this.inGame || peer.state !== 'ok' || !msg.c || !GUEST_COMMANDS.has(msg.c.type)) return;
        this.pending.push({ ...msg.c, player: peer.player });
        return;
      case 'ack':
        if (typeof msg.n !== 'number' || msg.n < peer.ack) return;
        peer.ack = msg.n;
        if (msg.h !== undefined && this.hashes.has(msg.n) && this.hashes.get(msg.n) !== msg.h && !peer.desynced) {
          peer.desynced = true;
          this.broadcast({ t: 'desync', tick: msg.n, player: peer.player });
          this.client?.desync(msg.n, peer.player);
        }
        // Progress comes in steps of ACK_EVERY, the log may end in between.
        if (peer.state === 'catching' && peer.ack + ACK_EVERY > peer.catchUpTo) {
          peer.state = 'ok';
          this.refreshStatus(true);
        }
        return;
      case 'pause':
        if (this.inGame) this.applyPause(Boolean(msg.paused), peer.player);
        return;
      case 'chat':
        if (this.inGame) this.relayChat(peer.player, String(msg.text ?? ''), Boolean(msg.team));
        return;
      case 'mark':
        if (this.inGame) this.relayMark(peer.player, Number(msg.x), Number(msg.y));
        return;
      case 'rtt':
        peer.rtt = peer.rtt ? peer.rtt * 0.7 + (this.clock.now() - msg.at) * 0.3 : this.clock.now() - msg.at;
        return;
      case 'leave':
        peer.state = 'left';
        peer.transport?.close();
        return;
    }
  }

  private hello(peer: Peer, name: string, token?: string, version?: string): void {
    if (version !== GAME_VERSION) {
      // Another version computes differently: the match would split apart at once.
      const reason = `Andere Spielversion: Gastgeber ${GAME_VERSION}, du ${version ?? 'eine ältere'}. Lade die Seite neu (Strg+F5) und tritt dann erneut bei.`;
      peer.transport?.send({ t: 'refuse', reason } satisfies HostMessage);
      peer.transport?.close();
      return;
    }
    if (this.inGame) {
      // Only a player of this match may come back, into their old seat: by the token from the
      // first join, or (a new tab, another browser) by the same name on a seat nobody holds.
      const away = (p: Peer) => p.state !== 'ok' && p.state !== 'catching';
      const old = this.peers.find((p) => p.token && p.token === token && away(p)) ?? this.peers.find((p) => p.name === cleanName(name) && away(p));
      if (!old) {
        peer.transport?.send({ t: 'refuse', reason: 'Das Spiel läuft bereits.' } satisfies HostMessage);
        peer.transport?.close();
        return;
      }
      old.transport = peer.transport;
      peer.transport!.onmessage = (msg) => this.receive(old, msg as GuestMessage);
      peer.transport!.onclose = () => this.dropped(old);
      old.lastSeen = this.clock.now();
      old.ack = -1;
      old.catchUpTo = this.nextFrame - 1;
      if (old.ai) this.pending.push({ type: 'control', player: old.player, ai: false });
      old.ai = false;
      old.state = 'catching';
      old.desynced = false;
      this.send(old, { t: 'welcome', slot: old.slot, token: old.token, v: GAME_VERSION });
      this.sendStart(old, true);
      this.refreshStatus(true);
      return;
    }
    const slot = this.slots.findIndex((s) => s.kind === 'open');
    if (slot < 0) {
      peer.transport?.send({ t: 'refuse', reason: 'Alle Plätze sind belegt.' } satisfies HostMessage);
      peer.transport?.close();
      return;
    }
    peer.name = cleanName(name);
    peer.slot = slot;
    peer.token = randomToken();
    this.peers.push(peer);
    Object.assign(this.slots[slot], { kind: 'human', name: peer.name });
    this.send(peer, { t: 'welcome', slot, token: peer.token, v: GAME_VERSION });
    this.lobbyChanged();
  }

  private dropped(peer: Peer): void {
    peer.transport = null;
    if (!this.inGame) {
      if (!this.peers.includes(peer)) return;
      this.peers = this.peers.filter((p) => p !== peer);
      if (peer.slot >= 0 && this.slots[peer.slot].kind === 'human') Object.assign(this.slots[peer.slot], { kind: 'open', name: '' });
      this.lobbyChanged();
      return;
    }
    if (peer.state === 'left') {
      // Gone on purpose: the computer takes over right away.
      this.handOver(peer);
    } else if (peer.state === 'ok' || peer.state === 'catching') {
      peer.state = 'lost';
      peer.droppedAt = this.clock.now();
    }
    this.refreshStatus(true);
  }

  /** The computer plays on for a player who is gone (also: the host's "don't wait" button). */
  handOver(peer: Peer | number): void {
    const p = typeof peer === 'number' ? this.peers.find((x) => x.player === peer) : peer;
    if (!p || p.ai) return;
    p.ai = true;
    if (p.state !== 'left') p.state = 'ai';
    this.pending.push({ type: 'control', player: p.player, ai: true });
    this.refreshStatus(true);
  }

  // ------------------------------------------------------------ lockstep

  submit(cmd: Command): void {
    this.pending.push({ ...cmd, player: this.me });
  }

  /** The host sets the pace; it is never behind. */
  behind(): number {
    return 0;
  }

  commandsAt(tick: number): Command[] | null {
    this.tick = tick;
    this.refreshStatus(false);
    if (this.waiting) return null;
    // Frames go out `delay` ticks ahead, so they reach the guests before they are due.
    while (this.nextFrame <= tick + this.delay) {
      const cmds = this.pending.splice(0);
      const n = this.nextFrame++;
      this.frames.set(n, cmds);
      if (cmds.length) this.log.push([n, cmds]);
      this.broadcast(cmds.length ? { t: 'f', n, c: cmds } : { t: 'f', n }, (p) => p.state !== 'lost');
    }
    const cmds = this.frames.get(tick) ?? NONE;
    this.frames.delete(tick);
    return cmds;
  }

  stepped(world: World): void {
    this.tick = world.tick;
    if (world.tick % HASH_EVERY === 0) this.hashes.set(world.tick, world.checksum());
  }

  /** Who the match waits for, if anyone. */
  private waitingFor(): string | null {
    const now = this.clock.now();
    for (const p of this.peers) {
      if (p.state === 'lost') {
        const left = Math.max(0, Math.ceil((GRACE_MS - (now - p.droppedAt)) / 1000));
        return `Verbindung zu ${p.name} verloren. Warte noch ${left} s, dann übernimmt der Computer.`;
      }
      if (p.state === 'catching') {
        const pct = p.catchUpTo > 0 ? Math.floor((Math.max(0, p.ack) / p.catchUpTo) * 100) : 0;
        return `${p.name} steigt wieder ein und holt auf … ${pct} %`;
      }
      if (p.state === 'ok' && this.tick - p.ack > MAX_LAG) return `Warte auf ${p.name} …`;
    }
    return null;
  }

  private refreshStatus(force: boolean): void {
    const waiting = this.inGame ? this.waitingFor() : null;
    const now = this.clock.now();
    if (!force && waiting === this.waiting && now - this.lastStatus < STATUS_MS) return;
    this.waiting = waiting;
    this.lastStatus = now;
    this.players = this.peers.map((p) => ({ player: p.player, name: p.name, state: p.state, rtt: Math.round(p.rtt) }));
    this.broadcast({ t: 'status', players: this.players, waiting, delay: this.delay });
    this.client?.status();
  }

  update(): void {
    const now = this.clock.now();
    const ping = now - this.lastRttPing >= 1000;
    if (ping) this.lastRttPing = now;
    let maxRtt = 0;
    for (const p of this.peers) {
      if (!p.transport) {
        if (this.inGame && p.state === 'lost' && now - p.droppedAt > GRACE_MS) this.handOver(p);
        continue;
      }
      if (now - p.lastSeen > SILENCE_MS) {
        p.transport.close();
        continue;
      }
      if (ping) this.send(p, { t: 'rtt', at: now });
      if (p.state === 'ok') maxRtt = Math.max(maxRtt, p.rtt);
    }
    if (this.inGame) this.delay = delayFor(maxRtt);
    this.refreshStatus(false);
  }

  // ------------------------------------------------------------ the rest

  requestPause(paused: boolean): void {
    this.applyPause(paused, this.me);
  }

  private applyPause(paused: boolean, by: number): void {
    if (this.paused === paused) return;
    this.paused = paused;
    this.broadcast({ t: 'pause', paused, by });
    this.client?.setPaused(paused, by);
  }

  setSpeed(speed: number): void {
    this.speed = speed;
    this.broadcast({ t: 'speed', speed });
  }

  chat(text: string, team: boolean): void {
    this.relayChat(this.me, text, team);
  }

  mark(x: number, y: number): void {
    this.relayMark(this.me, x, y);
  }

  private teamOf(player: number): number {
    return this.settings?.players[player]?.team ?? -1;
  }

  private relayChat(from: number, raw: string, team: boolean): void {
    const text = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_CHAT);
    if (!text) return;
    const reaches = (player: number) => !team || this.teamOf(player) === this.teamOf(from);
    this.broadcast({ t: 'chat', from, text, team }, (p) => reaches(p.player));
    if (reaches(this.me)) this.client?.chat(from, text, team);
  }

  private relayMark(from: number, x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const allied = (player: number) => this.teamOf(player) === this.teamOf(from);
    this.broadcast({ t: 'mark', from, x, y }, (p) => allied(p.player));
    if (allied(this.me)) this.client?.mark(from, x, y);
  }

  leave(): void {
    this.broadcast({ t: 'end', reason: 'Der Gastgeber hat das Spiel verlassen.' });
    this.close();
  }

  close(): void {
    super.close();
    this.hangUp();
  }

  protected hangUp(): void {
    for (const p of this.peers) {
      if (!p.transport) continue;
      p.transport.onclose = null;
      p.transport.close();
    }
  }

  /** For the lobby view: is someone connected in this slot? */
  connected(slot: number): boolean {
    return this.peers.some((p) => p.slot === slot && p.transport !== null);
  }
}

// ------------------------------------------------------------------ guest

/** A guest: sends its commands to the host and runs the frames it gets back. */
export class GuestSession extends NetSession {
  readonly kind = 'guest';
  /** The invitation this guest came with (link or code), to come back after a lost connection. */
  invite = '';
  slot = -1;
  token = '';
  slots: LobbySlot[] = [];
  options: MatchOptions | null = null;
  settings: GameSettings | null = null;
  /** Rejoin: the last frame the log covers, to fast-forward to. */
  upTo = -1;
  onLobby: (() => void) | null = null;
  onStart: (() => void) | null = null;
  onRefused: ((reason: string) => void) | null = null;
  /** Connection gone before the match started. */
  onLost: ((reason: string) => void) | null = null;
  private frames = new Map<number, Command[]>();
  private lastFrame = -1;
  private lastHeard: number;
  private ended = false;

  constructor(
    private transport: Transport,
    name: string,
    token: string | undefined,
    clock: SessionClock,
  ) {
    super(clock);
    this.lastHeard = clock.now();
    transport.onmessage = (msg) => this.receive(msg as HostMessage);
    transport.onclose = () => this.lose('Die Verbindung zum Gastgeber ist abgebrochen.');
    this.send({ t: 'hello', name: cleanName(name), token, v: GAME_VERSION });
  }

  private send(msg: GuestMessage): void {
    this.transport.send(msg);
  }

  private receive(msg: HostMessage): void {
    if (!msg || typeof msg !== 'object') return;
    this.lastHeard = this.clock.now();
    switch (msg.t) {
      case 'welcome':
        if (msg.v !== GAME_VERSION) {
          this.ended = true;
          this.onRefused?.(`Andere Spielversion: Gastgeber ${msg.v ?? 'eine ältere'}, du ${GAME_VERSION}. Der Gastgeber lädt die Seite neu (Strg+F5) und eröffnet das Spiel noch einmal.`);
          // Hanging up frees the seat on the host's side.
          this.transport.onclose = null;
          this.transport.close();
          return;
        }
        this.slot = msg.slot;
        this.token = msg.token;
        return;
      case 'refuse':
        this.ended = true;
        this.onRefused?.(msg.reason);
        return;
      case 'lobby':
        this.slots = msg.slots;
        this.options = msg.options;
        this.onLobby?.();
        return;
      case 'start':
        this.settings = msg.settings;
        this.me = msg.me;
        this.delay = msg.delay;
        this.speed = msg.speed;
        this.paused = msg.paused;
        this.frames.clear();
        for (const [n, cmds] of msg.log) this.frames.set(n, cmds);
        this.lastFrame = msg.upTo;
        this.upTo = msg.upTo;
        this.onStart?.();
        return;
      case 'f':
        if (msg.c) this.frames.set(msg.n, msg.c);
        this.lastFrame = Math.max(this.lastFrame, msg.n);
        return;
      case 'pause':
        this.paused = msg.paused;
        this.client?.setPaused(msg.paused, msg.by);
        return;
      case 'speed':
        this.speed = msg.speed;
        this.client?.setSpeed(msg.speed);
        return;
      case 'chat':
        this.client?.chat(msg.from, msg.text, msg.team);
        return;
      case 'mark':
        this.client?.mark(msg.from, msg.x, msg.y);
        return;
      case 'status':
        this.players = msg.players;
        this.waiting = msg.waiting;
        this.delay = msg.delay;
        this.client?.status();
        return;
      case 'desync':
        this.client?.desync(msg.tick, msg.player);
        return;
      case 'rtt':
        this.send({ t: 'rtt', at: msg.at });
        return;
      case 'end':
        this.lose(msg.reason, true);
        return;
    }
  }

  private lose(reason: string, final = false): void {
    if (this.ended) return;
    this.ended = true;
    this.close();
    if (this.client) this.client.lost(reason, final);
    else this.onLost?.(reason);
  }

  rename(name: string): void {
    this.send({ t: 'name', name: cleanName(name) });
  }

  submit(cmd: Command): void {
    this.send({ t: 'cmd', c: cmd });
  }

  commandsAt(tick: number): Command[] | null {
    if (tick > this.lastFrame) return null;
    const cmds = this.frames.get(tick) ?? NONE;
    this.frames.delete(tick);
    return cmds;
  }

  behind(tick: number): number {
    return this.lastFrame - tick - this.delay;
  }

  stepped(world: World): void {
    const n = world.tick;
    if (n % ACK_EVERY !== 0) return;
    // While fast-forwarding a long log, progress reports can be rarer.
    if (this.lastFrame - n > 200 && n % 100 !== 0) return;
    this.send(n % HASH_EVERY === 0 ? { t: 'ack', n, h: world.checksum() } : { t: 'ack', n });
  }

  requestPause(paused: boolean): void {
    this.send({ t: 'pause', paused });
  }

  setSpeed(): void {}

  chat(text: string, team: boolean): void {
    this.send({ t: 'chat', text, team });
  }

  mark(x: number, y: number): void {
    this.send({ t: 'mark', x, y });
  }

  update(): void {
    if (!this.ended && this.clock.now() - this.lastHeard > SILENCE_MS + 2000) this.lose('Der Gastgeber antwortet nicht mehr.');
  }

  leave(): void {
    this.ended = true;
    this.send({ t: 'leave' });
    this.close();
    // Closing at once could swallow the goodbye.
    setTimeout(() => this.transport.close(), 300);
  }

  protected hangUp(): void {
    this.ended = true;
    this.transport.close();
  }
}
