import type { GameState } from '../core/types';
import { victoryStars } from '../systems/StatsSystem';
import { fmt } from './icons';

export function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`;
  return `${m} min ${String(s).padStart(2, '0')} s`;
}

/** Victory / defeat overlay: animated banner, stars, game statistics. */
export class EndScreen {
  constructor(
    private parent: HTMLElement,
    private onReplay: () => void,
    private onMenu: () => void,
  ) {}

  show(state: GameState): void {
    const won = state.status === 'won';
    const stars = victoryStars(state);
    const s = state.stats;
    const el = document.createElement('div');
    el.className = `hud screen end-screen ${won ? 'won' : 'lost'}`;
    el.innerHTML = `
      <div class="end-panel">
        <div class="end-rays"></div>
        <div class="end-stars">
          ${[1, 2, 3].map((i) => `<span class="star ${i <= stars ? 'on' : ''}" style="--i:${i}">★</span>`).join('')}
        </div>
        <div class="end-trophy">${won ? '🏆' : '🏚️'}</div>
        <div class="ribbon"><span>${won ? 'Victoire !' : 'Défaite…'}</span></div>
        <p class="end-sub">${won ? 'Tous les villages ennemis sont tombés.' : 'Ton hôtel de ville a été détruit.'}</p>
        <ul class="end-stats">
          <li><span>⏱️</span>Temps de partie<b>${formatDuration(state.timeMs)}</b></li>
          <li><span>⚔️</span>Unités formées<b>${fmt(s.unitsTrained)}</b></li>
          <li><span>🪵</span>Ressources récoltées<b>${fmt(s.resourcesGathered)}</b></li>
          <li><span>🔥</span>Villages détruits<b>${s.villagesDestroyed}</b></li>
        </ul>
        <div class="end-actions">
          <button class="btn" data-act="menu">🏠 Menu</button>
          <button class="btn green big-btn" data-act="replay">↻ Rejouer</button>
        </div>
      </div>`;
    el.querySelector('[data-act="replay"]')!.addEventListener('click', () => this.onReplay());
    el.querySelector('[data-act="menu"]')!.addEventListener('click', () => this.onMenu());
    this.parent.appendChild(el);
  }
}
