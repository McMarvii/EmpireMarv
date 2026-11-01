/** Shown in the menu; kept equal to package.json by a test. */
export const GAME_VERSION = '0.11.0';

/**
 * The simulation's version, stored in saves and replays: a save only plays
 * on with the same one. It is raised only when the simulation computes
 * differently, not for graphics or controls (0.9 changed only the drawing;
 * 0.10 finds other ways, so saves and replays of 0.8 and 0.9 end there;
 * 0.10.1 closes the corner between two diagonal wall segments and spreads
 * woodcutters over a grove; 0.11 adds wild game, one queue for units and
 * research, re-equipping, 5000 per mine and marching at the slowest pace).
 */
export const SIM_VERSION = '0.11.0';
