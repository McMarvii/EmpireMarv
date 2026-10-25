import './styles.css';
import { Game } from './game';
import { showMenu } from './ui/menu';

const root = document.querySelector<HTMLElement>('#app')!;

function startMenu(): void {
  showMenu(root, (settings) => {
    const game = new Game(root, settings, startMenu);
    game.start();
    // Handy for debugging in the browser console.
    (window as unknown as { game: Game }).game = game;
  });
}

startMenu();
