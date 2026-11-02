import { BUILDINGS } from '../core/config';
import type { BuildingType, Village } from '../core/types';
import { BUILDING_UI, costHtml } from './icons';
import { setHtml, setText } from './Sheet';
import './placement.css';

/** Bottom bar shown while placing a building: name, cost, why it can't go there, ✕ / ✔. */
export class PlacementBar {
  private el: HTMLElement;
  private ok = false;

  constructor(onConfirm: () => void, onCancel: () => void) {
    this.el = document.createElement('div');
    this.el.className = 'hud placement';
    this.el.innerHTML = `
      <div class="placement-bar">
        <button class="round red" data-act="cancel" aria-label="Annuler"><span class="glyph">✕</span></button>
        <div class="placement-info">
          <b class="outlined"></b>
          <span class="costs"></span>
          <small class="placement-hint outlined"></small>
        </div>
        <button class="round green" data-act="confirm" aria-label="Valider"><span class="glyph">✔</span></button>
      </div>`;
    document.body.appendChild(this.el);
    this.el.querySelector('[data-act="cancel"]')!.addEventListener('click', onCancel);
    this.el.querySelector('[data-act="confirm"]')!.addEventListener('click', () => {
      if (this.ok) onConfirm();
      else this.el.querySelector('.placement-hint')!.animate(
        [{ transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'none' }],
        { duration: 180 },
      );
    });
  }

  show(type: BuildingType): void {
    setText(this.el.querySelector('b'), `${BUILDING_UI[type].icon} ${BUILDINGS[type].name}`);
    this.el.classList.add('open');
    document.body.classList.add('placing');
  }

  hide(): void {
    this.el.classList.remove('open');
    document.body.classList.remove('placing');
  }

  update(type: BuildingType, village: Village, reason: string | null): void {
    this.ok = reason === null;
    this.el.classList.toggle('invalid', !this.ok);
    setHtml(this.el.querySelector('.costs'), costHtml(BUILDINGS[type].cost, village));
    setText(this.el.querySelector('.placement-hint'), reason ?? 'Glisse le bâtiment, puis valide');
  }
}
