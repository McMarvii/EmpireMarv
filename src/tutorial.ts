import { buildingName } from './data/buildings';
import { EPOCHS } from './data/epochs';
import { COMBAT_ROLES, type CombatRole } from './data/units';
import type { Point } from './sim/pathfinding';
import type { GameSettings, World } from './sim/world';

/**
 * The guided practice match: a fixed map, a robbers' camp in the far corner
 * and fourteen steps from moving the camera to the first battle. Every step
 * checks the match itself, so it does not matter how the player gets there
 * (keys, buttons or right clicks) – and a step already done is skipped.
 */
export const TUTORIAL_SETTINGS: Partial<GameSettings> = {
  seed: 4242,
  mapSize: 64,
  mapType: 'continent',
  startEpoch: 0,
  maxEpoch: 2,
  popLimit: 75,
  startResources: 'high',
  aiDifficulty: 'easy',
  scenario: 'tutorial',
  players: [
    { name: 'Du', color: '#2f7de1', isAI: false, team: 0 },
    { name: 'Räuber', color: '#8a5a2b', isAI: false, team: 1 },
  ],
};

/** Set once the tutorial was won; the menu then shows a tick. */
export const TUTORIAL_DONE_KEY = 'empiremarv.tutorial';

/** What a step may look at: the match and what the player has selected, moved and grouped. */
export interface TutorialView {
  world: World;
  me: number;
  selection: number[];
  /** How far the camera moved (in tiles) since the tutorial started, zooming counts as 3. */
  cameraMoved: number;
  groups: Map<string, number[]>;
}

export interface TutorialStep {
  title: string;
  text: string | ((v: TutorialView) => string);
  /** A command button to point at (its hotkey). */
  key?: string;
  /** A spot on the map to point at. */
  mark?: (v: TutorialView) => Point | null;
  done: (v: TutorialView) => boolean;
}

const citizensAt = (v: TutorialView, res: 'wood' | 'food') =>
  v.world.units.filter((u) => u.owner === v.me && u.role === 'citizen' && u.order.kind === 'gather' && u.order.res === res).length;
const built = (v: TutorialView, type: 'house' | 'storehouse' | 'barracks') => v.world.buildingsOf(v.me, type).filter((b) => b.built).length;
const fighters = (v: TutorialView, ids: number[]) =>
  ids.filter((id) => {
    const e = v.world.get(id);
    return e && e.kind === 'unit' && e.owner === v.me && COMBAT_ROLES.includes(e.role as CombatRole);
  }).length;

/** The nearest resource node of a kind to the player's town center. */
function nearest(v: TutorialView, kind: 'tree' | 'berries'): Point | null {
  const tc = v.world.buildingsOf(v.me, 'towncenter')[0];
  const from = tc ?? v.world.startPositions[v.me];
  let best: Point | null = null;
  let bestD = Infinity;
  for (const n of v.world.resources) {
    if (n.dead || n.nodeType !== kind) continue;
    const d = Math.hypot(n.x - from.x, n.y - from.y);
    if (d < bestD) {
      bestD = d;
      best = { x: n.x, y: n.y };
    }
  }
  return best;
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    title: 'Umsehen',
    text: 'Bewege die Kamera: Pfeiltasten, Maus an den Bildschirmrand oder mit gedrückter rechter Maustaste ziehen. Das Mausrad zoomt.',
    done: (v) => v.cameraMoved >= 3,
  },
  {
    title: 'Bürger auswählen',
    text: 'Klicke mit links auf einen deiner Bürger – oder ziehe einen Rahmen um mehrere.',
    done: (v) => v.selection.some((id) => {
      const e = v.world.get(id);
      return e?.kind === 'unit' && e.owner === v.me && e.role === 'citizen';
    }),
  },
  {
    title: 'Holz fällen',
    text: 'Mit Bürgern ausgewählt: Rechtsklick auf einen Baum (markiert). Sie fällen Holz und bringen es zum Dorfzentrum. Schicke mindestens zwei.',
    mark: (v) => nearest(v, 'tree'),
    done: (v) => citizensAt(v, 'wood') >= 2,
  },
  {
    title: 'Nahrung sammeln',
    text: 'Wähle zwei andere Bürger und schicke sie per Rechtsklick zu den Beerensträuchern (markiert).',
    mark: (v) => nearest(v, 'berries'),
    done: (v) => citizensAt(v, 'food') >= 2,
  },
  {
    title: 'Bürger ausbilden',
    text: 'Wähle das Dorfzentrum (anklicken oder Pos1) und bilde mit Q einen Bürger aus. Mehr Bürger heißt mehr Rohstoffe.',
    key: 'Q',
    done: (v) =>
      v.world.players[v.me].stats.unitsTrained > 0 || v.world.buildingsOf(v.me, 'towncenter').some((b) => b.queue.some((q) => q.role === 'citizen')),
  },
  {
    title: 'Eine Hütte bauen',
    text: 'Wähle einen Bürger, drücke H und setze die Hütte mit Linksklick. Hütten heben die Moral der Truppen in der Nähe.',
    key: 'H',
    done: (v) => built(v, 'house') >= 1,
  },
  {
    title: 'Ein Lager am Wald',
    text: 'Baue mit L ein Lager nah am Wald (markiert). Kurze Wege bringen mehr Holz.',
    key: 'L',
    mark: (v) => nearest(v, 'tree'),
    done: (v) => built(v, 'storehouse') >= 1,
  },
  {
    title: 'Forschen',
    text: 'Wähle das Dorfzentrum und erforsche eine Technik – die Knöpfe ab A. Techniken machen dein Volk dauerhaft besser.',
    key: 'A',
    done: (v) => v.world.players[v.me].techs.size >= 1,
  },
  {
    title: 'Den Aufstieg vorbereiten',
    text: (v) => {
      const missing = v.world.missingRequirements(v.me).map((m) => `${m.need - m.have}× ${buildingName(m.type, 0)}`);
      const techs = v.world.missingTechs(v.me);
      if (techs.have < techs.need) missing.push(`${techs.need - techs.have} Technik`);
      return `Für die nächste Epoche braucht es Gebäude und Forschung. Es fehlt noch: ${missing.join(', ') || 'nichts mehr'}.`;
    },
    done: (v) => {
      if (v.world.players[v.me].epoch >= 1 || v.world.isResearching(v.me)) return true;
      const techs = v.world.missingTechs(v.me);
      return v.world.missingRequirements(v.me).length === 0 && techs.have >= techs.need;
    },
  },
  {
    title: 'Aufsteigen',
    text: `Wähle das Dorfzentrum und drücke E: Dein Volk steigt in die ${EPOCHS[1].name} auf. Das dauert einen Moment.`,
    key: 'E',
    done: (v) => v.world.players[v.me].epoch >= 1,
  },
  {
    title: 'Eine Kaserne bauen',
    text: 'Wähle einen Bürger und baue mit K eine Kaserne.',
    key: 'K',
    done: (v) => built(v, 'barracks') >= 1,
  },
  {
    title: 'Krieger ausbilden',
    text: (v) => {
      const n = v.world.units.filter((u) => u.owner === v.me && u.role === 'assault').length;
      return `Wähle die Kaserne und bilde mit Q Axtkämpfer aus (Umschalt+Q: fünf auf einmal). Bereit: ${n} / 4.`;
    },
    key: 'Q',
    done: (v) => v.world.units.filter((u) => u.owner === v.me && u.role === 'assault').length >= 4,
  },
  {
    title: 'Eine Gruppe bilden',
    text: 'Wähle deine Krieger (Rahmen ziehen oder Doppelklick auf einen) und drücke Strg+1. Mit 1 hast du sie jederzeit wieder.',
    done: (v) => fighters(v, v.groups.get('1') ?? []) >= 3,
  },
  {
    title: 'Das Räuberlager',
    text: 'Im markierten Eck hausen Räuber. Wähle deine Gruppe (1), drücke A und klicke auf das Lager: Angriffsbewegung – sie kämpfen alles nieder, was ihnen begegnet. Zerstöre beide Hütten.',
    key: 'A',
    mark: (v) => v.world.startPositions[1 - v.me] ?? null,
    done: (v) => !v.world.players[1 - v.me].alive,
  },
];

/** Index of the first step not done yet (steps finish in order), or the step count when all are. */
export function firstOpenStep(v: TutorialView, from = 0): number {
  let i = from;
  while (i < TUTORIAL_STEPS.length && TUTORIAL_STEPS[i].done(v)) i++;
  return i;
}
