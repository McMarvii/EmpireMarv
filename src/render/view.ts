import type { Entity, Unit } from '../sim/entities';
import type { World } from '../sim/world';

/**
 * Whose eyes the screen shows: the local player through their fog of war,
 * or, when watching a replay, any player or everything at once.
 */
export class View {
  /** Replays only: ignore the fog. */
  revealAll = false;
  private full: Uint8Array | null = null;

  constructor(
    private world: World,
    public me: number,
  ) {}

  /** Fog per tile: 0 unexplored, 1 explored, 2 in sight. */
  vis(): Uint8Array {
    if (!this.revealAll) return this.world.players[this.me].vis;
    if (!this.full) this.full = new Uint8Array(this.world.map.width * this.world.map.height).fill(2);
    return this.full;
  }

  /** Buildings and deposits: seen (and remembered) at some point. */
  sees(e: Entity): boolean {
    return this.revealAll || this.world.isVisibleTo(this.me, e);
  }

  /** Units: only while in sight. */
  seesUnit(u: Unit): boolean {
    return this.revealAll || u.owner === this.me || this.world.inSight(this.me, u);
  }
}
