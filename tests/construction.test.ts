import { describe, expect, it } from 'vitest';
import { BUILDINGS, GAME } from '../src/core/config';
import { PLAYER_ID } from '../src/core/constants';
import { EventBus } from '../src/core/EventBus';
import { createGameState, townHallOf } from '../src/core/GameState';
import type { BuildingType, TileType } from '../src/core/types';
import { ConstructionSystem, canPlace, placeBuilding, upgradeBuilding } from '../src/systems/ConstructionSystem';
import { WorldGen } from '../src/world/WorldGen';

/** All grass except the tiles listed. */
const stubWorld = (special: Record<string, TileType> = {}) => ({
  getTile: (tx: number, ty: number): TileType => special[`${tx},${ty}`] ?? 'grass',
});

const setup = () => {
  const state = createGameState(new WorldGen(42));
  const player = state.villages[PLAYER_ID];
  player.resources = { wood: 1000, stone: 1000, ore: 0, iron: 1000 };
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

  it('requires the resource tile near lumber camps', () => {
    const { state, hall } = setup();
    const x = hall.tx + 4;
    expect(canPlace(state, stubWorld(), 'lumberCamp', x, hall.ty, PLAYER_ID)).toMatchObject({ ok: false });
    const radius = BUILDINGS.lumberCamp.requiresNearbyTile!.radius;
    const near = stubWorld({ [`${x + 2 + radius - 1},${hall.ty}`]: 'forest' });
    expect(canPlace(state, near, 'lumberCamp', x, hall.ty, PLAYER_ID).ok).toBe(true);
    const tooFar = stubWorld({ [`${x + 2 + radius},${hall.ty}`]: 'forest' });
    expect(canPlace(state, tooFar, 'lumberCamp', x, hall.ty, PLAYER_ID).ok).toBe(false);
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
    player.resources = { wood: 10, stone: 0, ore: 0, iron: 0 };
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
    const sys = new ConstructionSystem(bus);
    sys.update(state, BUILDINGS.house.buildTimeMs / 2);
    expect(res.building.buildProgress).toBeCloseTo(0.5);
    expect(done).toEqual([]);
    sys.update(state, BUILDINGS.house.buildTimeMs);
    sys.update(state, 100);
    expect(res.building.buildProgress).toBe(1);
    expect(done).toEqual([res.building.id]);
  });

  it('handles any footprint size from the config (e.g. a 4×4 building)', () => {
    const { state, hall } = setup();
    const defs = BUILDINGS as unknown as Record<string, (typeof BUILDINGS)['house']>;
    defs.bigTest = { ...BUILDINGS.house, size: 4 };
    try {
      const type = 'bigTest' as BuildingType;
      // Touches the town hall's right edge but doesn't overlap it.
      expect(canPlace(state, stubWorld(), type, hall.tx + 3, hall.ty - 3, PLAYER_ID).ok).toBe(true);
      expect(canPlace(state, stubWorld(), type, hall.tx + 2, hall.ty - 3, PLAYER_ID)).toMatchObject({ reason: 'Emplacement occupé' });
      const water = stubWorld({ [`${hall.tx + 6},${hall.ty}`]: 'water' });
      expect(canPlace(state, water, type, hall.tx + 3, hall.ty - 3, PLAYER_ID)).toMatchObject({ reason: 'Terrain non constructible' });
    } finally {
      delete defs.bigTest;
    }
  });

  it('upgrades the town hall through its levels', () => {
    const { state, player, hall } = setup();
    const lvl2 = BUILDINGS.townHall.levels![1];
    expect(upgradeBuilding(state, hall.id).ok).toBe(true);
    expect(hall.level).toBe(2);
    expect(hall.maxHp).toBe(BUILDINGS.townHall.hp + lvl2.hpBonus!);
    expect(player.resources.wood).toBe(1000 - lvl2.cost.wood!);
    expect(upgradeBuilding(state, hall.id).ok).toBe(true);
    expect(upgradeBuilding(state, hall.id)).toMatchObject({ ok: false, reason: 'Niveau maximum atteint' });
  });
});
