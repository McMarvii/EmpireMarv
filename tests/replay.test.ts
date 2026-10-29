import { describe, expect, it } from 'vitest';
import { normalize, parseReplay, Recorder, REPLAY_FORMAT, type Replay } from '../src/replay';
import { ReplaySession } from '../src/session';
import { Rng } from '../src/sim/rng';
import { createWorld } from '../src/sim/setup';
import type { Command, GameSettings, World } from '../src/sim/world';
import { GAME_VERSION, SIM_VERSION } from '../src/version';

const SETTINGS: Partial<GameSettings> = {
  seed: 8,
  mapSize: 64,
  startResources: 'high',
  players: [
    { name: 'Du', color: '#2f7de1', isAI: false, team: 0 },
    { name: 'KI', color: '#d9412b', isAI: true, team: 1 },
  ],
};

/** A match like the game plays it: commands between steps, each one recorded. */
function record(ticks: number): { world: World; replay: Replay } {
  const world = createWorld(SETTINGS);
  const rec = new Recorder(world.settings, 0);
  const rng = new Rng(5);
  const apply = (cmd: Command) => {
    const c = normalize(cmd);
    rec.command(world.tick, c);
    world.issue(c);
  };
  for (let i = 0; i < ticks; i++) {
    if (rng.next() < 0.03) {
      const units = world.unitsOf(0);
      const tc = world.buildingsOf(0, 'towncenter')[0];
      if (rng.next() < 0.4 && tc) apply({ type: 'train', player: 0, buildingId: tc.id, role: 'citizen', count: 2 });
      else apply({ type: 'move', player: 0, ids: units.slice(0, 4).map((u) => u.id), x: rng.range(4, 60), y: rng.range(4, 60), facing: rng.range(-3, 3) });
    }
    world.step();
    rec.stepped(world);
  }
  return { world, replay: rec.replay };
}

function play(replay: Replay, ticks = replay.ticks): { world: World; session: ReplaySession } {
  const world = createWorld(replay.settings);
  const session = new ReplaySession(replay);
  while (world.tick < ticks) {
    for (const c of session.commandsAt(world.tick)) world.issue(c);
    world.step();
    session.stepped(world);
  }
  return { world, session };
}

describe('replays', () => {
  it('reproduce the recorded match exactly, through a file', () => {
    const { world, replay } = record(1500);
    expect(replay.commands.length).toBeGreaterThan(10);
    expect(replay.checks.length).toBe(15);
    expect(replay.game).toBe(SIM_VERSION);
    const file = parseReplay(JSON.stringify(replay));
    const { world: again, session } = play(file);
    expect(again.tick).toBe(world.tick);
    expect(again.checksum()).toBe(world.checksum());
    expect(session.diverged).toBeNull();
  });

  it('notice when they run differently than recorded', () => {
    const { replay } = record(600);
    const tampered = normalize(replay);
    // One order less: the match goes another way.
    tampered.commands.splice(0, 1);
    const { session } = play(tampered);
    expect(session.diverged).not.toBeNull();
  });

  it('refuse files that are not replays', () => {
    expect(() => parseReplay('kein json')).toThrow(/keine EmpireMarv-Wiedergabe/);
    expect(() => parseReplay('{"format":"etwas"}')).toThrow(/keine EmpireMarv-Wiedergabe/);
    expect(() => parseReplay(JSON.stringify({ format: REPLAY_FORMAT, version: 2, settings: {}, commands: [] }))).toThrow(/neueren Spielversion/);
  });

  it('hand out chat lines up to the current tick', () => {
    const { replay } = record(100);
    replay.chat = [
      [10, 0, 'eins'],
      [50, 1, 'zwei'],
    ];
    const s = new ReplaySession(replay);
    expect(s.chatUntil(20).map((c) => c[2])).toEqual(['eins']);
    expect(s.chatUntil(20)).toEqual([]);
    expect(s.chatUntil(60).map((c) => c[2])).toEqual(['zwei']);
  });

  it('normalize like the network does: -0 and undefined do not survive', () => {
    const cmd = normalize({ type: 'move', player: 0, ids: [1], x: -0, y: 2, queue: undefined } as Command);
    expect(Object.is((cmd as { x: number }).x, 0)).toBe(true);
    expect('queue' in cmd).toBe(false);
  });
});

describe('version', () => {
  it('matches package.json', () => {
    const files = import.meta.glob<string>('../package.json', { query: '?raw', import: 'default', eager: true });
    const pkg = JSON.parse(Object.values(files)[0]) as { version: string };
    expect(GAME_VERSION).toBe(pkg.version);
  });
});
