import { BUILDINGS, UNITS, WEAPONS } from '../core/config';
import { PLAYER_ID } from '../core/constants';
import type { GameState, UnitType, WeaponType } from '../core/types';
import { canAfford } from '../systems/EconomySystem';
import { assignWorkers, civilians, staffing, warriors } from '../systems/PopulationSystem';
import { UNIT_UI, WEAPON_UI, costHtml, gi } from './icons';
import { Sheet, setHtml, setText } from './Sheet';

const WEAPON_TYPES: WeaponType[] = ['sword', 'bow'];
const UNIT_TYPES: UnitType[] = ['knight', 'archer'];

export interface ArmyActions {
  forge(weapon: WeaponType): void;
  train(unit: UnitType): void;
  demobilize(unit: UnitType): void;
}

/** Armory (forge weapons) + barracks (train / demobilize warriors). */
export class ArmyPanel extends Sheet {
  constructor(parent: HTMLElement, actions: ArmyActions) {
    super(parent, gi('army'), 'Armée');
    this.body.innerHTML = `
      <div class="army">
        <div class="army-col">
          <h3>${gi('armory')} Armurerie <small data-k="forge-status"></small></h3>
          ${WEAPON_TYPES.map((w) => `
            <div class="row" data-weapon="${w}">
              <span class="row-icon">${WEAPON_UI[w].icon}</span>
              <div class="row-main"><b>${WEAPONS[w].name}</b><span class="costs"></span></div>
              <span class="stock" title="En stock">×<b data-k="stock">0</b></span>
              <button class="btn green" data-act="forge">Forger</button>
            </div>`).join('')}
          <div class="queue" data-k="queue"></div>
        </div>
        <div class="army-col">
          <h3>${gi('barracks')} Caserne <small data-k="barracks-status"></small></h3>
          ${UNIT_TYPES.map((u) => `
            <div class="row" data-unit="${u}">
              <span class="row-icon">${UNIT_UI[u].icon}</span>
              <div class="row-main"><b>${UNITS[u].name.replace(/ \(.*\)/, '')}</b><small>${UNIT_UI[u].role}</small><small class="need">${gi('workers')}1 + ${WEAPON_UI[UNITS[u].weapon].icon}1 · ${gi('hp', 'c-hp')}${UNITS[u].hp} · ${gi('sword')}${UNITS[u].attack}</small></div>
              <span class="stock" title="Guerriers">×<b data-k="count">0</b></span>
              <div class="btn-col"><button class="btn green" data-act="train">Former</button><button class="btn small" data-act="demob">Renvoyer</button></div>
            </div>`).join('')}
          <p class="hint">Chaque guerrier quitte son poste : le village produit moins.</p>
        </div>
      </div>`;

    this.body.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((btn) => {
      const row = btn.closest<HTMLElement>('.row')!;
      btn.addEventListener('click', () => {
        if (btn.dataset.act === 'forge') actions.forge(row.dataset.weapon as WeaponType);
        else if (btn.dataset.act === 'train') actions.train(row.dataset.unit as UnitType);
        else actions.demobilize(row.dataset.unit as UnitType);
      });
    });
  }

  refresh(state: GameState): void {
    const v = state.villages[PLAYER_ID];
    const mine = Object.values(state.buildings).filter((b) => b.ownerId === PLAYER_ID && b.buildProgress >= 1);
    const armories = mine.filter((b) => BUILDINGS[b.type].forges);
    const hasBarracks = mine.some((b) => BUILDINGS[b.type].converts);
    const assignment = assignWorkers(state, PLAYER_ID);
    const smiths = armories.reduce((n, b) => n + (assignment.get(b.id) ?? 0), 0);
    const speed = armories.reduce((n, b) => n + staffing(b, assignment), 0);

    setText(
      this.body.querySelector('[data-k="forge-status"]'),
      armories.length === 0 ? '· construis une armurerie' : smiths === 0 ? '· aucun forgeron' : `· ${smiths} forgeron${smiths > 1 ? 's' : ''}`,
    );
    for (const w of WEAPON_TYPES) {
      const row = this.body.querySelector(`[data-weapon="${w}"]`)!;
      setHtml(row.querySelector('.costs'), costHtml(WEAPONS[w].cost, v));
      setText(row.querySelector('[data-k="stock"]'), String(v.weapons[w]));
      row.querySelector<HTMLButtonElement>('button')!.disabled = armories.length === 0 || !canAfford(v, WEAPONS[w].cost);
    }

    const queue = v.forgeQueue
      .map((item, i) => {
        const pct = i === 0 ? Math.round((1 - item.remainingMs / WEAPONS[item.weapon].forgeTimeMs) * 100) : 0;
        return `<span class="q-item${i === 0 && speed === 0 ? ' paused' : ''}" style="--p:${pct}%">${WEAPON_UI[item.weapon].icon}</span>`;
      })
      .join('');
    setHtml(this.body.querySelector('[data-k="queue"]'), queue || '<small>File de forge vide</small>');

    setText(this.body.querySelector('[data-k="barracks-status"]'), hasBarracks ? `· ${civilians(state, PLAYER_ID)} habitants dispo` : '· construis une caserne');
    const army = warriors(state, PLAYER_ID);
    for (const u of UNIT_TYPES) {
      const row = this.body.querySelector(`[data-unit="${u}"]`)!;
      const count = army.filter((w) => w.type === u).length;
      setText(row.querySelector('[data-k="count"]'), String(count));
      const [train, demob] = row.querySelectorAll<HTMLButtonElement>('button');
      train.disabled = !hasBarracks || civilians(state, PLAYER_ID) < 1 || v.weapons[UNITS[u].weapon] < 1;
      demob.disabled = count === 0;
    }
  }
}
