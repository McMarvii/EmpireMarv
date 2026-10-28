import { epochStyle, type EraStyle } from '../data/epochs';
import type { Game } from '../game';
import type { Entity } from '../sim/entities';
import type { GameEvent, SoundCue } from '../sim/world';
import { audio, type AudioEngine } from './engine';
import {
  abilitySound,
  ackSound,
  blastSound,
  calamitySound,
  collapseSound,
  convertSound,
  deathSound,
  healSound,
  impactSound,
  meleeSound,
  shotSound,
  uiSound,
  workSound,
  type Ack,
  type UiSound,
} from './sounds';

/**
 * Loudness and stereo position of a point on screen: full inside the view
 * (slightly softer towards the edges), fading to silence 60 % of a screen
 * beyond it.
 */
export function spatial(sx: number, sy: number, viewW: number, viewH: number): { gain: number; pan: number } {
  const dx = (sx - viewW / 2) / (viewW / 2);
  const dy = (sy - viewH / 2) / (viewH / 2);
  const d = Math.max(Math.abs(dx), Math.abs(dy));
  const gain = d <= 1 ? 1 - 0.25 * d : Math.max(0, 0.75 * (1 - (d - 1) / 0.6));
  return { gain, pan: Math.max(-1, Math.min(1, dx)) * 0.6 };
}

/** Refuses a key that sounded less than `gapMs` ago, so masses of units don't drone. */
export class Throttle {
  private last = new Map<string, number>();

  allow(key: string, now: number, gapMs: number): boolean {
    const t = this.last.get(key);
    if (t !== undefined && now - t < gapMs) return false;
    this.last.set(key, now);
    return true;
  }
}

/**
 * How much fighting the player can see. Rises with every visible combat
 * cue, decays with a time constant of 8 s and switches the music with some
 * hysteresis, so it does not flip back and forth in a lull.
 */
export class Heat {
  static readonly ENTER = 18;
  static readonly LEAVE = 8;
  value = 0;
  battle = false;

  add(amount: number): void {
    this.value += amount;
    if (this.value > Heat.ENTER) this.battle = true;
  }

  decay(dt: number): void {
    this.value *= Math.exp(-dt / 8);
    if (this.battle && this.value < Heat.LEAVE) this.battle = false;
  }
}

type CueKind = SoundCue['kind'];
/** Shortest gap between two cues of one kind in ms, their mix level and rough length. */
const CUE_GAP: Record<CueKind, number> = {
  shot: 35,
  melee: 45,
  impact: 60,
  blast: 70,
  death: 80,
  collapse: 250,
  work: 70,
  ability: 150,
  calamity: 400,
  convert: 300,
  heal: 250,
};
const CUE_GAIN: Record<CueKind, number> = {
  shot: 0.8,
  melee: 0.8,
  impact: 0.6,
  blast: 1,
  death: 0.8,
  collapse: 1,
  work: 0.45,
  ability: 1,
  calamity: 1.1,
  convert: 0.9,
  heal: 0.6,
};
const CUE_LEN: Record<CueKind, number> = {
  shot: 0.6,
  melee: 0.35,
  impact: 0.2,
  blast: 1.2,
  death: 0.5,
  collapse: 1.8,
  work: 0.15,
  ability: 0.9,
  calamity: 2.8,
  convert: 1.5,
  heal: 0.5,
};
/** Heat per visible cue; work and healing are not fighting. */
const CUE_HEAT: Record<CueKind, number> = {
  shot: 1,
  melee: 1,
  impact: 0,
  blast: 1.5,
  death: 1.5,
  collapse: 2,
  work: 0,
  ability: 2,
  calamity: 4,
  convert: 1,
  heal: 0,
};

/**
 * Turns one match into sound: world cues become positioned effects, game
 * events become jingles and alarms, and the music follows the player's era
 * and the fighting on screen.
 */
export class GameAudio {
  readonly heat = new Heat();
  private throttle = new Throttle();
  private epoch: number;
  private over = false;

  constructor(
    private game: Game,
    private engine: AudioEngine = audio,
  ) {
    this.epoch = game.world.players[game.me].epoch;
  }

  get style(): EraStyle {
    return epochStyle(this.game.world.players[this.game.me].epoch);
  }

  /** Call every frame before the HUD drains the world's events. */
  update(dt: number): void {
    const { world, me } = this.game;
    const now = performance.now();
    for (const ev of world.events) if (ev.player === me) this.onEvent(ev);
    for (const c of world.cues) this.onCue(c, now);
    world.cues.length = 0;
    if (!this.game.paused) this.heat.decay(dt);

    const epoch = world.players[me].epoch;
    if (epoch > this.epoch) {
      this.ui('epoch');
      this.engine.duck(2.5);
    }
    this.epoch = epoch;
    if (!this.over) this.engine.setMusic(this.style, this.heat.battle);
    this.engine.updateMusic();
  }

  ui(id: UiSound, gapMs = 80): void {
    if (!this.throttle.allow(`ui:${id}`, performance.now(), gapMs)) return;
    const style = this.style;
    this.engine.play('ui', (o) => uiSound(o, id, style), { length: 1 });
  }

  /** A unit (or building) answers when selected or given an order. */
  ack(kind: Ack, entities: Entity[]): void {
    const me = this.game.me;
    const unit = entities.find((e) => e.kind === 'unit' && e.owner === me);
    const building = entities.find((e) => e.kind === 'building' && e.owner === me);
    if (!unit && !building) return;
    if (!this.throttle.allow('ack', performance.now(), 120)) return;
    const look = unit && unit.kind === 'unit' ? unit.stats.look : undefined;
    const style = this.style;
    const r = Math.random();
    this.engine.play('ui', (o) => ackSound(o, kind, look, style, r), { gain: 0.8, length: 0.5 });
  }

  setPaused(paused: boolean): void {
    this.engine.setPaused(paused);
  }

  stop(): void {
    this.engine.stopMusic();
  }

  private onEvent(ev: GameEvent): void {
    switch (ev.type) {
      case 'built':
        this.ui('built', 1500);
        break;
      case 'trained':
        this.ui('trained', 600);
        break;
      case 'tech':
        this.ui('tech', 500);
        break;
      case 'wonder':
        this.ui('wonder', 1500);
        break;
      case 'attack':
        this.heat.add(Heat.ENTER);
        this.ui('alarm', 4000);
        break;
      case 'gameover': {
        const { world, me } = this.game;
        this.over = true;
        this.engine.stopMusic();
        this.ui(world.winnerTeam === world.players[me].team ? 'victory' : 'defeat', 0);
        break;
      }
      default:
        // Warnings sound through the HUD message, epochs through the epoch watch.
        break;
    }
  }

  private onCue(c: SoundCue, now: number): void {
    const { world, camera, me } = this.game;
    const tx = Math.floor(c.x);
    const ty = Math.floor(c.y);
    // Nothing is heard from inside the fog of war.
    if (!world.map.inBounds(tx, ty) || world.players[me].vis[world.map.idx(tx, ty)] !== 2) return;
    this.heat.add(CUE_HEAT[c.kind]);
    if (!this.engine.ready) return;
    const [sx, sy] = camera.project(c.x, c.y);
    const { gain, pan } = spatial(sx, sy, camera.viewW, camera.viewH);
    // Work noises only come from what is on screen; fights carry a bit further.
    if (gain <= 0.02 || (c.kind === 'work' && gain < 0.6)) return;
    const key = c.kind === 'shot' ? `shot:${c.projectile}` : c.kind === 'work' ? `work:${c.work}` : c.kind;
    if (!this.throttle.allow(key, now, CUE_GAP[c.kind])) return;
    const r = Math.random();
    const epoch = c.epoch ?? world.players[me].epoch;
    const zoom = 0.7 + 0.3 * Math.min(1, camera.zoom);
    this.engine.play(
      'sfx',
      (o) => {
        switch (c.kind) {
          case 'shot':
            return shotSound(o, c.projectile ?? 'arrow', c.look, epoch, r);
          case 'melee':
            return meleeSound(o, c.look, epoch, r);
          case 'impact':
            return impactSound(o, c.projectile ?? 'arrow', (c.size ?? 0) > 0, r);
          case 'blast':
            return blastSound(o, c.projectile ?? 'shell', c.size ?? 1, r);
          case 'death':
            return deathSound(o, c.look, r);
          case 'collapse':
            return collapseSound(o, c.size ?? 2, r);
          case 'work':
            return workSound(o, c.work ?? 'build', epochStyle(epoch), r);
          case 'ability':
            return abilitySound(o, c.ability ?? 'rally', epochStyle(epoch), r);
          case 'calamity':
            return calamitySound(o, c.ability ?? 'quake', r);
          case 'convert':
            return convertSound(o, epochStyle(epoch));
          case 'heal':
            return healSound(o, r);
        }
      },
      { gain: gain * CUE_GAIN[c.kind] * zoom, pan, length: CUE_LEN[c.kind] },
    );
  }
}
