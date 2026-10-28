import type { Command, GameSettings, World } from './sim/world';
import { GAME_VERSION } from './version';

export const REPLAY_FORMAT = 'empiremarv-replay';
/** State checksums are recorded this often, so playback notices when it runs differently. */
export const CHECK_EVERY = 100;
const LAST_KEY = 'empiremarv.lastReplay';

/**
 * A whole match in a few kilobytes: the simulation is deterministic, so
 * the settings (with the seed) and every command at its tick reproduce it.
 * Computer players are not recorded; they decide the same way again.
 */
export interface Replay {
  format: typeof REPLAY_FORMAT;
  version: 1;
  /** Game version that recorded it; other versions may play it out differently. */
  game: string;
  date: string;
  settings: GameSettings;
  /** Player whose view the recording starts in. */
  me: number;
  /** Length in ticks. */
  ticks: number;
  /** Commands in the order they were applied, each with the tick it was applied before. */
  commands: Array<[number, Command]>;
  checks: Array<[number, number]>;
  /** Chat lines: tick, player, text. */
  chat: Array<[number, number, string]>;
  winnerTeam?: number | null;
}

/** JSON round trip: what goes over the network and into files is exactly what the world gets. */
export function normalize<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class Recorder {
  readonly replay: Replay;

  /** `resume`: a loaded game's recording, which simply goes on. */
  constructor(settings: GameSettings, me: number, resume?: Replay) {
    if (resume) {
      this.replay = resume;
      return;
    }
    this.replay = {
      format: REPLAY_FORMAT,
      version: 1,
      game: GAME_VERSION,
      date: new Date().toISOString(),
      settings: normalize(settings),
      me,
      ticks: 0,
      commands: [],
      checks: [],
      chat: [],
    };
  }

  command(tick: number, cmd: Command): void {
    this.replay.commands.push([tick, cmd]);
  }

  stepped(world: World): void {
    this.replay.ticks = world.tick;
    if (world.tick % CHECK_EVERY === 0) this.replay.checks.push([world.tick, world.checksum()]);
    if (world.over) this.replay.winnerTeam = world.winnerTeam;
  }

  chat(tick: number, player: number, text: string): void {
    this.replay.chat.push([tick, player, text]);
  }
}

/** Reads a replay file; throws with a message for the player when it is not one. */
export function parseReplay(text: string): Replay {
  let data: Partial<Replay>;
  try {
    data = JSON.parse(text) as Partial<Replay>;
  } catch {
    throw new Error('Die Datei ist keine EmpireMarv-Wiedergabe.');
  }
  if (data?.format !== REPLAY_FORMAT || !data.settings || !Array.isArray(data.commands)) {
    throw new Error('Die Datei ist keine EmpireMarv-Wiedergabe.');
  }
  if (data.version !== 1) throw new Error('Diese Wiedergabe stammt aus einer neueren Spielversion.');
  return { checks: [], chat: [], me: 0, ticks: 0, game: '?', date: '', ...data } as Replay;
}

export function replayFileName(r: Replay): string {
  const d = new Date(r.date || Date.now());
  const pad = (n: number) => String(n).padStart(2, '0');
  return `empiremarv-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
}

export function downloadReplay(r: Replay): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(r)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = replayFileName(r);
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Keeps the latest match for "Letzte Partie ansehen"; too big or no storage: never mind. */
export function storeLastReplay(r: Replay): void {
  if (r.ticks < 20) return;
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify(r));
  } catch {
    // Quota or private mode: the file download still works.
  }
}

export function loadLastReplay(): Replay | null {
  try {
    const raw = localStorage.getItem(LAST_KEY);
    return raw ? parseReplay(raw) : null;
  } catch {
    return null;
  }
}
