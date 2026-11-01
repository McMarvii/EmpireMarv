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
  /** False while the connection to the server is gone and being rebuilt. */
  readonly online: boolean;
  /** Called whenever `online` changes. */
  onstate: ((online: boolean) => void) | null;
  send(type: Exclude<SignalMessage['type'], 'EXPIRE'>, dst: string, payload: unknown): void;
  /** Subscribes to handshake messages; returns the unsubscribe function. */
  on(fn: (m: SignalMessage) => void): () => void;
  close(): void;
}

const PEERJS_HOST = '0.peerjs.com';
const PEERJS_KEY = 'peerjs';
const HEARTBEAT_MS = 5000;
const OPEN_TIMEOUT_MS = 10_000;
/** Waits between attempts to get back to the server; the first one goes at once. */
const RETRY_MS = [0, 1000, 2000, 4000, 8000, 15_000];

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
 *
 * Once open, a dropped connection is rebuilt with the same id and token (the server hands the id
 * back to the same token), for as long as the signal is not closed. Browsers slow down the
 * heartbeat of a tab in the background, and the server drops ids that stay silent too long:
 * without this, an invitation link would stop working while the host sends it around.
 */
export function openPeerJs(id: string): Promise<Signal> {
  return new Promise((resolve, reject) => {
    const token = Math.random().toString(36).slice(2);
    const listeners = new Listeners();
    let ws: WebSocket;
    let opened = false;
    let closed = false;
    let online = false;
    let heartbeat = 0;
    let retry = 0;
    let retryTimer = 0;
    const timeout = setTimeout(() => fail('Der Vermittlungsserver antwortet nicht.'), OPEN_TIMEOUT_MS);
    const setOnline = (on: boolean) => {
      if (online === on) return;
      online = on;
      signal.onstate?.(on);
    };
    const registered = () => {
      retry = 0;
      setOnline(true);
      if (opened) return;
      opened = true;
      clearTimeout(timeout);
      resolve(signal);
    };
    /** Before the first OPEN: give up with a message. Afterwards: try again. */
    const fail = (text: string, final = false) => {
      clearInterval(heartbeat);
      ws.onclose = null;
      ws.close();
      if (!opened) {
        clearTimeout(timeout);
        closed = true;
        document.removeEventListener('visibilitychange', wake);
        reject(new Error(text));
        return;
      }
      setOnline(false);
      if (final) closed = true;
      else reconnect();
    };
    const reconnect = () => {
      if (closed || retryTimer) return;
      const wait = RETRY_MS[Math.min(retry++, RETRY_MS.length - 1)];
      retryTimer = window.setTimeout(() => {
        retryTimer = 0;
        if (!closed) connect();
      }, wait);
    };
    const signal: Signal = {
      id,
      get online() {
        return online;
      },
      onstate: null,
      send(type, dst, payload) {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, payload: peerJsPayload(type, payload), dst }));
      },
      on: (fn) => listeners.on(fn),
      close() {
        closed = true;
        clearInterval(heartbeat);
        clearTimeout(retryTimer);
        ws.onclose = null;
        ws.close();
      },
    };
    const connect = () => {
      ws = new WebSocket(`wss://${PEERJS_HOST}/peerjs?key=${PEERJS_KEY}&id=${encodeURIComponent(id)}&token=${token}&version=1.5.4`);
      ws.onopen = () => {
        clearInterval(heartbeat);
        heartbeat = window.setInterval(() => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: 'HEARTBEAT' })), HEARTBEAT_MS);
        // A known id that comes back gets no new OPEN from the server, the open socket is enough.
        if (opened) registered();
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
            registered();
            return;
          case 'ID-TAKEN':
            // On a retry: someone else got the id meanwhile, this invitation is gone for good.
            fail('Diese Spiel-ID ist schon vergeben.', true);
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
          case 'LEAVE':
            // The server found the other side's connection dead: for the dialling side as good as EXPIRE.
            if (msg.src) listeners.emit({ type: 'EXPIRE', src: msg.src, payload: msg.payload });
            return;
        }
      };
      ws.onerror = () => fail('Der Vermittlungsserver ist nicht erreichbar.');
      ws.onclose = () => fail('Die Verbindung zum Vermittlungsserver wurde getrennt.');
    };
    // Back in the foreground: do not wait for the next retry.
    const wake = () => {
      if (closed || document.hidden || online || !opened || !retryTimer) return;
      clearTimeout(retryTimer);
      retryTimer = 0;
      retry = 0;
      connect();
    };
    document.addEventListener('visibilitychange', wake);
    const close = signal.close;
    signal.close = () => {
      document.removeEventListener('visibilitychange', wake);
      close();
    };
    connect();
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
    online: true,
    onstate: null,
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
