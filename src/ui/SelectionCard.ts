import { BUILDINGS } from '../core/config';
import { PLAYER_ID } from '../core/constants';
import type { GameState, ResourceType } from '../core/types';
import { assignWorkers, staffing } from '../systems/PopulationSystem';
import { BUILDING_UI, RESOURCE_UI, gi, hexColor } from './icons';
import { setHtml } from './Sheet';

/** Info card (bottom center) for the tapped building. */
export class SelectionCard {
  private el: HTMLElement;
  buildingId: string | null = null;

  constructor(
    parent: HTMLElement,
    private onArmy: () => void,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'selection';
    parent.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('.close')) this.select(null);
      else if (t.closest('[data-act="army"]')) this.onArmy();
    });
  }

  select(id: string | null): void {
    this.buildingId = id;
    this.el.classList.toggle('open', id !== null);
  }

  refresh(state: GameState): void {
    const b = this.buildingId ? state.buildings[this.buildingId] : undefined;
    if (!b) {
      if (this.buildingId) this.select(null);
      return;
    }
    const def = BUILDINGS[b.type];
    const owner = state.villages[b.ownerId];
    const mine = b.ownerId === PLAYER_ID;
    const lines: string[] = [];

    lines.push(bar(gi('hp', 'c-hp'), b.hp / b.maxHp, `${Math.ceil(b.hp)} / ${b.maxHp}`, 'hp'));
    if (b.buildProgress < 1) {
      lines.push(bar(gi('build'), b.buildProgress, `Construction ${Math.floor(b.buildProgress * 100)} %`, 'build'));
    } else if (mine) {
      const assignment = assignWorkers(state, PLAYER_ID);
      if (def.workerSlots) lines.push(`<div class="stat">${gi('workers', 'c-workers')} ${assignment.get(b.id) ?? 0} / ${def.workerSlots} travailleurs</div>`);
      const ratio = staffing(b, assignment);
      for (const [res, rate] of Object.entries(def.produces ?? {}) as [ResourceType, number][]) {
        const ui = RESOURCE_UI.find((r) => r.key === res)!;
        lines.push(`<div class="stat">${ui.icon} +${(rate * ratio).toFixed(1)}/s <small>(max ${rate}/s)</small></div>`);
      }
      if (def.population) lines.push(`<div class="stat">${gi('house')} +${def.population * b.level} places</div>`);
    }
    const armyBtn = mine && b.buildProgress >= 1 && (def.forges || def.converts)
      ? `<button class="btn green" data-act="army">${def.forges ? `${gi('armory')} Forger des armes` : `${gi('army')} Former des troupes`}</button>`
      : '';

    setHtml(this.el, `
      <button class="close" aria-label="Fermer">✕</button>
      <div class="sel-head">
        <span class="sel-icon">${BUILDING_UI[b.type].icon}</span>
        <div><b>${def.name}${def.levels ? ` <small>niv. ${b.level}</small>` : ''}</b>
        <span class="owner" style="--c:${hexColor(owner.color)}">${owner.name}</span></div>
      </div>
      ${lines.join('')}
      ${armyBtn}`);
  }
}

function bar(icon: string, ratio: number, label: string, kind: string): string {
  return `<div class="bar ${kind}"><span>${icon}</span><div><i style="width:${Math.round(ratio * 100)}%"></i><em>${label}</em></div></div>`;
}
