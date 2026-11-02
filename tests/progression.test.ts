import { describe, it, expect } from 'vitest';
import { createGameState, addBuilding, addUnit, townHallOf } from '../src/core/GameState';
import { WorldGen } from '../src/world/WorldGen';
import { MovementSystem } from '../src/systems/MovementSystem';
import { TrainingSystem, queueTraining, cancelTraining, reservedOf } from '../src/systems/TrainingSystem';
import { ProgressionSystem, queueAge, queueResearch, cancelResearch } from '../src/systems/ProgressionSystem';
import { hitDamage } from '../src/systems/CombatSystem';

describe('âges et armurerie', () => {
 it('partage la file FIFO, suspend les prérequis et rembourse', () => {
  const world = new WorldGen(42), state = createGameState(world), v = state.villages.player, hall = townHallOf(state, 'player')!;
  Object.assign(v.resources, { food: 2000, wood: 2000, iron: 2000 });
  const mill = addBuilding(state, 'mill', 'player', 8, 8, true); addBuilding(state, 'barracks', 'player', 12, 8, true);
  expect(queueTraining(state, hall.id, 'villager')).toBe(true); expect(queueAge(state, hall.id)).toBe(true); expect(queueAge(state, hall.id)).toBe(false); expect(reservedOf(state, 'player')).toBe(1);
  const sys = new TrainingSystem(new MovementSystem((x,y) => world.getTile(x,y)));
  sys.update(state, 20000); mill.buildProgress = 0; sys.update(state, 90000); expect(v.age).toBe(1);
  mill.buildProgress = 1; sys.update(state, 90000); expect(v.age).toBe(2);
  addBuilding(state, 'armory', 'player', 15, 8, true); addBuilding(state, 'tower', 'player', 20, 8, true);
  const food = v.resources.food; expect(queueAge(state, hall.id)).toBe(true); expect(cancelTraining(state, hall.id, 0)).toBe(true); expect(v.resources.food).toBe(food);
 });
 it('interdit les doublons, rembourse et applique les bonus aux unités présentes et futures', () => {
  const state = createGameState(new WorldGen(42)), v = state.villages.player; v.age = 3; Object.assign(v.resources, { food: 2000, wood: 2000, iron: 2000 });
  const a = addBuilding(state, 'armory', 'player', 8, 8, true), b = addBuilding(state, 'armory', 'player', 12, 8, true);
  const unit = addUnit(state, 'spearman', 'player', 2, 2), enemy = addUnit(state, 'knight', 'ai-1', 3, 3);
  expect(queueResearch(state, a.id, 'sharpIron')).toBe(true); expect(queueResearch(state, b.id, 'sharpIron')).toBe(false);
  expect(cancelResearch(state, a.id, 0)).toBe(true); expect(queueResearch(state, b.id, 'sharpIron')).toBe(true); expect(queueResearch(state, b.id, 'rivetedMail')).toBe(true);
  new ProgressionSystem().update(state, 105000); expect(unit.hp).toBe(110); expect(addUnit(state, 'spearman', 'player', 4, 4).maxHp).toBe(110);
  expect(hitDamage(unit, { kind: 'unit', e: enemy, ownerId: 'ai-1' }, state)).toBe(15);
 });
});
