import { VILLAGER } from '../core/config';
import { nextId } from '../core/GameState';
import type { GameState, Villager } from '../core/types';
import type { MovementSystem } from './MovementSystem';
export function listIdleVillagers(state: GameState, villageId: string): Villager[] {
  return Object.values(state.villagers).filter(v => v.ownerId === villageId && v.task === 'idle' && !v.harvest && v.path.length === 0);
}
export function spawnVillager(state: GameState, ownerId: string, x: number, y: number): Villager {
 const v: Villager = { id: nextId(state, 'v'), ownerId, x, y, path: [], jobId: null, pinnedJobId: null, harvest: null, task: 'idle', target: null, timerMs: 0, carrying: null, enlistable: true, inside: false, hp: VILLAGER.hp };
 state.villagers[v.id] = v; return v;
}
export function killVillager(state: GameState, id: string): void { delete state.villagers[id]; }
export function orderGoto(villagers: Villager[]): void { for (const v of villagers) { v.harvest = null; v.jobId = null; v.pinnedJobId = null; v.task = 'goto'; v.target = null; } }
export class VillagerSystem {
 constructor(_movement: MovementSystem) {}
 update(state: GameState, _dtMs: number): void { for (const v of Object.values(state.villagers)) if (v.task === 'goto' && v.path.length === 0) v.task = 'idle'; }
}
