import { BUILDINGS, PROGRESSION } from '../core/config';
import type { GameState, UpgradeType } from '../core/types';
import type { EventBus } from '../core/EventBus';
import { addResources, canAfford, spend } from './EconomySystem';

export function ageReason(state: GameState, hallId: string): string {
 const hall = state.buildings[hallId];
 if (!hall || hall.type !== 'townHall' || hall.buildProgress < 1) return 'Hôtel de ville indisponible';
 const v = state.villages[hall.ownerId];
 if (!v.alive || v.age === 3) return 'Âge maximal atteint';
 if (hall.trainingQueue?.some(i => i.type === 'age')) return 'Passage déjà en file';
 const def = PROGRESSION.ages[(v.age + 1) as 2 | 3];
 const missing = def.requires.filter(type => !Object.values(state.buildings).some(b => b.ownerId === v.id && b.type === type && b.buildProgress >= 1));
 if (missing.length) return `Bâtiments requis : ${missing.map(t => BUILDINGS[t].name).join(', ')}`;
 return canAfford(v, def.cost) ? '' : 'Ressources insuffisantes';
}
export function queueAge(state: GameState, hallId: string): boolean {
 if (ageReason(state, hallId)) return false;
 const hall = state.buildings[hallId], v = state.villages[hall.ownerId], def = PROGRESSION.ages[(v.age + 1) as 2 | 3];
 spend(v, def.cost); (hall.trainingQueue ??= []).push({ type: 'age', remainingMs: def.durationMs }); return true;
}
export function prerequisitesMet(state: GameState, hallId: string): boolean {
 const hall = state.buildings[hallId], v = state.villages[hall.ownerId];
 if (v.age === 3) return false;
 return PROGRESSION.ages[(v.age + 1) as 2 | 3].requires.every(type => Object.values(state.buildings).some(b => b.ownerId === v.id && b.type === type && b.buildProgress >= 1));
}
export function queueResearch(state: GameState, id: string, type: UpgradeType): boolean {
 const b = state.buildings[id]; if (!b || b.type !== 'armory' || b.buildProgress < 1) return false;
 const v = state.villages[b.ownerId], def = PROGRESSION.upgrades[type];
 if (!v.alive || v.age < def.age || v.upgrades.includes(type) || Object.values(state.buildings).some(x => x.ownerId === v.id && x.researchQueue?.some(i => i.type === type)) || !spend(v, def.cost)) return false;
 (b.researchQueue ??= []).push({ type, remainingMs: def.durationMs }); return true;
}
export function cancelResearch(state: GameState, id: string, index: number): boolean {
 const b = state.buildings[id], item = b?.researchQueue?.[index]; if (!b || !item || !Number.isInteger(index)) return false;
 b.researchQueue!.splice(index, 1); addResources(state.villages[b.ownerId], PROGRESSION.upgrades[item.type].cost); return true;
}
export class ProgressionSystem {
 constructor(private bus?: EventBus) {}
 update(state: GameState, dtMs: number): void {
  for (const b of Object.values(state.buildings)) {
   if (b.buildProgress < 1 || !b.researchQueue?.length) continue;
   let budget = dtMs;
   while (b.researchQueue.length && budget > 0) {
    const item = b.researchQueue[0], elapsed = Math.min(budget, item.remainingMs); item.remainingMs -= elapsed; budget -= elapsed;
    if (item.remainingMs > 0) break;
    b.researchQueue.shift(); const v = state.villages[b.ownerId], def = PROGRESSION.upgrades[item.type]; v.upgrades.push(item.type);
    for (const u of Object.values(state.units)) if (u.ownerId === v.id && def.units.includes(u.type)) { u.maxHp += def.hp; u.hp += def.hp; }
    if (v.isPlayer) this.bus?.emit('notify', { message: `${def.name} : recherche terminée` });
   }
  }
 }
}
