import { AI, BUILDINGS, GAME, UNITS } from './config';
import { PLAYER_ID } from './constants';
import type { Building, BuildingType, GameState, Resources, Unit, UnitType, Village } from './types';
import type { WorldGen } from '../world/WorldGen';

const AI_NAMES = ['Brumeval', 'Rocheclaire', 'Fortbois', 'Valdor', 'Ombrecombe', 'Hautelande'];
const AI_COLORS = [0xe74c3c, 0x9b59b6, 0xe67e22, 0x1abc9c, 0xf1c40f, 0xecf0f1];
export const PLAYER_COLOR = 0x3498db;

const emptyResources = (): Resources => ({ wood: 0, stone: 0, ore: 0, iron: 0 });

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
  const u: Unit = { id: nextId(state, 'u'), type, ownerId, x, y, hp: def.hp, maxHp: def.hp };
  state.units[u.id] = u;
  return u;
}

/** Builds the initial state: one village + town hall per spawn point. Inhabitants are abstract (no sprites). */
export function createGameState(world: WorldGen): GameState {
  const state: GameState = {
    seed: world.seed,
    timeMs: 0,
    villages: {},
    buildings: {},
    units: {},
    nextId: 0,
    depletion: {},
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
      production: emptyResources(),
      smelterTimerMs: 0,
      inhabitants: GAME.startingInhabitants,
      weapons: { ...GAME.startingWeapons },
      forgeQueue: [],
      alive: true,
      allies: [],
      relations: {},
    };
    state.villages[village.id] = village;

    const half = Math.floor(BUILDINGS.townHall.size / 2);
    addBuilding(state, 'townHall', village.id, spawn.tx - half, spawn.ty - half, true);
  });

  return state;
}

export function townHallOf(state: GameState, villageId: string): Building | undefined {
  return Object.values(state.buildings).find((b) => b.ownerId === villageId && b.type === 'townHall');
}
