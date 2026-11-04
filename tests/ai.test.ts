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

import { TrainingSystem } from '../src/systems/TrainingSystem';
import { ConstructionSystem } from '../src/systems/ConstructionSystem';
import { GatherSystem } from '../src/systems/GatherSystem';
import { VillagerSystem } from '../src/systems/VillagerSystem';
import { ProgressionSystem } from '../src/systems/ProgressionSystem';
import { ArmySystem } from '../src/systems/ArmySystem';
import { CombatSystem } from '../src/systems/CombatSystem';
import { DiplomacySystem } from '../src/systems/DiplomacySystem';
import { FogSystem } from '../src/systems/FogSystem';
import { VictorySystem } from '../src/systems/VictorySystem';
import { EventBus } from '../src/core/EventBus';

it('simule quinze minutes avec six villages', () => {
 const world = new WorldGen(42), state = createGameState(world), bus = new EventBus();
 const movement = new MovementSystem((x,y) => world.getTile(x,y));
 const systems = [new TrainingSystem(movement,bus), new ProgressionSystem(bus), new ConstructionSystem(bus,movement), new VillagerSystem(movement), new GatherSystem(movement,bus), new ArmySystem(movement), movement, new CombatSystem(movement,bus), new FogSystem(), new AISystem(world,movement,bus), new DiplomacySystem(bus)];
 const victory = new VictorySystem(bus); let age = 0, attack = 0, peakWorkers = 0, peakArmy = 0;
 const start = performance.now();
 for (let i=0;i<9000;i++) {
  state.timeMs += 100;
  for (const system of systems) system.update(state,100);
  victory.update(state);
  if (!age && Object.values(state.villages).some(v => !v.isPlayer && v.age >= 2)) age = state.timeMs;
  if (!attack && Object.values(state.units).some(u => u.ownerId !== 'player' && u.ordered && !!u.targetId && !!state.buildings[u.targetId])) attack = state.timeMs;
  peakWorkers = Math.max(peakWorkers, ...Object.keys(state.villages).filter(id => id !== 'player').map(id => Object.values(state.villagers).filter(v => v.ownerId === id).length));
  peakArmy = Math.max(peakArmy, Object.values(state.units).filter(u => u.ownerId !== 'player').length);
 }
 console.log('Simulation IA:', {age, attack, peakWorkers, peakArmy, msPerTick:(performance.now()-start)/9000, villages:Object.values(state.villages).map(v=>({id:v.id,age:v.age,resources:v.resources,alive:v.alive}))});
 expect(peakWorkers).toBeGreaterThan(6); expect(age).toBeGreaterThan(0); expect(peakArmy).toBeGreaterThan(0); expect(attack).toBeGreaterThanOrEqual(480000); expect(attack).toBeLessThanOrEqual(720000);
}, 120000);

import { addUnit } from '../src/core/GameState';
it('attaque une cible connue au-dessus du seuil et protège ses alliés', () => {
 const world = new WorldGen(42), state = createGameState(world), movement = new MovementSystem((x,y) => world.getTile(x,y));
 const ai = new AISystem(world,movement), village = state.villages['ai-1'], hall = townHallOf(state,'ai-1')!;
 state.timeMs = AI.attackStartMs; village.knownVillages = ['player'];
 for (const v of Object.values(state.villages)) if (v.id !== 'player' && v.id !== village.id) v.alive = false;
 village.allies.push('player'); state.villages.player.allies.push(village.id);
 const units = Array.from({length:AI.minimumAttackUnits}, () => addUnit(state,'spearman',village.id,hall.tx,hall.ty));
 ai.update(state,AI.thinkIntervalMs);
 expect(units.every(u => u.targetId !== townHallOf(state,'player')!.id)).toBe(true);
 village.allies = []; state.villages.player.allies = [];
 ai.update(state,AI.thinkIntervalMs);
 expect(units.every(u => u.targetId === townHallOf(state,'player')!.id)).toBe(true);
});
it('défend le village contre un ennemi proche', () => {
 const world = new WorldGen(42), state = createGameState(world), movement = new MovementSystem((x,y) => world.getTile(x,y));
 const hall = townHallOf(state,'ai-1')!, defender = addUnit(state,'spearman','ai-1',hall.tx,hall.ty);
 const enemy = addUnit(state,'spearman','player',hall.tx+2,hall.ty);
 new AISystem(world,movement).update(state,AI.thinkIntervalMs);
 expect(defender.targetId).toBe(enemy.id);
});
