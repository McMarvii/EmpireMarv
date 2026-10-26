import { epochNumeral, EPOCHS, LAST_EPOCH } from '../data/epochs';
import { ROLE_DEFS, type CombatRole } from '../data/units';
import { epochIcon, unitIcon } from '../render/icons';
import type { Difficulty, GameSettings, PlayerSetup, StartResources } from '../sim/world';

const PLAYER_COLORS = ['#2f7de1', '#d9412b', '#e3b322', '#3fa34d'];
const AI_NAMES = ['Aurelia', 'Borak', 'Chandra'];
const STORAGE_KEY = 'empiremarv.settings';

interface MenuValues {
  mapSize: number;
  opponents: number;
  difficulty: Difficulty;
  startEpoch: number;
  maxEpoch: number;
  popLimit: number;
  startResources: StartResources;
  reveal: boolean;
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
  seed: 0,
};

function load(): MenuValues {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw), seed: 0 };
  } catch {
    // Storage can be unavailable (private mode); defaults are fine.
  }
  return { ...DEFAULTS };
}

function save(v: MenuValues): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
  } catch {
    // Ignore – remembering settings is only a convenience.
  }
}

function options(items: Array<[string | number, string]>, selected: string | number): string {
  return items.map(([v, label]) => `<option value="${v}"${String(v) === String(selected) ? ' selected' : ''}>${label}</option>`).join('');
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
    players,
  };
}

/** The unit that is new in an epoch, to illustrate it in the timeline. */
function signatureRole(epoch: number): CombatRole {
  const order: CombatRole[] = ['mounted', 'siege', 'ranged', 'assault', 'pike'];
  return order.find((r) => ROLE_DEFS[r].tiers.some((t) => t.epoch === epoch)) ?? 'assault';
}

/** Start screen with the classic skirmish options. */
export function showMenu(root: HTMLElement, onStart: (settings: Partial<GameSettings>) => void): void {
  const el = root.querySelector<HTMLElement>('#menu')!;
  const v = load();
  const epochOpts = EPOCHS.map((e) => [e.index, `${epochNumeral(e.index)}. ${e.name}`] as [number, string]);
  const timeline = EPOCHS.map(
    (e) =>
      `<div class="tl-item" title="${e.name} (${e.period}): ${e.description}"><img src="${unitIcon(
        signatureRole(e.index),
        e.index,
        PLAYER_COLORS[0],
        40,
      )}" alt=""><img class="tl-emblem" src="${epochIcon(e.index, 24)}" alt="${epochNumeral(e.index)}"><span>${e.name}</span></div>`,
  ).join('');
  el.innerHTML = `
    <div class="menu-card">
      <h1>EmpireMarv</h1>
      <p class="tagline">Echtzeitstrategie über ${EPOCHS.length} Epochen – von der Urzeit bis ins Weltraumzeitalter.</p>
      <div class="timeline">${timeline}</div>
      <form id="menu-form">
        <label>Kartengröße<select name="mapSize">${options(
          [
            [64, 'Klein (64×64)'],
            [96, 'Mittel (96×96)'],
            [128, 'Groß (128×128)'],
          ],
          v.mapSize,
        )}</select></label>
        <label>Gegner<select name="opponents">${options(
          [
            [1, '1 KI'],
            [2, '2 KIs (jeder gegen jeden)'],
            [3, '3 KIs (jeder gegen jeden)'],
          ],
          v.opponents,
        )}</select></label>
        <label>Schwierigkeit<select name="difficulty">${options(
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
        <label>Kartennummer<input name="seed" type="number" min="0" placeholder="zufällig" value=""></label>
        <label class="check"><input name="reveal" type="checkbox"${v.reveal ? ' checked' : ''}> Karte aufgedeckt</label>
        <button type="submit" class="primary start">Spiel starten</button>
      </form>
      <p class="hint">Linksklick wählt aus, Rechtsklick gibt Befehle. F1 im Spiel zeigt alle Tasten.</p>
    </div>`;
  el.hidden = false;
  const form = el.querySelector<HTMLFormElement>('#menu-form')!;
  form.onsubmit = (ev) => {
    ev.preventDefault();
    const data = new FormData(form);
    const values: MenuValues = {
      mapSize: Number(data.get('mapSize')),
      opponents: Number(data.get('opponents')),
      difficulty: data.get('difficulty') as Difficulty,
      startEpoch: Number(data.get('startEpoch')),
      maxEpoch: Number(data.get('maxEpoch')),
      popLimit: Number(data.get('popLimit')),
      startResources: data.get('startResources') as StartResources,
      reveal: data.get('reveal') === 'on',
      seed: Number(data.get('seed')) || 0,
    };
    save(values);
    el.hidden = true;
    onStart(toSettings(values));
  };
}
