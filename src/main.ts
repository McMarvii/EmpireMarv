import './styles.css';
import { audio } from './audio/engine';
import { Game, type GameOptions } from './game';
import type { GuestSession, HostSession } from './net/session';
import { hostLobby, joinGame, type LobbyExit } from './ui/lobby';
import { showMenu } from './ui/menu';

const root = document.querySelector<HTMLElement>('#app')!;
document.querySelector('#boot-hint')?.remove();

// Browsers only start audio inside a user gesture; every click or key press
// unlocks it (again, if the system suspended it in between).
for (const type of ['pointerdown', 'keydown']) window.addEventListener(type, () => audio.unlock(), { capture: true });

function startGame(options: GameOptions): void {
  const game = new Game(root, options, startMenu);
  game.start();
  // Handy for debugging in the browser console.
  (window as unknown as { game: Game }).game = game;
}

const lobbyExit: LobbyExit = {
  menu: () => startMenu(),
  play: (session: HostSession | GuestSession) => {
    const upTo = session.kind === 'guest' ? session.upTo : -1;
    startGame({ settings: session.settings!, me: session.me, net: session, startAt: upTo > 0 ? upTo + 1 : undefined });
  },
};

function startMenu(): void {
  // An invitation in the address bar is used up once the player is back in the menu.
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  showMenu(root, {
    single: (settings) => startGame({ settings }),
    host: (name) => hostLobby(root, name, lobbyExit),
    join: (invite) => joinGame(root, invite, lobbyExit),
    replay: (replay) => startGame({ settings: replay.settings, replay }),
  });
}

// Opened from an invitation link: straight to joining.
if (/^#(join|code)=/.test(location.hash)) joinGame(root, location.hash, lobbyExit);
else startMenu();
