import { PLAYER_ID } from '../core/constants';
import type { EventBus } from '../core/EventBus';
import type { GameState, ResourceType } from '../core/types';
import { productionRates } from '../systems/EconomySystem';
import { civilians, housingCap, warriors } from '../systems/PopulationSystem';
import './hud.css';

const RESOURCES: { key: ResourceType; icon: string; label: string }[] = [
  { key: 'wood', icon: '🪵', label: 'Bois' },
  { key: 'stone', icon: '🪨', label: 'Pierre' },
  { key: 'ore', icon: '⛏️', label: 'Minerai' },
  { key: 'iron', icon: '⚙️', label: 'Fer' },
];

/** HTML overlay on top of the 3D canvas. Reads GameState; actions go through the EventBus. */
export class Hud {
  private root: HTMLElement;
  private values = new Map<string, HTMLElement>();
  private toastEl: HTMLElement;
  private toastTimer = 0;

  constructor(
    parent: HTMLElement,
    private getState: () => GameState,
    bus: EventBus,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="hud-top">
        <div class="hud-row">
          ${RESOURCES.map((r) => `<div class="chip" title="${r.label}"><span>${r.icon}</span><b data-k="${r.key}">0</b><small data-k="${r.key}-rate"></small></div>`).join('')}
        </div>
        <div class="hud-row">
          <div class="chip" title="Habitants au travail">👷<b data-k="workers">0</b></div>
          <div class="chip" title="Guerriers">🛡️<b data-k="warriors">0</b></div>
          <div class="chip" title="Places d'habitation">🏠<b data-k="housing">0</b></div>
          <div class="chip" title="Épées en stock">🗡️<b data-k="sword">0</b></div>
          <div class="chip" title="Arcs en stock">🏹<b data-k="bow">0</b></div>
        </div>
      </div>
      <div class="hud-bottom">
        <button data-action="build">🏗️<span>Construire</span></button>
        <button data-action="army">⚔️<span>Armée</span></button>
        <button data-action="diplomacy">🤝<span>Diplomatie</span></button>
      </div>
      <div class="toast"></div>
    `;
    parent.appendChild(this.root);
    this.root.querySelectorAll<HTMLElement>('[data-k]').forEach((el) => this.values.set(el.dataset.k!, el));
    this.toastEl = this.root.querySelector('.toast')!;

    const placeholders: Record<string, string> = {
      build: 'Construction : à implémenter (agent A)',
      army: 'Armurerie / caserne : à implémenter (agent B)',
      diplomacy: 'Diplomatie : à implémenter (agent E)',
    };
    this.root.querySelectorAll<HTMLButtonElement>('button[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => bus.emit('notify', { message: placeholders[btn.dataset.action!] }));
    });

    bus.on('notify', ({ message }) => this.toast(message));
  }

  /** Called every frame (cheap: only text updates). */
  update(): void {
    const state = this.getState();
    const v = state.villages[PLAYER_ID];
    const rates = productionRates(state, PLAYER_ID);
    for (const r of RESOURCES) {
      this.set(r.key, String(v.resources[r.key]));
      const rate = rates[r.key];
      this.set(`${r.key}-rate`, rate > 0 ? `+${rate.toFixed(1)}/s` : '');
    }
    this.set('workers', String(civilians(state, PLAYER_ID)));
    this.set('warriors', String(warriors(state, PLAYER_ID).length));
    this.set('housing', String(housingCap(state, PLAYER_ID)));
    this.set('sword', String(v.weapons.sword));
    this.set('bow', String(v.weapons.bow));
  }

  toast(message: string): void {
    this.toastEl.textContent = message;
    this.toastEl.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), 2200);
  }

  private set(key: string, text: string): void {
    const el = this.values.get(key);
    if (el && el.textContent !== text) el.textContent = text;
  }
}
