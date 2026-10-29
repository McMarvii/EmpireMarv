import type { MapChoice } from '../data/maps';
import type { Command, Difficulty, GameSettings, StartResources } from '../sim/world';

/**
 * Messages between the host and its guests. The host relays everything:
 * guests only talk to the host, which stamps each command with the tick
 * every peer applies it at (deterministic lockstep with a relay).
 */

/** Settings the host picks in the lobby (the players come from the slots). */
export interface MatchOptions {
  mapSize: number;
  /** Missing from hosts before 0.7: the continent. */
  mapType?: MapChoice;
  difficulty: Difficulty;
  startEpoch: number;
  maxEpoch: number;
  popLimit: number;
  startResources: StartResources;
  reveal: boolean;
  wonderVictory: number;
  seed: number;
}

export type SlotKind = 'host' | 'human' | 'open' | 'ai' | 'closed';

export interface LobbySlot {
  kind: SlotKind;
  name: string;
  team: number;
  color: string;
}

export interface PeerStatus {
  player: number;
  name: string;
  state: 'ok' | 'lost' | 'ai' | 'catching' | 'left';
  rtt: number;
}

export type HostMessage =
  | { t: 'welcome'; slot: number; token: string }
  | { t: 'refuse'; reason: string }
  | { t: 'lobby'; slots: LobbySlot[]; options: MatchOptions }
  | {
      t: 'start';
      settings: GameSettings;
      me: number;
      delay: number;
      speed: number;
      paused: boolean;
      /** Rejoin: the commands so far and the last frame they cover. */
      log: Array<[number, Command[]]>;
      upTo: number;
    }
  /** Commands every peer applies before stepping from tick `n` (absent: none). */
  | { t: 'f'; n: number; c?: Command[] }
  | { t: 'pause'; paused: boolean; by: number }
  | { t: 'speed'; speed: number }
  | { t: 'chat'; from: number; text: string; team: boolean }
  | { t: 'mark'; from: number; x: number; y: number }
  | { t: 'status'; players: PeerStatus[]; waiting: string | null; delay: number }
  | { t: 'desync'; tick: number; player: number }
  | { t: 'rtt'; at: number }
  | { t: 'end'; reason: string };

export type GuestMessage =
  | { t: 'hello'; name: string; token?: string }
  | { t: 'name'; name: string }
  | { t: 'cmd'; c: Command }
  /** Ticks run so far, with the state checksum when `n` is a multiple of HASH_EVERY. */
  | { t: 'ack'; n: number; h?: number }
  | { t: 'pause'; paused: boolean }
  | { t: 'chat'; text: string; team: boolean }
  | { t: 'mark'; x: number; y: number }
  | { t: 'rtt'; at: number }
  | { t: 'leave' };

/** Guests acknowledge their progress this often (ticks). */
export const ACK_EVERY = 5;
/** Checksums are compared this often (ticks). */
export const HASH_EVERY = 20;
/** The host waits when a guest falls this many ticks behind. */
export const MAX_LAG = 40;
/** How long the match waits for a player who lost the connection (ms). */
export const GRACE_MS = 60_000;
export const MIN_DELAY = 2;
export const MAX_DELAY = 8;
export const MAX_PLAYERS = 4;
export const MAX_CHAT = 200;

export const PLAYER_COLORS = ['#2f7de1', '#d9412b', '#e3b322', '#3fa34d'];

/** Command types a guest may send; anything else is dropped by the host. */
export const GUEST_COMMANDS = new Set<Command['type']>([
  'move',
  'attack',
  'gather',
  'construct',
  'place',
  'placeLine',
  'patrol',
  'formation',
  'lockstep',
  'shelter',
  'board',
  'unload',
  'refuel',
  'train',
  'cancel',
  'advance',
  'research',
  'cancelTech',
  'rally',
  'deposit',
  'explore',
  'stop',
  'destroy',
  'ability',
  'convert',
  'heal',
]);

/** Input delay in ticks for a round-trip time: enough to cover half of it plus jitter. */
export function delayFor(rttMs: number): number {
  return Math.max(MIN_DELAY, Math.min(MAX_DELAY, Math.ceil((rttMs / 2 + 40) / 50)));
}

/** Game settings for a lobby: occupied slots become players in their order. */
export function matchSettings(slots: LobbySlot[], o: MatchOptions): { settings: GameSettings; playerOf: number[] } {
  const playerOf: number[] = [];
  const players: GameSettings['players'] = [];
  slots.forEach((s, i) => {
    if (s.kind === 'open' || s.kind === 'closed') {
      playerOf[i] = -1;
      return;
    }
    playerOf[i] = players.length;
    players.push({ name: s.name, color: s.color, isAI: s.kind === 'ai', team: s.team });
  });
  return {
    playerOf,
    settings: {
      // Decided once by the host; the guests get the number with the settings.
      seed: o.seed || Math.floor(Math.random() * 1e9),
      mapSize: o.mapSize,
      mapType: o.mapType ?? 'continent',
      startEpoch: o.startEpoch,
      maxEpoch: Math.max(o.startEpoch, o.maxEpoch),
      popLimit: o.popLimit,
      startResources: o.startResources,
      aiDifficulty: o.difficulty,
      revealMap: o.reveal,
      wonderVictory: o.wonderVictory,
      players,
    },
  };
}

/** Why a lobby cannot start yet, or null. */
export function lobbyProblem(slots: LobbySlot[]): string | null {
  const active = slots.filter((s) => s.kind === 'host' || s.kind === 'human' || s.kind === 'ai');
  if (active.length < 2) return 'Mindestens zwei Spieler (Menschen oder KI) nötig.';
  if (new Set(active.map((s) => s.team)).size < 2) return 'Mindestens zwei Teams nötig.';
  return null;
}

/** Room id or handshake code from what a player pasted or opened. */
export function parseInvite(text: string): { room?: string; code?: string } | null {
  const t = text.trim();
  const hash = t.includes('#') ? t.slice(t.indexOf('#') + 1) : t;
  const params = new URLSearchParams(hash);
  const room = params.get('join') ?? (/^em-[a-z0-9]{6,}$/.test(hash) ? hash : null);
  if (room) return { room };
  const code = params.get('code') ?? (hash.startsWith('EM1.') ? hash : null);
  if (code) return { code };
  return null;
}
