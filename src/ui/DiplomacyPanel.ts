import { AI, BUILDINGS } from '../core/config';
import { townHallOf } from '../core/GameState';
import type { GameState } from '../core/types';
import { isExplored } from '../systems/FogSystem';
import { gi, hexColor } from './icons';
import { Sheet, setHtml } from './Sheet';

/** The 5 AI villages. Unknown until their town hall has been explored. */
export class DiplomacyPanel extends Sheet {
  constructor(parent: HTMLElement, onFocus: (x: number, y: number) => void, onSoon: () => void) {
    super(parent, gi('diplomacy'), 'Diplomatie');
    this.body.innerHTML = '<div class="villages"></div>';
    this.body.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
      if (!btn || btn.disabled) return;
      if (btn.dataset.act === 'see') onFocus(Number(btn.dataset.x), Number(btn.dataset.y));
      else onSoon();
    });
  }

  refresh(state: GameState): void {
    const html = Object.values(state.villages)
      .filter((v) => !v.isPlayer)
      .map((v) => {
        const hall = townHallOf(state, v.id);
        const known = !!hall && isExplored(state.fog, hall.tx, hall.ty);
        const c = BUILDINGS.townHall.size / 2;
        const personality = v.personality ? AI.personalities[v.personality].name : '';
        const status = !v.alive ? '<span class="tag dead">Détruit</span>' : v.allies.length && v.allies.includes('player') ? '<span class="tag ally">Allié</span>' : known ? '<span class="tag">Découvert</span>' : '<span class="tag unknown">Inconnu</span>';
        return `
          <div class="village-row${known ? '' : ' unknown'}">
            <span class="shield" style="--c:${known ? hexColor(v.color) : '#777'}">${known ? gi('castle') : '?'}</span>
            <div class="row-main"><b>${known ? v.name : 'Village inconnu'}</b><small>${known ? personality : 'Explore la carte pour le trouver'}</small></div>
            ${status}
            <button class="btn small" data-act="see" ${known && hall ? `data-x="${hall.tx + c}" data-y="${hall.ty + c}"` : 'disabled'}>Voir</button>
            <button class="btn blue" data-act="ally" ${known ? '' : 'disabled'}>Alliance</button>
          </div>`;
      })
      .join('');
    setHtml(this.body.querySelector('.villages'), html);
  }
}
