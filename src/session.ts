import type { Replay } from './replay';
import type { Command, World } from './sim/world';

const NONE: Command[] = [];

/**
 * Where commands come from and when the world may step. Single player
 * applies the local player's commands at once, lockstep sessions hand out
 * each tick's commands once every peer has them, replays read them back.
 */
export interface Session {
  readonly kind: 'local' | 'replay' | 'host' | 'guest';
  /** A command of the local player. */
  submit(cmd: Command): void;
  /** Commands to apply before stepping from `tick`; null while they are still on their way. */
  commandsAt(tick: number): Command[] | null;
  /** After every step: checksums, acknowledgements. */
  stepped(world: World): void;
  /** Ticks this peer lags behind the commands already available (lockstep guests catch up). */
  behind?(tick: number): number;
  close(): void;
}

export class LocalSession implements Session {
  readonly kind = 'local';

  constructor(private apply: (cmd: Command) => void) {}

  submit(cmd: Command): void {
    this.apply(cmd);
  }

  commandsAt(): Command[] {
    return NONE;
  }

  stepped(): void {}

  close(): void {}
}

/** Plays a recorded match back and notices when it runs differently than recorded. */
export class ReplaySession implements Session {
  readonly kind = 'replay';
  /** First tick whose state differs from the recording, if any. */
  diverged: number | null = null;
  private next = 0;
  private nextCheck = 0;
  private nextChat = 0;

  constructor(readonly replay: Replay) {}

  submit(): void {}

  commandsAt(tick: number): Command[] {
    const list = this.replay.commands;
    while (this.next < list.length && list[this.next][0] < tick) this.next++;
    if (this.next >= list.length || list[this.next][0] !== tick) return NONE;
    const out: Command[] = [];
    while (this.next < list.length && list[this.next][0] === tick) out.push(list[this.next++][1]);
    return out;
  }

  stepped(world: World): void {
    const checks = this.replay.checks;
    while (this.nextCheck < checks.length && checks[this.nextCheck][0] < world.tick) this.nextCheck++;
    const check = checks[this.nextCheck];
    if (check && check[0] === world.tick) {
      this.nextCheck++;
      if (this.diverged === null && check[1] !== world.checksum()) this.diverged = world.tick;
    }
  }

  /** Chat lines up to and including `tick` that were not shown yet. */
  chatUntil(tick: number): Array<[number, number, string]> {
    const out: Array<[number, number, string]> = [];
    const chat = this.replay.chat;
    while (this.nextChat < chat.length && chat[this.nextChat][0] <= tick) out.push(chat[this.nextChat++]);
    return out;
  }

  close(): void {}
}
