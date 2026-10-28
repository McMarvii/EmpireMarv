import { describe, expect, it } from 'vitest';
import type { BuildingType } from '../src/data/buildings';
import { createWorld } from '../src/sim/setup';
import type { World } from '../src/sim/world';
import { firstOpenStep, TUTORIAL_SETTINGS, TUTORIAL_STEPS, type TutorialView } from '../src/tutorial';
import { run } from './helpers';

function start(): { w: World; view: TutorialView } {
  const w = createWorld(TUTORIAL_SETTINGS);
  const view: TutorialView = { world: w, me: 0, selection: [], cameraMoved: 0, groups: new Map() };
  return { w, view };
}

const tc = (w: World) => w.buildingsOf(0, 'towncenter')[0];
const citizens = (w: World) => w.units.filter((u) => u.owner === 0 && u.role === 'citizen');

function nearestNode(w: World, kind: 'tree' | 'berries') {
  const t = tc(w);
  return w.resources
    .filter((n) => !n.dead && n.nodeType === kind)
    .sort((a, b) => Math.hypot(a.x - t.x, a.y - t.y) - Math.hypot(b.x - t.x, b.y - t.y))[0];
}

/** Places a building near the town center (or a point) wherever it fits. */
function place(w: World, type: BuildingType, ids: number[], near = { x: tc(w).x, y: tc(w).y }): void {
  for (let r = 4; r < 14; r++) {
    for (let a = 0; a < 24; a++) {
      const tx = Math.round(near.x + Math.cos((a / 24) * Math.PI * 2) * r) - 1;
      const ty = Math.round(near.y + Math.sin((a / 24) * Math.PI * 2) * r) - 1;
      if (w.canPlace(0, type, tx, ty)) {
        w.issue({ type: 'place', player: 0, ids, building: type, tx, ty });
        return;
      }
    }
  }
  throw new Error(`no room for ${type}`);
}

/**
 * Runs until a step is done (or a time limit) and returns the step that is
 * open then – counted from there on, as the tutorial panel does, so losses
 * in the battle do not reopen the training step.
 */
function until(w: World, view: TutorialView, step: number, seconds: number): number {
  for (let i = 0; i < seconds * 20 && !TUTORIAL_STEPS[step].done(view) && !w.over; i++) w.step();
  return firstOpenStep(view, step);
}

describe('tutorial', () => {
  it('sets up a fair practice map with the robbers far away', () => {
    const { w } = start();
    expect(w.buildingsOf(1, 'towncenter')).toHaveLength(0);
    expect(w.buildingsOf(1, 'house')).toHaveLength(2);
    expect(w.unitsOf(1).length).toBe(4);
    const t = tc(w);
    expect(Math.hypot(nearestNode(w, 'tree').x - t.x, nearestNode(w, 'tree').y - t.y)).toBeLessThan(12);
    expect(Math.hypot(nearestNode(w, 'berries').x - t.x, nearestNode(w, 'berries').y - t.y)).toBeLessThan(12);
    const camp = w.startPositions[1];
    expect(Math.hypot(camp.x - t.x, camp.y - t.y)).toBeGreaterThan(30);
    expect(w.map.sameLand(t.x, t.y, camp.x, camp.y)).toBe(true);
    expect(TUTORIAL_STEPS.length).toBe(14);
  });

  it('can be played through step by step, each check opening the next', () => {
    const { w, view } = start();
    expect(firstOpenStep(view)).toBe(0);
    view.cameraMoved = 4;
    expect(firstOpenStep(view)).toBe(1);
    const cs = citizens(w);
    view.selection = [cs[0].id];
    expect(firstOpenStep(view)).toBe(2);

    const tree = nearestNode(w, 'tree');
    w.issue({ type: 'gather', player: 0, ids: [cs[0].id, cs[1].id], targetId: tree.id });
    expect(firstOpenStep(view)).toBe(3);
    const bush = nearestNode(w, 'berries');
    w.issue({ type: 'gather', player: 0, ids: [cs[2].id, cs[3].id], targetId: bush.id });
    expect(firstOpenStep(view)).toBe(4);

    w.issue({ type: 'train', player: 0, buildingId: tc(w).id, role: 'citizen' });
    expect(firstOpenStep(view)).toBe(5);

    place(w, 'house', [cs[4].id]);
    expect(until(w, view, 5, 60)).toBe(6);
    place(w, 'storehouse', [cs[4].id], tree);
    expect(until(w, view, 6, 60)).toBe(7);
    w.issue({ type: 'research', player: 0, buildingId: tc(w).id, tech: 'werkzeuge-0' });
    expect(until(w, view, 7, 60)).toBe(8);
    // The second hut and the second tech for the advance.
    place(w, 'house', [cs[4].id]);
    w.issue({ type: 'research', player: 0, buildingId: tc(w).id, tech: 'tragen-0' });
    expect(until(w, view, 8, 90)).toBe(9);
    w.issue({ type: 'advance', player: 0, buildingId: tc(w).id });
    expect(until(w, view, 9, 90)).toBe(10);
    expect(w.players[0].epoch).toBe(1);

    place(w, 'barracks', citizens(w).slice(4).map((u) => u.id));
    expect(until(w, view, 10, 90)).toBe(11);
    const barracks = w.buildingsOf(0, 'barracks')[0];
    w.issue({ type: 'train', player: 0, buildingId: barracks.id, role: 'assault', count: 5 });
    expect(until(w, view, 11, 120)).toBe(12);
    const army = w.units.filter((u) => u.owner === 0 && (u.role === 'assault' || u.role === 'scout')).map((u) => u.id);
    view.groups.set('1', army);
    expect(firstOpenStep(view)).toBe(13);

    // The battle: four axe fighters (and the scout) burn the camp.
    run(w, 4);
    const camp = w.startPositions[1];
    w.issue({ type: 'move', player: 0, ids: army, x: camp.x, y: camp.y, attackMove: true });
    expect(until(w, view, 13, 240)).toBe(14);
    expect(w.over).toBe(true);
    expect(w.winnerTeam).toBe(0);
  }, 60000);

  it('plays out the same way twice', () => {
    const play = () => {
      const { w } = start();
      const cs = citizens(w);
      w.issue({ type: 'gather', player: 0, ids: [cs[0].id, cs[1].id], targetId: nearestNode(w, 'tree').id });
      w.issue({ type: 'train', player: 0, buildingId: tc(w).id, role: 'citizen' });
      run(w, 60);
      return w.checksum();
    };
    expect(play()).toBe(play());
  });
});
