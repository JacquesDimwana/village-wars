import { BUILDINGS } from '../core/config';
import { PLAYER_ID } from '../core/constants';
import type { BuildingType, GameState } from '../core/types';
import { canAfford, incomeRates, timeToAfford } from '../systems/EconomySystem';
import { BUILDING_UI, RESOURCE_UI, costHtml } from './icons';
import { Sheet, setHtml, setText } from './Sheet';

const CATEGORIES: { id: string; label: string; types: BuildingType[] }[] = [
  { id: 'eco', label: '🌾 Économie', types: ['house', 'lumberCamp', 'quarry', 'mine', 'smelter'] },
  { id: 'army', label: '⚔️ Armée', types: ['armory', 'barracks'] },
  { id: 'defense', label: '🏹 Défense', types: ['tower'] },
];

/** Shop-style catalog of buildings, by category, with cost and waiting time. */
export class BuildPanel extends Sheet {
  constructor(parent: HTMLElement, onPick: (type: BuildingType) => void, onCantAfford: () => void) {
    super(parent, '🏗️', 'Construire');
    this.body.innerHTML = `
      <nav class="tabs">${CATEGORIES.map((c, i) => `<button class="tab${i === 0 ? ' active' : ''}" data-tab="${c.id}">${c.label}</button>`).join('')}</nav>
      ${CATEGORIES.map((c, i) => `
        <div class="cards" data-cat="${c.id}" ${i === 0 ? '' : 'hidden'}>${c.types.map((t) => {
          const def = BUILDINGS[t];
          return `
            <button class="card" data-type="${t}">
              <span class="card-icon">${BUILDING_UI[t].icon}</span>
              <b>${def.name}</b>
              <small>${BUILDING_UI[t].desc}</small>
              <span class="costs"></span>
              <span class="card-time"></span>
            </button>`;
        }).join('')}</div>`).join('')}`;

    this.body.querySelectorAll<HTMLButtonElement>('.tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        this.body.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
        this.body.querySelectorAll<HTMLElement>('.cards').forEach((c) => (c.hidden = c.dataset.cat !== tab.dataset.tab));
      });
    });
    this.body.querySelectorAll<HTMLButtonElement>('.card').forEach((card) => {
      card.addEventListener('click', () => {
        if (card.classList.contains('locked')) onCantAfford();
        else onPick(card.dataset.type as BuildingType);
      });
    });
  }

  refresh(state: GameState): void {
    const v = state.villages[PLAYER_ID];
    const rates = incomeRates(state, PLAYER_ID);
    this.body.querySelectorAll<HTMLButtonElement>('.card').forEach((card) => {
      const def = BUILDINGS[card.dataset.type as BuildingType];
      const affordable = canAfford(v, def.cost);
      card.classList.toggle('locked', !affordable);
      setHtml(card.querySelector('.costs'), costHtml(def.cost, v));
      let time = `🔨 ${Math.round(def.buildTimeMs / 1000)} s`;
      if (!affordable) {
        const wait = timeToAfford(v, def.cost, rates);
        if (typeof wait === 'number') time = `⏳ dans ~${formatWait(wait)}`;
        else time = `⛔ il faut du ${RESOURCE_UI.find((r) => r.key === wait.missing)!.label.toLowerCase()}`;
      }
      setText(card.querySelector('.card-time'), time);
    });
  }
}

const formatWait = (s: number): string => (s < 60 ? `${Math.ceil(s)} s` : `${Math.ceil(s / 60)} min`);
