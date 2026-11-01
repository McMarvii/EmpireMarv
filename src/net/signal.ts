/**
 * Signalling: how two browsers exchange the WebRTC handshake before they
 * can talk directly. The public PeerJS server relays it (only the handshake
 * passes through it, never game data). Tabs of one browser can use a
 * BroadcastChannel instead (`?signal=local`, for testing without internet).
 */

export interface SignalMessage {
  /** EXPIRE: the server could not deliver to `src` (nobody with that id is online). */
  type: 'OFFER' | 'ANSWER' | 'CANDIDATE' | 'EXPIRE';
  src: string;
  payload: unknown;
}

export interface Signal {
  readonly id: string;
  send(type: Exclude<SignalMessage['type'], 'EXPIRE'>, dst: string, payload: unknown): void;
  /** Subscribes to handshake messages; returns the unsubscribe function. */
  on(fn: (m: SignalMessage) => void): () => void;
  close(): void;
}

const PEERJS_HOST = '0.peerjs.com';
const PEERJS_KEY = 'peerjs';
const HEARTBEAT_MS = 5000;
const OPEN_TIMEOUT_MS = 10_000;

/**
 * The PeerJS server checks every handshake message against the fields its own client sends and
 * drops the connection of a sender whose message lacks one (OFFER: type, connectionId, label,
 * serialization; ANSWER and CANDIDATE: type, connectionId). The game's own fields ride along
 * unchanged; the other side only reads those.
 */
export function peerJsPayload(type: Exclude<SignalMessage['type'], 'EXPIRE'>, payload: unknown): unknown {
  const own = (payload ?? {}) as Record<string, unknown>;
  const connectionId = `dc_${typeof own.cid === 'string' ? own.cid : 'empiremarv'}`;
  const extra = type === 'OFFER' ? { label: connectionId, reliable: true, serialization: 'binary' } : {};
  return { ...own, type: 'data', connectionId, ...extra };
}

/** A short id that is easy to read out: no 0/o, 1/l. */
export function roomId(): string {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return 'em-' + Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

class Listeners {
  private fns = new Set<(m: SignalMessage) => void>();

  on(fn: (m: SignalMessage) => void): () => void {
    this.fns.add(fn);
    return () => this.fns.delete(fn);
  }

  emit(m: SignalMessage): void {
    for (const fn of [...this.fns]) fn(m);
  }
}

/**
 * Speaks the PeerJS server protocol directly (a WebSocket with JSON
 * messages), so the game needs no library. Resolves once the server has
 * registered the id.
 */
export function openPeerJs(id: string): Promise<Signal> {
  return new Promise((resolve, reject) => {
    const token = Math.random().toString(36).slice(2);
    const ws = new WebSocket(`wss://${PEERJS_HOST}/peerjs?key=${PEERJS_KEY}&id=${encodeURIComponent(id)}&token=${token}&version=1.5.4`);
    const listeners = new Listeners();
    let opened = false;
    let heartbeat = 0;
    const fail = (text: string) => {
      clearTimeout(timeout);
      clearInterval(heartbeat);
      ws.close();
      if (!opened) reject(new Error(text));
    };
    const timeout = setTimeout(() => fail('Der Vermittlungsserver antwortet nicht.'), OPEN_TIMEOUT_MS);
    const signal: Signal = {
      id,
      send(type, dst, payload) {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, payload: peerJsPayload(type, payload), dst }));
      },
      on: (fn) => listeners.on(fn),
      close() {
        clearInterval(heartbeat);
        ws.close();
      },
    };
    ws.onmessage = (ev) => {
      let msg: { type?: string; src?: string; payload?: { msg?: string } };
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      switch (msg.type) {
        case 'OPEN':
          opened = true;
          clearTimeout(timeout);
          heartbeat = window.setInterval(() => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: 'HEARTBEAT' })), HEARTBEAT_MS);
          resolve(signal);
          return;
        case 'ID-TAKEN':
          fail('Diese Spiel-ID ist schon vergeben.');
          return;
        case 'ERROR':
        case 'INVALID-KEY':
          fail(`Vermittlungsserver: ${msg.payload?.msg ?? 'Fehler'}`);
          return;
        case 'OFFER':
        case 'ANSWER':
        case 'CANDIDATE':
        case 'EXPIRE':
          if (msg.src) listeners.emit({ type: msg.type, src: msg.src, payload: msg.payload });
          return;
      }
    };
    ws.onerror = () => fail('Der Vermittlungsserver ist nicht erreichbar.');
    ws.onclose = () => fail('Die Verbindung zum Vermittlungsserver wurde getrennt.');
  });
}

/** Same protocol between tabs of this browser, without any server. */
export function openLocal(id: string): Promise<Signal> {
  const channel = new BroadcastChannel('empiremarv-signal');
  const listeners = new Listeners();
  channel.onmessage = (ev) => {
    const m = ev.data as SignalMessage & { dst: string };
    if (m && m.dst === id) listeners.emit({ type: m.type, src: m.src, payload: m.payload });
  };
  return Promise.resolve({
    id,
    send(type, dst, payload) {
      channel.postMessage({ type, src: id, dst, payload });
    },
    on: (fn) => listeners.on(fn),
    close() {
      channel.close();
    },
  });
}

/** The signalling the page uses: local tabs with `?signal=local`, otherwise PeerJS. */
export function openSignal(id: string): Promise<Signal> {
  return new URLSearchParams(location.search).get('signal') === 'local' ? openLocal(id) : openPeerJs(id);
}
