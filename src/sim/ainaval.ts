import { BUILDING_DEFS } from '../data/buildings';
import type { Cost } from '../data/resources';
import { bestTier, isNaval, TRANSPORT_CAPACITY, unitStats, type NavalRole } from '../data/units';
import type { AISnapshot } from './ai';
import type { Building, Unit } from './entities';
import { hypot } from './fmath';
import type { Point } from './pathfinding';
import { TICK_RATE, type World } from './world';

/** What the naval planner borrows from the computer player it works for. */
export interface NavalHost {
  readonly playerId: number;
  pickWorker(s: AISnapshot, near: Point): Unit | null;
  spendable(w: World, s: AISnapshot, cost: Cost): boolean;
  /** Troops that stay home after all: back into the home army. */
  release(ids: number[]): void;
}

/** An army on its way across the water. */
interface Landing {
  /** The enemy building the troops are sent against. */
  target: Point;
  troops: number[];
  ships: number[];
  phase: 'muster' | 'board' | 'sail';
  since: number;
  /** Where the troops wait for the ships, next to the harbour. */
  muster: Point;
  /** Last time the stragglers were told again to go aboard (or the ships to unload). */
  nudged: number;
}

/** The planner's memory, for saved games (sea sizes are worked out again). */
interface NavalState {
  nextSiteSearch: number;
  nextFleetOrders: number;
  landing: Landing | null;
  overseas: boolean | null;
}

/** Seas smaller than this are ponds: no harbour there. */
const MIN_SEA = 120;
const SEARCH_RADIUS = 28;

/**
 * The computer player at sea: a harbour where the water is worth it,
 * fishing boats on the nearby grounds, a fleet against enemy ships and
 * coasts, and landings when the enemy lives on another island.
 */
export class NavalPlanner {
  private seaSizes: Map<number, number> | null = null;
  private nextSiteSearch = 0;
  private nextFleetOrders = 0;
  private landing: Landing | null = null;
  /** Whether an enemy can only be reached over water (decided once per match). */
  private overseas: boolean | null = null;

  constructor(private readonly host: NavalHost) {}

  saveState(): NavalState {
    return { nextSiteSearch: this.nextSiteSearch, nextFleetOrders: this.nextFleetOrders, landing: this.landing, overseas: this.overseas };
  }

  loadState(state: unknown): void {
    const s = state as NavalState;
    this.nextSiteSearch = s.nextSiteSearch;
    this.nextFleetOrders = s.nextFleetOrders;
    this.landing = s.landing;
    this.overseas = s.overseas;
  }

  update(w: World, s: AISnapshot): void {
    if (this.overseas === null) this.overseas = this.findOverseas(w, s);
    const dock = this.homeDock(s);
    if (!dock) {
      this.harbour(w, s);
      return;
    }
    if (!dock.built) return;
    this.train(w, s, dock);
    this.fishing(w, s, dock);
    if (this.landing) this.updateLanding(w, s, dock);
    if (w.tick >= this.nextFleetOrders) {
      this.nextFleetOrders = w.tick + 4 * TICK_RATE;
      this.fleet(w, s, dock);
    }
  }

  /** A wave can sail: harbour, a free transport and no landing under way. */
  canLaunch(s: AISnapshot): boolean {
    const dock = this.homeDock(s);
    return !!dock && dock.built && !this.landing && this.freeTransports(s).length > 0;
  }

  /** Sends troops to the harbour to be shipped over to an enemy building. */
  launch(w: World, s: AISnapshot, troops: Unit[], target: Point): void {
    const dock = this.homeDock(s)!;
    const muster = w.findSpawnPoint(dock, s.base, 0, false) ?? { x: s.base.x, y: s.base.y };
    const ships = this.freeTransports(s).map((u) => u.id);
    this.landing = { target: { x: target.x, y: target.y }, troops: troops.map((u) => u.id), ships, phase: 'muster', since: w.tick, muster, nudged: w.tick };
    w.issue({ type: 'move', player: this.host.playerId, ids: this.landing.troops, x: muster.x, y: muster.y, attackMove: false });
  }

  // ------------------------------------------------------------- harbour

  private homeDock(s: AISnapshot): Building | null {
    let best: Building | null = null;
    for (const b of s.buildings) {
      if (b.type !== 'dock') continue;
      if (!best || (b.built && !best.built) || (b.built === best.built && hypot(b.x - s.base.x, b.y - s.base.y) < hypot(best.x - s.base.x, best.y - s.base.y))) best = b;
    }
    return best;
  }

  private seaOf(w: World, dock: Building): number {
    return w.map.waterRegion[w.map.idx(dock.tx + 1, dock.ty + 1)];
  }

  private seaSize(w: World, region: number): number {
    if (!this.seaSizes) {
      this.seaSizes = new Map();
      for (let i = 0; i < w.map.waterRegion.length; i++) {
        const r = w.map.waterRegion[i];
        if (r) this.seaSizes.set(r, (this.seaSizes.get(r) ?? 0) + 1);
      }
    }
    return this.seaSizes.get(region) ?? 0;
  }

  /** Some enemy base lies on other land than ours. */
  private findOverseas(w: World, s: AISnapshot): boolean {
    return w.players.some((_, i) => w.areEnemies(this.host.playerId, i) && !w.map.sameLand(s.base.x, s.base.y, w.startPositions[i].x, w.startPositions[i].y));
  }

  /** Fish within reach of the base, in a proper sea. */
  private fishNearby(w: World, s: AISnapshot): boolean {
    return w.resources.some(
      (n) => !n.dead && n.nodeType === 'fish' && hypot(n.x - s.base.x, n.y - s.base.y) < SEARCH_RADIUS && this.seaSize(w, w.map.waterRegion[w.map.idx(n.tx, n.ty)]) >= MIN_SEA,
    );
  }

  /** Builds a harbour when the enemy lies overseas or there is fish to catch. */
  private harbour(w: World, s: AISnapshot): void {
    if (w.tick < this.nextSiteSearch) return;
    this.nextSiteSearch = w.tick + 20 * TICK_RATE;
    const wanted = this.overseas ? s.citizens.length >= 6 : s.citizens.length >= 10 && this.fishNearby(w, s);
    if (!wanted || !this.host.spendable(w, s, BUILDING_DEFS.dock.cost)) return;
    const site = this.bestSite(w, s);
    if (!site) return;
    const builder = this.host.pickWorker(s, site);
    if (!builder) return;
    w.issue({ type: 'place', player: this.host.playerId, ids: [builder.id], building: 'dock', tx: site.x, ty: site.y });
  }

  /** The nearest shore site on a proper sea, by rings around the base. */
  private bestSite(w: World, s: AISnapshot): Point | null {
    const { map } = w;
    const cx = Math.floor(s.base.x) - 1;
    const cy = Math.floor(s.base.y) - 1;
    for (let r = 3; r <= SEARCH_RADIUS; r++) {
      let best: Point | null = null;
      let bestD = Infinity;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const tx = cx + dx;
          const ty = cy + dy;
          if (!map.shoreSite(tx, ty, 3) || this.seaSize(w, map.waterRegion[map.idx(tx + 1, ty + 1)]) < MIN_SEA) continue;
          // The builders must be able to walk there.
          if (!this.besideOwnLand(w, s, tx, ty) || !w.canPlace(this.host.playerId, 'dock', tx, ty)) continue;
          const d = hypot(dx, dy);
          if (d < bestD) {
            bestD = d;
            best = { x: tx, y: ty };
          }
        }
      }
      if (best) return best;
    }
    return null;
  }

  private besideOwnLand(w: World, s: AISnapshot, tx: number, ty: number): boolean {
    for (let y = ty - 1; y <= ty + 3; y++) {
      for (let x = tx - 1; x <= tx + 3; x++) {
        if (w.map.inBounds(x, y) && w.map.sameLand(x + 0.5, y + 0.5, s.base.x, s.base.y)) return true;
      }
    }
    return false;
  }

  // ------------------------------------------------------------- ships

  private ships(s: AISnapshot, role: NavalRole): Unit[] {
    return s.ships.filter((u) => u.role === role);
  }

  private freeTransports(s: AISnapshot): Unit[] {
    return this.ships(s, 'transport').filter((u) => u.cargo.length === 0 && u.order.kind !== 'unload');
  }

  /** Keeps the harbour busy: fishing boats first, then the fleet, transports when the enemy lives overseas. */
  private train(w: World, s: AISnapshot, dock: Building): void {
    if (dock.queue.length >= 2) return;
    const { player } = s;
    const sea = this.seaOf(w, dock);
    const queued = (role: NavalRole) => dock.queue.filter((q) => q.role === role).length;
    const have = (role: NavalRole) => this.ships(s, role).length + queued(role);
    let fish = 0;
    for (const n of w.resources) {
      if (!n.dead && n.nodeType === 'fish' && w.map.waterRegion[w.map.idx(n.tx, n.ty)] === sea && hypot(n.x - dock.x, n.y - dock.y) < 30) fish++;
    }
    const enemyShips = w.units.some((e) => isNaval(e.role) && e.role !== 'fisher' && w.areEnemies(this.host.playerId, e.owner) && w.inSight(this.host.playerId, e));
    const overseas = this.overseas === true;
    const wants: Array<[NavalRole, number]> = [
      ['transport', overseas && this.landing && this.landing.ships.length === 0 ? 1 : 0],
      ['fisher', Math.min(fish, player.epoch < 2 ? 3 : 6)],
      ['warship', player.epoch < 1 ? 0 : overseas ? Math.min(6, 2 + Math.floor(player.epoch / 3)) : enemyShips ? 3 : s.army.length >= 6 ? 1 : 0],
      ['transport', overseas ? (player.epoch >= 6 ? 3 : 2) : 0],
      ['bombard', player.epoch >= 5 && (overseas || enemyShips) ? (player.epoch >= 10 ? 3 : 2) : 0],
    ];
    for (const [role, want] of wants) {
      if (have(role) >= want) continue;
      const tier = bestTier(role, player.epoch);
      if (tier < 0) continue;
      if (!this.host.spendable(w, s, unitStats(role, tier).cost)) continue;
      w.issue({ type: 'train', player: this.host.playerId, buildingId: dock.id, role });
      return;
    }
  }

  private fishing(w: World, s: AISnapshot, dock: Building): void {
    for (const boat of this.ships(s, 'fisher')) {
      if (boat.order.kind !== 'idle') continue;
      const n = w.nearestResource('food', dock.x, dock.y, 40, this.host.playerId, 0, true);
      if (n) w.issue({ type: 'gather', player: this.host.playerId, ids: [boat.id], targetId: n.id });
    }
  }

  /** Warships meet enemy ships and guard landings, bombard ships shell what stands near our sea. */
  private fleet(w: World, s: AISnapshot, dock: Building): void {
    const id = this.host.playerId;
    const warships = this.ships(s, 'warship');
    const bombards = this.ships(s, 'bombard');
    let threat: Unit | null = null;
    let threatD = Infinity;
    for (const e of w.units) {
      if (e.dead || !isNaval(e.role) || !w.areEnemies(id, e.owner) || !w.inSight(id, e)) continue;
      const d = hypot(e.x - dock.x, e.y - dock.y);
      if (d < threatD) {
        threatD = d;
        threat = e;
      }
    }
    const busy = (u: Unit) => u.order.kind === 'attack';
    if (threat && threatD < 40) {
      const ids = warships.filter((u) => !busy(u)).map((u) => u.id);
      if (ids.length) w.issue({ type: 'move', player: id, ids, x: threat.x, y: threat.y, attackMove: true });
    } else if (this.landing && this.landing.phase === 'sail' && warships.length) {
      const ship = warships[0];
      const spot = w.shoreSpot(this.landing.target.x, this.landing.target.y, ship);
      const ids = warships.filter((u) => !busy(u)).map((u) => u.id);
      if (spot && ids.length) w.issue({ type: 'move', player: id, ids, x: spot.x, y: spot.y, attackMove: true });
    } else {
      // Nothing to do: back to the harbour.
      const far = warships.filter((u) => u.order.kind === 'idle' && hypot(u.x - dock.x, u.y - dock.y) > 14).map((u) => u.id);
      if (far.length) w.issue({ type: 'move', player: id, ids: far, x: dock.x, y: dock.y, attackMove: true });
    }
    const idle = bombards.filter((u) => u.order.kind === 'idle');
    if (idle.length) {
      const spot = this.coastalTarget(w, idle[0], idle[0].stats.range);
      if (spot) w.issue({ type: 'move', player: id, ids: idle.map((u) => u.id), x: spot.x, y: spot.y, attackMove: true });
    }
  }

  /** The water spot from which a ship reaches the nearest enemy building. */
  private coastalTarget(w: World, ship: Unit, range: number): Point | null {
    let best: Point | null = null;
    let bestD = Infinity;
    for (const b of w.buildings) {
      if (b.dead || !w.areEnemies(this.host.playerId, b.owner)) continue;
      const spot = w.shoreSpot(b.x, b.y, ship);
      if (!spot || hypot(spot.x - b.x, spot.y - b.y) - b.size / 2 > range - 0.5) continue;
      const d = hypot(spot.x - ship.x, spot.y - ship.y) - (b.type === 'towncenter' ? 8 : 0) + (b.type === 'wall' || b.type === 'gate' ? 30 : 0);
      if (d < bestD) {
        bestD = d;
        best = spot;
      }
    }
    return best;
  }

  // ------------------------------------------------------------- landings

  /** Muster at the harbour, go aboard, sail over, put the army ashore by the target. */
  private updateLanding(w: World, s: AISnapshot, dock: Building): void {
    const L = this.landing!;
    const id = this.host.playerId;
    const alive = (uid: number) => {
      const e = w.entities.get(uid);
      return !!e && !e.dead && e.kind === 'unit';
    };
    L.troops = L.troops.filter(alive);
    L.ships = L.ships.filter(alive);
    if (L.troops.length === 0) {
      this.finishLanding(w, dock);
      return;
    }
    const troops = L.troops.map((uid) => w.entities.get(uid) as Unit);
    const ships = L.ships.map((uid) => w.entities.get(uid) as Unit);
    const age = w.tick - L.since;
    if (L.phase !== 'sail' && ships.length === 0) {
      // The transports were lost before setting sail: wait for new ones, but not forever.
      const fresh = this.freeTransports(s);
      if (fresh.length) L.ships = fresh.map((u) => u.id);
      else if (age > 90 * TICK_RATE) return this.abort(w, troops, dock);
      return;
    }
    switch (L.phase) {
      case 'muster': {
        const ready = troops.filter((u) => !u.inside && hypot(u.x - L.muster.x, u.y - L.muster.y) < 7).length;
        if (ready >= troops.length * 0.7 || age > 45 * TICK_RATE) {
          this.boardAll(w, troops, ships);
          L.phase = 'board';
          L.since = L.nudged = w.tick;
        }
        break;
      }
      case 'board': {
        const aboard = troops.filter((u) => u.inside).length;
        const room = ships.reduce((n, sh) => n + TRANSPORT_CAPACITY - sh.cargo.length, 0);
        if ((aboard === troops.length || room === 0 || age > 40 * TICK_RATE) && aboard > 0) {
          for (const sh of ships) if (sh.cargo.length) w.issue({ type: 'unload', player: id, ids: [sh.id], x: L.target.x, y: L.target.y });
          // Whoever missed the boat stays home.
          const left = troops.filter((u) => !u.inside).map((u) => u.id);
          if (left.length) this.host.release(left);
          L.troops = L.troops.filter((uid) => !left.includes(uid));
          L.phase = 'sail';
          L.since = L.nudged = w.tick;
        } else if (age > 60 * TICK_RATE) {
          this.abort(w, troops, dock);
        } else if (w.tick - L.nudged > 10 * TICK_RATE) {
          L.nudged = w.tick;
          this.boardAll(
            w,
            troops.filter((u) => !u.inside && u.order.kind !== 'board'),
            ships,
          );
        }
        break;
      }
      case 'sail': {
        const loaded = ships.filter((sh) => sh.cargo.length > 0);
        if (loaded.length === 0) {
          this.finishLanding(w, dock);
        } else if (age > 150 * TICK_RATE) {
          // Could not land: bring them home again.
          for (const sh of loaded) w.issue({ type: 'unload', player: id, ids: [sh.id], x: L.muster.x, y: L.muster.y });
          this.host.release(L.troops);
          this.landing = null;
        } else if (w.tick - L.nudged > 15 * TICK_RATE) {
          L.nudged = w.tick;
          const stuck = loaded.filter((sh) => sh.order.kind === 'idle').map((sh) => sh.id);
          if (stuck.length) w.issue({ type: 'unload', player: id, ids: stuck, x: L.target.x, y: L.target.y });
        }
        break;
      }
    }
  }

  /** Shares the troops out over the ships, as many as fit. */
  private boardAll(w: World, troops: Unit[], ships: Unit[]): void {
    let i = 0;
    for (const sh of ships) {
      const room = TRANSPORT_CAPACITY - sh.cargo.length - w.units.filter((u) => u.order.kind === 'board' && u.order.targetId === sh.id).length;
      const chunk = troops.slice(i, i + Math.max(0, room));
      i += chunk.length;
      if (chunk.length) w.issue({ type: 'board', player: this.host.playerId, ids: chunk.map((u) => u.id), targetId: sh.id });
    }
  }

  private abort(w: World, troops: Unit[], dock: Building): void {
    const L = this.landing!;
    for (const sh of L.ships) {
      const ship = w.get(sh);
      if (ship && ship.kind === 'unit' && ship.cargo.length) w.issue({ type: 'unload', player: this.host.playerId, ids: [sh], x: L.muster.x, y: L.muster.y });
    }
    this.host.release(troops.map((u) => u.id));
    this.finishLanding(w, dock);
  }

  /** Done (or given up): the transports go back to the harbour for the next wave. */
  private finishLanding(w: World, dock: Building): void {
    const L = this.landing!;
    const ids = L.ships.filter((uid) => {
      const e = w.get(uid);
      return e && e.kind === 'unit' && e.cargo.length === 0;
    });
    if (ids.length) w.issue({ type: 'move', player: this.host.playerId, ids, x: dock.x, y: dock.y, attackMove: false });
    this.landing = null;
  }
}
