import { BUILDINGS, RESOURCES, VILLAGER } from '../core/config';
import type { EventBus } from '../core/EventBus';
import type { Building, GameState, ResourceType, TilePos, TileType, Villager } from '../core/types';
import { addResources } from './EconomySystem';
import type { MovementSystem } from './MovementSystem';
import { tileOf } from './MovementSystem';

export type ResourceTile = 'forest' | 'rock' | 'iron';

/** What each harvestable tile gives. */
export const TILE_RESOURCE: Record<ResourceTile, ResourceType> = { forest: 'wood', rock: 'stone', iron: 'iron' };

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

type SourceType = ResourceTile | 'berry' | 'animal' | 'farm';
const resourceOf = (type: SourceType): ResourceType => type === 'forest' ? 'wood' : type === 'rock' ? 'stone' : type === 'iron' ? 'iron' : 'food';
export function isDepot(b: Building, type: SourceType): boolean {
  const resource = resourceOf(type);
  return b.buildProgress >= 1 && (b.type === 'townHall' || (b.type === 'lumberCamp' && resource === 'wood') || (b.type === 'minerCamp' && (resource === 'stone' || resource === 'iron')) || (b.type === 'mill' && resource === 'food'));
}
export function orderHarvest(state: GameState, movement: MovementSystem, villagers: Villager[], tx: number, ty: number): boolean {
  const source = Object.values(state.foodSources).find(s => s.tx === tx && s.ty === ty && s.remaining > 0);
  const farm = Object.values(state.buildings).find(b => b.type === 'farm' && b.buildProgress >= 1 && tx >= b.tx && ty >= b.ty && tx < b.tx + BUILDINGS.farm.size && ty < b.ty + BUILDINGS.farm.size);
  const tile = movement.tile(tx, ty);
  if (!source && !farm && !isResourceTile(tile)) return false;
  if (farm && Object.values(state.villagers).some(v => v.harvest?.sourceId === farm.id && !villagers.includes(v))) return false;
  const selected = farm ? villagers.slice(0, 1) : villagers;
  for (const v of selected) {
    v.harvest = source ? { tx, ty, sourceType: source.type, sourceId: source.id } : farm ? { tx: farm.tx, ty: farm.ty, sourceType: 'farm', sourceId: farm.id } : { tx, ty, sourceType: tile as ResourceTile };
    v.jobId = null; v.pinnedJobId = null; v.task = 'idle'; v.target = null; v.path = []; v.timerMs = 0;
  }
  return selected.length > 0;
}
export class GatherSystem {
  constructor(private movement: MovementSystem, private bus?: EventBus) {}
  update(state: GameState, dtMs: number): void {
    for (const v of Object.values(state.villagers)) if (v.harvest) this.step(state, v, dtMs);
  }
  private step(state: GameState, v: Villager, dtMs: number): void {
    const h = v.harvest!;
    const terrain = this.movement.tile(h.tx, h.ty);
    const type = h.sourceType ?? (isResourceTile(terrain) ? terrain : null);
    if (!type) { this.stop(v); return; }
    const source = h.sourceId ? state.foodSources[h.sourceId] : undefined;
    const farm = type === 'farm' && h.sourceId ? state.buildings[h.sourceId] : undefined;
    const remaining = (): number => type === 'farm' ? (farm && farm.buildProgress >= 1 ? Infinity : 0) : source ? source.remaining : (type === 'forest' || type === 'rock' || type === 'iron') ? tileRemaining(state, h.tx, h.ty, type) : 0;
    if (v.task === 'returning') {
      if (v.path.length) return;
      const depot = Object.values(state.buildings).find(b => b.ownerId === v.ownerId && isDepot(b, v.carrying?.type === 'food' ? 'berry' : v.carrying?.type === 'wood' ? 'forest' : v.carrying?.type === 'stone' ? 'rock' : 'iron') && this.movement.isNextTo(v, b));
      if (depot && v.carrying) { const gained = v.carrying.amount; addResources(state.villages[v.ownerId], { [v.carrying.type]: gained }); v.carrying = null; this.bus?.emit('resources:changed', { villageId: v.ownerId, resources: { ...state.villages[v.ownerId].resources }, gained }); v.task = 'idle'; }
      else { this.drop(state, v); return; }
    }
    if (v.task === 'toWork') {
      if (v.path.length) return;
      const at = tileOf(v);
      if (farm ? this.movement.isNextTo(v, farm) : at.tx === h.tx && at.ty === h.ty) v.task = 'working';
      else { this.stop(v); return; }
    }
    if (remaining() <= 0) {
      if (v.carrying?.amount) { this.drop(state, v); return; }
      let next: Villager['harvest'] = null;
      if (type === 'berry' || type === 'animal') {
        const candidate = Object.values(state.foodSources).filter(s => s.type === type && s.remaining > 0).sort((a,b) => Math.hypot(a.tx-v.x,a.ty-v.y)-Math.hypot(b.tx-v.x,b.ty-v.y))[0];
        if (candidate) next = { tx: candidate.tx, ty: candidate.ty, sourceType: candidate.type, sourceId: candidate.id };
      } else if ((type === 'forest' || type === 'rock' || type === 'iron')) { const tile = nearestResourceTiles(state, this.movement, v.x, v.y, type, 1)[0]; next = tile ? { ...tile, sourceType: type } : null; }
      if (!next) { this.stop(v); return; } v.harvest = next; v.task = 'idle'; return;
    }
    if (v.carrying && (v.carrying.type !== resourceOf(type) || v.carrying.amount >= VILLAGER.carryCapacity)) { this.drop(state, v); return; }
    if (v.task !== 'working') {
      const at = tileOf(v);
      const ok = farm ? (this.movement.isNextTo(v, farm) || this.movement.moveNextTo(state, v, farm)) : ((at.tx === h.tx && at.ty === h.ty) || this.movement.moveTo(state, v, h.tx, h.ty));
      if (!ok) { this.stop(v); return; } v.task = 'toWork'; return;
    }
    v.timerMs += dtMs;
    if (source?.type === 'animal' && source.hits < RESOURCES.animalHits) {
      while (v.timerMs >= RESOURCES.animalHitIntervalMs && source.hits < RESOURCES.animalHits) { v.timerMs -= RESOURCES.animalHitIntervalMs; source.hits++; }
      if (source.hits < RESOURCES.animalHits) return;
    }
    const perUnit = 1000 / RESOURCES.gatherRates[type];
    v.carrying ??= { type: resourceOf(type), amount: 0 };
    while (v.timerMs >= perUnit && v.carrying.amount < VILLAGER.carryCapacity && remaining() > 0) {
      v.timerMs -= perUnit;
      const amount = Math.min(1, remaining());
      if (source) source.remaining -= amount; else if ((type === 'forest' || type === 'rock' || type === 'iron')) harvestTile(state, h.tx, h.ty, type, amount);
      v.carrying.amount += amount;
    }
    if (v.carrying.amount >= VILLAGER.carryCapacity || remaining() <= 0) this.drop(state, v);
  }
  private drop(state: GameState, v: Villager): void {
    const type: SourceType = v.carrying?.type === 'food' ? 'berry' : v.carrying?.type === 'wood' ? 'forest' : v.carrying?.type === 'stone' ? 'rock' : 'iron';
    const depots = Object.values(state.buildings).filter(b => b.ownerId === v.ownerId && isDepot(b, type)).sort((a,b) => Math.hypot(a.tx-v.x,a.ty-v.y)-Math.hypot(b.tx-v.x,b.ty-v.y));
    for (const depot of depots) {
      if (this.movement.isNextTo(v, depot)) { v.task = 'returning'; return; }
      if (this.movement.moveNextTo(state, v, depot)) {
        const end = v.path[v.path.length - 1];
        if (this.movement.isNextTo({ ...v, x: end.tx, y: end.ty }, depot)) { v.task = 'returning'; return; }
      }
    }
    v.task = 'idle'; v.path = [];
  }
  private stop(v: Villager): void { v.harvest = null; v.task = 'idle'; v.target = null; v.path = []; }
}
