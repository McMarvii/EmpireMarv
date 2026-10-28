import { AIController } from './ai';
import { World, type GameSettings, type WorldSnapshot } from './world';

/**
 * A world with computer players for every AI slot, able to hand an empire
 * to the computer later. Single player, lockstep peers and replays all
 * start here, so they build exactly the same match.
 */
export function createWorld(settings: Partial<GameSettings>): World {
  const w = new World(settings);
  w.makeAI = (id) => new AIController(id, w.settings.aiDifficulty, w);
  w.settings.players.forEach((p, id) => {
    if (p.isAI) w.controllers.push(w.makeAI!(id));
  });
  return w;
}

/**
 * A saved match, ready to go on: the world as it was, its computer players
 * with their plans. The snapshot must be a fresh decode (it is taken over).
 */
export function restoreWorld(settings: GameSettings, snap: WorldSnapshot): World {
  const w = new World(settings, false);
  w.makeAI = (id) => new AIController(id, w.settings.aiDifficulty, w);
  for (const c of snap.controllers) {
    const ai = w.makeAI(c.playerId);
    ai.loadState?.(c.state);
    w.controllers.push(ai);
  }
  // Players last: the AI constructors set their gather bonus, the save knows better.
  w.loadSnapshot(snap);
  return w;
}
