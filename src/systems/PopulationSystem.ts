import { BUILDINGS, RESOURCES, UNITS } from '../core/config';
import type { EventBus } from '../core/EventBus';
import { addUnit } from '../core/GameState';
import type { Building, GameState, Unit, UnitType } from '../core/types';

/** Housing capacity = `population` of completed buildings (town hall levels included). */
export function housingCap(state: GameState, villageId: string): number {
  let cap = 0;
  for (const b of Object.values(state.buildings)) {
    if (b.ownerId !== villageId || b.buildProgress < 1) continue;
    const def = BUILDINGS[b.type];
    cap += def.population ?? 0;
    for (const l of def.levels ?? []) if (l.level > 1 && l.level <= b.level) cap += l.population ?? 0;
  }
  return cap;
}

export function warriors(state: GameState, villageId: string): Unit[] {
  return Object.values(state.units).filter((u) => u.ownerId === villageId);
}

/** Whole civilians available to work. */
export function civilians(state: GameState, villageId: string): number {
  return Math.floor(state.villages[villageId].inhabitants);
}

/** Total population = civilians + warriors. Must stay ≤ housing cap. */
export function totalPopulation(state: GameState, villageId: string): number {
  return civilians(state, villageId) + warriors(state, villageId).length;
}

/**
 * Assigns civilians to jobs. Villagers the player pinned to a building get a slot there
 * first; then producer buildings are filled in construction order, the town hall (weak
 * fallback production) last. Villagers on a manual harvest order hold no job.
 * Returns buildingId → workers assigned.
 */
export function assignWorkers(state: GameState, villageId: string): Map<string, number> {
  const jobs = Object.values(state.buildings)
    .filter((b) => b.ownerId === villageId && b.buildProgress >= 1 && (BUILDINGS[b.type].workerSlots ?? 0) > 0)
    .sort((a, b) => Number(a.type === 'townHall') - Number(b.type === 'townHall') || idNum(a) - idNum(b));
  let free = civilians(state, villageId);
  const pinned = new Map<string, number>();
  for (const v of Object.values(state.villagers)) {
    if (v.ownerId !== villageId) continue;
    if (v.harvest) free--;
    else if (v.pinnedJobId) pinned.set(v.pinnedJobId, (pinned.get(v.pinnedJobId) ?? 0) + 1);
  }
  free = Math.max(0, free);
  const result = new Map<string, number>();
  for (const b of jobs) {
    const n = Math.min(free, BUILDINGS[b.type].workerSlots ?? 0, pinned.get(b.id) ?? 0);
    result.set(b.id, n);
    free -= n;
  }
  for (const b of jobs) {
    const n = Math.min(free, (BUILDINGS[b.type].workerSlots ?? 0) - result.get(b.id)!);
    result.set(b.id, result.get(b.id)! + n);
    free -= n;
  }
  return result;
}

/** 0..1 staffing ratio of a building given an assignment. */
export function staffing(b: Building, assignment: Map<string, number>): number {
  const slots = BUILDINGS[b.type].workerSlots ?? 0;
  return slots === 0 ? 0 : (assignment.get(b.id) ?? 0) / slots;
}

const idNum = (b: Building): number => Number(b.id.split('-')[1]);

export type ConvertResult = 'ok' | 'no-civilian' | 'no-weapon' | 'no-barracks';

/**
 * Turns 1 civilian + 1 weapon into a warrior next to a completed barracks.
 * The civilian stops working → that village produces less.
 */
export function convertToWarrior(
  state: GameState,
  villageId: string,
  type: UnitType,
  bus?: EventBus,
): ConvertResult {
  const village = state.villages[villageId];
  const barracks = Object.values(state.buildings).find(
    (b) => b.ownerId === villageId && b.buildProgress >= 1 && BUILDINGS[b.type].converts?.includes(type),
  );
  if (!barracks) return 'no-barracks';
  if (civilians(state, villageId) < 1) return 'no-civilian';
  const weapon = UNITS[type].weapon;
  if (village.weapons[weapon] < 1) return 'no-weapon';

  village.inhabitants -= 1;
  village.weapons[weapon] -= 1;
  const slot = formationSlot(barracks, warriors(state, villageId).length);
  addUnit(state, type, villageId, slot.x, slot.y);
  bus?.emit('population:changed', { villageId });
  return 'ok';
}

const FORMATION_COLUMNS = 5;
const FORMATION_SPACING = 0.9;

/** Idle warriors line up in rows in front of the barracks (visible "army camp"). */
export function formationSlot(barracks: Building, index: number): { x: number; y: number } {
  const size = BUILDINGS[barracks.type].size;
  const col = index % FORMATION_COLUMNS;
  const row = Math.floor(index / FORMATION_COLUMNS);
  return {
    x: barracks.tx + size / 2 - 0.5 + (col - (FORMATION_COLUMNS - 1) / 2) * FORMATION_SPACING,
    y: barracks.ty + size + 0.3 + row * FORMATION_SPACING,
  };
}

/** Sends a warrior back to work. Its weapon is returned to stock. */
export function demobilize(state: GameState, unitId: string, bus?: EventBus): boolean {
  const unit = state.units[unitId];
  if (!unit) return false;
  const village = state.villages[unit.ownerId];
  village.inhabitants += 1;
  village.weapons[UNITS[unit.type].weapon] += 1;
  delete state.units[unitId];
  bus?.emit('population:changed', { villageId: village.id });
  return true;
}

/** Civilians grow over time while there is free housing. */
export class PopulationSystem {
  constructor(private bus?: EventBus) {}

  update(state: GameState, dtMs: number): void {
    for (const village of Object.values(state.villages)) {
      if (!village.alive) continue;
      const room = housingCap(state, village.id) - warriors(state, village.id).length;
      const before = Math.floor(village.inhabitants);
      if (village.inhabitants < room) {
        village.inhabitants = Math.min(room, village.inhabitants + RESOURCES.population.growthPerSecond * (dtMs / 1000));
      }
      if (Math.floor(village.inhabitants) !== before) this.bus?.emit('population:changed', { villageId: village.id });
    }
  }
}
