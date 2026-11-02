import { expect, it } from 'vitest';
import { createGameState, townHallOf } from '../src/core/GameState';
import { WorldGen } from '../src/world/WorldGen';
import { MovementSystem } from '../src/systems/MovementSystem';
import { AISystem } from '../src/systems/AISystem';
import { AI } from '../src/core/config';

it('affecte les villageois IA, réserve une formation et lance une maison', () => {
 const world = new WorldGen(42), state = createGameState(world);
 const movement = new MovementSystem((x,y) => world.getTile(x,y));
 const ai = new AISystem(world, movement);
 ai.update(state, AI.thinkIntervalMs);
 const hall = townHallOf(state, 'ai-1')!;
 expect(hall.trainingQueue?.length).toBeGreaterThan(0);
 expect(Object.values(state.villagers).some(v => v.ownerId === 'ai-1' && v.harvest)).toBe(true);
 ai.update(state, AI.thinkIntervalMs);
 expect(Object.values(state.buildings).some(b => b.ownerId === 'ai-1' && b.type === 'house' && b.buildProgress === 0)).toBe(true);
});
