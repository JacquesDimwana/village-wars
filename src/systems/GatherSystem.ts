import { BUILDINGS, RESOURCES, VILLAGER } from '../core/config';
import type { EventBus } from '../core/EventBus';
import type { Building, GameState, ResourceType, TilePos, TileType, Villager } from '../core/types';
import { addResources } from './EconomySystem';
import type { MovementSystem } from './MovementSystem';
import { tileOf } from './MovementSystem';

export type ResourceTile = keyof typeof RESOURCES.tileAmounts;

/** What each harvestable tile gives. */
export const TILE_RESOURCE: Record<ResourceTile, ResourceType> = { forest: 'wood', rock: 'stone', ore: 'ore' };

export const isResourceTile = (t: TileType): t is ResourceTile => t in TILE_RESOURCE;

const depletionKey = (tx: number, ty: number): string => `${tx},${ty}`;

/** Amount left on a resource tile (full until first harvested). */
export function tileRemaining(state: GameState, tx: number, ty: number, type: ResourceTile): number {
  return state.depletion[depletionKey(tx, ty)] ?? RESOURCES.tileAmounts[type];
}

/** Takes up to `amount` from a tile. Returns what was really taken. */
export function harvestTile(state: GameState, tx: number, ty: number, type: ResourceTile, amount: number): number {
  const left = tileRemaining(state, tx, ty, type);
  const taken = Math.min(left, amount);
  state.depletion[depletionKey(tx, ty)] = left - taken;
  return taken;
}

/** Up to `count` non-depleted tiles of `type` around (cx, cy), nearest first. */
export function nearestResourceTiles(
  state: GameState,
  movement: MovementSystem,
  cx: number,
  cy: number,
  type: ResourceTile,
  count: number,
  radius: number = VILLAGER.searchRadius,
): TilePos[] {
  const found: { t: TilePos; d: number }[] = [];
  const r = Math.ceil(radius);
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  for (let ty = y0 - r; ty <= y0 + r; ty++) {
    for (let tx = x0 - r; tx <= x0 + r; tx++) {
      const d = Math.hypot(tx + 0.5 - cx, ty + 0.5 - cy);
      if (d > radius + 0.5 || movement.tile(tx, ty) !== type) continue;
      if (tileRemaining(state, tx, ty, type) <= 0) continue;
      found.push({ t: { tx, ty }, d });
    }
  }
  return found.sort((a, b) => a.d - b.d).slice(0, count).map((f) => f.t);
}

/** Buildings that accept a resource tile's harvest: its producer (lumber camp for forest…) and the town hall. */
export function isDepot(b: Building, type: ResourceTile): boolean {
  if (b.buildProgress < 1) return false;
  return b.type === 'townHall' || BUILDINGS[b.type].requiresNearbyTile?.type === type;
}

function nearestDepot(state: GameState, v: Villager, type: ResourceTile): Building | undefined {
  let best: Building | undefined;
  let bestD = Infinity;
  for (const b of Object.values(state.buildings)) {
    if (b.ownerId !== v.ownerId || !isDepot(b, type)) continue;
    const half = BUILDINGS[b.type].size / 2;
    const d = Math.hypot(b.tx + half - v.x, b.ty + half - v.y);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best;
}

/**
 * Player order: the villagers leave their job and gather the tapped resource tile
 * (each takes its own tile around it when several are sent). Returns false if the tile
 * can't be harvested.
 */
export function orderHarvest(state: GameState, movement: MovementSystem, villagers: Villager[], tx: number, ty: number): boolean {
  const type = movement.tile(tx, ty);
  if (!isResourceTile(type) || villagers.length === 0) return false;
  const tiles = nearestResourceTiles(state, movement, tx + 0.5, ty + 0.5, type, villagers.length, 4);
  if (tiles.length === 0) return false;
  villagers.forEach((v, i) => {
    const keepLoad = v.harvest && v.carrying?.type === TILE_RESOURCE[type];
    v.harvest = tiles[i % tiles.length];
    v.pinnedJobId = null;
    v.jobId = null;
    v.task = 'idle';
    v.target = v.harvest;
    v.path = [];
    v.timerMs = 0;
    if (!keepLoad) v.carrying = null;
  });
  return true;
}

/**
 * Manual harvesting (player orders only). Gathers `gatherPerSecond` from the tile into
 * the villager's load, depletes `state.depletion`, and credits the village when the load
 * reaches the nearest depot. A depleted tile sends the villager to the closest tile of the
 * same type, or back to an automatic job.
 */
export class GatherSystem {
  constructor(
    private movement: MovementSystem,
    private bus?: EventBus,
  ) {}

  update(state: GameState, dtMs: number): void {
    for (const v of Object.values(state.villagers)) {
      if (v.harvest) this.step(state, v, dtMs);
    }
  }

  private step(state: GameState, v: Villager, dtMs: number): void {
    const h = v.harvest!;
    const type = this.movement.tile(h.tx, h.ty);
    if (!isResourceTile(type)) {
      this.stop(v);
      return;
    }
    const capacity = VILLAGER.carryCapacity;
    switch (v.task) {
      case 'toWork': {
        if (v.path.length > 0) return;
        const t = tileOf(v);
        if (t.tx === h.tx && t.ty === h.ty) {
          v.task = 'working';
          v.timerMs = 0;
        } else this.stop(v); // unreachable
        return;
      }
      case 'working': {
        if (tileRemaining(state, h.tx, h.ty, type) <= 0) {
          if (v.carrying && v.carrying.amount > 0) this.goDrop(state, v, type);
          else this.retarget(state, v, type);
          return;
        }
        v.timerMs += dtMs;
        const msPerUnit = 1000 / VILLAGER.gatherPerSecond;
        v.carrying ??= { type: TILE_RESOURCE[type], amount: 0 };
        while (v.timerMs >= msPerUnit && v.carrying.amount < capacity) {
          v.timerMs -= msPerUnit;
          v.carrying.amount += harvestTile(state, h.tx, h.ty, type, 1);
          if (tileRemaining(state, h.tx, h.ty, type) <= 0) break;
        }
        if (v.carrying.amount >= capacity || tileRemaining(state, h.tx, h.ty, type) <= 0) this.goDrop(state, v, type);
        return;
      }
      case 'returning': {
        if (v.path.length > 0) return;
        const depot = nearestDepot(state, v, type);
        if (depot && this.movement.isNextTo(v, depot)) {
          this.credit(state, v);
          if (tileRemaining(state, h.tx, h.ty, type) <= 0) this.retarget(state, v, type);
          else this.goGather(state, v);
        } else if (depot && this.movement.moveNextTo(state, v, depot)) {
          // Depot changed while walking (built / destroyed): keep going.
        } else this.stop(v);
        return;
      }
      default:
        if (v.carrying && v.carrying.amount >= capacity) this.goDrop(state, v, type);
        else this.goGather(state, v);
    }
  }

  private goGather(state: GameState, v: Villager): void {
    const h = v.harvest!;
    v.target = h;
    this.movement.moveTo(state, v, h.tx, h.ty);
    v.task = 'toWork';
  }

  private goDrop(state: GameState, v: Villager, type: ResourceTile): void {
    const depot = nearestDepot(state, v, type);
    if (!depot) {
      this.stop(v);
      return;
    }
    v.task = 'returning';
    this.movement.moveNextTo(state, v, depot);
  }

  private retarget(state: GameState, v: Villager, type: ResourceTile): void {
    const h = v.harvest!;
    const next = nearestResourceTiles(state, this.movement, h.tx + 0.5, h.ty + 0.5, type, 1)[0];
    if (!next) {
      if (state.villages[v.ownerId]?.isPlayer) {
        this.bus?.emit('notify', { message: 'Plus rien à récolter ici : le villageois reprend son poste' });
      }
      this.stop(v);
      return;
    }
    v.harvest = next;
    this.goGather(state, v);
  }

  private credit(state: GameState, v: Villager): void {
    const load = v.carrying;
    v.carrying = null;
    if (!load || load.amount <= 0) return;
    const village = state.villages[v.ownerId];
    addResources(village, { [load.type]: load.amount });
    this.bus?.emit('resources:changed', { villageId: village.id, resources: { ...village.resources } });
  }

  /** Back to automatic work (VillagerSystem picks a job next tick). */
  private stop(v: Villager): void {
    v.harvest = null;
    v.task = 'idle';
    v.target = null;
    v.carrying = null;
    v.path = [];
  }
}
