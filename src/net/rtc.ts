import type { Signal, SignalMessage } from './signal';
import { channelTransport, type Transport } from './transport';

/**
 * STUN servers tell each browser its public address. Without a relay
 * (TURN) some networks cannot connect directly; then the connection fails
 * with a hint instead of hanging.
 */
const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }],
};
const CONNECT_TIMEOUT_MS = 20_000;
const GATHER_TIMEOUT_MS = 4000;
const NO_ROUTE = 'Keine direkte Verbindung möglich. Ein Netzwerk (Firma, Mobilfunk, strenge Firewall) blockiert sie vermutlich.';

interface Handshake {
  /** Tells several attempts between the same browsers apart. */
  cid: string;
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}

/** Candidates can arrive before the description they belong to; they wait for it. */
class Candidates {
  private queue: RTCIceCandidateInit[] = [];
  private ready = false;

  constructor(private pc: RTCPeerConnection) {}

  add(c: RTCIceCandidateInit): void {
    if (this.ready) this.pc.addIceCandidate(c).catch(() => {});
    else this.queue.push(c);
  }

  flush(): void {
    this.ready = true;
    for (const c of this.queue.splice(0)) this.pc.addIceCandidate(c).catch(() => {});
  }
}

/** How often a guest asks again when the server says the host is not there (it may be reconnecting). */
const DIAL_RETRIES = 2;
const DIAL_RETRY_MS = 2500;

/** Guest side: connects to the host behind `hostId`. */
export function dial(signal: Signal, hostId: string): Promise<Transport> {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    let done = false;
    let pc: RTCPeerConnection;
    let off: () => void = () => {};
    let retryTimer = 0;
    const finish = (result: Error | Transport) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(retryTimer);
      off();
      if (result instanceof Error) {
        pc.close();
        reject(result);
      } else resolve(result);
    };
    const timer = setTimeout(
      () => finish(new Error(pc.iceConnectionState === 'checking' ? NO_ROUTE : 'Der Gastgeber antwortet nicht. Stimmt der Link, und ist das Spiel noch offen?')),
      CONNECT_TIMEOUT_MS,
    );
    const start = () => {
      off();
      pc?.close();
      const cid = Math.random().toString(36).slice(2);
      const conn = new RTCPeerConnection(RTC_CONFIG);
      pc = conn;
      const dc = conn.createDataChannel('empiremarv', { ordered: true });
      const candidates = new Candidates(conn);
      off = signal.on((m: SignalMessage) => {
        if (m.src !== hostId || done) return;
        if (m.type === 'EXPIRE') {
          if (attempt++ >= DIAL_RETRIES) return finish(new Error('Kein offenes Spiel unter diesem Link. Ist er aktuell, und hat der Gastgeber das Spiel noch offen?'));
          off();
          retryTimer = window.setTimeout(start, DIAL_RETRY_MS);
          return;
        }
        const p = m.payload as Handshake;
        if (p?.cid !== cid) return;
        if (m.type === 'ANSWER' && p.sdp) conn.setRemoteDescription(p.sdp).then(() => candidates.flush(), (e) => finish(e));
        else if (m.type === 'CANDIDATE' && p.candidate) candidates.add(p.candidate);
      });
      conn.onicecandidate = (ev) => {
        if (ev.candidate && conn === pc) signal.send('CANDIDATE', hostId, { cid, candidate: ev.candidate.toJSON() } satisfies Handshake);
      };
      conn.oniceconnectionstatechange = () => {
        if (conn === pc && conn.iceConnectionState === 'failed') finish(new Error(NO_ROUTE));
      };
      dc.onopen = () => {
        if (conn === pc) finish(channelTransport(conn, dc));
      };
      conn
        .createOffer()
        .then((offer) => conn.setLocalDescription(offer))
        .then(() => signal.send('OFFER', hostId, { cid, sdp: conn.localDescription!.toJSON() } satisfies Handshake))
        .catch((e) => conn === pc && finish(e));
    };
    start();
  });
}

/** Host side: answers every incoming offer; `onPeer` gets each open connection. Returns a stop function. */
export function listen(signal: Signal, onPeer: (t: Transport) => void): () => void {
  const pending = new Map<string, { pc: RTCPeerConnection; candidates: Candidates }>();
  const off = signal.on((m) => {
    const p = m.payload as Handshake;
    if (!p?.cid) return;
    const key = `${m.src}/${p.cid}`;
    if (m.type === 'CANDIDATE' && p.candidate) {
      pending.get(key)?.candidates.add(p.candidate);
      return;
    }
    if (m.type !== 'OFFER' || !p.sdp || pending.has(key)) return;
    const pc = new RTCPeerConnection(RTC_CONFIG);
    const candidates = new Candidates(pc);
    pending.set(key, { pc, candidates });
    const forget = setTimeout(() => {
      if (pending.get(key)?.pc === pc && pc.connectionState !== 'connected') pc.close();
      pending.delete(key);
    }, CONNECT_TIMEOUT_MS);
    pc.onicecandidate = (ev) => {
      if (ev.candidate) signal.send('CANDIDATE', m.src, { cid: p.cid, candidate: ev.candidate.toJSON() } satisfies Handshake);
    };
    pc.ondatachannel = (ev) => {
      const dc = ev.channel;
      dc.onopen = () => {
        clearTimeout(forget);
        pending.delete(key);
        onPeer(channelTransport(pc, dc));
      };
    };
    pc.setRemoteDescription(p.sdp)
      .then(() => candidates.flush())
      .then(() => pc.createAnswer())
      .then((answer) => pc.setLocalDescription(answer))
      .then(() => signal.send('ANSWER', m.src, { cid: p.cid, sdp: pc.localDescription!.toJSON() } satisfies Handshake))
      .catch(() => pc.close());
  });
  return () => {
    off();
    for (const { pc } of pending.values()) pc.close();
    pending.clear();
  };
}

// ------------------------------------------------- codes instead of a server

/** Waits until the browser knows all its addresses, so one code carries everything. */
function gathered(pc: RTCPeerConnection): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    const timer = setTimeout(resolve, GATHER_TIMEOUT_MS);
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(timer);
        resolve();
      }
    });
  });
}

const CODE_PREFIX = 'EM1.';

async function squeeze(text: string): Promise<string> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return CODE_PREFIX + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function unsqueeze(code: string): Promise<string> {
  const clean = code.trim().replace(/\s+/g, '');
  if (!clean.startsWith(CODE_PREFIX)) throw new Error('Das ist kein gültiger Code.');
  try {
    const bin = atob(clean.slice(CODE_PREFIX.length).replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return await new Response(stream).text();
  } catch {
    throw new Error('Der Code ist unvollständig oder beschädigt.');
  }
}

/** For tests: a handshake code and back. */
export const codec = { squeeze, unsqueeze };

/** Host: an invitation code; `accept` takes the guest's answer code. */
export async function createInvite(): Promise<{ code: string; accept(answer: string): Promise<Transport>; cancel(): void }> {
  const pc = new RTCPeerConnection(RTC_CONFIG);
  const dc = pc.createDataChannel('empiremarv', { ordered: true });
  await pc.setLocalDescription(await pc.createOffer());
  await gathered(pc);
  const code = await squeeze(pc.localDescription!.sdp);
  return {
    code,
    async accept(answer) {
      await pc.setRemoteDescription({ type: 'answer', sdp: await unsqueeze(answer) });
      return open(pc, dc);
    },
    cancel: () => pc.close(),
  };
}

/** Guest: the answer code for an invitation, and the connection once the host entered it. */
export async function answerInvite(invite: string): Promise<{ code: string; transport: Promise<Transport> }> {
  const sdp = await unsqueeze(invite);
  const pc = new RTCPeerConnection(RTC_CONFIG);
  const channel = new Promise<RTCDataChannel>((resolve) => (pc.ondatachannel = (ev) => resolve(ev.channel)));
  await pc.setRemoteDescription({ type: 'offer', sdp });
  await pc.setLocalDescription(await pc.createAnswer());
  await gathered(pc);
  const code = await squeeze(pc.localDescription!.sdp);
  // The host may take a while to paste the answer.
  return { code, transport: channel.then((dc) => open(pc, dc, 10 * 60_000)) };
}

function open(pc: RTCPeerConnection, dc: RTCDataChannel, timeout = CONNECT_TIMEOUT_MS): Promise<Transport> {
  return new Promise((resolve, reject) => {
    if (dc.readyState === 'open') return resolve(channelTransport(pc, dc));
    const timer = setTimeout(() => reject(new Error(NO_ROUTE)), timeout);
    dc.onopen = () => {
      clearTimeout(timer);
      resolve(channelTransport(pc, dc));
    };
    pc.addEventListener('iceconnectionstatechange', () => {
      if (pc.iceConnectionState === 'failed') {
        clearTimeout(timer);
        reject(new Error(NO_ROUTE));
      }
    });
  });
}
