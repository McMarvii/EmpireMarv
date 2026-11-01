import { describe, expect, it } from 'vitest';
import { GRACE_MS, PLAYER_COLORS, type GuestMessage, type HostMessage, type MatchOptions } from '../src/net/protocol';
import { GuestSession, HostSession, type NetClient } from '../src/net/session';
import { memoryPair } from '../src/net/transport';
import { peerJsPayload } from '../src/net/signal';
import { normalize } from '../src/replay';
import { Rng } from '../src/sim/rng';
import { createWorld } from '../src/sim/setup';
import type { World } from '../src/sim/world';
import { GAME_VERSION } from '../src/version';

/** Messages with latency and jitter on a fake clock. */
class FakeNet {
  time = 0;
  private queue: Array<{ at: number; seq: number; fn: () => void }> = [];
  private seq = 0;
  private rng = new Rng(9);
  constructor(
    public latency = 40,
    public jitter = 30,
  ) {}

  /** Per link, messages stay in order (like a reliable data channel). */
  link(): (fn: () => void) => void {
    let last = 0;
    return (fn) => {
      const at = Math.max(last, this.time + this.latency + this.rng.next() * this.jitter);
      last = at;
      this.queue.push({ at, seq: this.seq++, fn });
    };
  }

  run(ms: number): void {
    const end = this.time + ms;
    for (;;) {
      this.queue.sort((a, b) => a.at - b.at || a.seq - b.seq);
      const next = this.queue[0];
      if (!next || next.at > end) break;
      this.queue.shift();
      this.time = Math.max(this.time, next.at);
      next.fn();
    }
    this.time = end;
  }
}

class Client implements NetClient {
  log: string[] = [];
  paused = false;
  desyncAt: number | null = null;
  lostReason: string | null = null;
  setPaused(paused: boolean, by: number) {
    this.paused = paused;
    this.log.push(`pause:${paused}:${by}`);
  }
  setSpeed(speed: number) {
    this.log.push(`speed:${speed}`);
  }
  chat(from: number, text: string, team: boolean) {
    this.log.push(`chat:${from}:${team ? 'team' : 'all'}:${text}`);
  }
  mark(from: number, x: number, y: number) {
    this.log.push(`mark:${from}:${x},${y}`);
  }
  status() {}
  desync(tick: number) {
    this.desyncAt ??= tick;
  }
  lostFinal: boolean | null = null;
  lost(reason: string, final?: boolean) {
    this.lostReason = reason;
    this.lostFinal = final ?? false;
  }
}

const OPTIONS: MatchOptions = {
  mapSize: 64,
  difficulty: 'normal',
  startEpoch: 0,
  maxEpoch: 17,
  popLimit: 120,
  startResources: 'standard',
  reveal: false,
  wonderVictory: 5,
  seed: 21,
};

interface Peer {
  session: HostSession | GuestSession;
  client: Client;
  world: World | null;
}

/** Steps a peer as far as its session allows, at most `max` ticks. */
function drive(p: Peer, max: number): number {
  let n = 0;
  while (p.world && n < max) {
    const cmds = p.session.commandsAt(p.world.tick);
    if (!cmds) break;
    for (const c of cmds) p.world.issue(normalize(c));
    p.world.step();
    p.session.stepped(p.world);
    n++;
  }
  return n;
}

function setup(guests = 2, net = new FakeNet()) {
  const clock = { now: () => net.time, timers: false };
  const host = new HostSession('Marvin', OPTIONS, clock);
  const hostPeer: Peer = { session: host, client: new Client(), world: null };
  host.attach(hostPeer.client);
  const peers: Peer[] = [];
  const join = (name: string, token?: string): Peer => {
    const [a, b] = memoryPair(net.link(), net.link());
    host.addPeer(b);
    const session = new GuestSession(a, name, token, clock);
    const peer: Peer = { session, client: new Client(), world: null };
    session.attach(peer.client);
    session.onStart = () => {
      peer.world = createWorld(session.settings!);
    };
    return peer;
  };
  for (let i = 0; i < guests; i++) {
    host.setSlot(i + 1, { kind: 'open' });
    peers.push(join(`Gast${i + 1}`));
  }
  net.run(500);
  return { net, clock, host, hostPeer, peers, join };
}

function startMatch(env: ReturnType<typeof setup>) {
  const { host, hostPeer, net } = env;
  host.setSlot(1, { team: 2 });
  host.setSlot(2, { team: 1 });
  host.setSlot(3, { kind: 'ai', team: 2 });
  const settings = host.start();
  hostPeer.world = createWorld(settings);
  net.run(300);
}

/** Everyone runs in 50 ms frames; guests catch up a little when behind, like the game loop. */
function play(env: ReturnType<typeof setup>, ms: number, each?: (tick: number) => void) {
  const all = [env.hostPeer, ...env.peers];
  for (let t = 0; t < ms; t += 50) {
    env.net.run(50);
    env.host.update();
    for (const p of env.peers) p.session.update();
    for (const p of all) {
      const behind = p.world ? p.session.behind(p.world.tick) : 0;
      drive(p, 1 + Math.max(0, Math.min(6, behind - 2)));
    }
    each?.(env.hostPeer.world!.tick);
  }
}

/** Lets everyone run up to the same tick, then compares the worlds. */
function settle(env: ReturnType<typeof setup>): number[] {
  const all = [env.hostPeer, ...env.peers].filter((p) => p.world);
  for (let i = 0; i < 200; i++) {
    env.net.run(50);
    env.host.update();
    const target = env.hostPeer.world!.tick;
    for (const p of env.peers) if (p.world && p.world.tick < target) drive(p, target - p.world.tick);
    if (all.every((p) => p.world!.tick === target)) break;
  }
  return all.map((p) => p.world!.checksum());
}

describe('lobby', () => {
  it('seats guests in open slots and maps slots to players', () => {
    const env = setup(1);
    expect(env.host.slots.map((s) => s.kind)).toEqual(['host', 'human', 'closed', 'closed']);
    expect(env.peers[0].session instanceof GuestSession && env.peers[0].session.slots[1].name).toBe('Gast1');
    // A second guest finds no open slot.
    const late = env.join('Spät');
    let refused = '';
    (late.session as GuestSession).onRefused = (r) => (refused = r);
    env.net.run(500);
    expect(refused).toMatch(/belegt/);
    env.host.setSlot(2, { kind: 'ai' });
    const settings = env.host.start();
    expect(settings.players.map((p) => [p.name, p.isAI])).toEqual([
      ['Marvin', false],
      ['Gast1', false],
      ['KI 3', true],
    ]);
    expect(settings.players.map((p) => p.color)).toEqual(PLAYER_COLORS.slice(0, 3));
  });

  it('refuses newcomers once the match runs', () => {
    const env = setup(2);
    startMatch(env);
    const late = env.join('Spät');
    let refused = '';
    (late.session as GuestSession).onRefused = (r) => (refused = r);
    env.net.run(500);
    expect(refused).toMatch(/läuft bereits/);
  });
});

describe('lockstep', () => {
  it('keeps host and guests in sync under latency and jitter', () => {
    const env = setup(2, new FakeNet(60, 80));
    startMatch(env);
    const rng = new Rng(4);
    const [g1, g2] = env.peers;
    play(env, 40_000, () => {
      // Everyone gives orders now and then, from their own (possibly older) view.
      for (const p of [env.hostPeer, g1, g2]) {
        const w = p.world!;
        if (rng.next() > 0.05) continue;
        const me = p.session.me;
        const units = w.unitsOf(me);
        const tc = w.buildingsOf(me, 'towncenter')[0];
        if (rng.next() < 0.5 && tc) p.session.submit({ type: 'train', player: me, buildingId: tc.id, role: 'citizen' });
        else if (units.length) p.session.submit({ type: 'move', player: me, ids: units.slice(0, 3).map((u) => u.id), x: rng.range(5, 59), y: rng.range(5, 59) });
      }
    });
    const sums = settle(env);
    expect(env.hostPeer.world!.tick).toBeGreaterThan(600);
    expect(new Set(sums).size).toBe(1);
    // The guests' orders did reach the match.
    expect(env.hostPeer.world!.players[1].stats.unitsTrained + env.hostPeer.world!.players[2].stats.unitsTrained).toBeGreaterThan(0);
    expect(env.hostPeer.client.desyncAt).toBeNull();
  });

  it('lets a guest command only its own empire', () => {
    const env = setup(2);
    startMatch(env);
    const host = env.hostPeer.world!;
    const victim = host.unitsOf(0)[0];
    const g1 = env.peers[0].session;
    // Claims to be the host.
    g1.submit({ type: 'move', player: 0, ids: [victim.id], x: 5, y: 5 });
    play(env, 1000);
    expect(host.get(victim.id)).toBeTruthy();
    expect(host.unitsOf(0).find((u) => u.id === victim.id)!.order.kind).toBe('idle');
  });

  it('waits for a guest that lost the connection, then lets the computer play on', () => {
    const env = setup(2);
    startMatch(env);
    play(env, 3000);
    const g2 = env.peers[1];
    (g2.session as GuestSession)['transport'].close();
    g2.world = null;
    play(env, 3000);
    const stopped = env.hostPeer.world!.tick;
    play(env, 5000);
    expect(env.hostPeer.world!.tick).toBe(stopped);
    expect(env.host.waiting).toMatch(/Verbindung zu Gast2 verloren/);
    play(env, GRACE_MS);
    expect(env.hostPeer.world!.tick).toBeGreaterThan(stopped);
    expect(env.hostPeer.world!.players[2].isAI).toBe(true);
    const [a, b] = settle({ ...env, peers: [env.peers[0]] });
    expect(a).toBe(b);
  });

  it('lets a player rejoin: the log is replayed fast and the match goes on in sync', () => {
    const env = setup(2);
    startMatch(env);
    const rng = new Rng(2);
    play(env, 8000, () => {
      if (rng.next() < 0.05) {
        const w = env.peers[1].world!;
        const units = w.unitsOf(2);
        env.peers[1].session.submit({ type: 'move', player: 2, ids: units.map((u) => u.id), x: rng.range(5, 59), y: rng.range(5, 59) });
      }
    });
    const old = env.peers[1].session as GuestSession;
    const token = old.token;
    old['transport'].close();
    env.peers[1].world = null;
    play(env, 2000);
    // Too long away: the computer took over, the player comes back anyway.
    play(env, GRACE_MS + 1000);
    expect(env.hostPeer.world!.players[2].isAI).toBe(true);
    const back = env.join('Gast2', token);
    env.peers[1] = back;
    env.net.run(500);
    const s = back.session as GuestSession;
    expect(s.me).toBe(2);
    expect(s.upTo).toBeGreaterThan(100);
    expect(env.host.waiting).toMatch(/holt auf/);
    // Fast-forward like the game does, then play on together.
    drive(back, s.upTo + 1);
    play(env, 4000);
    expect(env.host.waiting).toBeNull();
    const sums = settle(env);
    expect(new Set(sums).size).toBe(1);
    expect(env.hostPeer.world!.players[2].isAI).toBe(false);
  });

  it('notices when a peer runs differently', () => {
    const env = setup(1);
    env.host.setSlot(1, { team: 2 });
    env.hostPeer.world = createWorld(env.host.start());
    env.net.run(300);
    play(env, 2000);
    env.peers[0].world!.units[0].x += 0.01;
    play(env, 3000);
    expect(env.hostPeer.client.desyncAt).not.toBeNull();
    expect(env.peers[0].client.desyncAt).toBe(env.hostPeer.client.desyncAt);
  });
});

describe('talking', () => {
  it('pauses for everyone, whoever asks', () => {
    const env = setup(2);
    startMatch(env);
    env.peers[1].session.requestPause(true);
    env.net.run(500);
    for (const p of [env.hostPeer, ...env.peers]) expect(p.client.paused).toBe(true);
    expect(env.peers[0].client.log).toContain('pause:true:2');
    env.host.requestPause(false);
    env.net.run(500);
    for (const p of [env.hostPeer, ...env.peers]) expect(p.client.paused).toBe(false);
  });

  it('sends team chat and map marks to allies only', () => {
    const env = setup(2);
    startMatch(env);
    // Teams: host and guest 2 are team 1, guest 1 is team 2.
    env.peers[1].session.chat('Angriff im Norden', true);
    env.peers[1].session.mark(10, 12);
    env.peers[0].session.chat('Hallo alle', false);
    env.net.run(500);
    expect(env.hostPeer.client.log).toEqual(['chat:2:team:Angriff im Norden', 'mark:2:10,12', 'chat:1:all:Hallo alle']);
    expect(env.peers[0].client.log).toEqual(['chat:1:all:Hallo alle']);
    expect(env.peers[1].client.log).toEqual(['chat:2:team:Angriff im Norden', 'mark:2:10,12', 'chat:1:all:Hallo alle']);
  });

  it('ends the match for the guests when the host leaves', () => {
    const env = setup(1);
    env.host.setSlot(1, { team: 2 });
    env.hostPeer.world = createWorld(env.host.start());
    env.net.run(300);
    env.host.leave();
    env.net.run(500);
    expect(env.peers[0].client.lostReason).toMatch(/Gastgeber hat das Spiel verlassen/);
    // Nothing to come back to.
    expect(env.peers[0].client.lostFinal).toBe(true);
  });

  it('offers a way back when only the connection broke', () => {
    const env = setup(1);
    env.host.setSlot(1, { team: 2 });
    env.hostPeer.world = createWorld(env.host.start());
    env.net.run(300);
    (env.peers[0].session as GuestSession)['transport'].close();
    env.net.run(300);
    expect(env.peers[0].client.lostReason).toMatch(/abgebrochen/);
    expect(env.peers[0].client.lostFinal).toBe(false);
  });
});

describe('versions and seats', () => {
  it('refuses a guest that runs another version (or one too old to say)', () => {
    const env = setup(0);
    env.host.setSlot(1, { kind: 'open' });
    for (const v of ['0.10.1', undefined]) {
      const [a, b] = memoryPair(env.net.link(), env.net.link());
      env.host.addPeer(b);
      const got: HostMessage[] = [];
      a.onmessage = (m) => got.push(m as HostMessage);
      a.send({ t: 'hello', name: 'Alt', v } satisfies GuestMessage);
      env.net.run(300);
      expect(got[0]).toMatchObject({ t: 'refuse' });
      expect((got[0] as { reason: string }).reason).toContain(GAME_VERSION);
      expect(env.host.slots[1].kind).toBe('open');
    }
  });

  it('leaves a host that runs another version (or one too old to say)', () => {
    for (const v of ['0.10.1', undefined]) {
      const net = new FakeNet();
      const [a, b] = memoryPair(net.link(), net.link());
      b.onmessage = (m) => {
        if ((m as GuestMessage).t === 'hello') b.send({ t: 'welcome', slot: 1, token: 'x', v } satisfies HostMessage);
      };
      let hungUp = false;
      b.onclose = () => (hungUp = true);
      const guest = new GuestSession(a, 'Neu', undefined, { now: () => net.time, timers: false });
      let refused = '';
      guest.onRefused = (r) => (refused = r);
      net.run(300);
      expect(refused).toMatch(/Andere Spielversion/);
      expect(guest.slot).toBe(-1);
      expect(hungUp).toBe(true);
    }
  });

  it('lets a player who lost the token (new tab, other browser) back in by name', () => {
    const env = setup(2);
    startMatch(env);
    play(env, 3000);
    (env.peers[1].session as GuestSession)['transport'].close();
    env.peers[1].world = null;
    play(env, 1000);
    // A stranger gets no seat, the same name does, without a token.
    const stranger = env.join('Fremd');
    let refused = '';
    (stranger.session as GuestSession).onRefused = (r) => (refused = r);
    env.net.run(500);
    expect(refused).toMatch(/läuft bereits/);
    const back = env.join('Gast2');
    env.peers[1] = back;
    env.net.run(500);
    const s = back.session as GuestSession;
    expect(s.me).toBe(2);
    drive(back, s.upTo + 1);
    play(env, 3000);
    expect(env.host.waiting).toBeNull();
    expect(new Set(settle(env)).size).toBe(1);
  });

  it('keeps a seat that is still connected away from a namesake', () => {
    const env = setup(2);
    startMatch(env);
    play(env, 1000);
    const twin = env.join('Gast2');
    let refused = '';
    (twin.session as GuestSession).onRefused = (r) => (refused = r);
    env.net.run(500);
    expect(refused).toMatch(/läuft bereits/);
  });
});

describe('PeerJS handshake format', () => {
  // The public server drops a sender whose message lacks a field its own client always sends.
  it('adds the fields the server checks and keeps the game’s own', () => {
    const sdp = { type: 'offer' as const, sdp: 'v=0' };
    const offer = peerJsPayload('OFFER', { cid: 'k1', sdp }) as Record<string, unknown>;
    expect(offer).toMatchObject({ cid: 'k1', sdp, type: 'data', connectionId: 'dc_k1', label: 'dc_k1', serialization: 'binary' });
    const answer = peerJsPayload('ANSWER', { cid: 'k1', sdp: { ...sdp, type: 'answer' } }) as Record<string, unknown>;
    expect(answer).toMatchObject({ cid: 'k1', type: 'data', connectionId: 'dc_k1' });
    const cand = peerJsPayload('CANDIDATE', { cid: 'k1', candidate: { candidate: 'c' } }) as Record<string, unknown>;
    expect(cand).toMatchObject({ cid: 'k1', candidate: { candidate: 'c' }, type: 'data', connectionId: 'dc_k1' });
  });
});
