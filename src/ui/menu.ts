import { epochNumeral, EPOCHS, LAST_EPOCH } from '../data/epochs';
import { ROLE_DEFS, type CombatRole } from '../data/units';
import { epochIcon, unitIcon } from '../render/icons';
import { WONDER_VICTORY_OPTIONS } from '../data/wonders';
import { PLAYER_COLORS, type MatchOptions } from '../net/protocol';
import { loadLastReplay, parseReplay, type Replay } from '../replay';
import type { Difficulty, GameSettings, PlayerSetup, StartResources } from '../sim/world';
import { GAME_VERSION } from '../version';

const AI_NAMES = ['Aurelia', 'Borak', 'Chandra'];
const STORAGE_KEY = 'empiremarv.settings';
const NAME_KEY = 'empiremarv.name';
const TAB_KEY = 'empiremarv.menuTab';

export interface MenuValues {
  mapSize: number;
  opponents: number;
  difficulty: Difficulty;
  startEpoch: number;
  maxEpoch: number;
  popLimit: number;
  startResources: StartResources;
  reveal: boolean;
  /** Minutes a wonder must stand to win; 0 = no wonder victory. */
  wonderVictory: number;
  seed: number;
}

const DEFAULTS: MenuValues = {
  mapSize: 96,
  opponents: 1,
  difficulty: 'normal',
  startEpoch: 0,
  maxEpoch: LAST_EPOCH,
  popLimit: 120,
  startResources: 'standard',
  reveal: false,
  wonderVictory: 10,
  seed: 0,
};

export function loadValues(): MenuValues {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw), seed: 0 };
  } catch {
    // Storage can be unavailable (private mode); defaults are fine.
  }
  return { ...DEFAULTS };
}

export function saveValues(v: MenuValues): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
  } catch {
    // Ignore – remembering settings is only a convenience.
  }
}

export function options(items: Array<[string | number, string]>, selected: string | number): string {
  return items.map(([v, label]) => `<option value="${v}"${String(v) === String(selected) ? ' selected' : ''}>${label}</option>`).join('');
}

export function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

export function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // Only a convenience.
  }
}

export function toSettings(v: MenuValues): Partial<GameSettings> {
  const players: PlayerSetup[] = [{ name: 'Du', color: PLAYER_COLORS[0], isAI: false, team: 0 }];
  for (let i = 0; i < v.opponents; i++) {
    players.push({ name: AI_NAMES[i], color: PLAYER_COLORS[i + 1], isAI: true, team: i + 1 });
  }
  return {
    seed: v.seed || Math.floor(Math.random() * 1e9),
    mapSize: v.mapSize,
    startEpoch: v.startEpoch,
    maxEpoch: Math.max(v.startEpoch, v.maxEpoch),
    popLimit: v.popLimit,
    startResources: v.startResources,
    aiDifficulty: v.difficulty,
    revealMap: v.reveal,
    wonderVictory: v.wonderVictory,
    players,
  };
}

export function matchOptions(v: MenuValues): MatchOptions {
  const { opponents: _, ...rest } = v;
  return rest;
}

/** The unit that is new in an epoch, to illustrate it in the timeline. */
function signatureRole(epoch: number): CombatRole {
  const order: CombatRole[] = ['mounted', 'siege', 'ranged', 'assault', 'pike'];
  return order.find((r) => ROLE_DEFS[r].tiers.some((t) => t.epoch === epoch)) ?? 'assault';
}

/** The match settings as form fields; single player adds the number of computer opponents. */
export function settingsFields(v: MenuValues, single: boolean): string {
  const epochOpts = EPOCHS.map((e) => [e.index, `${epochNumeral(e.index)}. ${e.name}`] as [number, string]);
  return `
    <label>Kartengröße<select name="mapSize">${options(
      [
        [64, 'Klein (64×64)'],
        [96, 'Mittel (96×96)'],
        [128, 'Groß (128×128)'],
      ],
      v.mapSize,
    )}</select></label>
    ${
      single
        ? `<label>Gegner<select name="opponents">${options(
            [
              [1, '1 KI'],
              [2, '2 KIs (jeder gegen jeden)'],
              [3, '3 KIs (jeder gegen jeden)'],
            ],
            v.opponents,
          )}</select></label>`
        : ''
    }
    <label>${single ? 'Schwierigkeit' : 'KI-Stärke'}<select name="difficulty">${options(
      [
        ['easy', 'Leicht'],
        ['normal', 'Mittel'],
        ['hard', 'Schwer'],
      ],
      v.difficulty,
    )}</select></label>
    <label>Startepoche<select name="startEpoch">${options(epochOpts, v.startEpoch)}</select></label>
    <label>Letzte Epoche<select name="maxEpoch">${options(epochOpts, v.maxEpoch)}</select></label>
    <label>Bevölkerungslimit<select name="popLimit">${options(
      [
        [75, '75'],
        [120, '120'],
        [200, '200'],
      ],
      v.popLimit,
    )}</select></label>
    <label>Startrohstoffe<select name="startResources">${options(
      [
        ['low', 'Wenig'],
        ['standard', 'Standard'],
        ['high', 'Viel'],
      ],
      v.startResources,
    )}</select></label>
    <label>Wundersieg<select name="wonderVictory">${options(
      WONDER_VICTORY_OPTIONS.map((m) => [m, m ? `Wunder ${m} Minuten halten` : 'Aus'] as [number, string]),
      v.wonderVictory,
    )}</select></label>
    <label>Kartennummer<input name="seed" type="number" min="0" placeholder="zufällig" value="${v.seed || ''}"></label>
    <label class="check"><input name="reveal" type="checkbox"${v.reveal ? ' checked' : ''}> Karte aufgedeckt</label>`;
}

export function readValues(form: HTMLFormElement, base: MenuValues): MenuValues {
  const data = new FormData(form);
  const num = (k: string, d: number) => (data.has(k) ? Number(data.get(k)) || 0 : d);
  return {
    mapSize: num('mapSize', base.mapSize),
    opponents: num('opponents', base.opponents),
    difficulty: (data.get('difficulty') as Difficulty) ?? base.difficulty,
    startEpoch: num('startEpoch', base.startEpoch),
    maxEpoch: num('maxEpoch', base.maxEpoch),
    popLimit: num('popLimit', base.popLimit),
    startResources: (data.get('startResources') as StartResources) ?? base.startResources,
    reveal: data.get('reveal') === 'on',
    wonderVictory: num('wonderVictory', base.wonderVictory),
    seed: num('seed', 0),
  };
}

export interface MenuActions {
  single(settings: Partial<GameSettings>): void;
  host(name: string): void;
  /** `invite`: a link, a game id or a handshake code. */
  join(invite: string, name: string): void;
  replay(r: Replay): void;
}

type Tab = 'single' | 'multi' | 'replay';

function fmtTicks(ticks: number): string {
  const s = Math.floor(ticks / 20);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Start screen: single player, multiplayer by link, and replays. */
export function showMenu(root: HTMLElement, actions: MenuActions, tab?: Tab): void {
  const el = root.querySelector<HTMLElement>('#menu')!;
  const v = loadValues();
  let current: Tab = tab ?? 'single';
  if (!tab) {
    try {
      current = (localStorage.getItem(TAB_KEY) as Tab) || 'single';
    } catch {
      // Defaults are fine.
    }
  }
  const timeline = EPOCHS.map(
    (e) =>
      `<div class="tl-item" title="${e.name} (${e.period}): ${e.description}"><img src="${unitIcon(
        signatureRole(e.index),
        e.index,
        PLAYER_COLORS[0],
        40,
      )}" alt=""><img class="tl-emblem" src="${epochIcon(e.index, 24)}" alt="${epochNumeral(e.index)}"><span>${e.name}</span></div>`,
  ).join('');
  const last = loadLastReplay();
  const lastInfo = last
    ? `<p>Letzte Partie vom ${new Date(last.date).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })}, ${fmtTicks(last.ticks)} Minuten: ${last.settings.players
        .map((p) => `<b style="color:${p.color}">${esc(p.name)}</b>`)
        .join(' · ')}</p>`
    : '<p class="dim">Noch keine Partie aufgezeichnet. Jede Partie wird automatisch mitgeschnitten.</p>';
  el.innerHTML = `
    <div class="menu-card">
      <h1>EmpireMarv</h1>
      <p class="tagline">Echtzeitstrategie über ${EPOCHS.length} Epochen – von der Urzeit bis ins Weltraumzeitalter.</p>
      <div class="timeline">${timeline}</div>
      <div class="menu-tabs" role="tablist">
        <button data-tab="single" role="tab">Einzelspieler</button>
        <button data-tab="multi" role="tab">Mehrspieler</button>
        <button data-tab="replay" role="tab">Wiedergaben</button>
      </div>
      <section data-pane="single">
        <form id="menu-form" class="settings-grid">
          ${settingsFields(v, true)}
          <button type="submit" class="primary start">Spiel starten</button>
        </form>
      </section>
      <section data-pane="multi">
        <div class="mp-grid">
          <div class="mp-box">
            <h3>Spiel erstellen</h3>
            <p class="dim">Du bist Gastgeber, stellst die Partie ein und schickst den Einladungslink an bis zu drei Mitspieler. Freie Plätze kann die KI füllen, Teams sind frei wählbar.</p>
            <label class="mp-name">Dein Name<input name="name" maxlength="16" placeholder="Name" value="${esc(loadName())}"></label>
            <button class="primary" data-act="host">Spiel erstellen</button>
          </div>
          <div class="mp-box">
            <h3>Beitreten</h3>
            <p class="dim">Einladungslink öffnen – oder hier einfügen (auch einen Einladungscode).</p>
            <input class="mp-invite" placeholder="Link oder Code" spellcheck="false">
            <button data-act="join">Beitreten</button>
          </div>
        </div>
        <p class="hint">Die Browser verbinden sich direkt (WebRTC). Nur der Verbindungsaufbau läuft über den öffentlichen PeerJS-Server; klappt der nicht, gibt es Codes zum Austauschen.</p>
      </section>
      <section data-pane="replay">
        <div class="mp-grid">
          <div class="mp-box">
            <h3>Letzte Partie</h3>
            ${lastInfo}
            <button class="primary" data-act="last"${last ? '' : ' disabled'}>Ansehen</button>
          </div>
          <div class="mp-box">
            <h3>Wiedergabe-Datei</h3>
            <p class="dim">Gespeicherte Wiedergaben (.json) aus dem Spielmenü öffnen.</p>
            <label class="file-btn">Datei öffnen …<input type="file" accept=".json,application/json" hidden></label>
            <p class="mp-error" hidden></p>
          </div>
        </div>
      </section>
      <p class="hint">Linksklick wählt aus, Rechtsklick gibt Befehle. F1 im Spiel zeigt alle Tasten. <span class="dim">Version ${GAME_VERSION}</span></p>
    </div>`;
  el.hidden = false;
  const show = (t: Tab) => {
    current = t;
    el.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => {
      b.classList.toggle('active', b.dataset.tab === t);
      b.setAttribute('aria-selected', String(b.dataset.tab === t));
    });
    el.querySelectorAll<HTMLElement>('[data-pane]').forEach((p) => (p.hidden = p.dataset.pane !== t));
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      // Only a convenience.
    }
  };
  el.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => (b.onclick = () => show(b.dataset.tab as Tab)));
  show(current);

  const form = el.querySelector<HTMLFormElement>('#menu-form')!;
  form.onsubmit = (ev) => {
    ev.preventDefault();
    const values = readValues(form, v);
    saveValues(values);
    el.hidden = true;
    actions.single(toSettings(values));
  };
  const nameInput = el.querySelector<HTMLInputElement>('input[name="name"]')!;
  const name = () => {
    const n = nameInput.value.trim();
    saveName(n);
    return n || 'Gastgeber';
  };
  el.querySelector<HTMLButtonElement>('[data-act="host"]')!.onclick = () => {
    el.hidden = true;
    actions.host(name());
  };
  const invite = el.querySelector<HTMLInputElement>('.mp-invite')!;
  const join = () => {
    if (!invite.value.trim()) return invite.focus();
    el.hidden = true;
    actions.join(invite.value.trim(), loadName());
  };
  el.querySelector<HTMLButtonElement>('[data-act="join"]')!.onclick = join;
  invite.onkeydown = (ev) => ev.key === 'Enter' && join();
  el.querySelector<HTMLButtonElement>('[data-act="last"]')!.onclick = () => {
    if (!last) return;
    el.hidden = true;
    actions.replay(last);
  };
  const file = el.querySelector<HTMLInputElement>('input[type="file"]')!;
  const error = el.querySelector<HTMLElement>('.mp-error')!;
  file.onchange = async () => {
    const f = file.files?.[0];
    if (!f) return;
    try {
      const r = parseReplay(await f.text());
      el.hidden = true;
      actions.replay(r);
    } catch (e) {
      error.hidden = false;
      error.textContent = (e as Error).message;
    }
    file.value = '';
  };
}
