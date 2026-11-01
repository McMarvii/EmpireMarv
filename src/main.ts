import './styles.css';
import { audio } from './audio/engine';
import { Game, type GameOptions } from './game';
import { applyUiScale } from './render/graphics';
import type { GuestSession, HostSession } from './net/session';
import { TUTORIAL_SETTINGS } from './tutorial';
import { hostLobby, joinGame, type LobbyExit } from './ui/lobby';
import { showMenu } from './ui/menu';

const root = document.querySelector<HTMLElement>('#app')!;
document.querySelector('#boot-hint')?.remove();

// Larger windows get a larger interface (1440p, 4K); it follows the window when it is resized.
applyUiScale();
window.addEventListener('resize', () => applyUiScale());

// Browsers only start audio inside a user gesture; every click or key press
// unlocks it (again, if the system suspended it in between).
for (const type of ['pointerdown', 'keydown']) window.addEventListener(type, () => audio.unlock(), { capture: true });

/** The match on screen, if any. */
let current: Game | null = null;

function startGame(options: GameOptions): void {
  const game = new Game(root, options, startMenu);
  current = game;
  game.start();
  // Handy for debugging in the browser console.
  (window as unknown as { game: Game }).game = game;
}

const lobbyExit: LobbyExit = {
  menu: () => startMenu(),
  play: (session: HostSession | GuestSession) => {
    const guest = session.kind === 'guest' ? session : null;
    const upTo = guest ? guest.upTo : -1;
    startGame({
      settings: session.settings!,
      me: session.me,
      net: session,
      startAt: upTo > 0 ? upTo + 1 : undefined,
      rejoin: guest ? () => join(guest.invite) : undefined,
    });
  },
};

function join(invite: string): void {
  current = null;
  joinGame(root, invite, lobbyExit);
}

function startMenu(): void {
  current = null;
  // An invitation in the address bar is used up once the player is back in the menu.
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  showMenu(root, {
    single: (settings) => startGame({ settings }),
    host: (name) => hostLobby(root, name, lobbyExit),
    join: (invite) => join(invite),
    replay: (replay) => startGame({ settings: replay.settings, replay }),
    load: (save) => startGame({ settings: save.settings, save }),
    tutorial: () => startGame({ settings: TUTORIAL_SETTINGS, tutorial: true }),
  });
}

const INVITE = /^#(join|code)=/;

// An invitation pasted into the address bar of an open tab changes only the hash: the page does
// not reload, so the join has to start here.
window.addEventListener('hashchange', () => {
  if (!INVITE.test(location.hash)) return;
  // Seeking in a replay swaps the game object; the one on screen is always window.game.
  const game = current ? (window as unknown as { game: Game }).game : null;
  if (game && !game.netUi?.isLost) {
    game.hud.message('info', 'Einladung erkannt – verlasse zuerst das laufende Spiel (Esc → Spiel verlassen), dann öffne den Link noch einmal.');
    return;
  }
  game?.destroy();
  join(location.hash);
});

// Opened from an invitation link: straight to joining.
if (INVITE.test(location.hash)) join(location.hash);
else startMenu();
