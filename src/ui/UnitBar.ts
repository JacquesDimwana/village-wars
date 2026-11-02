import { UNIT_UI, gi } from './icons';
import { setHtml } from './Sheet';
import './units.css';

export interface UnitBarInfo {
  knights: number;
  archers: number;
  villagers: number;
  /** Some selected soldiers are out on a mission: show "Rentrer". */
  canRecall: boolean;
  /** Plain-language line when a single villager is selected. */
  detail: string[];
}

/** Bottom-center bar listing the current unit selection. */
export class UnitBar {
  private el: HTMLElement;
  private body: HTMLElement;

  constructor(
    parent: HTMLElement,
    onClear: () => void,
    onRecall: () => void,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'unit-bar';
    this.el.innerHTML = '<div class="ub-body"></div>';
    this.body = this.el.querySelector('.ub-body')!;
    parent.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('.close')) onClear();
      else if (t.closest('[data-act="recall"]')) onRecall();
    });
  }

  setOpen(open: boolean): void {
    this.el.classList.toggle('open', open);
  }

  render(info: UnitBarInfo): void {
    const chips: string[] = [];
    if (info.knights) chips.push(`<span class="ub-chip">${UNIT_UI.knight.icon}<b>chevaliers ×${info.knights}</b></span>`);
    if (info.archers) chips.push(`<span class="ub-chip">${UNIT_UI.archer.icon}<b>archers ×${info.archers}</b></span>`);
    if (info.villagers) chips.push(`<span class="ub-chip">${gi('workers', 'c-workers')}<b>villageois ×${info.villagers}</b></span>`);
    const recall = info.canRecall ? `<button class="btn blue small" data-act="recall">Rentrer</button>` : '';
    setHtml(
      this.body,
      `<button class="close" aria-label="Désélectionner">✕</button>
       <div class="ub-row">${chips.join('')}${recall}</div>
       ${info.detail.map((d) => `<div class="ub-detail">${d}</div>`).join('')}`,
    );
  }
}
