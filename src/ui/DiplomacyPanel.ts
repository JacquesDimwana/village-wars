import { bus } from '../core/EventBus';
import { PLAYER_ID } from '../core/constants';
import { proposeAlliance, breakAlliance, sendResources, requestResources, requestReinforcements, relation } from '../systems/DiplomacySystem';
import { AI, BUILDINGS } from '../core/config';
import { townHallOf } from '../core/GameState';
import type { GameState } from '../core/types';
import { isExplored } from '../systems/FogSystem';
import { gi, hexColor } from './icons';
import { Sheet, setHtml } from './Sheet';

/** The 5 AI villages. Unknown until their town hall has been explored. */
export class DiplomacyPanel extends Sheet {
  constructor(parent: HTMLElement, onFocus: (x: number, y: number) => void, private getState: () => GameState) {
    super(parent, gi('diplomacy'), 'Diplomatie');
    this.body.innerHTML = '<div class="villages"></div>';
    this.body.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
      if (!btn || btn.disabled) return;
      if (btn.dataset.act === 'see') onFocus(Number(btn.dataset.x), Number(btn.dataset.y));
      else {
        const state = this.getState();
        const id = btn.dataset.id!;
        const act = btn.dataset.act;
        let message = 'Action impossible';
        if (act === 'ally') {
          const result = proposeAlliance(state, PLAYER_ID, id, bus);
          message = result.ok ? (result.accepted ? 'Alliance acceptée' : 'Alliance refusée') : result.reason;
        } else if (act === 'break') message = breakAlliance(state, PLAYER_ID, id, bus) ? 'Alliance rompue' : message;
        else if (act === 'gift') message = sendResources(state, PLAYER_ID, id, bus) ? 'Convoi envoyé' : message;
        else if (act === 'request') {
          const result = requestResources(state, PLAYER_ID, id, bus);
          message = result.ok ? (result.accepted ? 'Convoi envoyé' : 'Demande refusée') : result.reason;
        } else if (act === 'reinforce') {
          const hall = townHallOf(state, PLAYER_ID);
          if (hall) message = requestReinforcements(state, PLAYER_ID, id, { x: hall.tx, y: hall.ty }, bus).length ? 'Renforts envoyés' : message;
        }
        bus.emit('notify', { message });
        this.refresh(state);
      }
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
        const allied = v.allies.includes(PLAYER_ID);
        const status = !v.alive ? '<span class="tag dead">Détruit</span>' : v.allies.length && v.allies.includes('player') ? '<span class="tag ally">Allié</span>' : known ? '<span class="tag">Découvert</span>' : '<span class="tag unknown">Inconnu</span>';
        return `
          <div class="village-row${known ? '' : ' unknown'}">
            <span class="shield" style="--c:${known ? hexColor(v.color) : '#777'}">${known ? gi('castle') : '?'}</span>
            <div class="row-main"><b>${known ? v.name : 'Village inconnu'}</b><small>${known ? `${personality} · Relation ${Math.round(relation(state, PLAYER_ID, v.id) * 100)}` : 'Explore la carte pour le trouver'}</small></div>
            ${status}
            <button class="btn small" data-act="see" ${known && hall ? `data-x="${hall.tx + c}" data-y="${hall.ty + c}"` : 'disabled'}>Voir</button>
            <button class="btn blue" data-act="${allied ? 'break' : 'ally'}" data-id="${v.id}" ${known && v.alive ? '' : 'disabled'}>${allied ? 'Rompre' : 'Alliance'}</button>
            <button class="btn small" data-act="gift" data-id="${v.id}" ${known && v.alive ? '' : 'disabled'}>Don</button>
            ${allied ? `<button class="btn small" data-act="request" data-id="${v.id}">Ressources</button><button class="btn small" data-act="reinforce" data-id="${v.id}">Renforts</button>` : ''}
          </div>`;
      })
      .join('');
    setHtml(this.body.querySelector('.villages'), html);
  }
}
