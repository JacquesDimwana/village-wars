import { PROGRESSION, UNITS, VILLAGER } from '../core/config';
import { PLAYER_ID } from '../core/constants';
import type { GameState, UpgradeType } from '../core/types';
import { capacityOf, populationOf, reservedOf, type TrainingType } from '../systems/TrainingSystem';
import { canAfford } from '../systems/EconomySystem';
import { costHtml, gi } from './icons';
import { Sheet } from './Sheet';
export interface ArmyActions { age(id: string): void; research(id: string, type: UpgradeType): void; cancelResearch(id: string, index: number): void; train(buildingId: string, type: TrainingType): void; cancel(buildingId: string, index: number): void; rally(buildingId: string): void; }
export class ArmyPanel extends Sheet {
 constructor(parent: HTMLElement, private actions: ArmyActions) { super(parent, gi('army'), 'Formation'); }
 refresh(state: GameState): void {
  const v = state.villages[PLAYER_ID];
  const buildings = Object.values(state.buildings).filter(b => b.ownerId === PLAYER_ID && b.buildProgress >= 1 && (b.type === 'townHall' || b.type === 'barracks'));
  this.body.innerHTML = buildings.map(b => {
   const types: TrainingType[] = b.type === 'townHall' ? ['villager'] : ['spearman','archer','knight'];
   const buttons = types.map(t => { const d = t === 'villager' ? VILLAGER : UNITS[t]; const locked = t !== 'villager' && v.age < (PROGRESSION.unitAge[t] ?? 1); const disabled = locked || !canAfford(v,d.cost) || populationOf(state,PLAYER_ID) + reservedOf(state,PLAYER_ID) >= capacityOf(state,PLAYER_ID); const reason = locked ? 'Disponible au Temps des Bourgs' : populationOf(state,PLAYER_ID) + reservedOf(state,PLAYER_ID) >= capacityOf(state,PLAYER_ID) ? 'Capacité de population atteinte' : 'Ressources insuffisantes'; return `<div class="row"><b>${d.name}</b> ${costHtml(d.cost,v)} · ${d.trainTimeMs / 1000} s <button data-train="${t}" ${disabled ? 'disabled' : ''}>Former</button>${disabled ? `<small>${reason}</small>` : ''}</div>`; }).join('');
   const queue = (b.trainingQueue ?? []).map((item,i) => `<div>${item.type} · ${Math.ceil(item.remainingMs / 1000)} s <button data-cancel="${i}">Annuler</button></div>`).join('');
   return `<section data-building="${b.id}"><h3>${b.type === 'townHall' ? 'Hôtel de ville' : 'Caserne'}</h3>${buttons}${b.type === 'barracks' ? `<button data-rally>Point de ralliement${b.rallyPoint ? ` (${b.rallyPoint.tx}, ${b.rallyPoint.ty})` : ''}</button>` : ''}${queue || '<small>File vide</small>'}</section>`;
  }).join('');
  this.body.querySelectorAll<HTMLButtonElement>('[data-train]').forEach(el => el.onclick = () => this.actions.train(el.closest<HTMLElement>('[data-building]')!.dataset.building!, el.dataset.train as TrainingType));
  this.body.querySelectorAll<HTMLButtonElement>('[data-rally]').forEach(el => el.onclick = () => this.actions.rally(el.closest<HTMLElement>('[data-building]')!.dataset.building!));
  this.body.querySelectorAll<HTMLButtonElement>('[data-cancel]').forEach(el => el.onclick = () => this.actions.cancel(el.closest<HTMLElement>('[data-building]')!.dataset.building!, Number(el.dataset.cancel)));
 }
}
