import { describe, expect, it } from 'vitest';
import { addBuilding, createGameState } from '../src/core/GameState';
import { RESOURCES } from '../src/core/config';
import { WorldGen } from '../src/world/WorldGen';
import { GatherSystem, isDepot, orderHarvest } from '../src/systems/GatherSystem';
import { MovementSystem } from '../src/systems/MovementSystem';

describe('food gathering', () => {
  it('generates deterministic food sources near each village', () => {
    const world = new WorldGen(42);
    const state = createGameState(world);
    expect(state.foodSources).toEqual(createGameState(new WorldGen(42)).foodSources);
    for (const spawn of world.spawns) {
      const nearby = Object.values(state.foodSources).filter(s => Math.hypot(s.tx - spawn.tx, s.ty - spawn.ty) < 10);
      expect(nearby.filter(s => s.type === 'berry').length).toBeGreaterThanOrEqual(6);
      expect(nearby.filter(s => s.type === 'animal').length).toBeGreaterThanOrEqual(6);
    }
  });
  it('restricts depots to compatible resources and completed buildings', () => {
    const state = createGameState(new WorldGen(42, 0));
    const depot = addBuilding(state, 'minerCamp', 'player', 10, 10, true);
    expect(isDepot(depot, 'rock')).toBe(true);
    expect(isDepot(depot, 'iron')).toBe(true);
    expect(isDepot(depot, 'berry')).toBe(false);
    depot.buildProgress = 0.5;
    expect(isDepot(depot, 'rock')).toBe(false);
  });
  it('hunts before collecting and keeps a load without a depot', () => {
    const state = createGameState(new WorldGen(42, 0));
    const v = Object.values(state.villagers)[0];
    const source = Object.values(state.foodSources).find(s => s.type === 'animal')!;
    v.x = source.tx; v.y = source.ty;
    const movement = new MovementSystem(() => 'grass');
    const gather = new GatherSystem(movement);
    expect(orderHarvest(state, movement, [v], source.tx, source.ty)).toBe(true);
    delete state.buildings[Object.keys(state.buildings)[0]];
    gather.update(state, 1);
    gather.update(state, RESOURCES.animalHitIntervalMs * RESOURCES.animalHits);
    expect(source.remaining).toBe(RESOURCES.tileAmounts.animal);
    gather.update(state, 13000);
    expect(v.carrying?.amount).toBe(10);
    expect(source.remaining).toBe(RESOURCES.tileAmounts.animal - 10);
  });
  it('assigns only one villager to a farm', () => {
    const state = createGameState(new WorldGen(42, 0));
    const movement = new MovementSystem(() => 'grass');
    const farm = addBuilding(state, 'farm', 'player', 10, 10, true);
    const villagers = Object.values(state.villagers);
    expect(orderHarvest(state, movement, villagers, farm.tx, farm.ty)).toBe(true);
    expect(villagers.filter(v => v.harvest?.sourceId === farm.id)).toHaveLength(1);
    expect(orderHarvest(state, movement, [villagers[1]], farm.tx, farm.ty)).toBe(false);
  });
});
