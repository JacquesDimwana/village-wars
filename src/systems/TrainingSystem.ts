import { BUILDINGS, GAME, UNITS, VILLAGER, PROGRESSION } from '../core/config';
import { addUnit } from '../core/GameState';
import type { GameState, UnitType } from '../core/types';
import { addResources, spend } from './EconomySystem';
import { prerequisitesMet } from './ProgressionSystem';
import type { EventBus } from '../core/EventBus';
import { spawnVillager } from './VillagerSystem';
import type { MovementSystem } from './MovementSystem';
export type TrainingType = UnitType | 'villager';
const definition = (type: TrainingType) => type === 'villager' ? VILLAGER : UNITS[type];
export function populationOf(state: GameState, villageId: string): number {
 return Object.values(state.villagers).filter(v => v.ownerId === villageId).length + Object.values(state.units).filter(u => u.ownerId === villageId).length;
}
export function capacityOf(state: GameState, villageId: string): number {
 const houses = Object.values(state.buildings).filter(b => b.ownerId === villageId && b.type === 'house' && b.buildProgress >= 1).length;
 return Math.min(GAME.population.max, GAME.population.base + GAME.population.perHouse * houses);
}
export function reservedOf(state: GameState, villageId: string): number {
 return Object.values(state.buildings).filter(b => b.ownerId === villageId).reduce((n,b) => n + (b.trainingQueue?.filter(i => i.type !== 'age').length ?? 0), 0);
}
export function queueTraining(state: GameState, buildingId: string, type: TrainingType): boolean {
 const b = state.buildings[buildingId];
 if (!b || b.buildProgress < 1 || (type === 'villager' ? b.type !== 'townHall' : b.type !== 'barracks')) return false;
 const village = state.villages[b.ownerId];
 if (!village?.alive || (type !== 'villager' && village.age < (PROGRESSION.unitAge[type] ?? 1)) || populationOf(state,b.ownerId) + reservedOf(state,b.ownerId) >= capacityOf(state,b.ownerId) || !spend(village, definition(type).cost)) return false;
 (b.trainingQueue ??= []).push({type, remainingMs: definition(type).trainTimeMs}); return true;
}
export function cancelTraining(state: GameState, buildingId: string, index: number): boolean {
 const b = state.buildings[buildingId]; const item = b?.trainingQueue?.[index];
 if (!b || !item || !Number.isInteger(index)) return false;
 b.trainingQueue!.splice(index,1); addResources(state.villages[b.ownerId], item.type === 'age' ? PROGRESSION.ages[(state.villages[b.ownerId].age + 1) as 2 | 3].cost : definition(item.type).cost); return true;
}
export function refundTraining(state: GameState, buildingId: string): void {
 const b = state.buildings[buildingId]; if (!b) return;
 while (b.trainingQueue?.length) cancelTraining(state, buildingId, 0);
}
export class TrainingSystem {
 constructor(private movement: MovementSystem, private bus?: EventBus) {}
 update(state: GameState, dtMs: number): void {
  for (const b of Object.values(state.buildings)) {
   if (b.buildProgress < 1 || !b.trainingQueue?.length) continue;
   let budget = dtMs;
   while (b.trainingQueue.length && budget >= 0) {
    const item = b.trainingQueue[0];
    if (item.type === 'age' ? !prerequisitesMet(state, b.id) : populationOf(state,b.ownerId) + reservedOf(state,b.ownerId) > capacityOf(state,b.ownerId)) break;
    const elapsed = Math.min(budget, item.remainingMs); item.remainingMs -= elapsed; budget -= elapsed;
    if (item.remainingMs > 0) break;
    if (item.type === 'age') {
     b.trainingQueue.shift(); const v = state.villages[b.ownerId]; v.age = (v.age + 1) as 2 | 3;
     this.bus?.emit('notify', { message: `${v.name} : ${PROGRESSION.ages[v.age].name} !` });
     if (budget === 0) break; continue;
    }
    const size = BUILDINGS[b.type].size;
    const spot = this.movement.freeTilesAround(state, b.tx + Math.floor(size / 2), b.ty + size, 1, size + 1)[0];
    if (!spot) break;
    b.trainingQueue.shift();
    if (item.type === 'villager') spawnVillager(state,b.ownerId,spot.tx,spot.ty);
    else { const unit = addUnit(state,item.type,b.ownerId,spot.tx,spot.ty); if (b.rallyPoint && this.movement.moveTo(state,unit,b.rallyPoint.tx,b.rallyPoint.ty)) unit.onMission = true; }
    if (budget === 0) break;
   }
  }
 }
}
