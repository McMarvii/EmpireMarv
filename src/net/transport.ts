/**
 * A reliable, ordered message pipe to one peer. In the browser it is a
 * WebRTC data channel; tests use an in-memory pair with simulated latency.
 */
export interface Transport {
  send(msg: unknown): void;
  onmessage: ((msg: unknown) => void) | null;
  onclose: (() => void) | null;
  close(): void;
  readonly open: boolean;
}

/** Data channels refuse messages above ~256 KB; a rejoin log can be bigger. */
const CHUNK = 16_000;

interface Part {
  t: '~';
  id: number;
  i: number;
  n: number;
  d: string;
}

/** JSON over an open RTCDataChannel, split into chunks where needed. */
export function channelTransport(pc: RTCPeerConnection, dc: RTCDataChannel): Transport {
  let nextId = 1;
  const parts = new Map<number, string[]>();
  let closed = false;
  const t: Transport = {
    onmessage: null,
    onclose: null,
    get open() {
      return !closed && dc.readyState === 'open';
    },
    send(msg) {
      if (!t.open) return;
      const text = JSON.stringify(msg);
      if (text.length <= CHUNK) {
        dc.send(text);
        return;
      }
      const id = nextId++;
      const n = Math.ceil(text.length / CHUNK);
      for (let i = 0; i < n; i++) dc.send(JSON.stringify({ t: '~', id, i, n, d: text.slice(i * CHUNK, (i + 1) * CHUNK) } satisfies Part));
    },
    close() {
      if (closed) return;
      closed = true;
      dc.close();
      pc.close();
      t.onclose?.();
    },
  };
  dc.onmessage = (ev) => {
    let msg: unknown;
    try {
      msg = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    const part = msg as Part;
    if (part && part.t === '~') {
      const list = parts.get(part.id) ?? [];
      list[part.i] = part.d;
      parts.set(part.id, list);
      if (list.filter((x) => x !== undefined).length < part.n) return;
      parts.delete(part.id);
      try {
        msg = JSON.parse(list.join(''));
      } catch {
        return;
      }
    }
    t.onmessage?.(msg);
  };
  const lost = () => {
    if (closed) return;
    closed = true;
    pc.close();
    t.onclose?.();
  };
  dc.onclose = lost;
  pc.addEventListener('connectionstatechange', () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') lost();
  });
  return t;
}

type Deliver = (fn: () => void) => void;

/**
 * Two connected in-memory transports. `deliver` decides when a message
 * arrives, per direction (tests pass a scheduler with latency); messages
 * are JSON round-tripped like on the wire.
 */
export function memoryPair(deliver: Deliver = (fn) => queueMicrotask(fn), deliverBack: Deliver = deliver): [Transport, Transport] {
  const make = (deliver: Deliver): Transport & { peer?: Transport; closed: boolean } => {
    const t: Transport & { peer?: Transport; closed: boolean } = {
      onmessage: null,
      onclose: null,
      closed: false,
      get open() {
        return !t.closed;
      },
      send(msg) {
        if (t.closed) return;
        const text = JSON.stringify(msg);
        const peer = t.peer!;
        deliver(() => {
          if (!(peer as typeof t).closed) peer.onmessage?.(JSON.parse(text));
        });
      },
      close() {
        if (t.closed) return;
        t.closed = true;
        t.onclose?.();
        const peer = t.peer as typeof t;
        deliver(() => {
          if (peer.closed) return;
          peer.closed = true;
          peer.onclose?.();
        });
      },
    };
    return t;
  };
  const a = make(deliver);
  const b = make(deliverBack);
  a.peer = b;
  b.peer = a;
  return [a, b];
}
