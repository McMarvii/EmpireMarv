import './styles.css';
import { audio } from './audio/engine';
import { Game } from './game';
import { showMenu } from './ui/menu';

const root = document.querySelector<HTMLElement>('#app')!;
document.querySelector('#boot-hint')?.remove();

// Browsers only start audio inside a user gesture; every click or key press
// unlocks it (again, if the system suspended it in between).
for (const type of ['pointerdown', 'keydown']) window.addEventListener(type, () => audio.unlock(), { capture: true });

function startMenu(): void {
  showMenu(root, (settings) => {
    const game = new Game(root, settings, startMenu);
    game.start();
    // Handy for debugging in the browser console.
    (window as unknown as { game: Game }).game = game;
  });
}

startMenu();
