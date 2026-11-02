import { BUILDINGS, UNITS, VILLAGER } from '../core/config';
import { PLAYER_ID } from '../core/constants';
import type { GameState } from '../core/types';
import { campDisplay } from '../systems/ArmySystem';
import { BUILDING_UI, UNIT_UI, gi, costHtml, hexColor } from './icons';
import { canAfford } from '../systems/EconomySystem';
import { nextLevel } from '../systems/ConstructionSystem';
import { capacityOf, populationOf, reservedOf, type TrainingType } from '../systems/TrainingSystem';
import type { ArmyActions } from './ArmyPanel';
import { setHtml } from './Sheet';

/** Info card (bottom center) for the tapped building. */
export class SelectionCard {
  private el: HTMLElement;
  buildingId: string | null = null;
  /** "Partir en guerre" on an army camp (set by UnitControl). */
  onWar: (campId: string) => void = () => {};

  constructor(
    parent: HTMLElement,
    private onArmy: () => void,
    private onUpgrade: (buildingId: string) => void,
    private actions: ArmyActions,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'selection';
    parent.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const train = t.closest<HTMLElement>('[data-train]');
      const cancel = t.closest<HTMLElement>('[data-cancel]');
      if (train && this.buildingId) this.actions.train(this.buildingId, train.dataset.train as TrainingType);
      else if (cancel && this.buildingId) this.actions.cancel(this.buildingId, Number(cancel.dataset.cancel));
      else if (t.closest('[data-rally]') && this.buildingId) this.actions.rally(this.buildingId);
      else if (t.closest('.close')) this.select(null);
      else if (t.closest('[data-act="army"]')) this.onArmy();
      else if (t.closest('[data-act="war"]') && this.buildingId) this.onWar(this.buildingId);
      else if (t.closest('[data-act="upgrade"]') && this.buildingId) this.onUpgrade(this.buildingId);
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
      if (b.type === 'armyCamp') {
        const d = campDisplay(state, b.id);
        lines.push(`<div class="stat">${UNIT_UI.knight.icon} chevaliers ×${d.byType.knight} · ${UNIT_UI.archer.icon} archers ×${d.byType.archer}</div>`);
        lines.push(`<div class="stat"><b>${d.total}</b> soldat${d.total > 1 ? 's' : ''} au camp</div>`);
      }
      if (def.population) lines.push(`<div class="stat">${gi('house')} +${def.population * b.level} places</div>`);
    }
    const done = mine && b.buildProgress >= 1;
    const armyBtn = done && b.type === 'armyCamp'
      ? `<button class="btn green" data-act="army">${gi('army')} Former des troupes</button>`
      : '';
    const warBtn = done && b.type === 'armyCamp' ? `<button class="btn blue" data-act="war">${gi('sword')} Partir en guerre</button>` : '';
    const next = mine && b.buildProgress >= 1 ? nextLevel(b) : null;
    const upgradeBtn = next
      ? `<button class="btn blue upgrade" data-act="upgrade" ${canAfford(owner, next.cost) ? '' : 'disabled'}>⬆️ Niveau ${next.level} <span class="costs">${costHtml(next.cost, owner)}</span></button>`
      : '';

    let training = '';
    if (done && (b.type === 'townHall' || b.type === 'barracks')) {
      const types: TrainingType[] = b.type === 'townHall' ? ['villager'] : ['spearman', 'archer', 'knight'];
      training = types.map(t => {
        const d = t === 'villager' ? VILLAGER : UNITS[t];
        const reason = populationOf(state, b.ownerId) + reservedOf(state, b.ownerId) >= capacityOf(state, b.ownerId) ? 'Capacité de population atteinte' : !canAfford(owner, d.cost) ? 'Ressources insuffisantes' : '';
        return `<div><button class="btn green" data-train="${t}" ${reason ? 'disabled' : ''}>Former ${t === 'villager' ? 'un villageois' : d.name.toLowerCase()}</button> ${costHtml(d.cost, owner)} ${reason ? `<small>${reason}</small>` : ''}</div>`;
      }).join('');
      training += (b.trainingQueue ?? []).map((item, i) => {
        const d = item.type === 'villager' ? VILLAGER : UNITS[item.type];
        return `<div>${d.name} · ${Math.round((1 - item.remainingMs / d.trainTimeMs) * 100)} % · ${Math.ceil(item.remainingMs / 1000)} s <button data-cancel="${i}">Annuler</button></div>`;
      }).join('') || '<small>File vide</small>';
      if (b.type === 'barracks') training += `<div><button data-rally>Point de ralliement${b.rallyPoint ? ` (${b.rallyPoint.tx}, ${b.rallyPoint.ty})` : ''}</button></div>`;
    }
    setHtml(this.el, `
      <button class="close" aria-label="Fermer">✕</button>
      <div class="sel-head">
        <span class="sel-icon">${BUILDING_UI[b.type].icon}</span>
        <div><b>${def.name}${def.levels ? ` <small>niv. ${b.level}</small>` : ''}</b>
        <span class="owner" style="--c:${hexColor(owner.color)}">${owner.name}</span></div>
      </div>
      ${lines.join('')}
      ${training}
      <div class="sel-btns">${armyBtn}${warBtn}${upgradeBtn}</div>`);
  }
}

function bar(icon: string, ratio: number, label: string, kind: string): string {
  return `<div class="bar ${kind}"><span>${icon}</span><div><i style="width:${Math.round(ratio * 100)}%"></i><em>${label}</em></div></div>`;
}
