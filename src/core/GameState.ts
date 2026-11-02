import { hash2 } from './rng';
import { AI, BUILDINGS, GAME, UNITS, RESOURCES, PROGRESSION } from './config';
import { PLAYER_ID } from './constants';
import type { Building, BuildingType, GameState, Resources, Unit, UnitType, Village } from './types';
import { spawnVillager } from '../systems/VillagerSystem';
import type { WorldGen } from '../world/WorldGen';

const AI_NAMES = ['Brumeval', 'Rocheclaire', 'Fortbois', 'Valdor', 'Ombrecombe', 'Hautelande'];
/** Must match render/teams.ts (KayKit team colors + tints). */
const AI_COLORS = [0xd94b3d, 0x4caf50, 0xf2c230, 0x9b59b6, 0x1abc9c];
export const PLAYER_COLOR = 0x3498db;

const emptyResources = (): Resources => ({ food: 0, wood: 0, stone: 0, iron: 0 });

export function nextId(state: GameState, prefix: string): string {
  state.nextId += 1;
  return `${prefix}-${state.nextId}`;
}

export function addBuilding(
  state: GameState,
  type: BuildingType,
  ownerId: string,
  tx: number,
  ty: number,
  completed = false,
): Building {
  const def = BUILDINGS[type];
  const b: Building = {
    id: nextId(state, 'b'),
    type,
    ownerId,
    tx,
    ty,
    hp: def.hp,
    maxHp: def.hp,
    level: 1,
    buildProgress: completed || def.buildTimeMs === 0 ? 1 : 0,
  };
  state.buildings[b.id] = b;
  return b;
}

export function addUnit(state: GameState, type: UnitType, ownerId: string, x: number, y: number): Unit {
  const def = UNITS[type];
  const bonusHp = state.villages[ownerId].upgrades.reduce((n, key) => n + (PROGRESSION.upgrades[key].units.includes(type) ? PROGRESSION.upgrades[key].hp : 0), 0);
  const u: Unit = {
    id: nextId(state, 'u'),
    type,
    ownerId,
    x,
    y,
    path: [],
    hp: def.hp + bonusHp,
    maxHp: def.hp + bonusHp,
    campId: null,
    onMission: false,
    departMs: 0,
    missionTarget: null,
    targetId: null,
    ordered: false,
    nextAttackMs: 0,
    lastAttackMs: -1,
    repathAtMs: 0,
  };
  state.units[u.id] = u;
  return u;
}

/** Builds the initial state: one village + town hall per spawn point. Villagers are spawned by VillagerSystem. */
export function createGameState(world: WorldGen): GameState {
  const state: GameState = {
    seed: world.seed,
    timeMs: 0,
    villages: {},
    buildings: {},
    units: {},
    villagers: {},
    foodSources: {},
    nextId: 0,
    depletion: {},
    fog: { explored: {}, radius: {}, version: 0 },
    status: 'playing',
  };

  world.spawns.forEach((spawn, i) => {
    const isPlayer = spawn.villageId === PLAYER_ID;
    const aiIndex = i - 1;
    const village: Village = {
      id: spawn.villageId,
      name: isPlayer ? 'Ton village' : AI_NAMES[aiIndex % AI_NAMES.length],
      isPlayer,
      personality: isPlayer ? undefined : AI.assignment[aiIndex % AI.assignment.length],
      color: isPlayer ? PLAYER_COLOR : AI_COLORS[aiIndex % AI_COLORS.length],
      resources: { ...emptyResources(), ...GAME.startingResources },
      alive: true,
      age: 1,
      upgrades: [],
      allies: [],
      relations: {},
    };
    state.villages[village.id] = village;

    const half = Math.floor(BUILDINGS.townHall.size / 2);
    const hall = addBuilding(state, 'townHall', village.id, spawn.tx - half, spawn.ty - half, true);
    for (let n = 0; n < GAME.startingWorkers; n++) spawnVillager(state, village.id, hall.tx + n, hall.ty + BUILDINGS.townHall.size);
  });

  const addSource = (type: 'berry' | 'animal', tx: number, ty: number): void => {
    if (!['grass', 'sand'].includes(world.getTile(tx, ty)) || Object.values(state.foodSources).some(s => s.tx === tx && s.ty === ty)) return;
    const id = nextId(state, 'food');
    state.foodSources[id] = { id, type, tx, ty, remaining: RESOURCES.tileAmounts[type], hits: 0 };
  };
  for (const spawn of world.spawns) {
    const offsets: [number, number][] = [];
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) === 2) offsets.push([dx, dy]);
    }
    for (let i = 0; i < offsets.length; i++) {
      const [dx, dy] = offsets[i];
      if (i < 6) addSource('berry', spawn.tx + dx, spawn.ty + dy);
      else if (i < 12) addSource('animal', spawn.tx + dx, spawn.ty + dy);
    }
  }
  for (let y = -GAME.map.halfSize + 5; y < GAME.map.halfSize - 5; y += 11) {
    for (let x = -GAME.map.halfSize + 5; x < GAME.map.halfSize - 5; x += 11) {
      const n = hash2(x, y, world.seed);
      if (n < 0.12) addSource(n < 0.06 ? 'berry' : 'animal', x, y);
    }
  }
  return state;
}

export function townHallOf(state: GameState, villageId: string): Building | undefined {
  return Object.values(state.buildings).find((b) => b.ownerId === villageId && b.type === 'townHall');
}
