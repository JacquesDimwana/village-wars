import { describe, expect, it } from 'vitest';
import { createGameState, townHallOf } from '../src/core/GameState';
import { PLAYER_ID } from '../src/core/constants';
import { WorldGen } from '../src/world/WorldGen';
import { MovementSystem } from '../src/systems/MovementSystem';
import { TrainingSystem, populationOf, queueTraining } from '../src/systems/TrainingSystem';
import { ConstructionSystem, placeBuilding } from '../src/systems/ConstructionSystem';
import { GatherSystem, nearestResourceTiles, orderHarvest } from '../src/systems/GatherSystem';
import { VillagerSystem, listIdleVillagers } from '../src/systems/VillagerSystem';
import type { BuildingType } from '../src/core/types';

describe('rythme économique', () => {
 it('développe un village avec des ordres de récolte et des constructions', () => {
  const world = new WorldGen(42), state = createGameState(world);
  const movement = new MovementSystem((x,y) => world.getTile(x,y));
  const training = new TrainingSystem(movement), construction = new ConstructionSystem(), gather = new GatherSystem(movement), villagers = new VillagerSystem(movement);
  const hall = townHallOf(state, PLAYER_ID)!;
  const plan: BuildingType[] = ['house', 'lumberCamp', 'mill', 'minerCamp', 'barracks'];
  const placed = new Set<BuildingType>();
  const completed: Partial<Record<BuildingType, number>> = {};
  for (let ms = 0; ms < 600000; ms += 500) {
   if (ms % 2000 === 0) {
    if (populationOf(state, PLAYER_ID) + (hall.trainingQueue?.length ?? 0) < 10) queueTraining(state, hall.id, 'villager');
    const next = plan.find(t => !placed.has(t));
    if (next) {
     let done = false;
     for (let r = 1; r <= 12 && !done; r++) for (let y = hall.ty-r; y <= hall.ty+r && !done; y++) for (let x = hall.tx-r; x <= hall.tx+r && !done; x++) {
      if (Math.max(Math.abs(x-hall.tx), Math.abs(y-hall.ty)) !== r) continue;
      if (placeBuilding(state, world, next, x, y, PLAYER_ID).ok) { placed.add(next); done = true; }
     }
    }
    for (const v of listIdleVillagers(state, PLAYER_ID)) {
     const workers = Object.values(state.villagers).filter(w => w.ownerId === PLAYER_ID && w.harvest);
     const kinds = ['berry', 'forest', 'forest', 'berry', 'rock', 'iron'] as const;
     const kind = kinds[workers.length % kinds.length];
     const target = kind === 'berry' ? Object.values(state.foodSources).filter(s => s.type === 'berry' && s.remaining > 0).sort((a,b) => Math.hypot(a.tx-v.x,a.ty-v.y)-Math.hypot(b.tx-v.x,b.ty-v.y))[0] : nearestResourceTiles(state, movement, v.x, v.y, kind, 1)[0];
     if (target) orderHarvest(state, movement, [v], target.tx, target.ty);
    }
   }
   training.update(state, 500); construction.update(state, 500); villagers.update(state, 500); gather.update(state, 500); movement.update(state, 500);
   for (const b of Object.values(state.buildings)) if (b.ownerId === PLAYER_ID && b.buildProgress >= 1 && placed.has(b.type) && completed[b.type] === undefined) completed[b.type] = ms + 500;
   if (plan.every(t => completed[t] !== undefined) && populationOf(state,PLAYER_ID) >= 10) break;
  }
  console.log('Jalons simulés (s)', Object.fromEntries(Object.entries(completed).map(([k,v]) => [k, v / 1000])), 'population', populationOf(state, PLAYER_ID));
  expect(plan.every(t => completed[t] !== undefined)).toBe(true);
  expect(populationOf(state, PLAYER_ID)).toBeGreaterThanOrEqual(10);
 });
});
