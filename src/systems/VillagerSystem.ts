import { BUILDINGS, VILLAGER } from '../core/config';
import { nextId, townHallOf } from '../core/GameState';
import { hash2 } from '../core/rng';
import type { Building, GameState, ResourceType, TilePos, Villager } from '../core/types';
import { TILE_RESOURCE, nearestResourceTiles, type ResourceTile } from './GatherSystem';
import type { MovementSystem } from './MovementSystem';
import { assignWorkers, civilians } from './PopulationSystem';

const RESOURCE_TILE = Object.fromEntries(
  Object.entries(TILE_RESOURCE).map(([tile, res]) => [res, tile]),
) as Partial<Record<ResourceType, ResourceTile>>;

/** Auto workers spread over this many nearest resource tiles of their building. */
const SPREAD = 4;

const idNum = (id: string): number => Number(id.split('-')[1]) || 0;

/** Villager slot priority when one must leave (converted into a warrior): jobless first, then town hall workers. */
function removalScore(state: GameState, v: Villager): number {
  if (v.harvest || v.pinnedJobId) return 3;
  if (!v.jobId) return 0;
  return state.buildings[v.jobId]?.type === 'townHall' ? 1 : 2;
}

export function spawnVillager(state: GameState, ownerId: string, x: number, y: number): Villager {
  const v: Villager = {
    id: nextId(state, 'v'),
    ownerId,
    x,
    y,
    path: [],
    jobId: null,
    pinnedJobId: null,
    harvest: null,
    task: 'idle',
    target: null,
    timerMs: 0,
    carrying: null,
  };
  state.villagers[v.id] = v;
  return v;
}

/** Player order: pin villagers to a production building (they get its slots first). Returns how many were pinned. */
export function orderAssign(state: GameState, villagers: Villager[], buildingId: string): number {
  const b = state.buildings[buildingId];
  const slots = b ? BUILDINGS[b.type].workerSlots ?? 0 : 0;
  if (!b || slots === 0 || b.buildProgress < 1) return 0;
  const chosen = villagers.filter((v) => v.ownerId === b.ownerId).slice(0, slots);
  const chosenIds = new Set(chosen.map((v) => v.id));
  // Newest orders win: older pins on this building beyond the slots are released.
  let room = slots - chosen.length;
  for (const v of Object.values(state.villagers)) {
    if (v.pinnedJobId !== b.id || chosenIds.has(v.id)) continue;
    if (room > 0) room--;
    else v.pinnedJobId = null;
  }
  for (const v of chosen) {
    v.pinnedJobId = b.id;
    v.harvest = null;
    resetTask(v);
  }
  return chosen.length;
}

/** Player order: walk somewhere, wait a bit, then resume the automatic job. Path is set by MovementSystem.moveGroup. */
export function orderGoto(villagers: Villager[]): void {
  for (const v of villagers) {
    v.harvest = null;
    v.carrying = null;
    v.task = 'goto';
    v.target = null;
    v.timerMs = VILLAGER.wanderPauseMs * 2;
  }
}

function resetTask(v: Villager): void {
  v.task = 'idle';
  v.target = null;
  v.timerMs = 0;
  v.carrying = null;
  v.path = [];
}

/**
 * Keeps one visible villager per whole civilian, maps them onto the jobs given by
 * assignWorkers, and animates the automatic work: trips between the building and a
 * nearby resource tile (cosmetic: production stays EconomySystem's prorata rule), or a
 * stroll around the town hall for the jobless. Manual harvests are GatherSystem's.
 */
export class VillagerSystem {
  /** Nearest resource tiles per building (world data, not game state). */
  private tileCache = new Map<string, TilePos[]>();

  constructor(private movement: MovementSystem) {}

  update(state: GameState, dtMs: number): void {
    for (const village of Object.values(state.villages)) {
      const mine = Object.values(state.villagers).filter((v) => v.ownerId === village.id);
      if (!village.alive) {
        for (const v of mine) delete state.villagers[v.id];
        continue;
      }
      this.syncCount(state, village.id, mine);
      this.assignJobs(state, village.id);
    }
    for (const v of Object.values(state.villagers)) {
      if (!v.harvest) this.autoWork(state, v, dtMs);
    }
  }

  private syncCount(state: GameState, villageId: string, mine: Villager[]): void {
    const want = civilians(state, villageId);
    if (mine.length > want) {
      const leaving = [...mine]
        .sort((a, b) => removalScore(state, a) - removalScore(state, b) || idNum(b.id) - idNum(a.id))
        .slice(0, mine.length - want);
      for (const v of leaving) delete state.villagers[v.id];
    } else if (mine.length < want) {
      const hall = townHallOf(state, villageId);
      if (!hall) return;
      const size = BUILDINGS.townHall.size;
      const door = this.movement.freeTilesAround(state, hall.tx + Math.floor(size / 2), hall.ty + size, 1)[0];
      const at = door ?? { tx: hall.tx, ty: hall.ty + size };
      for (let i = mine.length; i < want; i++) spawnVillager(state, villageId, at.tx, at.ty);
    }
  }

  /** Gives each villager a concrete building matching the assignWorkers counts (stable between ticks). */
  private assignJobs(state: GameState, villageId: string): void {
    const room = assignWorkers(state, villageId);
    const list = Object.values(state.villagers).filter((v) => v.ownerId === villageId && !v.harvest);
    for (const v of list) {
      if (v.pinnedJobId && !room.has(v.pinnedJobId)) v.pinnedJobId = null;
    }
    const placed = new Set<string>();
    const take = (v: Villager, buildingId: string | null | undefined): boolean => {
      if (!buildingId || placed.has(v.id) || (room.get(buildingId) ?? 0) <= 0) return false;
      room.set(buildingId, room.get(buildingId)! - 1);
      placed.add(v.id);
      if (v.jobId !== buildingId) {
        v.jobId = buildingId;
        if (v.task !== 'goto') resetTask(v);
      }
      return true;
    };
    for (const v of list) take(v, v.pinnedJobId);
    for (const v of list) take(v, v.jobId);
    for (const v of list) {
      if (placed.has(v.id)) continue;
      for (const id of room.keys()) if (take(v, id)) break;
    }
    for (const v of list) {
      if (placed.has(v.id) || v.jobId === null) continue;
      v.jobId = null;
      if (v.task !== 'goto') resetTask(v);
    }
  }

  private autoWork(state: GameState, v: Villager, dtMs: number): void {
    if (v.task === 'goto') {
      if (v.path.length > 0) return;
      v.timerMs -= dtMs;
      if (v.timerMs <= 0) resetTask(v);
      return;
    }
    const job = v.jobId ? state.buildings[v.jobId] : undefined;
    if (!job) {
      this.wander(state, v, dtMs);
      return;
    }
    switch (v.task) {
      case 'idle': {
        const tile = this.workTile(state, v, job);
        v.target = tile;
        if (tile) this.movement.moveTo(state, v, tile.tx, tile.ty);
        else this.movement.moveNextTo(state, v, job);
        v.task = 'toWork';
        return;
      }
      case 'toWork':
        if (v.path.length > 0) return;
        v.task = 'working';
        v.timerMs = VILLAGER.workMs;
        return;
      case 'working':
        v.timerMs -= dtMs;
        if (v.timerMs > 0) return;
        if (!v.target) {
          v.timerMs = VILLAGER.workMs; // smelter / armory workers stay at their building
          return;
        }
        v.carrying = { type: TILE_RESOURCE[this.movement.tile(v.target.tx, v.target.ty) as ResourceTile] ?? 'wood', amount: VILLAGER.carryCapacity };
        this.movement.moveNextTo(state, v, job);
        v.task = 'returning';
        return;
      case 'returning':
        if (v.path.length > 0) return;
        resetTask(v);
        return;
      default:
        resetTask(v);
    }
  }

  /** Resource tile this worker walks to (null = works at the building door). */
  private workTile(state: GameState, v: Villager, job: Building): TilePos | null {
    const produced = Object.keys(BUILDINGS[job.type].produces ?? {}) as ResourceType[];
    const types = produced.map((r) => RESOURCE_TILE[r]).filter((t): t is ResourceTile => !!t);
    const n = idNum(v.id);
    for (let i = 0; i < types.length; i++) {
      const type = types[(n + i) % types.length];
      const tiles = this.nearTiles(state, job, type);
      if (tiles.length > 0) return tiles[n % Math.min(SPREAD, tiles.length)];
    }
    return null;
  }

  private nearTiles(state: GameState, b: Building, type: ResourceTile): TilePos[] {
    const key = `${b.id}:${type}`;
    let tiles = this.tileCache.get(key);
    // Refresh when a cached tile got depleted by manual harvesting.
    if (!tiles || tiles.some((t) => (state.depletion[`${t.tx},${t.ty}`] ?? 1) <= 0)) {
      const half = BUILDINGS[b.type].size / 2;
      tiles = nearestResourceTiles(state, this.movement, b.tx + half, b.ty + half, type, SPREAD);
      this.tileCache.set(key, tiles);
    }
    return tiles;
  }

  private wander(state: GameState, v: Villager, dtMs: number): void {
    if (v.task === 'wander') {
      if (v.path.length > 0) return;
      v.task = 'idle';
      v.timerMs = VILLAGER.wanderPauseMs * (0.5 + hash2(idNum(v.id), Math.floor(state.timeMs), state.seed));
      return;
    }
    if (v.task !== 'idle') resetTask(v);
    v.timerMs -= dtMs;
    if (v.timerMs > 0) return;
    const hall = townHallOf(state, v.ownerId);
    if (!hall) return;
    const half = BUILDINGS.townHall.size / 2;
    const r = VILLAGER.wanderRadius;
    const a = hash2(idNum(v.id), Math.floor(state.timeMs / 100), state.seed) * Math.PI * 2;
    const d = half + 1 + hash2(Math.floor(state.timeMs / 100), idNum(v.id), state.seed) * r;
    const tx = Math.floor(hall.tx + half + Math.cos(a) * d);
    const ty = Math.floor(hall.ty + half + Math.sin(a) * d);
    const spot = this.movement.freeTilesAround(state, tx, ty, 1, 2)[0];
    if (spot) this.movement.moveTo(state, v, spot.tx, spot.ty);
    v.task = 'wander';
  }
}
