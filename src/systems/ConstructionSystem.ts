import { PROGRESSION, BUILDINGS, GAME } from '../core/config';
import type { EventBus } from '../core/EventBus';
import { addBuilding } from '../core/GameState';
import type { Building, BuildingType, Cost, GameState, TileType, Villager, ResourceType } from '../core/types';
import { isBuildable } from '../world/WorldGen';
import type { MovementSystem } from './MovementSystem';
import { addResources, canAfford, spend } from './EconomySystem';

/** Anything that can tell the terrain at a tile (WorldGen, or a stub in tests). */
export interface TileSource {
  getTile(tx: number, ty: number): TileType;
}

export type PlaceCheck = { ok: true } | { ok: false; reason: string };

/** Tiles between two footprints (0 = touching or overlapping), Chebyshev distance. */
function gap(ax: number, ay: number, as: number, bx: number, by: number, bs: number): number {
  const dx = Math.max(0, bx - (ax + as - 1), ax - (bx + bs - 1));
  const dy = Math.max(0, by - (ay + as - 1), ay - (by + bs - 1));
  return Math.max(dx, dy);
}

const overlaps = (ax: number, ay: number, as: number, bx: number, by: number, bs: number): boolean =>
  ax < bx + bs && bx < ax + as && ay < by + bs && by < ay + as;

/**
 * Whether `villageId` may start a `type` building with its top-left tile at (tx, ty).
 * Rules (GDD §5): grass/sand only, no overlap, within buildRadius of one of the village's
 * buildings, required resource tile nearby, and enough resources.
 */
export function canPlace(
  state: GameState,
  world: TileSource,
  type: BuildingType,
  tx: number,
  ty: number,
  villageId: string,
): PlaceCheck {
  const def = BUILDINGS[type];
  const village = state.villages[villageId];
  if (!village?.alive) return { ok: false, reason: 'Village détruit' };
  if (village.age < (PROGRESSION.buildingAge[type] ?? 1)) return { ok: false, reason: 'Disponible au Temps des Bourgs' };
  if (type === 'townHall') return { ok: false, reason: 'Un seul hôtel de ville par village' };

  const size = def.size;
  for (let y = ty; y < ty + size; y++) {
    for (let x = tx; x < tx + size; x++) {
      if (Object.values(state.foodSources).some(source => source.tx === x && source.ty === y && source.remaining > 0)) return { ok: false, reason: 'Emplacement occupé' };
      if (!isBuildable(world.getTile(x, y)) && !(state.depletion[`${x},${y}`] !== undefined && state.depletion[`${x},${y}`] <= 0)) return { ok: false, reason: 'Terrain non constructible' };
    }
  }

  let nearVillage = false;
  for (const b of Object.values(state.buildings)) {
    const bs = BUILDINGS[b.type].size;
    if (overlaps(tx, ty, size, b.tx, b.ty, bs)) return { ok: false, reason: 'Emplacement occupé' };
    if (b.ownerId === villageId && b.buildProgress >= 1 && gap(tx, ty, size, b.tx, b.ty, bs) <= GAME.buildRadius) nearVillage = true;
  }
  if (!nearVillage) return { ok: false, reason: 'Trop loin du village' };

  if (!canAfford(village, def.cost)) return { ok: false, reason: 'Pas assez de ressources' };
  return { ok: true };
}

/** Pays the cost and starts a construction site (buildProgress 0). */
export function placeBuilding(
  state: GameState,
  world: TileSource,
  type: BuildingType,
  tx: number,
  ty: number,
  villageId: string,
  bus?: EventBus,
): { ok: true; building: Building } | { ok: false; reason: string } {
  const check = canPlace(state, world, type, tx, ty, villageId);
  if (!check.ok) return check;
  const village = state.villages[villageId];
  spend(village, BUILDINGS[type].cost);
  const building = addBuilding(state, type, villageId, tx, ty);
  // Units never block construction (canPlace ignores them).
  // MovementSystem evicts units from new building footprints on its next update.
  bus?.emit('resources:changed', { villageId, resources: { ...village.resources } });
  bus?.emit('building:placed', { buildingId: building.id, type, villageId });
  return { ok: true, building };
}

/** Next town hall level and its cost, or null at max level. */
export function nextLevel(b: Building): { level: number; cost: Cost } | null {
  const next = BUILDINGS[b.type].levels?.find((l) => l.level === b.level + 1);
  return next ? { level: next.level, cost: next.cost } : null;
}

/** Upgrades a completed building that has levels (town hall). Instant: no build time in the config. */
export function upgradeBuilding(state: GameState, buildingId: string, bus?: EventBus): PlaceCheck {
  const b = state.buildings[buildingId];
  if (!b || b.buildProgress < 1) return { ok: false, reason: 'Bâtiment indisponible' };
  const next = BUILDINGS[b.type].levels?.find((l) => l.level === b.level + 1);
  if (!next) return { ok: false, reason: 'Niveau maximum atteint' };
  const village = state.villages[b.ownerId];
  if (!spend(village, next.cost)) return { ok: false, reason: 'Pas assez de ressources' };
  b.level = next.level;
  b.maxHp += next.hpBonus ?? 0;
  b.hp += next.hpBonus ?? 0;
  bus?.emit('resources:changed', { villageId: village.id, resources: { ...village.resources } });
  bus?.emit('population:changed', { villageId: village.id });
  return { ok: true };
}

/** Assign villagers to a friendly site or damaged completed building. */
export function orderBuildingWork(state: GameState, movement: MovementSystem, villagers: Villager[], b: Building): number {
  if (b.buildProgress >= 1 && b.hp >= b.maxHp) return 0;
  let assigned = 0;
  for (const v of villagers) {
    if (v.ownerId !== b.ownerId || v.inside) continue;
    v.harvest = null; v.pinnedJobId = null; v.jobId = b.id; v.target = null; v.path = [];
    if (movement.isNextTo(v, b)) v.task = 'working';
    else if (movement.moveNextTo(state, v, b)) v.task = 'toWork';
    else { v.jobId = null; v.task = 'idle'; continue; }
    assigned++;
  }
  return assigned;
}

function stop(v: Villager): void { v.jobId = null; v.task = 'idle'; v.path = []; }

export function cancelConstruction(state: GameState, buildingId: string, bus?: EventBus): boolean {
  const b = state.buildings[buildingId];
  if (!b || b.buildProgress >= 1) return false;
  const refund: Cost = {};
  for (const r of ['food', 'wood', 'stone', 'iron'] as ResourceType[]) refund[r] = Math.floor((BUILDINGS[b.type].cost[r] ?? 0) * GAME.construction.cancelRefundFactor);
  addResources(state.villages[b.ownerId], refund);
  delete state.buildings[b.id];
  for (const v of Object.values(state.villagers)) if (v.jobId === b.id) stop(v);
  bus?.emit('resources:changed', { villageId: b.ownerId, resources: { ...state.villages[b.ownerId].resources } });
  return true;
}

export class ConstructionSystem {
  constructor(private bus?: EventBus, private movement?: MovementSystem) {}
  update(state: GameState, dtMs: number): void {
    const workers = Object.values(state.villagers).filter(v => v.jobId && !v.harvest);
    for (const v of workers) {
      const b = state.buildings[v.jobId!];
      if (!b || b.ownerId !== v.ownerId || (b.buildProgress >= 1 && b.hp >= b.maxHp)) { stop(v); continue; }
      if (this.movement && !this.movement.isNextTo(v, b)) {
        if (v.path.length === 0 && !this.movement.moveNextTo(state, v, b)) { stop(v); continue; }
        v.task = 'toWork';
      } else v.task = 'working';
    }
    for (const b of Object.values(state.buildings)) {
      const present = workers.filter(v => v.jobId === b.id && v.task === 'working');
      const n = Math.min(present.length, GAME.construction.maxWorkers);
      if (!n) continue;
      const rate = 1 + GAME.construction.additionalWorkerFactor * (n - 1);
      if (b.buildProgress < 1) {
        b.buildProgress = Math.min(1, b.buildProgress + dtMs * rate / BUILDINGS[b.type].buildTimeMs);
        if (b.buildProgress >= 1) {
          for (const v of workers) if (v.jobId === b.id) stop(v);
          this.bus?.emit('building:completed', { buildingId: b.id });
          this.bus?.emit('population:changed', { villageId: b.ownerId });
        }
      } else {
        const village = state.villages[b.ownerId];
        const resources: ResourceType[] = ['food', 'wood', 'stone', 'iron'];
        let hp = Math.min(b.maxHp - b.hp, GAME.construction.repairHpPerSecond * rate * dtMs / 1000);
        for (const r of resources) {
          const perHp = (BUILDINGS[b.type].cost[r] ?? 0) * GAME.construction.repairCostFactor / b.maxHp;
          if (perHp > 0) hp = Math.min(hp, village.resources[r] / perHp);
        }
        if (hp <= 0) { for (const v of present) v.task = 'idle'; continue; }
        for (const r of resources) village.resources[r] = Math.max(0, village.resources[r] - hp * (BUILDINGS[b.type].cost[r] ?? 0) * GAME.construction.repairCostFactor / b.maxHp);
        b.hp = Math.min(b.maxHp, b.hp + hp);
        this.bus?.emit('resources:changed', { villageId: b.ownerId, resources: { ...village.resources } });
        if (b.hp >= b.maxHp) for (const v of workers) if (v.jobId === b.id) stop(v);
      }
    }
  }
}
