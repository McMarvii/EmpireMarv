import { MAP_TYPE_BY_ID } from './data/maps';
import type { Replay } from './replay';
import { decodeState, encodeState } from './sim/snapshot';
import type { GameSettings, World, WorldSnapshot } from './sim/world';
import { GAME_VERSION, SIM_VERSION } from './version';

export const SAVE_FORMAT = 'empiremarv-save';
/** Ids of the two rolling slots. */
export const QUICK_SAVE = 'quick';
export const AUTO_SAVE = 'auto';
/** Automatic saves every five minutes of play. */
export const AUTOSAVE_TICKS = 5 * 60 * 20;

/** What the list of saved games shows, without loading the whole match. */
export interface SaveSummary {
  name: string;
  date: string;
  game: string;
  ticks: number;
  map: string;
  epoch: number;
  players: Array<{ name: string; color: string; alive: boolean }>;
}

/**
 * A match frozen in time: the world exactly as it was, plus the recording
 * so far, so the replay of a loaded match still starts at minute 0.
 */
export interface SaveGame {
  format: typeof SAVE_FORMAT;
  version: 1;
  game: string;
  summary: SaveSummary;
  settings: GameSettings;
  me: number;
  camera: { x: number; y: number; zoom: number };
  world: WorldSnapshot;
  replay: Replay;
}

export function makeSave(world: World, me: number, replay: Replay, camera: SaveGame['camera'], name: string): SaveGame {
  const map = world.settings.mapType ?? 'continent';
  return {
    format: SAVE_FORMAT,
    version: 1,
    game: SIM_VERSION,
    summary: {
      name,
      date: new Date().toISOString(),
      game: SIM_VERSION,
      ticks: world.tick,
      map: map === 'random' ? 'Zufall' : (MAP_TYPE_BY_ID.get(map)?.name ?? map),
      epoch: world.players[me].epoch,
      players: world.players.map((p) => ({ name: p.name, color: p.color, alive: p.alive })),
    },
    settings: world.settings,
    me,
    camera,
    world: world.snapshot(),
    replay,
  };
}

/** Saved games as text; encoded right away, since the snapshot points into the live world. */
export function serializeSave(save: SaveGame): string {
  return encodeState(save);
}

/** Reads a saved game; throws with a message for the player when it cannot be continued. */
export function parseSave(text: string): SaveGame {
  let save: Partial<SaveGame>;
  try {
    save = decodeState<Partial<SaveGame>>(text);
  } catch {
    throw new Error('Die Datei ist kein EmpireMarv-Spielstand.');
  }
  if (save?.format !== SAVE_FORMAT || !save.world || !save.settings) throw new Error('Die Datei ist kein EmpireMarv-Spielstand.');
  if (save.version !== 1) throw new Error('Dieser Spielstand stammt aus einer neueren Spielversion.');
  if (save.game !== SIM_VERSION) {
    throw new Error(`Dieser Spielstand stammt aus Version ${save.game}. Version ${GAME_VERSION} rechnet anders und kann ihn nicht fortsetzen.`);
  }
  return save as SaveGame;
}

export function saveFileName(s: SaveSummary): string {
  const d = new Date(s.date || Date.now());
  const pad = (n: number) => String(n).padStart(2, '0');
  return `empiremarv-spielstand-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
}

export function downloadSaveText(text: string, summary: SaveSummary): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = saveFileName(summary);
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------- storage

/** A slot in the browser's database: the summary for the list, the match packed small. */
interface SaveRecord {
  id: string;
  summary: SaveSummary;
  data: Blob | string;
  gzip: boolean;
}

const DB_NAME = 'empiremarv';
const STORE = 'saves';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('Dieser Browser kann keine Spielstände speichern.'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Speicher nicht verfügbar.'));
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = run(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error ?? new Error('Speichern fehlgeschlagen.'));
      tx.onabort = () => reject(tx.error ?? new Error('Speichern abgebrochen (Speicher voll?).'));
    });
  } finally {
    db.close();
  }
}

async function pack(text: string): Promise<{ data: Blob | string; gzip: boolean }> {
  if (typeof CompressionStream === 'undefined') return { data: text, gzip: false };
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return { data: await new Response(stream).blob(), gzip: true };
}

async function unpack(r: SaveRecord): Promise<string> {
  if (typeof r.data === 'string') return r.data;
  if (!r.gzip) return r.data.text();
  return new Response(r.data.stream().pipeThrough(new DecompressionStream('gzip'))).text();
}

/** Stores a saved game under an id (the quick and auto slots are simply overwritten). */
export async function storeSave(id: string, text: string, summary: SaveSummary): Promise<void> {
  const { data, gzip } = await pack(text);
  const record: SaveRecord = { id, summary, data, gzip };
  await withStore('readwrite', (s) => s.put(record));
}

export async function listSaves(): Promise<Array<{ id: string; summary: SaveSummary }>> {
  const all = await withStore<SaveRecord[]>('readonly', (s) => s.getAll() as IDBRequest<SaveRecord[]>);
  return all.map((r) => ({ id: r.id, summary: r.summary })).sort((a, b) => b.summary.date.localeCompare(a.summary.date));
}

/** The stored text of a slot (for loading or downloading). */
export async function readSave(id: string): Promise<string> {
  const r = await withStore<SaveRecord | undefined>('readonly', (s) => s.get(id) as IDBRequest<SaveRecord | undefined>);
  if (!r) throw new Error('Spielstand nicht gefunden.');
  return unpack(r);
}

export async function deleteSave(id: string): Promise<void> {
  await withStore('readwrite', (s) => s.delete(id));
}

/** A fresh id for a named save. */
export function newSaveId(): string {
  return `s${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}
