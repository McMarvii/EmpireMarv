import { AIController } from './ai';
import { World, type GameSettings } from './world';

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
