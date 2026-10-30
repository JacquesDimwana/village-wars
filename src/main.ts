import { Game } from './Game';
import { Assets } from './render/Assets';
import './ui/hud.css';

async function boot(): Promise<void> {
  const loading = document.createElement('div');
  loading.className = 'loading';
  loading.innerHTML = '<h1>Village Wars</h1><div class="bar"><div></div></div><small>Chargement…</small>';
  document.body.appendChild(loading);
  const fill = loading.querySelector<HTMLElement>('.bar div')!;

  const assets = new Assets();
  await assets.loadAll((r) => (fill.style.width = `${Math.round(r * 100)}%`));

  const game = new Game(document.getElementById('game')!, assets);
  // Debug handle for the browser console and automated tests.
  (window as unknown as { __vw: Game }).__vw = game;
  game.start();
  loading.remove();
}

boot().catch((err: unknown) => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', `<pre style="color:#fff;padding:16px">Erreur de chargement : ${String(err)}</pre>`);
});
