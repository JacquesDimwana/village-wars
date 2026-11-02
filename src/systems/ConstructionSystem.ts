import { BUILDINGS, GAME } from '../core/config';
import type { EventBus } from '../core/EventBus';
import { addBuilding } from '../core/GameState';
import type { Building, BuildingType, Cost, GameState, TileType } from '../core/types';
import { isBuildable } from '../world/WorldGen';
import { canAfford, spend } from './EconomySystem';

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
    if (b.ownerId === villageId && gap(tx, ty, size, b.tx, b.ty, bs) <= GAME.buildRadius) nearVillage = true;
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

/** Advances construction sites by dt / buildTimeMs; emits building:completed when one finishes. */
export class ConstructionSystem {
  constructor(private bus?: EventBus) {}

  update(state: GameState, dtMs: number): void {
    for (const b of Object.values(state.buildings)) {
      if (b.buildProgress >= 1) continue;
      const time = BUILDINGS[b.type].buildTimeMs;
      b.buildProgress = time > 0 ? Math.min(1, b.buildProgress + dtMs / time) : 1;
      if (b.buildProgress >= 1) {
        this.bus?.emit('building:completed', { buildingId: b.id });
        this.bus?.emit('population:changed', { villageId: b.ownerId });
      }
    }
  }
}
