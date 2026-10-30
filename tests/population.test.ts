import { describe, expect, it } from 'vitest';
import { addBuilding, createGameState } from '../src/core/GameState';
import { PLAYER_ID } from '../src/core/constants';
import { RESOURCES, WEAPONS } from '../src/core/config';
import { ArmorySystem, queueWeapon } from '../src/systems/ArmorySystem';
import { productionRates } from '../src/systems/EconomySystem';
import {
  PopulationSystem,
  civilians,
  convertToWarrior,
  demobilize,
  housingCap,
  warriors,
} from '../src/systems/PopulationSystem';
import { WorldGen } from '../src/world/WorldGen';

const setup = () => {
  const state = createGameState(new WorldGen(42));
  return { state, player: state.villages[PLAYER_ID] };
};

describe('Housing & population', () => {
  it('houses add housing capacity', () => {
    const { state } = setup();
    expect(housingCap(state, PLAYER_ID)).toBe(5);
    addBuilding(state, 'house', PLAYER_ID, 5, 5, true);
    expect(housingCap(state, PLAYER_ID)).toBe(10);
  });

  it('inhabitants grow until housing is full', () => {
    const { state, player } = setup();
    const pop = new PopulationSystem();
    const secondsToFill = 2 / RESOURCES.population.growthPerSecond; // 3 → 5
    for (let i = 0; i < secondsToFill * 10 + 50; i++) pop.update(state, 100);
    expect(civilians(state, PLAYER_ID)).toBe(5);
    expect(player.inhabitants).toBe(5);
  });

  it('warriors take housing space too', () => {
    const { state, player } = setup();
    addBuilding(state, 'barracks', PLAYER_ID, 6, 6, true);
    player.inhabitants = 5;
    player.weapons.sword = 1;
    expect(convertToWarrior(state, PLAYER_ID, 'knight')).toBe('ok');
    new PopulationSystem().update(state, 60_000);
    expect(civilians(state, PLAYER_ID) + warriors(state, PLAYER_ID).length).toBe(5);
  });
});

describe('Conversion civilian → warrior', () => {
  it('needs a barracks, a civilian and the right weapon', () => {
    const { state, player } = setup();
    player.weapons.sword = 1;
    expect(convertToWarrior(state, PLAYER_ID, 'knight')).toBe('no-barracks');
    addBuilding(state, 'barracks', PLAYER_ID, 6, 6, true);
    expect(convertToWarrior(state, PLAYER_ID, 'archer')).toBe('no-weapon');
    player.inhabitants = 0;
    expect(convertToWarrior(state, PLAYER_ID, 'knight')).toBe('no-civilian');
  });

  it('converting a worker lowers production; demobilizing restores it', () => {
    const { state, player } = setup();
    addBuilding(state, 'lumberCamp', PLAYER_ID, 5, 5, true);
    addBuilding(state, 'barracks', PLAYER_ID, 9, 9, true);
    player.inhabitants = 3;
    player.weapons.sword = 1;
    const before = productionRates(state, PLAYER_ID).wood;

    expect(convertToWarrior(state, PLAYER_ID, 'knight')).toBe('ok');
    expect(civilians(state, PLAYER_ID)).toBe(2);
    expect(player.weapons.sword).toBe(0);
    expect(productionRates(state, PLAYER_ID).wood).toBeLessThan(before);

    const knight = warriors(state, PLAYER_ID)[0];
    expect(knight.type).toBe('knight');
    expect(demobilize(state, knight.id)).toBe(true);
    expect(productionRates(state, PLAYER_ID).wood).toBeCloseTo(before);
    expect(player.weapons.sword).toBe(1);
  });
});

describe('Armory', () => {
  it('forges weapons only with a staffed armory', () => {
    const { state, player } = setup();
    player.resources = { wood: 100, stone: 0, ore: 0, iron: 20 };
    expect(queueWeapon(state, PLAYER_ID, 'bow')).toBe(false); // no armory
    addBuilding(state, 'armory', PLAYER_ID, 5, 5, true);
    expect(queueWeapon(state, PLAYER_ID, 'bow')).toBe(true);
    expect(queueWeapon(state, PLAYER_ID, 'sword')).toBe(true);
    expect(player.resources.wood).toBe(100 - 20 - 10);

    player.inhabitants = 2; // armory fully staffed (2 slots, filled before the town hall)
    const armory = new ArmorySystem();
    armory.update(state, WEAPONS.bow.forgeTimeMs + WEAPONS.sword.forgeTimeMs);
    expect(player.weapons).toEqual({ sword: 1, bow: 1 });
  });

  it('a half-staffed armory forges at half speed', () => {
    const { state, player } = setup();
    addBuilding(state, 'armory', PLAYER_ID, 5, 5, true);
    queueWeapon(state, PLAYER_ID, 'bow');
    player.inhabitants = 1;
    new ArmorySystem().update(state, WEAPONS.bow.forgeTimeMs);
    expect(player.weapons.bow).toBe(0);
    new ArmorySystem().update(state, WEAPONS.bow.forgeTimeMs);
    expect(player.weapons.bow).toBe(1);
  });
});
