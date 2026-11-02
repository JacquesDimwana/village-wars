import type { Cost, ResourceType, Village, GameState } from '../core/types';
const RESOURCE_TYPES: ResourceType[] = ['food', 'wood', 'stone', 'iron'];
export function canAfford(village: Village, cost: Cost): boolean {
  return RESOURCE_TYPES.every((r) => village.resources[r] >= (cost[r] ?? 0));
}

/** Deducts the cost. Returns false (and changes nothing) if the village can't afford it. */
export function spend(village: Village, cost: Cost): boolean {
  if (!canAfford(village, cost)) return false;
  for (const r of RESOURCE_TYPES) village.resources[r] -= cost[r] ?? 0;
  return true;
}

export function addResources(village: Village, gain: Cost): void {
  for (const r of RESOURCE_TYPES) village.resources[r] += gain[r] ?? 0;
}

export function incomeRates(_state: GameState, _villageId: string): Record<ResourceType, number> { return {food: 0, wood: 0, stone: 0, iron: 0}; }
export function timeToAfford(
  village: Village,
  cost: Cost,
  rates: Record<ResourceType, number>,
): number | { missing: ResourceType } {
  let wait = 0;
  for (const r of RESOURCE_TYPES) {
    const lack = (cost[r] ?? 0) - village.resources[r];
    if (lack <= 0) continue;
    if (rates[r] <= 0) return { missing: r };
    wait = Math.max(wait, lack / rates[r]);
  }
  return wait;
}

