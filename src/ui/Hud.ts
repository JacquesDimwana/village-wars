import { PLAYER_ID } from '../core/constants';
import type { EventBus } from '../core/EventBus';
import type { BuildingType, GameState } from '../core/types';
import { incomeRates } from '../systems/EconomySystem';
import { listIdleVillagers } from '../systems/VillagerSystem';
import { populationOf, capacityOf, reservedOf } from '../systems/TrainingSystem';
import { ArmyPanel, type ArmyActions } from './ArmyPanel';
import { BuildPanel } from './BuildPanel';
import { DiplomacyPanel } from './DiplomacyPanel';
import { RESOURCE_UI, fmt, gi, hexColor, kenneySkin } from './icons';
import { SelectionCard } from './SelectionCard';
import { Sheet, setText } from './Sheet';
import './hud.css';

const REFRESH_MS = 200;

export interface HudActions extends ArmyActions {
  cancelConstruction(buildingId: string): void;
  build(type: BuildingType): void;
  idle(): void;
  /** Next level for a building that has levels (town hall). */
  upgrade(buildingId: string): void;
  focus(x: number, y: number): void;
  /** Centers the camera on the player's town hall. */
  home(): void;
}

type SheetName = 'build' | 'army' | 'diplomacy';

/**
 * HTML overlay on top of the 3D canvas (Clash-of-Clans-like layout).
 * Reads GameState; player actions go through `HudActions` (implemented by Game with the systems).
 */
export class Hud {
  readonly root: HTMLElement;
  private values = new Map<string, HTMLElement>();
  private toastEl: HTMLElement;
  private toastTimer = 0;
  private sheets: Record<SheetName, Sheet>;
  readonly selection: SelectionCard;
  private lastRefresh = 0;

  constructor(
    parent: HTMLElement,
    private getState: () => GameState,
    bus: EventBus,
    actions: HudActions,
  ) {
    const player = getState().villages[PLAYER_ID];
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.setAttribute('style', kenneySkin());
    this.root.innerHTML = `
      <button class="village-card" data-act="home" title="Revenir au village">
        <span class="crest" style="--c:${hexColor(player.color)}">${gi('castle')}</span>
        <div class="village-info">
          <b>${player.name}</b><small data-k="age"></small>
          <div class="pop-bar" title="Travailleurs / guerriers / places libres"><i class="workers"></i><i class="warriors"></i></div>
          <div class="pop-legend">
            <span title="Travailleurs">${gi('workers', 'c-workers')}<b data-k="workers">0</b></span>
            <span title="Guerriers">${gi('warriors', 'c-warriors')}<b data-k="warriors">0</b></span>
            <span title="Places d'habitation">${gi('house')}<b data-k="housing">0</b></span>
          </div>
        </div>
      </button>
      <button class="round small home-btn" data-act="home" title="Revenir au village"><span class="glyph">${gi('castle')}</span></button>
      <div class="resources">
        ${RESOURCE_UI.map((r) => `
          <div class="res" title="${r.label}">
            <span class="res-icon">${r.icon}</span>
            <b data-k="${r.key}">0</b>
            <small data-k="${r.key}-rate"></small>
          </div>`).join('')}
      </div>
      <div class="actions-left">
        <button class="round blue" data-act="idle" title="Villageois inactif"><span class="glyph">${gi('workers')}</span><span class="label">Inactif</span><span class="badge" data-k="idle">0</span></button>
        <button class="round red big" data-sheet="army"><span class="glyph">${gi('army')}</span><span class="label">Armée</span><span class="badge" data-k="weapons" title="Armes en stock">0</span></button>
        <button class="round blue" data-sheet="diplomacy"><span class="glyph">${gi('diplomacy')}</span><span class="label">Diplomatie</span></button>
      </div>
      <div class="actions-right">
        <button class="round gold big" data-sheet="build"><span class="glyph">${gi('build')}</span><span class="label">Construire</span></button>
      </div>
      <div class="toast"></div>
    `;
    parent.appendChild(this.root);
    this.root.querySelectorAll<HTMLElement>('[data-k]').forEach((el) => this.values.set(el.dataset.k!, el));
    this.toastEl = this.root.querySelector('.toast')!;

    this.sheets = {
      build: new BuildPanel(this.root, (t) => actions.build(t), () => this.toast('Pas assez de ressources')),
      army: new ArmyPanel(this.root, actions),
      diplomacy: new DiplomacyPanel(
        this.root,
        (x, y) => {
          actions.focus(x, y);
          this.openSheet(null);
        },
        getState,
      ),
    };
    for (const sheet of Object.values(this.sheets)) sheet.onClose = () => this.openSheet(null);
    this.selection = new SelectionCard(this.root, () => this.openSheet('army'), (id) => actions.upgrade(id), actions, (id) => actions.cancelConstruction(id));

    this.root.querySelectorAll<HTMLButtonElement>('button[data-sheet]').forEach((btn) => {
      btn.addEventListener('click', () => this.openSheet(btn.dataset.sheet as SheetName));
    });

    this.root.querySelectorAll<HTMLButtonElement>('button[data-act="home"]').forEach((btn) => {
      btn.addEventListener('click', () => actions.home());
    });

    this.root.querySelector<HTMLButtonElement>('[data-act=idle]')!.onclick = () => actions.idle();
    bus.on('notify', ({ message }) => this.toast(message));
    bus.on('building:selected', ({ buildingId }) => {
      this.selection.select(buildingId);
      this.lastRefresh = 0;
    });
  }

  /** Opens one sheet (or none). Bottom buttons and the selection card hide while a sheet is open. */
  openSheet(name: SheetName | null): void {
    const state = this.getState();
    for (const [key, sheet] of Object.entries(this.sheets)) sheet.setOpen(key === name, state);
    this.root.classList.toggle('sheet-open', name !== null);
    document.body.classList.toggle('sheet-open', name !== null);
    if (name) this.selection.select(null);
  }

  /** Keyboard shortcut: opens the sheet, or closes it when it is already open. */
  toggleSheet(name: SheetName): void {
    const open = (Object.entries(this.sheets) as [SheetName, Sheet][]).find(([, sheet]) => sheet.isOpen)?.[0];
    this.openSheet(open === name ? null : name);
  }

  /** Closes the open sheet. Returns false when none was open. */
  closeSheet(): boolean {
    if (!Object.values(this.sheets).some((sheet) => sheet.isOpen)) return false;
    this.openSheet(null);
    return true;
  }

  /** Called every frame; DOM updates are throttled. */
  update(): void {
    const now = performance.now();
    if (now - this.lastRefresh < REFRESH_MS) return;
    this.lastRefresh = now;

    const state = this.getState();
    const v = state.villages[PLAYER_ID];
    const rates = incomeRates(state, PLAYER_ID);
    for (const r of RESOURCE_UI) {
      this.set(r.key, fmt(v.resources[r.key]));
      const rate = rates[r.key];
      this.set(`${r.key}-rate`, Math.abs(rate) >= 0.05 ? `${rate > 0 ? '+' : ''}${rate.toFixed(1)}/s` : '');
    }

    const workers = Object.values(state.villagers).filter(x => x.ownerId === PLAYER_ID).length;
    const army = populationOf(state, PLAYER_ID) - workers;
    const cap = Math.max(1, capacityOf(state, PLAYER_ID));
    this.set('age', v.age === 1 ? 'I · Temps des Clairières' : v.age === 2 ? 'II · Temps des Bourgs' : 'III · Temps des Marches');
    this.set('idle', String(listIdleVillagers(state, PLAYER_ID).length));
    this.set('workers', String(workers));
    this.set('warriors', String(army));
    this.set('housing', `${workers + army}/${cap} (+${reservedOf(state, PLAYER_ID)})`);
    this.root.style.setProperty('--workers', `${(workers / cap) * 100}%`);
    this.root.style.setProperty('--warriors', `${(army / cap) * 100}%`);


    for (const sheet of Object.values(this.sheets)) if (sheet.isOpen) sheet.refresh(state);
    this.selection.refresh(state);
  }

  toast(message: string): void {
    this.toastEl.textContent = message;
    this.toastEl.classList.remove('show');
    void this.toastEl.offsetWidth; // restart the pop animation
    this.toastEl.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), 2200);
  }

  private set(key: string, text: string): void {
    setText(this.values.get(key) ?? null, text);
  }
}
