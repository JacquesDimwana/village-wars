import * as THREE from 'three';
import { BUILDINGS } from '../core/config';
import { PLAYER_ID } from '../core/constants';
import type { EventBus } from '../core/EventBus';
import type { Building, GameState, TilePos, Unit, Villager } from '../core/types';
import { campDisplay, drawnUnitIds, isArmyCamp, recallArmy, sendArmy, soldiersInCamp } from '../systems/ArmySystem';
import { orderBuildingWork } from '../systems/ConstructionSystem';
import { isEnemy, orderAttack } from '../systems/CombatSystem';
import { TILE_RESOURCE, isResourceTile, orderHarvest } from '../systems/GatherSystem';
import type { MovementSystem } from '../systems/MovementSystem';
import { orderGoto } from '../systems/VillagerSystem';
import { RESOURCE_UI, gi } from '../ui/icons';
import type { Hud } from '../ui/Hud';
import type { SelectionCard } from '../ui/SelectionCard';
import { UnitBar } from '../ui/UnitBar';
import type { RtsCamera } from './RtsCamera';

export type MarkerKind = 'move' | 'harvest' | 'assign' | 'attack';

export interface UnitControlDeps {
  parent: HTMLElement;
  canvas: HTMLCanvasElement;
  cam: RtsCamera;
  bus: EventBus;
  movement: MovementSystem;
  getState: () => GameState;
  selection: SelectionCard;
  /** Shared with Game (`game.selectedIds`). */
  selectedIds: Set<string>;
  /** Keyboard shortcuts act on the HUD. */
  hud: Pick<Hud, 'toggleSheet' | 'closeSheet'>;
  /** Centers the camera on the player's town hall. */
  home: () => void;
  /** Player-visible building under a screen point (raycast), for hover and right click. */
  buildingAt: (ndc: THREE.Vector2) => Building | undefined;
}

/** A unit is picked when its projection is closer than this to the finger. */
const PICK_RADIUS_PX = 28;
const MIN_BOX_PX = 4;
const BAR_REFRESH_MS = 200;
const BADGE_REFRESH_MS = 250;
/** Crossed swords over an enemy when soldiers are selected (desktop). */
const ATTACK_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><g stroke="#fff" stroke-width="4" stroke-linecap="round"><path d="M4 4l16 16M20 4L4 20"/></g><g stroke="#d63a2a" stroke-width="2" stroke-linecap="round"><path d="M4 4l16 16M20 4L4 20"/></g></svg>',
)}") 12 12, crosshair`;

interface Badge {
  el: HTMLElement;
  label: string;
  x: number;
  y: number;
  shown: boolean;
}

/**
 * Selection + orders for the player's soldiers and villagers (tap, rectangle, camp "go to war").
 * Only dispatches to the systems' order functions; no game rule lives here.
 */
export class UnitControl {
  /** Optional visual feedback (set by Game once the crowd renderer exists). */
  onMarker?: (tiles: TilePos[], kind: MarkerKind) => void;

  private readonly selectedIds: Set<string>;
  private bar: UnitBar;
  private box: HTMLElement;
  private badgeLayer: HTMLElement;
  private badges = new Map<string, Badge>();
  private badgeTotals = new Map<string, number>();
  private lastBar = 0;
  private lastBadgeCounts = 0;
  private vec = new THREE.Vector3();
  private rect = new DOMRect();
  private lastT = performance.now();
  private hover: { x: number; y: number } | null = null;
  private lastHover: { x: number; y: number } | null = null;
  private cursor = '';

  constructor(private d: UnitControlDeps) {
    this.selectedIds = d.selectedIds;
    this.bar = new UnitBar(d.parent, () => this.clear(), () => this.recall());
    this.box = document.createElement('div');
    this.box.className = 'select-box';
    d.parent.appendChild(this.box);
    this.badgeLayer = document.createElement('div');
    this.badgeLayer.className = 'camp-badges';
    d.parent.insertBefore(this.badgeLayer, d.parent.firstChild);

    d.cam.onBoxStart = (x, y) => this.drawBox(x, y, x, y);
    d.cam.onBoxMove = (x0, y0, x1, y1) => this.drawBox(x0, y0, x1, y1);
    d.cam.onBoxEnd = (x0, y0, x1, y1, additive) => {
      this.box.style.display = 'none';
      if (Math.abs(x1 - x0) < MIN_BOX_PX && Math.abs(y1 - y0) < MIN_BOX_PX) return;
      this.selectInRect(Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1), additive);
    };
    d.cam.onOrder = (ndc) => this.handleOrder(ndc, d.buildingAt(ndc));
    d.cam.onHover = (x, y) => (this.hover = { x, y });
    d.cam.onKey = (key, e) => this.onKey(key, e);

    d.selection.onWar = (campId) => this.goToWar(campId);
    // Building card and unit bar never show together.
    d.bus.on('building:selected', ({ buildingId }) => {
      if (buildingId && this.selectedIds.size > 0) this.clear();
    });
  }

  selectVillager(id: string): void { this.setSelection([id]); }

  clear(): void {
    this.selectedIds.clear();
    this.refreshBar(true);
  }

  /**
   * Called by Game on every tap. `building` = player-visible building under the finger (raycast).
   * Returns true when the tap was used here.
   */
  handleTap(ndc: THREE.Vector2, building: Building | undefined, mouse = false, additive = false): boolean {
    const state = this.d.getState();
    const [cx, cy] = this.toClient(ndc);
    const picked = this.pick(state, cx, cy);
    // Figurines resting in a camp don't steal taps meant for the camp itself (card, "Partir en guerre").
    const restingInTappedCamp = !!picked && !!building && state.units[picked]?.campId === building.id && !state.units[picked].onMission;
    if (picked && !restingInTappedCamp) {
      if (mouse && additive && this.selectedIds.has(picked)) {
        this.selectedIds.delete(picked);
        this.refreshBar(true);
      } else this.setSelection([picked], mouse && additive);
      return true;
    }
    // Same as a tap, so a Mac trackpad needs no right click. Shift only edits the selection.
    if (mouse && additive) return false;
    return this.order(ndc, building, false);
  }

  /** Right click: orders for the current selection (nothing without one). */
  handleOrder(ndc: THREE.Vector2, building: Building | undefined): boolean {
    return this.selectedIds.size > 0 && this.order(ndc, building, true);
  }

  private order(ndc: THREE.Vector2, building: Building | undefined, mouse: boolean): boolean {
    const state = this.d.getState();
    if (this.selectedIds.size === 0) return false;
    const { units, villagers } = this.selected(state);
    if (units.length === 0 && villagers.length === 0) {
      this.clear();
      return false;
    }
    const unitIds = units.map((u) => u.id);

    // Soldiers + enemy warrior / villager / building under the finger = attack it.
    if (unitIds.length > 0) {
      const [cx, cy] = this.toClient(ndc);
      const enemy = this.pickEnemy(state, cx, cy);
      if (enemy) return this.attack(state, unitIds, enemy);
      if (building && isEnemy(state, PLAYER_ID, building.ownerId)) return this.attack(state, unitIds, building.id);
    }

    if (building && building.ownerId === PLAYER_ID && (building.buildProgress < 1 || building.hp < building.maxHp) && villagers.length > 0) {
      orderBuildingWork(state, this.d.movement, villagers, building);
      return true;
    }
    if (building?.type === 'farm' && building.ownerId === PLAYER_ID && orderHarvest(state, this.d.movement, villagers, building.tx, building.ty)) return true;
    if (building) {
      const def = BUILDINGS[building.type];
      if (building.ownerId !== PLAYER_ID || !def.workerSlots || building.buildProgress < 1) {
        if (!mouse) {
          this.clear();
          return false;
        }
        return this.orderGround(ndc, state, units, villagers);
      }
      if (unitIds.length > 0) {
        const spot = { tx: building.tx + Math.floor(def.size / 2), ty: building.ty + def.size };
        this.mark(sendArmy(state, this.d.movement, unitIds, spot), 'move');
      }
      return true;
    }

    return this.orderGround(ndc, state, units, villagers);
  }

  private attack(state: GameState, unitIds: string[], targetId: string): boolean {
    if (orderAttack(state, unitIds, targetId) === 0) return true;
    const u = state.units[targetId];
    const v = state.villagers[targetId];
    const b = state.buildings[targetId];
    const size = b ? BUILDINGS[b.type].size : 1;
    const at = u ?? v ?? (b ? { x: b.tx + Math.floor(size / 2), y: b.ty + Math.floor(size / 2) } : null);
    if (at) this.mark([{ tx: Math.round(at.x), ty: Math.round(at.y) }], 'attack');
    this.notify(b ? `À l’attaque : ${BUILDINGS[b.type].name} !` : 'À l’attaque !');
    return true;
  }

  private orderGround(ndc: THREE.Vector2, state: GameState, units: Unit[], villagers: Villager[]): boolean {
    const unitIds = units.map((u) => u.id);
    const p = this.d.cam.groundPoint(ndc);
    if (!p) return true;
    const tx = Math.floor(p.x);
    const ty = Math.floor(p.z);
    const mv = this.d.movement;
    const terrain = mv.tile(tx, ty);
    if (!mv.terrainWalkable(tx, ty) && !isResourceTile(terrain)) {
      this.notify('Destination inaccessible');
      return true;
    }
    if (isResourceTile(terrain) || Object.values(state.foodSources).some(s => s.tx === tx && s.ty === ty && s.remaining > 0)) {
      if (villagers.length > 0 && orderHarvest(state, mv, villagers, tx, ty)) {
        const some = RESOURCE_UI.find((r) => r.key === (isResourceTile(terrain) ? TILE_RESOURCE[terrain] : 'food'))?.some ?? '';
        this.notify(`Récolte ${some}`);
        this.onMarker?.([{ tx, ty }], 'harvest');
      }
      if (unitIds.length > 0) this.mark(sendArmy(state, mv, unitIds, { tx, ty }), 'move');
      return true;
    }
    if (unitIds.length > 0) this.mark(sendArmy(state, mv, unitIds, { tx, ty }), 'move');
    if (villagers.length > 0) {
      orderGoto(villagers);
      this.mark(mv.moveGroup(state, villagers, tx, ty), 'move');
    }
    return true;
  }

  /** Per-frame: camp badges follow the camera; the bar refreshes a few times per second. */
  update(): void {
    const now = performance.now();
    this.d.cam.update((now - this.lastT) / 1000);
    this.lastT = now;
    const state = this.d.getState();
    this.rect = this.d.canvas.getBoundingClientRect();
    this.d.cam.camera.updateMatrixWorld();
    this.updateBadges(state, now);
    if (now - this.lastBar >= BAR_REFRESH_MS) {
      this.lastBar = now;
      this.refreshBar(false);
      if (!this.hover) this.hover = this.lastHover;
    }
    this.updateCursor(state);
  }

  // ---------- selection ----------

  private setSelection(ids: string[], additive = false): void {
    if (!additive) this.selectedIds.clear();
    for (const id of ids) this.selectedIds.add(id);
    if (ids.length > 0) this.d.bus.emit('building:selected', { buildingId: null });
    this.refreshBar(true);
  }

  private selected(state: GameState): { units: Unit[]; villagers: Villager[] } {
    const units: Unit[] = [];
    const villagers: Villager[] = [];
    for (const id of this.selectedIds) {
      const u = state.units[id];
      const v = state.villagers[id];
      if (u && u.ownerId === PLAYER_ID) units.push(u);
      else if (v && v.ownerId === PLAYER_ID && !v.inside) villagers.push(v);
    }
    return { units, villagers };
  }

  /** Player's drawn soldiers and visible villagers with their screen position. */
  private screenEntities(state: GameState): { id: string; x: number; y: number }[] {
    const out: { id: string; x: number; y: number }[] = [];
    this.rect = this.d.canvas.getBoundingClientRect();
    this.d.cam.camera.updateMatrixWorld();
    const push = (id: string, x: number, y: number): void => {
      const s = this.project(x + 0.5, 0.5, y + 0.5);
      if (s) out.push({ id, x: s[0], y: s[1] });
    };
    for (const id of drawnUnitIds(state)) {
      const u = state.units[id];
      if (u && u.ownerId === PLAYER_ID) push(id, u.x, u.y);
    }
    for (const v of Object.values(state.villagers)) {
      if (v.ownerId === PLAYER_ID && !v.inside) push(v.id, v.x, v.y);
    }
    return out;
  }

  /** Nearest drawn enemy (non-allied) warrior or visible villager under a screen point. */
  private pickEnemy(state: GameState, cx: number, cy: number): string | null {
    let best: string | null = null;
    let bestD = PICK_RADIUS_PX;
    const consider = (id: string, ownerId: string, x: number, y: number): void => {
      if (!isEnemy(state, PLAYER_ID, ownerId)) return;
      const s = this.project(x + 0.5, 0.5, y + 0.5);
      if (!s) return;
      const dist = Math.hypot(s[0] - cx, s[1] - cy);
      if (dist < bestD) (bestD = dist, (best = id));
    };
    for (const id of drawnUnitIds(state)) {
      const u = state.units[id];
      if (u) consider(id, u.ownerId, u.x, u.y);
    }
    if (best) return best; // warriors win over villagers standing next to them
    for (const v of Object.values(state.villagers)) if (!v.inside) consider(v.id, v.ownerId, v.x, v.y);
    return best;
  }

  private pick(state: GameState, cx: number, cy: number): string | null {
    let best: string | null = null;
    let bestD = PICK_RADIUS_PX;
    for (const e of this.screenEntities(state)) {
      const dist = Math.hypot(e.x - cx, e.y - cy);
      if (dist < bestD) (bestD = dist, (best = e.id));
    }
    return best;
  }

  private selectInRect(x0: number, y0: number, x1: number, y1: number, additive: boolean): void {
    const ids = this.screenEntities(this.d.getState())
      .filter((e) => e.x >= x0 && e.x <= x1 && e.y >= y0 && e.y <= y1)
      .map((e) => e.id);
    if (ids.length > 0) this.setSelection(ids, additive);
    else if (!additive) this.clear();
  }

  private drawBox(x0: number, y0: number, x1: number, y1: number): void {
    const s = this.box.style;
    s.display = 'block';
    s.left = `${Math.min(x0, x1)}px`;
    s.top = `${Math.min(y0, y1)}px`;
    s.width = `${Math.abs(x1 - x0)}px`;
    s.height = `${Math.abs(y1 - y0)}px`;
  }

  // ---------- desktop: keyboard shortcuts + cursors ----------

  private onKey(key: string, e: KeyboardEvent): void {
    if ((e.ctrlKey || e.metaKey) && key === 'a') {
      e.preventDefault();
      this.selectAllVisibleSoldiers();
    } else if (e.ctrlKey || e.metaKey || e.altKey) return;
    else if (key === 'escape') {
      if (this.d.hud.closeSheet()) return;
      if (this.selectedIds.size > 0) this.clear();
      else this.d.selection.select(null);
    } else if (key === 'b') this.d.hud.toggleSheet('build');
    else if (key === 'a') this.d.hud.toggleSheet('army');
    else if (key === ' ') {
      e.preventDefault();
      this.d.home();
    }
  }

  private selectAllVisibleSoldiers(): void {
    const state = this.d.getState();
    const r = this.rect;
    const ids = this.screenEntities(state)
      .filter((s) => state.units[s.id] && s.x >= r.left && s.x <= r.right && s.y >= r.top && s.y <= r.bottom)
      .map((s) => s.id);
    if (ids.length > 0) this.setSelection(ids);
    else this.notify('Aucun soldat visible');
  }

  /** Hand over what can be selected; order cursor over ground / resources when a selection is active. */
  private updateCursor(state: GameState): void {
    const h = this.hover;
    if (!h) return;
    this.hover = null;
    this.lastHover = h;
    if (this.d.canvas.style.cursor === 'grabbing') return;
    let next = '';
    const r = this.d.canvas.getBoundingClientRect();
    if (h.x >= r.left && h.x <= r.right && h.y >= r.top && h.y <= r.bottom) {
      const ndc = new THREE.Vector2(((h.x - r.left) / r.width) * 2 - 1, -((h.y - r.top) / r.height) * 2 + 1);
      const hovered = this.d.buildingAt(ndc);
      const enemyHovered =
        this.selectedIds.size > 0 && (!!this.pickEnemy(state, h.x, h.y) || (!!hovered && isEnemy(state, PLAYER_ID, hovered.ownerId)));
      if (enemyHovered) next = ATTACK_CURSOR;
      else if (this.pick(state, h.x, h.y) || hovered) next = 'pointer';
      else if (this.selectedIds.size > 0) {
        const p = this.d.cam.groundPoint(ndc);
        next = p && isResourceTile(this.d.movement.tile(Math.floor(p.x), Math.floor(p.z))) ? 'cell' : 'crosshair';
      }
    }
    if (next !== this.cursor) {
      this.cursor = next;
      this.d.canvas.style.cursor = next;
    }
  }

  // ---------- orders from the UI ----------

  private recall(): void {
    const { units } = this.selected(this.d.getState());
    const out = units.filter((u) => u.onMission).map((u) => u.id);
    if (out.length === 0) return;
    recallArmy(this.d.getState(), out);
    this.notify('Les soldats rentrent au camp');
  }

  private goToWar(campId: string): void {
    const soldiers = soldiersInCamp(this.d.getState(), campId);
    if (soldiers.length === 0) {
      this.notify('Aucun soldat dans ce camp');
      return;
    }
    this.setSelection(soldiers.map((u) => u.id));
    this.notify('Touche une destination');
  }

  // ---------- bar ----------

  private refreshBar(force: boolean): void {
    const state = this.d.getState();
    const { units, villagers } = this.selected(state);
    // Drop ids that vanished (killed, demobilized, went inside a building).
    if (units.length + villagers.length !== this.selectedIds.size) {
      this.selectedIds.clear();
      for (const e of [...units, ...villagers]) this.selectedIds.add(e.id);
    }
    const open = this.selectedIds.size > 0;
    this.bar.setOpen(open);
    if (!open && !force) return;
    const detail: string[] = [];
    if (villagers.length === 1 && units.length === 0) {
      detail.push(this.villagerState(state, villagers[0]));
    }
    this.bar.render({
      knights: units.filter((u) => u.type === 'knight').length,
      archers: units.filter((u) => u.type === 'archer').length,
      villagers: villagers.length,
      canRecall: units.some((u) => u.onMission),
      detail,
    });
  }

  private villagerState(state: GameState, v: Villager): string {
    if (v.harvest) {
      const t = this.d.movement.tile(v.harvest.tx, v.harvest.ty);
      const some = isResourceTile(t) ? RESOURCE_UI.find((r) => r.key === TILE_RESOURCE[t])?.some : undefined;
      return some ? `Récolte ${some}` : 'Récolte';
    }
    const job = state.buildings[v.pinnedJobId ?? v.jobId ?? ''];
    if (job && v.task !== 'goto' && v.task !== 'wander') return `Travaille à : ${BUILDINGS[job.type].name}`;
    if (v.task === 'goto') return 'Se déplace';
    return 'Inactif';
  }

  // ---------- camp badges ----------

  private updateBadges(state: GameState, now: number): void {
    const refreshTotals = now - this.lastBadgeCounts >= BADGE_REFRESH_MS;
    if (refreshTotals) this.lastBadgeCounts = now;
    const seen = new Set<string>();
    for (const b of Object.values(state.buildings)) {
      if (b.ownerId !== PLAYER_ID || !isArmyCamp(b)) continue;
      seen.add(b.id);
      if (refreshTotals || !this.badgeTotals.has(b.id)) this.badgeTotals.set(b.id, campDisplay(state, b.id).total);
      const total = this.badgeTotals.get(b.id) ?? 0;
      let badge = this.badges.get(b.id);
      if (!badge) {
        const el = document.createElement('div');
        el.className = 'camp-badge';
        this.badgeLayer.appendChild(el);
        badge = { el, label: '', x: NaN, y: NaN, shown: false };
        this.badges.set(b.id, badge);
      }
      const size = BUILDINGS[b.type].size;
      const s = total > 0 ? this.project(b.tx + size / 2, 2.2, b.ty + size / 2) : null;
      if (!s) {
        if (badge.shown) (badge.el.style.display = 'none', (badge.shown = false));
        continue;
      }
      const label = `${gi('sword')}${total}`;
      if (label !== badge.label) (badge.el.innerHTML = label, (badge.label = label));
      if (!badge.shown) (badge.el.style.display = 'flex', (badge.shown = true));
      const x = Math.round(s[0] - this.rect.left);
      const y = Math.round(s[1] - this.rect.top);
      if (x !== badge.x || y !== badge.y) {
        badge.x = x;
        badge.y = y;
        badge.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
      }
    }
    for (const [id, badge] of this.badges) {
      if (seen.has(id)) continue;
      badge.el.remove();
      this.badges.delete(id);
      this.badgeTotals.delete(id);
    }
  }

  // ---------- projection ----------

  /** World point → client px, or null when behind the camera or off screen. */
  private project(x: number, y: number, z: number): [number, number] | null {
    this.vec.set(x, y, z).project(this.d.cam.camera);
    if (this.vec.z > 1 || Math.abs(this.vec.x) > 1.1 || Math.abs(this.vec.y) > 1.1) return null;
    const r = this.rect;
    return [r.left + ((this.vec.x + 1) / 2) * r.width, r.top + ((1 - this.vec.y) / 2) * r.height];
  }

  private toClient(ndc: THREE.Vector2): [number, number] {
    const r = this.d.canvas.getBoundingClientRect();
    return [r.left + ((ndc.x + 1) / 2) * r.width, r.top + ((1 - ndc.y) / 2) * r.height];
  }

  /** Feedback only; the order itself is already given (never put an order call inside an optional call's arguments). */
  private mark(tiles: TilePos[], kind: MarkerKind): void {
    this.onMarker?.(tiles, kind);
  }

  private notify(message: string): void {
    this.d.bus.emit('notify', { message });
  }
}
