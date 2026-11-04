import { Game } from './Game';
import { GAME } from './core/config';
import { bus } from './core/EventBus';
import { clearSave, loadGame, saveGame } from './core/SaveGame';
import { Assets } from './render/Assets';
import { EndScreen } from './ui/EndScreen';
import { PauseMenu } from './ui/PauseMenu';
import { TitleScreen } from './ui/TitleScreen';
import { Tutorial } from './ui/Tutorial';
import './ui/hud.css';
import './ui/screens.css';

/** Set before reloading so « Rejouer » / « Recommencer » skip the title screen. */
const AUTOSTART_KEY = 'village-wars:autostart';

function takeAutostart(): boolean {
  try {
    const on = sessionStorage.getItem(AUTOSTART_KEY) === 'new';
    sessionStorage.removeItem(AUTOSTART_KEY);
    return on;
  } catch {
    return false;
  }
}

/** Restarting = reloading the page: simplest way to get a clean Three.js scene and HUD. */
function relaunch(newGame: boolean): void {
  try {
    if (newGame) sessionStorage.setItem(AUTOSTART_KEY, 'new');
  } catch {
    // ignore: the title screen will show instead
  }
  window.location.reload();
}

async function boot(): Promise<void> {
  const autostart = takeAutostart();
  const title = new TitleScreen(document.body);
  const assets = new Assets();
  await assets.loadAll((r) => title.progress(r));

  const saved = loadGame(GAME.seed);
  const choice = autostart ? 'new' : await title.choose(saved ? saved.timeMs : null);
  if (choice === 'new') clearSave();

  const game = new Game(document.getElementById('game')!, assets, choice === 'continue' ? saved : null);
  // Debug handle for the browser console and automated tests.
  (window as unknown as { __vw: Game }).__vw = game;
  game.start();
  title.close();

  const save = (): void => {
    if (game.state.status === 'playing') saveGame(game.state);
  };
  window.setInterval(save, GAME.endgame.autosaveSeconds * 1000);
  // Fires when the Android app goes to the background too (Capacitor WebView).
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && save());
  window.addEventListener('pagehide', save);

  const pause = new PauseMenu(document.body, {
    setPaused: (p) => (game.paused = p),
    getSpeed: () => game.speed,
    setSpeed: (s) => (game.speed = s),
    restart: () => {
      clearSave();
      relaunch(true);
    },
    mainMenu: () => {
      save();
      relaunch(false);
    },
  });

  const end = new EndScreen(
    document.body,
    () => relaunch(true),
    () => relaunch(false),
  );
  bus.on('game:over', () => {
    clearSave();
    pause.hide();
    window.setTimeout(() => end.show(game.state), 600);
  });

  if (choice === 'new' && Tutorial.shouldShow()) window.setTimeout(() => new Tutorial(document.body), 800);
}

boot().catch((err: unknown) => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', `<pre style="color:#fff;padding:16px">Erreur de chargement : ${String(err)}</pre>`);
});
