import { describe, expect, it } from 'vitest';
import { addBuilding, createGameState } from '../src/core/GameState';
import { PLAYER_ID } from '../src/core/constants';
import { RESOURCES } from '../src/core/config';
import { incomeRates, timeToAfford } from '../src/systems/EconomySystem';
import { convertToWarrior, formationSlot } from '../src/systems/PopulationSystem';
import { WorldGen } from '../src/world/WorldGen';

const setup = () => {
  const state = createGameState(new WorldGen(42));
  return { state, player: state.villages[PLAYER_ID] };
};

describe('timeToAfford', () => {
  it('is 0 when already affordable', () => {
    const { player } = setup();
    expect(timeToAfford(player, { wood: 10 }, { wood: 1, stone: 0, ore: 0, iron: 0 })).toBe(0);
  });

  it('waits for the slowest missing resource', () => {
    const { player } = setup();
    player.resources = { wood: 0, stone: 0, ore: 0, iron: 0 };
    const rates = { wood: 2, stone: 0.5, ore: 0, iron: 0 };
    expect(timeToAfford(player, { wood: 20, stone: 10 }, rates)).toBe(20);
  });

  it('reports a missing resource nobody produces', () => {
    const { player } = setup();
    expect(timeToAfford(player, { iron: 50 }, { wood: 1, stone: 1, ore: 0, iron: 0 })).toEqual({ missing: 'iron' });
  });
});

describe('incomeRates', () => {
  it('includes smelter iron and its ore consumption', () => {
    const { state, player } = setup();
    player.inhabitants = 5; // The smelter (2 slots) is filled before the town hall.
    addBuilding(state, 'smelter', PLAYER_ID, 20, 20, true);
    player.resources.ore = 100;
    const rates = incomeRates(state, PLAYER_ID);
    const ironPerSecond = 1000 / RESOURCES.smelter.intervalMs;
    expect(rates.iron).toBeCloseTo(ironPerSecond);
    expect(rates.ore).toBeCloseTo(-ironPerSecond * RESOURCES.smelter.orePerIron);
  });
});

describe('Army formation', () => {
  it('warriors line up on distinct spots in front of the barracks', () => {
    const { state, player } = setup();
    const barracks = addBuilding(state, 'barracks', PLAYER_ID, 10, 10, true);
    player.inhabitants = 8;
    player.weapons = { sword: 4, bow: 4 };
    for (let i = 0; i < 4; i++) convertToWarrior(state, PLAYER_ID, 'knight');
    for (let i = 0; i < 4; i++) convertToWarrior(state, PLAYER_ID, 'archer');
    const spots = new Set(Object.values(state.units).map((u) => `${u.x.toFixed(2)},${u.y.toFixed(2)}`));
    expect(spots.size).toBe(8);
    for (const u of Object.values(state.units)) expect(u.y).toBeGreaterThan(barracks.ty);
    expect(formationSlot(barracks, 5).y).toBeGreaterThan(formationSlot(barracks, 0).y);
  });
});
