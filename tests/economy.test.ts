import { describe, expect, it } from 'vitest';
import { addBuilding, createGameState } from '../src/core/GameState';
import { EventBus } from '../src/core/EventBus';
import { PLAYER_ID } from '../src/core/constants';
import { BUILDINGS, RESOURCES } from '../src/core/config';
import { EconomySystem, canAfford, productionRates, spend } from '../src/systems/EconomySystem';
import { WorldGen } from '../src/world/WorldGen';

const setup = () => {
  const state = createGameState(new WorldGen(42));
  return { state, player: state.villages[PLAYER_ID] };
};

describe('EconomySystem', () => {
  it('spend deducts the cost only when affordable', () => {
    const { player } = setup();
    player.resources = { wood: 100, stone: 0, ore: 0, iron: 0 };
    expect(spend(player, { wood: 60 })).toBe(true);
    expect(player.resources.wood).toBe(40);
    expect(spend(player, { wood: 60 })).toBe(false);
    expect(player.resources.wood).toBe(40);
    expect(canAfford(player, { stone: 1 })).toBe(false);
  });

  it('town hall gives a small production with the starting workers', () => {
    const { state } = setup();
    const rates = productionRates(state, PLAYER_ID);
    expect(rates.wood).toBeCloseTo(BUILDINGS.townHall.produces!.wood!);
  });

  it('workers go to producer buildings before the town hall', () => {
    const { state, player } = setup();
    player.inhabitants = 3;
    addBuilding(state, 'lumberCamp', PLAYER_ID, 5, 5, true);
    const rates = productionRates(state, PLAYER_ID);
    expect(rates.wood).toBeCloseTo(1.2); // camp fully staffed, town hall empty
    expect(rates.stone).toBe(0);
  });

  it('production drops when there are fewer workers', () => {
    const { state, player } = setup();
    addBuilding(state, 'lumberCamp', PLAYER_ID, 5, 5, true);
    player.inhabitants = 3;
    const full = productionRates(state, PLAYER_ID).wood;
    player.inhabitants = 1;
    const reduced = productionRates(state, PLAYER_ID).wood;
    expect(reduced).toBeCloseTo(full / 3);
  });

  it('unfinished buildings produce nothing', () => {
    const { state, player } = setup();
    player.inhabitants = 3;
    addBuilding(state, 'lumberCamp', PLAYER_ID, 5, 5);
    expect(productionRates(state, PLAYER_ID).wood).toBeCloseTo(0.4); // town hall only
  });

  it('accumulates whole resources over time', () => {
    const { state, player } = setup();
    player.resources.wood = 0;
    player.inhabitants = 3;
    addBuilding(state, 'lumberCamp', PLAYER_ID, 5, 5, true);
    const eco = new EconomySystem();
    for (let i = 0; i < 100; i++) eco.update(state, 100); // 10 s
    expect(player.resources.wood).toBe(12);
  });

  it('a staffed smelter converts ore into iron', () => {
    const { state, player } = setup();
    player.inhabitants = 2;
    player.resources.ore = 5;
    player.resources.iron = 0;
    addBuilding(state, 'smelter', PLAYER_ID, 5, 5, true);
    new EconomySystem().update(state, RESOURCES.smelter.intervalMs * 3);
    expect(player.resources.iron).toBe(2);
    expect(player.resources.ore).toBe(1);
  });

  it('an unstaffed smelter does nothing', () => {
    const { state, player } = setup();
    player.inhabitants = 0;
    player.resources.ore = 10;
    addBuilding(state, 'smelter', PLAYER_ID, 5, 5, true);
    new EconomySystem().update(state, RESOURCES.smelter.intervalMs * 3);
    expect(player.resources.iron).toBe(0);
  });

  it('emits resources:changed when stock changes', () => {
    const { state } = setup();
    const bus = new EventBus();
    const events: string[] = [];
    bus.on('resources:changed', (e) => events.push(e.villageId));
    new EconomySystem(bus).update(state, 5000);
    expect(events).toContain(PLAYER_ID);
  });
});
