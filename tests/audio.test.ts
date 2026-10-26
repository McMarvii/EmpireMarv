import { describe, expect, it } from 'vitest';
import { Heat, spatial, Throttle } from '../src/audio/director';
import { DRUMS, INSTRUMENTS, playDrum, playNote } from '../src/audio/instruments';
import { composeBar, degreeToMidi, MUSIC, SECTION_BARS } from '../src/audio/music';
import { soundSamples, UI_SOUNDS } from '../src/audio/sounds';
import type { Out } from '../src/audio/synth';
import type { EraStyle } from '../src/data/epochs';
import { emptyWorld, run } from './helpers';

/**
 * Just enough of the Web Audio API to run the recipes in Node. It throws
 * where browsers throw (exponential ramps to zero, non-finite values,
 * stopping before starting), which is what breaks sound in practice.
 */
class Param {
  value = 0;
  private check(v: number, t: number): void {
    if (!Number.isFinite(v) || !Number.isFinite(t) || t < 0) throw new TypeError(`bad automation value ${v} at ${t}`);
  }
  setValueAtTime(v: number, t: number): this {
    this.check(v, t);
    return this;
  }
  linearRampToValueAtTime(v: number, t: number): this {
    this.check(v, t);
    return this;
  }
  exponentialRampToValueAtTime(v: number, t: number): this {
    this.check(v, t);
    if (v <= 0) throw new RangeError('exponential ramp to a non-positive value');
    return this;
  }
  setTargetAtTime(v: number, t: number, c: number): this {
    this.check(v, t);
    if (!(c > 0)) throw new RangeError('time constant must be positive');
    return this;
  }
}

class Node {
  connect<T>(n: T): T {
    return n;
  }
}

class Source extends Node {
  started = -1;
  stopped = -1;
  constructor(log: Source[]) {
    super();
    log.push(this);
  }
  start(t = 0): void {
    if (!Number.isFinite(t) || t < 0) throw new TypeError('bad start');
    this.started = t;
  }
  stop(t = 0): void {
    if (this.started < 0 || t < this.started) throw new Error('stop before start');
    this.stopped = t;
  }
}

class MockContext {
  sampleRate = 8000;
  currentTime = 0;
  sources: Source[] = [];
  createOscillator() {
    return Object.assign(new Source(this.sources), { type: 'sine', frequency: new Param(), detune: new Param() });
  }
  createBufferSource() {
    return Object.assign(new Source(this.sources), { buffer: null, loop: false, playbackRate: new Param() });
  }
  createGain() {
    return Object.assign(new Node(), { gain: new Param() });
  }
  createBiquadFilter() {
    return Object.assign(new Node(), { type: 'lowpass', frequency: new Param(), Q: new Param(), gain: new Param() });
  }
  createBuffer(_channels: number, length: number) {
    return { getChannelData: () => new Float32Array(length) };
  }
}

function mockOut(): { out: Out; ctx: MockContext } {
  const ctx = new MockContext();
  const out = { ctx, dest: new Node(), t: 0.1, noise: ctx.createBuffer(1, 10) } as unknown as Out;
  return { out, ctx };
}

describe('sound recipes', () => {
  const samples = soundSamples();

  it('cover every weapon, interface sound and era', () => {
    const names = samples.map((s) => s.name);
    for (const p of ['stone', 'arrow', 'bullet', 'shell', 'boulder', 'laser']) expect(names.some((n) => n.startsWith(`shot:${p}`))).toBe(true);
    for (const style of Object.keys(MUSIC)) for (const id of UI_SOUNDS) expect(names).toContain(`ui:${id}:${style}`);
  });

  it.each(samples.map((s) => [s.name, s] as const))('%s schedules valid sound within its length', (_name, sample) => {
    const { out, ctx } = mockOut();
    sample.play(out);
    expect(ctx.sources.length).toBeGreaterThan(0);
    for (const src of ctx.sources) {
      expect(src.started).toBeGreaterThanOrEqual(out.t);
      expect(src.stopped).toBeGreaterThan(src.started);
      expect(src.stopped - out.t).toBeLessThanOrEqual(sample.dur);
    }
  });

  it('instruments and drums play at any pitch and length', () => {
    for (const inst of INSTRUMENTS) {
      for (const [midi, len] of [[36, 4], [60, 0.1], [84, 0.5]]) {
        const { out, ctx } = mockOut();
        playNote(out, inst, midi, len, 0.7);
        expect(ctx.sources.length, inst).toBeGreaterThan(0);
      }
    }
    for (const drum of DRUMS) {
      const { out, ctx } = mockOut();
      playDrum(out, drum, 0.5);
      expect(ctx.sources.length, drum).toBeGreaterThan(0);
    }
  });
});

describe('music', () => {
  const styles = Object.keys(MUSIC) as EraStyle[];

  it('keeps every pattern exactly one bar long', () => {
    for (const id of styles) {
      const s = MUSIC[id];
      const patterns = [...s.rhythms, s.bassLine.calm, s.bassLine.battle];
      if (s.arp) patterns.push(s.arp.calm, s.arp.battle);
      for (const kit of [s.drums.calm, s.drums.battle]) patterns.push(...Object.values(kit));
      for (const p of patterns) expect(p.length, `${id}: ${p}`).toBe(s.steps);
    }
  });

  it('composes the same bar from the same seed', () => {
    for (const id of styles) expect(composeBar(id, 13, 42, false)).toEqual(composeBar(id, 13, 42, false));
    expect(composeBar('medieval', 3, 1, false)).not.toEqual(composeBar('medieval', 3, 2, false));
  });

  it('writes only notes of the scale and inside the bar', () => {
    for (const id of styles) {
      const style = MUSIC[id];
      const pcs = new Set(style.scale.map((s) => (style.root + s) % 12));
      for (let bar = 0; bar < SECTION_BARS * 4; bar++) {
        for (const battle of [false, true]) {
          const { notes, drums } = composeBar(id, bar, 7, battle);
          for (const n of notes) {
            expect(pcs.has(((n.midi % 12) + 12) % 12), `${id} bar ${bar}: ${n.midi}`).toBe(true);
            expect(n.step).toBeGreaterThanOrEqual(0);
            expect(n.step).toBeLessThan(style.steps);
            expect(n.midi).toBeGreaterThanOrEqual(24);
            expect(n.midi).toBeLessThanOrEqual(96);
          }
          for (const d of drums) expect(d.step).toBeLessThan(style.steps);
        }
      }
    }
  });

  it('repeats motifs: bars 0 and 2 of a section share their rhythm', () => {
    for (const id of styles) {
      const lead = (bar: number) =>
        composeBar(id, bar, 5, true)
          .notes.filter((n) => n.inst === MUSIC[id].lead)
          .map((n) => n.step);
      expect(lead(2)).toEqual(lead(0));
      expect(lead(0).length).toBeGreaterThan(0);
    }
  });

  it('drives harder in battle', () => {
    for (const id of styles) {
      let calm = 0;
      let battle = 0;
      for (let bar = 0; bar < 8; bar++) {
        calm += composeBar(id, bar, 3, false).drums.length;
        battle += composeBar(id, bar, 3, true).drums.length;
      }
      expect(battle, id).toBeGreaterThan(calm);
    }
  });

  it('maps scale degrees across octaves', () => {
    const s = MUSIC.imperial;
    expect(degreeToMidi(s, 0)).toBe(s.root);
    expect(degreeToMidi(s, 7)).toBe(s.root + 12);
    expect(degreeToMidi(s, -1)).toBe(s.root - 1);
  });
});

describe('mixing helpers', () => {
  it('places sounds by screen position', () => {
    expect(spatial(400, 300, 800, 600)).toEqual({ gain: 1, pan: 0 });
    const right = spatial(800, 300, 800, 600);
    expect(right.pan).toBeCloseTo(0.6);
    expect(right.gain).toBeCloseTo(0.75);
    expect(spatial(1400, 300, 800, 600).gain).toBe(0);
    expect(spatial(-200, 300, 800, 600).pan).toBeCloseTo(-0.6);
  });

  it('throttles repeats per key', () => {
    const t = new Throttle();
    expect(t.allow('shot', 0, 50)).toBe(true);
    expect(t.allow('shot', 30, 50)).toBe(false);
    expect(t.allow('melee', 30, 50)).toBe(true);
    expect(t.allow('shot', 60, 50)).toBe(true);
  });

  it('switches to battle music and back with hysteresis', () => {
    const h = new Heat();
    h.add(10);
    expect(h.battle).toBe(false);
    h.add(10);
    expect(h.battle).toBe(true);
    h.decay(4);
    expect(h.value).toBeGreaterThan(Heat.LEAVE);
    expect(h.battle).toBe(true);
    h.decay(20);
    expect(h.battle).toBe(false);
  });
});

describe('sound cues from the simulation', () => {
  it('reports shots, impacts and deaths', () => {
    const w = emptyWorld({ startEpoch: 4 });
    const archer = w.spawnUnit(0, 'ranged', 10, 10);
    const victim = w.spawnUnit(1, 'citizen', 14, 10);
    w.cues.length = 0;
    w.issue({ type: 'attack', player: 0, ids: [archer.id], targetId: victim.id });
    run(w, 30);
    const kinds = new Set(w.cues.map((c) => c.kind));
    expect(kinds.has('shot')).toBe(true);
    expect(kinds.has('impact')).toBe(true);
    expect(kinds.has('death')).toBe(true);
    const shot = w.cues.find((c) => c.kind === 'shot')!;
    expect(shot.projectile).toBe('arrow');
    expect(shot.owner).toBe(0);
    expect(w.cues.find((c) => c.kind === 'death')!.look).toBe('citizen');
  });

  it('reports melee hits and collapsing buildings', () => {
    const w = emptyWorld();
    const house = w.addBuilding(1, 'house', 20, 20, true);
    house.hp = 1;
    const club = w.spawnUnit(0, 'assault', 19, 22);
    w.cues.length = 0;
    w.issue({ type: 'attack', player: 0, ids: [club.id], targetId: house.id });
    run(w, 10);
    expect(w.cues.some((c) => c.kind === 'melee' && c.look === 'club')).toBe(true);
    expect(w.cues.some((c) => c.kind === 'collapse' && c.size === house.size)).toBe(true);
  });

  it('lets working citizens be heard and caps the queue', () => {
    const w = emptyWorld();
    const tree = w.addResource('tree', 12, 12, 1, 200);
    const c = w.spawnUnit(0, 'citizen', 11, 12);
    w.issue({ type: 'gather', player: 0, ids: [c.id], targetId: tree.id });
    run(w, 5);
    expect(w.cues.some((q) => q.kind === 'work' && q.work === 'wood')).toBe(true);
    run(w, 600);
    expect(w.cues.length).toBeLessThanOrEqual(256);
  });
});
