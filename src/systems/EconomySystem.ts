import { BUILDINGS, RESOURCES } from '../core/config';
import type { EventBus } from '../core/EventBus';
import type { Cost, GameState, ResourceType, Village } from '../core/types';
import { assignWorkers, staffing } from './PopulationSystem';

const RESOURCE_TYPES: ResourceType[] = ['wood', 'stone', 'ore', 'iron'];

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

/** Resources per second a village currently produces (used by the HUD and the AI). */
export function productionRates(state: GameState, villageId: string): Record<ResourceType, number> {
  const rates: Record<ResourceType, number> = { wood: 0, stone: 0, ore: 0, iron: 0 };
  const assignment = assignWorkers(state, villageId);
  for (const b of Object.values(state.buildings)) {
    if (b.ownerId !== villageId || b.buildProgress < 1) continue;
    const produces = BUILDINGS[b.type].produces;
    if (!produces) continue;
    const ratio = staffing(b, assignment);
    for (const [res, rate] of Object.entries(produces) as [ResourceType, number][]) rates[res] += rate * ratio;
  }
  return rates;
}

/**
 * Net income per second, smelters included (iron gained, ore consumed).
 * For display and planning only: the economy itself uses productionRates + smelt().
 */
export function incomeRates(state: GameState, villageId: string): Record<ResourceType, number> {
  const rates = productionRates(state, villageId);
  const assignment = assignWorkers(state, villageId);
  const speed = Object.values(state.buildings)
    .filter((b) => b.ownerId === villageId && b.buildProgress >= 1 && BUILDINGS[b.type].smelts)
    .reduce((sum, b) => sum + staffing(b, assignment), 0);
  const { orePerIron, intervalMs } = RESOURCES.smelter;
  const iron = Math.min(speed / (intervalMs / 1000), (rates.ore + state.villages[villageId].resources.ore) / orePerIron);
  rates.iron += iron;
  rates.ore -= iron * orePerIron;
  return rates;
}

/**
 * Seconds until the village can pay `cost` at the given income,
 * or the first missing resource that isn't being produced at all.
 */
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

/**
 * Production from staffed buildings + smelter conversion.
 * Output scales with workers: fewer civilians (converted into warriors) = less production.
 * Resources are whole numbers; fractions accumulate in `village.production`.
 */
export class EconomySystem {
  constructor(private bus?: EventBus) {}

  update(state: GameState, dtMs: number): void {
    const dt = dtMs / 1000;
    for (const village of Object.values(state.villages)) {
      if (!village.alive) continue;
      let gained = 0;
      const rates = productionRates(state, village.id);
      for (const r of RESOURCE_TYPES) {
        village.production[r] += rates[r] * dt;
        const whole = Math.floor(village.production[r]);
        if (whole > 0) {
          village.resources[r] += whole;
          village.production[r] -= whole;
          gained += whole;
        }
      }
      gained += this.smelt(state, village, dtMs);
      if (gained > 0) {
        this.bus?.emit('resources:changed', { villageId: village.id, resources: { ...village.resources }, gained });
      }
    }
  }

  /** Staffed smelters convert `orePerIron` ore → 1 iron every `intervalMs` (scaled by staffing). Returns iron made. */
  private smelt(state: GameState, village: Village, dtMs: number): number {
    const assignment = assignWorkers(state, village.id);
    const speed = Object.values(state.buildings)
      .filter((b) => b.ownerId === village.id && b.buildProgress >= 1 && BUILDINGS[b.type].smelts)
      .reduce((sum, b) => sum + staffing(b, assignment), 0);
    if (speed === 0) {
      village.smelterTimerMs = 0;
      return 0;
    }
    village.smelterTimerMs += dtMs * speed;
    const { orePerIron, intervalMs } = RESOURCES.smelter;
    let made = 0;
    while (village.smelterTimerMs >= intervalMs) {
      village.smelterTimerMs -= intervalMs;
      if (village.resources.ore < orePerIron) continue;
      village.resources.ore -= orePerIron;
      village.resources.iron += 1;
      made += 1;
    }
    return made;
  }
}
