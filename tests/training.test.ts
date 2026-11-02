import { describe, it, expect } from 'vitest';
import { createGameState, townHallOf, addBuilding } from '../src/core/GameState';
import { PLAYER_ID } from '../src/core/constants';
import { WorldGen } from '../src/world/WorldGen';
import { MovementSystem } from '../src/systems/MovementSystem';
import { TrainingSystem, queueTraining, cancelTraining, populationOf, capacityOf, reservedOf, refundTraining } from '../src/systems/TrainingSystem';
const setup = () => { const w = new WorldGen(42); const state = createGameState(w); return {state, hall: townHallOf(state,PLAYER_ID)!, training: new TrainingSystem(new MovementSystem((x,y) => w.getTile(x,y)))}; };
describe('training', () => {
 it('starts with real idle villagers and four stocks', () => { const {state}=setup(); expect(populationOf(state,PLAYER_ID)).toBe(3); expect(capacityOf(state,PLAYER_ID)).toBe(5); expect(state.villages[PLAYER_ID].resources).toEqual({food:200,wood:250,stone:100,iron:50}); });
 it('reserves, pays, cancels and refunds', () => { const {state,hall}=setup(); expect(queueTraining(state,hall.id,'villager')).toBe(true); expect(queueTraining(state,hall.id,'villager')).toBe(true); expect(queueTraining(state,hall.id,'villager')).toBe(false); expect(reservedOf(state,PLAYER_ID)).toBe(2); expect(state.villages[PLAYER_ID].resources.food).toBe(100); expect(cancelTraining(state,hall.id,0)).toBe(true); expect(state.villages[PLAYER_ID].resources.food).toBe(150); });
 it('runs FIFO and pauses after housing loss', () => { const {state,hall,training}=setup(); const house=addBuilding(state,'house',PLAYER_ID,10,10,true); for(let i=0;i<3;i++) expect(queueTraining(state,hall.id,'villager')).toBe(true); delete state.buildings[house.id]; training.update(state,20000); expect(hall.trainingQueue![0].remainingMs).toBe(20000); addBuilding(state,'house',PLAYER_ID,10,10,true); training.update(state,20000); expect(populationOf(state,PLAYER_ID)).toBe(4); expect(hall.trainingQueue).toHaveLength(2); });
 it('uses independent barracks queues and refunds on destruction', () => { const {state}=setup(); addBuilding(state,'house',PLAYER_ID,10,10,true); const b=addBuilding(state,'barracks',PLAYER_ID,20,20,true); expect(queueTraining(state,b.id,'spearman')).toBe(true); expect(state.villages[PLAYER_ID].resources.food).toBe(160); refundTraining(state,b.id); expect(state.villages[PLAYER_ID].resources.food).toBe(200); expect(reservedOf(state,PLAYER_ID)).toBe(0); });
});
