import { describe, expect, it } from 'vitest';
import { BUILDINGS, GAME } from '../src/core/config';
import { PLAYER_ID } from '../src/core/constants';
import { EventBus } from '../src/core/EventBus';
import { createGameState, townHallOf } from '../src/core/GameState';
import type { TileType } from '../src/core/types';
import { ConstructionSystem, canPlace, placeBuilding, orderBuildingWork, cancelConstruction } from '../src/systems/ConstructionSystem';
import { MovementSystem } from '../src/systems/MovementSystem';
import { spawnVillager } from '../src/systems/VillagerSystem';
import { WorldGen } from '../src/world/WorldGen';

/** All grass except the tiles listed. */
const stubWorld = (special: Record<string, TileType> = {}) => ({
  getTile: (tx: number, ty: number): TileType => special[`${tx},${ty}`] ?? 'grass',
});

const setup = () => {
  const state = createGameState(new WorldGen(42));
  const player = state.villages[PLAYER_ID];
  player.resources = { wood: 1000, stone: 1000, food: 0, iron: 1000 };
  const hall = townHallOf(state, PLAYER_ID)!;
  return { state, player, hall };
};

describe('ConstructionSystem', () => {
  it('accepts a free grass spot next to the town hall', () => {
    const { state, hall } = setup();
    expect(canPlace(state, stubWorld(), 'house', hall.tx + 4, hall.ty, PLAYER_ID)).toEqual({ ok: true });
  });

  it('refuses overlap, unbuildable terrain and spots too far from the village', () => {
    const { state, hall } = setup();
    const world = stubWorld({ [`${hall.tx + 5},${hall.ty}`]: 'water' });
    expect(canPlace(state, world, 'house', hall.tx + 1, hall.ty + 1, PLAYER_ID)).toMatchObject({ ok: false, reason: 'Emplacement occupé' });
    expect(canPlace(state, world, 'house', hall.tx + 4, hall.ty, PLAYER_ID)).toMatchObject({ ok: false, reason: 'Terrain non constructible' });
    const far = hall.tx + BUILDINGS.townHall.size + GAME.buildRadius;
    expect(canPlace(state, world, 'house', far, hall.ty, PLAYER_ID)).toMatchObject({ ok: false, reason: 'Trop loin du village' });
    expect(canPlace(state, world, 'house', far - 1, hall.ty, PLAYER_ID).ok).toBe(true);
  });

  it('allows depots without nearby resources', () => {
    const { state, hall } = setup();
    expect(canPlace(state, stubWorld(), 'lumberCamp', hall.tx + 4, hall.ty, PLAYER_ID).ok).toBe(true);
  });

  it('placing pays the cost and starts a site at 0 %', () => {
    const { state, player, hall } = setup();
    const bus = new EventBus();
    const placed: string[] = [];
    bus.on('building:placed', ({ buildingId }) => placed.push(buildingId));
    const res = placeBuilding(state, stubWorld(), 'house', hall.tx + 4, hall.ty, PLAYER_ID, bus);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.building.buildProgress).toBe(0);
    expect(player.resources.wood).toBe(1000 - BUILDINGS.house.cost.wood!);
    expect(placed).toEqual([res.building.id]);
  });

  it('refuses and charges nothing without enough resources', () => {
    const { state, player, hall } = setup();
    player.resources = { wood: 10, stone: 0, food: 0, iron: 0 };
    const count = Object.keys(state.buildings).length;
    const res = placeBuilding(state, stubWorld(), 'house', hall.tx + 4, hall.ty, PLAYER_ID);
    expect(res).toMatchObject({ ok: false, reason: 'Pas assez de ressources' });
    expect(player.resources.wood).toBe(10);
    expect(Object.keys(state.buildings)).toHaveLength(count);
  });

  it('sites progress with time and complete once', () => {
    const { state, hall } = setup();
    const bus = new EventBus();
    const done: string[] = [];
    bus.on('building:completed', ({ buildingId }) => done.push(buildingId));
    const res = placeBuilding(state, stubWorld(), 'house', hall.tx + 4, hall.ty, PLAYER_ID);
    if (!res.ok) throw new Error(res.reason);
    const movement = new MovementSystem(() => 'grass');
    const worker = spawnVillager(state, PLAYER_ID, res.building.tx - 1, res.building.ty);
    orderBuildingWork(state, movement, [worker], res.building);
    const sys = new ConstructionSystem(bus, movement);
    sys.update(state, BUILDINGS.house.buildTimeMs / 2);
    expect(res.building.buildProgress).toBeCloseTo(0.5);
    expect(done).toEqual([]);
    sys.update(state, BUILDINGS.house.buildTimeMs);
    sys.update(state, 100);
    expect(res.building.buildProgress).toBe(1);
    expect(done).toEqual([res.building.id]);
  });

  it('pauses without builders, caps the bonus and refunds cancellation', () => {
    const { state, player, hall } = setup();
    const res = placeBuilding(state, stubWorld(), 'house', hall.tx + 4, hall.ty, PLAYER_ID);
    if (!res.ok) throw new Error(res.reason);
    const movement = new MovementSystem(() => 'grass');
    const sys = new ConstructionSystem(undefined, movement);
    sys.update(state, 1000);
    expect(res.building.buildProgress).toBe(0);
    const workers = Array.from({ length: 5 }, () => spawnVillager(state, PLAYER_ID, res.building.tx - 1, res.building.ty));
    orderBuildingWork(state, movement, workers, res.building);
    sys.update(state, 1000);
    expect(res.building.buildProgress).toBeCloseTo(2.8 / 25);
    expect(cancelConstruction(state, res.building.id)).toBe(true);
    expect(player.resources.wood).toBe(987);
    expect(workers.every(v => v.task === 'idle')).toBe(true);
  });

  it('repairs proportionally and pauses until resources return', () => {
    const { state, player, hall } = setup();
    hall.hp = hall.maxHp - 20;
    const movement = new MovementSystem(() => 'grass');
    const worker = spawnVillager(state, PLAYER_ID, hall.tx - 1, hall.ty);
    orderBuildingWork(state, movement, [worker], hall);
    const sys = new ConstructionSystem(undefined, movement);
    sys.update(state, 1000);
    expect(hall.hp).toBe(hall.maxHp - 15);
    const res = placeBuilding(state, stubWorld(), 'house', hall.tx + 4, hall.ty, PLAYER_ID);
    if (!res.ok) throw new Error(res.reason);
    res.building.buildProgress = 1; res.building.hp = 400;
    worker.x = res.building.tx - 1; worker.y = res.building.ty;
    orderBuildingWork(state, movement, [worker], res.building);
    player.resources.wood = 0;
    sys.update(state, 1000);
    expect(worker.task).toBe('idle');
    expect(res.building.hp).toBe(400);
    player.resources.wood = 10;
    sys.update(state, 1000);
    expect(res.building.hp).toBe(405);
    expect(player.resources.wood).toBeCloseTo(9.75);
  });

  it('uses the GDD depot and farm values', () => {
    expect(BUILDINGS.minerCamp.cost).toEqual({ wood: 75 });
    expect(BUILDINGS.mill.buildTimeMs).toBe(30000);
    expect(BUILDINGS.farm.size).toBe(3);
    expect(BUILDINGS.townHall.hp).toBe(2400);
  });
});
