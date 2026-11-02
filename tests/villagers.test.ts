import { describe, expect, it } from 'vitest';
import { BUILDINGS, GAME, RESOURCES, VILLAGER } from '../src/core/config';
import { PLAYER_ID } from '../src/core/constants';
import { addBuilding, createGameState } from '../src/core/GameState';
import type { GameState, TileType } from '../src/core/types';
import { ArmySystem, campDisplay, drawnUnitIds, recallArmy, sendArmy, soldiersInCamp } from '../src/systems/ArmySystem';
import { productionRates } from '../src/systems/EconomySystem';
import { FogSystem, isExplored } from '../src/systems/FogSystem';
import { GatherSystem, orderHarvest, tileRemaining } from '../src/systems/GatherSystem';
import { MovementSystem, tileOf } from '../src/systems/MovementSystem';
import { assignWorkers, civilians, convertToWarrior, enlistableCount } from '../src/systems/PopulationSystem';
import { VillagerSystem, killVillager, orderAssign, spawnVillager } from '../src/systems/VillagerSystem';
import { WorldGen } from '../src/world/WorldGen';

/** Real world (village spawns), plus a forest patch at 1010..1012 × 1000 far from everything. */
const setup = () => {
  const world = new WorldGen(42);
  const state = createGameState(world);
  const tile = (tx: number, ty: number): TileType =>
    tx >= 1010 && tx <= 1012 && ty === 1000 ? 'forest' : tx > 500 ? 'grass' : world.getTile(tx, ty);
  const movement = new MovementSystem(tile);
  return { state, movement, player: state.villages[PLAYER_ID] };
};

const run = (state: GameState, seconds: number, ...systems: { update(s: GameState, dt: number): void }[]) => {
  for (let i = 0; i < seconds * 10; i++) {
    state.timeMs += 100;
    for (const s of systems) s.update(state, 100);
  }
};

describe('Visible villagers', () => {
  it('one villager per whole civilian; starting workers are flagged', () => {
    const { state, movement, player } = setup();
    const villagers = new VillagerSystem(movement);
    villagers.update(state, 100);
    const mine = Object.values(state.villagers).filter((v) => v.ownerId === PLAYER_ID);
    expect(mine).toHaveLength(civilians(state, PLAYER_ID));
    expect(mine.filter((v) => !v.enlistable)).toHaveLength(player.founders);
  });

  it('automatic production is unchanged by the visible trips', () => {
    const { state, movement } = setup();
    const before = productionRates(state, PLAYER_ID);
    run(state, 30, new VillagerSystem(movement), new GatherSystem(movement), movement);
    expect(productionRates(state, PLAYER_ID)).toEqual(before);
    expect(state.depletion).toEqual({}); // auto workers never deplete tiles
  });

  it('only maxVisible villagers walk around, the others work inside', () => {
    const { state, movement, player } = setup();
    addBuilding(state, 'house', PLAYER_ID, 600, 600, true);
    addBuilding(state, 'house', PLAYER_ID, 603, 600, true);
    player.inhabitants = 25;
    new VillagerSystem(movement).update(state, 100);
    const mine = Object.values(state.villagers).filter((v) => v.ownerId === PLAYER_ID);
    expect(mine).toHaveLength(25);
    expect(mine.filter((v) => !v.inside)).toHaveLength(GAME.villagers.maxVisible);
  });
});

describe('Manual harvest', () => {
  it('depletes the tile and credits the village at the nearest depot', () => {
    const { state, movement, player } = setup();
    addBuilding(state, 'townHall', PLAYER_ID, 1004, 999, true); // depot 6 tiles from the forest
    const v = spawnVillager(state, PLAYER_ID, 1008, 1000);
    const wood = player.resources.wood;
    expect(orderHarvest(state, movement, [v], 1010, 1000)).toBe(true);
    const seconds = VILLAGER.carryCapacity / VILLAGER.gatherPerSecond + 15;
    run(state, seconds, new GatherSystem(movement), movement);
    expect(tileRemaining(state, 1010, 1000, 'forest')).toBeLessThan(RESOURCES.tileAmounts.forest);
    expect(player.resources.wood).toBeGreaterThanOrEqual(wood + VILLAGER.carryCapacity);
  });

  it('a depleted tile sends the villager to the next tile of the same type', () => {
    const { state, movement } = setup();
    addBuilding(state, 'townHall', PLAYER_ID, 1004, 999, true);
    const v = spawnVillager(state, PLAYER_ID, 1009, 1000);
    orderHarvest(state, movement, [v], 1010, 1000);
    state.depletion['1010,1000'] = 1;
    run(state, 40, new GatherSystem(movement), movement);
    expect(tileRemaining(state, 1010, 1000, 'forest')).toBe(0);
    expect(v.harvest).not.toBeNull();
    expect(v.harvest!.tx).not.toBe(1010);
  });

  it('manual harvesters hold no job slot; pinned villagers get their building first', () => {
    const { state, movement } = setup();
    new VillagerSystem(movement).update(state, 100);
    const [a, b] = Object.values(state.villagers).filter((v) => v.ownerId === PLAYER_ID);
    const total = () => [...assignWorkers(state, PLAYER_ID).values()].reduce((x, y) => x + y, 0);
    expect(total()).toBe(3);
    orderHarvest(state, movement, [a], 1010, 1000);
    expect(total()).toBe(2);
    const camp = addBuilding(state, 'lumberCamp', PLAYER_ID, 620, 620, true);
    orderAssign(state, [b], camp.id);
    expect(assignWorkers(state, PLAYER_ID).get(camp.id)).toBeGreaterThanOrEqual(1);
  });
});

describe('Starting workers (never enlistable)', () => {
  it('conversion is refused when only starting workers are left', () => {
    const { state, player } = setup();
    addBuilding(state, 'barracks', PLAYER_ID, 600, 600, true);
    player.weapons.sword = 5;
    expect(civilians(state, PLAYER_ID)).toBe(GAME.startingWorkers);
    expect(enlistableCount(state, PLAYER_ID)).toBe(0);
    expect(convertToWarrior(state, PLAYER_ID, 'knight')).toBe('no-civilian');
    player.inhabitants += 1; // a newborn is enlistable
    expect(enlistableCount(state, PLAYER_ID)).toBe(1);
    expect(convertToWarrior(state, PLAYER_ID, 'knight')).toBe('ok');
    expect(enlistableCount(state, PLAYER_ID)).toBe(0);
  });

  it('converting removes an enlistable villager, never a starting worker', () => {
    const { state, movement, player } = setup();
    const villagers = new VillagerSystem(movement);
    addBuilding(state, 'barracks', PLAYER_ID, 600, 600, true);
    player.inhabitants = 5;
    player.weapons.bow = 2;
    villagers.update(state, 100);
    convertToWarrior(state, PLAYER_ID, 'archer');
    convertToWarrior(state, PLAYER_ID, 'archer');
    villagers.update(state, 100);
    const mine = Object.values(state.villagers).filter((v) => v.ownerId === PLAYER_ID);
    expect(mine).toHaveLength(3);
    expect(mine.every((v) => !v.enlistable)).toBe(true);
  });

  it('a dead starting worker is not replaced', () => {
    const { state, movement, player } = setup();
    const villagers = new VillagerSystem(movement);
    villagers.update(state, 100);
    const founder = Object.values(state.villagers).find((v) => v.ownerId === PLAYER_ID && !v.enlistable)!;
    killVillager(state, founder.id);
    expect(player.founders).toBe(GAME.startingWorkers - 1);
    player.inhabitants += 1;
    villagers.update(state, 100);
    expect(Object.values(state.villagers).filter((v) => v.ownerId === PLAYER_ID && !v.enlistable)).toHaveLength(GAME.startingWorkers - 1);
  });

  it('starting workers sent away reveal the map', () => {
    const { state, movement } = setup();
    const villagers = new VillagerSystem(movement);
    villagers.update(state, 100);
    const founder = Object.values(state.villagers).find((v) => v.ownerId === PLAYER_ID && !v.enlistable)!;
    founder.x = 1011;
    founder.y = 1005;
    new FogSystem().update(state, 100);
    expect(isExplored(state.fog, 1011, 1005)).toBe(true);
  });
});

describe('Army camps', () => {
  const army = (n: number) => {
    const ctx = setup();
    const { state, player } = ctx;
    addBuilding(state, 'barracks', PLAYER_ID, 1000, 1010, true);
    player.founders = 0;
    player.inhabitants = n;
    player.weapons = { sword: n, bow: n };
    for (let i = 0; i < n; i++) convertToWarrior(state, PLAYER_ID, i % 3 === 0 ? 'archer' : 'knight');
    return { ...ctx, armySystem: new ArmySystem(ctx.movement) };
  };

  it('without a camp, soldiers wait in a compact block in front of the barracks', () => {
    const { state, movement, armySystem } = army(9);
    run(state, 15, armySystem, movement);
    const units = Object.values(state.units);
    const xs = units.map((u) => u.x);
    const ys = units.map((u) => u.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(2.5); // ≈ 3 columns, not a long line
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(2.5);
    expect(Math.min(...ys)).toBeGreaterThan(1010 + BUILDINGS.barracks.size - 0.6);
  });

  it('soldiers join the least-filled camp and only visibleSoldiers figurines are drawn', () => {
    const { state, movement, armySystem } = army(20);
    const c1 = addBuilding(state, 'armyCamp', PLAYER_ID, 1010, 1010, true);
    const c2 = addBuilding(state, 'armyCamp', PLAYER_ID, 1016, 1010, true);
    run(state, 20, armySystem, movement);
    expect(soldiersInCamp(state, c1.id)).toHaveLength(10);
    expect(soldiersInCamp(state, c2.id)).toHaveLength(10);
    const d = campDisplay(state, c1.id);
    expect(d.total).toBe(10);
    expect(d.drawn.size).toBe(BUILDINGS.armyCamp.visibleSoldiers);
    expect(drawnUnitIds(state).size).toBe(2 * BUILDINGS.armyCamp.visibleSoldiers!);
  });

  it('soldiers leave the camp one by one, stay at the target, then come back when recalled', () => {
    const { state, movement, armySystem } = army(6);
    const camp = addBuilding(state, 'armyCamp', PLAYER_ID, 1010, 1010, true);
    run(state, 20, armySystem, movement);
    const ids = soldiersInCamp(state, camp.id).map((u) => u.id);
    sendArmy(state, movement, ids, { tx: 1030, ty: 1010 });
    const departs = ids.map((id) => state.units[id].departMs).sort((a, b) => a - b);
    expect(new Set(departs).size).toBe(6); // a column, not a blob
    expect(soldiersInCamp(state, camp.id)).toHaveLength(0);
    run(state, 30, armySystem, movement);
    for (const id of ids) expect(Math.abs(tileOf(state.units[id]).tx - 1030)).toBeLessThanOrEqual(2);
    expect(drawnUnitIds(state).size).toBe(6);
    recallArmy(state, ids);
    run(state, 30, armySystem, movement);
    expect(soldiersInCamp(state, camp.id)).toHaveLength(6);
    for (const id of ids) expect(Math.abs(state.units[id].x - (camp.tx + 1.5))).toBeLessThan(2);
  });
});
